import { createStore } from 'zustand/vanilla'
import { storeDonnees } from '../core/donneesStore'
import { ecrireCle, lireCle, supprimerCle } from '../core/stockage'
import { aujourdhui, decalerJour } from '../core/temps'

/**
 * Sauvegarde automatique sur fichier.
 *
 * Les données vivent dans l'IndexedDB d'un profil de navigateur : un « vider
 * les données de site » les efface. Ce module écrit chaque jour une copie
 * JSON dans un dossier choisi — un dossier iCloud Drive donne une sauvegarde
 * hors machine sans aucun serveur.
 *
 * Un fichier PAR JOUR (`corpus-sauvegarde-AAAA-MM-JJ.json`), les plus vieux
 * que deux semaines élagués : écraser un fichier unique ferait qu'un état
 * corrompu détruise la seule bonne copie.
 */

interface PoigneeFichierEcriture {
  createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>
}

export interface PoigneeDossierEcriture {
  readonly name: string
  values(): AsyncIterableIterator<{ kind: string; name: string }>
  getFileHandle(nom: string, o?: { create?: boolean }): Promise<PoigneeFichierEcriture>
  removeEntry(nom: string): Promise<void>
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
}

type Selecteur = (o?: { id?: string; mode?: 'readwrite' }) => Promise<PoigneeDossierEcriture>

function selecteur(): Selecteur | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { showDirectoryPicker?: Selecteur }).showDirectoryPicker
}

const CLE_DOSSIER = 'dossierSauvegarde'
const MOTIF_FICHIER = /^corpus-sauvegarde-(\d{4}-\d{2}-\d{2})\.json$/
const RETENTION_JOURS = 14
const INTERVALLE_MS = 60 * 60 * 1000

export type PhaseSauvegarde = 'indisponible' | 'inactif' | 'permission' | 'actif'

interface EtatSauvegarde {
  phase: PhaseSauvegarde
  dossier?: string
  /** Jour et heure de la dernière écriture réussie. */
  derniere?: string
  erreur?: string

  choisirDossier: () => Promise<void>
  reprendre: () => Promise<void>
  oublier: () => Promise<void>
}

let poignee: PoigneeDossierEcriture | undefined
let minuteur: ReturnType<typeof setInterval> | undefined

async function ecrireSauvegarde(): Promise<void> {
  if (!poignee) return
  const { etat, vide } = storeDonnees.getState()
  // Ne jamais figer un état vide : une sauvegarde de rien écraserait la
  // rotation avec quatorze fichiers sans contenu.
  if (vide) return
  try {
    const jour = aujourdhui()
    const fichier = await poignee.getFileHandle(`corpus-sauvegarde-${jour}.json`, { create: true })
    const flux = await fichier.createWritable()
    await flux.write(JSON.stringify(etat))
    await flux.close()

    // Élagage des sauvegardes plus vieilles que la rétention.
    const limite = decalerJour(jour, -RETENTION_JOURS)
    for await (const e of poignee.values()) {
      const m = MOTIF_FICHIER.exec(e.name)
      if (m && m[1]! < limite) await poignee.removeEntry(e.name)
    }

    storeSauvegarde.setState({
      derniere: `${jour} ${new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`,
      erreur: undefined,
    })
  } catch (err) {
    storeSauvegarde.setState({ erreur: (err as Error).message })
  }
}

function activer(p: PoigneeDossierEcriture): void {
  poignee = p
  if (minuteur !== undefined) clearInterval(minuteur)
  // Réécrit le fichier du jour toutes les heures : ce qui a été saisi dans la
  // journée ne survit pas qu'en IndexedDB jusqu'au lendemain.
  minuteur = setInterval(() => void ecrireSauvegarde(), INTERVALLE_MS)
  storeSauvegarde.setState({ phase: 'actif', dossier: p.name, erreur: undefined })
  void ecrireSauvegarde()
}

export const storeSauvegarde = createStore<EtatSauvegarde>((set) => ({
  phase: selecteur() ? 'inactif' : 'indisponible',

  choisirDossier: async () => {
    const ouvrir = selecteur()
    if (!ouvrir) return
    try {
      const p = await ouvrir({ id: 'corpus-sauvegarde', mode: 'readwrite' })
      await ecrireCle('sync', CLE_DOSSIER, p)
      activer(p)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') set({ erreur: (err as Error).message })
    }
  },

  reprendre: async () => {
    if (!poignee) return
    try {
      const accord = (await poignee.requestPermission?.({ mode: 'readwrite' })) ?? 'granted'
      if (accord === 'granted') activer(poignee)
      else set({ erreur: 'Écriture refusée par le navigateur.' })
    } catch (err) {
      set({ erreur: (err as Error).message })
    }
  },

  oublier: async () => {
    poignee = undefined
    if (minuteur !== undefined) clearInterval(minuteur)
    minuteur = undefined
    await supprimerCle('sync', CLE_DOSSIER)
    set({ phase: 'inactif', dossier: undefined, derniere: undefined, erreur: undefined })
  },
}))

/** Au démarrage : reprendre le dossier choisi si le navigateur l'autorise encore. */
export async function demarrerSauvegardeAuto(): Promise<void> {
  if (!selecteur()) return
  try {
    const brut = await lireCle('sync', CLE_DOSSIER)
    if (!brut) return
    const p = brut as PoigneeDossierEcriture
    poignee = p
    const accord = (await p.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt'
    if (accord === 'granted') activer(p)
    else storeSauvegarde.setState({ phase: 'permission', dossier: p.name })
  } catch {
    // Poignée illisible : on repart de zéro sans bruit.
  }
}
