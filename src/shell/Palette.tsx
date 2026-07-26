import { useEffect, useMemo, useRef, useState } from 'react'
import { usePaletteOuverte } from '../core/hooks'
import {
  appliquerDispositionNommee,
  lireDispositionsNommees,
  storeFenetres,
} from './gestionnaireFenetres'
import { REGISTRE_FENETRES } from './registre'

/**
 * Palette de commandes (⌘K).
 *
 * Le score est un appariement par SOUS-SÉQUENCE, pas une égalité de préfixe :
 * « corl » retrouve « Corrélations », ce qui est le comportement attendu d'une
 * palette. Les caractères contigus valent plus, et un début de mot davantage.
 */

export function scoreFlou(requete: string, cible: string): number {
  const r = requete.toLowerCase().trim()
  const c = cible.toLowerCase()
  if (r.length === 0) return 1
  let score = 0
  let position = 0
  let contigu = 0
  for (const lettre of r) {
    const trouve = c.indexOf(lettre, position)
    if (trouve < 0) return 0
    // Un caractère qui suit immédiatement le précédent vaut plus qu'un
    // caractère isolé, et un début de mot vaut un bonus.
    contigu = trouve === position ? contigu + 1 : 0
    const debutDeMot = trouve === 0 || c[trouve - 1] === ' ' || c[trouve - 1] === '-'
    score += 1 + contigu * 1.6 + (debutDeMot ? 1.4 : 0)
    position = trouve + 1
  }
  // Une cible courte qui matche entièrement bat une longue cible.
  return score / Math.sqrt(c.length)
}

interface Entree {
  cle: string
  mnemonique: string
  titre: string
  description: string
  executer: () => void
}

export function Palette() {
  const ouverte = usePaletteOuverte()
  const [requete, setRequete] = useState('')
  const [indexActif, setIndexActif] = useState(0)
  const refChamp = useRef<HTMLInputElement>(null)

  // Recalculées à chaque ouverture : les dispositions nommées bougent.
  const entrees: Entree[] = useMemo(
    () => [
      ...REGISTRE_FENETRES.map((f) => ({
        cle: f.id,
        mnemonique: f.mnemonique,
        titre: f.titre,
        description: f.description,
        executer: () => storeFenetres.getState().ouvrir(f.id),
      })),
      ...Object.keys(lireDispositionsNommees()).map((nom) => ({
        cle: `disposition:${nom}`,
        mnemonique: 'DISP',
        titre: nom,
        description: 'Disposition enregistrée — fenêtres et positions',
        executer: () => appliquerDispositionNommee(nom),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ouverte],
  )

  const resultats = useMemo(() => {
    if (requete.trim() === '') return entrees
    return entrees
      .map((e) => ({
        e,
        // Le mnémonique pèse le plus : c'est la façon dont on navigue vite.
        score:
          scoreFlou(requete, e.mnemonique) * 2.4 +
          scoreFlou(requete, e.titre) * 1.3 +
          scoreFlou(requete, e.description) * 0.35,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.e)
  }, [requete, entrees])

  useEffect(() => {
    setIndexActif(0)
  }, [requete])

  useEffect(() => {
    if (ouverte) {
      setRequete('')
      // Le focus doit attendre que l'élément soit monté et peint.
      requestAnimationFrame(() => refChamp.current?.focus())
    }
  }, [ouverte])

  useEffect(() => {
    const clavier = (e: KeyboardEvent) => {
      const { definirPalette } = storeFenetres.getState()
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        definirPalette(!storeFenetres.getState().paletteOuverte)
        return
      }
      if (!storeFenetres.getState().paletteOuverte) return
      if (e.key === 'Escape') {
        e.preventDefault()
        definirPalette(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIndexActif((i) => i + 1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIndexActif((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const choix = resultatsRef.current[indexActifRef.current]
        if (choix) {
          choix.executer()
          definirPalette(false)
        }
      }
    }
    window.addEventListener('keydown', clavier)
    return () => window.removeEventListener('keydown', clavier)
  }, [])

  // Miroirs : l'écouteur clavier n'est attaché qu'une fois et lirait sinon
  // des valeurs figées à sa création.
  const resultatsRef = useRef(resultats)
  const indexActifRef = useRef(indexActif)
  resultatsRef.current = resultats
  indexActifRef.current = Math.min(indexActif, Math.max(0, resultats.length - 1))

  if (!ouverte) return null
  const actif = indexActifRef.current

  return (
    <div
      className="absolute inset-0 z-[400] flex items-start justify-center bg-black/50 pt-[14vh] backdrop-blur-sm"
      onClick={() => storeFenetres.getState().definirPalette(false)}
    >
      <div
        className="w-[min(560px,92vw)] overflow-hidden rounded-lg border border-bord bg-elevee shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={refChamp}
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Fenêtre, mnémonique…"
          className="w-full border-b border-bord bg-transparent px-3 py-2.5 text-[13px] text-texte outline-none placeholder:text-attenue"
        />
        <div className="max-h-[46vh] overflow-auto">
          {resultats.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12px] text-attenue">Aucun résultat</div>
          ) : (
            resultats.map((e, i) => (
              <button
                key={e.cle}
                type="button"
                onMouseEnter={() => setIndexActif(i)}
                onClick={() => {
                  e.executer()
                  storeFenetres.getState().definirPalette(false)
                }}
                className={`flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition-colors ${
                  i === actif ? 'bg-accent/12' : ''
                }`}
              >
                <span className="mt-px w-11 shrink-0 font-bold text-accent">{e.mnemonique}</span>
                <span className="min-w-0">
                  <span className="block text-[12px] text-texte">{e.titre}</span>
                  <span className="block text-[10px] leading-snug text-attenue">{e.description}</span>
                </span>
              </button>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-bord px-3 py-1 text-[10px] text-attenue">
          <span>↑↓ naviguer</span>
          <span>⏎ ouvrir</span>
          <span>échap fermer</span>
        </div>
      </div>
    </div>
  )
}
