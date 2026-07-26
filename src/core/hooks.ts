import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { storeDonnees } from './donneesStore'
import { storeFenetres } from '../shell/gestionnaireFenetres'
import { storeTheme } from '../shell/theme'
import { aujourdhui, type Jour } from './temps'
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

/**
 * Mémoïsation sur une liste de RÉFÉRENCES plutôt que sur l'objet `etat`.
 *
 * Chaque mutation du store crée un nouvel `etat`, mais ne remplace que les
 * tableaux des séries touchées : les autres gardent leur identité. Les calculs
 * lourds (matrice de corrélation, détecteurs de signaux, bootstraps) n'ont
 * donc à se refaire que quand LEURS séries ont réellement changé — pas à
 * chaque frappe dans SAIS.
 *
 * Limite assumée : une série densifiée dépend aussi des bornes globales ; un
 * point ajouté à une AUTRE métrique peut en théorie allonger son remplissage
 * de zéros d'un jour. L'effet est marginal et disparaît au prochain vrai
 * changement.
 */
export function useMemoRefs<T>(fabrique: () => T, refs: readonly unknown[]): T {
  const memo = useRef<{ refs: readonly unknown[]; valeur: T } | null>(null)
  if (
    !memo.current ||
    memo.current.refs.length !== refs.length ||
    refs.some((r, i) => !Object.is(r, memo.current!.refs[i]))
  ) {
    memo.current = { refs, valeur: fabrique() }
  }
  return memo.current.valeur
}

/**
 * La date du jour, RÉACTIVE : une application laissée ouverte pendant la nuit
 * ne doit pas continuer à proposer la date d'hier. Vérifiée au focus, au
 * retour d'onglet et chaque minute.
 */
export function useAujourdhui(): Jour {
  const [jour, setJour] = useState(() => aujourdhui())
  useEffect(() => {
    const verifier = () =>
      setJour((ancien) => {
        const neuf = aujourdhui()
        return neuf === ancien ? ancien : neuf
      })
    window.addEventListener('focus', verifier)
    document.addEventListener('visibilitychange', verifier)
    const minuteur = setInterval(verifier, 60_000)
    return () => {
      window.removeEventListener('focus', verifier)
      document.removeEventListener('visibilitychange', verifier)
      clearInterval(minuteur)
    }
  }, [])
  return jour
}
