/**
 * Arithmétique de dates au grain journalier.
 *
 * Un jour est une chaîne 'YYYY-MM-DD'. Tous les calculs passent par un index
 * entier (nombre de jours depuis l'époque) construit avec Date.UTC : en heure
 * locale, les nuits de changement d'heure ne durent pas 86 400 000 ms et les
 * décalages dériveraient d'un cran deux fois par an.
 */

export type Jour = string

const MS_PAR_JOUR = 86_400_000
const FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/

export function estJourValide(j: string): boolean {
  const m = FORMAT.exec(j)
  if (!m) return false
  const annee = Number(m[1])
  const mois = Number(m[2])
  const jour = Number(m[3])
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return false
  // Rejette les dates inexistantes (31 février) : l'aller-retour doit être stable.
  const d = new Date(Date.UTC(annee, mois - 1, jour))
  return d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour
}

export function jourVersIndex(j: Jour): number {
  const m = FORMAT.exec(j)
  if (!m) throw new Error(`Jour invalide : ${j}`)
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PAR_JOUR)
}

export function indexVersJour(index: number): Jour {
  const d = new Date(index * MS_PAR_JOUR)
  const a = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const jo = String(d.getUTCDate()).padStart(2, '0')
  return `${a}-${mo}-${jo}`
}

export function decalerJour(j: Jour, nbJours: number): Jour {
  return indexVersJour(jourVersIndex(j) + nbJours)
}

/** Nombre de jours de `depuis` à `jusqua` (positif si jusqua est postérieur). */
export function diffJours(depuis: Jour, jusqua: Jour): number {
  return jourVersIndex(jusqua) - jourVersIndex(depuis)
}

/** Jour courant en heure locale (c'est bien la journée vécue qui compte). */
export function aujourdhui(maintenant: Date = new Date()): Jour {
  const a = maintenant.getFullYear()
  const mo = String(maintenant.getMonth() + 1).padStart(2, '0')
  const jo = String(maintenant.getDate()).padStart(2, '0')
  return `${a}-${mo}-${jo}`
}

/** 0 = lundi … 6 = dimanche. */
export function jourDeSemaine(j: Jour): number {
  const d = new Date(jourVersIndex(j) * MS_PAR_JOUR)
  return (d.getUTCDay() + 6) % 7
}

export const NOMS_JOURS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'] as const

const NOMS_MOIS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
] as const

/** '2026-07-26' → '26 juil.' */
export function formaterJourCourt(j: Jour): string {
  const m = FORMAT.exec(j)
  if (!m) return j
  return `${Number(m[3])} ${NOMS_MOIS[Number(m[2]) - 1]}`
}

/** '2026-07-26' → '26 juil. 2026' */
export function formaterJourLong(j: Jour): string {
  const m = FORMAT.exec(j)
  if (!m) return j
  return `${Number(m[3])} ${NOMS_MOIS[Number(m[2]) - 1]} ${m[1]}`
}

/** Suite continue de jours, bornes incluses. */
export function plageJours(debut: Jour, fin: Jour): Jour[] {
  const d = jourVersIndex(debut)
  const f = jourVersIndex(fin)
  const out: Jour[] = []
  for (let i = d; i <= f; i++) out.push(indexVersJour(i))
  return out
}
