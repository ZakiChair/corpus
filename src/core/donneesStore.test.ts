import { describe, expect, it, vi } from 'vitest'
import { creerStoreDonnees } from './donneesStore'
import type { AdaptateurStockage } from './stockage'
import { etatVide } from './types'

function adaptateurEnErreur(): AdaptateurStockage {
  return {
    charger: vi.fn().mockRejectedValue(new Error('indisponible')),
    enregistrer: vi.fn(),
    effacer: vi.fn(),
  }
}

describe('hydratation du store', () => {
  it('bloque une mutation avant la fin du chargement', () => {
    const stockage = adaptateurEnErreur()
    const store = creerStoreDonnees(stockage)
    const avant = store.getState().etat
    store.getState().genererDemonstration(30)
    expect(store.getState().etat).toBe(avant)
    expect(stockage.enregistrer).not.toHaveBeenCalled()
  })

  it('ne transforme pas une panne de lecture en état vide éditable', async () => {
    const store = creerStoreDonnees(adaptateurEnErreur())
    await store.getState().hydrater()
    expect(store.getState().persistance).toMatchObject({ statut: 'erreur-lecture' })
    expect(store.getState().hydrate).toBe(false)
  })

  it('partage une seule lecture entre deux hydratations simultanées', async () => {
    const charger = vi.fn().mockResolvedValue({ statut: 'absent', revision: 0 })
    const stockage: AdaptateurStockage = {
      charger,
      enregistrer: vi.fn(),
      effacer: vi.fn(),
    }
    const store = creerStoreDonnees(stockage)
    await Promise.all([store.getState().hydrater(), store.getState().hydrater()])
    expect(charger).toHaveBeenCalledTimes(1)
    expect(store.getState().persistance).toEqual({ statut: 'pret', sauvegarde: 'a-jour' })
  })

  it('ne relit pas le stockage après une hydratation réussie', async () => {
    const charger = vi.fn().mockResolvedValue({ statut: 'absent', revision: 0 })
    const stockage: AdaptateurStockage = {
      charger,
      enregistrer: vi.fn(),
      effacer: vi.fn(),
    }
    const store = creerStoreDonnees(stockage)
    await store.getState().hydrater()
    await store.getState().hydrater()
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('installe l’état chargé et sa révision', async () => {
    const etatCharge = etatVide('2026-07-20')
    etatCharge.series.poids = [{ j: '2026-07-20', v: 72 }]
    const enregistrer = vi.fn().mockResolvedValue(13)
    const stockage: AdaptateurStockage = {
      charger: vi.fn().mockResolvedValue({ statut: 'charge', etat: etatCharge, revision: 12 }),
      enregistrer,
      effacer: vi.fn(),
    }
    const store = creerStoreDonnees(stockage, { delaiEnregistrement: 60_000 })

    await store.getState().hydrater()
    store.getState().poserMesure('poids', '2026-07-21', 71.8)
    await store.getState().purgerEcritureEnAttente()

    expect(store.getState().etat.series.poids).toEqual([
      { j: '2026-07-20', v: 72 },
      { j: '2026-07-21', v: 71.8 },
    ])
    expect(enregistrer).toHaveBeenCalledWith(store.getState().etat, 12)
    expect(store.getState().persistance).toEqual({ statut: 'pret', sauvegarde: 'a-jour' })
  })

  it('signale un document corrompu sans remplacer l’état en mémoire', async () => {
    const stockage: AdaptateurStockage = {
      charger: vi.fn().mockResolvedValue({ statut: 'corrompu', brut: { invalide: true } }),
      enregistrer: vi.fn(),
      effacer: vi.fn(),
    }
    const store = creerStoreDonnees(stockage)
    const avant = store.getState().etat

    await store.getState().hydrater()

    expect(store.getState().etat).toBe(avant)
    expect(store.getState().persistance).toEqual({ statut: 'document-corrompu' })
  })

  it('signale une version incompatible sans remplacer l’état en mémoire', async () => {
    const stockage: AdaptateurStockage = {
      charger: vi.fn().mockResolvedValue({ statut: 'incompatible', brut: {}, version: 2 }),
      enregistrer: vi.fn(),
      effacer: vi.fn(),
    }
    const store = creerStoreDonnees(stockage)
    const avant = store.getState().etat

    await store.getState().hydrater()

    expect(store.getState().etat).toBe(avant)
    expect(store.getState().persistance).toEqual({ statut: 'version-incompatible', version: 2 })
  })
})

describe('blocage des mutations', () => {
  it('bloque les mutations communes avant la fin du chargement', () => {
    const stockage = adaptateurEnErreur()
    const store = creerStoreDonnees(stockage)
    const avant = store.getState().etat

    store.getState().poserMesure('poids', '2026-07-20', 72)

    expect(store.getState().etat).toBe(avant)
    expect(stockage.enregistrer).not.toHaveBeenCalled()
  })

  it('bloque le remplacement avant la fin du chargement', () => {
    const stockage = adaptateurEnErreur()
    const store = creerStoreDonnees(stockage)
    const avant = store.getState().etat

    store.getState().remplacer(etatVide('2026-07-20'))

    expect(store.getState().etat).toBe(avant)
    expect(stockage.enregistrer).not.toHaveBeenCalled()
  })

  it('bloque la réinitialisation avant la fin du chargement', () => {
    const stockage = adaptateurEnErreur()
    const store = creerStoreDonnees(stockage)
    const avant = store.getState().etat

    store.getState().reinitialiser()

    expect(store.getState().etat).toBe(avant)
    expect(stockage.effacer).not.toHaveBeenCalled()
  })
})
