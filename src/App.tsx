import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react'
import { storeDonnees } from './core/donneesStore'
import { useFenetres, useHydrate } from './core/hooks'
import { demarrerSauvegardeAuto } from './donnees/sauvegardeAuto'
import { demarrerSync } from './donnees/syncSante'
import { BarreOutils } from './shell/BarreOutils'
import { BarreTaches } from './shell/BarreTaches'
import { FenetreFlottante } from './shell/FenetreFlottante'
import { storeFenetres } from './shell/gestionnaireFenetres'
import { Palette } from './shell/Palette'
import type { IdFenetre } from './shell/registre'

/**
 * Table des composants de fenêtre.
 *
 * `IdFenetre` étant dérivé du registre, ce `Record` est exhaustif par
 * construction : ajouter une fenêtre au registre sans la câbler ici ne compile
 * pas. Chaque fenêtre est chargée à la demande — les fenêtres à canvas tirent
 * leur code de dessin, inutile de le payer au démarrage.
 */
const COMPOSANTS: Record<IdFenetre, LazyExoticComponent<ComponentType>> = {
  bilan: lazy(() => import('./fenetres/Bilan').then((m) => ({ default: m.Bilan }))),
  signaux: lazy(() => import('./fenetres/Signaux').then((m) => ({ default: m.Signaux }))),
  hypotheses: lazy(() =>
    import('./fenetres/Hypotheses').then((m) => ({ default: m.Hypotheses })),
  ),
  comparaison: lazy(() =>
    import('./fenetres/ComparaisonPeriodes').then((m) => ({ default: m.ComparaisonPeriodes })),
  ),
  series: lazy(() => import('./fenetres/Series').then((m) => ({ default: m.Series }))),
  charge: lazy(() => import('./fenetres/Charge').then((m) => ({ default: m.Charge }))),
  correlations: lazy(() =>
    import('./fenetres/Correlations').then((m) => ({ default: m.Correlations })),
  ),
  evenements: lazy(() =>
    import('./fenetres/Evenements').then((m) => ({ default: m.Evenements })),
  ),
  saisie: lazy(() => import('./fenetres/Saisie').then((m) => ({ default: m.Saisie }))),
  journal: lazy(() => import('./fenetres/Journal').then((m) => ({ default: m.Journal }))),
  donnees: lazy(() => import('./fenetres/Donnees').then((m) => ({ default: m.Donnees }))),
}

export function App() {
  const fenetres = useFenetres()
  const hydrate = useHydrate()

  useEffect(() => {
    void storeDonnees.getState().hydrater().then(() => {
      // Premier lancement : la fenêtre Données est le seul endroit d'où l'on
      // peut peupler l'application, autant y conduire directement.
      if (storeDonnees.getState().vide) storeFenetres.getState().ouvrir('donnees')
      // La synchronisation et la sauvegarde reprennent APRÈS l'hydratation :
      // un import qui arriverait avant fusionnerait dans un état encore vide,
      // et une sauvegarde figerait ce vide.
      void demarrerSync()
      void demarrerSauvegardeAuto()
    })
  }, [])

  useEffect(() => {
    // ⌥flèches : ancrer la fenêtre au premier plan sans toucher la souris.
    const clavier = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return
      // Dans un champ, ⌥flèche déplace le curseur mot à mot : on n'y touche pas.
      const cible = e.target as HTMLElement | null
      if (cible && ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName)) return
      const { fenetres: liste, ancrer, restaurer } = storeFenetres.getState()
      const visibles = liste.filter((f) => !f.reduite)
      if (visibles.length === 0) return
      const sommet = visibles.reduce((m, f) => (f.z > m.z ? f : m))
      if (e.key === 'ArrowLeft') ancrer(sommet.id, 'gauche')
      else if (e.key === 'ArrowRight') ancrer(sommet.id, 'droite')
      else if (e.key === 'ArrowUp') ancrer(sommet.id, 'plein')
      else if (e.key === 'ArrowDown') restaurer(sommet.id)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', clavier)
    return () => window.removeEventListener('keydown', clavier)
  }, [])

  useEffect(() => {
    // Une fenêtre déplacée hors cadre après réduction de la fenêtre du
    // navigateur deviendrait inattrapable : on recadre au redimensionnement.
    const recadrer = () => {
      const { fenetres: liste, redimensionner } = storeFenetres.getState()
      for (const f of liste) {
        redimensionner(f.id, { x: f.x, y: f.y, largeur: f.largeur, hauteur: f.hauteur })
      }
    }
    window.addEventListener('resize', recadrer)
    return () => window.removeEventListener('resize', recadrer)
  }, [])

  return (
    <div className="relative h-full w-full overflow-hidden bg-fond">
      <BarreOutils />

      <main className="absolute inset-0">
        {fenetres.map((f) => {
          const Composant = COMPOSANTS[f.id]
          return (
            <FenetreFlottante key={f.id} fenetre={f}>
              <Suspense fallback={<Chargement />}>
                <Composant />
              </Suspense>
            </FenetreFlottante>
          )
        })}
      </main>

      {hydrate && fenetres.length === 0 && <EcranVide />}

      <BarreTaches />
      <Palette />
    </div>
  )
}

function Chargement() {
  return <div className="grid h-full place-items-center text-[11px] text-attenue">…</div>
}

function EcranVide() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="text-center">
        <p className="text-[13px] text-attenue">Aucune fenêtre ouverte.</p>
        <p className="mt-1 text-[11px] text-attenue/70">
          Menu <span className="text-texte">Fenêtres</span>, ou{' '}
          <kbd className="rounded bg-bord px-1 text-texte">⌘K</kbd>
        </p>
      </div>
    </div>
  )
}
