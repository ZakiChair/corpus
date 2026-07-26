import { estJourValide, type Jour } from '../core/temps'
import { normaliserSerie, type Annotation, type Profil, type Serie } from '../core/types'

/**
 * Import d'un profil ATHLOS.
 *
 * ATHLOS (~/ATHLOS) suit la performance et la morphologie ; il n'a ni sommeil,
 * ni variabilité cardiaque, ni composition corporelle. Les deux applications
 * sont donc complémentaires plutôt que concurrentes, et le JSON exporté par
 * l'écran « Réglages → Exporter » d'ATHLOS se transpose directement.
 *
 * La lecture est TOLÉRANTE : on prend ce qu'on reconnaît et on signale le
 * reste. Un schéma strict rejetterait tout le fichier pour un champ ajouté
 * dans une version ultérieure d'ATHLOS.
 */

export interface ResultatAthlos {
  series: Record<string, Serie>
  annotations: Annotation[]
  profil: Profil
  nomProfil?: string
  discipline?: string
  avertissements: string[]
}

/** Métriques ATHLOS qui correspondent à une métrique du catalogue CORPUS. */
const CORRESPONDANCES: Record<string, string> = {
  weight: 'poids',
  waist: 'tour_taille',
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function importerAthlos(brut: unknown): ResultatAthlos | null {
  if (!estObjet(brut)) return null
  // Signature minimale d'un profil ATHLOS : un dictionnaire de métriques dont
  // chaque entrée porte un historique.
  if (!estObjet(brut.metrics)) return null

  const avertissements: string[] = []
  const series: Record<string, { j: Jour; v: number }[]> = {}

  for (const [idAthlos, valeur] of Object.entries(brut.metrics)) {
    if (!estObjet(valeur) || !Array.isArray(valeur.history)) continue
    const id = CORRESPONDANCES[idAthlos] ?? idAthlos
    const points: { j: Jour; v: number }[] = []
    for (const p of valeur.history) {
      if (!estObjet(p)) continue
      const date = p.date
      const v = p.value
      if (typeof date !== 'string' || typeof v !== 'number' || !Number.isFinite(v)) continue
      if (!estJourValide(date)) continue
      points.push({ j: date, v })
    }
    if (points.length > 0) series[id] = points
  }

  // Séances : une annotation par date, et le tonnage total en série à part.
  // Le tonnage (kilos × répétitions) n'est pas la « charge » de CORPUS, qui
  // est en unités arbitraires : les mélanger fausserait aiguë et chronique.
  const annotations: Annotation[] = []
  const tonnages: { j: Jour; v: number }[] = []
  if (Array.isArray(brut.sessions)) {
    let n = 0
    for (const s of brut.sessions) {
      if (!estObjet(s) || typeof s.date !== 'string' || !estJourValide(s.date)) continue
      let tonnage = 0
      if (Array.isArray(s.entries)) {
        for (const e of s.entries) {
          if (!estObjet(e) || !Array.isArray(e.sets)) continue
          for (const set of e.sets) {
            if (!estObjet(set)) continue
            const reps = set.reps
            const kg = set.weightKg
            if (typeof reps === 'number' && typeof kg === 'number') tonnage += reps * kg
          }
        }
      }
      annotations.push({
        id: `athlos-${n++}`,
        j: s.date,
        type: 'seance',
        note: tonnage > 0 ? `${Math.round(tonnage)} kg de tonnage` : 'Séance ATHLOS',
      })
      if (tonnage > 0) tonnages.push({ j: s.date, v: Math.round(tonnage) })
    }
    if (tonnages.length > 0) {
      series.tonnage = tonnages
      avertissements.push(
        'Le tonnage des séances est importé comme métrique distincte : ce n’est pas la ' +
          '« charge de séance » de CORPUS, qui est en unités arbitraires.',
      )
    }
  }

  const profil: Profil = {}
  if (estObjet(brut.physical)) {
    const p = brut.physical
    if (typeof p.heightCm === 'number') profil.tailleCm = p.heightCm
    if (p.sex === 'male') profil.sexe = 'h'
    else if (p.sex === 'female') profil.sexe = 'f'
    else if (p.sex === 'unspecified') profil.sexe = 'nsp'
    if (typeof p.birthDate === 'string' && estJourValide(p.birthDate)) profil.naissance = p.birthDate
  }

  const nonCatalogue = Object.keys(series).filter(
    (id) => id !== 'tonnage' && !Object.values(CORRESPONDANCES).includes(id),
  )
  if (nonCatalogue.length > 0) {
    avertissements.push(
      `Métriques de performance ATHLOS conservées telles quelles : ${nonCatalogue.join(', ')}.`,
    )
  }

  const normalisees: Record<string, Serie> = {}
  for (const [id, points] of Object.entries(series)) normalisees[id] = normaliserSerie(points)

  return {
    series: normalisees,
    annotations,
    profil,
    nomProfil: typeof brut.displayName === 'string' ? brut.displayName : undefined,
    discipline: typeof brut.disciplineId === 'string' ? brut.disciplineId : undefined,
    avertissements,
  }
}
