import { useCallback, useRef, type ReactNode } from 'react'
import {
  HAUTEUR_MIN,
  LARGEUR_MIN,
  storeFenetres,
  type FenetreOuverte,
} from './gestionnaireFenetres'
import { definitionFenetre } from './registre'

/**
 * Chrome d'une fenêtre : barre de titre, déplacement, redimensionnement.
 *
 * Déplacement et redimensionnement écrivent DIRECTEMENT dans le style de
 * l'élément pendant le geste, et ne poussent la géométrie dans le store qu'au
 * relâchement. Passer par un `set()` Zustand à chaque `pointermove` ferait
 * rendre l'arbre React soixante fois par seconde, et les fenêtres contiennent
 * des canvas qui se redessinent à chaque rendu.
 */

type Poignee = 'n' | 's' | 'e' | 'o' | 'ne' | 'no' | 'se' | 'so'

const POIGNEES: { cle: Poignee; classe: string; curseur: string }[] = [
  { cle: 'n', classe: 'top-0 left-2 right-2 h-1.5', curseur: 'ns-resize' },
  { cle: 's', classe: 'bottom-0 left-2 right-2 h-1.5', curseur: 'ns-resize' },
  { cle: 'o', classe: 'left-0 top-2 bottom-2 w-1.5', curseur: 'ew-resize' },
  { cle: 'e', classe: 'right-0 top-2 bottom-2 w-1.5', curseur: 'ew-resize' },
  { cle: 'no', classe: 'left-0 top-0 w-3 h-3', curseur: 'nwse-resize' },
  { cle: 'ne', classe: 'right-0 top-0 w-3 h-3', curseur: 'nesw-resize' },
  { cle: 'so', classe: 'left-0 bottom-0 w-3 h-3', curseur: 'nesw-resize' },
  { cle: 'se', classe: 'right-0 bottom-0 w-3 h-3', curseur: 'nwse-resize' },
]

interface Props {
  fenetre: FenetreOuverte
  children: ReactNode
}

export function FenetreFlottante({ fenetre, children }: Props) {
  const refRacine = useRef<HTMLDivElement>(null)
  const def = definitionFenetre(fenetre.id)
  const { focaliser, fermer, deplacer, redimensionner, basculerReduction, basculerAgrandissement } =
    storeFenetres.getState()

  const demarrerDeplacement = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const racine = refRacine.current
      if (!racine) return
      focaliser(fenetre.id)
      const depart = { x: e.clientX, y: e.clientY }
      const origine = { x: fenetre.x, y: fenetre.y }
      const cible = e.currentTarget as HTMLElement
      cible.setPointerCapture(e.pointerId)
      let dernier = origine

      const bouger = (ev: PointerEvent) => {
        dernier = {
          x: origine.x + (ev.clientX - depart.x),
          y: Math.max(0, origine.y + (ev.clientY - depart.y)),
        }
        racine.style.left = `${dernier.x}px`
        racine.style.top = `${dernier.y}px`
      }
      const relacher = () => {
        cible.releasePointerCapture(e.pointerId)
        window.removeEventListener('pointermove', bouger)
        window.removeEventListener('pointerup', relacher)
        deplacer(fenetre.id, dernier.x, dernier.y)
      }
      window.addEventListener('pointermove', bouger)
      window.addEventListener('pointerup', relacher)
    },
    [fenetre.id, fenetre.x, fenetre.y, focaliser, deplacer],
  )

  const demarrerRedimensionnement = useCallback(
    (e: React.PointerEvent, poignee: Poignee) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const racine = refRacine.current
      if (!racine) return
      focaliser(fenetre.id)
      const depart = { x: e.clientX, y: e.clientY }
      const origine = { x: fenetre.x, y: fenetre.y, largeur: fenetre.largeur, hauteur: fenetre.hauteur }
      const cible = e.currentTarget as HTMLElement
      cible.setPointerCapture(e.pointerId)
      let dernier = origine

      const bouger = (ev: PointerEvent) => {
        const dx = ev.clientX - depart.x
        const dy = ev.clientY - depart.y
        let { x, y, largeur, hauteur } = origine

        if (poignee.includes('e')) largeur = Math.max(LARGEUR_MIN, origine.largeur + dx)
        if (poignee.includes('s')) hauteur = Math.max(HAUTEUR_MIN, origine.hauteur + dy)
        if (poignee.includes('o')) {
          // Le bord gauche déplace l'origine ET change la largeur : on borne la
          // largeur d'abord, puis on en déduit x, sinon la fenêtre « glisse »
          // une fois la largeur minimale atteinte.
          largeur = Math.max(LARGEUR_MIN, origine.largeur - dx)
          x = origine.x + (origine.largeur - largeur)
        }
        if (poignee.includes('n')) {
          hauteur = Math.max(HAUTEUR_MIN, origine.hauteur - dy)
          y = origine.y + (origine.hauteur - hauteur)
        }

        dernier = { x, y, largeur, hauteur }
        racine.style.left = `${x}px`
        racine.style.top = `${y}px`
        racine.style.width = `${largeur}px`
        racine.style.height = `${hauteur}px`
      }
      const relacher = () => {
        cible.releasePointerCapture(e.pointerId)
        window.removeEventListener('pointermove', bouger)
        window.removeEventListener('pointerup', relacher)
        redimensionner(fenetre.id, dernier)
      }
      window.addEventListener('pointermove', bouger)
      window.addEventListener('pointerup', relacher)
    },
    [fenetre.id, fenetre.x, fenetre.y, fenetre.largeur, fenetre.hauteur, focaliser, redimensionner],
  )

  if (fenetre.reduite) return null

  return (
    <div
      ref={refRacine}
      className="absolute flex flex-col overflow-hidden rounded-md border border-bord bg-surface shadow-2xl shadow-black/40"
      style={{
        left: fenetre.x,
        top: fenetre.y,
        width: fenetre.largeur,
        height: fenetre.hauteur,
        zIndex: fenetre.z,
      }}
      onPointerDown={() => focaliser(fenetre.id)}
      role="dialog"
      aria-label={def.titre}
    >
      <div
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-bord bg-elevee px-2.5 py-1.5"
        onPointerDown={demarrerDeplacement}
        onDoubleClick={() => basculerAgrandissement(fenetre.id)}
      >
        <span className="font-bold tracking-widest text-accent">{def.mnemonique}</span>
        <span className="truncate text-attenue">{def.titre}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <BoutonTitre
            titre="Réduire"
            onClick={() => basculerReduction(fenetre.id)}
            label="—"
          />
          <BoutonTitre
            titre="Agrandir"
            onClick={() => basculerAgrandissement(fenetre.id)}
            label="▢"
          />
          <BoutonTitre titre="Fermer" onClick={() => fermer(fenetre.id)} label="✕" danger />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>

      {POIGNEES.map((p) => (
        <div
          key={p.cle}
          className={`corpus-redim absolute ${p.classe}`}
          style={{ cursor: p.curseur }}
          onPointerDown={(e) => demarrerRedimensionnement(e, p.cle)}
        />
      ))}
    </div>
  )
}

function BoutonTitre({
  titre,
  label,
  onClick,
  danger,
}: {
  titre: string
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={titre}
      aria-label={titre}
      // Le pointerdown est stoppé pour que le clic sur un bouton ne démarre
      // pas un déplacement de fenêtre.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={`grid h-5 w-5 place-items-center rounded text-[11px] text-attenue transition-colors hover:bg-bord ${
        danger ? 'hover:text-defavorable' : 'hover:text-texte'
      }`}
    >
      {label}
    </button>
  )
}
