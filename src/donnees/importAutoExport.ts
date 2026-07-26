import { definitionMetrique } from '../core/metriques'
import type { Jour } from '../core/temps'
import { normaliserSerie, type Annotation, type Serie } from '../core/types'
import { mediane } from '../analyse/stats'
import { analyserHorodatage, ETIQUETTES_SEANCE, type ResultatSante } from './importSante'

/**
 * Import du JSON produit par « Health Auto Export » (iOS).
 *
 * C'est la brique qui rend la synchronisation CONTINUE possible : l'app
 * iPhone exporte les données de Santé vers iCloud Drive à intervalle régulier,
 * le dossier arrive sur le Mac, et CORPUS le surveille. L'export complet
 * d'Apple (export.zip) reste le chemin pour l'historique ; celui-ci porte le
 * quotidien.
 *
 * La lecture est TOLÉRANTE, comme l'import ATHLOS : le format varie selon la
 * version de l'app et ses réglages d'agrégation (par jour, par heure…). On
 * prend ce qu'on reconnaît, on compte ce qu'on ignore, et on ne rejette
 * jamais le fichier entier pour un champ inattendu.
 */

interface CorrespondanceAuto {
  id: string
  mode: 'mediane' | 'somme'
  /** Unités acceptées, avec leur facteur vers l'unité de CORPUS. */
  facteurs?: Record<string, number>
  /** Même ambiguïté que l'export XML : « % » peut cacher des fractions. */
  pourcentageAmbigu?: boolean
}

const CORRESPONDANCES_AUTO: Record<string, CorrespondanceAuto> = {
  heart_rate_variability: { id: 'vfc', mode: 'mediane', facteurs: { ms: 1, s: 1000 } },
  resting_heart_rate: { id: 'fc_repos', mode: 'mediane' },
  weight_body_mass: { id: 'poids', mode: 'mediane', facteurs: { kg: 1, lb: 0.45359237, g: 0.001 } },
  body_fat_percentage: { id: 'masse_grasse', mode: 'mediane', pourcentageAmbigu: true },
  waist_circumference: { id: 'tour_taille', mode: 'mediane', facteurs: { cm: 1, in: 2.54, m: 100 } },
  step_count: { id: 'pas', mode: 'somme' },
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Reconnaît la signature d'un export Health Auto Export. */
export function estAutoExport(brut: unknown): boolean {
  return estObjet(brut) && estObjet(brut.data) && Array.isArray(brut.data.metrics)
}

function jourDe(brut: unknown): Jour | null {
  if (typeof brut !== 'string') return null
  return analyserHorodatage(brut)?.jour ?? null
}

export function importerAutoExport(brut: unknown): ResultatSante | null {
  if (!estAutoExport(brut)) return null
  const data = (brut as { data: Record<string, unknown> }).data

  const avertissements: string[] = []
  const ignores = new Map<string, number>()
  let lus = 0
  let retenus = 0

  /** id → jour → valeurs (mode médiane) ou total (mode somme). */
  const valeurs = new Map<string, Map<Jour, number[]>>()
  const totaux = new Map<string, Map<Jour, number>>()

  const nuits: {
    jour: Jour
    duree?: number
    profond?: number
    coucher?: number
  }[] = []

  for (const metrique of data.metrics as unknown[]) {
    if (!estObjet(metrique) || typeof metrique.name !== 'string' || !Array.isArray(metrique.data)) {
      continue
    }
    const nom = metrique.name
    const unite = typeof metrique.units === 'string' ? metrique.units : ''

    if (nom === 'sleep_analysis') {
      for (const p of metrique.data as unknown[]) {
        lus++
        if (!estObjet(p)) continue
        // Une nuit appartient au jour du RÉVEIL : `sleepEnd` prime sur `date`.
        const jour = jourDe(p.sleepEnd) ?? jourDe(p.date)
        if (!jour) continue
        // Selon la version : `asleep` en heures, ou le détail core/deep/rem.
        const asleep = typeof p.asleep === 'number' ? p.asleep : undefined
        const detail = ['core', 'deep', 'rem']
          .map((c) => (typeof p[c] === 'number' ? (p[c] as number) : 0))
          .reduce((s, x) => s + x, 0)
        const duree = asleep ?? (detail > 0 ? detail : undefined)
        const profond = typeof p.deep === 'number' ? p.deep : undefined
        const debut = typeof p.sleepStart === 'string' ? analyserHorodatage(p.sleepStart) : null
        // Heures décimales monotones : 1 h 30 devient 25,5 (cf. catalogue).
        const coucher = debut ? (debut.heure < 12 ? debut.heure + 24 : debut.heure) : undefined
        if (duree === undefined && coucher === undefined) continue
        nuits.push({ jour, duree, profond, coucher })
        retenus++
      }
      continue
    }

    const corr = CORRESPONDANCES_AUTO[nom]
    if (!corr) {
      ignores.set(nom, (ignores.get(nom) ?? 0) + (metrique.data as unknown[]).length)
      lus += (metrique.data as unknown[]).length
      continue
    }

    for (const p of metrique.data as unknown[]) {
      lus++
      if (!estObjet(p) || typeof p.qty !== 'number' || !Number.isFinite(p.qty)) continue
      const jour = jourDe(p.date)
      if (!jour) continue
      let v = p.qty
      if (corr.facteurs) {
        const f = corr.facteurs[unite]
        // Unité inconnue : écarter plutôt que convertir au hasard.
        if (f === undefined) continue
        v = v * f
      }
      if (corr.mode === 'somme') {
        let parJour = totaux.get(corr.id)
        if (!parJour) {
          parJour = new Map()
          totaux.set(corr.id, parJour)
        }
        parJour.set(jour, (parJour.get(jour) ?? 0) + v)
      } else {
        let parJour = valeurs.get(corr.id)
        if (!parJour) {
          parJour = new Map()
          valeurs.set(corr.id, parJour)
        }
        const liste = parJour.get(jour)
        if (liste) liste.push(v)
        else parJour.set(jour, [v])
      }
      retenus++
    }
  }

  /* — Masse grasse : décision d'échelle sur tout le fichier, jamais par point — */
  const masse = valeurs.get('masse_grasse')
  if (masse) {
    let maximum = 0
    for (const liste of masse.values()) for (const v of liste) maximum = Math.max(maximum, v)
    if (maximum > 0 && maximum <= 1) {
      for (const liste of masse.values()) for (let i = 0; i < liste.length; i++) liste[i]! *= 100
      avertissements.push(
        'La masse grasse était exprimée en fraction (maximum du fichier ≤ 1) : tout le fichier a été converti en pourcentage.',
      )
    }
  }

  const series: Record<string, Serie> = {}
  const poser = (id: string, points: { j: Jour; v: number }[]) => {
    const def = definitionMetrique(id)
    const gardes = points.filter(
      (p) => Number.isFinite(p.v) && (!def || (p.v >= def.min && p.v <= def.max)),
    )
    if (gardes.length > 0) series[id] = normaliserSerie(gardes)
  }

  for (const [id, parJour] of valeurs) {
    poser(id, [...parJour].map(([j, liste]) => ({ j, v: mediane(liste) })))
  }
  for (const [id, parJour] of totaux) {
    poser(id, [...parJour].map(([j, v]) => ({ j, v })))
  }

  /* — Nuits : plusieurs sessions le même jour se somment (durée), le coucher
       de la session la plus longue est retenu — même règle que l'export XML — */
  const dureeParJour = new Map<Jour, number>()
  const profondParJour = new Map<Jour, number>()
  const coucherParJour = new Map<Jour, { coucher: number; duree: number }>()
  for (const n of nuits) {
    if (n.duree !== undefined) dureeParJour.set(n.jour, (dureeParJour.get(n.jour) ?? 0) + n.duree)
    if (n.profond !== undefined) {
      profondParJour.set(n.jour, (profondParJour.get(n.jour) ?? 0) + n.profond)
    }
    if (n.coucher !== undefined) {
      const duree = n.duree ?? 0
      const actuel = coucherParJour.get(n.jour)
      if (!actuel || duree > actuel.duree) coucherParJour.set(n.jour, { coucher: n.coucher, duree })
    }
  }
  poser('sommeil_duree', [...dureeParJour].map(([j, v]) => ({ j, v: Math.round(v * 100) / 100 })))
  poser('sommeil_profond', [...profondParJour].map(([j, v]) => ({ j, v: Math.round(v * 100) / 100 })))
  poser('sommeil_coucher', [...coucherParJour].map(([j, c]) => ({ j, v: Math.round(c.coucher * 100) / 100 })))

  /* — Séances — */
  const annotations: Annotation[] = []
  if (Array.isArray(data.workouts)) {
    let n = 0
    for (const w of data.workouts as unknown[]) {
      lus++
      if (!estObjet(w)) continue
      const debut = typeof w.start === 'string' ? analyserHorodatage(w.start) : null
      const fin = typeof w.end === 'string' ? analyserHorodatage(w.end) : null
      if (!debut) continue
      const minutes = fin && fin.ms > debut.ms ? (fin.ms - debut.ms) / 60_000 : undefined
      const nomBrut = typeof w.name === 'string' ? w.name : 'Séance'
      // « Traditional Strength Training » → même clé que l'export XML.
      const etiquette = ETIQUETTES_SEANCE[nomBrut.replace(/\s/g, '')] ?? nomBrut
      annotations.push({
        id: `auto-${n++}`,
        j: debut.jour,
        type: 'seance',
        intensite: minutes === undefined ? 0.5 : Math.min(1, Math.max(0.15, minutes / 90)),
        note: minutes === undefined ? etiquette : `${etiquette} — ${Math.round(minutes)} min`,
      })
      retenus++
    }
  }

  const typesIgnores = [...ignores.entries()]
    .map(([type, n]) => ({ type, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 12)

  return {
    series,
    annotations: annotations.sort((a, b) => (a.j < b.j ? -1 : 1)),
    profil: {},
    enregistrementsLus: lus,
    enregistrementsRetenus: retenus,
    typesIgnores,
    avertissements,
  }
}
