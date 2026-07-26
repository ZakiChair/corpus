import { useCallback, useRef, type ReactNode } from 'react'
import {
  coteAncrageDepuisPointeur,
  geometrieAncrage,
  HAUTEUR_MIN,
  LARGEUR_MIN,
  storeFenetres,
  type CoteAncrage,
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

/*
 * Aperçu d'ancrage : un unique <div> hors React, créé au premier glisser.
 * Passer par un état React repeindrait l'arbre à chaque pointermove, pour un
 * rectangle qui ne vit que le temps du geste.
 */
let apercuAncrage: HTMLDivElement | null = null

function montrerApercu(cote: CoteAncrage | null): void {
  if (!cote) {
    if (apercuAncrage) apercuAncrage.style.opacity = '0'
    return
  }
  if (!apercuAncrage) {
    apercuAncrage = document.createElement('div')
    apercuAncrage.className = 'corpus-apercu-ancrage'
    document.body.appendChild(apercuAncrage)
  }
  const g = geometrieAncrage(cote, { l: window.innerWidth, h: window.innerHeight })
  apercuAncrage.style.left = `${g.x}px`
  apercuAncrage.style.top = `${g.y}px`
  apercuAncrage.style.width = `${g.largeur}px`
  apercuAncrage.style.height = `${g.hauteur}px`
  apercuAncrage.style.opacity = '1'
}

function retirerApercu(): void {
  apercuAncrage?.remove()
  apercuAncrage = null
}

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
  const {
    focaliser,
    fermer,
    deplacer,
    redimensionner,
    ancrer,
    basculerReduction,
    basculerAgrandissement,
  } = storeFenetres.getState()

  const demarrerDeplacement = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const racine = refRacine.current
      if (!racine) return
      focaliser(fenetre.id)
      const depart = { x: e.clientX, y: e.clientY }
      const cible = e.currentTarget as HTMLElement
      cible.setPointerCapture(e.pointerId)

      let origine = { x: fenetre.x, y: fenetre.y }
      let dernier = origine
      /** Taille courante — change si la fenêtre est décrochée en route. */
      let taille = { largeur: fenetre.largeur, hauteur: fenetre.hauteur }
      const avant = fenetre.avantAgrandissement
      let decrochee = false
      let bougee = false
      let cote: CoteAncrage | null = null

      const bouger = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - depart.x) + Math.abs(ev.clientY - depart.y) < 4 && !bougee) return
        bougee = true

        // Fenêtre ancrée ou agrandie : le premier vrai mouvement la décroche
        // et lui rend sa taille d'avant, le curseur restant à la même
        // position RELATIVE dans la barre de titre — sans quoi elle saute
        // sous la souris.
        if (avant && !decrochee) {
          decrochee = true
          taille = { largeur: avant.largeur, hauteur: avant.hauteur }
          const part = Math.min(Math.max((depart.x - fenetre.x) / fenetre.largeur, 0.1), 0.9)
          origine = { x: depart.x - avant.largeur * part, y: fenetre.y }
          racine.style.width = `${taille.largeur}px`
          racine.style.height = `${taille.hauteur}px`
        }

        dernier = {
          x: origine.x + (ev.clientX - depart.x),
          y: Math.max(0, origine.y + (ev.clientY - depart.y)),
        }
        racine.style.left = `${dernier.x}px`
        racine.style.top = `${dernier.y}px`

        cote = coteAncrageDepuisPointeur(ev.clientX, ev.clientY, {
          l: window.innerWidth,
          h: window.innerHeight,
        })
        montrerApercu(cote)
      }
      const relacher = () => {
        cible.releasePointerCapture(e.pointerId)
        window.removeEventListener('pointermove', bouger)
        window.removeEventListener('pointerup', relacher)
        retirerApercu()
        // Un simple clic sur la barre de titre ne doit rien écrire : il
        // effacerait la géométrie de restauration d'une fenêtre ancrée.
        if (!bougee) return
        if (cote) ancrer(fenetre.id, cote)
        else if (decrochee) redimensionner(fenetre.id, { ...dernier, ...taille })
        else deplacer(fenetre.id, dernier.x, dernier.y)
      }
      window.addEventListener('pointermove', bouger)
      window.addEventListener('pointerup', relacher)
    },
    [
      fenetre.id,
      fenetre.x,
      fenetre.y,
      fenetre.largeur,
      fenetre.hauteur,
      fenetre.avantAgrandissement,
      focaliser,
      deplacer,
      redimensionner,
      ancrer,
    ],
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
