import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react'
import { storeDonnees } from './core/donneesStore'
import { useFenetres, useHydrate } from './core/hooks'
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
    })
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
