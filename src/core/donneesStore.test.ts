import { afterEach, describe, expect, it, vi } from 'vitest'
import { creerStoreDonnees } from './donneesStore'
import { StockageMemoire, type AdaptateurStockage } from './stockage'
import type { Jour } from './temps'
import { etatVide } from './types'

const JOUR = '2026-07-26' as Jour

afterEach(() => {
  vi.useRealTimers()
})

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

  it('relit un document incompatible qui a été remplacé avant le nouvel essai', async () => {
    const etatCharge = etatVide('2026-07-20')
    etatCharge.series.energie = [{ j: '2026-07-20', v: 7 }]
    const charger = vi
      .fn()
      .mockResolvedValueOnce({ statut: 'incompatible', brut: { version: 2 }, version: 2 })
      .mockResolvedValueOnce({ statut: 'charge', etat: etatCharge, revision: 4 })
    const stockage: AdaptateurStockage = {
      charger,
      enregistrer: vi.fn(),
      effacer: vi.fn(),
    }
    const store = creerStoreDonnees(stockage)

    await store.getState().hydrater()
    await store.getState().hydrater()

    expect(charger).toHaveBeenCalledTimes(2)
    expect(store.getState().etat).toEqual(etatCharge)
    expect(store.getState().persistance).toEqual({ statut: 'pret', sauvegarde: 'a-jour' })
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

describe('file d’écriture et effacement', () => {
  it('coalesce les mutations et conserve le dernier état', async () => {
    vi.useFakeTimers()
    const stockage = new StockageMemoire()
    const enregistrer = vi.spyOn(stockage, 'enregistrer')
    const store = creerStoreDonnees(stockage, { delaiEcritureMs: 20 })
    await store.getState().hydrater()

    store.getState().poserMesure('energie', JOUR, 5)
    store.getState().poserMesure('energie', JOUR, 7)
    await vi.advanceTimersByTimeAsync(20)

    expect(enregistrer).toHaveBeenCalledTimes(1)
    await store.getState().purgerEcritureEnAttente()
    expect(enregistrer).toHaveBeenCalledTimes(1)
    expect(await stockage.charger()).toMatchObject({
      statut: 'charge',
      etat: { series: { energie: [{ j: JOUR, v: 7 }] } },
    })
  })

  it('ne sauvegarde que le dernier état arrivé pendant une écriture active', async () => {
    vi.useFakeTimers()
    let terminerPremiere!: () => void
    const premiere = new Promise<void>((resoudre) => {
      terminerPremiere = resoudre
    })
    let premiereEcriture = true
    const valeursEnregistrees: number[] = []
    const stockage: AdaptateurStockage = {
      charger: vi.fn().mockResolvedValue({ statut: 'absent', revision: 0 }),
      enregistrer: vi.fn(async (etat, revision) => {
        valeursEnregistrees.push(etat.series.energie?.[0]?.v ?? -1)
        if (premiereEcriture) {
          premiereEcriture = false
          await premiere
        }
        return revision + 1
      }),
      effacer: vi.fn().mockResolvedValue(0),
    }
    const store = creerStoreDonnees(stockage, { delaiEcritureMs: 0 })
    await store.getState().hydrater()

    store.getState().poserMesure('energie', JOUR, 5)
    await vi.advanceTimersByTimeAsync(0)
    store.getState().poserMesure('energie', JOUR, 7)
    await vi.advanceTimersByTimeAsync(0)
    store.getState().poserMesure('energie', JOUR, 9)
    await vi.advanceTimersByTimeAsync(0)
    terminerPremiere()
    await store.getState().purgerEcritureEnAttente()

    expect(valeursEnregistrees).toEqual([5, 9])
    expect(store.getState().persistance).toEqual({ statut: 'pret', sauvegarde: 'a-jour' })
  })

  it('signale le conflit de deux stores sans écraser le premier', async () => {
    const stockage = new StockageMemoire()
    const premier = creerStoreDonnees(stockage, { delaiEcritureMs: 0 })
    const second = creerStoreDonnees(stockage, { delaiEcritureMs: 0 })
    await Promise.all([premier.getState().hydrater(), second.getState().hydrater()])

    premier.getState().poserMesure('energie', JOUR, 5)
    await premier.getState().purgerEcritureEnAttente()
    second.getState().poserMesure('energie', JOUR, 9)
    await second.getState().purgerEcritureEnAttente()

    expect(second.getState().persistance).toEqual({ statut: 'conflit' })
    const resultat = await stockage.charger()
    expect(resultat.statut === 'charge' && resultat.etat.series.energie?.[0]?.v).toBe(5)
  })

  it('arrête la file après un échec d’écriture', async () => {
    const enregistrer = vi.fn().mockRejectedValue(new Error('quota'))
    const stockage: AdaptateurStockage = {
      charger: vi.fn().mockResolvedValue({ statut: 'absent', revision: 0 }),
      enregistrer,
      effacer: vi.fn().mockResolvedValue(0),
    }
    const store = creerStoreDonnees(stockage, { delaiEcritureMs: 0 })
    await store.getState().hydrater()

    store.getState().poserMesure('energie', JOUR, 5)
    await store.getState().purgerEcritureEnAttente()

    const apresErreur = store.getState().etat
    expect(store.getState().persistance).toMatchObject({ statut: 'erreur-ecriture' })
    store.getState().poserMesure('energie', JOUR, 9)
    expect(store.getState().etat).toBe(apresErreur)
    expect(enregistrer).toHaveBeenCalledTimes(1)
  })

  it('ne confirme pas un effacement qui a échoué', async () => {
    const stockage: AdaptateurStockage = {
      charger: vi.fn().mockResolvedValue({ statut: 'absent', revision: 0 }),
      enregistrer: vi.fn().mockResolvedValue(1),
      effacer: vi.fn().mockRejectedValue(new Error('refus')),
    }
    const store = creerStoreDonnees(stockage)
    await store.getState().hydrater()
    const avant = store.getState().etat

    expect(await store.getState().reinitialiser()).toBe(false)

    expect(store.getState().etat).toBe(avant)
    expect(store.getState().persistance).toMatchObject({ statut: 'erreur-ecriture' })
  })

  it('attend une écriture active avant d’effacer sa nouvelle révision', async () => {
    let terminerEcriture!: () => void
    const ecritureRetenue = new Promise<void>((resoudre) => {
      terminerEcriture = resoudre
    })
    const effacer = vi.fn().mockResolvedValue(0)
    const stockage: AdaptateurStockage = {
      charger: vi.fn().mockResolvedValue({ statut: 'absent', revision: 0 }),
      enregistrer: vi.fn(async () => {
        await ecritureRetenue
        return 1
      }),
      effacer,
    }
    const store = creerStoreDonnees(stockage, { delaiEcritureMs: 60_000 })
    await store.getState().hydrater()
    store.getState().poserMesure('energie', JOUR, 5)
    const purge = store.getState().purgerEcritureEnAttente()

    const effacement = store.getState().reinitialiser()
    await Promise.resolve()
    expect(effacer).not.toHaveBeenCalled()

    terminerEcriture()
    await purge
    expect(await effacement).toBe(true)
    expect(effacer).toHaveBeenCalledWith(1)
  })

  it('bloque les mutations pendant l’effacement', async () => {
    let terminerEffacement!: () => void
    const effacementRetenu = new Promise<void>((resoudre) => {
      terminerEffacement = resoudre
    })
    const memoire = new StockageMemoire()
    const stockage: AdaptateurStockage = {
      charger: () => memoire.charger(),
      enregistrer: (etat, revision) => memoire.enregistrer(etat, revision),
      effacer: async (revision) => {
        await effacementRetenu
        return memoire.effacer(revision)
      },
    }
    const store = creerStoreDonnees(stockage, { delaiEcritureMs: 60_000 })
    await store.getState().hydrater()
    store.getState().poserMesure('energie', JOUR, 5)
    await store.getState().purgerEcritureEnAttente()
    const avant = store.getState().etat

    const effacement = store.getState().reinitialiser()
    await Promise.resolve()
    store.getState().poserMesure('energie', JOUR, 9)
    expect(store.getState().etat).toBe(avant)

    terminerEffacement()
    expect(await effacement).toBe(true)
    await store.getState().purgerEcritureEnAttente()
    expect(await memoire.charger()).toEqual({ statut: 'absent', revision: 0 })
  })
})
