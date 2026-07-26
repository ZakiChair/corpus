import { jourVersIndex, type Jour } from '../core/temps'
import type { Serie } from '../core/types'
import { ecartType, ema, fenetreGlissante, moyenne, moyenneGlissante } from './stats'

/**
 * Charge d'entraînement.
 *
 * Deux familles d'indicateurs cohabitent dans la littérature et Corpus expose
 * les deux, parce qu'elles ne disent pas la même chose :
 *
 * — Banister (aiguë / chronique / forme) : deux moyennes exponentielles, 7 et
 *   42 jours. Leur différence approxime la « fraîcheur ». C'est un modèle de
 *   réponse impulsionnelle, il suppose que la fatigue décroît exponentiellement.
 *
 * — Gabbett (ratio aigu/chronique) : moyennes glissantes 7 et 28 jours. Cet
 *   indicateur est CONTESTÉ depuis 2019 — plusieurs réanalyses lui reprochent
 *   des artefacts de construction. Corpus l'affiche comme un repère descriptif
 *   (« au-dessus de ton habitude »), jamais comme une consigne.
 */

export const PERIODE_AIGUE = 7
export const PERIODE_CHRONIQUE = 42
export const FENETRE_RATIO_AIGUE = 7
export const FENETRE_RATIO_CHRONIQUE = 28

export interface Charge {
  aigue: Serie
  chronique: Serie
  /** Chronique − aiguë : positif quand la fatigue récente est retombée. */
  forme: Serie
  ratio: Serie
  /**
   * Premier jour où la moyenne chronique a vu assez d'historique pour valoir
   * quelque chose. Avant, elle est encore dominée par son amorçage.
   */
  debutFiable?: Jour
}

/**
 * `serieDense` doit être densifiée à zéro au préalable (cf. `serieAnalyse`) :
 * un jour de repos est une charge nulle, pas une mesure manquante, et une EMA
 * qui saute les jours de repos surestimerait la fatigue d'un facteur deux.
 */
export function calculerCharge(serieDense: Serie): Charge {
  if (serieDense.length === 0) {
    return { aigue: [], chronique: [], forme: [], ratio: [] }
  }

  const aigue = ema(serieDense, PERIODE_AIGUE)
  const chronique = ema(serieDense, PERIODE_CHRONIQUE)

  const chroniqueParJour = new Map<Jour, number>(chronique.map((p) => [p.j, p.v]))
  const forme: Serie = aigue
    .map((p) => {
      const c = chroniqueParJour.get(p.j)
      return c === undefined ? undefined : { j: p.j, v: c - p.v }
    })
    .filter((p): p is { j: Jour; v: number } => p !== undefined)

  const moyAigue = moyenneGlissante(serieDense, FENETRE_RATIO_AIGUE)
  const moyChronique = moyenneGlissante(serieDense, FENETRE_RATIO_CHRONIQUE)
  const chroParJour = new Map<Jour, number>(moyChronique.map((p) => [p.j, p.v]))
  const ratio: Serie = []
  for (const p of moyAigue) {
    const c = chroParJour.get(p.j)
    // Une charge chronique nulle rendrait le ratio infini : on l'omet.
    if (c === undefined || c <= 0) continue
    ratio.push({ j: p.j, v: p.v / c })
  }

  const premier = jourVersIndex(serieDense[0]!.j)
  const debutFiable = serieDense.find(
    (p) => jourVersIndex(p.j) - premier >= PERIODE_CHRONIQUE,
  )?.j

  return { aigue, chronique, forme, ratio, debutFiable }
}

/**
 * Monotonie de Foster : moyenne des charges journalières divisée par leur
 * écart-type, sur une fenêtre glissante. Une valeur élevée signale un
 * entraînement très uniforme, sans alternance entre jours durs et jours faciles.
 */
export function monotonie(serieDense: Serie, fenetre = 7): Serie {
  return fenetreGlissante(
    serieDense,
    fenetre,
    (valeurs) => {
      const et = ecartType(valeurs)
      // Écart-type nul : charge parfaitement constante. La monotonie n'est pas
      // définie, on omet le point plutôt que de renvoyer l'infini.
      if (!Number.isFinite(et) || et === 0) return Number.NaN
      return moyenne(valeurs) / et
    },
    { minimum: Math.min(fenetre, 5) },
  )
}

/** Contrainte de Foster : charge totale de la fenêtre × monotonie. */
export function contrainte(serieDense: Serie, fenetre = 7): Serie {
  return fenetreGlissante(
    serieDense,
    fenetre,
    (valeurs) => {
      const et = ecartType(valeurs)
      if (!Number.isFinite(et) || et === 0) return Number.NaN
      const total = valeurs.reduce((s, v) => s + v, 0)
      return total * (moyenne(valeurs) / et)
    },
    { minimum: Math.min(fenetre, 5) },
  )
}

export interface BandeRatio {
  min: number
  max: number
  label: string
  jeton: string
}

/**
 * Bandes de lecture du ratio, nommées de façon DESCRIPTIVE.
 * Pas de « zone de risque » : Corpus situe, il ne conseille pas.
 */
export const BANDES_RATIO: readonly BandeRatio[] = [
  { min: 0, max: 0.8, label: 'sous ton habitude', jeton: '--c-serie5' },
  { min: 0.8, max: 1.3, label: 'dans ton habitude', jeton: '--c-favorable' },
  { min: 1.3, max: 1.5, label: 'au-dessus', jeton: '--c-alerte' },
  { min: 1.5, max: Infinity, label: 'nettement au-dessus', jeton: '--c-defavorable' },
]

export function bandeDuRatio(ratio: number): BandeRatio {
  return BANDES_RATIO.find((b) => ratio >= b.min && ratio < b.max) ?? BANDES_RATIO[1]!
}

/** Total de charge par semaine calendaire, pour l'histogramme hebdomadaire. */
export function totalParSemaine(serieDense: Serie): Serie {
  if (serieDense.length === 0) return []
  const parSemaine = new Map<number, { total: number; premierJour: Jour }>()
  for (const p of serieDense) {
    // Semaine ISO approchée : l'index de jour divisé par sept, décalé pour que
    // la coupure tombe un lundi (le 1ᵉʳ janvier 1970 était un jeudi).
    const semaine = Math.floor((jourVersIndex(p.j) + 3) / 7)
    const existant = parSemaine.get(semaine)
    if (existant) existant.total += p.v
    else parSemaine.set(semaine, { total: p.v, premierJour: p.j })
  }
  return [...parSemaine.values()]
    .map((s) => ({ j: s.premierJour, v: s.total }))
    .sort((a, b) => (a.j < b.j ? -1 : 1))
}
