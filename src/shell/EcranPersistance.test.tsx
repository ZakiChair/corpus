import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EtatPersistance } from '../core/donneesStore'
import { EcranPersistance } from './EcranPersistance'

const DETAIL_TECHNIQUE = 'SENTINELLE_DOMEXCEPTION_QUOTA_42'

describe('copie du dialogue de persistance', () => {
  it.each<{
    persistance: EtatPersistance
    copie: string
  }>([
    {
      persistance: { statut: 'erreur-lecture', message: DETAIL_TECHNIQUE },
      copie: 'Le stockage local n’a pas pu être lu. Aucune donnée n’a été effacée.',
    },
    {
      persistance: { statut: 'erreur-ecriture', message: DETAIL_TECHNIQUE },
      copie:
        'L’enregistrement n’a pas abouti. Aucune donnée n’a été effacée ; l’état visible reste disponible en mémoire.',
    },
  ])('masque le détail technique pour $persistance.statut', ({ persistance, copie }) => {
    const rendu = renderToStaticMarkup(<EcranPersistance persistance={persistance} />)

    expect(rendu).toContain(copie)
    expect(rendu).not.toContain(DETAIL_TECHNIQUE)
  })
})
