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

export type ResultatChargement =
  | { statut: 'absent'; revision: 0 }
  | { statut: 'charge'; etat: EtatCorpus; revision: number }
  | { statut: 'corrompu'; brut: unknown }
  | { statut: 'incompatible'; brut: unknown; version: number }

export class ConflitStockage extends Error {
  constructor() {
    super('La révision stockée a changé.')
    this.name = 'ConflitStockage'
  }
}

function versionDeclaree(brut: unknown): number | undefined {
  if (typeof brut !== 'object' || brut === null) return undefined
  const candidat = 'etat' in brut ? brut.etat : brut
  if (typeof candidat !== 'object' || candidat === null || !('version' in candidat)) return undefined
  return typeof candidat.version === 'number' && Number.isInteger(candidat.version)
    ? candidat.version
    : undefined
}

export function decoderValeurStockee(brut: unknown): ResultatChargement {
  if (brut === undefined) return { statut: 'absent', revision: 0 }

  if (
    typeof brut === 'object' &&
    brut !== null &&
    'format' in brut &&
    brut.format === 1 &&
    'revision' in brut &&
    typeof brut.revision === 'number' &&
    brut.revision >= 0 &&
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

/* —————————————————————————— L'état de l'application —————————————————————————— */

class StockageIndexedDB implements AdaptateurStockage {
  async charger(): Promise<ResultatChargement> {
    const brut = await lireCle(NOM_MAGASIN, CLE)
    const resultat = decoderValeurStockee(brut)
    if (resultat.statut === 'corrompu' || resultat.statut === 'incompatible') {
      try {
        await modifierEtatAtomiquement<void>((magasin, terminer, echouer) => {
          const lecture = magasin.get(CLE_SECOURS)
          lecture.onerror = () => echouer(lecture.error)
          lecture.onsuccess = () => {
            if (lecture.result === undefined) magasin.put(resultat.brut, CLE_SECOURS)
            terminer()
          }
        })
      } catch {
        // Best effort : ne pas empêcher le démarrage.
      }
    }
    return resultat
  }

  async enregistrer(etat: EtatCorpus, revisionAttendue: number): Promise<number> {
    const revisionSuivante = revisionAttendue + 1
    await modifierEtatAtomiquement((magasin, terminer, echouer) => {
      const lecture = magasin.get(CLE)
      lecture.onerror = () => echouer(lecture.error)
      lecture.onsuccess = () => {
        const courant = decoderValeurStockee(lecture.result)
        if (
          (courant.statut !== 'absent' && courant.statut !== 'charge') ||
          courant.revision !== revisionAttendue
        ) {
          echouer(new ConflitStockage())
          return
        }
        magasin.put({ format: 1, revision: revisionSuivante, etat } satisfies DocumentStocke, CLE)
        terminer(revisionSuivante)
      }
    })
    return revisionSuivante
  }

  async effacer(revisionAttendue: number): Promise<number> {
    await modifierEtatAtomiquement((magasin, terminer, echouer) => {
      const lecture = magasin.get(CLE)
      lecture.onerror = () => echouer(lecture.error)
      lecture.onsuccess = () => {
        const courant = decoderValeurStockee(lecture.result)
        if (
          (courant.statut !== 'absent' && courant.statut !== 'charge') ||
          courant.revision !== revisionAttendue
        ) {
          echouer(new ConflitStockage())
          return
        }
        magasin.delete(CLE)
        terminer(0)
      }
    })
    return 0
  }
}

/** Repli en mémoire, pour les tests et les contextes sans IndexedDB. */
export class StockageMemoire implements AdaptateurStockage {
  private valeur: unknown = undefined

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
    const revisionSuivante = revisionAttendue + 1
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
    this.valeur = undefined
    return Promise.resolve(0)
  }
}

export const stockage: AdaptateurStockage =
  typeof indexedDB === 'undefined' ? new StockageMemoire() : new StockageIndexedDB()
