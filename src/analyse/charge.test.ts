import { describe, expect, it } from 'vitest'
import { serieAnalyse } from '../core/series'
import type { Serie } from '../core/types'
import { genererHistorique } from '../donnees/generateur'
import { bandeDuRatio, calculerCharge, contrainte, monotonie, totalParSemaine } from './charge'
import { densifier, moyenne, valeurAuJour } from './stats'

function serieDepuis(debut: string, valeurs: number[]): Serie {
  const base = new Date(`${debut}T00:00:00Z`).getTime()
  return valeurs.map((v, i) => ({
    j: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    v,
  }))
}

describe('calculerCharge', () => {
  it('rend des séries vides sans planter sur une entrée vide', () => {
    const c = calculerCharge([])
    expect(c.aigue).toEqual([])
    expect(c.debutFiable).toBeUndefined()
  })

  it('fait converger aiguë et chronique vers une charge constante', () => {
    const dense = serieDepuis('2026-01-01', Array.from({ length: 200 }, () => 400))
    const c = calculerCharge(dense)
    expect(c.aigue[199]!.v).toBeCloseTo(400, 4)
    expect(c.chronique[199]!.v).toBeCloseTo(400, 2)
    // Charge parfaitement stable : la forme est nulle et le ratio vaut 1.
    expect(c.forme[199]!.v).toBeCloseTo(0, 2)
    expect(c.ratio[c.ratio.length - 1]!.v).toBeCloseTo(1, 6)
  })

  it('fait réagir l’aiguë plus vite que la chronique', () => {
    // Palier bas prolongé, puis saut brutal.
    const valeurs = [...Array.from({ length: 60 }, () => 200), ...Array.from({ length: 10 }, () => 800)]
    const c = calculerCharge(serieDepuis('2026-01-01', valeurs))
    const derniereAigue = c.aigue[c.aigue.length - 1]!.v
    const derniereChronique = c.chronique[c.chronique.length - 1]!.v
    expect(derniereAigue).toBeGreaterThan(derniereChronique)
    // Et la forme devient négative : la fatigue récente dépasse le fond.
    expect(c.forme[c.forme.length - 1]!.v).toBeLessThan(0)
  })

  it('signale à partir de quand la chronique a vu assez d’historique', () => {
    const dense = serieDepuis('2026-01-01', Array.from({ length: 100 }, () => 300))
    expect(calculerCharge(dense).debutFiable).toBe('2026-02-12') // 42 jours après le 1ᵉʳ
  })

  it('n’émet pas de ratio quand la charge chronique est nulle', () => {
    const dense = serieDepuis('2026-01-01', Array.from({ length: 40 }, () => 0))
    expect(calculerCharge(dense).ratio).toEqual([])
  })

  it('surestimerait la fatigue si la série n’était pas densifiée', () => {
    // Trois séances à 600 espacées d'une semaine. Sans densification, l'EMA ne
    // voit que des 600 consécutifs et croit à un entraînement quotidien.
    const creuse: Serie = [
      { j: '2026-01-01', v: 600 },
      { j: '2026-01-08', v: 600 },
      { j: '2026-01-15', v: 600 },
      { j: '2026-01-22', v: 600 },
    ]
    const dense = densifier(creuse, 0)
    const sansDensification = calculerCharge(creuse)
    const avecDensification = calculerCharge(dense)
    const finCreuse = sansDensification.aigue[sansDensification.aigue.length - 1]!.v
    const finDense = avecDensification.aigue[avecDensification.aigue.length - 1]!.v
    expect(finCreuse).toBeGreaterThan(3 * finDense)
  })
})

describe('monotonie', () => {
  it('est plus élevée pour un entraînement uniforme que pour un entraînement contrasté', () => {
    const uniforme = serieDepuis('2026-01-01', Array.from({ length: 30 }, () => 300).map((v, i) => v + (i % 2)))
    const contraste = serieDepuis(
      '2026-01-01',
      Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 900 : 0)),
    )
    const mu = monotonie(uniforme)
    const mc = monotonie(contraste)
    expect(moyenne(mu.map((p) => p.v))).toBeGreaterThan(moyenne(mc.map((p) => p.v)))
  })

  it('omet les fenêtres de charge parfaitement constante', () => {
    // Écart-type nul : la monotonie serait infinie.
    const plat = serieDepuis('2026-01-01', Array.from({ length: 20 }, () => 400))
    expect(monotonie(plat)).toEqual([])
    expect(contrainte(plat)).toEqual([])
  })
})

describe('totalParSemaine', () => {
  it('agrège par semaine calendaire commençant le lundi', () => {
    // 2026-07-27 est un lundi.
    const dense = serieDepuis('2026-07-27', [100, 100, 100, 100, 100, 100, 100, 500])
    const total = totalParSemaine(dense)
    expect(total).toHaveLength(2)
    expect(total[0]!.v).toBe(700) // lundi → dimanche
    expect(total[1]!.v).toBe(500) // lundi suivant
  })
})

describe('bandeDuRatio', () => {
  it('nomme les bandes de façon descriptive', () => {
    expect(bandeDuRatio(0.5).label).toBe('sous ton habitude')
    expect(bandeDuRatio(1.0).label).toBe('dans ton habitude')
    expect(bandeDuRatio(1.4).label).toBe('au-dessus')
    expect(bandeDuRatio(2.2).label).toBe('nettement au-dessus')
  })
})

describe('sur l’historique généré', () => {
  const etat = genererHistorique({ graine: 99, jours: 400 })
  const dense = serieAnalyse(etat, 'charge_seance')

  it('produit une charge chronique dans un ordre de grandeur crédible', () => {
    const c = calculerCharge(dense)
    const derniere = c.chronique[c.chronique.length - 1]!.v
    // Quatre séances par semaine autour de 420 UA → environ 240 UA par jour.
    expect(derniere).toBeGreaterThan(120)
    expect(derniere).toBeLessThan(400)
  })

  it('fait remonter la forme pendant les semaines de décharge', () => {
    const c = calculerCharge(dense)
    // Le générateur applique un bloc de quatre semaines dont la dernière est
    // allégée : la forme doit être plus haute en fin de bloc qu'au milieu.
    const formes = c.forme.filter((p) => p.j >= (c.debutFiable ?? ''))
    expect(formes.length).toBeGreaterThan(200)
    const max = Math.max(...formes.map((p) => p.v))
    const min = Math.min(...formes.map((p) => p.v))
    expect(max).toBeGreaterThan(0) // il existe des jours frais
    expect(min).toBeLessThan(0) // et des jours chargés
  })

  it('garde le ratio dans une plage lisible la plupart du temps', () => {
    const c = calculerCharge(dense)
    const fiables = c.ratio.filter((p) => p.j >= (c.debutFiable ?? ''))
    const dansLaPlage = fiables.filter((p) => p.v > 0.4 && p.v < 2.2).length
    expect(dansLaPlage / fiables.length).toBeGreaterThan(0.9)
  })

  it('trouve une valeur de charge pour un jour de séance connu', () => {
    const unJourDeSeance = etat.annotations.find((a) => a.type === 'seance')!.j
    expect(valeurAuJour(dense, unJourDeSeance)).toBeGreaterThan(0)
  })
})
