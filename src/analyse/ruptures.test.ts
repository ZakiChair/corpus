import { describe, expect, it } from 'vitest'
import { decalerJour, diffJours } from '../core/temps'
import type { Serie } from '../core/types'
import { detecterRuptures, ruptureRecente } from './ruptures'

const DEPART = '2026-01-01'

/** Série journalière construite par une fonction de l'index. */
function serie(n: number, valeur: (i: number) => number): Serie {
  return Array.from({ length: n }, (_, i) => ({ j: decalerJour(DEPART, i), v: valeur(i) }))
}

/** Variation déterministe (−1, 0, +1 en boucle) tenant lieu de bruit. */
const bruit = (i: number) => (i % 3) - 1

describe('detecterRuptures', () => {
  it('trouve un saut de palier, une seule fois, près du bon jour', () => {
    const s = serie(120, (i) => (i < 60 ? 50 : 58) + bruit(i))
    const ruptures = detecterRuptures(s)
    expect(ruptures).toHaveLength(1)
    const r = ruptures[0]!
    expect(Math.abs(diffJours(decalerJour(DEPART, 60), r.jour))).toBeLessThanOrEqual(7)
    // Le saut injecté vaut 8 ; les médianes du bruit peuvent décaler d'une
    // demi-unité selon la fenêtre retenue.
    expect(r.apres - r.avant).toBeGreaterThan(6.5)
    expect(r.apres - r.avant).toBeLessThan(9.5)
    expect(r.ecartSigma).toBeGreaterThan(2)
  })

  it('voit le sens de la rupture', () => {
    const s = serie(120, (i) => (i < 60 ? 58 : 50) + bruit(i))
    const r = detecterRuptures(s)[0]!
    expect(r.ecartSigma).toBeLessThan(-2)
  })

  it('ne prend pas une dérive lente pour une rupture', () => {
    // Une pente régulière est le travail de la tendance : sur les fenêtres de
    // comparaison, l'écart des médianes reste sous le seuil.
    const s = serie(120, (i) => 50 + i * 0.04 + bruit(i))
    expect(detecterRuptures(s)).toHaveLength(0)
  })

  it('reste muet sur une série stable', () => {
    const s = serie(120, (i) => 50 + bruit(i))
    expect(detecterRuptures(s)).toHaveLength(0)
  })

  it('détecte deux ruptures distinctes et éloignées', () => {
    const s = serie(200, (i) => (i < 70 ? 50 : i < 140 ? 58 : 50) + bruit(i))
    const ruptures = detecterRuptures(s)
    expect(ruptures).toHaveLength(2)
    expect(ruptures[0]!.ecartSigma).toBeGreaterThan(0)
    expect(ruptures[1]!.ecartSigma).toBeLessThan(0)
  })
})

describe('ruptureRecente', () => {
  it('rend la rupture quand elle vient de se produire', () => {
    const s = serie(120, (i) => (i < 100 ? 50 : 58) + bruit(i))
    expect(ruptureRecente(s, 30)).toBeDefined()
  })

  it('tait une rupture ancienne', () => {
    const s = serie(120, (i) => (i < 30 ? 50 : 58) + bruit(i))
    expect(ruptureRecente(s, 21)).toBeUndefined()
  })
})
