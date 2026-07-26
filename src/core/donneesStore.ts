import { createStore } from 'zustand/vanilla'
import { genererHistorique } from '../donnees/generateur'
import { stockage, type AdaptateurStockage } from './stockage'
import { aujourdhui, type Jour } from './temps'
import {
  etatVide,
  normaliserEtat,
  poserPoint,
  retirerPoint,
  type Annotation,
  type EtatCorpus,
  type Profil,
  type Serie,
  type TypeAnnotation,
} from './types'

/**
 * Store des données corporelles.
 *
 * Zustand en version « vanilla » plutôt que le hook React : le store est lu
 * depuis des fonctions pures et des effets hors composants (l'enregistrement
 * différé, notamment), et React s'y abonne explicitement via `useStore`.
 */

export type EtatPersistance =
  | { statut: 'chargement' }
  | { statut: 'pret'; sauvegarde: 'a-jour' | 'en-attente' }
  | { statut: 'erreur-lecture'; message: string }
  | { statut: 'document-corrompu' }
  | { statut: 'version-incompatible'; version: number }
  | { statut: 'erreur-ecriture'; message: string }
  | { statut: 'conflit' }

export interface EtatStore {
  etat: EtatCorpus
  /** Faux tant que le stockage n'a pas répondu : évite d'écraser des données. */
  hydrate: boolean
  /** Vrai quand rien n'a encore été saisi ni importé ni généré. */
  vide: boolean
  persistance: EtatPersistance

  hydrater: () => Promise<void>
  purgerEcritureEnAttente: () => Promise<void>
  remplacer: (etat: EtatCorpus) => void
  poserMesure: (id: string, j: Jour, v: number) => void
  retirerMesure: (id: string, j: Jour) => void
  ajouterAnnotation: (a: Omit<Annotation, 'id'>) => void
  supprimerAnnotation: (id: string) => void
  fusionner: (
    series: Record<string, Serie>,
    annotations?: Annotation[],
    profil?: Partial<Profil>,
  ) => void
  genererDemonstration: (jours?: number) => void
  reinitialiser: () => void
}

function estVide(etat: EtatCorpus): boolean {
  return (
    etat.annotations.length === 0 &&
    Object.values(etat.series).every((s) => !s || s.length === 0)
  )
}

export interface OptionsStoreDonnees {
  delaiEnregistrement?: number
}

export function creerStoreDonnees(
  adaptateur: AdaptateurStockage,
  options: OptionsStoreDonnees = {},
) {
  let minuteur: ReturnType<typeof setTimeout> | undefined
  let etatEnAttente: EtatCorpus | undefined
  let revisionCourante = 0
  let ecritureActive: Promise<void> | undefined
  let hydratationActive: Promise<void> | undefined
  const delaiEnregistrement = options.delaiEnregistrement ?? 400

  return createStore<EtatStore>((set, get) => {
    function annulerEcritureEnAttente(): void {
      if (minuteur !== undefined) clearTimeout(minuteur)
      minuteur = undefined
      etatEnAttente = undefined
    }

    async function enregistrerMaintenant(etat: EtatCorpus): Promise<void> {
      const precedente = ecritureActive
      const courante = (async () => {
        if (precedente) await precedente
        revisionCourante = await adaptateur.enregistrer(etat, revisionCourante)
      })()
      ecritureActive = courante
      try {
        await courante
        if (ecritureActive === courante && etatEnAttente === undefined) {
          set({ persistance: { statut: 'pret', sauvegarde: 'a-jour' } })
        }
      } finally {
        if (ecritureActive === courante) ecritureActive = undefined
      }
    }

    function enregistrerPlusTard(etat: EtatCorpus): void {
      if (minuteur !== undefined) clearTimeout(minuteur)
      etatEnAttente = etat
      set({ persistance: { statut: 'pret', sauvegarde: 'en-attente' } })
      minuteur = setTimeout(() => {
        minuteur = undefined
        etatEnAttente = undefined
        void enregistrerMaintenant(etat).catch(() => undefined)
      }, delaiEnregistrement)
    }

    function muter(transformation: (etat: EtatCorpus) => EtatCorpus): void {
      if (get().persistance.statut !== 'pret') return
      const suivant = transformation(get().etat)
      set({ etat: suivant, vide: estVide(suivant) })
      enregistrerPlusTard(suivant)
    }

    const etatInitial = etatVide(aujourdhui())

    return {
      etat: etatInitial,
      hydrate: false,
      vide: true,
      persistance: { statut: 'chargement' },

      hydrater: () => {
        if (get().hydrate) return Promise.resolve()
        if (hydratationActive) return hydratationActive

        hydratationActive = (async () => {
          try {
            const resultat = await adaptateur.charger()
            switch (resultat.statut) {
              case 'absent': {
                const etat = etatVide(aujourdhui())
                revisionCourante = resultat.revision
                set({
                  etat,
                  hydrate: true,
                  vide: true,
                  persistance: { statut: 'pret', sauvegarde: 'a-jour' },
                })
                break
              }
              case 'charge':
                revisionCourante = resultat.revision
                set({
                  etat: resultat.etat,
                  hydrate: true,
                  vide: estVide(resultat.etat),
                  persistance: { statut: 'pret', sauvegarde: 'a-jour' },
                })
                break
              case 'corrompu':
                set({ hydrate: true, persistance: { statut: 'document-corrompu' } })
                break
              case 'incompatible':
                set({
                  hydrate: true,
                  persistance: { statut: 'version-incompatible', version: resultat.version },
                })
                break
            }
          } catch (erreur) {
            const message = erreur instanceof Error ? erreur.message : String(erreur)
            set({ persistance: { statut: 'erreur-lecture', message }, hydrate: false })
          } finally {
            hydratationActive = undefined
          }
        })()
        return hydratationActive
      },

      purgerEcritureEnAttente: async () => {
        const etat = etatEnAttente
        annulerEcritureEnAttente()
        if (etat) await enregistrerMaintenant(etat)
        else if (ecritureActive) await ecritureActive
      },

      remplacer: (etat) => {
        if (get().persistance.statut !== 'pret') return
        const normalise = normaliserEtat(etat)
        set({ etat: normalise, vide: estVide(normalise) })
        enregistrerPlusTard(normalise)
      },

      poserMesure: (id, j, v) =>
        muter((etat) => ({
          ...etat,
          series: { ...etat.series, [id]: poserPoint(etat.series[id] ?? [], j, v) },
        })),

      retirerMesure: (id, j) =>
        muter((etat) => ({
          ...etat,
          series: { ...etat.series, [id]: retirerPoint(etat.series[id] ?? [], j) },
        })),

      ajouterAnnotation: (a) =>
        muter((etat) => ({
          ...etat,
          annotations: [
            ...etat.annotations,
            { ...a, id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
          ].sort((x, y) => (x.j < y.j ? -1 : 1)),
        })),

      supprimerAnnotation: (id) =>
        muter((etat) => ({
          ...etat,
          annotations: etat.annotations.filter((a) => a.id !== id),
        })),

      fusionner: (series, annotations = [], profil) =>
        muter((etat) => {
          const fusion: Record<string, Serie> = { ...etat.series }
          for (const [id, serie] of Object.entries(series)) {
            let cible = fusion[id] ?? []
            // Point à point : l'import écrase le jour existant plutôt que de le
            // dupliquer, ce qui rend un même fichier réimportable sans dégât.
            for (const p of serie) cible = poserPoint(cible, p.j, p.v)
            fusion[id] = cible
          }
          const connues = new Set(etat.annotations.map((a) => `${a.j}|${a.type}`))
          const nouvelles = annotations.filter((a) => !connues.has(`${a.j}|${a.type}`))
          return {
            ...etat,
            series: fusion,
            annotations: [...etat.annotations, ...nouvelles].sort((x, y) =>
              x.j < y.j ? -1 : 1,
            ),
            // Le profil importé complète, il n'écrase pas : une valeur déjà saisie
            // à la main est plus sûre qu'une valeur devinée dans un export.
            profil: { ...profil, ...etat.profil },
          }
        }),

      genererDemonstration: (jours = 540) => {
        if (get().persistance.statut !== 'pret') return
        const etat = genererHistorique({ jours })
        set({ etat, vide: false })
        enregistrerPlusTard(etat)
      },

      reinitialiser: () => {
        if (get().persistance.statut !== 'pret') return
        // Un enregistrement différé encore armé ré-écrirait l'ancien état APRÈS
        // l'effacement : on le désamorce d'abord.
        annulerEcritureEnAttente()
        const etat = etatVide(aujourdhui())
        set({ etat, vide: true })
        void adaptateur.effacer(revisionCourante).then((revision) => {
          revisionCourante = revision
        })
      },
    }
  })
}

export const storeDonnees = creerStoreDonnees(stockage)

if (typeof window !== 'undefined') {
  // `pagehide` couvre la fermeture et la navigation ; `visibilitychange`
  // couvre l'onglet mis en arrière-plan, seul signal fiable sur mobile.
  window.addEventListener('pagehide', () => {
    void storeDonnees.getState().purgerEcritureEnAttente()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void storeDonnees.getState().purgerEcritureEnAttente()
    }
  })
}

/** Types d'annotations proposés dans les formulaires. */
export const TYPES_SAISISSABLES: readonly TypeAnnotation[] = [
  'seance',
  'alcool',
  'voyage',
  'maladie',
  'stress',
  'blessure',
  'autre',
]
