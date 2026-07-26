import { definitionOuGenerique, formaterValeur } from '../core/metriques'
import { formaterJourLong, type Jour } from '../core/temps'
import type { Serie } from '../core/types'
import { bandeDuRegime, type Contribution } from './regime'
import { mediane, rangPercentile } from './stats'

/**
 * Phrases descriptives.
 *
 * TOUT le texte généré par CORPUS passe par ce module, et la règle y tient en
 * une ligne : on décrit la donnée, on ne recommande jamais de conduite.
 * « VFC à 1,2 σ sous ta médiane 30 jours » est une observation ; « tu devrais
 * te reposer » est un avis médical que cette application n'a pas à donner.
 *
 * Centraliser les tournures rend cette règle vérifiable en lisant un seul
 * fichier — et testable.
 */

export const AVERTISSEMENT =
  'CORPUS décrit tes données, il ne pose aucun diagnostic et ne remplace aucun avis médical.'

function formaterSigma(z: number): string {
  return `${Math.abs(z).toLocaleString('fr-CH', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} σ`
}

/** « 1,2 σ sous ta normale 30 j » — jamais « c'est mauvais ». */
export function lireEcart(z: number, fenetreJours = 30): string {
  if (!Number.isFinite(z)) return 'pas assez d’historique'
  if (Math.abs(z) < 0.35) return `dans ta normale ${fenetreJours} j`
  const cote = z > 0 ? 'au-dessus de' : 'sous'
  return `${formaterSigma(z)} ${cote} ta normale ${fenetreJours} j`
}

export function lireRang(rang: number): string {
  if (!Number.isFinite(rang)) return '—'
  const pourcent = Math.round(rang * 100)
  if (pourcent >= 98) return 'record haut de ton historique'
  if (pourcent <= 2) return 'record bas de ton historique'
  return `${pourcent}ᵉ percentile de ton historique`
}

/**
 * La tournure évite volontairement l'article : « c'est ÉNERGIE qui tire »
 * serait fautif, et le rendre correct demanderait un article par métrique plus
 * l'accord du verbe au pluriel (« ce sont LES réveils qui tirENT »). Nommer la
 * métrique puis donner le sens entre parenthèses règle les deux d'un coup, et
 * se lit comme un terminal plutôt que comme une phrase bancale.
 */
export function lireRegime(composite: number, dominante?: Contribution): string {
  if (!Number.isFinite(composite)) return 'Pas assez de mesures pour situer la journée.'
  const bande = bandeDuRegime(composite)
  const base = `${bande.label} (${composite >= 0 ? '+' : '−'}${formaterSigma(composite)})`
  if (!dominante) return `${base}.`
  const def = definitionOuGenerique(dominante.id)
  const sens = dominante.z < 0 ? 'vers le bas' : 'vers le haut'
  return `${base}. Écart le plus marqué : ${def.label} — ${sens}.`
}

/** « −0,9 kg sur 30 jours » — quantifie une pente, sans la juger. */
export function lireTendance(pentteParJour: number, id: string, jours = 30): string {
  if (!Number.isFinite(pentteParJour)) return 'tendance indéterminée'
  const total = pentteParJour * jours
  const def = definitionOuGenerique(id)
  if (Math.abs(total) < 10 ** -def.decimales / 2) return `stable sur ${jours} jours`
  const signe = total > 0 ? '+' : '−'
  const valeur = Math.abs(total).toLocaleString('fr-CH', {
    minimumFractionDigits: def.decimales,
    maximumFractionDigits: def.decimales,
  })
  return `${signe}${valeur} ${def.unite} sur ${jours} jours`
}

export interface LectureMetrique {
  valeur: string
  ecart: string
  rang: string
  jour: Jour
}

export function lireMetrique(
  id: string,
  serie: Serie,
  z: number | undefined,
  fenetreJours = 30,
): LectureMetrique | undefined {
  const dernier = serie[serie.length - 1]
  if (!dernier) return undefined
  return {
    valeur: formaterValeur(id, dernier.v),
    ecart: z === undefined ? 'pas assez d’historique' : lireEcart(z, fenetreJours),
    rang: lireRang(rangPercentile(serie.map((p) => p.v), dernier.v)),
    jour: dernier.j,
  }
}

/** Écart de la valeur du jour à la médiane des N derniers jours, en unité brute. */
export function ecartAMediane(serie: Serie, jours: number): number {
  if (serie.length === 0) return Number.NaN
  const dernier = serie[serie.length - 1]!
  const recents = serie.slice(-jours - 1, -1).map((p) => p.v)
  if (recents.length < 3) return Number.NaN
  return dernier.v - mediane(recents)
}

export function lireCouverture(nbPoints: number, nbJours: number): string {
  if (nbJours <= 0) return '—'
  const taux = Math.round((nbPoints / nbJours) * 100)
  return `${nbPoints} mesures sur ${nbJours} jours (${taux} %)`
}

export function lireDateSource(j: Jour, aujourdHui: Jour): string {
  if (j === aujourdHui) return 'aujourd’hui'
  return formaterJourLong(j)
}
