import { jourVersIndex, type Jour } from '../core/temps'
import type { Serie } from '../core/types'
import { ecartAbsoluMedian, mediane } from './stats'

/**
 * Détection de ruptures de niveau.
 *
 * « Ta fréquence au repos a changé de palier autour du 12 mars » — ce que ni
 * le z-score (qui s'adapte au nouveau niveau en trente jours) ni la tendance
 * (qui lisse tout) ne disent.
 *
 * Méthode : pour chaque jour candidat, on compare la médiane de la fenêtre qui
 * SUIT à celle de la fenêtre qui PRÉCÈDE, en unités de dispersion robuste de
 * la fenêtre antérieure. Un saut durable dépasse le seuil sur plusieurs jours
 * consécutifs ; le groupe est fusionné et le jour au plus fort écart le
 * représente. Une dérive lente reste sous le seuil — c'est voulu, c'est le
 * travail de la tendance, pas des ruptures.
 */

export interface Rupture {
  /** Premier jour estimé du nouveau palier. */
  jour: Jour
  /** Médiane de la fenêtre antérieure. */
  avant: number
  /** Médiane de la fenêtre postérieure. */
  apres: number
  /** Écart en unités de dispersion robuste de la fenêtre antérieure. */
  ecartSigma: number
}

export interface OptionsRuptures {
  /** Fenêtre postérieure, en jours calendaires. */
  fenetreApres?: number
  /** Fenêtre antérieure, en jours calendaires. */
  fenetreAvant?: number
  /** Écart minimal, en unités de dispersion robuste. */
  seuilSigma?: number
  /** Points minimaux exigés dans chaque fenêtre. */
  minimumPoints?: number
}

export function detecterRuptures(serie: Serie, options: OptionsRuptures = {}): Rupture[] {
  const {
    fenetreApres = 14,
    fenetreAvant = 28,
    seuilSigma = 2,
    minimumPoints = 8,
  } = options
  const n = serie.length
  if (n < minimumPoints * 2) return []
  const idx = serie.map((p) => jourVersIndex(p.j))

  interface Candidat {
    i: number
    avant: number
    apres: number
    ecartSigma: number
  }
  const candidats: Candidat[] = []

  // Les trois bornes avancent avec i : chaque fenêtre est calendaire.
  let debAvant = 0
  let finApres = 0
  for (let i = 0; i < n; i++) {
    const t = idx[i]!
    while (debAvant < i && idx[debAvant]! < t - fenetreAvant) debAvant++
    if (finApres < i) finApres = i
    while (finApres < n && idx[finApres]! < t + fenetreApres) finApres++

    const avant = serie.slice(debAvant, i).map((p) => p.v)
    const apres = serie.slice(i, finApres).map((p) => p.v)
    if (avant.length < minimumPoints || apres.length < minimumPoints) continue

    const dispersion = ecartAbsoluMedian(avant)
    if (!Number.isFinite(dispersion) || dispersion === 0) continue
    const medAvant = mediane(avant)
    const medApres = mediane(apres)
    const ecartSigma = (medApres - medAvant) / dispersion
    if (Math.abs(ecartSigma) < seuilSigma) continue
    candidats.push({ i, avant: medAvant, apres: medApres, ecartSigma })
  }

  // Un vrai saut produit un ruban de candidats contigus : on les fusionne et
  // le jour au plus fort écart représente la rupture.
  const ruptures: Rupture[] = []
  let groupe: Candidat[] = []
  const clore = () => {
    if (groupe.length === 0) return
    const meilleur = groupe.reduce((m, c) =>
      Math.abs(c.ecartSigma) > Math.abs(m.ecartSigma) ? c : m,
    )
    ruptures.push({
      jour: serie[meilleur.i]!.j,
      avant: meilleur.avant,
      apres: meilleur.apres,
      ecartSigma: meilleur.ecartSigma,
    })
    groupe = []
  }
  for (const c of candidats) {
    const precedent = groupe[groupe.length - 1]
    if (precedent && idx[c.i]! - idx[precedent.i]! > fenetreApres) clore()
    groupe.push(c)
  }
  clore()
  return ruptures
}

/**
 * La rupture la plus récente si elle date de moins de `joursRecents` jours
 * (comptés depuis le dernier point de la série) — celle qui mérite un signal.
 */
export function ruptureRecente(
  serie: Serie,
  joursRecents = 21,
  options: OptionsRuptures = {},
): Rupture | undefined {
  if (serie.length === 0) return undefined
  const fin = jourVersIndex(serie[serie.length - 1]!.j)
  const toutes = detecterRuptures(serie, options)
  const derniere = toutes[toutes.length - 1]
  if (!derniere) return undefined
  return fin - jourVersIndex(derniere.jour) <= joursRecents ? derniere : undefined
}
