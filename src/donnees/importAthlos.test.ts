import { describe, expect, it } from 'vitest'
import { importerAthlos } from './importAthlos'

/**
 * Le fixture reproduit la forme réelle du `Profile` exporté par ATHLOS
 * (~/ATHLOS, src/core/types/index.ts) : métriques indexées par identifiant,
 * chacune portant un `history` de `{ value, date }`, et des séances dont
 * chaque entrée contient des séries de `{ reps, weightKg }`.
 */
const PROFIL_ATHLOS = {
  id: 'p1',
  displayName: 'Zaki',
  disciplineId: 'powerlifting',
  physical: { heightCm: 181, weightKg: 79, sex: 'male', birthDate: '1996-04-12' },
  metrics: {
    weight: {
      id: 'weight',
      label: 'Poids',
      unit: 'kg',
      category: 'morphology',
      history: [
        { value: 79.2, date: '2026-07-01' },
        { value: 78.8, date: '2026-07-08' },
      ],
    },
    waist: {
      id: 'waist',
      label: 'Tour de taille',
      unit: 'cm',
      category: 'morphology',
      history: [{ value: 82, date: '2026-07-01' }],
    },
    squat_1rm: {
      id: 'squat_1rm',
      label: 'Squat 1RM',
      unit: 'kg',
      category: 'performance',
      history: [
        { value: 160, date: '2026-06-01' },
        { value: 165, date: '2026-07-05' },
      ],
    },
  },
  goals: [],
  sessions: [
    {
      id: 's1',
      date: '2026-07-05',
      entries: [
        { id: 'e1', label: 'Squat', metricId: 'squat_1rm', sets: [{ reps: 5, weightKg: 140 }, { reps: 5, weightKg: 140 }] },
        { id: 'e2', label: 'Développé', sets: [{ reps: 8, weightKg: 80 }] },
      ],
    },
    { id: 's2', date: '2026-07-08', entries: [{ id: 'e3', label: 'Soulevé', sets: [{ reps: 3, weightKg: 180 }] }] },
  ],
  avatarConfig: {},
  themeId: 'synthwave',
  createdAt: '2026-01-01',
}

describe('importerAthlos', () => {
  it('rejette ce qui n’est pas un profil ATHLOS', () => {
    expect(importerAthlos(null)).toBeNull()
    expect(importerAthlos({ series: {} })).toBeNull()
    expect(importerAthlos('texte')).toBeNull()
  })

  it('traduit les métriques qui ont un équivalent au catalogue', () => {
    const r = importerAthlos(PROFIL_ATHLOS)!
    expect(r.series.poids).toEqual([
      { j: '2026-07-01', v: 79.2 },
      { j: '2026-07-08', v: 78.8 },
    ])
    expect(r.series.tour_taille).toEqual([{ j: '2026-07-01', v: 82 }])
    expect(r.series.weight).toBeUndefined()
  })

  it('conserve les métriques de performance sous leur nom ATHLOS', () => {
    const r = importerAthlos(PROFIL_ATHLOS)!
    expect(r.series.squat_1rm).toHaveLength(2)
    expect(r.avertissements.join(' ')).toContain('squat_1rm')
  })

  it('transforme les séances en annotations datées', () => {
    const r = importerAthlos(PROFIL_ATHLOS)!
    expect(r.annotations).toHaveLength(2)
    expect(r.annotations[0]!.type).toBe('seance')
    expect(r.annotations[0]!.j).toBe('2026-07-05')
  })

  it('calcule le tonnage sans le confondre avec la charge de CORPUS', () => {
    const r = importerAthlos(PROFIL_ATHLOS)!
    // 5×140 + 5×140 + 8×80 = 2040 kg
    expect(r.series.tonnage).toEqual([
      { j: '2026-07-05', v: 2040 },
      { j: '2026-07-08', v: 540 },
    ])
    // La charge de CORPUS est en unités arbitraires : la confondre avec un
    // tonnage en kilos fausserait aiguë et chronique d'un facteur mille.
    expect(r.series.charge_seance).toBeUndefined()
    expect(r.avertissements.join(' ')).toContain('unités arbitraires')
  })

  it('reprend le profil physique', () => {
    const r = importerAthlos(PROFIL_ATHLOS)!
    expect(r.profil).toEqual({ tailleCm: 181, sexe: 'h', naissance: '1996-04-12' })
    expect(r.nomProfil).toBe('Zaki')
    expect(r.discipline).toBe('powerlifting')
  })

  it('ignore les points malformés sans rejeter tout le fichier', () => {
    const abime = {
      metrics: {
        weight: {
          history: [
            { value: 79, date: '2026-07-01' },
            { value: 'lourd', date: '2026-07-02' },
            { value: 78, date: 'pas-une-date' },
            { date: '2026-07-04' },
            { value: 77.5, date: '2026-07-05' },
          ],
        },
      },
    }
    const r = importerAthlos(abime)!
    expect(r.series.poids).toEqual([
      { j: '2026-07-01', v: 79 },
      { j: '2026-07-05', v: 77.5 },
    ])
  })

  it('accepte un profil sans séances', () => {
    const r = importerAthlos({ metrics: { weight: { history: [{ value: 79, date: '2026-07-01' }] } } })!
    expect(r.annotations).toEqual([])
    expect(r.series.tonnage).toBeUndefined()
  })
})
