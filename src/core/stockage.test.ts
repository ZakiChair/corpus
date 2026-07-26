import { describe, expect, it } from 'vitest'
import {
  ConflitStockage,
  StockageMemoire,
  decoderValeurStockee,
} from './stockage'
import { etatVide, VERSION_ETAT } from './types'
import type { Jour } from './temps'

const JOUR = '2026-07-26' as Jour

describe('document stocké', () => {
  it('considère un état v1 historique comme la révision zéro', () => {
    expect(decoderValeurStockee(etatVide(JOUR))).toMatchObject({
      statut: 'charge',
      revision: 0,
    })
  })

  it('préserve une version future dans le résultat incompatible', () => {
    const brut = { ...etatVide(JOUR), version: VERSION_ETAT + 1, champFutur: 'intact' }
    expect(decoderValeurStockee(brut)).toEqual({
      statut: 'incompatible',
      version: VERSION_ETAT + 1,
      brut,
    })
  })

  it('distingue un document corrompu d’une base absente', () => {
    expect(decoderValeurStockee({ version: VERSION_ETAT })).toMatchObject({ statut: 'corrompu' })
    expect(decoderValeurStockee(undefined)).toEqual({ statut: 'absent', revision: 0 })
  })

  it('refuse une écriture fondée sur une révision périmée', async () => {
    const stockage = new StockageMemoire()
    expect(await stockage.enregistrer(etatVide(JOUR), 0)).toBe(1)
    await expect(stockage.enregistrer(etatVide(JOUR), 0)).rejects.toBeInstanceOf(
      ConflitStockage,
    )
    expect((await stockage.charger()).statut).toBe('charge')
  })
})
