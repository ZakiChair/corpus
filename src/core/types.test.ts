import { describe, expect, it } from 'vitest'
import { analyserEtat, etatVide, VERSION_ETAT } from './types'
import type { Jour } from './temps'

const JOUR = '2026-07-26' as Jour

describe('version de l’état Corpus', () => {
  it('relit la version courante', () => {
    expect(analyserEtat(etatVide(JOUR))).not.toBeNull()
  })

  it('refuse une version future sans la normaliser', () => {
    const futur = {
      ...etatVide(JOUR),
      version: VERSION_ETAT + 1,
      champFutur: { aConserver: true },
    }
    expect(analyserEtat(futur)).toBeNull()
    expect(futur.champFutur).toEqual({ aConserver: true })
  })
})
