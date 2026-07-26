import { decalerJour, type Jour } from '../core/temps'
import type { Serie } from '../core/types'

export interface Appariement {
  x: number[]
  y: number[]
  /** Jour du point de `a` retenu dans chaque paire. */
  jours: Jour[]
}

/**
 * Apparie deux séries sur les jours qu'elles partagent.
 *
 * `decalage` se lit « a précède b de d jours » : le point de `a` au jour J est
 * apparié au point de `b` au jour J + d. Un décalage positif teste donc
 * l'hypothèse que `a` est la cause et `b` la conséquence.
 *
 * L'appariement est une INTERSECTION, jamais une interpolation : combler un
 * trou par une valeur inventée gonflerait artificiellement la corrélation.
 */
export function aligner(a: Serie, b: Serie, decalage = 0): Appariement {
  const indexB = new Map<Jour, number>()
  for (const p of b) indexB.set(p.j, p.v)

  const x: number[] = []
  const y: number[] = []
  const jours: Jour[] = []
  for (const p of a) {
    const cible = decalage === 0 ? p.j : decalerJour(p.j, decalage)
    const vb = indexB.get(cible)
    if (vb === undefined) continue
    x.push(p.v)
    y.push(vb)
    jours.push(p.j)
  }
  return { x, y, jours }
}

/** Jours communs à toutes les séries fournies. */
export function joursCommuns(series: readonly Serie[]): Jour[] {
  if (series.length === 0) return []
  const premiere = series[0]!
  let ensemble = new Set(premiere.map((p) => p.j))
  for (let i = 1; i < series.length; i++) {
    const autre = new Set(series[i]!.map((p) => p.j))
    ensemble = new Set([...ensemble].filter((j) => autre.has(j)))
  }
  return [...ensemble].sort()
}
