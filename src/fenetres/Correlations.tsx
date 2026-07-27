import { useEffect, useMemo, useRef, useState } from 'react'
import {
  matriceCorrelation,
  meilleurDecalage,
  seuilSignificativite,
  type Methode,
} from '../analyse/correlation'
import { AVERTISSEMENT } from '../analyse/lecture'
import { useEtat, useMemoRefs } from '../core/hooks'
import { definitionOuGenerique } from '../core/metriques'
import { serieAnalyse, seriesRenseignees } from '../core/series'
import type { Serie } from '../core/types'
import { storeIntentions } from '../shell/intentions'
import { hexVersRgb, lireJeton, preparerCanvas } from '../ui/jetonsCanvas'
import { usePointeurCanvas, useRedessinSurRedimensionnement } from '../ui/useDomaineZoom'
import { useThemeCanvas } from '../ui/useThemeCanvas'
import { EnteteFenetre, PiedNote, Segments, Vide } from '../ui/ui'

/**
 * Matrice de corrélation décalée.
 *
 * La lecture est DIRECTIONNELLE : la case (ligne i, colonne j) au décalage d
 * répond à « la métrique de la ligne i, avancée de d jours, est-elle liée à
 * celle de la colonne j ? ». Un décalage positif teste donc l'hypothèse que la
 * ligne précède la colonne — la seule façon d'orienter une relation sans
 * expérimentation.
 *
 * Deux garde-fous tiennent le cadre : les cases sous le seuil de
 * significativité sont éteintes, et le pied de fenêtre rappelle qu'inspecter
 * deux cents cases fait forcément ressortir du hasard.
 */

const MARGE = { gauche: 82, haut: 74, droite: 8, bas: 8 }
const POINTS_MINIMUM = 25
const PAIRES_MINIMUM = 20
/** Largeur de cellule en deçà de laquelle les étiquettes passent à la verticale. */
const SEUIL_ETIQUETTES_OBLIQUES = 44

export function Correlations() {
  const etat = useEtat()
  const theme = useThemeCanvas()
  const [decalage, setDecalage] = useState(0)
  const [methode, setMethode] = useState<Methode>('spearman')
  const refCanvas = useRef<HTMLCanvasElement>(null)
  const pointeur = usePointeurCanvas(refCanvas)

  const idsCalcules = useMemo(
    // Une corrélation sur une douzaine de points n'apprend rien et encombre.
    () => seriesRenseignees(etat).filter((id) => (etat.series[id]?.length ?? 0) >= POINTS_MINIMUM),
    [etat],
  )
  // Identité stable tant que la LISTE ne change pas : la matrice (210 paires
  // de Spearman) ne doit pas se recalculer à chaque frappe dans SAIS.
  const ids = useMemoRefs(() => idsCalcules, [idsCalcules.join('|')])

  const series = useMemoRefs(() => {
    const out: Record<string, Serie> = {}
    for (const id of ids) out[id] = serieAnalyse(etat, id)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, ...ids.map((id) => etat.series[id])])

  const matrice = useMemo(
    () => matriceCorrelation(series, ids, decalage, methode),
    [series, ids, decalage, methode],
  )

  const meilleurs = useMemo(() => {
    const paires: { a: string; b: string; r: number; decalage: number; n: number }[] = []
    for (const idA of ids) {
      for (const idB of ids) {
        if (idA === idB) continue
        const a = series[idA]
        const b = series[idB]
        if (!a || !b) continue
        const c = meilleurDecalage(a, b, 5, methode, 30)
        if (!c) continue
        // Seul le sens « a précède b » est listé : sinon chaque relation
        // apparaîtrait deux fois, sous ses deux orientations. Au décalage nul
        // il n'y a pas de sens du tout, l'ordre alphabétique tranche.
        if (c.decalage < 0) continue
        if (c.decalage === 0 && idA >= idB) continue
        // Le seuil se calcule sur le n EFFECTIF : sur des séries lentes
        // (poids, masse grasse), le n brut laisserait passer des corrélations
        // de tendance commune comme des découvertes.
        if (Math.abs(c.r) < seuilSignificativite(c.nEffectif) * 2.2) continue
        paires.push({ a: idA, b: idB, r: c.r, decalage: c.decalage, n: c.n })
      }
    }
    return paires.sort((x, y) => Math.abs(y.r) - Math.abs(x.r)).slice(0, 8)
  }, [series, ids, methode])

  const dessiner = useMemo(
    () => () => {
      const canvas = refCanvas.current
      if (!canvas) return
      const prepare = preparerCanvas(canvas)
      if (!prepare) return
      const { ctx, largeur, hauteur } = prepare
      const n = ids.length
      if (n === 0) return

      const dispo = Math.min(
        largeur - MARGE.gauche - MARGE.droite,
        hauteur - MARGE.haut - MARGE.bas,
      )
      if (dispo < 40) return
      const cote = dispo / n
      // La matrice est carrée : quand la fenêtre est plus large que haute, on
      // la centre au lieu de la coller à gauche avec un grand vide à droite.
      const x0 = MARGE.gauche + Math.max(0, (largeur - MARGE.gauche - MARGE.droite - dispo) / 2)

      const fond = lireJeton('--c-fond')
      const attenue = lireJeton('--c-attenue')
      // Échelle divergente NEUTRE : une corrélation négative n'est pas
      // « mauvaise », colorer en rouge et vert induirait un jugement.
      const positif = hexVersRgb(lireJeton('--c-accent'))
      const negatif = hexVersRgb(lireJeton('--c-serie4'))

      // La police suit la taille des cellules : 9 px fixes deviennent
      // illisibles dès que la matrice se resserre.
      const taillePolice = Math.max(7, Math.min(10, cote * 0.62))
      ctx.font = `${taillePolice.toFixed(1)}px ui-monospace, monospace`

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const r = matrice.valeurs[i]?.[j]
          const nb = matrice.effectifs[i]?.[j] ?? 0
          const x = x0 + j * cote
          const y = MARGE.haut + i * cote

          if (r === undefined || nb < PAIRES_MINIMUM) {
            ctx.fillStyle = fond
            ctx.fillRect(x, y, cote - 1, cote - 1)
            continue
          }
          const significatif =
            Math.abs(r) >= seuilSignificativite(matrice.nEffectifs[i]?.[j] ?? 0)
          const rgb = r >= 0 ? positif : negatif
          const intensite = Math.min(1, Math.abs(r)) * (significatif ? 1 : 0.22)
          ctx.fillStyle = rgb
            ? `rgba(${rgb.r}, ${rgb.v}, ${rgb.b}, ${(intensite * 0.92).toFixed(3)})`
            : fond
          ctx.fillRect(x, y, cote - 1, cote - 1)

          if (cote > 26) {
            ctx.fillStyle = intensite > 0.55 ? fond : attenue
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(r.toFixed(2).replace('0.', '.'), x + cote / 2 - 0.5, y + cote / 2)
          }
        }
      }

      /*
       * Étiquettes. L'angle des colonnes n'est pas décoratif : à 45°,
       * l'empreinte HORIZONTALE d'une étiquette vaut largeur_texte × cos(45°),
       * soit environ 42 px — il faut donc des cellules d'au moins cette
       * largeur. À 90°, l'empreinte se réduit à la HAUTEUR du texte, une
       * dizaine de pixels, et tient dans n'importe quelle cellule. On bascule
       * donc selon la place, plutôt que de figer un compromis mauvais aux
       * deux extrêmes.
       */
      ctx.fillStyle = attenue
      const angle = cote >= SEUIL_ETIQUETTES_OBLIQUES ? -Math.PI / 4 : -Math.PI / 2
      // Sous une certaine hauteur de cellule, les lignes se chevauchent aussi :
      // on n'en étiquette qu'une sur deux.
      const pasEtiquette = cote >= taillePolice + 3 ? 1 : 2

      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < n; i += pasEtiquette) {
        ctx.fillText(
          definitionOuGenerique(ids[i]!).abrege,
          MARGE.gauche - 5,
          MARGE.haut + i * cote + cote / 2,
        )
      }
      for (let j = 0; j < n; j += pasEtiquette) {
        ctx.save()
        ctx.translate(x0 + j * cote + cote / 2, MARGE.haut - 5)
        ctx.rotate(angle)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(definitionOuGenerique(ids[j]!).abrege, 0, 0)
        ctx.restore()
      }
    },
    [ids, matrice, theme],
  )

  useEffect(() => {
    dessiner()
  }, [dessiner])
  useRedessinSurRedimensionnement(refCanvas, dessiner)

  const survol = useMemo(() => {
    const canvas = refCanvas.current
    if (!pointeur || !canvas || ids.length === 0) return null
    const rect = canvas.getBoundingClientRect()
    const dispo = Math.min(
      rect.width - MARGE.gauche - MARGE.droite,
      rect.height - MARGE.haut - MARGE.bas,
    )
    const cote = dispo / ids.length
    // Même centrage qu'au dessin, sinon le survol vise à côté.
    const x0 = MARGE.gauche + Math.max(0, (rect.width - MARGE.gauche - MARGE.droite - dispo) / 2)
    const j = Math.floor((pointeur.x - x0) / cote)
    const i = Math.floor((pointeur.y - MARGE.haut) / cote)
    if (i < 0 || j < 0 || i >= ids.length || j >= ids.length) return null
    return { i, j, r: matrice.valeurs[i]?.[j], n: matrice.effectifs[i]?.[j] ?? 0 }
  }, [pointeur, ids, matrice])

  if (ids.length < 2) {
    return (
      <Vide titre={`Il faut au moins deux séries de ${POINTS_MINIMUM} points.`}>
        Génère un historique de démonstration depuis <strong className="text-texte">DONN</strong>{' '}
        pour voir la matrice à l’œuvre.
      </Vide>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <EnteteFenetre>
        <label className="flex items-center gap-2">
          <span className="text-[11px] text-attenue">Décalage</span>
          <input
            type="range"
            min={-7}
            max={7}
            step={1}
            value={decalage}
            onChange={(e) => setDecalage(Number(e.target.value))}
            className="w-28 accent-[var(--c-accent)]"
          />
          <span className="w-10 tabular-nums text-[11px] text-texte">
            {decalage > 0 ? '+' : ''}
            {decalage} j
          </span>
        </label>
        <Segments
          valeur={methode}
          options={[
            { valeur: 'spearman', label: 'Rangs' },
            { valeur: 'pearson', label: 'Linéaire' },
          ]}
          onChange={setMethode}
        />
        <span className="ml-auto text-[10px] text-attenue">
          {decalage === 0
            ? 'ligne et colonne le même jour'
            : decalage > 0
              ? `ligne, puis colonne ${decalage} j plus tard`
              : `ligne, puis colonne ${-decalage} j plus tôt`}
        </span>
      </EnteteFenetre>

      <div className="relative min-h-0 flex-[3]">
        <canvas ref={refCanvas} className="h-full w-full" />
        {survol?.r !== undefined && (
          <div className="pointer-events-none absolute bottom-1 left-2 rounded border border-bord bg-elevee/95 px-2 py-1 text-[11px] shadow-lg">
            <span className="text-texte">{definitionOuGenerique(ids[survol.i]!).label}</span>
            <span className="text-attenue">
              {decalage === 0 ? ' ~ ' : ` → ${decalage > 0 ? '+' : ''}${decalage} j → `}
            </span>
            <span className="text-texte">{definitionOuGenerique(ids[survol.j]!).label}</span>
            <span className="ml-2 tabular-nums text-accent">r = {survol.r.toFixed(3)}</span>
            <span className="ml-1.5 text-attenue">n = {survol.n}</span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-[2] overflow-auto border-t border-bord px-3 py-2">
        <h3 className="mb-1 text-[10px] uppercase tracking-[0.15em] text-attenue">
          Relations les plus marquées, au décalage qui les maximise
        </h3>
        {meilleurs.length === 0 ? (
          <p className="text-[11px] text-attenue">
            Aucune relation ne ressort nettement du bruit sur cet historique.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {meilleurs.map((p, i) => (
              <li key={i}>
                <button
                  type="button"
                  title="Tracer les deux séries dans SERI"
                  onClick={() => storeIntentions.getState().demanderSeries({ ids: [p.a, p.b] })}
                  className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-bord/40"
                >
                  <span
                    className="w-12 shrink-0 tabular-nums"
                    style={{ color: p.r >= 0 ? 'var(--c-accent)' : 'var(--c-serie4)' }}
                  >
                    {p.r >= 0 ? '+' : ''}
                    {p.r.toFixed(2)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-texte">
                    {definitionOuGenerique(p.a).label}
                    <span className="text-attenue">
                      {p.decalage === 0 ? ' le même jour que ' : ` précède de ${p.decalage} j `}
                    </span>
                    {definitionOuGenerique(p.b).label}
                  </span>
                  <span className="shrink-0 text-[10px] text-attenue">n = {p.n}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PiedNote>
        Une corrélation n’est pas une causalité, et inspecter {ids.length * ids.length} cases à la
        fois en fait ressortir quelques-unes par pur hasard. Les cases sous le seuil de
        significativité sont volontairement éteintes. {AVERTISSEMENT}
      </PiedNote>
    </div>
  )
}
