import { analyserEtat, type EtatCorpus } from './types'

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

export interface AdaptateurStockage {
  charger(): Promise<EtatCorpus | null>
  enregistrer(etat: EtatCorpus): Promise<void>
  effacer(): Promise<void>
}

const NOM_BASE = 'corpus'
const NOM_MAGASIN = 'etat'
const CLE = 'courant'

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const demande = indexedDB.open(NOM_BASE, 1)
    demande.onupgradeneeded = () => {
      const db = demande.result
      if (!db.objectStoreNames.contains(NOM_MAGASIN)) db.createObjectStore(NOM_MAGASIN)
    }
    demande.onsuccess = () => resoudre(demande.result)
    demande.onerror = () => rejeter(demande.error)
  })
}

class StockageIndexedDB implements AdaptateurStockage {
  async charger(): Promise<EtatCorpus | null> {
    try {
      const db = await ouvrir()
      const brut = await new Promise<unknown>((resoudre, rejeter) => {
        const tx = db.transaction(NOM_MAGASIN, 'readonly')
        const demande = tx.objectStore(NOM_MAGASIN).get(CLE)
        demande.onsuccess = () => resoudre(demande.result)
        demande.onerror = () => rejeter(demande.error)
      })
      db.close()
      if (brut === undefined) return null
      // Une donnée illisible — écrite par une version antérieure ou corrompue —
      // vaut mieux ignorée qu'un plantage au démarrage.
      return analyserEtat(brut)
    } catch {
      return null
    }
  }

  async enregistrer(etat: EtatCorpus): Promise<void> {
    const db = await ouvrir()
    await new Promise<void>((resoudre, rejeter) => {
      const tx = db.transaction(NOM_MAGASIN, 'readwrite')
      tx.objectStore(NOM_MAGASIN).put(etat, CLE)
      tx.oncomplete = () => resoudre()
      tx.onerror = () => rejeter(tx.error)
    })
    db.close()
  }

  async effacer(): Promise<void> {
    const db = await ouvrir()
    await new Promise<void>((resoudre, rejeter) => {
      const tx = db.transaction(NOM_MAGASIN, 'readwrite')
      tx.objectStore(NOM_MAGASIN).delete(CLE)
      tx.oncomplete = () => resoudre()
      tx.onerror = () => rejeter(tx.error)
    })
    db.close()
  }
}

/** Repli en mémoire, pour les tests et les contextes sans IndexedDB. */
export class StockageMemoire implements AdaptateurStockage {
  private etat: EtatCorpus | null = null

  charger(): Promise<EtatCorpus | null> {
    return Promise.resolve(this.etat)
  }

  enregistrer(etat: EtatCorpus): Promise<void> {
    this.etat = etat
    return Promise.resolve()
  }

  effacer(): Promise<void> {
    this.etat = null
    return Promise.resolve()
  }
}

export const stockage: AdaptateurStockage =
  typeof indexedDB === 'undefined' ? new StockageMemoire() : new StockageIndexedDB()
