import type { Serie } from '../core/types'
import { aligner, alignerAvecIndex, indexerParJour } from './alignement'
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
  // Tri d'indices plutôt que d'objets {v, i} : la matrice appelle rangs des
  // centaines de fois par recalcul, l'allocation d'un objet par point pesait.
  const indices = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!)
  const out = new Array<number>(xs.length).fill(0)
  let k = 0
  while (k < indices.length) {
    let fin = k
    while (fin + 1 < indices.length && xs[indices[fin + 1]!] === xs[indices[k]!]) fin++
    const rangMoyen = (k + fin) / 2 + 1
    for (let m = k; m <= fin; m++) out[indices[m]!] = rangMoyen
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
  /**
   * Nombre d'observations réellement indépendantes (≤ n). Les séries
   * physiologiques quotidiennes sont fortement autocorrélées — le poids d'un
   * jour ressemble à celui de la veille — et c'est CE nombre, pas le décompte
   * de paires, qui doit nourrir un seuil de significativité.
   */
  nEffectif: number
  decalage: number
}

/** Autocorrélation lag-1 : Pearson entre v[t] et v[t+1]. */
function autocorrelation1(xs: readonly number[]): number {
  return pearson(xs.slice(0, -1), xs.slice(1))
}

/**
 * Taille d'échantillon effective de deux vecteurs appariés, par la correction
 * de Bartlett/Bretherton : n · (1 − r₁ᵃr₁ᵇ) / (1 + r₁ᵃr₁ᵇ). Deux tendances
 * pures (r₁ ≈ 1 chacune) ne portent presque aucune information indépendante ;
 * deux bruits blancs gardent leur n.
 */
export function nEffectif(x: readonly number[], y: readonly number[]): number {
  const n = Math.min(x.length, y.length)
  const phi = autocorrelation1(x) * autocorrelation1(y)
  if (!Number.isFinite(phi) || phi <= 0) return n
  return Math.min(n, Math.round((n * (1 - phi)) / (1 + phi)))
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
  return { r, n: x.length, nEffectif: nEffectif(x, y), decalage }
}

/** Corrélation pour chaque décalage de −max à +max. */
export function profilDecalage(
  a: Serie,
  b: Serie,
  decalageMax = 7,
  methode: Methode = 'spearman',
): Correlation[] {
  // L'index de `b` ne dépend pas du décalage : le construire une fois évite
  // de refaire ~15 fois la même Map de 1800 entrées par paire de métriques.
  const indexB = indexerParJour(b)
  const out: Correlation[] = []
  for (let d = -decalageMax; d <= decalageMax; d++) {
    const { x, y } = alignerAvecIndex(a, indexB, d)
    const r = methode === 'pearson' ? pearson(x, y) : spearman(x, y)
    out.push({ r, n: x.length, nEffectif: nEffectif(x, y), decalage: d })
  }
  return out
}

/**
 * Marge dont un pic doit dépasser la corrélation contemporaine pour qu'on
 * accepte de parler de décalage.
 */
export const MARGE_PIC = 0.04

/**
 * Décalage qui maximise la corrélation en valeur absolue.
 *
 * `minimumPaires` écarte les décalages trop peu appariés : sur des séries
 * courtes, les décalages extrêmes n'ont que quelques paires et produisent des
 * corrélations élevées par pur hasard.
 *
 * `margePic` protège d'une illusion beaucoup plus insidieuse. Deux séries à
 * forte tendance — le poids et la masse grasse pendant une sèche — corrèlent
 * à 0,95 à TOUS les décalages. Prendre l'argmax d'un profil plat revient alors
 * à tirer au sort, puis à présenter le tirage comme une découverte : « le poids
 * précède la masse grasse de 4 jours ». On n'annonce donc un décalage que si
 * son pic dépasse nettement la valeur contemporaine ; sinon on rend le
 * décalage nul, qui est la lecture honnête.
 */
export function meilleurDecalage(
  a: Serie,
  b: Serie,
  decalageMax = 7,
  methode: Methode = 'spearman',
  minimumPaires = 20,
  margePic = MARGE_PIC,
): Correlation | undefined {
  const profil = profilDecalage(a, b, decalageMax, methode)
  const candidats = profil.filter((c) => Number.isFinite(c.r) && c.n >= minimumPaires)
  if (candidats.length === 0) return undefined

  const meilleur = candidats.reduce((m, c) => (Math.abs(c.r) > Math.abs(m.r) ? c : m))
  if (meilleur.decalage === 0) return meilleur

  const contemporain = candidats.find((c) => c.decalage === 0)
  if (!contemporain) return meilleur
  return Math.abs(meilleur.r) - Math.abs(contemporain.r) < margePic ? contemporain : meilleur
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
  /** Effectifs corrigés de l'autocorrélation — pour les seuils, pas l'affichage. */
  nEffectifs: number[][]
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
  const nEffectifs: number[][] = []
  for (const idA of listeIds) {
    const ligne: (number | undefined)[] = []
    const ligneN: number[] = []
    const ligneNEff: number[] = []
    for (const idB of listeIds) {
      const a = series[idA]
      const b = series[idB]
      if (!a || !b || a.length === 0 || b.length === 0) {
        ligne.push(undefined)
        ligneN.push(0)
        ligneNEff.push(0)
        continue
      }
      // La diagonale à décalage nul vaut 1 par construction ; inutile de la calculer.
      if (idA === idB && decalage === 0) {
        ligne.push(1)
        ligneN.push(a.length)
        ligneNEff.push(a.length)
        continue
      }
      const c = correlationDecalee(a, b, decalage, methode)
      ligne.push(Number.isFinite(c.r) ? c.r : undefined)
      ligneN.push(c.n)
      ligneNEff.push(c.nEffectif)
    }
    valeurs.push(ligne)
    effectifs.push(ligneN)
    nEffectifs.push(ligneNEff)
  }
  return { ids: listeIds, valeurs, effectifs, nEffectifs, decalage }
}
