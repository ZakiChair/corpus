import { definitionOuGenerique, METRIQUES } from '../core/metriques'
import { estJourValide, type Jour } from '../core/temps'
import { normaliserSerie, type Serie } from '../core/types'

/**
 * Import CSV.
 *
 * Le format n'est pas imposé : le séparateur, le format de date et le
 * séparateur décimal sont détectés. C'est le seul moyen d'avaler sans friction
 * ce que crachent les exports d'objets connectés, de tableurs suisses et de
 * scripts maison — qui ne s'accordent sur aucun des trois.
 */

export interface ResultatImport {
  series: Record<string, Serie>
  /** Colonnes reconnues, avec la métrique à laquelle elles ont été rattachées. */
  colonnes: { entete: string; idMetrique: string; connue: boolean; points: number }[]
  lignesLues: number
  lignesIgnorees: number
  avertissements: string[]
}

const SEPARATEURS = [',', ';', '\t', '|'] as const

/** Le séparateur retenu est celui qui découpe l'en-tête en le plus de colonnes. */
export function detecterSeparateur(entete: string): string {
  let meilleur = ','
  let maximum = 0
  for (const s of SEPARATEURS) {
    const n = decouper(entete, s).length
    if (n > maximum) {
      maximum = n
      meilleur = s
    }
  }
  return meilleur
}

/** Découpe une ligne en respectant les guillemets doubles. */
export function decouper(ligne: string, separateur: string): string[] {
  const cellules: string[] = []
  let courant = ''
  let entreGuillemets = false
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i]!
    if (c === '"') {
      // Deux guillemets consécutifs à l'intérieur d'un champ = un guillemet.
      if (entreGuillemets && ligne[i + 1] === '"') {
        courant += '"'
        i++
      } else {
        entreGuillemets = !entreGuillemets
      }
    } else if (c === separateur && !entreGuillemets) {
      cellules.push(courant)
      courant = ''
    } else {
      courant += c
    }
  }
  cellules.push(courant)
  return cellules.map((c) => c.trim())
}

const MOIS_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})/
const JOUR_MOIS_AN = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/

/**
 * Analyse une date. Formats acceptés : ISO (AAAA-MM-JJ, éventuellement suivi
 * d'une heure, qui est ignorée puisqu'on travaille au grain journalier) et
 * jour-mois-année séparé par point, barre ou tiret.
 *
 * L'ordre JOUR-mois est supposé : c'est la convention européenne, et Corpus
 * est écrit pour un usage suisse. Une date américaine 03/12/2026 serait donc
 * lue comme le 3 décembre. Ambiguïté irréductible sans métadonnée.
 */
export function analyserDate(brut: string): Jour | null {
  const t = brut.trim()
  const iso = MOIS_ISO.exec(t)
  if (iso) {
    const j = `${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}`
    return estJourValide(j) ? j : null
  }
  const jma = JOUR_MOIS_AN.exec(t)
  if (jma) {
    const j = `${jma[3]}-${jma[2]!.padStart(2, '0')}-${jma[1]!.padStart(2, '0')}`
    return estJourValide(j) ? j : null
  }
  return null
}

/**
 * Analyse un nombre. Gère la virgule décimale, les espaces (y compris
 * insécables) comme séparateurs de milliers, et le point comme décimale.
 */
export function analyserNombre(brut: string): number | null {
  const t = brut.trim().replace(/[\s\u00a0\u202f']/g, '')
  if (t === '' || t === '-' || t === '—') return null
  // « 1.234,56 » : le point sépare les milliers, la virgule les décimales.
  const normalise =
    t.includes(',') && t.includes('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(',', '.')
  const n = Number(normalise)
  return Number.isFinite(n) ? n : null
}

function normaliserEtiquette(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    // Marques diacritiques combinantes : « Énergie » et « energie » doivent
    // se rejoindre. Échappement explicite plutôt que littéral, ces caractères
    // étant invisibles dans un éditeur.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

const PAR_ETIQUETTE = new Map<string, string>()
for (const m of METRIQUES) {
  PAR_ETIQUETTE.set(normaliserEtiquette(m.id), m.id)
  PAR_ETIQUETTE.set(normaliserEtiquette(m.label), m.id)
  PAR_ETIQUETTE.set(normaliserEtiquette(m.abrege), m.id)
}
// Quelques synonymes courants des exports d'appareils.
for (const [alias, id] of [
  ['hrv', 'vfc'],
  ['rmssd', 'vfc'],
  ['restingheartrate', 'fc_repos'],
  ['fcrepos', 'fc_repos'],
  ['restinghr', 'fc_repos'],
  ['sleepduration', 'sommeil_duree'],
  ['sommeil', 'sommeil_duree'],
  ['deepsleep', 'sommeil_profond'],
  ['weight', 'poids'],
  ['bodyfat', 'masse_grasse'],
  ['waist', 'tour_taille'],
  ['steps', 'pas'],
  ['energy', 'energie'],
  ['mood', 'humeur'],
  ['soreness', 'courbatures'],
] as const) {
  PAR_ETIQUETTE.set(alias, id)
}

/** Rattache un en-tête de colonne à une métrique du catalogue, si possible. */
export function reconnaitreColonne(entete: string): { id: string; connue: boolean } {
  const cle = normaliserEtiquette(entete)
  const trouve = PAR_ETIQUETTE.get(cle)
  if (trouve) return { id: trouve, connue: true }
  // Colonne inconnue : on la conserve sous un identifiant stable plutôt que
  // de la jeter — l'utilisateur sait ce que c'est, pas nous.
  return { id: cle === '' ? 'colonne' : cle, connue: false }
}

const ENTETES_DATE = new Set(['date', 'jour', 'day', 'datetime', 'timestamp', 'startdate'])

export function importerCsv(texte: string): ResultatImport {
  const avertissements: string[] = []
  const lignes = texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')

  if (lignes.length < 2) {
    return {
      series: {},
      colonnes: [],
      lignesLues: 0,
      lignesIgnorees: 0,
      avertissements: ['Le fichier ne contient pas d’en-tête suivi d’au moins une ligne.'],
    }
  }

  const separateur = detecterSeparateur(lignes[0]!)
  const entetes = decouper(lignes[0]!, separateur)

  // Colonne de date : celle dont l'en-tête le dit, sinon la première.
  let colonneDate = entetes.findIndex((e) => ENTETES_DATE.has(normaliserEtiquette(e)))
  if (colonneDate < 0) {
    colonneDate = 0
    avertissements.push(
      `Aucune colonne de date nommée : la première colonne (« ${entetes[0]} ») est utilisée.`,
    )
  }

  const correspondances = entetes.map((e, i) =>
    i === colonneDate ? null : reconnaitreColonne(e),
  )

  const brut: Record<string, { j: Jour; v: number }[]> = {}
  let lignesLues = 0
  let lignesIgnorees = 0

  for (let i = 1; i < lignes.length; i++) {
    const cellules = decouper(lignes[i]!, separateur)
    const jour = analyserDate(cellules[colonneDate] ?? '')
    if (!jour) {
      lignesIgnorees++
      continue
    }
    lignesLues++
    for (let c = 0; c < entetes.length; c++) {
      const corr = correspondances[c]
      if (!corr) continue
      const valeur = analyserNombre(cellules[c] ?? '')
      if (valeur === null) continue
      // Les bornes du catalogue écartent les erreurs d'unité manifestes
      // (un poids en livres, une durée de sommeil en minutes).
      const def = definitionOuGenerique(corr.id)
      if (corr.connue && (valeur < def.min || valeur > def.max)) continue
      ;(brut[corr.id] ??= []).push({ j: jour, v: valeur })
    }
  }

  const series: Record<string, Serie> = {}
  const colonnes: ResultatImport['colonnes'] = []
  for (let c = 0; c < entetes.length; c++) {
    const corr = correspondances[c]
    if (!corr) continue
    const points = brut[corr.id] ?? []
    if (points.length === 0) continue
    series[corr.id] = normaliserSerie(points)
    colonnes.push({
      entete: entetes[c]!,
      idMetrique: corr.id,
      connue: corr.connue,
      points: series[corr.id]!.length,
    })
  }

  if (lignesIgnorees > 0) {
    avertissements.push(
      `${lignesIgnorees} ligne${lignesIgnorees > 1 ? 's' : ''} sans date lisible, ignorée${
        lignesIgnorees > 1 ? 's' : ''
      }.`,
    )
  }
  const inconnues = colonnes.filter((c) => !c.connue)
  if (inconnues.length > 0) {
    avertissements.push(
      `Colonne${inconnues.length > 1 ? 's' : ''} hors catalogue conservée${
        inconnues.length > 1 ? 's' : ''
      } telle${inconnues.length > 1 ? 's' : ''} quelle${inconnues.length > 1 ? 's' : ''} : ${inconnues
        .map((c) => c.entete)
        .join(', ')}.`,
    )
  }

  return { series, colonnes, lignesLues, lignesIgnorees, avertissements }
}
