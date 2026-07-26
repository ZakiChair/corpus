import { z } from 'zod'
import { estJourValide, type Jour } from './temps'

/*
 * Les schémas Zod sont la source de vérité ; les types TS en sont inférés.
 * Ils servent à valider ce qui vient de l'extérieur : import de fichier et
 * relecture du stockage local (qu'un autre outil, ou une version antérieure,
 * a pu écrire).
 */

export const schemaJour = z.string().refine(estJourValide, {
  message: 'Date attendue au format AAAA-MM-JJ',
})

// Zod 4 rejette déjà NaN et l'infini pour `z.number()`.
export const schemaPoint = z.object({
  j: schemaJour,
  v: z.number(),
})
export type Point = { j: Jour; v: number }

/** Série journalière, triée par jour croissant, au plus un point par jour. */
export type Serie = Point[]
export const schemaSerie = z.array(schemaPoint)

export const TYPES_ANNOTATION = [
  'seance',
  'alcool',
  'voyage',
  'maladie',
  'stress',
  'blessure',
  'autre',
] as const
export type TypeAnnotation = (typeof TYPES_ANNOTATION)[number]

export const LIBELLES_ANNOTATION: Record<TypeAnnotation, string> = {
  seance: 'Séance',
  alcool: 'Alcool',
  voyage: 'Voyage',
  maladie: 'Maladie',
  stress: 'Stress',
  blessure: 'Blessure',
  autre: 'Autre',
}

/** Jeton de couleur (cf. index.css) associé à chaque type d'événement. */
export const COULEURS_ANNOTATION: Record<TypeAnnotation, string> = {
  seance: '--c-serie1',
  alcool: '--c-serie4',
  voyage: '--c-serie5',
  maladie: '--c-defavorable',
  stress: '--c-alerte',
  blessure: '--c-defavorable',
  autre: '--c-attenue',
}

export const schemaAnnotation = z.object({
  id: z.string(),
  j: schemaJour,
  type: z.enum(TYPES_ANNOTATION),
  intensite: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
})
export type Annotation = z.infer<typeof schemaAnnotation>

export const schemaProfil = z.object({
  tailleCm: z.number().positive().optional(),
  sexe: z.enum(['h', 'f', 'nsp']).optional(),
  naissance: schemaJour.optional(),
})
export type Profil = z.infer<typeof schemaProfil>

export const VERSION_ETAT = 1

export const schemaEtatCorpus = z.object({
  version: z.number().int(),
  series: z.record(z.string(), schemaSerie),
  annotations: z.array(schemaAnnotation),
  profil: schemaProfil,
  creeLe: schemaJour,
})
export type EtatCorpus = z.infer<typeof schemaEtatCorpus>

export function etatVide(creeLe: Jour): EtatCorpus {
  return { version: VERSION_ETAT, series: {}, annotations: [], profil: {}, creeLe }
}

/**
 * Relit un état venu du stockage ou d'un fichier.
 * Renvoie `null` si la forme ne correspond pas — mieux vaut repartir de zéro
 * que planter au démarrage sur une donnée corrompue.
 */
export function analyserEtat(brut: unknown): EtatCorpus | null {
  const r = schemaEtatCorpus.safeParse(brut)
  if (!r.success) return null
  return normaliserEtat(r.data)
}

/**
 * Garantit les invariants que le reste du code suppose acquis : séries triées
 * par jour croissant, un seul point par jour (le dernier écrit gagne),
 * annotations triées.
 */
export function normaliserEtat(etat: EtatCorpus): EtatCorpus {
  const series: Record<string, Serie> = {}
  for (const [id, serie] of Object.entries(etat.series)) {
    series[id] = normaliserSerie(serie)
  }
  return {
    ...etat,
    series,
    annotations: [...etat.annotations].sort((a, b) => (a.j < b.j ? -1 : a.j > b.j ? 1 : 0)),
  }
}

export function normaliserSerie(serie: Serie): Serie {
  const parJour = new Map<Jour, number>()
  for (const p of serie) {
    if (!Number.isFinite(p.v)) continue
    parJour.set(p.j, p.v)
  }
  return [...parJour.entries()]
    .map(([j, v]) => ({ j, v }))
    .sort((a, b) => (a.j < b.j ? -1 : a.j > b.j ? 1 : 0))
}

/** Insère ou remplace le point du jour donné, en conservant le tri. */
export function poserPoint(serie: Serie, j: Jour, v: number): Serie {
  const sortie = serie.filter((p) => p.j !== j)
  sortie.push({ j, v })
  sortie.sort((a, b) => (a.j < b.j ? -1 : a.j > b.j ? 1 : 0))
  return sortie
}

export function retirerPoint(serie: Serie, j: Jour): Serie {
  return serie.filter((p) => p.j !== j)
}
