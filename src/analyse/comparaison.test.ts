import { describe, expect, it } from 'vitest'
import { decalerJour } from '../core/temps'
import type { Serie } from '../core/types'
import { comparerPeriodes, fenetresAdjacentes } from './comparaison'

const DEPART = '2026-01-01'

function serie(n: number, valeur: (i: number) => number): Serie {
  return Array.from({ length: n }, (_, i) => ({ j: decalerJour(DEPART, i), v: valeur(i) }))
}

const bruit = (i: number) => ((i * 7) % 5) - 2 // −2 … +2, déterministe

describe('comparerPeriodes', () => {
  it('déclare significatif un vrai changement de niveau', () => {
    const s = serie(56, (i) => (i < 28 ? 50 : 58) + bruit(i))
    const r = comparerPeriodes(
      s,
      { debut: DEPART, fin: decalerJour(DEPART, 27) },
      { debut: decalerJour(DEPART, 28), fin: decalerJour(DEPART, 55) },
    )!
    expect(r.delta).toBeCloseTo(8, 0)
    expect(r.significatif).toBe(true)
    expect(r.icBas).toBeGreaterThan(0)
    expect(r.nA).toBe(28)
  })

  it('ne fabrique pas d’écart sur deux périodes semblables', () => {
    const s = serie(56, (i) => 50 + bruit(i))
    const r = comparerPeriodes(
      s,
      { debut: DEPART, fin: decalerJour(DEPART, 27) },
      { debut: decalerJour(DEPART, 28), fin: decalerJour(DEPART, 55) },
    )!
    expect(r.significatif).toBe(false)
    expect(r.icBas).toBeLessThanOrEqual(0)
    expect(r.icHaut).toBeGreaterThanOrEqual(0)
  })

  it('est déterministe : même graine, même intervalle', () => {
    const s = serie(56, (i) => (i < 28 ? 50 : 55) + bruit(i))
    const p = [
      { debut: DEPART, fin: decalerJour(DEPART, 27) },
      { debut: decalerJour(DEPART, 28), fin: decalerJour(DEPART, 55) },
    ] as const
    expect(comparerPeriodes(s, p[0], p[1])).toEqual(comparerPeriodes(s, p[0], p[1]))
  })

  it('refuse de conclure sur une période trop pauvre', () => {
    const s = serie(10, () => 50)
    expect(
      comparerPeriodes(
        s,
        { debut: DEPART, fin: decalerJour(DEPART, 3) },
        { debut: decalerJour(DEPART, 4), fin: decalerJour(DEPART, 9) },
      ),
    ).toBeUndefined()
  })
})

describe('fenetresAdjacentes', () => {
  it('colle deux fenêtres de même longueur sans trou ni chevauchement', () => {
    const { ancienne, recente } = fenetresAdjacentes('2026-07-26', 28)
    expect(recente.fin).toBe('2026-07-26')
    expect(recente.debut).toBe('2026-06-29')
    expect(ancienne.fin).toBe('2026-06-28')
    expect(ancienne.debut).toBe('2026-06-01')
  })
})
