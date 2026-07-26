import { describe, expect, it } from 'vitest'
import { decalerJour, jourDeSemaine } from '../core/temps'
import type { Serie } from '../core/types'
import { profilHebdomadaire, zConditionnel } from './saisonnalite'

/**
 * Série avec un rythme hebdomadaire marqué : 70 le samedi, 50 les autres
 * jours, plus une petite variation déterministe (0, 1, 2 en boucle) pour que
 * la dispersion intra-groupe ne soit pas nulle.
 */
function serieHebdomadaire(n = 180, valeurSamediFinal?: number): Serie {
  const s: Serie = []
  const depart = '2026-01-05' // un lundi
  for (let i = 0; i < n; i++) {
    const j = decalerJour(depart, i)
    const base = jourDeSemaine(j) === 5 ? 70 : 50
    s.push({ j, v: base + (i % 3) })
  }
  // Optionnellement, forcer la valeur du dernier samedi de la série.
  if (valeurSamediFinal !== undefined) {
    for (let i = s.length - 1; i >= 0; i--) {
      if (jourDeSemaine(s[i]!.j) === 5) {
        s.splice(i + 1)
        s[s.length - 1] = { j: s[s.length - 1]!.j, v: valeurSamediFinal }
        break
      }
    }
  }
  return s
}

describe('profilHebdomadaire', () => {
  it('retrouve le rythme injecté', () => {
    const profil = profilHebdomadaire(serieHebdomadaire())
    expect(profil).toHaveLength(7)
    expect(profil[5]!.mediane).toBeCloseTo(71, 0)
    expect(profil[0]!.mediane).toBeCloseTo(51, 0)
    expect(profil[5]!.n).toBeGreaterThan(10)
  })

  it('refuse de publier une statistique sur trop peu d’observations', () => {
    const profil = profilHebdomadaire(serieHebdomadaire(10))
    // Dix jours ne donnent qu'une ou deux observations par jour de semaine.
    for (const p of profil) expect(p.mediane).toBeNaN()
  })
})

describe('zConditionnel', () => {
  it('juge un samedi normal là où le z brut hurlerait', () => {
    // Un samedi à 70 est banal POUR UN SAMEDI, même s'il est à ~+2 σ de la
    // série mélangée. C'est exactement le mensonge que ce module corrige.
    const cond = zConditionnel(serieHebdomadaire(180, 71))!
    expect(cond.jourSemaine).toBe(5)
    expect(Math.abs(cond.z)).toBeLessThan(1)
  })

  it('signale un samedi anormalement bas que le z brut trouverait banal', () => {
    // 51 un samedi : au niveau des jours de semaine — banal en absolu,
    // très inhabituel pour un samedi.
    const cond = zConditionnel(serieHebdomadaire(180, 51))!
    expect(cond.z).toBeLessThan(-3)
  })

  it('exclut le dernier point de sa propre référence', () => {
    // Une valeur extrême ne doit pas amortir sa propre anomalie.
    const extreme = zConditionnel(serieHebdomadaire(180, 200))!
    expect(extreme.z).toBeGreaterThan(10)
  })

  it('s’abstient sans historique suffisant du même jour de semaine', () => {
    expect(zConditionnel(serieHebdomadaire(21))).toBeUndefined()
  })
})
