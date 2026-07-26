import { describe, expect, it } from 'vitest'
import type { Serie } from '../core/types'
import {
  bornes,
  densifier,
  derniersJours,
  ecartAbsoluMedian,
  ecartType,
  ema,
  fenetreGlissante,
  mediane,
  moyenne,
  moyenneGlissante,
  penteParJour,
  quantile,
  rangPercentile,
  regressionLineaire,
  valeurAuJour,
  zScore,
  zScoreGlissant,
} from './stats'

function serieDepuis(debut: string, valeurs: number[]): Serie {
  const base = new Date(`${debut}T00:00:00Z`).getTime()
  return valeurs.map((v, i) => ({
    j: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    v,
  }))
}

describe('agrégats', () => {
  it('calcule moyenne et médiane', () => {
    expect(moyenne([1, 2, 3, 4])).toBe(2.5)
    expect(mediane([1, 2, 3, 4])).toBe(2.5)
    expect(mediane([3, 1, 2])).toBe(2)
  })

  it('rend NaN sur un tableau vide plutôt que zéro', () => {
    // Zéro serait un mensonge : « pas de donnée » n'est pas « moyenne nulle ».
    expect(moyenne([])).toBeNaN()
    expect(mediane([])).toBeNaN()
    expect(bornes([]).min).toBeNaN()
  })

  it('utilise le dénominateur n − 1 par défaut', () => {
    // Pour [2,4,4,4,5,5,7,9] : σ population = 2, σ échantillon ≈ 2,138.
    const xs = [2, 4, 4, 4, 5, 5, 7, 9]
    expect(ecartType(xs, true)).toBeCloseTo(2, 10)
    expect(ecartType(xs)).toBeCloseTo(2.13809, 4)
  })

  it('interpole les quantiles', () => {
    const xs = [1, 2, 3, 4, 5]
    expect(quantile(xs, 0)).toBe(1)
    expect(quantile(xs, 1)).toBe(5)
    expect(quantile(xs, 0.25)).toBe(2)
    expect(quantile(xs, 0.125)).toBeCloseTo(1.5, 10)
  })

  it('résiste aux valeurs aberrantes avec l’écart absolu médian', () => {
    const propre = [10, 11, 12, 11, 10, 12, 11]
    const pollue = [...propre, 900] // un poids saisi en livres
    expect(ecartType(pollue)).toBeGreaterThan(10 * ecartType(propre))
    expect(ecartAbsoluMedian(pollue)).toBeCloseTo(ecartAbsoluMedian(propre), 5)
  })

  it('situe une valeur en rang percentile', () => {
    expect(rangPercentile([1, 2, 3, 4], 2)).toBe(0.5)
    expect(rangPercentile([1, 2, 3, 4], 0)).toBe(0)
    expect(rangPercentile([1, 2, 3, 4], 9)).toBe(1)
  })

  it('normalise avec zScore', () => {
    expect(zScore(5, [1, 2, 3, 4, 5])).toBeCloseTo(1.2649, 3)
    expect(zScore(5, [3, 3, 3])).toBeNaN() // dispersion nulle
  })
})

describe('regressionLineaire', () => {
  it('retrouve exactement une droite', () => {
    const r = regressionLineaire([0, 1, 2, 3], [1, 3, 5, 7])
    expect(r.pente).toBeCloseTo(2, 10)
    expect(r.ordonnee).toBeCloseTo(1, 10)
    expect(r.r2).toBeCloseTo(1, 10)
  })

  it('rend NaN si x est constant', () => {
    expect(regressionLineaire([2, 2, 2], [1, 2, 3]).pente).toBeNaN()
  })
})

describe('penteParJour', () => {
  it('mesure la tendance en unités par jour, trous compris', () => {
    // Une hausse de 1 par jour, mais avec deux jours manquants au milieu.
    const serie: Serie = [
      { j: '2026-01-01', v: 10 },
      { j: '2026-01-02', v: 11 },
      { j: '2026-01-05', v: 14 },
      { j: '2026-01-06', v: 15 },
    ]
    expect(penteParJour(serie)).toBeCloseTo(1, 10)
  })
})

describe('fenetreGlissante', () => {
  it('borne la fenêtre en JOURS et non en nombre de points', () => {
    // Trois points serrés, puis un point très éloigné : sa fenêtre 7 jours
    // ne doit contenir que lui-même.
    const serie: Serie = [
      { j: '2026-01-01', v: 100 },
      { j: '2026-01-02', v: 100 },
      { j: '2026-01-03', v: 100 },
      { j: '2026-03-01', v: 1 },
    ]
    const m = moyenneGlissante(serie, 7)
    expect(m[m.length - 1]!.v).toBe(1)
  })

  it('inclut le jour courant quand on le demande', () => {
    const serie = serieDepuis('2026-01-01', [1, 2, 3])
    const avec = fenetreGlissante(serie, 3, moyenne, { inclureJour: true })
    const sans = fenetreGlissante(serie, 3, moyenne, { inclureJour: false })
    const au = (s: Serie, j: string) => s.find((p) => p.j === j)!.v
    expect(au(avec, '2026-01-03')).toBeCloseTo(2, 10) // (1+2+3)/3
    expect(au(sans, '2026-01-03')).toBeCloseTo(1.5, 10) // (1+2)/2
    // Le premier jour n'a aucun antécédent : il disparaît de la sortie exclusive.
    expect(sans.some((p) => p.j === '2026-01-01')).toBe(false)
  })

  it('omet les points dont la fenêtre est trop pauvre', () => {
    const serie = serieDepuis('2026-01-01', [1, 2, 3, 4, 5])
    const r = fenetreGlissante(serie, 30, moyenne, { minimum: 4 })
    expect(r).toHaveLength(2) // seuls les 4ᵉ et 5ᵉ points ont 4 observations
  })
})

describe('zScoreGlissant', () => {
  it('exige un minimum d’observations avant de produire un z', () => {
    const serie = serieDepuis('2026-01-01', Array.from({ length: 20 }, (_, i) => i))
    const z = zScoreGlissant(serie, 30, 7)
    expect(z[0]!.j).toBe('2026-01-08') // les 7 premiers jours servent de base
  })

  it('n’invente pas de z quand la base est parfaitement plate', () => {
    // Dix fois 10 puis un pic : la référence a un écart-type nul, le z serait
    // infini. On préfère omettre le point que produire un chiffre absurde.
    const serie = serieDepuis('2026-01-01', [...Array.from({ length: 10 }, () => 10), 20])
    expect(zScoreGlissant(serie, 30, 7)).toEqual([])
  })

  it('exclut le jour lui-même de sa référence', () => {
    // Même série, deux calculs : le nôtre (référence = passé seul) et un z
    // naïf où le pic entre dans sa propre référence. Inclure le pic tire la
    // moyenne vers le haut et gonfle la dispersion, donc amortit l'anomalie.
    const base = [10, 11, 9, 10, 12, 8, 10, 11, 9, 10]
    const serie = serieDepuis('2026-01-01', [...base, 20])
    const exclusif = zScoreGlissant(serie, 30, 7).find((p) => p.j === '2026-01-11')!.v
    const inclusif = zScore(20, [...base, 20])
    expect(exclusif).toBeGreaterThan(inclusif)
  })

  it('signale une anomalie sur une base bruitée', () => {
    const base = [10, 11, 9, 10, 12, 8, 10, 11, 9, 10]
    const serie = serieDepuis('2026-01-01', [...base, 20])
    const z = zScoreGlissant(serie, 30, 7)
    const dernier = z[z.length - 1]!
    expect(dernier.j).toBe('2026-01-11')
    expect(dernier.v).toBeGreaterThan(3)
  })
})

describe('ema', () => {
  it('démarre sur la première valeur et converge vers un palier', () => {
    const serie = serieDepuis('2026-01-01', Array.from({ length: 100 }, () => 50))
    const e = ema(serie, 7)
    expect(e[0]!.v).toBe(50)
    expect(e[99]!.v).toBeCloseTo(50, 8)
  })

  it('réagit plus vite avec une période courte', () => {
    const valeurs = [0, 0, 0, 0, 0, 100, 100, 100]
    const serie = serieDepuis('2026-01-01', valeurs)
    const rapide = ema(serie, 3)
    const lente = ema(serie, 30)
    expect(rapide[7]!.v).toBeGreaterThan(lente[7]!.v)
  })
})

describe('densifier', () => {
  it('bouche les trous avec la valeur par défaut', () => {
    const serie: Serie = [
      { j: '2026-01-01', v: 300 },
      { j: '2026-01-04', v: 500 },
    ]
    const d = densifier(serie, 0)
    expect(d.map((p) => p.v)).toEqual([300, 0, 0, 500])
  })

  it('respecte des bornes explicites', () => {
    const serie: Serie = [{ j: '2026-01-02', v: 7 }]
    const d = densifier(serie, 0, '2026-01-01', '2026-01-03')
    expect(d).toEqual([
      { j: '2026-01-01', v: 0 },
      { j: '2026-01-02', v: 7 },
      { j: '2026-01-03', v: 0 },
    ])
  })
})

describe('accès', () => {
  it('retrouve une valeur par dichotomie', () => {
    const serie = serieDepuis('2026-01-01', [1, 2, 3, 4, 5])
    expect(valeurAuJour(serie, '2026-01-03')).toBe(3)
    expect(valeurAuJour(serie, '2026-01-09')).toBeUndefined()
    expect(valeurAuJour([], '2026-01-01')).toBeUndefined()
  })

  it('coupe les N derniers jours', () => {
    const serie = serieDepuis('2026-01-01', [1, 2, 3, 4, 5])
    expect(derniersJours(serie, 2).map((p) => p.v)).toEqual([4, 5])
  })
})
