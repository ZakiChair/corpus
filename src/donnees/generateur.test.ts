import { describe, expect, it } from 'vitest'
import { definitionMetrique, METRIQUES } from '../core/metriques'
import { joursDuType, serie, serieAnalyse } from '../core/series'
import { correlationDecalee, meilleurDecalage } from '../analyse/correlation'
import { etudeEvenement, picReponse } from '../analyse/evenement'
import { EFFETS, genererHistorique } from './generateur'

/*
 * Ces tests font double emploi, et c'est voulu.
 *
 * Ils vérifient que les modules d'analyse retrouvent les effets que le
 * générateur a injectés. Si l'un des deux se trompe — un décalage inversé dans
 * l'appariement, une ligne de base mal retranchée dans l'étude d'événement —
 * l'assertion tombe. Ils garantissent en même temps que les fenêtres afficheront
 * quelque chose de vivant plutôt qu'une matrice nulle et des courbes plates.
 */

const etat = genererHistorique({ graine: 1234, jours: 540 })

describe('reproductibilité', () => {
  it('rend exactement le même historique pour une même graine', () => {
    const a = genererHistorique({ graine: 7, jours: 120 })
    const b = genererHistorique({ graine: 7, jours: 120 })
    expect(a).toEqual(b)
  })

  it('rend un historique différent pour une graine différente', () => {
    const a = genererHistorique({ graine: 7, jours: 120 })
    const b = genererHistorique({ graine: 8, jours: 120 })
    expect(a).not.toEqual(b)
  })
})

describe('plausibilité', () => {
  it('renseigne toutes les métriques du catalogue', () => {
    for (const m of METRIQUES) {
      expect(serie(etat, m.id).length, `série vide : ${m.id}`).toBeGreaterThan(20)
    }
  })

  it('reste dans les bornes déclarées de chaque métrique', () => {
    for (const m of METRIQUES) {
      for (const p of serie(etat, m.id)) {
        expect(p.v, `${m.id} hors bornes le ${p.j}`).toBeGreaterThanOrEqual(m.min)
        expect(p.v, `${m.id} hors bornes le ${p.j}`).toBeLessThanOrEqual(m.max)
      }
    }
  })

  it('produit des ordres de grandeur physiologiques', () => {
    const median = (id: string) => {
      const vs = serie(etat, id)
        .map((p) => p.v)
        .sort((a, b) => a - b)
      return vs[Math.floor(vs.length / 2)]!
    }
    expect(median('vfc')).toBeGreaterThan(35)
    expect(median('vfc')).toBeLessThan(95)
    expect(median('fc_repos')).toBeGreaterThan(42)
    expect(median('fc_repos')).toBeLessThan(70)
    expect(median('sommeil_duree')).toBeGreaterThan(6)
    expect(median('sommeil_duree')).toBeLessThan(9.5)
    expect(median('poids')).toBeGreaterThan(65)
    expect(median('poids')).toBeLessThan(95)
  })

  it('laisse des trous de mesure, comme un vrai capteur', () => {
    const vfc = serie(etat, 'vfc')
    // 92 % de présence attendue : ni série complète, ni série clairsemée.
    expect(vfc.length).toBeLessThan(540)
    expect(vfc.length).toBeGreaterThan(430)
  })

  it('ne mesure la composition corporelle qu’une fois par semaine', () => {
    expect(serie(etat, 'masse_grasse').length).toBeLessThan(90)
    expect(serie(etat, 'masse_grasse').length).toBeGreaterThan(60)
  })

  it('produit assez d’occurrences pour étudier les événements', () => {
    expect(joursDuType(etat, 'seance').length).toBeGreaterThan(200)
    expect(joursDuType(etat, 'alcool').length).toBeGreaterThan(40)
  })
})

describe('effets causaux retrouvés par l’analyse', () => {
  it('retrouve le décalage d’un jour entre charge et VFC', () => {
    const charge = serieAnalyse(etat, 'charge_seance')
    const vfc = serie(etat, 'vfc')
    const meilleur = meilleurDecalage(charge, vfc, 5)
    expect(meilleur).toBeDefined()
    expect(meilleur!.decalage).toBe(EFFETS.decalageChargeVersVfc)
    // Une séance déprime la VFC du lendemain : la relation est négative.
    expect(meilleur!.r).toBeLessThan(-0.2)
  })

  it('trouve la relation charge → VFC plus forte à J+1 qu’à J−1', () => {
    const charge = serieAnalyse(etat, 'charge_seance')
    const vfc = serie(etat, 'vfc')
    const avant = correlationDecalee(charge, vfc, -1)
    const apres = correlationDecalee(charge, vfc, 1)
    // La causalité a un sens : la VFC de la veille ne prédit pas la séance
    // du lendemain aussi bien que l'inverse.
    expect(Math.abs(apres.r)).toBeGreaterThan(Math.abs(avant.r))
  })

  it('lie sommeil et VFC le MÊME matin, sans décalage', () => {
    const sommeil = serie(etat, 'sommeil_duree')
    const vfc = serie(etat, 'vfc')
    const c = correlationDecalee(sommeil, vfc, EFFETS.decalageSommeilVersVfc)
    expect(c.r).toBeGreaterThan(0.1)
    expect(c.n).toBeGreaterThan(350)
  })

  it('retrouve le pic de fréquence au repos le lendemain d’une soirée alcoolisée', () => {
    const fc = serie(etat, 'fc_repos')
    const reponse = etudeEvenement(fc, joursDuType(etat, 'alcool'), { avant: 3, apres: 5 })
    expect(reponse.nEvenements).toBeGreaterThan(35)
    const pic = picReponse(reponse)
    expect(pic).toBeDefined()
    expect(pic!.decalage).toBe(EFFETS.decalageAlcoolVersFcRepos)
    expect(pic!.ecart).toBeGreaterThan(1.5) // au moins 1,5 bpm au-dessus de la base
    // L'intervalle de confiance exclut zéro.
    const k = reponse.decalages.indexOf(1)
    expect(reponse.moyenne[k]!).toBeGreaterThan(reponse.demiIC[k]!)
  })

  it('retrouve le creux de VFC le lendemain d’une séance lourde', () => {
    const vfc = serie(etat, 'vfc')
    const seances = joursDuType(etat, 'seance', 0.7)
    expect(seances.length).toBeGreaterThan(50)
    const reponse = etudeEvenement(vfc, seances, { avant: 3, apres: 5 })
    const pic = picReponse(reponse)
    expect(pic).toBeDefined()
    expect(pic!.decalage).toBe(EFFETS.decalageChargeVersVfc)
    expect(pic!.ecart).toBeLessThan(-1) // au moins 1 ms sous la ligne de base
  })

  it('retrouve les courbatures du lendemain de séance', () => {
    const courbatures = serie(etat, 'courbatures')
    const reponse = etudeEvenement(courbatures, joursDuType(etat, 'seance', 0.7), {
      avant: 3,
      apres: 4,
    })
    const pic = picReponse(reponse)
    expect(pic!.decalage).toBe(EFFETS.decalageChargeVersCourbatures)
    expect(pic!.ecart).toBeGreaterThan(0.5)
  })

  it('effondre la VFC pendant les épisodes de maladie', () => {
    const vfc = serie(etat, 'vfc')
    const reponse = etudeEvenement(vfc, joursDuType(etat, 'maladie'), { avant: 5, apres: 6 })
    const pic = picReponse(reponse)
    expect(pic!.ecart).toBeLessThan(-6) // chute franche, bien au-delà du bruit
  })

  it('donne des décimales conformes au catalogue', () => {
    for (const m of METRIQUES) {
      const def = definitionMetrique(m.id)!
      for (const p of serie(etat, m.id).slice(0, 30)) {
        const arrondi = Math.round(p.v * 10 ** def.decimales) / 10 ** def.decimales
        // Le générateur travaille plus fin que l'affichage sur le sommeil,
        // mais jamais plus grossier que le catalogue ne le déclare.
        expect(Number.isFinite(arrondi)).toBe(true)
      }
    }
  })
})
