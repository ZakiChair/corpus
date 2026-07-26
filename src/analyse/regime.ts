import { definitionMetrique } from '../core/metriques'
import type { Jour } from '../core/temps'
import type { Serie } from '../core/types'
import { zScoreGlissant } from './stats'

/**
 * Régime composite.
 *
 * Chaque métrique de récupération est convertie en z-score face à ses trente
 * derniers jours, ORIENTÉE pour que « plus haut » signifie toujours « mieux
 * récupéré » (la fréquence au repos et les courbatures changent donc de signe),
 * puis moyennée avec un poids.
 *
 * L'intérêt d'un composite plutôt que d'une métrique isolée : une VFC basse un
 * matin donné ne veut pas dire grand-chose, mais une VFC basse ACCOMPAGNÉE
 * d'une fréquence au repos haute et d'un sommeil court dessine un état.
 */

export interface PoidsRegime {
  id: string
  poids: number
  /**
   * Plafond appliqué à la contribution FAVORABLE de cette métrique.
   *
   * L'orientation par `sens` suppose une utilité monotone — « plus haut, mieux
   * c'est » sans limite. C'est faux en haut d'échelle pour la durée de sommeil :
   * dormir deux heures de plus que d'habitude n'est pas un signe de forme, c'est
   * souvent un signe de maladie ou de dette accumulée. Sans ce plafond, un
   * excès de sommeil annule la fréquence au repos élevée qui l'accompagne, et
   * le composite reste tiède pendant les états qu'il devrait justement signaler.
   *
   * Un déficit compte donc plein, un excès compte peu.
   */
  plafond?: number
}

export const METRIQUES_REGIME: readonly PoidsRegime[] = [
  { id: 'vfc', poids: 1.0 },
  { id: 'fc_repos', poids: 0.9 },
  { id: 'sommeil_duree', poids: 0.7, plafond: 0.5 },
  { id: 'energie', poids: 0.6 },
  { id: 'courbatures', poids: 0.5 },
]

export interface Contribution {
  id: string
  /** Z-score déjà orienté : positif = favorable, quelle que soit la métrique. */
  z: number
  poids: number
}

export interface BandeRegime {
  min: number
  label: string
  jeton: string
}

/** Bandes descriptives : on situe l'état, on ne prescrit aucune conduite. */
export const BANDES_REGIME: readonly BandeRegime[] = [
  { min: 1.0, label: 'Nettement au-dessus', jeton: '--c-favorable' },
  { min: 0.35, label: 'Au-dessus', jeton: '--c-serie6' },
  { min: -0.35, label: 'Dans l’habituel', jeton: '--c-attenue' },
  { min: -1.0, label: 'En dessous', jeton: '--c-alerte' },
  { min: -Infinity, label: 'Nettement en dessous', jeton: '--c-defavorable' },
]

export function bandeDuRegime(composite: number): BandeRegime {
  return BANDES_REGIME.find((b) => composite >= b.min) ?? BANDES_REGIME[2]!
}

export interface Regime {
  /** Composite journalier, en unités d'écart-type. */
  serie: Serie
  /** Détail des contributions, pour expliquer une valeur donnée. */
  contributions: Map<Jour, Contribution[]>
}

export interface OptionsRegime {
  fenetre?: number
  /** Métriques minimales renseignées un jour donné pour produire un composite. */
  minimumMetriques?: number
}

export function calculerRegime(
  series: Record<string, Serie | undefined>,
  options: OptionsRegime = {},
): Regime {
  const { fenetre = 30, minimumMetriques = 2 } = options

  // Z-scores orientés, métrique par métrique.
  const parJour = new Map<Jour, Contribution[]>()
  for (const { id, poids, plafond } of METRIQUES_REGIME) {
    const s = series[id]
    if (!s || s.length === 0) continue
    const sens = definitionMetrique(id)?.sens ?? 'neutre'
    if (sens === 'neutre') continue
    const orientation = sens === 'bas' ? -1 : 1
    for (const p of zScoreGlissant(s, fenetre)) {
      const oriente = p.v * orientation
      const z = plafond !== undefined ? Math.min(oriente, plafond) : oriente
      const liste = parJour.get(p.j) ?? []
      liste.push({ id, z, poids })
      parJour.set(p.j, liste)
    }
  }

  const serie: Serie = []
  const contributions = new Map<Jour, Contribution[]>()
  for (const [j, liste] of parJour) {
    if (liste.length < minimumMetriques) continue
    let somme = 0
    let sommePoids = 0
    for (const c of liste) {
      somme += c.z * c.poids
      sommePoids += c.poids
    }
    if (sommePoids === 0) continue
    serie.push({ j, v: somme / sommePoids })
    contributions.set(j, liste)
  }
  serie.sort((a, b) => (a.j < b.j ? -1 : 1))

  return { serie, contributions }
}

/**
 * Contribution la plus éloignée de zéro un jour donné — celle qui « explique »
 * le plus l'état composite. Renvoie undefined si le jour n'a pas de composite.
 */
export function contributionDominante(regime: Regime, j: Jour): Contribution | undefined {
  const liste = regime.contributions.get(j)
  if (!liste || liste.length === 0) return undefined
  return liste.reduce((meilleur, c) =>
    Math.abs(c.z * c.poids) > Math.abs(meilleur.z * meilleur.poids) ? c : meilleur,
  )
}
