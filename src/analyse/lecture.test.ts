import { describe, expect, it } from 'vitest'
import { decalerJour } from '../core/temps'
import type { Serie } from '../core/types'
import {
  AVERTISSEMENT,
  ecartAMediane,
  lireCouverture,
  lireEcart,
  lireRang,
  lireRegime,
  lireTendance,
} from './lecture'

describe('lireEcart', () => {
  it('reste neutre près de zéro', () => {
    expect(lireEcart(0.2)).toBe('dans ta normale 30 j')
  })

  it('donne le sens et la fenêtre', () => {
    expect(lireEcart(-1.23, 14)).toBe('1,2 σ sous ta normale 14 j')
    expect(lireEcart(2.05, 90)).toBe('2,1 σ au-dessus de ta normale 90 j')
  })

  it('avoue un historique insuffisant plutôt que d’inventer', () => {
    expect(lireEcart(Number.NaN)).toBe('pas assez d’historique')
  })
})

describe('lireRang', () => {
  it('nomme les extrêmes', () => {
    expect(lireRang(0.99)).toBe('record haut de ton historique')
    expect(lireRang(0.01)).toBe('record bas de ton historique')
  })

  it('donne le percentile sinon', () => {
    expect(lireRang(0.42)).toBe('42ᵉ percentile de ton historique')
  })
})

describe('lireTendance', () => {
  it('déclare stable une pente sous la résolution de la métrique', () => {
    // 0,001 kg/j × 30 j = 0,03 kg, sous le demi-dixième affichable.
    expect(lireTendance(0.001, 'poids')).toBe('stable sur 30 jours')
  })

  it('quantifie sans juger', () => {
    expect(lireTendance(-0.03, 'poids')).toBe('−0,9 kg sur 30 jours')
    expect(lireTendance(0.05, 'poids', 30)).toBe('+1,5 kg sur 30 jours')
  })
})

describe('lireRegime', () => {
  it('reconnaît l’absence de composite', () => {
    expect(lireRegime(Number.NaN)).toBe('Pas assez de mesures pour situer la journée.')
  })

  it('nomme la bande et la contribution dominante', () => {
    const phrase = lireRegime(-1.4, { id: 'vfc', z: -2.1, poids: 1 })
    expect(phrase).toContain('Nettement en dessous')
    expect(phrase).toContain('Variabilité cardiaque')
    expect(phrase).toContain('vers le bas')
  })
})

describe('ecartAMediane : fenêtre calendaire', () => {
  it('compare aux N derniers JOURS, pas aux N derniers points', () => {
    // Métrique hebdomadaire : un point tous les 7 jours pendant un an, à 80,
    // puis un dernier mois à 90. Sur une fenêtre de 30 JOURS la référence est
    // ~90 ; une fenêtre de 30 POINTS remonterait sept mois et dirait +10.
    const s: Serie = []
    const base = '2025-07-01'
    for (let i = 0; i < 52; i++) {
      s.push({ j: decalerJour(base, i * 7), v: i >= 47 ? 90 : 80 })
    }
    expect(ecartAMediane(s, 30)).toBeCloseTo(0, 6)
  })

  it('refuse de conclure sur moins de trois références', () => {
    const s: Serie = [
      { j: '2026-07-01', v: 80 },
      { j: '2026-07-20', v: 82 },
    ]
    expect(ecartAMediane(s, 30)).toBeNaN()
  })
})

describe('lireCouverture', () => {
  it('résume points, période et taux', () => {
    expect(lireCouverture(45, 90)).toBe('45 mesures sur 90 jours (50 %)')
  })
})

describe('règle descriptive', () => {
  it('aucune tournure prescriptive dans les sorties', () => {
    // La règle du module tient en une ligne : décrire, jamais conseiller.
    const sorties = [
      lireEcart(-2.5),
      lireEcart(1.8),
      lireRang(0.03),
      lireTendance(-0.05, 'poids'),
      lireRegime(-1.6, { id: 'vfc', z: -2, poids: 1 }),
      AVERTISSEMENT,
    ].join(' ')
    for (const interdit of ['devrais', 'repose-toi', 'conseill', 'il faut', 'attention']) {
      expect(sorties.toLowerCase()).not.toContain(interdit)
    }
  })
})
