import { createStore } from 'zustand/vanilla'

export const THEMES = ['nuit', 'ambre', 'phosphore', 'clinique'] as const
export type Theme = (typeof THEMES)[number]

export const LIBELLES_THEME: Record<Theme, string> = {
  nuit: 'Nuit',
  ambre: 'Ambre',
  phosphore: 'Phosphore',
  clinique: 'Clinique',
}

const CLE = 'corpus:theme'

export function estTheme(valeur: unknown): valeur is Theme {
  return typeof valeur === 'string' && (THEMES as readonly string[]).includes(valeur)
}

function lireThemeStocke(): Theme {
  try {
    const brut = localStorage.getItem(CLE)
    if (estTheme(brut)) return brut
  } catch {
    // localStorage indisponible (mode privé strict) : on retombe sur le défaut.
  }
  return 'nuit'
}

/**
 * Applique le thème sur <html>. Appelé au chargement du module main, donc
 * avant le premier rendu React.
 */
export function appliquerThemeInitial(): void {
  const theme = lireThemeStocke()
  document.documentElement.setAttribute('data-theme', theme)
}

interface EtatTheme {
  theme: Theme
  definir: (t: Theme) => void
}

export const storeTheme = createStore<EtatTheme>((set) => ({
  theme: typeof document === 'undefined' ? 'nuit' : lireThemeStocke(),
  definir: (t) => {
    document.documentElement.setAttribute('data-theme', t)
    try {
      localStorage.setItem(CLE, t)
    } catch {
      // Persistance best-effort.
    }
    set({ theme: t })
  },
}))
