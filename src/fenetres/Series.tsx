import { useEffect, useMemo, useRef, useState } from 'react'
import { AVERTISSEMENT } from '../analyse/lecture'
import { ecartType, medianeGlissante, moyenne, valeurAuJour } from '../analyse/stats'
import { useEtat } from '../core/hooks'
import { definitionOuGenerique, formaterHeureCoucher, formaterValeur } from '../core/metriques'
import { serieAnalyse, seriesRenseignees } from '../core/series'
import {
  formaterJourCourt,
  formaterJourLong,
  indexVersJour,
  jourVersIndex,
  type Jour,
} from '../core/temps'
import { COULEURS_ANNOTATION, LIBELLES_ANNOTATION, type Serie } from '../core/types'
import {
  avecMarge,
  domainePourPreset,
  graduations,
  indicesVisibles,
  pixelVersValeur,
  valeurVersPixel,
  type Domaine,
} from '../ui/domaineAxe'
import { couleurSerie, lireJeton, nomJetonSerie, preparerCanvas } from '../ui/jetonsCanvas'
import {
  usePointeurCanvas,
  useDomaineZoom,
  useRedessinSurRedimensionnement,
} from '../ui/useDomaineZoom'
import {
  BarrePeriodes,
  Bouton,
  EnteteFenetre,
  InfobulleGraphe,
  PERIODES_STANDARD,
  PiedNote,
  Vide,
} from '../ui/ui'

/**
 * Séries : le graphe principal.
 *
 * Choix structurant : au-delà d'UNE métrique affichée, la fenêtre passe
 * d'office en z-score plutôt que d'ajouter un second axe. Le double axe est le
 * mensonge graphique classique — en choisissant les échelles, on fait se
 * croiser ou diverger n'importe quelle paire de courbes. Normaliser les rend
 * réellement comparables, et l'axe porte alors une unité honnête : le σ.
 */

const MARGE = { gauche: 46, droite: 10, haut: 10, bas: 34 }
const HAUTEUR_RUBAN = 12
const LISSAGE_JOURS = 7

/**
 * Au-delà de cette étendue visible, la série brute passe en transparence et
 * une médiane glissante est tracée par-dessus.
 *
 * Lisser tout le temps reviendrait à cacher le bruit, qui est une information :
 * une VFC qui oscille de 20 ms d'un jour à l'autre ne dit pas la même chose
 * qu'une VFC stable de même moyenne. Superposer les deux traits laisse lire la
 * tendance ET la dispersion.
 */
const SEUIL_LISSAGE_JOURS = 90

export function Series() {
  const etat = useEtat()
  const disponibles = useMemo(() => seriesRenseignees(etat), [etat])
  const [selection, setSelection] = useState<string[]>([])
  const [preset, setPreset] = useState<string | null>('90j')

  // Sélection initiale : la première métrique de récupération renseignée.
  useEffect(() => {
    if (selection.length > 0 || disponibles.length === 0) return
    const prefere = ['vfc', 'fc_repos', 'sommeil_duree', 'poids'].find((id) =>
      disponibles.includes(id),
    )
    setSelection([prefere ?? disponibles[0]!])
  }, [disponibles, selection.length])

  const series = useMemo(
    () =>
      selection
        .filter((id) => disponibles.includes(id))
        .map((id) => ({ id, points: serieAnalyse(etat, id) }))
        .filter((s) => s.points.length > 1),
    [etat, selection, disponibles],
  )

  const normalise = series.length > 1

  const bornes = useMemo<Domaine | null>(() => {
    if (series.length === 0) return null
    let min = Infinity
    let max = -Infinity
    for (const s of series) {
      min = Math.min(min, jourVersIndex(s.points[0]!.j))
      max = Math.max(max, jourVersIndex(s.points[s.points.length - 1]!.j))
    }
    return Number.isFinite(min) ? { min, max } : null
  }, [series])

  const { refCanvas, domaine, definirDomaine } = useDomaineZoom(bornes, () => setPreset(null))
  const pointeur = usePointeurCanvas(refCanvas)

  // Le préréglage affiché doit correspondre à ce qui est tracé. Sans cela, la
  // barre annonce « 90 j » en surbrillance pendant que le graphe montre tout
  // l'historique : l'interface ment sur son propre état.
  const refPreset = useRef(preset)
  refPreset.current = preset
  useEffect(() => {
    if (!bornes) return
    const p = PERIODES_STANDARD.find((x) => x.id === refPreset.current)
    if (p) definirDomaine(domainePourPreset(bornes, p.jours))
  }, [bornes?.min, bornes?.max, definirDomaine]) // eslint-disable-line react-hooks/exhaustive-deps

  // Séries transformées une seule fois : normaliser à chaque frame de dessin
  // recalculerait moyenne et écart-type soixante fois par seconde.
  const tracees = useMemo(
    () =>
      series.map((s) => {
        const valeurs: Serie = !normalise
          ? s.points
          : (() => {
              const vs = s.points.map((p) => p.v)
              const m = moyenne(vs)
              const et = ecartType(vs)
              return Number.isFinite(et) && et > 0
                ? s.points.map((p) => ({ j: p.j, v: (p.v - m) / et }))
                : s.points.map((p) => ({ j: p.j, v: 0 }))
            })()
        // Médiane glissante plutôt que moyenne : une seule mesure aberrante
        // (montre mal portée, pesée habillée) ne doit pas déformer la tendance.
        return { ...s, valeurs, lisse: medianeGlissante(valeurs, LISSAGE_JOURS) }
      }),
    [series, normalise],
  )

  const dessiner = useMemo(
    () => () => {
      const canvas = refCanvas.current
      if (!canvas || !domaine) return
      const prepare = preparerCanvas(canvas)
      if (!prepare) return
      const { ctx, largeur, hauteur } = prepare

      const l = largeur - MARGE.gauche - MARGE.droite
      const h = hauteur - MARGE.haut - MARGE.bas
      if (l < 20 || h < 20) return

      const couleurGrille = lireJeton('--c-grille')
      const couleurTexte = lireJeton('--c-attenue')

      // Échelle verticale : commune si normalisé, sinon celle de l'unique série.
      let bornesY: Domaine
      if (normalise) {
        let m = 0
        for (const s of tracees) {
          const { debut, fin } = indicesVisibles(s.valeurs, (p) => jourVersIndex(p.j), domaine)
          for (let i = debut; i <= fin; i++) m = Math.max(m, Math.abs(s.valeurs[i]!.v))
        }
        const borne = Math.max(1.5, Math.ceil(m * 10) / 10)
        bornesY = { min: -borne, max: borne }
      } else {
        let min = Infinity
        let max = -Infinity
        for (const s of tracees) {
          const { debut, fin } = indicesVisibles(s.valeurs, (p) => jourVersIndex(p.j), domaine)
          for (let i = debut; i <= fin; i++) {
            min = Math.min(min, s.valeurs[i]!.v)
            max = Math.max(max, s.valeurs[i]!.v)
          }
        }
        bornesY = Number.isFinite(min) ? avecMarge(min, max) : { min: 0, max: 1 }
      }

      const enX = (jour: Jour) =>
        MARGE.gauche + valeurVersPixel(domaine, jourVersIndex(jour), l)
      const enY = (v: number) =>
        MARGE.haut + h - ((v - bornesY.min) / (bornesY.max - bornesY.min)) * h

      // Grille horizontale et graduations.
      ctx.font = '10px ui-monospace, monospace'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'right'
      for (const g of graduations(bornesY.min, bornesY.max, 5)) {
        const y = enY(g)
        if (y < MARGE.haut - 1 || y > MARGE.haut + h + 1) continue
        ctx.strokeStyle = couleurGrille
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(MARGE.gauche, Math.round(y) + 0.5)
        ctx.lineTo(MARGE.gauche + l, Math.round(y) + 0.5)
        ctx.stroke()
        ctx.fillStyle = couleurTexte
        ctx.fillText(
          normalise ? `${g > 0 ? '+' : ''}${g.toFixed(1)}` : formaterNombreAxe(g),
          MARGE.gauche - 5,
          y,
        )
      }

      // Ligne de référence à zéro quand on est en écarts-types.
      if (normalise) {
        ctx.strokeStyle = lireJeton('--c-bord')
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(MARGE.gauche, Math.round(enY(0)) + 0.5)
        ctx.lineTo(MARGE.gauche + l, Math.round(enY(0)) + 0.5)
        ctx.stroke()
      }

      // Graduations de temps.
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const nbLabels = Math.max(2, Math.min(8, Math.floor(l / 78)))
      for (let k = 0; k <= nbLabels; k++) {
        const indexJour = Math.round(domaine.min + ((domaine.max - domaine.min) * k) / nbLabels)
        const x = enX(indexVersJour(indexJour))
        ctx.strokeStyle = couleurGrille
        ctx.beginPath()
        ctx.moveTo(Math.round(x) + 0.5, MARGE.haut)
        ctx.lineTo(Math.round(x) + 0.5, MARGE.haut + h)
        ctx.stroke()
        ctx.fillStyle = couleurTexte
        ctx.fillText(formaterJourCourt(indexVersJour(indexJour)), x, MARGE.haut + h + 14)
      }

      // Ruban d'annotations, sous le graphe.
      const yRuban = MARGE.haut + h + 2
      for (const a of etat.annotations) {
        const idx = jourVersIndex(a.j)
        if (idx < domaine.min || idx > domaine.max) continue
        ctx.fillStyle = lireJeton(COULEURS_ANNOTATION[a.type])
        ctx.globalAlpha = 0.75
        ctx.fillRect(enX(a.j) - 0.75, yRuban, 1.5, HAUTEUR_RUBAN * (a.intensite ?? 0.6) + 2)
        ctx.globalAlpha = 1
      }

      // Courbes. Au-delà du seuil, le brut s'efface derrière sa médiane
      // glissante : à 540 points sur 1500 pixels, le trait plein sature.
      const dense = domaine.max - domaine.min > SEUIL_LISSAGE_JOURS
      tracees.forEach((s, k) => {
        const couleur = couleurSerie(k)
        if (dense) {
          tracerSerie(ctx, s.valeurs, domaine, enX, enY, couleur, 1, 0.3)
          tracerSerie(ctx, s.lisse, domaine, enX, enY, couleur, 1.7, 1)
        } else {
          tracerSerie(ctx, s.valeurs, domaine, enX, enY, couleur, 1.4, 1)
        }
      })
    },
    [domaine, tracees, normalise, etat.annotations, refCanvas],
  )

  useEffect(() => {
    dessiner()
  }, [dessiner])
  useRedessinSurRedimensionnement(refCanvas, dessiner)

  // Jour survolé, pour l'infobulle.
  const jourSurvole = useMemo(() => {
    if (!pointeur || !domaine) return null
    const canvas = refCanvas.current
    if (!canvas) return null
    const l = canvas.getBoundingClientRect().width - MARGE.gauche - MARGE.droite
    if (pointeur.x < MARGE.gauche || pointeur.x > MARGE.gauche + l) return null
    const idx = Math.round(pixelVersValeur(domaine, pointeur.x - MARGE.gauche, l))
    return indexVersJour(idx)
  }, [pointeur, domaine, refCanvas])

  if (disponibles.length === 0) {
    return (
      <Vide titre="Aucune série à tracer.">
        Ouvre <strong className="text-texte">DONN</strong> pour générer un historique de
        démonstration ou importer un fichier.
      </Vide>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <EnteteFenetre>
        <BarrePeriodes
          actif={preset}
          onChange={(p) => {
            setPreset(p.id)
            if (bornes) definirDomaine(domainePourPreset(bornes, p.jours))
          }}
        />
        <span className="ml-auto text-[10px] text-attenue">
          {normalise ? 'écarts-types (σ)' : 'unités brutes'}
        </span>
        {selection.length > 1 && (
          <Bouton onClick={() => setSelection(selection.slice(0, 1))}>Une seule</Bouton>
        )}
      </EnteteFenetre>

      <div className="flex shrink-0 flex-wrap gap-1 border-b border-bord px-3 py-1.5">
        {disponibles.map((id) => {
          const actif = selection.includes(id)
          const rang = selection.indexOf(id)
          return (
            <button
              key={id}
              type="button"
              onClick={() =>
                setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
              }
              className="rounded border px-1.5 py-0.5 text-[10px] transition-colors"
              style={
                actif
                  ? {
                      borderColor: `var(${nomJetonSerie(rang)})`,
                      color: `var(${nomJetonSerie(rang)})`,
                      backgroundColor: `color-mix(in srgb, var(${nomJetonSerie(rang)}) 12%, transparent)`,
                    }
                  : { borderColor: 'var(--c-bord)', color: 'var(--c-attenue)' }
              }
            >
              {definitionOuGenerique(id).abrege}
            </button>
          )
        })}
      </div>

      <div className="relative min-h-0 flex-1">
        <canvas ref={refCanvas} className="h-full w-full cursor-crosshair" />
        {jourSurvole && pointeur && domaine && (
          <InfobulleGraphe
            xPix={pointeur.x}
            largeurGraphe={refCanvas.current?.getBoundingClientRect().width ?? 0}
            titre={formaterJourLong(jourSurvole)}
            lignes={[
              ...series.map((s, k) => {
                const v = valeurAuJour(s.points, jourSurvole)
                return {
                  label: definitionOuGenerique(s.id).abrege,
                  jeton: nomJetonSerie(k),
                  valeur:
                    v === undefined
                      ? '—'
                      : s.id === 'sommeil_coucher'
                        ? formaterHeureCoucher(v)
                        : formaterValeur(s.id, v),
                }
              }),
              ...etat.annotations
                .filter((a) => a.j === jourSurvole)
                .map((a) => ({
                  label: LIBELLES_ANNOTATION[a.type],
                  jeton: COULEURS_ANNOTATION[a.type],
                  valeur: a.note ?? '•',
                })),
            ]}
          />
        )}
      </div>

      <PiedNote>
        Molette : zoom · glisser : déplacer · double-clic : tout afficher. Une interruption du
        trait signale plus d’une semaine sans mesure. {AVERTISSEMENT}
      </PiedNote>
    </div>
  )
}

/**
 * Trace une série. Un trou de plus d'une semaine COUPE le trait : relier deux
 * points distants d'un mois laisserait croire à une mesure continue.
 */
function tracerSerie(
  ctx: CanvasRenderingContext2D,
  serie: Serie,
  domaine: Domaine,
  enX: (j: Jour) => number,
  enY: (v: number) => number,
  couleur: string,
  epaisseur: number,
  alpha: number,
): void {
  const { debut, fin } = indicesVisibles(serie, (p) => jourVersIndex(p.j), domaine)
  if (fin <= debut) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = couleur
  ctx.lineWidth = epaisseur
  ctx.lineJoin = 'round'
  ctx.beginPath()
  let commence = false
  let indexPrecedent = -Infinity
  for (let i = debut; i <= fin; i++) {
    const p = serie[i]!
    const idx = jourVersIndex(p.j)
    if (!commence || idx - indexPrecedent > 7) {
      ctx.moveTo(enX(p.j), enY(p.v))
      commence = true
    } else {
      ctx.lineTo(enX(p.j), enY(p.v))
    }
    indexPrecedent = idx
  }
  ctx.stroke()
  ctx.restore()
}

function formaterNombreAxe(v: number): string {
  if (Math.abs(v) >= 10000) return `${Math.round(v / 1000)}k`
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(Math.abs(v) < 10 ? 1 : 0)
}
