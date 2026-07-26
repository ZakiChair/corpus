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

  it('lit la version racine d’un document futur même s’il possède un champ etat', () => {
    const brut = {
      ...etatVide(JOUR),
      version: VERSION_ETAT + 1,
      etat: { nouveauFormat: true },
    }

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

  it.each([Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'classe la révision non sûre %s comme corrompue',
    (revision) => {
      const brut = { format: 1, revision, etat: etatVide(JOUR) }

      expect(decoderValeurStockee(brut)).toEqual({ statut: 'corrompu', brut })
    },
  )

  it('refuse d’enregistrer au-delà de la révision maximale sans mutation', async () => {
    const document = {
      format: 1 as const,
      revision: Number.MAX_SAFE_INTEGER,
      etat: etatVide(JOUR),
    }
    const stockage = new StockageMemoire(document)

    await expect(
      stockage.enregistrer({ ...etatVide(JOUR), profil: { sexe: 'f' } }, document.revision),
    ).rejects.toBeInstanceOf(RangeError)
    expect(await stockage.charger()).toEqual({
      statut: 'charge',
      revision: document.revision,
      etat: document.etat,
    })
  })

  it('refuse d’effacer au-delà de la révision maximale sans mutation', async () => {
    const document = {
      format: 1 as const,
      revision: Number.MAX_SAFE_INTEGER,
      etat: etatVide(JOUR),
    }
    const stockage = new StockageMemoire(document)

    await expect(stockage.effacer(document.revision)).rejects.toBeInstanceOf(RangeError)
    expect(await stockage.charger()).toEqual({
      statut: 'charge',
      revision: document.revision,
      etat: document.etat,
    })
  })
})
