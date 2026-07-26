import { createStore } from 'zustand/vanilla'
import { genererHistorique } from '../donnees/generateur'
import { stockage } from './stockage'
import { aujourdhui, type Jour } from './temps'
import {
  etatVide,
  normaliserEtat,
  poserPoint,
  retirerPoint,
  type Annotation,
  type EtatCorpus,
  type Profil,
  type Serie,
  type TypeAnnotation,
} from './types'

/**
 * Store des données corporelles.
 *
 * Zustand en version « vanilla » plutôt que le hook React : le store est lu
 * depuis des fonctions pures et des effets hors composants (l'enregistrement
 * différé, notamment), et React s'y abonne explicitement via `useStore`.
 */

interface EtatStore {
  etat: EtatCorpus
  /** Faux tant que le stockage n'a pas répondu : évite d'écraser des données. */
  hydrate: boolean
  /** Vrai quand rien n'a encore été saisi ni importé ni généré. */
  vide: boolean

  hydrater: () => Promise<void>
  remplacer: (etat: EtatCorpus) => void
  poserMesure: (id: string, j: Jour, v: number) => void
  retirerMesure: (id: string, j: Jour) => void
  ajouterAnnotation: (a: Omit<Annotation, 'id'>) => void
  supprimerAnnotation: (id: string) => void
  fusionner: (
    series: Record<string, Serie>,
    annotations?: Annotation[],
    profil?: Partial<Profil>,
  ) => void
  genererDemonstration: (jours?: number) => void
  reinitialiser: () => void
}

function estVide(etat: EtatCorpus): boolean {
  return (
    etat.annotations.length === 0 &&
    Object.values(etat.series).every((s) => !s || s.length === 0)
  )
}

let minuteur: ReturnType<typeof setTimeout> | undefined
let etatEnAttente: EtatCorpus | undefined

/**
 * Enregistrement différé : la saisie d'un curseur peut produire des dizaines
 * de mutations par seconde, une écriture IndexedDB par frappe serait absurde.
 */
function enregistrerPlusTard(etat: EtatCorpus): void {
  if (minuteur !== undefined) clearTimeout(minuteur)
  etatEnAttente = etat
  minuteur = setTimeout(() => {
    minuteur = undefined
    etatEnAttente = undefined
    void stockage.enregistrer(etat)
  }, 400)
}

/** Annule une écriture différée encore armée, sans l'exécuter. */
function annulerEcritureEnAttente(): void {
  if (minuteur !== undefined) clearTimeout(minuteur)
  minuteur = undefined
  etatEnAttente = undefined
}

/**
 * Écrit immédiatement ce qui attendait son délai. Sans cela, saisir une valeur
 * puis fermer l'onglet dans les 400 ms perdrait l'écriture.
 */
export function purgerEcritureEnAttente(): void {
  const etat = etatEnAttente
  annulerEcritureEnAttente()
  if (etat) void stockage.enregistrer(etat)
}

if (typeof window !== 'undefined') {
  // `pagehide` couvre la fermeture et la navigation ; `visibilitychange`
  // couvre l'onglet mis en arrière-plan, seul signal fiable sur mobile.
  window.addEventListener('pagehide', purgerEcritureEnAttente)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') purgerEcritureEnAttente()
  })
}

function muter(
  set: (partiel: Partial<EtatStore>) => void,
  get: () => EtatStore,
  transformation: (etat: EtatCorpus) => EtatCorpus,
): void {
  const suivant = transformation(get().etat)
  set({ etat: suivant, vide: estVide(suivant) })
  enregistrerPlusTard(suivant)
}

export const storeDonnees = createStore<EtatStore>((set, get) => ({
  etat: etatVide(aujourdhui()),
  hydrate: false,
  vide: true,

  hydrater: async () => {
    const charge = await stockage.charger()
    const etat = charge ?? etatVide(aujourdhui())
    set({ etat, hydrate: true, vide: estVide(etat) })
  },

  remplacer: (etat) => {
    const normalise = normaliserEtat(etat)
    set({ etat: normalise, vide: estVide(normalise) })
    enregistrerPlusTard(normalise)
  },

  poserMesure: (id, j, v) =>
    muter(set, get, (etat) => ({
      ...etat,
      series: { ...etat.series, [id]: poserPoint(etat.series[id] ?? [], j, v) },
    })),

  retirerMesure: (id, j) =>
    muter(set, get, (etat) => ({
      ...etat,
      series: { ...etat.series, [id]: retirerPoint(etat.series[id] ?? [], j) },
    })),

  ajouterAnnotation: (a) =>
    muter(set, get, (etat) => ({
      ...etat,
      annotations: [
        ...etat.annotations,
        { ...a, id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
      ].sort((x, y) => (x.j < y.j ? -1 : 1)),
    })),

  supprimerAnnotation: (id) =>
    muter(set, get, (etat) => ({
      ...etat,
      annotations: etat.annotations.filter((a) => a.id !== id),
    })),

  fusionner: (series, annotations = [], profil) =>
    muter(set, get, (etat) => {
      const fusion: Record<string, Serie> = { ...etat.series }
      for (const [id, serie] of Object.entries(series)) {
        let cible = fusion[id] ?? []
        // Point à point : l'import écrase le jour existant plutôt que de le
        // dupliquer, ce qui rend un même fichier réimportable sans dégât.
        for (const p of serie) cible = poserPoint(cible, p.j, p.v)
        fusion[id] = cible
      }
      const connues = new Set(etat.annotations.map((a) => `${a.j}|${a.type}`))
      const nouvelles = annotations.filter((a) => !connues.has(`${a.j}|${a.type}`))
      return {
        ...etat,
        series: fusion,
        annotations: [...etat.annotations, ...nouvelles].sort((x, y) => (x.j < y.j ? -1 : 1)),
        // Le profil importé complète, il n'écrase pas : une valeur déjà saisie
        // à la main est plus sûre qu'une valeur devinée dans un export.
        profil: { ...profil, ...etat.profil },
      }
    }),

  genererDemonstration: (jours = 540) => {
    const etat = genererHistorique({ jours })
    set({ etat, vide: false })
    enregistrerPlusTard(etat)
  },

  reinitialiser: () => {
    // Un enregistrement différé encore armé ré-écrirait l'ancien état APRÈS
    // l'effacement : on le désamorce d'abord.
    annulerEcritureEnAttente()
    const etat = etatVide(aujourdhui())
    set({ etat, vide: true })
    void stockage.effacer()
  },
}))

/** Types d'annotations proposés dans les formulaires. */
export const TYPES_SAISISSABLES: readonly TypeAnnotation[] = [
  'seance',
  'alcool',
  'voyage',
  'maladie',
  'stress',
  'blessure',
  'autre',
]
