import { jourVersIndex, indexVersJour, type Jour } from '../core/temps'
import type { Point, Serie } from '../core/types'

/* ————————————————————————————— Agrégats simples ————————————————————————————— */

export function moyenne(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/**
 * Écart-type. Par défaut sur un échantillon (dénominateur n − 1) : nos séries
 * sont toujours un échantillon d'un processus continu, jamais la population.
 */
export function ecartType(xs: readonly number[], population = false): number {
  const n = xs.length
  if (n === 0) return Number.NaN
  if (n === 1) return population ? 0 : Number.NaN
  const m = moyenne(xs)
  let s = 0
  for (const x of xs) s += (x - m) * (x - m)
  return Math.sqrt(s / (population ? n : n - 1))
}

/** Quantile par interpolation linéaire entre les rangs encadrants. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return Number.NaN
  const tri = [...xs].sort((a, b) => a - b)
  if (tri.length === 1) return tri[0]!
  const qc = Math.min(1, Math.max(0, q))
  const pos = qc * (tri.length - 1)
  const bas = Math.floor(pos)
  const haut = Math.ceil(pos)
  if (bas === haut) return tri[bas]!
  return tri[bas]! + (tri[haut]! - tri[bas]!) * (pos - bas)
}

export function mediane(xs: readonly number[]): number {
  return quantile(xs, 0.5)
}

/**
 * Écart absolu médian, remis à l'échelle d'un écart-type gaussien (×1,4826).
 * Robuste aux valeurs aberrantes — un unique poids saisi en livres ne fait pas
 * exploser la dispersion comme il le ferait avec l'écart-type.
 */
export function ecartAbsoluMedian(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN
  const med = mediane(xs)
  return 1.4826 * mediane(xs.map((x) => Math.abs(x - med)))
}

/** Fraction des observations inférieures ou égales à `x`, dans [0, 1]. */
export function rangPercentile(xs: readonly number[], x: number): number {
  if (xs.length === 0) return Number.NaN
  let n = 0
  for (const v of xs) if (v <= x) n++
  return n / xs.length
}

export function zScore(x: number, reference: readonly number[]): number {
  const et = ecartType(reference)
  if (!Number.isFinite(et) || et === 0) return Number.NaN
  return (x - moyenne(reference)) / et
}

export function bornes(xs: readonly number[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const x of xs) {
    if (x < min) min = x
    if (x > max) max = x
  }
  return xs.length === 0 ? { min: Number.NaN, max: Number.NaN } : { min, max }
}

export interface Regression {
  pente: number
  ordonnee: number
  r2: number
}

/** Moindres carrés ordinaires de y sur x. */
export function regressionLineaire(
  xs: readonly number[],
  ys: readonly number[],
): Regression {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return { pente: Number.NaN, ordonnee: Number.NaN, r2: Number.NaN }
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
  if (sxx === 0) return { pente: Number.NaN, ordonnee: Number.NaN, r2: Number.NaN }
  const pente = sxy / sxx
  return {
    pente,
    ordonnee: my - pente * mx,
    r2: syy === 0 ? Number.NaN : (sxy * sxy) / (sxx * syy),
  }
}

/**
 * Pente d'une série, exprimée par unité de temps (par jour).
 * L'axe des abscisses est l'index de jour, pas l'index dans le tableau : une
 * série trouée ne voit pas sa tendance déformée par ses lacunes.
 */
export function penteParJour(serie: Serie): number {
  if (serie.length < 2) return Number.NaN
  const xs = serie.map((p) => jourVersIndex(p.j))
  const ys = serie.map((p) => p.v)
  return regressionLineaire(xs, ys).pente
}

/* ———————————————————————— Fenêtres glissantes calendaires ———————————————————————— */

/**
 * Applique `calc` sur une fenêtre glissante CALENDAIRE de `jours` jours.
 *
 * La fenêtre est bornée en jours, pas en nombre de points : sur une série
 * trouée, une fenêtre indicielle de 30 points pourrait couvrir trois mois.
 *
 * `inclureJour` décide si le jour courant appartient à sa propre fenêtre de
 * référence. Pour un z-score on veut `false` — on mesure l'écart d'aujourd'hui
 * à une ligne de base construite sur le passé, l'inclure amortirait justement
 * l'anomalie recherchée. Pour un lissage on veut `true`.
 */
export function fenetreGlissante(
  serie: Serie,
  jours: number,
  calc: (valeurs: number[]) => number,
  options: { inclureJour?: boolean; minimum?: number } = {},
): Serie {
  const { inclureJour = true, minimum = 1 } = options
  const idx = serie.map((p) => jourVersIndex(p.j))
  const sortie: Serie = []
  let debut = 0
  for (let i = 0; i < serie.length; i++) {
    const iCourant = idx[i]!
    const seuil = iCourant - jours + (inclureJour ? 1 : 0)
    while (debut < i && idx[debut]! < seuil) debut++
    const fin = inclureJour ? i + 1 : i
    if (fin - debut < minimum) continue
    const valeurs: number[] = []
    for (let k = debut; k < fin; k++) valeurs.push(serie[k]!.v)
    const v = calc(valeurs)
    if (Number.isFinite(v)) sortie.push({ j: serie[i]!.j, v })
  }
  return sortie
}

export function moyenneGlissante(serie: Serie, jours: number): Serie {
  return fenetreGlissante(serie, jours, moyenne)
}

export function medianeGlissante(serie: Serie, jours: number): Serie {
  return fenetreGlissante(serie, jours, mediane)
}

/**
 * Z-score de chaque point face aux `jours` jours qui le PRÉCÈDENT.
 * `minimum` points sont exigés dans la fenêtre, sans quoi le point est omis :
 * un z calculé sur trois observations n'a pas de sens.
 */
export function zScoreGlissant(serie: Serie, jours: number, minimum = 7): Serie {
  const idx = serie.map((p) => jourVersIndex(p.j))
  const sortie: Serie = []
  let debut = 0
  for (let i = 0; i < serie.length; i++) {
    const seuil = idx[i]! - jours
    while (debut < i && idx[debut]! < seuil) debut++
    if (i - debut < minimum) continue
    const reference: number[] = []
    for (let k = debut; k < i; k++) reference.push(serie[k]!.v)
    const z = zScore(serie[i]!.v, reference)
    if (Number.isFinite(z)) sortie.push({ j: serie[i]!.j, v: z })
  }
  return sortie
}

/**
 * Lissage exponentiel de constante de temps `tau`, sur des points CONSÉCUTIFS.
 *
 * Le facteur vaut 1/tau, et non 2/(tau+1). La distinction n'est pas cosmétique :
 * 2/(n+1) est la convention des moyennes mobiles FINANCIÈRES, tandis que la
 * physiologie de l'entraînement (Banister, puis TrainingPeaks) définit la
 * fatigue par `aujourd'hui += (charge − aujourd'hui) / tau`. Pour tau = 7 cela
 * fait 0,143 contre 0,25 : la version financière réagit presque deux fois plus
 * vite et produirait une charge aiguë en dents de scie. Les deux s'appellent
 * « EMA », d'où le piège en transposant un outil d'un domaine à l'autre.
 *
 * Pour une série trouée, densifier d'abord (cf. `densifier`) : un jour sans
 * séance vaut zéro, pas « absent ».
 */
export function lissageExponentiel(serie: Serie, tau: number): Serie {
  if (serie.length === 0 || tau <= 0) return []
  const alpha = 1 / tau
  const sortie: Serie = []
  let courant = serie[0]!.v
  sortie.push({ j: serie[0]!.j, v: courant })
  for (let i = 1; i < serie.length; i++) {
    courant = alpha * serie[i]!.v + (1 - alpha) * courant
    sortie.push({ j: serie[i]!.j, v: courant })
  }
  return sortie
}

/**
 * Complète les jours manquants entre `debut` et `fin` par `valeurDefaut`.
 * Sans bornes explicites, on prend celles de la série.
 */
export function densifier(
  serie: Serie,
  valeurDefaut: number,
  debut?: Jour,
  fin?: Jour,
): Serie {
  if (serie.length === 0) return []
  const parJour = new Map<Jour, number>(serie.map((p) => [p.j, p.v]))
  const i0 = jourVersIndex(debut ?? serie[0]!.j)
  const i1 = jourVersIndex(fin ?? serie[serie.length - 1]!.j)
  const sortie: Serie = []
  for (let i = i0; i <= i1; i++) {
    const j = indexVersJour(i)
    sortie.push({ j, v: parJour.get(j) ?? valeurDefaut })
  }
  return sortie
}

/** Restreint une série aux `jours` derniers jours à partir de son dernier point. */
export function derniersJours(serie: Serie, jours: number): Serie {
  if (serie.length === 0) return []
  const seuil = jourVersIndex(serie[serie.length - 1]!.j) - jours + 1
  return serie.filter((p) => jourVersIndex(p.j) >= seuil)
}

export function dernierPoint(serie: Serie): Point | undefined {
  return serie.length === 0 ? undefined : serie[serie.length - 1]
}

export function valeurAuJour(serie: Serie, j: Jour): number | undefined {
  // Les séries sont triées : recherche dichotomique.
  let bas = 0
  let haut = serie.length - 1
  while (bas <= haut) {
    const milieu = (bas + haut) >> 1
    const cible = serie[milieu]!.j
    if (cible === j) return serie[milieu]!.v
    if (cible < j) bas = milieu + 1
    else haut = milieu - 1
  }
  return undefined
}
