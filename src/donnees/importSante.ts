import { definitionMetrique } from '../core/metriques'
import { estJourValide, type Jour } from '../core/temps'
import { normaliserSerie, type Annotation, type Profil, type Serie } from '../core/types'
import { mediane } from '../analyse/stats'
import { ErreurZip, fluxEntree, listerEntrees, trouverParNomDeFichier } from './archiveZip'

/**
 * Import d'un export Apple Santé.
 *
 * ————————————————————————————————————————————————————————————————————————————
 * CE QUI EST VÉRIFIÉ : le parseur est testé contre un fixture écrit à la main,
 * contre la lecture d'une archive ZIP (stockée et deflate), et contre un
 * découpage du même fixture à des frontières d'octets délibérément hostiles —
 * au milieu d'un attribut, d'un nom de balise, entre le « / » et le « > ».
 *
 * CE QUI NE L'EST PAS : aucun export réel n'a été passé dans ce code. Un vrai
 * `export.xml` pèse plusieurs centaines de mégaoctets et n'était pas
 * disponible. La lecture est écrite en flux pour cette raison — rien n'est
 * chargé d'un bloc — mais le premier import réel reste à faire.
 * ————————————————————————————————————————————————————————————————————————————
 *
 * Le format d'Apple a une propriété commode : ses horodatages portent l'heure
 * LOCALE suivie du décalage (« 2026-07-25 07:12:03 +0200 »). Les dix premiers
 * caractères donnent donc directement la journée vécue, sans arithmétique de
 * fuseau. Les durées, elles, exigent la conversion complète.
 */

/* ————————————————————————— Scanner de balises ————————————————————————— */

export interface Balise {
  nom: string
  attributs: Record<string, string>
}

export type ResultatScan =
  | { etat: 'trouvee'; balise: Balise; suite: number }
  /** Une balise commence à `reprise` mais le texte s'arrête au milieu. */
  | { etat: 'incomplete'; reprise: number }
  /** Plus rien d'exploitable ; `reprise` est la position à conserver. */
  | { etat: 'epuise'; reprise: number }

const DEBUT_NOM = /[A-Za-z_]/
const SUITE_NOM = /[A-Za-z0-9_.:-]/

function estEspace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r'
}

export function decoderEntites(s: string): string {
  if (!s.includes('&')) return s
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&#0?34;/g, '"')
    // En dernier, sinon « &amp;lt; » se transformerait en « < ».
    .replace(/&amp;/g, '&')
}

/**
 * Prochaine balise ouvrante à partir de `depuis`.
 *
 * Écrit à la main plutôt qu'en expression rationnelle : une valeur d'attribut
 * peut contenir un « > » (un `sourceName` fantaisiste suffit), et un motif qui
 * s'arrête au premier « > » couperait la balise en deux. Le scanner respecte
 * donc les guillemets.
 *
 * Les déclarations et commentaires — `<!DOCTYPE`, `<!ELEMENT`, `<?xml` — sont
 * ignorés parce que leur nom ne commence pas par une lettre. C'est ce qui
 * permet de traverser sans dommage le bloc DOCTYPE d'Apple, qui contient
 * lui-même des dizaines de « < ».
 */
export function prochaineBalise(texte: string, depuis: number): ResultatScan {
  let i = depuis
  while (i < texte.length) {
    const chevron = texte.indexOf('<', i)
    if (chevron < 0) return { etat: 'epuise', reprise: texte.length }
    let p = chevron + 1
    if (p >= texte.length) return { etat: 'incomplete', reprise: chevron }
    if (!DEBUT_NOM.test(texte[p]!)) {
      i = chevron + 1
      continue
    }
    let nom = ''
    while (p < texte.length && SUITE_NOM.test(texte[p]!)) nom += texte[p++]
    if (p >= texte.length) return { etat: 'incomplete', reprise: chevron }

    const attributs: Record<string, string> = {}
    for (;;) {
      while (p < texte.length && estEspace(texte[p]!)) p++
      if (p >= texte.length) return { etat: 'incomplete', reprise: chevron }
      const c = texte[p]!
      if (c === '/') {
        if (p + 1 >= texte.length) return { etat: 'incomplete', reprise: chevron }
        return { etat: 'trouvee', balise: { nom, attributs }, suite: p + 2 }
      }
      if (c === '>') return { etat: 'trouvee', balise: { nom, attributs }, suite: p + 1 }

      let cle = ''
      while (p < texte.length && SUITE_NOM.test(texte[p]!)) cle += texte[p++]
      if (p >= texte.length) return { etat: 'incomplete', reprise: chevron }
      if (cle === '') {
        // Caractère inattendu : on abandonne cette balise plutôt que de boucler.
        i = chevron + 1
        break
      }
      while (p < texte.length && estEspace(texte[p]!)) p++
      if (p >= texte.length) return { etat: 'incomplete', reprise: chevron }
      if (texte[p] !== '=') {
        attributs[cle] = ''
        continue
      }
      p++
      while (p < texte.length && estEspace(texte[p]!)) p++
      if (p >= texte.length) return { etat: 'incomplete', reprise: chevron }
      const guillemet = texte[p]!
      if (guillemet !== '"' && guillemet !== "'") return { etat: 'incomplete', reprise: chevron }
      p++
      const finValeur = texte.indexOf(guillemet, p)
      if (finValeur < 0) return { etat: 'incomplete', reprise: chevron }
      attributs[cle] = decoderEntites(texte.slice(p, finValeur))
      p = finValeur + 1
    }
  }
  return { etat: 'epuise', reprise: texte.length }
}

/* ————————————————————————————— Horodatage ————————————————————————————— */

const HORODATAGE = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})\s*([+-]\d{2}):?(\d{2})?/

export interface Horodatage {
  /** Journée LOCALE, telle qu'écrite dans le fichier. */
  jour: Jour
  /** Instant absolu, pour les durées. */
  ms: number
  /** Heure locale en heures décimales (7 h 30 → 7,5). */
  heure: number
}

export function analyserHorodatage(brut: string): Horodatage | null {
  const m = HORODATAGE.exec(brut.trim())
  if (!m) return null
  const jour = m[1]!
  if (!estJourValide(jour)) return null
  const h = Number(m[2])
  const min = Number(m[3])
  const sec = Number(m[4])
  const decalage = `${m[5]}:${m[6] ?? '00'}`
  const ms = Date.parse(`${jour}T${m[2]}:${m[3]}:${m[4]}${decalage}`)
  if (!Number.isFinite(ms)) return null
  return { jour, ms, heure: h + min / 60 + sec / 3600 }
}

/* ——————————————————————— Correspondances de métriques ——————————————————————— */

type Mode = 'mediane' | 'somme' | 'dernier'

interface Correspondance {
  id: string
  mode: Mode
  /** Unités acceptées, avec leur facteur vers l'unité de CORPUS. */
  facteurs?: Record<string, number>
  /**
   * L'unité déclarée est « % » mais la valeur peut être une fraction.
   * La décision se prend sur TOUT le fichier, jamais par enregistrement.
   */
  pourcentageAmbigu?: boolean
}

const CORRESPONDANCES: Record<string, Correspondance> = {
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: {
    id: 'vfc',
    mode: 'mediane',
    facteurs: { ms: 1, s: 1000 },
  },
  HKQuantityTypeIdentifierRestingHeartRate: { id: 'fc_repos', mode: 'mediane' },
  HKQuantityTypeIdentifierBodyMass: {
    id: 'poids',
    mode: 'mediane',
    facteurs: { kg: 1, lb: 0.45359237, g: 0.001 },
  },
  HKQuantityTypeIdentifierBodyFatPercentage: {
    id: 'masse_grasse',
    mode: 'mediane',
    pourcentageAmbigu: true,
  },
  HKQuantityTypeIdentifierWaistCircumference: {
    id: 'tour_taille',
    mode: 'mediane',
    facteurs: { cm: 1, in: 2.54, m: 100 },
  },
  HKQuantityTypeIdentifierStepCount: { id: 'pas', mode: 'somme' },
}

const FACTEURS_TAILLE: Record<string, number> = { cm: 1, in: 2.54, m: 100, ft: 30.48 }

/** Partagé avec l'import Health Auto Export, qui écrit les mêmes activités. */
export const ETIQUETTES_SEANCE: Record<string, string> = {
  TraditionalStrengthTraining: 'Musculation',
  FunctionalStrengthTraining: 'Renforcement',
  Running: 'Course',
  Walking: 'Marche',
  Cycling: 'Vélo',
  Swimming: 'Natation',
  HighIntensityIntervalTraining: 'Fractionné',
  Rowing: 'Rameur',
  Elliptical: 'Elliptique',
  Yoga: 'Yoga',
  CoreTraining: 'Gainage',
  Tennis: 'Tennis',
  Soccer: 'Football',
  Basketball: 'Basketball',
  Hiking: 'Randonnée',
  Climbing: 'Escalade',
  Boxing: 'Boxe',
}

/**
 * Un jour de mesure ne garde que ses N premières valeurs, pour rester borné.
 * Ne concerne que les modes médiane et dernier : les sommes s'accumulent au
 * fil de l'eau et ne passent jamais par une liste.
 */
const MAX_VALEURS_PAR_JOUR = 512
/** Écart maximal entre deux segments pour qu'ils appartiennent à la même nuit. */
const ECART_MEME_NUIT_MS = 60 * 60 * 1000
/** Durée minimale d'une session pour qu'elle définisse une heure de coucher. */
const DUREE_MIN_NUIT_H = 2
/**
 * Durée minimale d'un segment « éveil » pour compter comme réveil nocturne.
 * La montre segmente une nuit réelle en dizaines de micro-éveils de quelques
 * secondes : les compter tous ferait rejeter la série entière par les bornes
 * du catalogue, et personne n'appelle « réveil » quarante secondes d'agitation.
 */
const DUREE_MIN_EVEIL_MS = 2 * 60 * 1000

/* ————————————————————————— Lecteur incrémental ————————————————————————— */

export interface ResultatSante {
  series: Record<string, Serie>
  annotations: Annotation[]
  profil: Profil
  enregistrementsLus: number
  enregistrementsRetenus: number
  typesIgnores: { type: string; n: number }[]
  avertissements: string[]
}

type CategorieSommeil = 'endormi' | 'profond' | 'eveil' | 'aulit'

interface SegmentSommeil {
  debutMs: number
  finMs: number
  jourFin: Jour
  heureDebut: number
  categorie: CategorieSommeil
}

export interface LecteurSante {
  ecrire: (fragment: string) => void
  terminer: () => ResultatSante
  enregistrementsLus: () => number
}

export function creerLecteurSante(): LecteurSante {
  let tampon = ''
  let lus = 0
  let retenus = 0
  const ignores = new Map<string, number>()
  /** id → jour → valeurs brutes (facteur d'unité déjà appliqué). */
  const brut = new Map<string, Map<Jour, number[]>>()
  /**
   * id → jour → source → total, pour les modes « somme ». Accumuler au fil de
   * l'eau plutôt que stocker la liste : tronquer à MAX_VALEURS_PAR_JOUR
   * fausserait la somme d'une journée active. Le détail par source sert au
   * dédoublonnage : iPhone et Apple Watch comptent chacun les mêmes pas.
   */
  const sommes = new Map<string, Map<Jour, Map<string, number>>>()
  const segments: SegmentSommeil[] = []
  const seances: { jour: Jour; etiquette: string; minutes: number }[] = []
  const avertissements: string[] = []
  const profil: Profil = {}
  let tailleCm: number | undefined
  let sansAsleep = false

  function ajouter(id: string, jour: Jour, valeur: number): void {
    let parJour = brut.get(id)
    if (!parJour) {
      parJour = new Map()
      brut.set(id, parJour)
    }
    const liste = parJour.get(jour)
    if (!liste) parJour.set(jour, [valeur])
    // Les N PREMIÈRES valeurs, pas un échantillon aléatoire : le résultat doit
    // être reproductible d'un import à l'autre.
    else if (liste.length < MAX_VALEURS_PAR_JOUR) liste.push(valeur)
  }

  function ajouterSomme(id: string, jour: Jour, source: string, valeur: number): void {
    let parJour = sommes.get(id)
    if (!parJour) {
      parJour = new Map()
      sommes.set(id, parJour)
    }
    let parSource = parJour.get(jour)
    if (!parSource) {
      parSource = new Map()
      parJour.set(jour, parSource)
    }
    parSource.set(source, (parSource.get(source) ?? 0) + valeur)
  }

  function traiterRecord(a: Record<string, string>): void {
    lus++
    const type = a.type
    if (!type) return

    if (type === 'HKQuantityTypeIdentifierHeight') {
      const v = Number(a.value)
      const f = FACTEURS_TAILLE[a.unit ?? 'cm']
      if (Number.isFinite(v) && f !== undefined) {
        const cm = v * f
        if (cm > 80 && cm < 260) tailleCm = cm
      }
      retenus++
      return
    }

    if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
      const debut = analyserHorodatage(a.startDate ?? '')
      const fin = analyserHorodatage(a.endDate ?? '')
      if (!debut || !fin || fin.ms <= debut.ms) return
      const valeur = a.value ?? ''
      let categorie: CategorieSommeil
      if (valeur.endsWith('AsleepDeep')) categorie = 'profond'
      else if (valeur.includes('Asleep')) categorie = 'endormi'
      else if (valeur.endsWith('Awake')) categorie = 'eveil'
      else if (valeur.endsWith('InBed')) categorie = 'aulit'
      else return
      segments.push({
        debutMs: debut.ms,
        finMs: fin.ms,
        jourFin: fin.jour,
        heureDebut: debut.heure,
        categorie,
      })
      retenus++
      return
    }

    const corr = CORRESPONDANCES[type]
    if (!corr) {
      ignores.set(type, (ignores.get(type) ?? 0) + 1)
      return
    }
    const horodatage = analyserHorodatage(a.startDate ?? a.creationDate ?? '')
    if (!horodatage) return
    const v = Number(a.value)
    if (!Number.isFinite(v)) return

    let valeur = v
    if (corr.facteurs) {
      const f = corr.facteurs[a.unit ?? '']
      // Unité inconnue : on préfère écarter que convertir au hasard.
      if (f === undefined) return
      valeur = v * f
    }
    if (corr.mode === 'somme') ajouterSomme(corr.id, horodatage.jour, a.sourceName ?? '', valeur)
    else ajouter(corr.id, horodatage.jour, valeur)
    retenus++
  }

  function traiterWorkout(a: Record<string, string>): void {
    lus++
    const debut = analyserHorodatage(a.startDate ?? '')
    if (!debut) return
    const duree = Number(a.duration)
    if (!Number.isFinite(duree) || duree <= 0) return
    const minutes = (a.durationUnit ?? 'min') === 's' ? duree / 60 : duree
    const brutType = (a.workoutActivityType ?? '').replace('HKWorkoutActivityType', '')
    seances.push({
      jour: debut.jour,
      etiquette: ETIQUETTES_SEANCE[brutType] ?? (brutType || 'Séance'),
      minutes,
    })
    retenus++
  }

  function traiterMe(a: Record<string, string>): void {
    const naissance = a.HKCharacteristicTypeIdentifierDateOfBirth
    if (naissance && estJourValide(naissance)) profil.naissance = naissance
    const sexe = a.HKCharacteristicTypeIdentifierBiologicalSex ?? ''
    if (sexe.endsWith('Male')) profil.sexe = 'h'
    else if (sexe.endsWith('Female')) profil.sexe = 'f'
    else if (sexe) profil.sexe = 'nsp'
  }

  function ecrire(fragment: string): void {
    tampon += fragment
    let position = 0
    for (;;) {
      const r = prochaineBalise(tampon, position)
      if (r.etat === 'trouvee') {
        const { nom, attributs } = r.balise
        if (nom === 'Record') traiterRecord(attributs)
        else if (nom === 'Workout') traiterWorkout(attributs)
        else if (nom === 'Me') traiterMe(attributs)
        position = r.suite
        continue
      }
      // Balise incomplète ou fin de fragment : on garde la queue pour la
      // prochaine écriture. C'est ce report qui rend le découpage en morceaux
      // transparent, quel que soit l'endroit où il tombe.
      tampon = tampon.slice(r.reprise)
      return
    }
  }

  function terminer(): ResultatSante {
    const series: Record<string, Serie> = {}

    /* — Décision d'échelle pour la masse grasse, une fois pour tout le fichier — */
    const parJourMasse = brut.get('masse_grasse')
    let facteurMasseGrasse = 1
    if (parJourMasse) {
      let maximum = 0
      for (const liste of parJourMasse.values()) for (const v of liste) maximum = Math.max(maximum, v)
      if (maximum > 0 && maximum <= 1) {
        facteurMasseGrasse = 100
        avertissements.push(
          'La masse grasse était exprimée en fraction (maximum du fichier ≤ 1) : tout le fichier a été converti en pourcentage.',
        )
      }
    }

    /* — Agrégation journalière — */
    for (const [id, parJour] of brut) {
      const corr = Object.values(CORRESPONDANCES).find((c) => c.id === id)
      const mode: Mode = corr?.mode ?? 'mediane'
      const def = definitionMetrique(id)
      const points: { j: Jour; v: number }[] = []
      for (const [jour, liste] of parJour) {
        if (liste.length === 0) continue
        let v = mode === 'dernier' ? liste[liste.length - 1]! : mediane(liste)
        if (id === 'masse_grasse') v *= facteurMasseGrasse
        if (!Number.isFinite(v)) continue
        // Les bornes du catalogue écartent les conversions manifestement ratées.
        if (def && (v < def.min || v > def.max)) continue
        points.push({ j: jour, v })
      }
      if (points.length > 0) series[id] = normaliserSerie(points)
    }

    /* — Modes « somme » : la source dominante du jour, pas le total des sources — */
    let joursMultiSources = 0
    for (const [id, parJour] of sommes) {
      const def = definitionMetrique(id)
      const points: { j: Jour; v: number }[] = []
      for (const [jour, parSource] of parJour) {
        // L'app Santé dédoublonne les appareils par priorité de source ;
        // additionner les sources recompterait deux fois les mêmes pas.
        // Retenir la source la plus fournie du jour peut légèrement
        // sous-estimer, jamais doubler.
        let v = 0
        for (const total of parSource.values()) v = Math.max(v, total)
        if (parSource.size > 1) joursMultiSources++
        if (!Number.isFinite(v)) continue
        if (def && (v < def.min || v > def.max)) continue
        points.push({ j: jour, v })
      }
      if (points.length > 0) series[id] = normaliserSerie(points)
    }
    if (joursMultiSources > 0) {
      avertissements.push(
        `Plusieurs appareils comptaient les mêmes pas : la source la plus fournie de chaque jour a été retenue (${joursMultiSources} jour${joursMultiSources > 1 ? 's' : ''} concerné${joursMultiSources > 1 ? 's' : ''}).`,
      )
    }

    /* — Sommeil : regroupement en nuits — */
    const nuits = regrouperNuits(segments)
    const dureeParJour = new Map<Jour, number>()
    const profondParJour = new Map<Jour, number>()
    const coucherParJour = new Map<Jour, { heure: number; duree: number }>()
    const reveilsParJour = new Map<Jour, { n: number; duree: number }>()

    for (const nuit of nuits) {
      dureeParJour.set(nuit.jour, (dureeParJour.get(nuit.jour) ?? 0) + nuit.dureeH)
      if (nuit.profondH > 0) {
        profondParJour.set(nuit.jour, (profondParJour.get(nuit.jour) ?? 0) + nuit.profondH)
      }
      if (nuit.dureeH >= DUREE_MIN_NUIT_H) {
        // La nuit la plus LONGUE du jour définit l'heure de coucher : une sieste
        // de l'après-midi ne doit pas la remplacer.
        const actuel = coucherParJour.get(nuit.jour)
        if (!actuel || nuit.dureeH > actuel.duree) {
          coucherParJour.set(nuit.jour, { heure: nuit.coucher, duree: nuit.dureeH })
        }
        const reveils = reveilsParJour.get(nuit.jour)
        if (!reveils || nuit.dureeH > reveils.duree) {
          reveilsParJour.set(nuit.jour, { n: nuit.reveils, duree: nuit.dureeH })
        }
      }
      if (nuit.depuisAuLit) sansAsleep = true
    }

    poserSerie(series, 'sommeil_duree', dureeParJour)
    poserSerie(series, 'sommeil_profond', profondParJour)
    poserSerie(
      series,
      'sommeil_coucher',
      new Map([...coucherParJour].map(([j, c]) => [j, c.heure])),
    )
    poserSerie(series, 'sommeil_reveils', new Map([...reveilsParJour].map(([j, r]) => [j, r.n])))

    if (sansAsleep) {
      avertissements.push(
        'Certaines nuits n’avaient aucun segment « endormi » : le temps passé au lit a été utilisé à la place, ce qui surestime légèrement la durée.',
      )
    }

    /* — Séances — */
    const annotations: Annotation[] = seances.map((s, i) => ({
      id: `sante-${i}`,
      j: s.jour,
      // L'intensité est dérivée de la seule DURÉE : l'export ne contient aucune
      // notion d'effort perçu. C'est un substitut, pas une mesure.
      intensite: Math.min(1, Math.max(0.15, s.minutes / 90)),
      type: 'seance',
      note: `${s.etiquette} — ${Math.round(s.minutes)} min`,
    }))
    if (seances.length > 0) {
      avertissements.push(
        'L’intensité des séances est dérivée de leur durée : l’export ne contient pas d’effort perçu. La charge de séance n’est donc pas renseignée.',
      )
    }

    if (tailleCm !== undefined) profil.tailleCm = Math.round(tailleCm * 10) / 10

    const typesIgnores = [...ignores.entries()]
      .map(([type, n]) => ({ type: type.replace('HKQuantityTypeIdentifier', ''), n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 12)

    return {
      series,
      annotations: annotations.sort((a, b) => (a.j < b.j ? -1 : 1)),
      profil,
      enregistrementsLus: lus,
      enregistrementsRetenus: retenus,
      typesIgnores,
      avertissements,
    }
  }

  return { ecrire, terminer, enregistrementsLus: () => lus }
}

function poserSerie(
  series: Record<string, Serie>,
  id: string,
  parJour: Map<Jour, number>,
): void {
  const def = definitionMetrique(id)
  const points: { j: Jour; v: number }[] = []
  for (const [jour, v] of parJour) {
    if (!Number.isFinite(v)) continue
    if (def && (v < def.min || v > def.max)) continue
    points.push({ j: jour, v: Math.round(v * 100) / 100 })
  }
  if (points.length > 0) series[id] = normaliserSerie(points)
}

export interface Nuit {
  /** Jour du RÉVEIL : la ligne du jour J porte la nuit qui s'achève ce matin-là. */
  jour: Jour
  dureeH: number
  profondH: number
  coucher: number
  reveils: number
  /** Vrai si la durée vient du temps au lit, faute de segments « endormi ». */
  depuisAuLit: boolean
}

/**
 * Regroupe les segments en nuits, puis attribue chaque nuit au jour de son
 * RÉVEIL — conformément à la convention de CORPUS : la ligne du jour J porte
 * la nuit qui s'achève le matin J.
 *
 * Les durées sont calculées sur l'UNION des intervalles, non sur leur somme.
 * Sans cela, une montre et une application tierce enregistrant la même nuit
 * doubleraient le temps de sommeil.
 */
export function regrouperNuits(segments: readonly SegmentSommeil[]): Nuit[] {
  if (segments.length === 0) return []
  const tri = [...segments].sort((a, b) => a.debutMs - b.debutMs)
  const groupes: SegmentSommeil[][] = []
  let courant: SegmentSommeil[] = [tri[0]!]
  let finCourante = tri[0]!.finMs

  for (let i = 1; i < tri.length; i++) {
    const s = tri[i]!
    if (s.debutMs - finCourante > ECART_MEME_NUIT_MS) {
      groupes.push(courant)
      courant = [s]
      finCourante = s.finMs
    } else {
      courant.push(s)
      finCourante = Math.max(finCourante, s.finMs)
    }
  }
  groupes.push(courant)

  return groupes.map((groupe) => {
    const endormis = groupe.filter((s) => s.categorie === 'endormi' || s.categorie === 'profond')
    const depuisAuLit = endormis.length === 0
    const pourDuree = depuisAuLit ? groupe.filter((s) => s.categorie === 'aulit') : endormis
    const dureeH = unionMs(pourDuree) / 3_600_000
    const profondH = unionMs(groupe.filter((s) => s.categorie === 'profond')) / 3_600_000
    // Le segment qui ouvre la nuit donne l'heure de coucher. Une heure d'avant
    // midi est repoussée au-delà de 24 pour rester monotone : 1 h 30 devient
    // 25,5, sinon un coucher à 23 h 50 et un à 00 h 10 se retrouveraient aux
    // deux extrémités de l'échelle alors qu'ils sont voisins.
    const premier = groupe[0]!
    const coucher = premier.heureDebut < 12 ? premier.heureDebut + 24 : premier.heureDebut
    const dernier = groupe.reduce((a, b) => (a.finMs >= b.finMs ? a : b))
    return {
      jour: dernier.jourFin,
      dureeH: Math.round(dureeH * 100) / 100,
      profondH: Math.round(profondH * 100) / 100,
      coucher: Math.round(coucher * 100) / 100,
      reveils: groupe.filter(
        (s) => s.categorie === 'eveil' && s.finMs - s.debutMs >= DUREE_MIN_EVEIL_MS,
      ).length,
      depuisAuLit,
    }
  })
}

/** Durée couverte par l'union d'intervalles, chevauchements comptés une fois. */
function unionMs(segments: readonly SegmentSommeil[]): number {
  if (segments.length === 0) return 0
  const tri = [...segments].sort((a, b) => a.debutMs - b.debutMs)
  let total = 0
  let debut = tri[0]!.debutMs
  let fin = tri[0]!.finMs
  for (let i = 1; i < tri.length; i++) {
    const s = tri[i]!
    if (s.debutMs > fin) {
      total += fin - debut
      debut = s.debutMs
      fin = s.finMs
    } else if (s.finMs > fin) {
      fin = s.finMs
    }
  }
  return total + (fin - debut)
}

/* ————————————————————————— Pilotage du fichier ————————————————————————— */

export interface ProgressionSante {
  octetsLus: number
  octetsTotal: number
  enregistrementsLus: number
}

export interface OptionsImportSante {
  onProgression?: (p: ProgressionSante) => void
  signal?: AbortSignal
}

/** Un import annulé lève cette erreur plutôt que de rendre un résultat partiel. */
export class ImportAnnule extends Error {
  constructor() {
    super('Import annulé.')
  }
}

/**
 * Lit un `export.xml` ou l'`export.zip` d'Apple Santé.
 *
 * La lecture est faite en flux et par morceaux : `Blob.text()` matérialiserait
 * plusieurs centaines de mégaoctets d'un coup, et le doublerait en mémoire
 * puisque les chaînes JavaScript sont en UTF-16.
 */
export async function importerSante(
  fichier: Blob,
  nom: string,
  options: OptionsImportSante = {},
): Promise<ResultatSante> {
  const { onProgression, signal } = options
  let flux: ReadableStream<Uint8Array>
  let octetsTotal = fichier.size

  if (nom.toLowerCase().endsWith('.zip')) {
    const entrees = await listerEntrees(fichier)
    const entree = trouverParNomDeFichier(entrees, 'export.xml')
    if (!entree) {
      throw new ErreurZip(
        `Aucun « export.xml » dans l’archive. Entrées trouvées : ${entrees
          .map((e) => e.nom)
          .slice(0, 6)
          .join(', ')}.`,
      )
    }
    flux = await fluxEntree(fichier, entree)
    octetsTotal = entree.tailleDecompressee || entree.tailleCompressee
  } else {
    flux = fichier.stream() as ReadableStream<Uint8Array>
  }

  const lecteur = creerLecteurSante()
  const decodeur = new TextDecoder('utf-8')
  const source = flux.getReader()
  let octetsLus = 0
  let depuisDerniereAnnonce = 0

  try {
    for (;;) {
      if (signal?.aborted) throw new ImportAnnule()
      const { done, value } = await source.read()
      if (done) break
      if (!value) continue
      octetsLus += value.byteLength
      // `stream: true` est indispensable : un caractère multi-octet coupé à la
      // frontière d'un morceau serait sinon remplacé par un caractère de
      // remplacement, corrompant silencieusement le texte.
      lecteur.ecrire(decodeur.decode(value, { stream: true }))
      depuisDerniereAnnonce += value.byteLength
      if (onProgression && depuisDerniereAnnonce > 4 * 1024 * 1024) {
        depuisDerniereAnnonce = 0
        onProgression({ octetsLus, octetsTotal, enregistrementsLus: lecteur.enregistrementsLus() })
        // Rendre la main au navigateur : sans cela l'interface ne repeint pas
        // et la barre de progression reste figée pendant tout l'import.
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    lecteur.ecrire(decodeur.decode())
  } finally {
    source.releaseLock()
  }

  onProgression?.({
    octetsLus,
    octetsTotal,
    enregistrementsLus: lecteur.enregistrementsLus(),
  })
  return lecteur.terminer()
}
