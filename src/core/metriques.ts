/**
 * Catalogue des métriques suivies par CORPUS.
 *
 * Le catalogue est la source de vérité : `IdMetrique` en est DÉRIVÉ, donc une
 * faute de frappe sur un identifiant devient une erreur de compilation partout
 * où le type est attendu.
 */

export type Famille =
  | 'recuperation'
  | 'sommeil'
  | 'morphologie'
  | 'charge'
  | 'subjectif'
  /** Métriques arrivées par import, absentes du catalogue. */
  | 'autre'

/**
 * `haut` : une valeur élevée est favorable. `bas` : l'inverse.
 * `neutre` : ni l'un ni l'autre — le poids ou la charge d'entraînement ne sont
 * pas « bons » ou « mauvais » dans l'absolu, seulement en contexte. Les
 * fenêtres s'abstiennent de les colorer.
 */
export type Sens = 'haut' | 'bas' | 'neutre'

export interface DefinitionMetrique {
  readonly id: string
  readonly label: string
  readonly abrege: string
  readonly unite: string
  readonly famille: Famille
  readonly sens: Sens
  readonly min: number
  readonly max: number
  readonly decimales: number
  /** Proposée dans le formulaire de saisie quotidienne. */
  readonly saisieManuelle?: boolean
  /**
   * Un jour sans valeur vaut zéro plutôt que « non mesuré ».
   * Vrai pour la charge d'entraînement : un jour de repos est une information,
   * pas une lacune. Faux pour la VFC : une montre non portée ne veut pas dire
   * que la variabilité était nulle.
   */
  readonly absenceVautZero?: boolean
}

export const LIBELLES_FAMILLE: Record<Famille, string> = {
  recuperation: 'Récupération',
  sommeil: 'Sommeil',
  morphologie: 'Morphologie',
  charge: 'Charge',
  subjectif: 'Subjectif',
  autre: 'Importées',
}

export const METRIQUES = [
  {
    id: 'vfc',
    label: 'Variabilité cardiaque',
    abrege: 'VFC',
    unite: 'ms',
    famille: 'recuperation',
    sens: 'haut',
    min: 5,
    max: 250,
    decimales: 0,
    saisieManuelle: true,
  },
  {
    id: 'fc_repos',
    label: 'Fréquence au repos',
    abrege: 'FC repos',
    unite: 'bpm',
    famille: 'recuperation',
    sens: 'bas',
    min: 28,
    max: 120,
    decimales: 0,
    saisieManuelle: true,
  },
  {
    id: 'sommeil_duree',
    label: 'Durée de sommeil',
    abrege: 'Sommeil',
    unite: 'h',
    famille: 'sommeil',
    sens: 'haut',
    min: 0,
    max: 16,
    decimales: 1,
    saisieManuelle: true,
  },
  {
    id: 'sommeil_profond',
    label: 'Sommeil profond',
    abrege: 'Profond',
    unite: 'h',
    famille: 'sommeil',
    sens: 'haut',
    min: 0,
    max: 5,
    decimales: 1,
  },
  {
    id: 'sommeil_coucher',
    label: 'Heure de coucher',
    abrege: 'Coucher',
    unite: 'h',
    famille: 'sommeil',
    sens: 'bas',
    min: 18,
    max: 31,
    decimales: 1,
    saisieManuelle: true,
  },
  {
    id: 'sommeil_reveils',
    label: 'Réveils nocturnes',
    abrege: 'Réveils',
    unite: '',
    famille: 'sommeil',
    sens: 'bas',
    min: 0,
    max: 15,
    decimales: 0,
  },
  {
    id: 'poids',
    label: 'Poids',
    abrege: 'Poids',
    unite: 'kg',
    famille: 'morphologie',
    sens: 'neutre',
    min: 30,
    max: 220,
    decimales: 1,
    saisieManuelle: true,
  },
  {
    id: 'masse_grasse',
    label: 'Masse grasse',
    abrege: 'M. grasse',
    unite: '%',
    famille: 'morphologie',
    sens: 'bas',
    min: 3,
    max: 55,
    decimales: 1,
  },
  {
    id: 'tour_taille',
    label: 'Tour de taille',
    // « Taille » seul serait ambigu : en français le mot désigne aussi la
    // stature, et « Taille 78 cm » se lirait comme une hauteur absurde.
    abrege: 'Tour taille',
    unite: 'cm',
    famille: 'morphologie',
    sens: 'bas',
    min: 50,
    max: 160,
    decimales: 1,
  },
  {
    id: 'charge_seance',
    label: 'Charge de séance',
    abrege: 'Charge',
    unite: 'UA',
    famille: 'charge',
    sens: 'neutre',
    min: 0,
    max: 1500,
    decimales: 0,
    saisieManuelle: true,
    absenceVautZero: true,
  },
  {
    id: 'pas',
    label: 'Pas',
    abrege: 'Pas',
    unite: '',
    famille: 'charge',
    sens: 'haut',
    min: 0,
    max: 60000,
    decimales: 0,
  },
  {
    id: 'energie',
    label: 'Énergie',
    abrege: 'Énergie',
    unite: '/10',
    famille: 'subjectif',
    sens: 'haut',
    min: 1,
    max: 10,
    decimales: 0,
    saisieManuelle: true,
  },
  {
    id: 'humeur',
    label: 'Humeur',
    abrege: 'Humeur',
    unite: '/10',
    famille: 'subjectif',
    sens: 'haut',
    min: 1,
    max: 10,
    decimales: 0,
    saisieManuelle: true,
  },
  {
    id: 'courbatures',
    label: 'Courbatures',
    abrege: 'Courbat.',
    unite: '/10',
    famille: 'subjectif',
    sens: 'bas',
    min: 0,
    max: 10,
    decimales: 0,
    saisieManuelle: true,
  },
  {
    id: 'stress',
    label: 'Stress',
    abrege: 'Stress',
    unite: '/10',
    famille: 'subjectif',
    sens: 'bas',
    min: 0,
    max: 10,
    decimales: 0,
    saisieManuelle: true,
  },
] as const satisfies readonly DefinitionMetrique[]

export type IdMetrique = (typeof METRIQUES)[number]['id']

const PAR_ID = new Map<string, DefinitionMetrique>(METRIQUES.map((m) => [m.id, m]))

export function definitionMetrique(id: string): DefinitionMetrique | undefined {
  return PAR_ID.get(id)
}

/** Définition connue, ou définition générique pour une métrique venue d'un import. */
export function definitionOuGenerique(id: string): DefinitionMetrique {
  return (
    PAR_ID.get(id) ?? {
      id,
      label: id,
      abrege: id,
      unite: '',
      // Rangée à part : on ne sait ni ce que c'est, ni dans quelle unité.
      famille: 'autre',
      sens: 'neutre',
      min: -1e9,
      max: 1e9,
      decimales: 2,
    }
  )
}

export function metriquesParFamille(famille: Famille): readonly DefinitionMetrique[] {
  return METRIQUES.filter((m) => m.famille === famille)
}

/**
 * Le catalogue vu au type large.
 *
 * `as const satisfies` donne à chaque entrée son type littéral exact : une
 * entrée qui ne déclare pas `saisieManuelle` n'a tout simplement pas la
 * propriété, et y accéder ne compile pas. Cette vue élargie sert aux
 * traitements génériques ; le tableau littéral reste la source de vérité.
 */
export const CATALOGUE: readonly DefinitionMetrique[] = METRIQUES

export function metriquesSaisissables(): readonly DefinitionMetrique[] {
  return CATALOGUE.filter((m) => m.saisieManuelle)
}

export const FAMILLES: readonly Famille[] = [
  'recuperation',
  'sommeil',
  'morphologie',
  'charge',
  'subjectif',
  'autre',
]

/** Formate une valeur avec l'unité, en respectant le nombre de décimales déclaré. */
export function formaterValeur(id: string, v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—'
  const def = definitionOuGenerique(id)
  const nombre = v.toLocaleString('fr-CH', {
    minimumFractionDigits: def.decimales,
    maximumFractionDigits: def.decimales,
  })
  if (!def.unite) return nombre
  // Le pourcentage se colle, les autres unités prennent une espace fine.
  return def.unite === '%' ? `${nombre} %` : `${nombre} ${def.unite}`
}

/**
 * L'heure de coucher est stockée en heures décimales pouvant dépasser 24
 * (25,5 = 1 h 30 du matin) pour rester monotone : sinon 23 h 50 et 00 h 10
 * seraient à deux extrémités de l'échelle alors qu'ils sont voisins.
 */
export function formaterHeureCoucher(v: number): string {
  const norm = ((v % 24) + 24) % 24
  const h = Math.floor(norm)
  const min = Math.round((norm - h) * 60)
  const hFinal = min === 60 ? (h + 1) % 24 : h
  const minFinal = min === 60 ? 0 : min
  return `${String(hFinal).padStart(2, '0')} h ${String(minFinal).padStart(2, '0')}`
}
