import { describe, expect, it } from 'vitest'
import { valeurAuJour } from '../analyse/stats'
import { estAutoExport, importerAutoExport } from './importAutoExport'

/** Fixture au format Health Auto Export, réglages « agrégation par jour ». */
const EXPORT = {
  data: {
    metrics: [
      {
        name: 'heart_rate_variability',
        units: 'ms',
        data: [
          { date: '2026-07-25 07:12:03 +0200', qty: 58 },
          { date: '2026-07-25 09:30:00 +0200', qty: 64 },
          { date: '2026-07-25 22:00:00 +0200', qty: 94 },
        ],
      },
      {
        name: 'weight_body_mass',
        units: 'lb',
        data: [{ date: '2026-07-25 07:00:00 +0200', qty: 165.3 }],
      },
      {
        name: 'step_count',
        units: 'count',
        data: [
          { date: '2026-07-25 08:00:00 +0200', qty: 1200 },
          { date: '2026-07-25 14:00:00 +0200', qty: 6300 },
        ],
      },
      {
        name: 'sleep_analysis',
        units: 'hr',
        data: [
          {
            date: '2026-07-25 07:15:00 +0200',
            sleepStart: '2026-07-25 00:30:00 +0200',
            sleepEnd: '2026-07-25 07:15:00 +0200',
            core: 3.9,
            deep: 1.4,
            rem: 1.2,
            awake: 0.25,
          },
        ],
      },
      {
        name: 'heart_rate',
        units: 'count/min',
        data: [{ date: '2026-07-25 03:00:00 +0200', qty: 52 }],
      },
    ],
    workouts: [
      {
        name: 'Traditional Strength Training',
        start: '2026-07-25 18:00:00 +0200',
        end: '2026-07-25 19:02:00 +0200',
      },
    ],
  },
}

describe('reconnaissance', () => {
  it('reconnaît la signature data.metrics', () => {
    expect(estAutoExport(EXPORT)).toBe(true)
    expect(estAutoExport({ metrics: [] })).toBe(false)
    expect(estAutoExport(null)).toBe(false)
  })
})

describe('importerAutoExport', () => {
  const r = importerAutoExport(EXPORT)!

  it('médiane les mesures répétées et convertit les unités', () => {
    expect(valeurAuJour(r.series.vfc!, '2026-07-25')).toBe(64)
    expect(valeurAuJour(r.series.poids!, '2026-07-25')).toBeCloseTo(74.98, 1)
  })

  it('somme les pas', () => {
    expect(valeurAuJour(r.series.pas!, '2026-07-25')).toBe(7500)
  })

  it('reconstruit la nuit : durée depuis le détail, coucher monotone', () => {
    // core + deep + rem = 6,5 h ; le champ awake n'en fait pas partie.
    expect(valeurAuJour(r.series.sommeil_duree!, '2026-07-25')).toBeCloseTo(6.5, 2)
    expect(valeurAuJour(r.series.sommeil_profond!, '2026-07-25')).toBeCloseTo(1.4, 2)
    // Coucher à 0 h 30 → 24,5 en heures monotones.
    expect(valeurAuJour(r.series.sommeil_coucher!, '2026-07-25')).toBeCloseTo(24.5, 2)
  })

  it('traduit les séances avec leur durée', () => {
    expect(r.annotations).toHaveLength(1)
    expect(r.annotations[0]!.j).toBe('2026-07-25')
    expect(r.annotations[0]!.note).toBe('Musculation — 62 min')
  })

  it('compte les métriques non prises en charge sans rejeter le fichier', () => {
    expect(r.typesIgnores.map((t) => t.type)).toContain('heart_rate')
    expect(r.series.heart_rate).toBeUndefined()
  })

  it('prend le champ asleep quand le détail des phases manque', () => {
    const minimal = {
      data: {
        metrics: [
          {
            name: 'sleep_analysis',
            units: 'hr',
            data: [{ date: '2026-07-20 07:00:00 +0200', asleep: 7.8 }],
          },
        ],
      },
    }
    const r2 = importerAutoExport(minimal)!
    expect(valeurAuJour(r2.series.sommeil_duree!, '2026-07-20')).toBeCloseTo(7.8, 2)
  })

  it('tranche l’échelle de la masse grasse sur tout le fichier', () => {
    const fractions = {
      data: {
        metrics: [
          {
            name: 'body_fat_percentage',
            units: '%',
            data: [
              { date: '2026-07-20 07:00:00 +0200', qty: 0.152 },
              { date: '2026-07-21 07:00:00 +0200', qty: 0.148 },
            ],
          },
        ],
      },
    }
    const r2 = importerAutoExport(fractions)!
    expect(valeurAuJour(r2.series.masse_grasse!, '2026-07-20')).toBeCloseTo(15.2, 3)
    expect(r2.avertissements.join(' ')).toContain('fraction')
  })
})
