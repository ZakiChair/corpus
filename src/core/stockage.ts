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

/* —————————————————————————— L'état de l'application —————————————————————————— */

class StockageIndexedDB implements AdaptateurStockage {
  async charger(): Promise<EtatCorpus | null> {
    try {
      const brut = await lireCle(NOM_MAGASIN, CLE)
      if (brut === undefined) return null
      const etat = analyserEtat(brut)
      if (etat === null) {
        // Une donnée illisible vaut mieux ignorée qu'un plantage au démarrage —
        // mais copiée d'abord : la première mutation de l'état vide qui suivra
        // écraserait sinon la seule trace des données. La copie n'écrase jamais
        // un secours existant.
        try {
          if ((await lireCle(NOM_MAGASIN, CLE_SECOURS)) === undefined) {
            await ecrireCle(NOM_MAGASIN, CLE_SECOURS, brut)
          }
        } catch {
          // Best effort : ne pas empêcher le démarrage.
        }
      }
      return etat
    } catch {
      return null
    }
  }

  enregistrer(etat: EtatCorpus): Promise<void> {
    return ecrireCle(NOM_MAGASIN, CLE, etat)
  }

  effacer(): Promise<void> {
    return supprimerCle(NOM_MAGASIN, CLE)
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
