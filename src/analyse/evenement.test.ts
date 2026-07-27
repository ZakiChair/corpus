import { describe, expect, it } from 'vitest'
import type { Serie } from '../core/types'
import { etudeEvenement } from './evenement'

/**
 * Série de constante 0 sur juillet 2026, avec des écarts posés à la main.
 * Les jours sont consécutifs : chaque index i correspond au 2026-07-(i+1).
 */
function serie(valeurs: Record<number, number>, n = 25): Serie {
  const out: Serie = []
  for (let i = 1; i <= n; i++) {
    out.push({ j: `2026-07-${String(i).padStart(2, '0')}`, v: valeurs[i] ?? 0 })
  }
  return out
}

const jour = (i: number) => `2026-07-${String(i).padStart(2, '0')}`

describe('ligne de base et occurrences rapprochées', () => {
  it('exclut de la ligne de base les jours encore sous l’effet d’une autre occurrence', () => {
    // Un événement le 10 laisse un effet de +10 les 10 et 11. Un second
    // événement tombe le 13 : sa fenêtre de base contient les 9 à 12.
    // Sans quarantaine, la base vaudrait (0 + 10 + 10 + 0) / 4 = 5 et
    // l'écart du jour J serait faussé de −5.
    const s = serie({ 10: 10, 11: 10 })
    const r = etudeEvenement(s, [jour(10), jour(13)], {
      avant: 4,
      apres: 2,
      minimumBase: 1,
      exclusionApresAutre: 2,
    })
    // Occurrence du 13 : fenêtre de base 9–12 ; les 10, 11 et 12 sont sous
    // quarantaine, base = { jour 9 } = 0, écart à J = 0. Occurrence du 10 :
    // base propre = 0, écart à J = +10. Moyenne à J : (10 + 0) / 2 = 5.
    // Sans quarantaine, la base du 13 vaudrait (0+10+10+0)/4 = 5 et la
    // moyenne à J tomberait à 2,5 : c'est l'écart que ce test attrape.
    const k = r.decalages.indexOf(0)
    expect(r.moyenne[k]).toBeCloseTo(5, 6)
    expect(r.nContamines).toBe(0)
  })

  it('se replie sur la base contaminée quand rien de propre ne subsiste, et le signale', () => {
    // Même scénario, mais la fenêtre de base (avant = 3) ne contient que des
    // jours contaminés (10, 11, 12). Plutôt que d'écarter l'occurrence, on
    // garde la base d'avant la quarantaine — et on compte l'occurrence comme
    // contaminée pour que l'interface puisse le dire.
    const s = serie({ 10: 10, 11: 10 })
    const r = etudeEvenement(s, [jour(10), jour(13)], {
      avant: 3,
      apres: 2,
      minimumBase: 2,
      exclusionApresAutre: 2,
    })
    expect(r.nContamines).toBe(1)
    expect(r.nEvenements).toBe(2)
    const k = r.decalages.indexOf(0)
    // Occurrence du 10 : écart +10. Occurrence du 13, base de repli
    // (10 + 10 + 0) / 3 : écart 0 − 20/3. Moyenne : (10 − 20/3) / 2 = 5/3.
    expect(r.moyenne[k]).toBeCloseTo(5 / 3, 6)
  })

  it('écarte toujours les occurrences sans aucune mesure de base', () => {
    const s: Serie = [{ j: jour(13), v: 5 }]
    const r = etudeEvenement(s, [jour(13)], { avant: 3, apres: 2 })
    expect(r.nEvenements).toBe(0)
    expect(r.nEcartes).toBe(1)
  })

  it('retranche à chaque occurrence sa propre ligne de base', () => {
    // Deux occurrences éloignées, niveaux de base différents (dérive
    // saisonnière simulée) : l'effet commun de +5 doit ressortir net.
    const s: Serie = []
    for (let i = 1; i <= 25; i++) {
      const base = i < 13 ? 50 : 60
      const effet = i === 8 || i === 20 ? 5 : 0
      s.push({ j: jour(i), v: base + effet })
    }
    const r = etudeEvenement(s, [jour(8), jour(20)], { avant: 3, apres: 2 })
    const k = r.decalages.indexOf(0)
    expect(r.moyenne[k]).toBeCloseTo(5, 6)
  })
})

describe('occurrences multiples le même jour', () => {
  it('dédoublonne : deux annotations le même jour comptent pour une occurrence', () => {
    // Deux annotations « séance » le même jour (matin + soir) ne sont qu'une
    // occurrence pour l'étude : les compter deux fois gonfle nEvenements et
    // resserre artificiellement l'intervalle (pseudo-réplication).
    const s = serie({ 10: 10, 11: 6 })
    const uneFois = etudeEvenement(s, [jour(10)], { avant: 3, apres: 2, minimumBase: 1 })
    const deuxFois = etudeEvenement(s, [jour(10), jour(10)], {
      avant: 3,
      apres: 2,
      minimumBase: 1,
    })
    expect(deuxFois).toEqual(uneFois)
    expect(deuxFois.nEvenements).toBe(1)
  })
})
