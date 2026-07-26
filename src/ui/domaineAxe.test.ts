import { describe, expect, it } from 'vitest'
import {
  avecMarge,
  clamperDomaine,
  deplacerDomaine,
  domainePourPreset,
  etendue,
  graduations,
  indicesVisibles,
  pixelVersValeur,
  valeurVersPixel,
  zoomerDomaine,
  type Domaine,
} from './domaineAxe'

const BORNES: Domaine = { min: 0, max: 1000 }

describe('clamperDomaine', () => {
  it('fait GLISSER un domaine hors bornes au lieu de le comprimer', () => {
    // Un panoramique qui bute sur un bord doit longer le bord : comprimer
    // changerait le niveau de zoom au moment où l'on arrive en butée.
    const d = clamperDomaine({ min: -200, max: 100 }, BORNES)
    expect(etendue(d)).toBe(300)
    expect(d.min).toBe(0)
  })

  it('ramène un domaine plus large que les bornes à leur étendue', () => {
    expect(clamperDomaine({ min: -500, max: 5000 }, BORNES)).toEqual(BORNES)
  })

  it('colle au bord droit', () => {
    const d = clamperDomaine({ min: 900, max: 1200 }, BORNES)
    expect(d.max).toBe(1000)
    expect(etendue(d)).toBe(300)
  })
})

describe('zoomerDomaine', () => {
  it('conserve la position relative du pivot', () => {
    const d = { min: 0, max: 400 }
    const z = zoomerDomaine(d, 0.5, 100, BORNES)
    expect(etendue(z)).toBeCloseTo(200, 10)
    // Le pivot était au quart de la fenêtre, il doit y rester.
    expect((100 - z.min) / etendue(z)).toBeCloseTo(0.25, 10)
  })

  it('élargit avec un facteur supérieur à un', () => {
    expect(etendue(zoomerDomaine({ min: 200, max: 400 }, 2, 300, BORNES))).toBeCloseTo(400, 10)
  })

  it('ne dépasse jamais les bornes', () => {
    const z = zoomerDomaine({ min: 0, max: 1000 }, 5, 500, BORNES)
    expect(z).toEqual(BORNES)
  })
})

describe('deplacerDomaine', () => {
  it('translate et bute proprement', () => {
    expect(deplacerDomaine({ min: 100, max: 200 }, 50, BORNES)).toEqual({ min: 150, max: 250 })
    expect(deplacerDomaine({ min: 100, max: 200 }, -500, BORNES)).toEqual({ min: 0, max: 100 })
    expect(deplacerDomaine({ min: 900, max: 1000 }, 500, BORNES)).toEqual({ min: 900, max: 1000 })
  })
})

describe('conversions pixel ↔ valeur', () => {
  it('font un aller-retour exact', () => {
    const d = { min: 100, max: 300 }
    for (const x of [0, 37, 250, 500]) {
      expect(valeurVersPixel(d, pixelVersValeur(d, x, 500), 500)).toBeCloseTo(x, 10)
    }
  })

  it('ne divisent pas par zéro sur une largeur nulle', () => {
    expect(pixelVersValeur({ min: 10, max: 20 }, 5, 0)).toBe(10)
    expect(valeurVersPixel({ min: 10, max: 10 }, 10, 500)).toBe(0)
  })
})

describe('domainePourPreset', () => {
  it('prend les N derniers jours', () => {
    expect(domainePourPreset(BORNES, 90)).toEqual({ min: 910, max: 1000 })
  })

  it('rend les bornes complètes pour « Tout »', () => {
    expect(domainePourPreset(BORNES, null)).toEqual(BORNES)
  })

  it('ne déborde pas si la période dépasse l’historique', () => {
    expect(domainePourPreset(BORNES, 5000)).toEqual(BORNES)
  })
})

describe('indicesVisibles', () => {
  const points = Array.from({ length: 100 }, (_, i) => ({ x: i }))
  const valeurDe = (p: { x: number }) => p.x

  it('ajoute un point de marge de chaque côté', () => {
    // Sans marge, le segment qui entre dans le cadre serait tronqué et la
    // courbe semblerait commencer au bord.
    const r = indicesVisibles(points, valeurDe, { min: 20, max: 30 })
    expect(r.debut).toBe(19)
    expect(r.fin).toBe(31)
  })

  it('reste dans les bornes du tableau', () => {
    expect(indicesVisibles(points, valeurDe, { min: -50, max: 500 })).toEqual({
      debut: 0,
      fin: 99,
    })
    expect(indicesVisibles([], valeurDe, BORNES)).toEqual({ debut: 0, fin: 0 })
  })
})

describe('graduations', () => {
  it('produit des valeurs rondes', () => {
    // Un axe gradué en 0 / 3,7 / 7,4 serait illisible.
    expect(graduations(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(graduations(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('n’accumule pas d’erreur flottante', () => {
    for (const g of graduations(0, 1, 5)) {
      expect(Number(g.toFixed(10))).toBe(g)
    }
  })

  it('rend un tableau vide sur un intervalle dégénéré', () => {
    expect(graduations(5, 5)).toEqual([])
    expect(graduations(Number.NaN, 10)).toEqual([])
  })
})

describe('avecMarge', () => {
  it('élargit proportionnellement', () => {
    expect(avecMarge(0, 100, 0.1)).toEqual({ min: -10, max: 110 })
  })

  it('ouvre un intervalle autour d’une valeur unique', () => {
    // Sans cela, une série constante donnerait une hauteur de graphe nulle.
    const d = avecMarge(50, 50)
    expect(d.max).toBeGreaterThan(d.min)
  })

  it('gère la valeur zéro constante', () => {
    const d = avecMarge(0, 0)
    expect(d).toEqual({ min: -1, max: 1 })
  })
})
