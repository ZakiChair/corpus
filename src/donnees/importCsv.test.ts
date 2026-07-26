import { describe, expect, it } from 'vitest'
import {
  analyserDate,
  analyserNombre,
  decouper,
  detecterSeparateur,
  importerCsv,
  reconnaitreColonne,
} from './importCsv'

describe('detecterSeparateur', () => {
  it('reconnaît la virgule, le point-virgule et la tabulation', () => {
    expect(detecterSeparateur('date,vfc,poids')).toBe(',')
    expect(detecterSeparateur('date;vfc;poids')).toBe(';')
    expect(detecterSeparateur('date\tvfc\tpoids')).toBe('\t')
  })

  it('choisit le séparateur qui découpe le plus', () => {
    // Un point-virgule isolé dans un fichier à virgules ne doit pas l'emporter.
    expect(detecterSeparateur('date,mesure; note,poids')).toBe(',')
  })
})

describe('decouper', () => {
  it('respecte les guillemets', () => {
    expect(decouper('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd'])
  })

  it('interprète le guillemet doublé comme un guillemet littéral', () => {
    expect(decouper('a,"il a dit ""oui""",c', ',')).toEqual(['a', 'il a dit "oui"', 'c'])
  })

  it('conserve les cellules vides', () => {
    expect(decouper('a,,c', ',')).toEqual(['a', '', 'c'])
  })
})

describe('analyserDate', () => {
  it('accepte l’ISO, avec ou sans heure', () => {
    expect(analyserDate('2026-07-26')).toBe('2026-07-26')
    expect(analyserDate('2026-07-26T08:12:00Z')).toBe('2026-07-26')
    expect(analyserDate('2026-7-6')).toBe('2026-07-06')
  })

  it('lit le jour AVANT le mois, convention européenne', () => {
    expect(analyserDate('26.07.2026')).toBe('2026-07-26')
    expect(analyserDate('26/07/2026')).toBe('2026-07-26')
    // 03/12 est donc le 3 décembre, jamais le 12 mars.
    expect(analyserDate('03/12/2026')).toBe('2026-12-03')
  })

  it('rejette une date impossible ou illisible', () => {
    expect(analyserDate('31.02.2026')).toBeNull()
    expect(analyserDate('hier')).toBeNull()
    expect(analyserDate('')).toBeNull()
  })
})

describe('analyserNombre', () => {
  it('accepte le point comme la virgule décimale', () => {
    expect(analyserNombre('72.4')).toBe(72.4)
    expect(analyserNombre('72,4')).toBe(72.4)
  })

  it('ignore les séparateurs de milliers, apostrophe suisse comprise', () => {
    expect(analyserNombre('12 480')).toBe(12480)
    expect(analyserNombre("12'480")).toBe(12480)
    expect(analyserNombre('12 480')).toBe(12480)
  })

  it('distingue les milliers des décimales quand les deux sont présents', () => {
    expect(analyserNombre('1.234,56')).toBeCloseTo(1234.56, 6)
  })

  it('rend null sur une cellule vide ou non numérique', () => {
    expect(analyserNombre('')).toBeNull()
    expect(analyserNombre('—')).toBeNull()
    expect(analyserNombre('n/a')).toBeNull()
  })
})

describe('reconnaitreColonne', () => {
  it('rattache par identifiant, libellé ou abréviation, accents ignorés', () => {
    expect(reconnaitreColonne('vfc')).toEqual({ id: 'vfc', connue: true })
    expect(reconnaitreColonne('Variabilité cardiaque')).toEqual({ id: 'vfc', connue: true })
    expect(reconnaitreColonne('Energie')).toEqual({ id: 'energie', connue: true })
    expect(reconnaitreColonne('ÉNERGIE')).toEqual({ id: 'energie', connue: true })
  })

  it('connaît les noms des exports d’appareils', () => {
    expect(reconnaitreColonne('HRV').id).toBe('vfc')
    expect(reconnaitreColonne('rmssd').id).toBe('vfc')
    expect(reconnaitreColonne('Resting Heart Rate').id).toBe('fc_repos')
    expect(reconnaitreColonne('Steps').id).toBe('pas')
  })

  it('conserve une colonne inconnue au lieu de la jeter', () => {
    const r = reconnaitreColonne('Créatine (g)')
    expect(r.connue).toBe(false)
    expect(r.id).toBe('creatineg')
  })
})

describe('importerCsv', () => {
  it('importe un fichier simple', () => {
    const csv = [
      'date,vfc,poids',
      '2026-07-24,61,74.8',
      '2026-07-25,58,74.6',
      '2026-07-26,53,74.7',
    ].join('\n')
    const r = importerCsv(csv)
    expect(r.lignesLues).toBe(3)
    expect(r.series.vfc).toEqual([
      { j: '2026-07-24', v: 61 },
      { j: '2026-07-25', v: 58 },
      { j: '2026-07-26', v: 53 },
    ])
    expect(r.series.poids).toHaveLength(3)
  })

  it('avale un export suisse : point-virgule, dates pointées, virgule décimale', () => {
    const csv = ['Date;Poids;Sommeil', '26.07.2026;74,7;8,2', '25.07.2026;74,6;7,9'].join('\n')
    const r = importerCsv(csv)
    expect(r.series.poids).toEqual([
      { j: '2026-07-25', v: 74.6 },
      { j: '2026-07-26', v: 74.7 },
    ])
    expect(r.series.sommeil_duree).toHaveLength(2)
  })

  it('trie et déduplique par jour, le dernier écrit gagnant', () => {
    const csv = ['date,vfc', '2026-07-26,50', '2026-07-24,60', '2026-07-26,55'].join('\n')
    const r = importerCsv(csv)
    expect(r.series.vfc).toEqual([
      { j: '2026-07-24', v: 60 },
      { j: '2026-07-26', v: 55 },
    ])
  })

  it('écarte les valeurs hors bornes du catalogue', () => {
    // 165 « kg » est un poids en livres mal converti : hors bornes plausibles
    // pour la métrique, la cellule est ignorée plutôt qu'importée.
    const csv = ['date,fc_repos', '2026-07-24,54', '2026-07-25,999'].join('\n')
    const r = importerCsv(csv)
    expect(r.series.fc_repos).toEqual([{ j: '2026-07-24', v: 54 }])
  })

  it('n’applique PAS les bornes à une colonne hors catalogue', () => {
    // On ne connaît pas l'unité, donc on ne peut rien juger.
    const csv = ['date,machin', '2026-07-24,999999'].join('\n')
    const r = importerCsv(csv)
    expect(r.series.machin).toEqual([{ j: '2026-07-24', v: 999999 }])
  })

  it('compte et signale les lignes sans date lisible', () => {
    const csv = ['date,vfc', '2026-07-24,60', 'total,180', '2026-07-25,58'].join('\n')
    const r = importerCsv(csv)
    expect(r.lignesLues).toBe(2)
    expect(r.lignesIgnorees).toBe(1)
    expect(r.avertissements.join(' ')).toContain('1 ligne')
  })

  it('se rabat sur la première colonne quand aucune n’est nommée « date »', () => {
    const csv = ['jour_de_mesure,vfc', '2026-07-24,60'].join('\n')
    const r = importerCsv(csv)
    expect(r.series.vfc).toHaveLength(1)
    expect(r.avertissements.join(' ')).toContain('première colonne')
  })

  it('rend un résultat vide et explicite sur un fichier inexploitable', () => {
    const r = importerCsv('date,vfc')
    expect(r.series).toEqual({})
    expect(r.avertissements).toHaveLength(1)
  })

  it('tolère les fins de ligne Windows et les lignes vides', () => {
    const csv = 'date,vfc\r\n2026-07-24,60\r\n\r\n2026-07-25,58\r\n'
    expect(importerCsv(csv).series.vfc).toHaveLength(2)
  })

  it('décrit les colonnes rattachées', () => {
    const csv = ['date,HRV,Créatine', '2026-07-24,60,5'].join('\n')
    const r = importerCsv(csv)
    const hrv = r.colonnes.find((c) => c.entete === 'HRV')!
    expect(hrv.idMetrique).toBe('vfc')
    expect(hrv.connue).toBe(true)
    expect(r.colonnes.find((c) => c.entete === 'Créatine')!.connue).toBe(false)
    expect(r.avertissements.join(' ')).toContain('hors catalogue')
  })
})
