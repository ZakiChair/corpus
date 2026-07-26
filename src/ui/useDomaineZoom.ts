import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clamperDomaine,
  deplacerDomaine,
  etendue,
  pixelVersValeur,
  zoomerDomaine,
  type Domaine,
} from './domaineAxe'

/**
 * Branche les gestes de zoom et de panoramique d'un canvas sur un domaine.
 *
 * La molette zoome autour du curseur, le glissement translate, le double-clic
 * remet aux bornes complètes.
 *
 * Les écouteurs sont natifs et non React : `wheel` doit être enregistré en
 * `{ passive: false }` pour pouvoir appeler `preventDefault` et empêcher la
 * page de défiler, ce que l'attribut `onWheel` de React ne permet pas.
 */
export function useDomaineZoom(
  bornes: Domaine | null,
  onGeste?: () => void,
): {
  refCanvas: React.RefObject<HTMLCanvasElement | null>
  domaine: Domaine | null
  definirDomaine: (d: Domaine) => void
  reinitialiser: () => void
} {
  const refCanvas = useRef<HTMLCanvasElement>(null)
  const [domaine, setDomaine] = useState<Domaine | null>(bornes)

  // Miroirs en ref : les écouteurs natifs sont attachés une seule fois et
  // liraient sinon des valeurs figées à leur création.
  const refDomaine = useRef<Domaine | null>(domaine)
  const refBornes = useRef<Domaine | null>(bornes)
  const refGeste = useRef(onGeste)
  refDomaine.current = domaine
  refBornes.current = bornes
  refGeste.current = onGeste

  // Quand les bornes changent (nouvelles données), on recadre : soit on adopte
  // les bornes si aucun domaine n'était posé, soit on y ramène l'existant.
  useEffect(() => {
    if (!bornes) {
      setDomaine(null)
      return
    }
    setDomaine((courant) => (courant ? clamperDomaine(courant, bornes) : { ...bornes }))
  }, [bornes?.min, bornes?.max]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = refCanvas.current
    if (!canvas) return

    const molette = (e: WheelEvent) => {
      const d = refDomaine.current
      const b = refBornes.current
      if (!d || !b) return
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const pivot = pixelVersValeur(d, e.clientX - rect.left, rect.width)
      const facteur = e.deltaY > 0 ? 1.18 : 1 / 1.18
      setDomaine(zoomerDomaine(d, facteur, pivot, b))
      refGeste.current?.()
    }

    const enfoncer = (e: PointerEvent) => {
      if (e.button !== 0) return
      const d = refDomaine.current
      const b = refBornes.current
      if (!d || !b) return
      const rect = canvas.getBoundingClientRect()
      const departX = e.clientX
      const departDomaine = d
      canvas.setPointerCapture(e.pointerId)

      const bouger = (ev: PointerEvent) => {
        const bCourant = refBornes.current
        if (!bCourant) return
        // Un glissement vers la droite doit ramener le passé : le delta est
        // donc de signe opposé au déplacement du pointeur.
        const delta = -((ev.clientX - departX) / rect.width) * etendue(departDomaine)
        setDomaine(deplacerDomaine(departDomaine, delta, bCourant))
      }
      const relacher = () => {
        canvas.releasePointerCapture(e.pointerId)
        window.removeEventListener('pointermove', bouger)
        window.removeEventListener('pointerup', relacher)
        refGeste.current?.()
      }
      window.addEventListener('pointermove', bouger)
      window.addEventListener('pointerup', relacher)
    }

    const doubleClic = () => {
      const b = refBornes.current
      if (b) setDomaine({ ...b })
    }

    canvas.addEventListener('wheel', molette, { passive: false })
    canvas.addEventListener('pointerdown', enfoncer)
    canvas.addEventListener('dblclick', doubleClic)
    return () => {
      canvas.removeEventListener('wheel', molette)
      canvas.removeEventListener('pointerdown', enfoncer)
      canvas.removeEventListener('dblclick', doubleClic)
    }
  }, [])

  const definirDomaine = useCallback((d: Domaine) => {
    const b = refBornes.current
    setDomaine(b ? clamperDomaine(d, b) : d)
  }, [])

  const reinitialiser = useCallback(() => {
    const b = refBornes.current
    if (b) setDomaine({ ...b })
  }, [])

  return { refCanvas, domaine, definirDomaine, reinitialiser }
}

/**
 * Suit la position du pointeur au-dessus d'un canvas, en pixels CSS relatifs.
 * Sert aux infobulles et au réticule.
 */
export function usePointeurCanvas(
  refCanvas: React.RefObject<HTMLCanvasElement | null>,
): { x: number; y: number } | null {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = refCanvas.current
    if (!canvas) return
    const bouger = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    const sortir = () => setPosition(null)
    canvas.addEventListener('pointermove', bouger)
    canvas.addEventListener('pointerleave', sortir)
    return () => {
      canvas.removeEventListener('pointermove', bouger)
      canvas.removeEventListener('pointerleave', sortir)
    }
  }, [refCanvas])

  return position
}

/** Redessine à chaque changement de taille du conteneur. */
export function useRedessinSurRedimensionnement(
  refCanvas: React.RefObject<HTMLCanvasElement | null>,
  redessiner: () => void,
): void {
  const refRedessiner = useRef(redessiner)
  refRedessiner.current = redessiner

  useEffect(() => {
    const canvas = refCanvas.current
    if (!canvas) return
    const observateur = new ResizeObserver(() => refRedessiner.current())
    observateur.observe(canvas)
    return () => observateur.disconnect()
  }, [refCanvas])
}
