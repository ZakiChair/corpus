import { useEffect, useMemo, useRef, useState } from 'react'
import { BANDES_RATIO, bandeDuRatio, calculerCharge, monotonie } from '../analyse/charge'
import { AVERTISSEMENT } from '../analyse/lecture'
import { valeurAuJour } from '../analyse/stats'
import { useEtat } from '../core/hooks'
import { serie as lireSerie, serieAnalyse } from '../core/series'
import {
  formaterJourCourt,
  formaterJourLong,
  indexVersJour,
  jourVersIndex,
  type Jour,
} from '../core/temps'
import {
  avecMarge,
  domainePourPreset,
  graduations,
  indicesVisibles,
  pixelVersValeur,
  valeurVersPixel,
  type Domaine,
} from '../ui/domaineAxe'
import { lireJeton, preparerCanvas } from '../ui/jetonsCanvas'
import {
  usePointeurCanvas,
  useDomaineZoom,
  useRedessinSurRedimensionnement,
} from '../ui/useDomaineZoom'
import {
  BarrePeriodes,
  EnteteFenetre,
  Etiquette,
  InfobulleGraphe,
  PERIODES_STANDARD,
  PiedNote,
  Vide,
} from '../ui/ui'
import type { Serie } from '../core/types'

/**
 * Charge d'entraînement.
 *
 * Deux panneaux empilés partageant l'axe du temps : en haut le modèle de
 * Banister (aiguë, chronique, et leur écart), en bas le ratio aigu/chronique
 * avec ses bandes de lecture.
 */

const MARGE = { gauche: 46, droite: 10, haut: 10, bas: 30 }
const PART_HAUT = 0.66
const ESPACE_PANNEAUX = 16

export function Charge() {
  const etat = useEtat()
  const [preset, setPreset] = useState<string | null>('180j')

  const dense = useMemo(() => serieAnalyse(etat, 'charge_seance'), [etat])
  const charge = useMemo(() => calculerCharge(dense), [dense])
  const mono = useMemo(() => monotonie(dense), [dense])

  const bornes = useMemo<Domaine | null>(() => {
    if (dense.length < 2) return null
    return {
      min: jourVersIndex(dense[0]!.j),
      max: jourVersIndex(dense[dense.length - 1]!.j),
    }
  }, [dense])

  const { refCanvas, domaine, definirDomaine } = useDomaineZoom(bornes, () => setPreset(null))
  const pointeur = usePointeurCanvas(refCanvas)

  // Le préréglage affiché doit correspondre à ce qui est tracé, sinon la
  // barre annonce une période que le graphe ne montre pas.
  const refPreset = useRef(preset)
  refPreset.current = preset
  useEffect(() => {
    if (!bornes) return
    const p = PERIODES_STANDARD.find((x) => x.id === refPreset.current)
    if (p) definirDomaine(domainePourPreset(bornes, p.jours))
  }, [bornes?.min, bornes?.max, definirDomaine]) // eslint-disable-line react-hooks/exhaustive-deps

  const dessiner = useMemo(
    () => () => {
      const canvas = refCanvas.current
      if (!canvas || !domaine) return
      const prepare = preparerCanvas(canvas)
      if (!prepare) return
      const { ctx, largeur, hauteur } = prepare

      const l = largeur - MARGE.gauche - MARGE.droite
      const hTotal = hauteur - MARGE.haut - MARGE.bas - ESPACE_PANNEAUX
      if (l < 20 || hTotal < 60) return
      const hHaut = hTotal * PART_HAUT
      const hBas = hTotal - hHaut
      const yBas = MARGE.haut + hHaut + ESPACE_PANNEAUX

      const grille = lireJeton('--c-grille')
      const attenue = lireJeton('--c-attenue')
      const enX = (j: Jour) => MARGE.gauche + valeurVersPixel(domaine, jourVersIndex(j), l)

      /* — Panneau du haut : charge aiguë et chronique — */
      let maxCharge = 0
      for (const s of [charge.aigue, charge.chronique]) {
        const { debut, fin } = indicesVisibles(s, (p) => jourVersIndex(p.j), domaine)
        for (let i = debut; i <= fin; i++) maxCharge = Math.max(maxCharge, s[i]!.v)
      }
      const bornesHaut = avecMarge(0, Math.max(maxCharge, 1), 0.1)
      const enYHaut = (v: number) =>
        MARGE.haut + hHaut - ((v - bornesHaut.min) / (bornesHaut.max - bornesHaut.min)) * hHaut

      ctx.font = '10px ui-monospace, monospace'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'right'
      for (const g of graduations(bornesHaut.min, bornesHaut.max, 4)) {
        const y = enYHaut(g)
        if (y < MARGE.haut - 1 || y > MARGE.haut + hHaut + 1) continue
        ctx.strokeStyle = grille
        ctx.beginPath()
        ctx.moveTo(MARGE.gauche, Math.round(y) + 0.5)
        ctx.lineTo(MARGE.gauche + l, Math.round(y) + 0.5)
        ctx.stroke()
        ctx.fillStyle = attenue
        ctx.fillText(String(Math.round(g)), MARGE.gauche - 5, y)
      }

      // L'écart entre chronique et aiguë est peint : au-dessus de zéro la
      // fatigue récente est retombée, en dessous elle domine.
      remplirEcart(ctx, charge.chronique, charge.aigue, domaine, enX, enYHaut, {
        au_dessus: lireJeton('--c-favorable'),
        au_dessous: lireJeton('--c-defavorable'),
      })

      tracer(ctx, charge.chronique, domaine, enX, enYHaut, lireJeton('--c-serie5'), 1.5)
      tracer(ctx, charge.aigue, domaine, enX, enYHaut, lireJeton('--c-serie3'), 1.4)

      /* — Panneau du bas : ratio aigu/chronique — */
      const bornesBas = { min: 0.3, max: 2.0 }
      const enYBas = (v: number) =>
        yBas + hBas - ((v - bornesBas.min) / (bornesBas.max - bornesBas.min)) * hBas

      for (const bande of BANDES_RATIO) {
        const hautBande = Math.min(bande.max, bornesBas.max)
        const basBande = Math.max(bande.min, bornesBas.min)
        if (hautBande <= basBande) continue
        ctx.fillStyle = lireJeton(bande.jeton)
        ctx.globalAlpha = 0.09
        ctx.fillRect(MARGE.gauche, enYBas(hautBande), l, enYBas(basBande) - enYBas(hautBande))
        ctx.globalAlpha = 1
      }

      ctx.textAlign = 'right'
      for (const g of [0.5, 1.0, 1.5, 2.0]) {
        const y = enYBas(g)
        ctx.strokeStyle = grille
        ctx.beginPath()
        ctx.moveTo(MARGE.gauche, Math.round(y) + 0.5)
        ctx.lineTo(MARGE.gauche + l, Math.round(y) + 0.5)
        ctx.stroke()
        ctx.fillStyle = attenue
        ctx.fillText(g.toFixed(1), MARGE.gauche - 5, y)
      }
      tracer(ctx, charge.ratio, domaine, enX, enYBas, lireJeton('--c-accent'), 1.3)

      /* — Axe du temps, commun aux deux panneaux — */
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const nbLabels = Math.max(2, Math.min(8, Math.floor(l / 78)))
      for (let k = 0; k <= nbLabels; k++) {
        const idx = Math.round(domaine.min + ((domaine.max - domaine.min) * k) / nbLabels)
        const x = enX(indexVersJour(idx))
        ctx.strokeStyle = grille
        ctx.beginPath()
        ctx.moveTo(Math.round(x) + 0.5, MARGE.haut)
        ctx.lineTo(Math.round(x) + 0.5, MARGE.haut + hHaut)
        ctx.stroke()
        ctx.fillStyle = attenue
        ctx.fillText(formaterJourCourt(indexVersJour(idx)), x, yBas + hBas + 6)
      }

      // Zone d'amorçage : avant que la moyenne chronique ait vu 42 jours,
      // elle est encore dominée par son initialisation.
      if (charge.debutFiable) {
        const xFin = enX(charge.debutFiable)
        if (xFin > MARGE.gauche + 1) {
          ctx.fillStyle = lireJeton('--c-fond')
          ctx.globalAlpha = 0.55
          ctx.fillRect(MARGE.gauche, MARGE.haut, Math.min(xFin, MARGE.gauche + l) - MARGE.gauche, hHaut)
          ctx.globalAlpha = 1
          ctx.fillStyle = attenue
          ctx.textAlign = 'left'
          ctx.fillText('amorçage', MARGE.gauche + 4, MARGE.haut + 4)
        }
      }
    },
    [domaine, charge, refCanvas],
  )

  useEffect(() => {
    dessiner()
  }, [dessiner])
  useRedessinSurRedimensionnement(refCanvas, dessiner)

  const jourSurvole = useMemo(() => {
    if (!pointeur || !domaine) return null
    const canvas = refCanvas.current
    if (!canvas) return null
    const l = canvas.getBoundingClientRect().width - MARGE.gauche - MARGE.droite
    if (pointeur.x < MARGE.gauche || pointeur.x > MARGE.gauche + l) return null
    return indexVersJour(Math.round(pixelVersValeur(domaine, pointeur.x - MARGE.gauche, l)))
  }, [pointeur, domaine, refCanvas])

  if (lireSerie(etat, 'charge_seance').length < 3) {
    return (
      <Vide titre="Pas encore de charge d’entraînement.">
        Saisis une charge de séance dans <strong className="text-texte">SAIS</strong> — durée en
        minutes multipliée par l’intensité ressentie sur dix — ou génère un historique de
        démonstration depuis <strong className="text-texte">DONN</strong>.
      </Vide>
    )
  }

  const derniereAigue = charge.aigue[charge.aigue.length - 1]?.v
  const derniereChronique = charge.chronique[charge.chronique.length - 1]?.v
  const derniereForme = charge.forme[charge.forme.length - 1]?.v
  const dernierRatio = charge.ratio[charge.ratio.length - 1]?.v
  const derniereMono = mono[mono.length - 1]?.v
  const bande = dernierRatio !== undefined ? bandeDuRatio(dernierRatio) : undefined

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
      </EnteteFenetre>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-bord px-3 py-1.5 text-[11px]">
        <Statistique label="Aiguë 7 j" valeur={derniereAigue} jeton="--c-serie3" />
        <Statistique label="Chronique 42 j" valeur={derniereChronique} jeton="--c-serie5" />
        <Statistique
          label="Forme"
          valeur={derniereForme}
          jeton={derniereForme !== undefined && derniereForme >= 0 ? '--c-favorable' : '--c-defavorable'}
          signe
        />
        <span className="flex items-center gap-1.5">
          <span className="text-attenue">Ratio</span>
          <span className="tabular-nums text-texte">
            {dernierRatio === undefined ? '—' : dernierRatio.toFixed(2)}
          </span>
          {bande && <Etiquette jeton={bande.jeton}>{bande.label}</Etiquette>}
        </span>
        <Statistique label="Monotonie" valeur={derniereMono} decimales={2} />
      </div>

      <div className="relative min-h-0 flex-1">
        <canvas ref={refCanvas} className="h-full w-full cursor-crosshair" />
        {jourSurvole && pointeur && (
          <InfobulleGraphe
            xPix={pointeur.x}
            largeurGraphe={refCanvas.current?.getBoundingClientRect().width ?? 0}
            titre={formaterJourLong(jourSurvole)}
            lignes={[
              {
                label: 'Séance',
                valeur: formaterUA(valeurAuJour(dense, jourSurvole)),
              },
              {
                label: 'Aiguë',
                jeton: '--c-serie3',
                valeur: formaterUA(valeurAuJour(charge.aigue, jourSurvole)),
              },
              {
                label: 'Chronique',
                jeton: '--c-serie5',
                valeur: formaterUA(valeurAuJour(charge.chronique, jourSurvole)),
              },
              {
                label: 'Ratio',
                jeton: '--c-accent',
                valeur: valeurAuJour(charge.ratio, jourSurvole)?.toFixed(2) ?? '—',
              },
            ]}
          />
        )}
      </div>

      <PiedNote>
        Le ratio aigu/chronique est un indicateur contesté depuis 2019 : il situe ta charge par
        rapport à ton habitude, il ne prédit rien. {AVERTISSEMENT}
      </PiedNote>
    </div>
  )
}

function Statistique({
  label,
  valeur,
  jeton,
  decimales = 0,
  signe,
}: {
  label: string
  valeur: number | undefined
  jeton?: string
  decimales?: number
  signe?: boolean
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-attenue">{label}</span>
      <span className="tabular-nums" style={{ color: jeton ? `var(${jeton})` : 'var(--c-texte)' }}>
        {valeur === undefined
          ? '—'
          : `${signe && valeur > 0 ? '+' : ''}${valeur.toFixed(decimales)}`}
      </span>
    </span>
  )
}

function formaterUA(v: number | undefined): string {
  return v === undefined ? '—' : `${Math.round(v)} UA`
}

function tracer(
  ctx: CanvasRenderingContext2D,
  serie: Serie,
  domaine: Domaine,
  enX: (j: Jour) => number,
  enY: (v: number) => number,
  couleur: string,
  epaisseur: number,
): void {
  const { debut, fin } = indicesVisibles(serie, (p) => jourVersIndex(p.j), domaine)
  if (fin <= debut) return
  ctx.strokeStyle = couleur
  ctx.lineWidth = epaisseur
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (let i = debut; i <= fin; i++) {
    const p = serie[i]!
    if (i === debut) ctx.moveTo(enX(p.j), enY(p.v))
    else ctx.lineTo(enX(p.j), enY(p.v))
  }
  ctx.stroke()
}

/** Peint la zone comprise entre deux séries, colorée selon leur ordre. */
function remplirEcart(
  ctx: CanvasRenderingContext2D,
  haute: Serie,
  basse: Serie,
  domaine: Domaine,
  enX: (j: Jour) => number,
  enY: (v: number) => number,
  couleurs: { au_dessus: string; au_dessous: string },
): void {
  const parJour = new Map(basse.map((p) => [p.j, p.v]))
  const { debut, fin } = indicesVisibles(haute, (p) => jourVersIndex(p.j), domaine)
  // Deux passes, une par signe : un seul chemin ne peut pas porter deux
  // couleurs, et alterner par segment produirait des artefacts aux croisements.
  for (const signe of [1, -1] as const) {
    ctx.beginPath()
    let ouvert = false
    for (let i = debut; i <= fin; i++) {
      const p = haute[i]!
      const b = parJour.get(p.j)
      if (b === undefined) continue
      const ecart = p.v - b
      const retenu = signe > 0 ? ecart >= 0 : ecart < 0
      if (!retenu) {
        if (ouvert) {
          ctx.lineTo(enX(p.j), enY(b))
          ctx.closePath()
          ouvert = false
        }
        continue
      }
      if (!ouvert) {
        ctx.moveTo(enX(p.j), enY(b))
        ouvert = true
      }
      ctx.lineTo(enX(p.j), enY(p.v))
    }
    if (ouvert) ctx.closePath()
    ctx.fillStyle = signe > 0 ? couleurs.au_dessus : couleurs.au_dessous
    ctx.globalAlpha = 0.13
    ctx.fill()
    ctx.globalAlpha = 1
  }
}
