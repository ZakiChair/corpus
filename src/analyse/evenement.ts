import { decalerJour, jourVersIndex, type Jour } from '../core/temps'
import type { Serie } from '../core/types'
import { ecartType, moyenne, valeurAuJour } from './stats'

/**
 * Étude d'événement, transposée de la finance.
 *
 * On empile les fenêtres [−avant, +après] autour de chaque occurrence d'un
 * événement, puis on moyenne. Le point clé est la NORMALISATION par une ligne
 * de base propre à chaque occurrence : sans elle, une soirée arrosée en janvier
 * (VFC de base 68 ms) et une en juillet (VFC de base 55 ms) mélangeraient
 * l'effet cherché avec la dérive saisonnière. En retranchant à chaque fenêtre
 * la moyenne de ses jours précédant l'événement, il ne reste que l'écart.
 */

export interface ReponseEvenement {
  /** Décalages étudiés, de −avant à +après. */
  decalages: number[]
  /** Écart moyen à la ligne de base, dans l'unité de la métrique. */
  moyenne: (number | undefined)[]
  /** Demi-largeur de l'intervalle de confiance à 95 %. */
  demiIC: (number | undefined)[]
  /** Nombre d'occurrences disposant d'une mesure à ce décalage. */
  effectifs: number[]
  /** Occurrences effectivement retenues (celles ayant une ligne de base). */
  nEvenements: number
  /** Occurrences écartées faute de mesures avant l'événement. */
  nEcartes: number
  /**
   * Occurrences dont la ligne de base contient des jours encore sous l'effet
   * d'une autre occurrence (événements trop rapprochés pour faire mieux).
   */
  nContamines: number
}

export interface OptionsEtude {
  avant?: number
  apres?: number
  /** Mesures minimales dans la fenêtre antérieure pour établir la ligne de base. */
  minimumBase?: number
  /**
   * Quarantaine : un jour de ligne de base situé à moins de ce nombre de jours
   * APRÈS une autre occurrence porte encore l'effet de celle-ci — pour des
   * séances trois fois par semaine, la « base » d'une séance est faite des
   * lendemains des précédentes, et l'effet mesuré s'auto-annule. Ces jours
   * sont exclus de la base. Quand il ne reste rien de propre (occurrences trop
   * denses), on se replie sur la base contaminée et on le SIGNALE via
   * `nContamines` plutôt que d'écarter l'occurrence.
   */
  exclusionApresAutre?: number
}

export function etudeEvenement(
  serie: Serie,
  joursEvenement: readonly Jour[],
  options: OptionsEtude = {},
): ReponseEvenement {
  const { avant = 3, apres = 7, minimumBase = 2, exclusionApresAutre = 2 } = options
  const decalages: number[] = []
  for (let d = -avant; d <= apres; d++) decalages.push(d)

  // Deux annotations du même type le même jour (séance matin + soir) ne font
  // qu'une occurrence : les compter deux fois pousserait deux fois les mêmes
  // écarts dans chaque seau et resserrerait l'intervalle sans information
  // nouvelle (pseudo-réplication).
  const occurrences = [...new Set(joursEvenement)]

  // Jours encore sous l'influence d'une occurrence : le jour même et les
  // `exclusionApresAutre` jours qui suivent. Comme la ligne de base d'un
  // événement est strictement antérieure à lui, il ne se met jamais lui-même
  // en quarantaine.
  const quarantaine = new Set<number>()
  for (const e of occurrences) {
    const i0 = jourVersIndex(e)
    for (let d = 0; d <= exclusionApresAutre; d++) quarantaine.add(i0 + d)
  }

  const seaux = decalages.map<number[]>(() => [])
  let nEvenements = 0
  let nEcartes = 0
  let nContamines = 0

  for (const e of occurrences) {
    // Ligne de base : les jours qui PRÉCÈDENT strictement l'événement.
    const base: number[] = []
    const baseAvecContamines: number[] = []
    for (let d = -avant; d <= -1; d++) {
      const jourBase = decalerJour(e, d)
      const v = valeurAuJour(serie, jourBase)
      if (v === undefined) continue
      baseAvecContamines.push(v)
      if (!quarantaine.has(jourVersIndex(jourBase))) base.push(v)
    }
    let retenue = base
    if (retenue.length < minimumBase && baseAvecContamines.length > base.length) {
      retenue = baseAvecContamines
      if (retenue.length >= minimumBase) nContamines++
    }
    if (retenue.length < minimumBase) {
      nEcartes++
      continue
    }
    const niveauBase = moyenne(retenue)
    nEvenements++
    for (let k = 0; k < decalages.length; k++) {
      const v = valeurAuJour(serie, decalerJour(e, decalages[k]!))
      if (v !== undefined) seaux[k]!.push(v - niveauBase)
    }
  }

  const moyennes: (number | undefined)[] = []
  const demiIC: (number | undefined)[] = []
  const effectifs: number[] = []
  for (const seau of seaux) {
    effectifs.push(seau.length)
    if (seau.length === 0) {
      moyennes.push(undefined)
      demiIC.push(undefined)
      continue
    }
    moyennes.push(moyenne(seau))
    if (seau.length < 3) {
      demiIC.push(undefined)
      continue
    }
    const erreurType = ecartType(seau) / Math.sqrt(seau.length)
    demiIC.push(Number.isFinite(erreurType) ? 1.96 * erreurType : undefined)
  }

  return { decalages, moyenne: moyennes, demiIC, effectifs, nEvenements, nEcartes, nContamines }
}

/**
 * Vrai si l'écart à la ligne de base exclut zéro au seuil de 95 %.
 * Attention : sur une fenêtre de onze décalages, une case « significative »
 * par pur hasard est attendue une fois sur deux. C'est un repère visuel, pas
 * un test d'hypothèse en bonne et due forme.
 */
export function ecartSignificatif(reponse: ReponseEvenement, decalage: number): boolean {
  const k = reponse.decalages.indexOf(decalage)
  if (k < 0) return false
  const m = reponse.moyenne[k]
  const ic = reponse.demiIC[k]
  if (m === undefined || ic === undefined) return false
  return Math.abs(m) > ic
}

/** Décalage où l'écart absolu à la ligne de base est le plus fort (après l'événement). */
export function picReponse(
  reponse: ReponseEvenement,
): { decalage: number; ecart: number } | undefined {
  let meilleur: { decalage: number; ecart: number } | undefined
  for (let k = 0; k < reponse.decalages.length; k++) {
    const d = reponse.decalages[k]!
    if (d < 0) continue
    const m = reponse.moyenne[k]
    if (m === undefined) continue
    if (!meilleur || Math.abs(m) > Math.abs(meilleur.ecart)) meilleur = { decalage: d, ecart: m }
  }
  return meilleur
}
