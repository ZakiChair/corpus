import { jourDeSemaine, jourVersIndex } from '../core/temps'
import type { Serie } from '../core/types'
import { ecartAbsoluMedian, mediane } from './stats'

/**
 * Saisonnalité hebdomadaire.
 *
 * « Ma valeur est-elle basse dans l'absolu, ou basse POUR UN LUNDI ? » — le
 * coucher du vendredi n'est pas celui du mardi, et un z-score aveugle au jour
 * de semaine prend le rythme hebdomadaire pour une anomalie.
 *
 * Statistiques robustes (médiane, écart absolu médian) : chaque jour de
 * semaine n'a qu'une observation par semaine, donc une vingtaine de points sur
 * la fenêtre — une seule valeur aberrante ruinerait moyenne et écart-type.
 */

export interface ProfilJour {
  /** 0 = lundi … 6 = dimanche. */
  jourSemaine: number
  mediane: number
  /** Écart absolu médian remis à l'échelle gaussienne ; NaN si trop peu de points. */
  dispersion: number
  n: number
}

export interface OptionsSaisonnalite {
  /** Fenêtre calendaire, en jours, à partir du dernier point de la série. */
  fenetreJours?: number
  /** Observations minimales d'un jour de semaine pour publier sa statistique. */
  minimumParJour?: number
}

/** Valeurs des `fenetreJours` derniers jours, groupées par jour de semaine. */
function grouperParJourSemaine(
  serie: Serie,
  fenetreJours: number,
  exclureDernier: boolean,
): number[][] {
  const groupes: number[][] = Array.from({ length: 7 }, () => [])
  if (serie.length === 0) return groupes
  const fin = jourVersIndex(serie[serie.length - 1]!.j)
  const borne = exclureDernier ? serie.length - 1 : serie.length
  for (let i = 0; i < borne; i++) {
    const p = serie[i]!
    if (jourVersIndex(p.j) < fin - fenetreJours + 1) continue
    groupes[jourDeSemaine(p.j)]!.push(p.v)
  }
  return groupes
}

export function profilHebdomadaire(
  serie: Serie,
  options: OptionsSaisonnalite = {},
): ProfilJour[] {
  const { fenetreJours = 180, minimumParJour = 4 } = options
  const groupes = grouperParJourSemaine(serie, fenetreJours, false)
  return groupes.map((valeurs, jourSemaine) => ({
    jourSemaine,
    mediane: valeurs.length >= minimumParJour ? mediane(valeurs) : Number.NaN,
    dispersion: valeurs.length >= minimumParJour ? ecartAbsoluMedian(valeurs) : Number.NaN,
    n: valeurs.length,
  }))
}

export interface EcartConditionnel {
  /** Z robuste du dernier point face aux MÊMES jours de semaine. */
  z: number
  jourSemaine: number
  n: number
}

/**
 * Z-score du dernier point conditionné à son jour de semaine : l'écart à la
 * médiane des lundis précédents, en unités de leur dispersion. Le dernier
 * point est exclu de sa propre référence, comme partout ailleurs.
 */
export function zConditionnel(
  serie: Serie,
  options: OptionsSaisonnalite = {},
): EcartConditionnel | undefined {
  const { fenetreJours = 180, minimumParJour = 6 } = options
  const dernier = serie[serie.length - 1]
  if (!dernier) return undefined
  const jourSemaine = jourDeSemaine(dernier.j)
  const reference = grouperParJourSemaine(serie, fenetreJours, true)[jourSemaine]!
  if (reference.length < minimumParJour) return undefined
  const dispersion = ecartAbsoluMedian(reference)
  if (!Number.isFinite(dispersion) || dispersion === 0) return undefined
  return {
    z: (dernier.v - mediane(reference)) / dispersion,
    jourSemaine,
    n: reference.length,
  }
}
