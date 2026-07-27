/**
 * Lecture minimale d'archives ZIP, juste ce qu'il faut pour l'export Apple Santé.
 *
 * Apple livre un `export.zip` ; obliger à le décompresser à la main serait une
 * friction inutile. Aucune dépendance : la décompression passe par
 * `DecompressionStream('deflate-raw')`, disponible dans les navigateurs
 * modernes et dans Node.
 *
 * On lit le CATALOGUE CENTRAL, en fin d'archive, plutôt que d'avancer d'en-tête
 * local en en-tête local. Deux raisons : `Blob.slice()` évite de charger les
 * centaines de mégaoctets en mémoire, et surtout les en-têtes locaux peuvent
 * annoncer des tailles nulles quand le bit 3 des drapeaux est posé (écriture en
 * flux), les vraies tailles n'étant alors connues qu'après les données. Le
 * catalogue central, lui, les porte toujours.
 */

const SIG_FIN_CATALOGUE = 0x06054b50
const SIG_ENTREE_CATALOGUE = 0x02014b50
const SIG_ENTETE_LOCAL = 0x04034b50
const TAILLE_FIN_CATALOGUE = 22
const TAILLE_ENTREE_CATALOGUE = 46
const TAILLE_ENTETE_LOCAL = 30
/** Sentinelle ZIP64 : la vraie valeur est dans un champ étendu. */
const SENTINELLE_ZIP64 = 0xffffffff

export interface EntreeZip {
  nom: string
  /** 0 = stocké tel quel, 8 = deflate. */
  methode: number
  offsetEnteteLocal: number
  tailleCompressee: number
  tailleDecompressee: number
}

export class ErreurZip extends Error {}

async function lireOctets(blob: Blob, debut: number, fin: number): Promise<DataView> {
  const tampon = await blob.slice(debut, fin).arrayBuffer()
  return new DataView(tampon)
}

/**
 * Localise l'enregistrement de fin de catalogue.
 *
 * Aucune direction de balayage ne suffit à elle seule, et c'est contre-intuitif :
 * le commentaire d'archive vient APRÈS cet enregistrement, donc un balayage
 * arrière tombe sur une fausse signature contenue dans le commentaire AVANT de
 * trouver la vraie ; un balayage avant, lui, se ferait piéger par une
 * signature apparaissant dans les données compressées.
 *
 * On VALIDE donc chaque candidat plutôt que de faire confiance à sa position.
 * Le test décisif : le champ « longueur du commentaire » doit rendre compte
 * exactement des octets restants. Le vrai enregistrement le vérifie par
 * construction, un leurre pratiquement jamais. On contrôle en plus que le
 * catalogue annoncé tient bien avant l'enregistrement.
 */
async function trouverFinCatalogue(
  blob: Blob,
): Promise<{ offsetCatalogue: number; nbEntrees: number }> {
  const fenetre = Math.min(blob.size, 64 * 1024 + TAILLE_FIN_CATALOGUE)
  const debut = blob.size - fenetre
  const vue = await lireOctets(blob, debut, blob.size)

  for (let i = fenetre - TAILLE_FIN_CATALOGUE; i >= 0; i--) {
    if (vue.getUint32(i, true) !== SIG_FIN_CATALOGUE) continue
    const longueurCommentaire = vue.getUint16(i + 20, true)
    if (debut + i + TAILLE_FIN_CATALOGUE + longueurCommentaire !== blob.size) continue

    const nbEntrees = vue.getUint16(i + 10, true)
    const tailleCatalogue = vue.getUint32(i + 12, true)
    const offsetCatalogue = vue.getUint32(i + 16, true)
    if (offsetCatalogue === SENTINELLE_ZIP64 || tailleCatalogue === SENTINELLE_ZIP64) {
      throw new ErreurZip(
        'Archive au format ZIP64, non prise en charge. Décompresse-la et importe le fichier XML directement.',
      )
    }
    if (offsetCatalogue + tailleCatalogue > debut + i) continue
    return { offsetCatalogue, nbEntrees }
  }
  throw new ErreurZip('Ce fichier n’est pas une archive ZIP lisible.')
}

export async function listerEntrees(blob: Blob): Promise<EntreeZip[]> {
  const { offsetCatalogue, nbEntrees } = await trouverFinCatalogue(blob)
  const vue = await lireOctets(blob, offsetCatalogue, blob.size)
  const decodeur = new TextDecoder('utf-8')
  const entrees: EntreeZip[] = []
  let p = 0

  for (let k = 0; k < nbEntrees; k++) {
    if (p + TAILLE_ENTREE_CATALOGUE > vue.byteLength) break
    if (vue.getUint32(p, true) !== SIG_ENTREE_CATALOGUE) break
    const methode = vue.getUint16(p + 10, true)
    let tailleCompressee = vue.getUint32(p + 20, true)
    let tailleDecompressee = vue.getUint32(p + 24, true)
    const longueurNom = vue.getUint16(p + 28, true)
    const longueurExtra = vue.getUint16(p + 30, true)
    const longueurCommentaire = vue.getUint16(p + 32, true)
    let offsetEnteteLocal = vue.getUint32(p + 42, true)
    const nom = decodeur.decode(
      new Uint8Array(vue.buffer, vue.byteOffset + p + TAILLE_ENTREE_CATALOGUE, longueurNom),
    )

    // Champ extra ZIP64 (id 0x0001) : dès qu'une valeur 32 bits déborde, le
    // catalogue porte la sentinelle et la vraie valeur 64 bits vit ici — dans
    // l'ordre (décompressée, compressée, offset), et UNIQUEMENT pour les
    // champs effectivement à la sentinelle. Un export.xml de plusieurs Gio
    // décompressés est le cas réel : sans cette lecture, la barre de
    // progression sauterait à 100 % puis se figerait.
    let q = p + TAILLE_ENTREE_CATALOGUE + longueurNom
    const finExtra = q + longueurExtra
    while (q + 4 <= finExtra && q + 4 <= vue.byteLength) {
      const id = vue.getUint16(q, true)
      const taille = vue.getUint16(q + 2, true)
      if (id === 0x0001) {
        let r = q + 4
        const fin = Math.min(q + 4 + taille, finExtra)
        if (tailleDecompressee === SENTINELLE_ZIP64 && r + 8 <= fin) {
          tailleDecompressee = Number(vue.getBigUint64(r, true))
          r += 8
        }
        if (tailleCompressee === SENTINELLE_ZIP64 && r + 8 <= fin) {
          tailleCompressee = Number(vue.getBigUint64(r, true))
          r += 8
        }
        if (offsetEnteteLocal === SENTINELLE_ZIP64 && r + 8 <= fin) {
          offsetEnteteLocal = Number(vue.getBigUint64(r, true))
        }
        break
      }
      q += 4 + taille
    }

    // Une sentinelle encore présente après lecture du champ extra signale un
    // catalogue malformé : l'entrée est inutilisable, on l'écarte.
    if (
      tailleCompressee !== SENTINELLE_ZIP64 &&
      offsetEnteteLocal !== SENTINELLE_ZIP64 &&
      tailleDecompressee !== SENTINELLE_ZIP64
    ) {
      entrees.push({ nom, methode, offsetEnteteLocal, tailleCompressee, tailleDecompressee })
    }
    p += TAILLE_ENTREE_CATALOGUE + longueurNom + longueurExtra + longueurCommentaire
  }
  return entrees
}

/**
 * Flux décompressé d'une entrée.
 *
 * Les longueurs de nom et de champ extra sont relues dans l'EN-TÊTE LOCAL et
 * non reprises du catalogue : les deux peuvent différer, et se tromper décale
 * le début des données de quelques octets — ce qui ne produit pas une erreur
 * franche mais un flux illisible.
 */
export async function fluxEntree(blob: Blob, entree: EntreeZip): Promise<ReadableStream<Uint8Array>> {
  const enteteLocal = await lireOctets(
    blob,
    entree.offsetEnteteLocal,
    entree.offsetEnteteLocal + TAILLE_ENTETE_LOCAL,
  )
  if (enteteLocal.getUint32(0, true) !== SIG_ENTETE_LOCAL) {
    throw new ErreurZip(`En-tête local introuvable pour « ${entree.nom} ».`)
  }
  const longueurNom = enteteLocal.getUint16(26, true)
  const longueurExtra = enteteLocal.getUint16(28, true)
  const debutDonnees = entree.offsetEnteteLocal + TAILLE_ENTETE_LOCAL + longueurNom + longueurExtra
  const donnees = blob.slice(debutDonnees, debutDonnees + entree.tailleCompressee)

  if (entree.methode === 0) return donnees.stream() as ReadableStream<Uint8Array>
  if (entree.methode !== 8) {
    throw new ErreurZip(`Méthode de compression ${entree.methode} non prise en charge.`)
  }
  // « deflate-raw » et non « deflate » : dans un ZIP les données n'ont pas
  // l'en-tête zlib de deux octets.
  //
  // L'annotation est explicite parce que le `writable` d'un DecompressionStream
  // est typé `BufferSource`, plus large que `Uint8Array` ; TypeScript refuse la
  // conversion alors qu'un Uint8Array EST un BufferSource.
  const decompression = new DecompressionStream(
    'deflate-raw',
  ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  return (donnees.stream() as ReadableStream<Uint8Array>).pipeThrough(decompression)
}

/**
 * Entrée dont le nom de fichier correspond, quel que soit le dossier.
 * iOS niche `export.xml` sous `apple_health_export/`.
 */
export function trouverParNomDeFichier(
  entrees: readonly EntreeZip[],
  nomFichier: string,
): EntreeZip | undefined {
  const cible = nomFichier.toLowerCase()
  return entrees.find((e) => {
    const base = e.nom.split('/').pop()?.toLowerCase() ?? ''
    return base === cible
  })
}
