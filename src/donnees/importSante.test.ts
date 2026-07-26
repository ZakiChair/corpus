import { describe, expect, it } from 'vitest'
import { valeurAuJour } from '../analyse/stats'
import {
  analyserHorodatage,
  creerLecteurSante,
  decoderEntites,
  importerSante,
  prochaineBalise,
} from './importSante'

/* —————————————————————————————— Fixtures —————————————————————————————— */

/**
 * Reproduit la forme d'un vrai `export.xml` : déclaration XML, bloc DOCTYPE
 * truffé de « < » (c'est là que les scanners naïfs se cassent), élément Me,
 * enregistrements, sommeil traversant minuit, et une séance.
 */
const EXPORT = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT HealthData (ExportDate,Me,(Record|Workout)*)>
<!ATTLIST Record type CDATA #REQUIRED value CDATA #IMPLIED>
<!ELEMENT Record (MetadataEntry)*>
]>
<HealthData locale="fr_CH">
 <ExportDate value="2026-07-26 08:00:00 +0200"/>
 <Me HKCharacteristicTypeIdentifierDateOfBirth="1996-04-12" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexMale"/>
 <Record type="HKQuantityTypeIdentifierHeight" unit="cm" startDate="2020-01-01 10:00:00 +0100" endDate="2020-01-01 10:00:00 +0100" value="181"/>

 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Apple Watch" unit="ms" startDate="2026-07-25 07:10:00 +0200" endDate="2026-07-25 07:12:00 +0200" value="58"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Apple Watch" unit="ms" startDate="2026-07-25 09:30:00 +0200" endDate="2026-07-25 09:32:00 +0200" value="64"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Apple Watch" unit="ms" startDate="2026-07-25 22:00:00 +0200" endDate="2026-07-25 22:02:00 +0200" value="94"/>

 <Record type="HKQuantityTypeIdentifierRestingHeartRate" unit="count/min" startDate="2026-07-25 08:00:00 +0200" endDate="2026-07-25 08:00:00 +0200" value="54"/>

 <Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-07-25 08:00:00 +0200" endDate="2026-07-25 09:00:00 +0200" value="1200"/>
 <Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-07-25 12:00:00 +0200" endDate="2026-07-25 13:00:00 +0200" value="3400"/>
 <Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-07-25 18:00:00 +0200" endDate="2026-07-25 19:00:00 +0200" value="2900"/>

 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Balance &amp; Co" unit="kg" startDate="2026-07-25 07:00:00 +0200" endDate="2026-07-25 07:00:00 +0200" value="74.8"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" startDate="2026-07-24 07:00:00 +0200" endDate="2026-07-24 07:00:00 +0200" value="165.3"/>

 <Record type="HKQuantityTypeIdentifierOxygenSaturation" unit="%" startDate="2026-07-25 03:00:00 +0200" endDate="2026-07-25 03:00:00 +0200" value="0.97"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" unit="count/min" startDate="2026-07-25 03:00:00 +0200" endDate="2026-07-25 03:00:00 +0200" value="52"/>

 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-07-24 23:30:00 +0200" endDate="2026-07-25 01:00:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepDeep" startDate="2026-07-25 01:00:00 +0200" endDate="2026-07-25 02:30:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAwake" startDate="2026-07-25 02:30:00 +0200" endDate="2026-07-25 02:45:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepREM" startDate="2026-07-25 02:45:00 +0200" endDate="2026-07-25 07:15:00 +0200"/>

 <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="62" durationUnit="min" startDate="2026-07-25 18:00:00 +0200" endDate="2026-07-25 19:02:00 +0200">
  <MetadataEntry key="HKIndoorWorkout" value="1"/>
 </Workout>
</HealthData>
`

function lireTout(texte: string) {
  const lecteur = creerLecteurSante()
  lecteur.ecrire(texte)
  return lecteur.terminer()
}

/* ————————————————————————— Scanner de balises ————————————————————————— */

describe('prochaineBalise', () => {
  it('lit le nom et les attributs', () => {
    const r = prochaineBalise('<Record type="A" value="3"/>', 0)
    expect(r.etat).toBe('trouvee')
    if (r.etat !== 'trouvee') return
    expect(r.balise.nom).toBe('Record')
    expect(r.balise.attributs).toEqual({ type: 'A', value: '3' })
  })

  it('traverse le bloc DOCTYPE sans s’y perdre', () => {
    // Le DOCTYPE contient des dizaines de « < » : un scanner qui ne filtre pas
    // sur l'initiale du nom s'y noie.
    const r = prochaineBalise(EXPORT, 0)
    expect(r.etat).toBe('trouvee')
    if (r.etat !== 'trouvee') return
    expect(r.balise.nom).toBe('HealthData')
  })

  it('ne coupe pas une balise sur un « > » contenu dans une valeur', () => {
    const r = prochaineBalise('<Record sourceName="Zaki &gt; Watch" value="1"/>', 0)
    if (r.etat !== 'trouvee') throw new Error('balise non trouvée')
    expect(r.balise.attributs.sourceName).toBe('Zaki > Watch')
    expect(r.balise.attributs.value).toBe('1')
  })

  it('accepte les apostrophes comme délimiteur', () => {
    const r = prochaineBalise("<Record type='B' value='7'/>", 0)
    if (r.etat !== 'trouvee') throw new Error('balise non trouvée')
    expect(r.balise.attributs).toEqual({ type: 'B', value: '7' })
  })

  it('signale une balise tronquée sans consommer son début', () => {
    const texte = '<Record type="A" val'
    const r = prochaineBalise(texte, 0)
    expect(r.etat).toBe('incomplete')
    if (r.etat !== 'incomplete') return
    expect(texte.slice(r.reprise)).toBe(texte)
  })

  it('signale la troncature même entre le « / » et le « > »', () => {
    const r = prochaineBalise('<Record type="A"/', 0)
    expect(r.etat).toBe('incomplete')
  })
})

describe('decoderEntites', () => {
  it('décode les entités XML usuelles', () => {
    expect(decoderEntites('a &lt; b &amp; c &gt; d &quot;e&quot;')).toBe('a < b & c > d "e"')
  })

  it('ne décode pas deux fois', () => {
    // « &amp;lt; » vaut le texte « &lt; », pas « < ».
    expect(decoderEntites('&amp;lt;')).toBe('&lt;')
  })
})

/* ————————————————————————————— Horodatage ————————————————————————————— */

describe('analyserHorodatage', () => {
  it('prend la journée LOCALE telle qu’écrite', () => {
    const h = analyserHorodatage('2026-07-25 07:12:03 +0200')!
    expect(h.jour).toBe('2026-07-25')
    expect(h.heure).toBeCloseTo(7 + 12 / 60 + 3 / 3600, 6)
  })

  it('tient compte du décalage pour l’instant absolu', () => {
    const a = analyserHorodatage('2026-07-25 12:00:00 +0200')!
    const b = analyserHorodatage('2026-07-25 12:00:00 +0000')!
    expect(b.ms - a.ms).toBe(2 * 3600 * 1000)
    // Mais les deux restent le 25 juillet dans leur fuseau respectif.
    expect(a.jour).toBe(b.jour)
  })

  it('rejette ce qui n’est pas un horodatage', () => {
    expect(analyserHorodatage('')).toBeNull()
    expect(analyserHorodatage('2026-07-25')).toBeNull()
    expect(analyserHorodatage('2026-02-31 07:00:00 +0200')).toBeNull()
  })
})

/* —————————————————————————— Lecture complète —————————————————————————— */

describe('lecture d’un export', () => {
  const r = lireTout(EXPORT)

  it('reprend le profil', () => {
    expect(r.profil).toEqual({ naissance: '1996-04-12', sexe: 'h', tailleCm: 181 })
  })

  it('médiane les mesures répétées dans la journée', () => {
    // Trois VFC le 25 : 58, 64, 94. Les valeurs sont choisies pour que chaque
    // agrégation candidate donne un résultat DIFFÉRENT — médiane 64, moyenne
    // 72, première 58, dernière 94 — sans quoi le test passerait aussi avec
    // une implémentation fausse.
    expect(valeurAuJour(r.series.vfc!, '2026-07-25')).toBe(64)
  })

  it('SOMME les pas au lieu de les médianer', () => {
    // 1200 + 3400 + 2900. Une médiane donnerait 2900 : c'est l'erreur que ce
    // test attrape, et elle passerait inaperçue à l'œil.
    expect(valeurAuJour(r.series.pas!, '2026-07-25')).toBe(7500)
  })

  it('convertit les livres en kilos', () => {
    expect(valeurAuJour(r.series.poids!, '2026-07-25')).toBe(74.8)
    expect(valeurAuJour(r.series.poids!, '2026-07-24')).toBeCloseTo(74.97, 1)
  })

  it('ignore les types non pris en charge, mais les compte', () => {
    const noms = r.typesIgnores.map((t) => t.type)
    expect(noms).toContain('HeartRate')
    expect(noms).toContain('OxygenSaturation')
    expect(r.series.HKQuantityTypeIdentifierHeartRate).toBeUndefined()
  })

  it('transforme les séances en annotations', () => {
    expect(r.annotations).toHaveLength(1)
    expect(r.annotations[0]!.j).toBe('2026-07-25')
    expect(r.annotations[0]!.type).toBe('seance')
    expect(r.annotations[0]!.note).toBe('Musculation — 62 min')
    expect(r.avertissements.join(' ')).toContain('effort perçu')
  })
})

describe('sommeil traversant minuit', () => {
  const r = lireTout(EXPORT)

  it('attribue la nuit au jour du RÉVEIL', () => {
    // Coucher le 24 à 23 h 30, réveil le 25 à 7 h 15. La convention de CORPUS
    // veut que la ligne du 25 porte cette nuit. Une inversion startDate /
    // endDate déposerait la durée sur le 24 : c'est l'assertion qui l'attrape.
    expect(valeurAuJour(r.series.sommeil_duree!, '2026-07-25')).toBeCloseTo(7.5, 2)
    expect(valeurAuJour(r.series.sommeil_duree!, '2026-07-24')).toBeUndefined()
  })

  it('exclut le réveil nocturne de la durée de sommeil', () => {
    // 23 h 30 → 7 h 15 fait 7 h 45, moins le quart d'heure d'éveil = 7 h 30.
    expect(valeurAuJour(r.series.sommeil_duree!, '2026-07-25')).toBeCloseTo(7.5, 2)
    expect(valeurAuJour(r.series.sommeil_reveils!, '2026-07-25')).toBe(1)
  })

  it('isole le sommeil profond', () => {
    expect(valeurAuJour(r.series.sommeil_profond!, '2026-07-25')).toBeCloseTo(1.5, 2)
  })

  it('rend une heure de coucher monotone au-delà de minuit', () => {
    // 23 h 30 reste 23,5 ; un coucher à 1 h 30 deviendrait 25,5 plutôt que 1,5,
    // sans quoi deux couchers voisins seraient aux extrémités de l'échelle.
    expect(valeurAuJour(r.series.sommeil_coucher!, '2026-07-25')).toBeCloseTo(23.5, 2)
  })

  it('ne double pas la durée quand deux sources enregistrent la même nuit', () => {
    // Une montre ET une application tierce couvrant le même intervalle : la
    // durée doit être l'UNION, pas la somme.
    const doublon = EXPORT.replace(
      '</HealthData>',
      ` <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="AutreApp" value="HKCategoryValueSleepAnalysisAsleepUnspecified" startDate="2026-07-24 23:30:00 +0200" endDate="2026-07-25 07:15:00 +0200"/>
</HealthData>`,
    )
    const avecDoublon = lireTout(doublon)
    expect(valeurAuJour(avecDoublon.series.sommeil_duree!, '2026-07-25')).toBeCloseTo(7.75, 2)
  })
})

describe('pas venant de plusieurs appareils', () => {
  function exportPas(lignes: string[]): string {
    return `<HealthData>\n${lignes.join('\n')}\n</HealthData>`
  }
  const pas = (source: string, heure: string, valeur: number) =>
    ` <Record type="HKQuantityTypeIdentifierStepCount" sourceName="${source}" unit="count" startDate="2026-07-25 ${heure}:00 +0200" endDate="2026-07-25 ${heure}:59 +0200" value="${valeur}"/>`

  it('retient la source dominante du jour au lieu d’additionner les appareils', () => {
    // La montre et le téléphone comptent les MÊMES pas chacun de leur côté :
    // additionner les deux donnerait 11 000 pour une journée de 7 000.
    const r = lireTout(exportPas([pas('Apple Watch', '08:00', 5000), pas('Apple Watch', '14:00', 2000), pas('iPhone', '08:10', 4000)]))
    expect(valeurAuJour(r.series.pas!, '2026-07-25')).toBe(7000)
    expect(r.avertissements.join(' ')).toContain('source')
  })

  it('ne tronque pas la somme d’une journée à plus de 512 enregistrements', () => {
    // Un couple montre + téléphone produit facilement des centaines
    // d'enregistrements de pas par jour : la somme doit rester exacte.
    const lignes = Array.from({ length: 600 }, () => pas('Apple Watch', '08:00', 10))
    const r = lireTout(exportPas(lignes))
    expect(valeurAuJour(r.series.pas!, '2026-07-25')).toBe(6000)
  })
})

describe('réveils nocturnes', () => {
  it('ignore les micro-éveils de moins de deux minutes', () => {
    // La montre segmente une nuit réelle en dizaines de micro-éveils de
    // quelques secondes ; les compter tous ferait rejeter la série entière
    // par les bornes du catalogue (max 15).
    const nuit = `<HealthData>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-07-24 23:00:00 +0200" endDate="2026-07-25 02:00:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAwake" startDate="2026-07-25 02:00:00 +0200" endDate="2026-07-25 02:00:40 +0200"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAwake" startDate="2026-07-25 02:01:00 +0200" endDate="2026-07-25 02:16:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-07-25 02:16:00 +0200" endDate="2026-07-25 07:00:00 +0200"/>
</HealthData>`
    const r = lireTout(nuit)
    // Seul le réveil de quinze minutes compte ; celui de quarante secondes non.
    expect(valeurAuJour(r.series.sommeil_reveils!, '2026-07-25')).toBe(1)
  })
})

describe('masse grasse : décision d’échelle sur tout le fichier', () => {
  function exportAvecMasseGrasse(valeurs: string[]): string {
    const lignes = valeurs
      .map(
        (v, i) =>
          ` <Record type="HKQuantityTypeIdentifierBodyFatPercentage" unit="%" startDate="2026-07-${String(
            10 + i,
          ).padStart(2, '0')} 07:00:00 +0200" endDate="2026-07-${String(10 + i).padStart(
            2,
            '0',
          )} 07:00:00 +0200" value="${v}"/>`,
      )
      .join('\n')
    return `<HealthData>\n${lignes}\n</HealthData>`
  }

  it('convertit tout le fichier quand il est écrit en fractions', () => {
    const r = lireTout(exportAvecMasseGrasse(['0.152', '0.148', '0.151']))
    expect(valeurAuJour(r.series.masse_grasse!, '2026-07-10')).toBeCloseTo(15.2, 3)
    expect(r.avertissements.join(' ')).toContain('fraction')
  })

  it('ne touche à rien quand il est déjà en pourcentage', () => {
    const r = lireTout(exportAvecMasseGrasse(['15.2', '14.8', '15.1']))
    expect(valeurAuJour(r.series.masse_grasse!, '2026-07-10')).toBeCloseTo(15.2, 3)
    expect(r.avertissements.join(' ')).not.toContain('fraction')
  })

  it('tranche sur le FICHIER et non enregistrement par enregistrement', () => {
    // Un fichier en pourcentage contenant une valeur basse ne doit pas voir
    // cette seule valeur multipliée par cent : la décision est globale.
    const r = lireTout(exportAvecMasseGrasse(['15.2', '0.9', '14.8']))
    expect(valeurAuJour(r.series.masse_grasse!, '2026-07-10')).toBeCloseTo(15.2, 3)
    // 0,9 % est hors des bornes du catalogue (3 – 55) : le point est écarté,
    // et surtout PAS transformé en 90 %.
    expect(valeurAuJour(r.series.masse_grasse!, '2026-07-11')).toBeUndefined()
  })
})

/* ————————————————— Robustesse au découpage en morceaux ————————————————— */

describe('lecture par morceaux', () => {
  const attendu = lireTout(EXPORT)

  it('donne le même résultat quelle que soit la taille des morceaux', () => {
    for (const taille of [1, 2, 3, 7, 13, 64, 500, 4096]) {
      const lecteur = creerLecteurSante()
      for (let i = 0; i < EXPORT.length; i += taille) {
        lecteur.ecrire(EXPORT.slice(i, i + taille))
      }
      expect(lecteur.terminer(), `morceaux de ${taille} octets`).toEqual(attendu)
    }
  })

  it('résiste à des coupures placées aux endroits les plus hostiles', () => {
    // Au milieu d'un nom de balise, d'un nom d'attribut, d'une valeur, et
    // entre le « / » et le « > » final.
    const pieges = ['<Reco', 'type="HKQuantityTypeIdentifierStep', 'value="12', '"/', ' +02']
    for (const piege of pieges) {
      const coupure = EXPORT.indexOf(piege)
      if (coupure < 0) throw new Error(`piège introuvable : ${piege}`)
      const point = coupure + piege.length
      const lecteur = creerLecteurSante()
      lecteur.ecrire(EXPORT.slice(0, point))
      lecteur.ecrire(EXPORT.slice(point))
      expect(lecteur.terminer(), `coupure après « ${piege} »`).toEqual(attendu)
    }
  })
})

/* ————————————————————————— Pilotage du fichier ————————————————————————— */

describe('importerSante', () => {
  it('lit un XML depuis un Blob et rapporte la progression', async () => {
    const blob = new Blob([EXPORT], { type: 'text/xml' })
    const progressions: number[] = []
    const r = await importerSante(blob, 'export.xml', {
      onProgression: (p) => progressions.push(p.octetsLus),
    })
    expect(valeurAuJour(r.series.pas!, '2026-07-25')).toBe(7500)
    expect(progressions.length).toBeGreaterThan(0)
    expect(progressions[progressions.length - 1]).toBe(blob.size)
  })

  it('respecte une annulation', async () => {
    const controleur = new AbortController()
    controleur.abort()
    const blob = new Blob([EXPORT], { type: 'text/xml' })
    await expect(
      importerSante(blob, 'export.xml', { signal: controleur.signal }),
    ).rejects.toThrow('annulé')
  })

  it('ne casse pas un caractère multi-octet à la frontière d’un morceau', async () => {
    // « Vélo » en UTF-8 met le « é » sur deux octets ; un décodage sans
    // continuation le remplacerait par un caractère de remplacement.
    const avecAccents = EXPORT.replace('sourceName="Apple Watch"', 'sourceName="Montre à Zaki"')
    const blob = new Blob([avecAccents], { type: 'text/xml' })
    const r = await importerSante(blob, 'export.xml')
    expect(valeurAuJour(r.series.vfc!, '2026-07-25')).toBe(64)
  })
})
