import { useFenetres } from '../core/hooks'
import { storeFenetres } from './gestionnaireFenetres'
import { definitionFenetre } from './registre'

export function BarreTaches() {
  const fenetres = useFenetres()
  const { focaliser, basculerReduction, fermer } = storeFenetres.getState()

  return (
    <footer className="absolute inset-x-0 bottom-0 z-[300] flex h-8 items-center gap-1 border-t border-bord bg-fond/95 px-2 backdrop-blur">
      {fenetres.length === 0 ? (
        <span className="text-[10px] text-attenue">
          Aucune fenêtre ouverte — menu Fenêtres, ou ⌘K
        </span>
      ) : (
        [...fenetres]
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((f) => {
            const def = definitionFenetre(f.id)
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => (f.reduite ? basculerReduction(f.id) : focaliser(f.id))}
                onAuxClick={(e) => {
                  // Clic du milieu : ferme, comme un onglet de navigateur.
                  if (e.button === 1) fermer(f.id)
                }}
                title={def.titre}
                className={`rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider transition-colors ${
                  f.reduite
                    ? 'border-bord text-attenue hover:text-texte'
                    : 'border-accent/50 bg-accent/10 text-accent'
                }`}
              >
                {def.mnemonique}
              </button>
            )
          })
      )}
      <span className="ml-auto text-[10px] text-attenue">
        données locales — rien n’est envoyé
      </span>
    </footer>
  )
}
