import { describe, expect, it } from 'vitest'
import { decalerJour } from '../core/temps'
import type { Serie } from '../core/types'
import { creerAlea, gaussienne } from '../donnees/alea'
import {
  MARGE_PIC,
  meilleurDecalage,
  pearson,
  profilDecalage,
  rangs,
  seuilSignificativite,
  spearman,
} from './correlation'

function serieDepuis(debut: string, valeurs: number[]): Serie {
  return valeurs.map((v, i) => ({ j: decalerJour(debut, i), v }))
}

describe('pearson', () => {
  it('vaut 1 pour une relation linéaire croissante', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10)
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10)
  })

  it('rend NaN si un vecteur est constant ou trop court', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNaN()
    expect(pearson([1, 2], [1, 2])).toBeNaN()
  })
})

describe('rangs', () => {
  it('partage la moyenne des rangs entre ex æquo', () => {
    // 10 est le plus petit (rang 1), les deux 20 partagent les rangs 2 et 3.
    expect(rangs([10, 20, 20, 40])).toEqual([1, 2.5, 2.5, 4])
  })
})

describe('spearman', () => {
  it('capte une relation monotone non linéaire que Pearson sous-estime', () => {
    const xs = [1, 2, 3, 4, 5, 6]
    const ys = xs.map((x) => x ** 4)
    expect(spearman(xs, ys)).toBeCloseTo(1, 10)
    expect(pearson(xs, ys)).toBeLessThan(0.95)
  })

  it('résiste à une valeur aberrante isolée', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8]
    const ys = [1, 2, 3, 4, 5, 6, 7, 900]
    expect(spearman(xs, ys)).toBeCloseTo(1, 10)
  })
})

describe('profilDecalage', () => {
  it('retrouve un décalage injecté', () => {
    const alea = creerAlea(42)
    const base = Array.from({ length: 200 }, () => gaussienne(alea, 0, 1))
    const a = serieDepuis('2026-01-01', base)
    // b est a décalé de trois jours vers le futur, plus un peu de bruit.
    const b = serieDepuis(
      '2026-01-01',
      base.map((_, i) => (i >= 3 ? base[i - 3]! : 0) + gaussienne(alea, 0, 0.2)),
    )
    const profil = profilDecalage(a, b, 6)
    const pic = profil.reduce((m, c) => (Math.abs(c.r) > Math.abs(m.r) ? c : m))
    expect(pic.decalage).toBe(3)
    expect(pic.r).toBeGreaterThan(0.9)
  })
})

describe('meilleurDecalage', () => {
  it('n’annonce pas de décalage quand le profil est un plateau', () => {
    // Deux séries à forte tendance commune : elles corrèlent à ~1 à TOUS les
    // décalages. Choisir l'argmax d'un plateau reviendrait à tirer au sort,
    // puis à présenter le tirage comme une découverte causale.
    const alea = creerAlea(7)
    const n = 200
    const a = serieDepuis(
      '2026-01-01',
      Array.from({ length: n }, (_, i) => 80 - i * 0.05 + gaussienne(alea, 0, 0.15)),
    )
    const b = serieDepuis(
      '2026-01-01',
      Array.from({ length: n }, (_, i) => 20 - i * 0.03 + gaussienne(alea, 0, 0.12)),
    )
    const c = meilleurDecalage(a, b, 5)
    expect(c).toBeDefined()
    expect(Math.abs(c!.r)).toBeGreaterThan(0.9) // la corrélation EST forte
    expect(c!.decalage).toBe(0) // mais elle n'a pas de sens temporel
  })

  it('annonce le décalage quand le pic ressort vraiment', () => {
    const alea = creerAlea(11)
    const base = Array.from({ length: 240 }, () => gaussienne(alea, 0, 1))
    const a = serieDepuis('2026-01-01', base)
    const b = serieDepuis(
      '2026-01-01',
      base.map((_, i) => (i >= 2 ? base[i - 2]! : 0) + gaussienne(alea, 0, 0.35)),
    )
    const c = meilleurDecalage(a, b, 5)
    expect(c!.decalage).toBe(2)
  })

  it('respecte une marge de pic explicite', () => {
    const alea = creerAlea(3)
    const base = Array.from({ length: 240 }, () => gaussienne(alea, 0, 1))
    const a = serieDepuis('2026-01-01', base)
    const b = serieDepuis(
      '2026-01-01',
      base.map((_, i) => (i >= 2 ? base[i - 2]! : 0) + gaussienne(alea, 0, 0.35)),
    )
    // Une marge irréaliste force le retour au décalage contemporain.
    expect(meilleurDecalage(a, b, 5, 'spearman', 20, 2)!.decalage).toBe(0)
    expect(MARGE_PIC).toBeGreaterThan(0)
  })

  it('écarte les décalages trop peu appariés', () => {
    const court = serieDepuis('2026-01-01', [1, 2, 3, 4, 5])
    expect(meilleurDecalage(court, court, 3, 'spearman', 20)).toBeUndefined()
  })
})

describe('seuilSignificativite', () => {
  it('décroît quand l’effectif augmente', () => {
    expect(seuilSignificativite(20)).toBeGreaterThan(seuilSignificativite(200))
    expect(seuilSignificativite(400)).toBeLessThan(0.12)
  })

  it('rejette tout sur un effectif dérisoire', () => {
    expect(seuilSignificativite(3)).toBe(1)
  })
})
