import { useCallback, useEffect, type ReactNode } from 'react'
import type { Serie } from '../core/types'
import { avecMarge } from './domaineAxe'
import { lireJeton, preparerCanvas } from './jetonsCanvas'
import { useRedessinSurRedimensionnement, useRefCanvas } from './useDomaineZoom'
import { useThemeCanvas } from './useThemeCanvas'

/* —————————————————————————— Contrôles de base —————————————————————————— */

export function Bouton({
  children,
  onClick,
  actif,
  variante = 'neutre',
  titre,
  type = 'button',
  desactive,
}: {
  children: ReactNode
  onClick?: () => void
  actif?: boolean
  variante?: 'neutre' | 'accent' | 'danger'
  titre?: string
  type?: 'button' | 'submit'
  desactive?: boolean
}) {
  const base =
    'rounded border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const styles = actif
    ? 'border-accent bg-accent/15 text-accent'
    : variante === 'accent'
      ? 'border-accent/60 bg-transparent text-accent hover:bg-accent/10'
      : variante === 'danger'
        ? 'border-bord text-attenue hover:border-defavorable hover:text-defavorable'
        : 'border-bord text-attenue hover:border-attenue hover:text-texte'
  return (
    <button type={type} title={titre} onClick={onClick} disabled={desactive} className={`${base} ${styles}`}>
      {children}
    </button>
  )
}

export const PERIODES_STANDARD = [
  { id: '30j', jours: 30, label: '30 j' },
  { id: '90j', jours: 90, label: '90 j' },
  { id: '180j', jours: 180, label: '6 m' },
  { id: '365j', jours: 365, label: '1 an' },
  { id: 'tout', jours: null, label: 'Tout' },
] as const

export function BarrePeriodes({
  actif,
  onChange,
}: {
  actif: string | null
  onChange: (p: { id: string; jours: number | null }) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {PERIODES_STANDARD.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange({ id: p.id, jours: p.jours })}
          className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
            actif === p.id ? 'bg-accent/20 text-accent' : 'text-attenue hover:text-texte'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

export function Selecteur<T extends string>({
  valeur,
  options,
  onChange,
  label,
  pleineLargeur,
}: {
  valeur: T
  options: readonly { valeur: T; label: string }[]
  onChange: (v: T) => void
  label?: string
  pleineLargeur?: boolean
}) {
  return (
    <label className={`flex items-center gap-1.5 ${pleineLargeur ? 'w-full' : ''}`}>
      {label && <span className="shrink-0 text-[11px] text-attenue">{label}</span>}
      <select
        value={valeur}
        onChange={(e) => onChange(e.target.value as T)}
        className={`rounded border border-bord bg-fond px-1.5 py-1 text-[12px] text-texte outline-none focus:border-accent ${
          pleineLargeur ? 'w-full' : ''
        }`}
      >
        {options.map((o) => (
          <option key={o.valeur} value={o.valeur}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Segments<T extends string>({
  valeur,
  options,
  onChange,
}: {
  valeur: T
  options: readonly { valeur: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-bord">
      {options.map((o) => (
        <button
          key={o.valeur}
          type="button"
          onClick={() => onChange(o.valeur)}
          className={`px-2 py-0.5 text-[11px] transition-colors ${
            valeur === o.valeur ? 'bg-accent/20 text-accent' : 'text-attenue hover:text-texte'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Etiquette({
  children,
  jeton,
  titre,
}: {
  children: ReactNode
  jeton?: string
  titre?: string
}) {
  const couleur = jeton ? `var(${jeton})` : 'var(--c-attenue)'
  return (
    <span
      title={titre}
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ color: couleur, backgroundColor: `color-mix(in srgb, ${couleur} 14%, transparent)` }}
    >
      {children}
    </span>
  )
}

export function Vide({ titre, children }: { titre: string; children?: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="max-w-sm">
        <p className="text-[13px] text-texte">{titre}</p>
        {children && <div className="mt-2 text-[12px] leading-relaxed text-attenue">{children}</div>}
      </div>
    </div>
  )
}

export function EnteteFenetre({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-bord px-3 py-1.5">
      {children}
    </div>
  )
}

export function PiedNote({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-bord px-3 py-1 text-[10px] leading-relaxed text-attenue">
      {children}
    </div>
  )
}

/* ——————————————————————————— Éléments graphiques ——————————————————————————— */

export interface LigneInfobulle {
  label: string
  valeur: string
  jeton?: string
}

/**
 * Réticule vertical et bulle flottante. Rendue en DOM plutôt que peinte dans
 * le canvas : le texte reste sélectionnable, net à toute densité d'écran, et
 * son déplacement ne force pas un redessin complet du graphe.
 */
export function InfobulleGraphe({
  xPix,
  largeurGraphe,
  titre,
  lignes,
  hauteur,
}: {
  xPix: number
  largeurGraphe: number
  titre: string
  lignes: LigneInfobulle[]
  hauteur?: number
}) {
  // La bulle bascule à gauche du réticule quand elle déborderait à droite.
  const aDroite = xPix < largeurGraphe - 190
  return (
    <>
      <div
        className="pointer-events-none absolute top-0 w-px bg-bord"
        style={{ left: xPix, height: hauteur ?? '100%' }}
      />
      <div
        className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded border border-bord bg-elevee/95 px-2 py-1.5 shadow-lg backdrop-blur-sm"
        style={aDroite ? { left: xPix + 10 } : { right: largeurGraphe - xPix + 10 }}
      >
        <div className="mb-1 text-[10px] uppercase tracking-wider text-attenue">{titre}</div>
        {lignes.map((l, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-attenue">
              {l.jeton && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: `var(${l.jeton})` }}
                />
              )}
              {l.label}
            </span>
            <span className="tabular-nums text-texte">{l.valeur}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * Courbe miniature sans axes ni graduations : elle donne la FORME d'une série,
 * pas ses valeurs. C'est volontairement un canvas et non un SVG — une tuile de
 * bilan peut en afficher quinze, et quinze SVG de deux cents points chacun
 * pèsent lourd dans l'arbre DOM.
 */
export function Sparkline({
  serie,
  jeton = '--c-accent',
  hauteur = 26,
  remplir = true,
}: {
  serie: Serie
  jeton?: string
  hauteur?: number
  remplir?: boolean
}) {
  const { refCanvas, canvas } = useRefCanvas()
  // Le thème est une dépendance de dessin : sans lui, la courbe garde les
  // couleurs de l'ancien thème après un changement.
  const theme = useThemeCanvas()

  const dessiner = useCallback(() => {
    if (!canvas) return
    const prepare = preparerCanvas(canvas)
    if (!prepare) return
    const { ctx, largeur, hauteur: h } = prepare
    if (serie.length < 2) return

    const valeurs = serie.map((p) => p.v)
    const { min, max } = avecMarge(Math.min(...valeurs), Math.max(...valeurs), 0.12)
    const enX = (i: number) => (i / (serie.length - 1)) * largeur
    const enY = (v: number) => h - ((v - min) / (max - min)) * h

    const couleur = lireJeton(jeton)

    if (remplir) {
      ctx.beginPath()
      ctx.moveTo(0, h)
      serie.forEach((p, i) => ctx.lineTo(enX(i), enY(p.v)))
      ctx.lineTo(largeur, h)
      ctx.closePath()
      const degrade = ctx.createLinearGradient(0, 0, 0, h)
      degrade.addColorStop(0, `${couleur}44`)
      degrade.addColorStop(1, `${couleur}00`)
      ctx.fillStyle = degrade
      ctx.fill()
    }

    ctx.beginPath()
    serie.forEach((p, i) => (i === 0 ? ctx.moveTo(enX(i), enY(p.v)) : ctx.lineTo(enX(i), enY(p.v))))
    ctx.strokeStyle = couleur
    ctx.lineWidth = 1.25
    ctx.lineJoin = 'round'
    ctx.stroke()

    // Point terminal : repère la valeur la plus récente d'un coup d'œil.
    const dernier = serie[serie.length - 1]!
    ctx.beginPath()
    ctx.arc(largeur - 1.5, enY(dernier.v), 2, 0, Math.PI * 2)
    ctx.fillStyle = couleur
    ctx.fill()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `theme` force le redessin au changement de thème
  }, [canvas, serie, jeton, remplir, theme])

  useEffect(() => dessiner(), [dessiner])
  // Les tuiles vivent dans des grilles fluides : le buffer du canvas doit
  // suivre la largeur réelle, sinon la courbe reste un bitmap étiré et flou.
  useRedessinSurRedimensionnement(canvas, dessiner)

  return <canvas ref={refCanvas} className="w-full" style={{ height: hauteur }} />
}

/** Barre horizontale centrée sur zéro, pour représenter un z-score. */
export function BarreEcart({ z, max = 3 }: { z: number; max?: number }) {
  const borne = Math.max(-max, Math.min(max, z))
  const demi = (Math.abs(borne) / max) * 50
  const jeton =
    Math.abs(z) < 0.5 ? '--c-attenue' : z > 0 ? '--c-favorable' : '--c-defavorable'
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-bord/60">
      <div className="absolute left-1/2 top-0 h-full w-px bg-attenue/50" />
      <div
        className="absolute top-0 h-full rounded-full"
        style={{
          backgroundColor: `var(${jeton})`,
          left: borne >= 0 ? '50%' : `${50 - demi}%`,
          width: `${demi}%`,
        }}
      />
    </div>
  )
}
