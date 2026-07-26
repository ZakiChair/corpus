import type { Serie } from '../core/types'
import { aligner } from './alignement'
import { moyenne } from './stats'

/** Coefficient de Pearson. NaN si l'un des deux vecteurs est constant. */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 3) return Number.NaN
  const mx = moyenne(xs.slice(0, n))
  const my = moyenne(ys.slice(0, n))
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx
    const dy = ys[i]! - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return Number.NaN
  return sxy / Math.sqrt(sxx * syy)
}

/**
 * Rangs moyens (les ex æquo se partagent la moyenne de leurs rangs).
 * Sans ce traitement, une série avec des paliers — un ressenti noté de 1 à 10,
 * par exemple — verrait sa corrélation de rang dépendre de l'ordre de tri.
 */
export function rangs(xs: readonly number[]): number[] {
  const indices = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(xs.length).fill(0)
  let k = 0
  while (k < indices.length) {
    let fin = k
    while (fin + 1 < indices.length && indices[fin + 1]!.v === indices[k]!.v) fin++
    const rangMoyen = (k + fin) / 2 + 1
    for (let m = k; m <= fin; m++) out[indices[m]!.i] = rangMoyen
    k = fin + 1
  }
  return out
}

/**
 * Coefficient de Spearman : Pearson sur les rangs.
 * Robuste aux relations monotones non linéaires et aux valeurs aberrantes,
 * ce qui est la règle sur des données corporelles.
 */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 3) return Number.NaN
  return pearson(rangs(xs.slice(0, n)), rangs(ys.slice(0, n)))
}

export type Methode = 'pearson' | 'spearman'

export interface Correlation {
  r: number
  n: number
  decalage: number
}

/**
 * Corrélation entre `a` et `b`, `a` précédant `b` de `decalage` jours.
 */
export function correlationDecalee(
  a: Serie,
  b: Serie,
  decalage = 0,
  methode: Methode = 'spearman',
): Correlation {
  const { x, y } = aligner(a, b, decalage)
  const r = methode === 'pearson' ? pearson(x, y) : spearman(x, y)
  return { r, n: x.length, decalage }
}

/** Corrélation pour chaque décalage de −max à +max. */
export function profilDecalage(
  a: Serie,
  b: Serie,
  decalageMax = 7,
  methode: Methode = 'spearman',
): Correlation[] {
  const out: Correlation[] = []
  for (let d = -decalageMax; d <= decalageMax; d++) {
    out.push(correlationDecalee(a, b, d, methode))
  }
  return out
}

/**
 * Décalage qui maximise la corrélation en valeur absolue.
 *
 * `minimumPaires` écarte les décalages trop peu appariés : sur des séries
 * courtes, les décalages extrêmes n'ont que quelques paires et produisent des
 * corrélations élevées par pur hasard.
 */
export function meilleurDecalage(
  a: Serie,
  b: Serie,
  decalageMax = 7,
  methode: Methode = 'spearman',
  minimumPaires = 20,
): Correlation | undefined {
  const candidats = profilDecalage(a, b, decalageMax, methode).filter(
    (c) => Number.isFinite(c.r) && c.n >= minimumPaires,
  )
  if (candidats.length === 0) return undefined
  return candidats.reduce((meilleur, c) => (Math.abs(c.r) > Math.abs(meilleur.r) ? c : meilleur))
}

/**
 * Seuil de significativité approché de |r| au risque de 5 %, par
 * l'approximation normale de la transformée de Fisher.
 * Sert uniquement à griser les cases de la matrice qui ne veulent rien dire.
 */
export function seuilSignificativite(n: number): number {
  if (n < 4) return 1
  const z = 1.96 / Math.sqrt(n - 3)
  return Math.tanh(z)
}

export interface MatriceCorrelation {
  ids: string[]
  /** `valeurs[i][j]` : corrélation de ids[i] (avancé de `decalage`) avec ids[j]. */
  valeurs: (number | undefined)[][]
  effectifs: number[][]
  decalage: number
}

export function matriceCorrelation(
  series: Record<string, Serie | undefined>,
  ids: readonly string[],
  decalage = 0,
  methode: Methode = 'spearman',
): MatriceCorrelation {
  const listeIds = [...ids]
  const valeurs: (number | undefined)[][] = []
  const effectifs: number[][] = []
  for (const idA of listeIds) {
    const ligne: (number | undefined)[] = []
    const ligneN: number[] = []
    for (const idB of listeIds) {
      const a = series[idA]
      const b = series[idB]
      if (!a || !b || a.length === 0 || b.length === 0) {
        ligne.push(undefined)
        ligneN.push(0)
        continue
      }
      // La diagonale à décalage nul vaut 1 par construction ; inutile de la calculer.
      if (idA === idB && decalage === 0) {
        ligne.push(1)
        ligneN.push(a.length)
        continue
      }
      const c = correlationDecalee(a, b, decalage, methode)
      ligne.push(Number.isFinite(c.r) ? c.r : undefined)
      ligneN.push(c.n)
    }
    valeurs.push(ligne)
    effectifs.push(ligneN)
  }
  return { ids: listeIds, valeurs, effectifs, decalage }
}
