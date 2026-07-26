import { createStore } from 'zustand/vanilla'
import type { Jour } from '../core/temps'
import { storeFenetres } from './gestionnaireFenetres'

/**
 * Intentions inter-fenêtres — ce qui fait d'une collection de fenêtres un
 * terminal : cliquer une tuile de BLAN, une relation de CORR, une ligne de
 * SIGN ou un événement d'ANNO ouvre SERI déjà réglée sur la chose cliquée.
 *
 * L'intention est posée ici, la fenêtre cible la CONSOMME à son prochain
 * rendu : l'émetteur n'a pas besoin de savoir si SERI est montée, et une
 * intention posée avant l'ouverture survit au chargement paresseux du
 * composant.
 */

export interface IntentionSeries {
  /** Métriques à sélectionner ; absentes = garder la sélection courante. */
  ids?: string[]
  /** Jour sur lequel centrer le domaine (± trois semaines). */
  centreJour?: Jour
}

interface EtatIntentions {
  series: IntentionSeries | null
  /** Jour survolé, partagé entre les graphes à axe temporel (SERI, LOAD). */
  jourSurvole: Jour | null

  demanderSeries: (intention: IntentionSeries) => void
  consommerSeries: () => void
  definirJourSurvole: (j: Jour | null) => void
}

export const storeIntentions = createStore<EtatIntentions>((set, get) => ({
  series: null,
  jourSurvole: null,

  demanderSeries: (intention) => {
    set({ series: intention })
    storeFenetres.getState().ouvrir('series')
  },

  consommerSeries: () => {
    if (get().series) set({ series: null })
  },

  definirJourSurvole: (j) => {
    if (get().jourSurvole !== j) set({ jourSurvole: j })
  },
}))
