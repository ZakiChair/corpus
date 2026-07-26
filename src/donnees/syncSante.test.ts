import { describe, expect, it } from 'vitest'
import { fichiersAImporter } from './syncSante'

describe('fichiersAImporter', () => {
  const f = (nom: string, m: number, t = 100) => ({ nom, lastModified: m, taille: t })

  it('retient les nouveaux fichiers aux extensions connues, du plus ancien au plus récent', () => {
    const resultat = fichiersAImporter(
      [f('b.json', 200), f('a.csv', 100), f('note.txt', 50), f('image.png', 60)],
      {},
    )
    expect(resultat.map((x) => x.nom)).toEqual(['a.csv', 'b.json'])
  })

  it('ignore les fichiers déjà importés et inchangés', () => {
    const resultat = fichiersAImporter([f('a.json', 100)], { 'a.json': { m: 100, t: 100 } })
    expect(resultat).toEqual([])
  })

  it('reprend un fichier modifié — date OU taille', () => {
    const vus = { 'a.json': { m: 100, t: 100 } }
    expect(fichiersAImporter([f('a.json', 250)], vus)).toHaveLength(1)
    expect(fichiersAImporter([f('a.json', 100, 180)], vus)).toHaveLength(1)
  })
})
