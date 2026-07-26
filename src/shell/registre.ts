/**
 * Registre des fenêtres.
 *
 * Source de vérité unique : `IdFenetre` en est dérivé, et la table des
 * composants (cf. App.tsx) est un `Record<IdFenetre, …>`. Ajouter une entrée
 * ici sans câbler son composant devient donc une erreur de COMPILATION, pas un
 * écran blanc découvert à l'exécution.
 */

export interface DefinitionFenetre {
  readonly id: string
  readonly titre: string
  /** Code court, à la façon des terminaux financiers. */
  readonly mnemonique: string
  readonly largeur: number
  readonly hauteur: number
  readonly description: string
}

export const REGISTRE_FENETRES = [
  {
    id: 'bilan',
    titre: 'Bilan du jour',
    mnemonique: 'BLAN',
    largeur: 760,
    hauteur: 520,
    description: 'État composite, tuiles par métrique, z-score et rang percentile',
  },
  {
    id: 'series',
    titre: 'Séries',
    mnemonique: 'SERI',
    largeur: 860,
    hauteur: 560,
    description: 'Graphe multi-métriques, zoom, repères d’événements',
  },
  {
    id: 'charge',
    titre: 'Charge',
    mnemonique: 'LOAD',
    largeur: 820,
    hauteur: 540,
    description: 'Charge aiguë et chronique, forme, ratio, monotonie',
  },
  {
    id: 'correlations',
    titre: 'Corrélations',
    mnemonique: 'CORR',
    // Une matrice 15 × 15 avec ses étiquettes a besoin de place : la taille
    // par défaut doit contenir le contenu, pas obliger à agrandir d'abord.
    largeur: 940,
    hauteur: 700,
    description: 'Matrice décalée : qui précède quoi, et de combien de jours',
  },
  {
    id: 'evenements',
    titre: 'Événements',
    mnemonique: 'EVTS',
    largeur: 760,
    hauteur: 540,
    description: 'Réponse moyenne d’une métrique autour d’un type d’événement',
  },
  {
    id: 'saisie',
    titre: 'Saisie',
    mnemonique: 'SAIS',
    largeur: 460,
    hauteur: 580,
    description: 'Saisie manuelle du jour',
  },
  {
    id: 'journal',
    titre: 'Journal',
    mnemonique: 'ANNO',
    largeur: 520,
    hauteur: 560,
    description: 'Événements datés : séances, sorties, voyages, maladies',
  },
  {
    id: 'donnees',
    titre: 'Données',
    mnemonique: 'DONN',
    largeur: 640,
    hauteur: 580,
    description: 'Import CSV et ATHLOS, génération de démonstration, export',
  },
] as const satisfies readonly DefinitionFenetre[]

export type IdFenetre = (typeof REGISTRE_FENETRES)[number]['id']

const PAR_ID = new Map<string, DefinitionFenetre>(REGISTRE_FENETRES.map((f) => [f.id, f]))

export function definitionFenetre(id: IdFenetre): DefinitionFenetre {
  return PAR_ID.get(id)!
}

export function estIdFenetre(v: unknown): v is IdFenetre {
  return typeof v === 'string' && PAR_ID.has(v)
}

/** Disposition ouverte au premier lancement. */
export const FENETRES_PAR_DEFAUT: readonly IdFenetre[] = ['bilan', 'series']
