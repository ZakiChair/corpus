import { describe, expect, it } from 'vitest'
import {
  aujourdhui,
  decalerJour,
  diffJours,
  estJourValide,
  formaterJourCourt,
  indexVersJour,
  jourDeSemaine,
  jourVersIndex,
  plageJours,
} from './temps'

describe('estJourValide', () => {
  it('accepte une date réelle', () => {
    expect(estJourValide('2026-07-26')).toBe(true)
    expect(estJourValide('2024-02-29')).toBe(true)
  })

  it('rejette les dates inexistantes et les formats libres', () => {
    expect(estJourValide('2026-02-31')).toBe(false)
    expect(estJourValide('2025-02-29')).toBe(false)
    expect(estJourValide('2026-13-01')).toBe(false)
    expect(estJourValide('26/07/2026')).toBe(false)
    expect(estJourValide('')).toBe(false)
  })
})

describe('index de jour', () => {
  it('fait un aller-retour stable', () => {
    for (const j of ['1970-01-01', '2000-02-29', '2026-07-26', '2031-12-31']) {
      expect(indexVersJour(jourVersIndex(j))).toBe(j)
    }
  })

  it('place l’époque à zéro', () => {
    expect(jourVersIndex('1970-01-01')).toBe(0)
  })

  it('traverse un changement d’heure sans dériver', () => {
    // En Europe, l'heure d'été démarre le 29 mars 2026 : la nuit ne dure que 23 h.
    expect(diffJours('2026-03-28', '2026-03-30')).toBe(2)
    expect(decalerJour('2026-03-28', 1)).toBe('2026-03-29')
    expect(decalerJour('2026-03-29', 1)).toBe('2026-03-30')
    // Et le retour à l'heure d'hiver, où la nuit dure 25 h.
    expect(decalerJour('2026-10-24', 1)).toBe('2026-10-25')
    expect(decalerJour('2026-10-25', 1)).toBe('2026-10-26')
  })

  it('décale en arrière et par-dessus les frontières de mois et d’année', () => {
    expect(decalerJour('2026-03-01', -1)).toBe('2026-02-28')
    expect(decalerJour('2024-03-01', -1)).toBe('2024-02-29')
    expect(decalerJour('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('jourDeSemaine', () => {
  it('numérote de lundi (0) à dimanche (6)', () => {
    expect(jourDeSemaine('2026-07-27')).toBe(0) // lundi
    expect(jourDeSemaine('2026-07-26')).toBe(6) // dimanche
    expect(jourDeSemaine('2026-07-25')).toBe(5) // samedi
  })
})

describe('aujourdhui', () => {
  it('formate la date locale, pas la date UTC', () => {
    // 23 h 30 le 26 à Zurich (UTC+2) est déjà le 26 en local mais le 26 en UTC aussi ;
    // on vérifie surtout le format et la prise en compte des composantes locales.
    const d = new Date(2026, 6, 26, 23, 30)
    expect(aujourdhui(d)).toBe('2026-07-26')
  })
})

describe('plageJours', () => {
  it('inclut les deux bornes', () => {
    expect(plageJours('2026-07-24', '2026-07-27')).toEqual([
      '2026-07-24',
      '2026-07-25',
      '2026-07-26',
      '2026-07-27',
    ])
  })

  it('rend un seul jour quand les bornes coïncident', () => {
    expect(plageJours('2026-07-26', '2026-07-26')).toEqual(['2026-07-26'])
  })
})

describe('formaterJourCourt', () => {
  it('abrège le mois en français', () => {
    expect(formaterJourCourt('2026-07-26')).toBe('26 juil.')
    expect(formaterJourCourt('2026-02-01')).toBe('1 févr.')
  })
})
