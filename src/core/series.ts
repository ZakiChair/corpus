import { densifier } from '../analyse/stats'
import { definitionMetrique } from './metriques'
import type { Jour } from './temps'
import type { Annotation, EtatCorpus, Serie, TypeAnnotation } from './types'

const VIDE: Serie = []

/** Série telle qu'elle est stockée. */
export function serie(etat: EtatCorpus, id: string): Serie {
  return etat.series[id] ?? VIDE
}

/**
 * Série prête pour l'analyse : les métriques dont l'absence vaut zéro sont
 * densifiées sur toute leur plage.
 *
 * C'est la version à utiliser pour corréler ou lisser. Corréler la charge sans
 * densifier ne compare que des jours d'entraînement entre eux et perd le
 * contraste entraînement / repos, qui porte l'essentiel du signal.
 */
export function serieAnalyse(etat: EtatCorpus, id: string, debut?: Jour, fin?: Jour): Serie {
  const s = serie(etat, id)
  if (s.length === 0) return VIDE
  const def = definitionMetrique(id)
  if (!def?.absenceVautZero) return s
  return densifier(s, 0, debut ?? bornesGlobales(etat).debut, fin ?? bornesGlobales(etat).fin)
}

/** Premier et dernier jour couverts par l'état, toutes séries confondues. */
export function bornesGlobales(etat: EtatCorpus): { debut: Jour; fin: Jour } | Record<string, never> {
  let debut: Jour | undefined
  let fin: Jour | undefined
  for (const s of Object.values(etat.series)) {
    if (!s || s.length === 0) continue
    const premier = s[0]!.j
    const dernier = s[s.length - 1]!.j
    if (debut === undefined || premier < debut) debut = premier
    if (fin === undefined || dernier > fin) fin = dernier
  }
  for (const a of etat.annotations) {
    if (debut === undefined || a.j < debut) debut = a.j
    if (fin === undefined || a.j > fin) fin = a.j
  }
  return debut && fin ? { debut, fin } : ({} as Record<string, never>)
}

/** Identifiants des séries qui portent au moins un point. */
export function seriesRenseignees(etat: EtatCorpus): string[] {
  return Object.entries(etat.series)
    .filter(([, s]) => s && s.length > 0)
    .map(([id]) => id)
}

export function nombreDePoints(etat: EtatCorpus): number {
  let n = 0
  for (const s of Object.values(etat.series)) n += s?.length ?? 0
  return n
}

export function annotationsDuType(
  etat: EtatCorpus,
  type: TypeAnnotation,
  intensiteMinimale = 0,
): Annotation[] {
  return etat.annotations.filter(
    (a) => a.type === type && (a.intensite ?? 1) >= intensiteMinimale,
  )
}

export function joursDuType(
  etat: EtatCorpus,
  type: TypeAnnotation,
  intensiteMinimale = 0,
): Jour[] {
  return annotationsDuType(etat, type, intensiteMinimale).map((a) => a.j)
}

export function annotationsDuJour(etat: EtatCorpus, j: Jour): Annotation[] {
  return etat.annotations.filter((a) => a.j === j)
}

/** Types d'annotations réellement présents, avec leur effectif. */
export function typesPresents(etat: EtatCorpus): { type: TypeAnnotation; n: number }[] {
  const compte = new Map<TypeAnnotation, number>()
  for (const a of etat.annotations) compte.set(a.type, (compte.get(a.type) ?? 0) + 1)
  return [...compte.entries()]
    .map(([type, n]) => ({ type, n }))
    .sort((a, b) => b.n - a.n)
}
