/**
 * Domaine d'un axe : mathématique pure, sans DOM, donc testable directement.
 *
 * Sur les graphes de CORPUS, l'axe des abscisses est gradué en INDEX DE JOUR
 * (nombre de jours depuis l'époque), pas en index de tableau : une série trouée
 * ne voit donc pas son échelle se déformer au niveau de ses lacunes.
 */

export interface Domaine {
  min: number
  max: number
}

const ETENDUE_MINIMALE = 1e-9

export function etendue(d: Domaine): number {
  return d.max - d.min
}

/**
 * Ramène un domaine dans ses bornes en préservant son étendue quand c'est
 * possible : un panoramique qui bute sur un bord doit glisser le long du bord,
 * pas se comprimer.
 */
export function clamperDomaine(d: Domaine, bornes: Domaine): Domaine {
  const largeurBornes = etendue(bornes)
  const largeur = Math.min(Math.max(etendue(d), ETENDUE_MINIMALE), largeurBornes)
  let min = d.min
  if (min < bornes.min) min = bornes.min
  if (min + largeur > bornes.max) min = bornes.max - largeur
  return { min, max: min + largeur }
}

/**
 * Zoom autour d'un pivot exprimé dans l'unité du domaine.
 * `facteur` > 1 élargit la fenêtre (dézoom), < 1 la resserre.
 * Le pivot conserve sa position RELATIVE : c'est ce qui donne l'impression
 * que le graphe s'écarte sous le curseur plutôt que de glisser.
 */
export function zoomerDomaine(
  d: Domaine,
  facteur: number,
  pivot: number,
  bornes: Domaine,
): Domaine {
  const largeur = etendue(d)
  if (largeur <= 0) return clamperDomaine(d, bornes)
  const positionRelative = (pivot - d.min) / largeur
  const nouvelleLargeur = Math.min(
    Math.max(largeur * facteur, ETENDUE_MINIMALE),
    etendue(bornes),
  )
  const min = pivot - positionRelative * nouvelleLargeur
  return clamperDomaine({ min, max: min + nouvelleLargeur }, bornes)
}

export function deplacerDomaine(d: Domaine, delta: number, bornes: Domaine): Domaine {
  return clamperDomaine({ min: d.min + delta, max: d.max + delta }, bornes)
}

export function pixelVersValeur(d: Domaine, xPix: number, largeurPix: number): number {
  if (largeurPix <= 0) return d.min
  return d.min + (xPix / largeurPix) * etendue(d)
}

export function valeurVersPixel(d: Domaine, valeur: number, largeurPix: number): number {
  const largeur = etendue(d)
  if (largeur <= 0) return 0
  return ((valeur - d.min) / largeur) * largeurPix
}

/**
 * Sous-domaine correspondant aux `jours` derniers jours des bornes.
 * `null` rend les bornes complètes (préréglage « Tout »).
 */
export function domainePourPreset(bornes: Domaine, jours: number | null): Domaine {
  if (jours === null) return { ...bornes }
  return clamperDomaine({ min: bornes.max - jours, max: bornes.max }, bornes)
}

/** Indices du premier et du dernier point visible (bornes larges d'un point). */
export function indicesVisibles<T>(
  points: readonly T[],
  valeurDe: (p: T) => number,
  d: Domaine,
): { debut: number; fin: number } {
  if (points.length === 0) return { debut: 0, fin: 0 }
  let debut = 0
  while (debut < points.length && valeurDe(points[debut]!) < d.min) debut++
  let fin = points.length - 1
  while (fin >= 0 && valeurDe(points[fin]!) > d.max) fin--
  // Un point de marge de chaque côté : sinon le segment qui entre dans le
  // cadre est tronqué et la courbe semble commencer au bord.
  return {
    debut: Math.max(0, debut - 1),
    fin: Math.min(points.length - 1, fin + 1),
  }
}

/**
 * Graduations « rondes » couvrant un intervalle : 1, 2, 5, 10, 20, 50…
 * Un axe gradué en 0 / 3,7 / 7,4 est illisible.
 */
export function graduations(min: number, max: number, cible = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return []
  const brut = (max - min) / Math.max(1, cible)
  const magnitude = 10 ** Math.floor(Math.log10(brut))
  const normalise = brut / magnitude
  const pas = (normalise >= 5 ? 10 : normalise >= 2 ? 5 : normalise >= 1 ? 2 : 1) * magnitude
  const out: number[] = []
  const premier = Math.ceil(min / pas) * pas
  for (let v = premier; v <= max + pas * 1e-9; v += pas) {
    // L'accumulation flottante fait dériver la valeur : on la réaligne.
    out.push(Math.round(v / pas) * pas)
  }
  return out
}

/** Étend un intervalle de valeurs d'une marge relative, pour respirer. */
export function avecMarge(min: number, max: number, marge = 0.08): Domaine {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  if (max === min) {
    const d = Math.abs(min) * marge || 1
    return { min: min - d, max: max + d }
  }
  const m = (max - min) * marge
  return { min: min - m, max: max + m }
}
