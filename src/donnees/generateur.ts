import { aujourdhui, decalerJour, jourDeSemaine, type Jour } from '../core/temps'
import {
  VERSION_ETAT,
  type Annotation,
  type EtatCorpus,
  type Serie,
  type TypeAnnotation,
} from '../core/types'
import { borner, creerAlea, entierEntre, gaussienne, tirage, type Alea } from './alea'

/**
 * Générateur d'historique de démonstration.
 *
 * CORPUS démarre sans données. Un générateur naïf produirait du bruit
 * indépendant par métrique — et alors la matrice de corrélation serait nulle,
 * les études d'événement plates, les régimes constants : l'application
 * paraîtrait cassée alors que le code serait juste.
 *
 * Celui-ci simule donc un modèle causal explicite. Les effets injectés sont
 * déclarés dans `EFFETS` ci-dessous, et les tests des modules d'analyse
 * vérifient qu'ils sont bien retrouvés — ce qui fait de ce fichier à la fois
 * une source de données et le banc d'essai de la couche analytique.
 *
 * Convention temporelle : la ligne du jour J porte la nuit qui s'achève le
 * matin J et l'activité de la journée J. Donc sommeil et VFC du matin sont
 * CONTEMPORAINS, tandis qu'une séance faite l'après-midi J ne peut se lire que
 * sur la mesure du matin J+1 — d'où les décalages ci-dessous.
 */

export const EFFETS = {
  /** Une séance du jour J déprime la VFC du matin J+1. */
  decalageChargeVersVfc: 1,
  /** Une soirée alcoolisée le soir J se lit sur la FC de repos du matin J+1. */
  decalageAlcoolVersFcRepos: 1,
  /** Les courbatures culminent le lendemain d'une séance. */
  decalageChargeVersCourbatures: 1,
  /** Sommeil et VFC sont mesurés le même matin : aucun décalage. */
  decalageSommeilVersVfc: 0,
} as const

export interface OptionsGenerateur {
  graine?: number
  /** Longueur de l'historique, en jours. */
  jours?: number
  /** Dernier jour de l'historique. */
  finLe?: Jour
  /** Simuler les trous de mesure (montre non portée, pesée oubliée). */
  trous?: boolean
}

/* ————————————————————————— Paramètres du modèle ————————————————————————— */

const VFC_BASE = 62
const FC_REPOS_BASE = 53
const POIDS_DEPART = 79.5
const CHARGE_REFERENCE = 400

/** Charge planifiée par jour de semaine (0 = lundi). 0 = repos. */
const PLAN_SEMAINE = [480, 260, 0, 430, 0, 520, 0]

/** Modulation sur un bloc de quatre semaines : trois de montée, une de décharge. */
const BLOC_QUATRE_SEMAINES = [0.92, 1.0, 1.08, 0.55]

/** Taux de présence de chaque métrique : tout n'est pas mesuré chaque jour. */
const PRESENCE: Record<string, number> = {
  vfc: 0.92,
  fc_repos: 0.93,
  sommeil_duree: 0.93,
  sommeil_profond: 0.9,
  sommeil_coucher: 0.9,
  sommeil_reveils: 0.88,
  poids: 0.78,
  pas: 0.97,
  energie: 0.85,
  humeur: 0.85,
  courbatures: 0.82,
  stress: 0.84,
}

/* ————————————————————————— Calendrier d'événements ————————————————————————— */

interface Calendrier {
  malade: boolean[]
  voyage: boolean[]
  /** Niveau de stress latent, dans [0, 1]. */
  stress: number[]
  alcool: boolean[]
  annotations: Annotation[]
}

function poserBloc(cible: boolean[], debut: number, duree: number): void {
  for (let i = debut; i < Math.min(cible.length, debut + duree); i++) cible[i] = true
}

function construireCalendrier(alea: Alea, n: number, jourDe: (i: number) => Jour): Calendrier {
  const malade = new Array<boolean>(n).fill(false)
  const voyage = new Array<boolean>(n).fill(false)
  const stress = new Array<number>(n).fill(0)
  const alcool = new Array<boolean>(n).fill(false)
  const annotations: Annotation[] = []
  let compteur = 0
  const idAnnotation = () => `gen-${compteur++}`

  // Épisodes de maladie : un par semestre environ, quatre à sept jours.
  const nbMaladies = Math.max(1, Math.round(n / 180))
  for (let k = 0; k < nbMaladies; k++) {
    const fenetre = Math.floor(n / nbMaladies)
    const debut = k * fenetre + entierEntre(alea, 10, Math.max(11, fenetre - 12))
    const duree = entierEntre(alea, 4, 7)
    poserBloc(malade, debut, duree)
    if (debut < n) {
      annotations.push({
        id: idAnnotation(),
        j: jourDe(debut),
        type: 'maladie',
        intensite: 0.8,
        note: `Épisode de ${duree} jours`,
      })
    }
  }

  // Voyages : environ un par trimestre, trois à six jours.
  const nbVoyages = Math.max(1, Math.round(n / 95))
  for (let k = 0; k < nbVoyages; k++) {
    const fenetre = Math.floor(n / nbVoyages)
    const debut = k * fenetre + entierEntre(alea, 5, Math.max(6, fenetre - 10))
    const duree = entierEntre(alea, 3, 6)
    poserBloc(voyage, debut, duree)
    if (debut < n) {
      annotations.push({
        id: idAnnotation(),
        j: jourDe(debut),
        type: 'voyage',
        intensite: 0.5,
        note: `${duree} jours`,
      })
    }
  }

  // Périodes de stress : montée, plateau, redescente. Une par trimestre.
  const nbStress = Math.max(1, Math.round(n / 110))
  for (let k = 0; k < nbStress; k++) {
    const fenetre = Math.floor(n / nbStress)
    const debut = k * fenetre + entierEntre(alea, 5, Math.max(6, fenetre - 30))
    const duree = entierEntre(alea, 12, 24)
    const sommet = 0.55 + alea() * 0.4
    for (let i = 0; i < duree; i++) {
      const t = debut + i
      if (t >= n) break
      // Trapèze : un cinquième de montée, un cinquième de descente.
      const phase = i / duree
      const forme = phase < 0.2 ? phase / 0.2 : phase > 0.8 ? (1 - phase) / 0.2 : 1
      stress[t] = Math.max(stress[t]!, sommet * forme)
    }
    if (debut < n) {
      annotations.push({
        id: idAnnotation(),
        j: jourDe(debut),
        type: 'stress',
        intensite: sommet,
        note: `Période chargée, ${duree} jours`,
      })
    }
  }

  // Soirées alcoolisées : nettement plus probables vendredi et samedi.
  for (let i = 0; i < n; i++) {
    if (malade[i]) continue
    const js = jourDeSemaine(jourDe(i))
    const p = js === 4 || js === 5 ? 0.3 : js === 6 ? 0.1 : 0.035
    if (tirage(alea, p)) {
      alcool[i] = true
      annotations.push({
        id: idAnnotation(),
        j: jourDe(i),
        type: 'alcool',
        intensite: 0.35 + alea() * 0.6,
      })
    }
  }

  return { malade, voyage, stress, alcool, annotations }
}

/* ————————————————————————————— Simulation ————————————————————————————— */

export function genererHistorique(options: OptionsGenerateur = {}): EtatCorpus {
  const { graine = 20260726, jours: n = 540, finLe = aujourdhui(), trous = true } = options
  const alea = creerAlea(graine)
  const jourDe = (i: number): Jour => decalerJour(finLe, i - (n - 1))

  const cal = construireCalendrier(alea, n, jourDe)

  // Séries brutes, tous les jours renseignés ; les trous sont creusés ensuite.
  const brut: Record<string, number[]> = {
    vfc: [],
    fc_repos: [],
    sommeil_duree: [],
    sommeil_profond: [],
    sommeil_coucher: [],
    sommeil_reveils: [],
    poids: [],
    masse_grasse: [],
    tour_taille: [],
    charge_seance: [],
    pas: [],
    energie: [],
    humeur: [],
    courbatures: [],
    stress: [],
  }
  const annotations = [...cal.annotations]
  let compteurSeance = 0

  // État latent.
  let atl = CHARGE_REFERENCE * 0.5 // fatigue aiguë (moyenne mobile 7 jours)
  let ctl = CHARGE_REFERENCE * 0.5 // forme chronique (moyenne mobile 42 jours)
  let detteSommeil = 0
  let eau = 0 // rétention d'eau, en kg
  let poidsTendance = POIDS_DEPART

  const charge = new Array<number>(n).fill(0)

  for (let i = 0; i < n; i++) {
    const j = jourDe(i)
    const js = jourDeSemaine(j)
    const estWeekend = js >= 5
    const malade = cal.malade[i]!
    const voyage = cal.voyage[i]!
    const stressLatent = cal.stress[i]!
    const alcoolHier = i > 0 ? cal.alcool[i - 1]! : false

    /* — Charge d'entraînement — */
    const semaineDuBloc = Math.floor(i / 7) % 4
    const modulation = BLOC_QUATRE_SEMAINES[semaineDuBloc]!
    const planifie = PLAN_SEMAINE[js]!
    let chargeJour = 0
    if (planifie > 0 && !malade) {
      const probaManquee = voyage ? 0.55 : stressLatent > 0.5 ? 0.2 : 0.08
      if (!tirage(alea, probaManquee)) {
        chargeJour = borner(planifie * modulation * (1 + gaussienne(alea, 0, 0.12)), 60, 1200)
      }
    }
    charge[i] = chargeJour
    if (chargeJour > 0) {
      annotations.push({
        id: `gen-s${compteurSeance++}`,
        j,
        type: 'seance',
        intensite: borner(chargeJour / 620, 0, 1),
      })
    }

    // Réponse impulsionnelle : aiguë sur 7 jours, chronique sur 42.
    atl += (chargeJour - atl) / 7
    ctl += (chargeJour - ctl) / 42
    const atlNorm = atl / CHARGE_REFERENCE
    const ctlNorm = (ctl - CHARGE_REFERENCE * 0.5) / CHARGE_REFERENCE
    const chargeHier = i > 0 ? charge[i - 1]! / CHARGE_REFERENCE : 0
    const chargeAvantHier = i > 1 ? charge[i - 2]! / CHARGE_REFERENCE : 0

    /* — Sommeil — */
    const coucher = borner(
      23.0 +
        (estWeekend ? 0.7 : 0) +
        (cal.alcool[i] ? 0.9 : 0) +
        (voyage ? 0.45 : 0) +
        stressLatent * 0.5 +
        gaussienne(alea, 0, 0.42),
      20.5,
      27.5,
    )
    const duree = borner(
      8.35 -
        (coucher - 23.0) * 0.55 +
        (estWeekend ? 0.55 : 0) -
        stressLatent * 0.75 -
        (alcoolHier ? 0.2 : 0) +
        (malade ? 0.45 : 0) -
        (voyage ? 0.3 : 0) +
        gaussienne(alea, 0, 0.45),
      3.5,
      11,
    )
    const profond = borner(
      duree * 0.21 - (alcoolHier ? 0.38 : 0) - atlNorm * 0.06 + gaussienne(alea, 0, 0.11),
      0.2,
      3.2,
    )
    const reveils = Math.max(
      0,
      Math.round(
        0.9 + (alcoolHier ? 1.7 : 0) + stressLatent * 2.2 + (malade ? 1.8 : 0) + gaussienne(alea, 0, 0.7),
      ),
    )

    // Dette de sommeil : mémoire courte, se résorbe d'environ 30 % par jour.
    detteSommeil = borner(detteSommeil * 0.7 + (7.9 - duree), 0, 14)

    /* — Récupération — */
    // La VFC est multiplicative : les effets se composent plutôt que s'ajouter,
    // ce qui empêche des valeurs négatives et respecte l'échelle log-normale
    // observée en pratique.
    const vfc = borner(
      VFC_BASE *
        Math.exp(
          -0.16 * chargeHier -
            0.035 * detteSommeil -
            0.2 * (alcoolHier ? 1 : 0) -
            0.34 * (malade ? 1 : 0) -
            0.13 * stressLatent +
            0.09 * ctlNorm,
        ) *
        (1 + gaussienne(alea, 0, 0.055)),
      15,
      140,
    )
    const fcRepos = borner(
      FC_REPOS_BASE +
        3.6 * chargeHier +
        4.6 * (alcoolHier ? 1 : 0) +
        7.5 * (malade ? 1 : 0) +
        1.5 * stressLatent +
        0.9 * Math.max(0, 7.5 - duree) -
        3.0 * ctlNorm +
        gaussienne(alea, 0, 1.5),
      36,
      95,
    )

    /* — Morphologie — */
    // Trois phases : prise lente, sèche, maintien.
    const phase = i / n
    const derive = phase < 0.4 ? 0.011 : phase < 0.72 ? -0.042 : 0.002
    poidsTendance += derive + (malade ? -0.05 : 0)
    eau = eau * 0.55 + 0.0012 * charge[i]! + (cal.alcool[i] ? 0.5 : 0) + (voyage ? 0.25 : 0)
    const poids = poidsTendance + eau + gaussienne(alea, 0, 0.22)
    // La masse grasse suit la tendance du poids, amortie et bien plus lisse.
    const masseGrasse = borner(
      15.5 + (poidsTendance - POIDS_DEPART) * 0.62 + gaussienne(alea, 0, 0.35),
      6,
      35,
    )
    const tourTaille = borner(
      81 + (poidsTendance - POIDS_DEPART) * 0.75 + eau * 0.5 + gaussienne(alea, 0, 0.5),
      60,
      130,
    )

    /* — Activité — */
    const pas = Math.round(
      borner(
        7200 +
          (chargeJour > 0 ? 2600 : 0) +
          (estWeekend ? 1400 : 0) +
          (voyage ? 3200 : 0) -
          (malade ? 4600 : 0) +
          gaussienne(alea, 0, 1700),
        400,
        32000,
      ),
    )

    /* — Ressenti — */
    const courbatures = borner(
      1.1 + 3.4 * chargeHier + 1.7 * chargeAvantHier + (malade ? 1.2 : 0) + gaussienne(alea, 0, 0.65),
      0,
      10,
    )
    const zVfcApprox = (vfc - VFC_BASE) / (VFC_BASE * 0.12)
    const energie = borner(
      5.9 +
        1.1 * zVfcApprox +
        0.75 * (duree - 7.6) -
        0.32 * courbatures -
        1.6 * stressLatent -
        2.4 * (malade ? 1 : 0) +
        gaussienne(alea, 0, 0.55),
      1,
      10,
    )
    const humeur = borner(
      0.52 * energie + 0.48 * (7.2 - 4.2 * stressLatent) - (malade ? 1.1 : 0) + gaussienne(alea, 0, 0.65),
      1,
      10,
    )
    const stressRessenti = borner(
      2.3 + 5.2 * stressLatent + 0.35 * courbatures * 0.3 + gaussienne(alea, 0, 0.75),
      0,
      10,
    )

    brut.vfc!.push(vfc)
    brut.fc_repos!.push(fcRepos)
    brut.sommeil_duree!.push(duree)
    brut.sommeil_profond!.push(profond)
    brut.sommeil_coucher!.push(coucher)
    brut.sommeil_reveils!.push(reveils)
    brut.poids!.push(poids)
    brut.masse_grasse!.push(masseGrasse)
    brut.tour_taille!.push(tourTaille)
    brut.charge_seance!.push(chargeJour)
    brut.pas!.push(pas)
    brut.energie!.push(energie)
    brut.humeur!.push(humeur)
    brut.courbatures!.push(courbatures)
    brut.stress!.push(stressRessenti)
  }

  /* — Mise en série, avec trous de mesure — */
  const series: Record<string, Serie> = {}
  for (const [id, valeurs] of Object.entries(brut)) {
    const serie: Serie = []
    for (let i = 0; i < valeurs.length; i++) {
      const v = valeurs[i]!
      // Une séance non faite n'est pas une mesure manquante : c'est un zéro
      // qu'on n'enregistre pas. Le module de charge densifiera à zéro.
      if (id === 'charge_seance' && v === 0) continue
      // Composition corporelle et tour de taille : mesures hebdomadaires.
      if (id === 'masse_grasse' || id === 'tour_taille') {
        if (i % 7 !== 3) continue
      } else if (trous) {
        const presence = PRESENCE[id] ?? 1
        if (!tirage(alea, presence)) continue
      }
      serie.push({ j: jourDe(i), v: arrondir(id, v) })
    }
    series[id] = serie
  }

  annotations.sort((a, b) => (a.j < b.j ? -1 : a.j > b.j ? 1 : 0))

  return {
    version: VERSION_ETAT,
    series,
    annotations,
    profil: { tailleCm: 181, sexe: 'h', naissance: '1996-04-12' },
    creeLe: jourDe(0),
  }
}

const DECIMALES: Record<string, number> = {
  vfc: 0,
  fc_repos: 0,
  sommeil_duree: 2,
  sommeil_profond: 2,
  sommeil_coucher: 2,
  sommeil_reveils: 0,
  poids: 1,
  masse_grasse: 1,
  tour_taille: 1,
  charge_seance: 0,
  pas: 0,
  energie: 0,
  humeur: 0,
  courbatures: 0,
  stress: 0,
}

function arrondir(id: string, v: number): number {
  const d = DECIMALES[id] ?? 2
  const f = 10 ** d
  return Math.round(v * f) / f
}

/** Types d'annotations produits par le générateur, pour l'interface. */
export const TYPES_GENERES: readonly TypeAnnotation[] = [
  'seance',
  'alcool',
  'voyage',
  'maladie',
  'stress',
]
