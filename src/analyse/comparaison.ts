import { creerAlea, type Alea } from '../donnees/alea'
import { decalerJour, type Jour } from '../core/temps'
import type { Serie } from '../core/types'
import { mediane, quantile } from './stats'

/**
 * Comparaison de deux périodes.
 *
 * « Ce bloc de quatre semaines vs le précédent » : écart des médianes, avec un
 * intervalle de confiance bootstrap — sans lui, n'importe quel couple de
 * périodes montre un écart, et on se raconte l'histoire qu'on veut.
 *
 * Le bootstrap est amorcé par une graine fixe (cf. `creerAlea`) : le même état
 * de données rend toujours le même intervalle, à l'écran comme dans les tests.
 */

export interface ComparaisonPeriode {
  medianeAncienne: number
  medianeRecente: number
  /** Récente − ancienne, en unité de la métrique. */
  delta: number
  /** Intervalle de confiance à 95 % sur cet écart (bootstrap des médianes). */
  icBas: number
  icHaut: number
  nAncienne: number
  nRecente: number
  /** Vrai quand l'intervalle exclut zéro. */
  significatif: boolean
}

const NB_REECHANTILLONS = 500

function valeursEntre(serie: Serie, debut: Jour, fin: Jour): number[] {
  return serie.filter((p) => p.j >= debut && p.j <= fin).map((p) => p.v)
}

function medianeReechantillonnee(valeurs: readonly number[], alea: Alea): number {
  const tirage: number[] = []
  for (let i = 0; i < valeurs.length; i++) {
    tirage.push(valeurs[Math.floor(alea() * valeurs.length)]!)
  }
  return mediane(tirage)
}

export interface Periode {
  debut: Jour
  fin: Jour
}

export function comparerPeriodes(
  serie: Serie,
  ancienne: Periode,
  recente: Periode,
  graine = 20260726,
): ComparaisonPeriode | undefined {
  const a = valeursEntre(serie, ancienne.debut, ancienne.fin)
  const b = valeursEntre(serie, recente.debut, recente.fin)
  // Cinq points par période : en deçà, une médiane bootstrap n'a pas de sens.
  if (a.length < 5 || b.length < 5) return undefined

  const alea = creerAlea(graine)
  const deltas: number[] = []
  for (let k = 0; k < NB_REECHANTILLONS; k++) {
    deltas.push(medianeReechantillonnee(b, alea) - medianeReechantillonnee(a, alea))
  }
  const icBas = quantile(deltas, 0.025)
  const icHaut = quantile(deltas, 0.975)

  return {
    medianeAncienne: mediane(a),
    medianeRecente: mediane(b),
    delta: mediane(b) - mediane(a),
    icBas,
    icHaut,
    nAncienne: a.length,
    nRecente: b.length,
    significatif: icBas > 0 || icHaut < 0,
  }
}

/**
 * Deux fenêtres adjacentes de `jours` jours s'achevant à `fin` : la récente
 * colle à `fin`, l'ancienne la précède immédiatement.
 */
export function fenetresAdjacentes(fin: Jour, jours: number): { ancienne: Periode; recente: Periode } {
  const debutRecente = decalerJour(fin, -(jours - 1))
  const finAncienne = decalerJour(debutRecente, -1)
  return {
    recente: { debut: debutRecente, fin },
    ancienne: { debut: decalerJour(finAncienne, -(jours - 1)), fin: finAncienne },
  }
}
