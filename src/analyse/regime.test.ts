import { describe, expect, it } from 'vitest'
import { decalerJour } from '../core/temps'
import { joursDuType } from '../core/series'
import type { Serie } from '../core/types'
import { genererHistorique } from '../donnees/generateur'
import { bandeDuRegime, calculerRegime, contributionDominante } from './regime'
import { mediane, moyenne, rangPercentile, valeurAuJour } from './stats'

function serieDepuis(debut: string, valeurs: number[]): Serie {
  const base = new Date(`${debut}T00:00:00Z`).getTime()
  return valeurs.map((v, i) => ({
    j: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    v,
  }))
}

describe('orientation des contributions', () => {
  it('inverse le signe des métriques où « bas » est favorable', () => {
    // Fréquence au repos : trente jours autour de 50, puis un pic à 70.
    // Un pic de FC est défavorable, sa contribution doit donc être NÉGATIVE.
    const base = Array.from({ length: 30 }, (_, i) => 50 + (i % 3) - 1)
    const fc = serieDepuis('2026-01-01', [...base, 70])
    const { contributions } = calculerRegime({ fc_repos: fc, vfc: fc }, { minimumMetriques: 1 })
    const dernierJour = fc[fc.length - 1]!.j
    const liste = contributions.get(dernierJour)!
    const contribFc = liste.find((c) => c.id === 'fc_repos')!
    const contribVfc = liste.find((c) => c.id === 'vfc')!
    expect(contribFc.z).toBeLessThan(0)
    // La même série lue comme une VFC (où « haut » est favorable) donne
    // exactement le signe opposé.
    expect(contribVfc.z).toBeCloseTo(-contribFc.z, 10)
  })
})

describe('exigence de couverture', () => {
  it('n’émet pas de composite quand trop peu de métriques sont renseignées', () => {
    const vfc = serieDepuis('2026-01-01', Array.from({ length: 40 }, (_, i) => 60 + (i % 5)))
    const avecUne = calculerRegime({ vfc }, { minimumMetriques: 2 })
    const avecSeuilBas = calculerRegime({ vfc }, { minimumMetriques: 1 })
    expect(avecUne.serie).toEqual([])
    expect(avecSeuilBas.serie.length).toBeGreaterThan(0)
  })

  it('ignore les métriques neutres, qui n’ont pas de sens favorable', () => {
    // Le poids est déclaré neutre : il ne doit jamais entrer dans le composite.
    const poids = serieDepuis('2026-01-01', Array.from({ length: 40 }, (_, i) => 78 + (i % 4) * 0.2))
    expect(calculerRegime({ poids }, { minimumMetriques: 1 }).serie).toEqual([])
  })
})

describe('bandeDuRegime', () => {
  it('classe le composite en bandes descriptives', () => {
    expect(bandeDuRegime(1.6).label).toBe('Nettement au-dessus')
    expect(bandeDuRegime(0.5).label).toBe('Au-dessus')
    expect(bandeDuRegime(0).label).toBe('Dans l’habituel')
    expect(bandeDuRegime(-0.6).label).toBe('En dessous')
    expect(bandeDuRegime(-2).label).toBe('Nettement en dessous')
  })
})

describe('sur l’historique généré', () => {
  const etat = genererHistorique({ graine: 4242, jours: 500 })
  const regime = calculerRegime(etat.series)

  it('couvre l’essentiel de la période', () => {
    expect(regime.serie.length).toBeGreaterThan(380)
  })

  it('reste centré autour de zéro sur la durée', () => {
    // Le composite est un z-score glissant : par construction, sa moyenne de
    // long terme doit être proche de zéro. Un biais marqué signalerait un
    // défaut d'orientation ou de fenêtre.
    expect(Math.abs(moyenne(regime.serie.map((p) => p.v)))).toBeLessThan(0.25)
  })

  it('place les épisodes de maladie dans le bas de la distribution', () => {
    // L'assertion utile n'est pas un seuil absolu — le z est borné par sa
    // propre fenêtre glissante, qui absorbe l'épisode au fil des jours — mais
    // une affirmation distributionnelle : ces jours-là comptent parmi les pires.
    const joursMaladie = joursDuType(etat, 'maladie')
    expect(joursMaladie.length).toBeGreaterThan(0)
    const pendant: number[] = []
    for (const j of joursMaladie) {
      for (let d = 0; d < 4; d++) {
        const v = valeurAuJour(regime.serie, decalerJour(j, d))
        if (v !== undefined) pendant.push(v)
      }
    }
    expect(pendant.length).toBeGreaterThan(8)

    const toutes = regime.serie.map((p) => p.v)
    const medianeMaladie = mediane(pendant)
    expect(rangPercentile(toutes, medianeMaladie)).toBeLessThan(0.25)
    expect(moyenne(toutes) - moyenne(pendant)).toBeGreaterThan(0.7)
  })

  it('plafonne l’apport favorable d’un excès de sommeil', () => {
    // Une nuit anormalement longue ne doit pas compenser une fréquence au
    // repos élevée : sans plafond, le composite reste tiède pendant les états
    // qu'il devrait justement signaler.
    const contribsSommeil = [...regime.contributions.values()]
      .flat()
      .filter((c) => c.id === 'sommeil_duree')
    expect(contribsSommeil.length).toBeGreaterThan(100)
    expect(Math.max(...contribsSommeil.map((c) => c.z))).toBeLessThanOrEqual(0.5)
    // Le déficit, lui, compte pleinement.
    expect(Math.min(...contribsSommeil.map((c) => c.z))).toBeLessThan(-1.5)
  })

  it('explique un jour bas par une contribution dominante', () => {
    const pire = regime.serie.reduce((a, b) => (a.v < b.v ? a : b))
    const dominante = contributionDominante(regime, pire.j)
    expect(dominante).toBeDefined()
    expect(dominante!.z).toBeLessThan(0)
  })
})
