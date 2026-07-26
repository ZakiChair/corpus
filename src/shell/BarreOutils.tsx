import { useEffect, useRef, useState } from 'react'
import { useDonneesVide, useTheme } from '../core/hooks'
import {
  appliquerDispositionNommee,
  enregistrerDispositionNommee,
  lireDispositionsNommees,
  storeFenetres,
  supprimerDispositionNommee,
} from './gestionnaireFenetres'
import { REGISTRE_FENETRES } from './registre'
import { LIBELLES_THEME, storeTheme, THEMES } from './theme'

export function BarreOutils() {
  return (
    <header className="absolute inset-x-0 top-0 z-[300] flex h-10 items-center gap-3 border-b border-bord bg-fond/95 px-3 backdrop-blur">
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-bold tracking-[0.28em] text-accent">CORPUS</span>
        <span className="hidden text-[10px] text-attenue sm:inline">terminal du corps</span>
      </div>

      <MenuFonctions />

      <button
        type="button"
        onClick={() => storeFenetres.getState().mosaique()}
        className="rounded border border-bord px-2 py-1 text-[11px] text-attenue transition-colors hover:text-texte"
      >
        Mosaïque
      </button>

      <button
        type="button"
        onClick={() => storeFenetres.getState().definirPalette(true)}
        className="hidden items-center gap-1.5 rounded border border-bord px-2 py-1 text-[11px] text-attenue transition-colors hover:text-texte md:flex"
      >
        Rechercher
        <kbd className="rounded bg-bord px-1 text-[10px]">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <IndicateurDonnees />
        <SelecteurTheme />
      </div>
    </header>
  )
}

function MenuFonctions() {
  const [ouvert, setOuvert] = useState(false)
  const [dispositions, setDispositions] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ouvert) setDispositions(Object.keys(lireDispositionsNommees()))
  }, [ouvert])

  useEffect(() => {
    if (!ouvert) return
    const clic = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOuvert(false)
    }
    // En capture : un clic sur une fenêtre en dessous doit aussi refermer.
    document.addEventListener('mousedown', clic, true)
    return () => document.removeEventListener('mousedown', clic, true)
  }, [ouvert])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className={`rounded border px-2 py-1 text-[11px] transition-colors ${
          ouvert ? 'border-accent text-accent' : 'border-bord text-attenue hover:text-texte'
        }`}
      >
        Fenêtres ▾
      </button>
      {ouvert && (
        <div className="absolute left-0 top-full z-[320] mt-1 w-72 overflow-hidden rounded border border-bord bg-elevee shadow-2xl">
          {REGISTRE_FENETRES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                storeFenetres.getState().ouvrir(f.id)
                setOuvert(false)
              }}
              className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-bord/60"
            >
              <span className="mt-px w-11 shrink-0 font-bold text-accent">{f.mnemonique}</span>
              <span className="min-w-0">
                <span className="block text-[12px] text-texte">{f.titre}</span>
                <span className="block text-[10px] leading-snug text-attenue">{f.description}</span>
              </span>
            </button>
          ))}

          <div className="border-t border-bord">
            {dispositions.map((nom) => (
              <div key={nom} className="group flex items-center transition-colors hover:bg-bord/60">
                <button
                  type="button"
                  onClick={() => {
                    appliquerDispositionNommee(nom)
                    setOuvert(false)
                  }}
                  className="flex min-w-0 flex-1 items-baseline gap-2 px-2.5 py-1.5 text-left"
                >
                  <span className="w-11 shrink-0 text-[10px] uppercase tracking-wider text-attenue">
                    dispo
                  </span>
                  <span className="truncate text-[12px] text-texte">{nom}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Supprimer la disposition ${nom}`}
                  onClick={() => {
                    supprimerDispositionNommee(nom)
                    setDispositions((d) => d.filter((x) => x !== nom))
                  }}
                  className="shrink-0 px-2 text-[11px] text-attenue opacity-0 transition-opacity hover:text-defavorable group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const nom = window.prompt('Nom de la disposition (fenêtres et positions actuelles) :')
                if (nom && nom.trim() !== '') {
                  enregistrerDispositionNommee(nom)
                  setDispositions(Object.keys(lireDispositionsNommees()))
                }
              }}
              className="w-full px-2.5 py-1.5 text-left text-[11px] text-attenue transition-colors hover:bg-bord/60 hover:text-texte"
            >
              Enregistrer la disposition actuelle…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SelecteurTheme() {
  const theme = useTheme()
  return (
    <select
      value={theme}
      onChange={(e) => storeTheme.getState().definir(e.target.value as (typeof THEMES)[number])}
      className="rounded border border-bord bg-fond px-1.5 py-1 text-[11px] text-attenue outline-none focus:border-accent"
      aria-label="Thème"
    >
      {THEMES.map((t) => (
        <option key={t} value={t}>
          {LIBELLES_THEME[t]}
        </option>
      ))}
    </select>
  )
}

function IndicateurDonnees() {
  const vide = useDonneesVide()
  return (
    <span
      className="hidden items-center gap-1.5 text-[10px] lg:flex"
      title={vide ? 'Aucune donnée enregistrée' : 'Données présentes, stockées sur cette machine'}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: vide ? 'var(--c-attenue)' : 'var(--c-favorable)' }}
      />
      <span className="text-attenue">{vide ? 'aucune donnée' : 'local'}</span>
    </span>
  )
}
