import { createStore } from 'zustand/vanilla'
import { storeDonnees } from '../core/donneesStore'
import { ecrireCle, lireCle, supprimerCle } from '../core/stockage'
import { importerAthlos } from './importAthlos'
import { estAutoExport, importerAutoExport } from './importAutoExport'
import { importerCsv } from './importCsv'
import { importerSante } from './importSante'

/**
 * Synchronisation continue : CORPUS surveille un dossier local et importe
 * automatiquement les fichiers nouveaux ou modifiés.
 *
 * C'est le chemin « live » depuis l'Apple Watch : la montre synchronise vers
 * Santé sur l'iPhone, une automatisation iPhone (Health Auto Export, ou un
 * raccourci) dépose un export périodique dans iCloud Drive, le dossier arrive
 * sur le Mac — et CORPUS le lit d'ici. Aucun serveur, aucun compte : les
 * données ne quittent jamais les machines de l'utilisateur.
 *
 * Repose sur la File System Access API (Chromium uniquement). La poignée du
 * dossier est conservée en IndexedDB ; au démarrage suivant, le navigateur
 * exige un geste de l'utilisateur pour ré-autoriser la lecture — d'où l'état
 * `permission` et le bouton « Reprendre » dans DONN.
 */

/* ————— Types minimaux File System Access (la partie WICG manque à lib.dom) ————— */

interface PoigneeFichier {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

export interface PoigneeDossier {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterableIterator<PoigneeFichier | PoigneeDossier>
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>
}

type SelecteurDossier = (o?: { id?: string; mode?: 'read' }) => Promise<PoigneeDossier>

function selecteurDossier(): SelecteurDossier | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { showDirectoryPicker?: SelecteurDossier }).showDirectoryPicker
}

/* ————————————————————————— Décision d'import (pure) ————————————————————————— */

export interface FichierVu {
  /** lastModified du fichier tel qu'importé. */
  m: number
  /** Taille en octets — iCloud touche parfois les dates sans changer le contenu. */
  t: number
}

export interface EntreeDossier {
  nom: string
  lastModified: number
  taille: number
}

const EXTENSIONS = /\.(json|csv|xml|zip)$/i

/**
 * Quels fichiers (ré)importer ? Les nouveaux et les modifiés, du plus ancien
 * au plus récent — l'import écrasant jour par jour, le dernier fichier
 * appliqué doit être le plus frais.
 */
export function fichiersAImporter(
  fichiers: readonly EntreeDossier[],
  vus: Record<string, FichierVu>,
): EntreeDossier[] {
  return fichiers
    .filter((f) => EXTENSIONS.test(f.nom))
    .filter((f) => {
      const vu = vus[f.nom]
      return !vu || vu.m !== f.lastModified || vu.t !== f.taille
    })
    .sort((a, b) => a.lastModified - b.lastModified)
}

/* ———————————————————————————————— Le store ———————————————————————————————— */

export type PhaseSync = 'indisponible' | 'inactif' | 'permission' | 'actif'

interface EtatSync {
  phase: PhaseSync
  dossier?: string
  dernierBalayage?: string
  dernierImport?: string
  erreur?: string

  choisirDossier: () => Promise<void>
  reprendre: () => Promise<void>
  oublier: () => Promise<void>
  balayerMaintenant: () => Promise<void>
}

const CLE_DOSSIER = 'dossier'
const CLE_VUS = 'vus'
const INTERVALLE_MS = 60_000

let poignee: PoigneeDossier | undefined
let minuteur: ReturnType<typeof setInterval> | undefined
let balayageEnCours = false

function heure(): string {
  return new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })
}

async function lireVus(): Promise<Record<string, FichierVu>> {
  try {
    const brut = await lireCle('sync', CLE_VUS)
    return typeof brut === 'object' && brut !== null ? (brut as Record<string, FichierVu>) : {}
  } catch {
    return {}
  }
}

/**
 * La fusion a été refusée parce que la persistance n'est pas prête (conflit
 * entre onglets, erreur d'écriture…). C'est transitoire : le fichier ne doit
 * PAS être marqué « vu », sinon il ne serait plus jamais réimporté.
 */
export class ErreurFusionRefusee extends Error {
  constructor() {
    super('Persistance indisponible : import non appliqué, il sera retenté.')
    this.name = 'ErreurFusionRefusee'
  }
}

/** Importe un fichier selon son extension ; rend un résumé pour le journal. */
export async function importerFichier(fichier: File): Promise<string> {
  const nom = fichier.name.toLowerCase()
  const { fusionner } = storeDonnees.getState()
  const appliquer = (ok: boolean): void => {
    if (!ok) throw new ErreurFusionRefusee()
  }

  if (nom.endsWith('.zip') || nom.endsWith('.xml')) {
    const r = await importerSante(fichier, fichier.name)
    appliquer(fusionner(r.series, r.annotations, r.profil))
    return `${Object.keys(r.series).length} séries`
  }
  if (nom.endsWith('.csv')) {
    const r = importerCsv(await fichier.text())
    appliquer(fusionner(r.series))
    return `${Object.keys(r.series).length} séries`
  }
  // JSON : Health Auto Export ou profil ATHLOS. Une sauvegarde CORPUS déposée
  // là n'est PAS appliquée : la restauration remplace tout, elle exige la
  // confirmation explicite de la fenêtre DONN.
  const brut: unknown = JSON.parse(await fichier.text())
  if (typeof brut === 'object' && brut !== null && 'series' in brut && 'version' in brut) {
    return 'sauvegarde CORPUS ignorée (restauration manuelle uniquement)'
  }
  if (estAutoExport(brut)) {
    const r = importerAutoExport(brut)!
    appliquer(fusionner(r.series, r.annotations))
    return `${Object.keys(r.series).length} séries, ${r.annotations.length} séances`
  }
  const athlos = importerAthlos(brut)
  if (athlos) {
    appliquer(fusionner(athlos.series, athlos.annotations))
    return `profil ATHLOS, ${Object.keys(athlos.series).length} séries`
  }
  return 'JSON non reconnu, ignoré'
}

async function balayer(): Promise<void> {
  if (!poignee || balayageEnCours) return
  balayageEnCours = true
  try {
    const entrees: { meta: EntreeDossier; poignee: PoigneeFichier }[] = []
    for await (const e of poignee.values()) {
      if (e.kind !== 'file') continue
      const f = await e.getFile()
      entrees.push({
        meta: { nom: e.name, lastModified: f.lastModified, taille: f.size },
        poignee: e,
      })
    }

    const vus = await lireVus()
    const aFaire = fichiersAImporter(entrees.map((e) => e.meta), vus)

    let dernierImport: string | undefined
    for (const meta of aFaire) {
      const entree = entrees.find((e) => e.meta.nom === meta.nom)!
      try {
        const resume = await importerFichier(await entree.poignee.getFile())
        dernierImport = `${meta.nom} — ${resume}, ${heure()}`
        storeSync.setState({ erreur: undefined })
      } catch (err) {
        // Fusion refusée : la persistance est bloquée pour tout le balayage,
        // on s'arrête SANS marquer le fichier — il sera retenté plus tard.
        if (err instanceof ErreurFusionRefusee) {
          storeSync.setState({ erreur: err.message })
          break
        }
        // Marqué comme vu malgré l'échec : sans cela le même fichier illisible
        // serait retenté — et échouerait — à chaque balayage.
        storeSync.setState({ erreur: `${meta.nom} : ${(err as Error).message}` })
      }
      vus[meta.nom] = { m: meta.lastModified, t: meta.taille }
    }
    await ecrireCle('sync', CLE_VUS, vus)

    storeSync.setState({
      dernierBalayage: heure(),
      ...(dernierImport ? { dernierImport } : {}),
    })
  } catch (err) {
    storeSync.setState({ erreur: (err as Error).message })
  } finally {
    balayageEnCours = false
  }
}

function activer(p: PoigneeDossier): void {
  poignee = p
  if (minuteur !== undefined) clearInterval(minuteur)
  minuteur = setInterval(() => void balayer(), INTERVALLE_MS)
  storeSync.setState({ phase: 'actif', dossier: p.name, erreur: undefined })
  void balayer()
}

function desactiver(): void {
  poignee = undefined
  if (minuteur !== undefined) clearInterval(minuteur)
  minuteur = undefined
}

export const storeSync = createStore<EtatSync>((set) => ({
  phase: selecteurDossier() ? 'inactif' : 'indisponible',

  choisirDossier: async () => {
    const ouvrir = selecteurDossier()
    if (!ouvrir) return
    try {
      const p = await ouvrir({ id: 'corpus-sync', mode: 'read' })
      await ecrireCle('sync', CLE_DOSSIER, p)
      activer(p)
    } catch (err) {
      // Fermer le sélecteur sans choisir n'est pas une erreur.
      if ((err as Error).name !== 'AbortError') set({ erreur: (err as Error).message })
    }
  },

  reprendre: async () => {
    if (!poignee) return
    try {
      const accord = (await poignee.requestPermission?.({ mode: 'read' })) ?? 'granted'
      if (accord === 'granted') activer(poignee)
      else set({ erreur: 'Lecture refusée par le navigateur.' })
    } catch (err) {
      set({ erreur: (err as Error).message })
    }
  },

  oublier: async () => {
    desactiver()
    await supprimerCle('sync', CLE_DOSSIER)
    await supprimerCle('sync', CLE_VUS)
    set({
      phase: 'inactif',
      dossier: undefined,
      dernierBalayage: undefined,
      dernierImport: undefined,
      erreur: undefined,
    })
  },

  balayerMaintenant: () => balayer(),
}))

/**
 * Au démarrage : si un dossier avait été choisi, on reprend là où on en était.
 * Le navigateur accorde parfois la permission d'office (même profil, session
 * récente) ; sinon on attend le geste « Reprendre » dans DONN.
 */
export async function demarrerSync(): Promise<void> {
  if (!selecteurDossier()) return
  try {
    const brut = await lireCle('sync', CLE_DOSSIER)
    if (!brut) return
    const p = brut as PoigneeDossier
    poignee = p
    const accord = (await p.queryPermission?.({ mode: 'read' })) ?? 'prompt'
    if (accord === 'granted') activer(p)
    else storeSync.setState({ phase: 'permission', dossier: p.name })
  } catch {
    // Poignée illisible (profil nettoyé) : on repart de zéro sans bruit.
  }
}
