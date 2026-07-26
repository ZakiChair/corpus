import { useStore } from 'zustand'
import { storeDonnees } from './donneesStore'
import { storeFenetres } from '../shell/gestionnaireFenetres'
import { storeTheme } from '../shell/theme'
import type { EtatCorpus } from './types'

/** Abonnements React aux stores « vanilla ». */

export function useEtat(): EtatCorpus {
  return useStore(storeDonnees, (s) => s.etat)
}

export function useDonneesVide(): boolean {
  return useStore(storeDonnees, (s) => s.vide)
}

export function useHydrate(): boolean {
  return useStore(storeDonnees, (s) => s.hydrate)
}

export function useFenetres() {
  return useStore(storeFenetres, (s) => s.fenetres)
}

export function usePaletteOuverte(): boolean {
  return useStore(storeFenetres, (s) => s.paletteOuverte)
}

export function useTheme() {
  return useStore(storeTheme, (s) => s.theme)
}
