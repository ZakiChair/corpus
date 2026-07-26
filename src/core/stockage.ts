import { analyserEtat, type EtatCorpus, VERSION_ETAT } from './types'

/**
 * Persistance locale.
 *
 * Ce sont des données de santé : elles ne quittent pas la machine. Aucun
 * compte, aucune synchronisation, aucun appel réseau.
 *
 * IndexedDB plutôt que localStorage : quinze métriques sur cinq ans font
 * environ vingt-cinq mille points, et un import Apple Santé peut être bien plus
 * gros. localStorage plafonne autour de cinq mégaoctets et sérialise de façon
 * synchrone, ce qui bloquerait le rendu à chaque écriture.
 */

export interface DocumentStocke {
  format: 1
  revision: number
  etat: EtatCorpus
}

interface TombstoneStocke {
  format: 1
  revision: number
  supprime: true
}

export type ResultatChargement =
  | { statut: 'absent'; revision: number }
  | { statut: 'charge'; etat: EtatCorpus; revision: number }
  | { statut: 'corrompu'; brut: unknown }
  | { statut: 'incompatible'; brut: unknown; version: number }

export class ConflitStockage extends Error {
  constructor() {
    super('La révision stockée a changé.')
    this.name = 'ConflitStockage'
  }
}

function versionObjet(candidat: unknown): number | undefined {
  if (typeof candidat !== 'object' || candidat === null || !('version' in candidat)) return undefined
  return typeof candidat.version === 'number' && Number.isInteger(candidat.version)
    ? candidat.version
    : undefined
}

function versionDeclaree(brut: unknown): number | undefined {
  const racine = versionObjet(brut)
  if (racine !== undefined) return racine
  if (
    typeof brut === 'object' &&
    brut !== null &&
    'format' in brut &&
    brut.format === 1 &&
    'etat' in brut
  ) {
    return versionObjet(brut.etat)
  }
  return undefined
}

interface EntreeStockee {
  presente: boolean
  valeur: unknown
}

function revisionValide(revision: unknown): revision is number {
  return Number.isSafeInteger(revision) && (revision as number) >= 0
}

function incrementerRevision(revision: number): number {
  const suivante = revision + 1
  if (!revisionValide(suivante)) {
    throw new RangeError('La révision stockée ne peut plus être incrémentée.')
  }
  return suivante
}

function decoderEntreeStockee({ presente, valeur: brut }: EntreeStockee): ResultatChargement {
  if (!presente) return { statut: 'absent', revision: 0 }

  if (
    typeof brut === 'object' &&
    brut !== null &&
    'format' in brut &&
    brut.format === 1 &&
    'revision' in brut &&
    revisionValide(brut.revision) &&
    !('etat' in brut) &&
    'supprime' in brut &&
    brut.supprime === true
  ) {
    return { statut: 'absent', revision: brut.revision }
  }

  if (
    typeof brut === 'object' &&
    brut !== null &&
    'format' in brut &&
    brut.format === 1 &&
    'revision' in brut &&
    revisionValide(brut.revision) &&
    'etat' in brut
  ) {
    const etat = analyserEtat(brut.etat)
    if (etat !== null) return { statut: 'charge', etat, revision: brut.revision }
  }

  const etatHistorique = analyserEtat(brut)
  if (etatHistorique !== null) return { statut: 'charge', etat: etatHistorique, revision: 0 }

  const version = versionDeclaree(brut)
  if (version !== undefined && version !== VERSION_ETAT) {
    return { statut: 'incompatible', brut, version }
  }

  return { statut: 'corrompu', brut }
}

export function decoderValeurStockee(brut: unknown): ResultatChargement {
  return decoderEntreeStockee({ presente: brut !== undefined, valeur: brut })
}

export interface AdaptateurStockage {
  charger(): Promise<ResultatChargement>
  enregistrer(etat: EtatCorpus, revisionAttendue: number): Promise<number>
  effacer(revisionAttendue: number): Promise<number>
}

const NOM_BASE = 'corpus'
/** v2 : ajout du magasin `sync` (poignée du dossier surveillé, fichiers vus). */
const VERSION_BASE = 2
const MAGASINS = ['etat', 'sync'] as const
type Magasin = (typeof MAGASINS)[number]

const NOM_MAGASIN: Magasin = 'etat'
const CLE = 'courant'
/**
 * Copie de l'état brut qu'une version future n'aurait pas su relire. Sans
 * elle, un blob jugé illisible serait écrasé par la première mutation d'un
 * état vide — la perte serait silencieuse et définitive.
 */
const CLE_SECOURS = 'secours'

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const demande = indexedDB.open(NOM_BASE, VERSION_BASE)
    demande.onupgradeneeded = () => {
      const db = demande.result
      for (const magasin of MAGASINS) {
        if (!db.objectStoreNames.contains(magasin)) db.createObjectStore(magasin)
      }
    }
    demande.onsuccess = () => resoudre(demande.result)
    demande.onerror = () => rejeter(demande.error)
  })
}

/* ————————————— Accès générique clé-valeur, partagé avec la sync ————————————— */

export async function lireCle(magasin: Magasin, cle: string): Promise<unknown> {
  const db = await ouvrir()
  try {
    return await new Promise<unknown>((resoudre, rejeter) => {
      const demande = db.transaction(magasin, 'readonly').objectStore(magasin).get(cle)
      demande.onsuccess = () => resoudre(demande.result)
      demande.onerror = () => rejeter(demande.error)
    })
  } finally {
    db.close()
  }
}

export async function ecrireCle(magasin: Magasin, cle: string, valeur: unknown): Promise<void> {
  const db = await ouvrir()
  try {
    await new Promise<void>((resoudre, rejeter) => {
      const tx = db.transaction(magasin, 'readwrite')
      tx.objectStore(magasin).put(valeur, cle)
      tx.oncomplete = () => resoudre()
      tx.onerror = () => rejeter(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function supprimerCle(magasin: Magasin, cle: string): Promise<void> {
  const db = await ouvrir()
  try {
    await new Promise<void>((resoudre, rejeter) => {
      const tx = db.transaction(magasin, 'readwrite')
      tx.objectStore(magasin).delete(cle)
      tx.oncomplete = () => resoudre()
      tx.onerror = () => rejeter(tx.error)
    })
  } finally {
    db.close()
  }
}

function modifierEtatAtomiquement<T>(
  modifier: (
    magasin: IDBObjectStore,
    terminer: (resultat: T) => void,
    echouer: (erreur: unknown) => void,
  ) => void,
): Promise<T> {
  return ouvrir().then(
    (db) =>
      new Promise<T>((resoudre, rejeter) => {
        let resultat: T
        let termine = false

        const finirAvecErreur = (erreur: unknown) => {
          if (termine) return
          termine = true
          try {
            tx.abort()
          } catch {
            // La transaction peut déjà être terminée.
          }
          db.close()
          rejeter(erreur)
        }

        let tx: IDBTransaction
        try {
          tx = db.transaction(NOM_MAGASIN, 'readwrite')
        } catch (erreur) {
          termine = true
          db.close()
          rejeter(erreur)
          return
        }

        tx.oncomplete = () => {
          if (termine) return
          termine = true
          db.close()
          resoudre(resultat)
        }
        tx.onerror = () => finirAvecErreur(tx.error)
        tx.onabort = () => finirAvecErreur(tx.error)

        try {
          modifier(
            tx.objectStore(NOM_MAGASIN),
            (valeur) => {
              if (!termine) resultat = valeur
            },
            finirAvecErreur,
          )
        } catch (erreur) {
          finirAvecErreur(erreur)
        }
      }),
  )
}

function lireEntreeDansMagasin(
  magasin: IDBObjectStore,
  cle: string,
  terminer: (entree: EntreeStockee) => void,
  echouer: (erreur: unknown) => void,
): void {
  const lecture = magasin.get(cle)
  const presence = magasin.count(cle)
  let valeurLue = false
  let presenceLue = false

  const terminerSiComplet = () => {
    if (valeurLue && presenceLue) {
      terminer({ presente: presence.result > 0, valeur: lecture.result })
    }
  }
  lecture.onerror = () => echouer(lecture.error)
  presence.onerror = () => echouer(presence.error)
  lecture.onsuccess = () => {
    valeurLue = true
    terminerSiComplet()
  }
  presence.onsuccess = () => {
    presenceLue = true
    terminerSiComplet()
  }
}

async function lireEntreeEtat(cle: string): Promise<EntreeStockee> {
  const db = await ouvrir()
  try {
    return await new Promise<EntreeStockee>((resoudre, rejeter) => {
      const tx = db.transaction(NOM_MAGASIN, 'readonly')
      let entree: EntreeStockee | undefined
      lireEntreeDansMagasin(tx.objectStore(NOM_MAGASIN), cle, (resultat) => {
        entree = resultat
      }, rejeter)
      tx.oncomplete = () => {
        if (entree === undefined) {
          rejeter(new Error('Lecture IndexedDB incomplète.'))
          return
        }
        resoudre(entree)
      }
      tx.onerror = () => rejeter(tx.error)
      tx.onabort = () => rejeter(tx.error)
    })
  } finally {
    db.close()
  }
}

/* —————————————————————————— L'état de l'application —————————————————————————— */

class StockageIndexedDB implements AdaptateurStockage {
  async charger(): Promise<ResultatChargement> {
    const resultat = decoderEntreeStockee(await lireEntreeEtat(CLE))
    if (resultat.statut === 'corrompu' || resultat.statut === 'incompatible') {
      try {
        await modifierEtatAtomiquement<void>((magasin, terminer, echouer) => {
          lireEntreeDansMagasin(magasin, CLE_SECOURS, (secours) => {
            if (!secours.presente) magasin.put(resultat.brut, CLE_SECOURS)
            terminer()
          }, echouer)
        })
      } catch {
        // Best effort : ne pas empêcher le démarrage.
      }
    }
    return resultat
  }

  async enregistrer(etat: EtatCorpus, revisionAttendue: number): Promise<number> {
    const revisionSuivante = incrementerRevision(revisionAttendue)
    await modifierEtatAtomiquement((magasin, terminer, echouer) => {
      lireEntreeDansMagasin(magasin, CLE, (entree) => {
        const courant = decoderEntreeStockee(entree)
        if (
          (courant.statut !== 'absent' && courant.statut !== 'charge') ||
          courant.revision !== revisionAttendue
        ) {
          echouer(new ConflitStockage())
          return
        }
        magasin.put({ format: 1, revision: revisionSuivante, etat } satisfies DocumentStocke, CLE)
        terminer(revisionSuivante)
      }, echouer)
    })
    return revisionSuivante
  }

  async effacer(revisionAttendue: number): Promise<number> {
    const revisionSuivante = incrementerRevision(revisionAttendue)
    await modifierEtatAtomiquement((magasin, terminer, echouer) => {
      lireEntreeDansMagasin(magasin, CLE, (entree) => {
        const courant = decoderEntreeStockee(entree)
        if (
          (courant.statut !== 'absent' && courant.statut !== 'charge') ||
          courant.revision !== revisionAttendue
        ) {
          echouer(new ConflitStockage())
          return
        }
        magasin.put(
          { format: 1, revision: revisionSuivante, supprime: true } satisfies TombstoneStocke,
          CLE,
        )
        terminer(revisionSuivante)
      }, echouer)
    })
    return revisionSuivante
  }
}

/** Adaptateur en mémoire réservé à l’injection explicite dans les tests. */
export class StockageMemoire implements AdaptateurStockage {
  private valeur: unknown

  constructor(valeur: unknown = undefined) {
    this.valeur = valeur
  }

  charger(): Promise<ResultatChargement> {
    return Promise.resolve(decoderValeurStockee(this.valeur))
  }

  enregistrer(etat: EtatCorpus, revisionAttendue: number): Promise<number> {
    const courant = decoderValeurStockee(this.valeur)
    if (
      (courant.statut !== 'absent' && courant.statut !== 'charge') ||
      courant.revision !== revisionAttendue
    ) {
      return Promise.reject(new ConflitStockage())
    }
    let revisionSuivante: number
    try {
      revisionSuivante = incrementerRevision(revisionAttendue)
    } catch (erreur) {
      return Promise.reject(erreur)
    }
    this.valeur = { format: 1, revision: revisionSuivante, etat } satisfies DocumentStocke
    return Promise.resolve(revisionSuivante)
  }

  effacer(revisionAttendue: number): Promise<number> {
    const courant = decoderValeurStockee(this.valeur)
    if (
      (courant.statut !== 'absent' && courant.statut !== 'charge') ||
      courant.revision !== revisionAttendue
    ) {
      return Promise.reject(new ConflitStockage())
    }
    let revisionSuivante: number
    try {
      revisionSuivante = incrementerRevision(revisionAttendue)
    } catch (erreur) {
      return Promise.reject(erreur)
    }
    this.valeur = {
      format: 1,
      revision: revisionSuivante,
      supprime: true,
    } satisfies TombstoneStocke
    return Promise.resolve(revisionSuivante)
  }
}

const stockageIndisponible: AdaptateurStockage = {
  charger: () => Promise.reject(new Error('IndexedDB est indisponible.')),
  enregistrer: () => Promise.reject(new Error('IndexedDB est indisponible.')),
  effacer: () => Promise.reject(new Error('IndexedDB est indisponible.')),
}

export const stockage: AdaptateurStockage =
  typeof indexedDB === 'undefined' ? stockageIndisponible : new StockageIndexedDB()
