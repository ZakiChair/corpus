import { decalerJour, type Jour } from '../core/temps'
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
}

export interface OptionsEtude {
  avant?: number
  apres?: number
  /** Mesures minimales dans la fenêtre antérieure pour établir la ligne de base. */
  minimumBase?: number
}

export function etudeEvenement(
  serie: Serie,
  joursEvenement: readonly Jour[],
  options: OptionsEtude = {},
): ReponseEvenement {
  const { avant = 3, apres = 7, minimumBase = 2 } = options
  const decalages: number[] = []
  for (let d = -avant; d <= apres; d++) decalages.push(d)

  const seaux = decalages.map<number[]>(() => [])
  let nEvenements = 0
  let nEcartes = 0

  for (const e of joursEvenement) {
    // Ligne de base : les jours qui PRÉCÈDENT strictement l'événement.
    const base: number[] = []
    for (let d = -avant; d <= -1; d++) {
      const v = valeurAuJour(serie, decalerJour(e, d))
      if (v !== undefined) base.push(v)
    }
    if (base.length < minimumBase) {
      nEcartes++
      continue
    }
    const niveauBase = moyenne(base)
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

  return { decalages, moyenne: moyennes, demiIC, effectifs, nEvenements, nEcartes }
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
