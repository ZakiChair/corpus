/**
 * Lecture des jetons de thème depuis le canvas.
 *
 * Un canvas ne voit pas les classes Tailwind : il faut lui donner des couleurs
 * résolues. On lit donc les propriétés personnalisées sur <html> au moment du
 * dessin, ce qui fait suivre automatiquement les changements de thème.
 */

let cacheTheme: string | null = null
let cache: Record<string, string> = {}

export function lireJeton(nom: string): string {
  if (typeof document === 'undefined') return '#888888'
  const themeCourant = document.documentElement.getAttribute('data-theme') ?? 'nuit'
  // Le cache est invalidé au changement de thème : getComputedStyle est
  // coûteux et un graphe l'appellerait des dizaines de fois par redessin.
  if (themeCourant !== cacheTheme) {
    cacheTheme = themeCourant
    cache = {}
  }
  const enCache = cache[nom]
  if (enCache !== undefined) return enCache
  const valeur = getComputedStyle(document.documentElement).getPropertyValue(nom).trim()
  const resolu = valeur || '#888888'
  cache[nom] = resolu
  return resolu
}

const SERIES = [
  '--c-serie1',
  '--c-serie2',
  '--c-serie3',
  '--c-serie4',
  '--c-serie5',
  '--c-serie6',
]

/** Couleur de la n-ième série, en boucle sur la palette. */
export function couleurSerie(index: number): string {
  return lireJeton(SERIES[index % SERIES.length]!)
}

export function nomJetonSerie(index: number): string {
  return SERIES[index % SERIES.length]!
}

/** Convertit un jeton hexadécimal en rgba() avec la transparence voulue. */
export function jetonTransparent(nom: string, alpha: number): string {
  const hex = lireJeton(nom)
  const rgb = hexVersRgb(hex)
  if (!rgb) return hex
  return `rgba(${rgb.r}, ${rgb.v}, ${rgb.b}, ${alpha})`
}

export function hexVersRgb(hex: string): { r: number; v: number; b: number } | null {
  const propre = hex.trim().replace('#', '')
  const complet =
    propre.length === 3
      ? propre
          .split('')
          .map((c) => c + c)
          .join('')
      : propre
  if (complet.length !== 6) return null
  const n = Number.parseInt(complet, 16)
  if (Number.isNaN(n)) return null
  return { r: (n >> 16) & 255, v: (n >> 8) & 255, b: n & 255 }
}

/**
 * Prépare un canvas pour un écran à haute densité et rend le contexte 2D déjà
 * mis à l'échelle : le code de dessin raisonne alors en pixels CSS.
 * Renvoie null si le canvas n'a pas encore de taille (premier rendu).
 */
export function preparerCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; largeur: number; hauteur: number } | null {
  const rect = canvas.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return null
  const dpr = window.devicePixelRatio || 1
  const l = Math.round(rect.width * dpr)
  const h = Math.round(rect.height * dpr)
  if (canvas.width !== l || canvas.height !== h) {
    canvas.width = l
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  return { ctx, largeur: rect.width, hauteur: rect.height }
}
