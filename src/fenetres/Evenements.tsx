import { useEffect, useMemo, useState } from 'react'
import { etudeEvenement, picReponse, type ReponseEvenement } from '../analyse/evenement'
import { AVERTISSEMENT } from '../analyse/lecture'
import { useEtat } from '../core/hooks'
import { definitionOuGenerique, formaterValeur } from '../core/metriques'
import { joursDuType, serie as lireSerie, seriesRenseignees, typesPresents } from '../core/series'
import { LIBELLES_ANNOTATION, type TypeAnnotation } from '../core/types'
import { avecMarge, graduations } from '../ui/domaineAxe'
import { hexVersRgb, lireJeton, preparerCanvas } from '../ui/jetonsCanvas'
import { useRedessinSurRedimensionnement, useRefCanvas } from '../ui/useDomaineZoom'
import { useThemeCanvas } from '../ui/useThemeCanvas'
import { EnteteFenetre, PiedNote, Selecteur, Vide } from '../ui/ui'

/**
 * Étude d'événement — l'outil transposé de la finance.
 *
 * On empile les fenêtres autour de chaque occurrence d'un événement, on
 * retranche à chacune sa propre ligne de base (les jours qui la précèdent),
 * puis on moyenne. Il ne reste que l'écart imputable à l'événement, débarrassé
 * du niveau et de la dérive saisonnière.
 *
 * La bande grise est l'intervalle de confiance à 95 %. Là où elle contient
 * zéro, l'écart n'est pas distinguable du bruit — et c'est le cas le plus
 * fréquent, ce qui est une information en soi.
 */

const MARGE = { gauche: 52, droite: 12, haut: 14, bas: 30 }

export function Evenements() {
  const etat = useEtat()
  const theme = useThemeCanvas()
  const { refCanvas, canvas } = useRefCanvas()

  const types = useMemo(() => typesPresents(etat), [etat])
  const metriques = useMemo(
    () => seriesRenseignees(etat).filter((id) => (etat.series[id]?.length ?? 0) >= 25),
    [etat],
  )

  const [type, setType] = useState<TypeAnnotation | ''>('')
  const [metrique, setMetrique] = useState('')
  const [intensiteMin, setIntensiteMin] = useState(0)

  // Sélection initiale : le type le plus fréquent et une métrique de récupération.
  useEffect(() => {
    if (type === '' && types.length > 0) setType(types[0]!.type)
  }, [types, type])
  useEffect(() => {
    if (metrique === '' && metriques.length > 0) {
      setMetrique(['vfc', 'fc_repos', 'sommeil_duree'].find((id) => metriques.includes(id)) ?? metriques[0]!)
    }
  }, [metriques, metrique])

  const jours = useMemo(
    () => (type === '' ? [] : joursDuType(etat, type, intensiteMin)),
    [etat, type, intensiteMin],
  )
  const serie = useMemo(() => (metrique === '' ? [] : lireSerie(etat, metrique)), [etat, metrique])

  const reponse = useMemo<ReponseEvenement | null>(() => {
    if (jours.length === 0 || serie.length === 0) return null
    return etudeEvenement(serie, jours, { avant: 4, apres: 7 })
  }, [serie, jours])

  const dessiner = useMemo(
    () => () => {
      const canvas = refCanvas.current
      if (!canvas || !reponse) return
      const prepare = preparerCanvas(canvas)
      if (!prepare) return
      const { ctx, largeur, hauteur } = prepare
      const l = largeur - MARGE.gauche - MARGE.droite
      const h = hauteur - MARGE.haut - MARGE.bas
      if (l < 40 || h < 40) return

      const grille = lireJeton('--c-grille')
      const attenue = lireJeton('--c-attenue')
      const accent = lireJeton('--c-accent')
      const rgbAccent = hexVersRgb(accent)

      // Échelle verticale : elle doit contenir la courbe ET sa bande.
      let min = 0
      let max = 0
      reponse.moyenne.forEach((m, k) => {
        if (m === undefined) return
        const ic = reponse.demiIC[k] ?? 0
        min = Math.min(min, m - ic)
        max = Math.max(max, m + ic)
      })
      const bornesY = avecMarge(min, max, 0.15)
      const n = reponse.decalages.length
      const enX = (k: number) => MARGE.gauche + (k / Math.max(1, n - 1)) * l
      const enY = (v: number) =>
        MARGE.haut + h - ((v - bornesY.min) / (bornesY.max - bornesY.min)) * h

      ctx.font = '10px ui-monospace, monospace'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'right'
      for (const g of graduations(bornesY.min, bornesY.max, 5)) {
        const y = enY(g)
        if (y < MARGE.haut - 1 || y > MARGE.haut + h + 1) continue
        ctx.strokeStyle = grille
        ctx.beginPath()
        ctx.moveTo(MARGE.gauche, Math.round(y) + 0.5)
        ctx.lineTo(MARGE.gauche + l, Math.round(y) + 0.5)
        ctx.stroke()
        ctx.fillStyle = attenue
        ctx.fillText(`${g > 0 ? '+' : ''}${formaterAxe(g)}`, MARGE.gauche - 5, y)
      }

      // Ligne de base à zéro : c'est la référence de toute la lecture.
      ctx.strokeStyle = lireJeton('--c-bord')
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(MARGE.gauche, Math.round(enY(0)) + 0.5)
      ctx.lineTo(MARGE.gauche + l, Math.round(enY(0)) + 0.5)
      ctx.stroke()

      // Repère vertical de l'instant de l'événement.
      const kZero = reponse.decalages.indexOf(0)
      if (kZero >= 0) {
        ctx.strokeStyle = attenue
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(Math.round(enX(kZero)) + 0.5, MARGE.haut)
        ctx.lineTo(Math.round(enX(kZero)) + 0.5, MARGE.haut + h)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // Bande de confiance à 95 %.
      if (rgbAccent) {
        ctx.beginPath()
        let ouvert = false
        for (let k = 0; k < n; k++) {
          const m = reponse.moyenne[k]
          const ic = reponse.demiIC[k]
          if (m === undefined || ic === undefined) continue
          if (!ouvert) {
            ctx.moveTo(enX(k), enY(m + ic))
            ouvert = true
          } else ctx.lineTo(enX(k), enY(m + ic))
        }
        for (let k = n - 1; k >= 0; k--) {
          const m = reponse.moyenne[k]
          const ic = reponse.demiIC[k]
          if (m === undefined || ic === undefined) continue
          ctx.lineTo(enX(k), enY(m - ic))
        }
        ctx.closePath()
        ctx.fillStyle = `rgba(${rgbAccent.r}, ${rgbAccent.v}, ${rgbAccent.b}, 0.16)`
        ctx.fill()
      }

      // Courbe de réponse.
      ctx.strokeStyle = accent
      ctx.lineWidth = 1.8
      ctx.lineJoin = 'round'
      ctx.beginPath()
      let commence = false
      for (let k = 0; k < n; k++) {
        const m = reponse.moyenne[k]
        if (m === undefined) continue
        if (!commence) {
          ctx.moveTo(enX(k), enY(m))
          commence = true
        } else ctx.lineTo(enX(k), enY(m))
      }
      ctx.stroke()

      // Points, pleins là où l'intervalle exclut zéro.
      for (let k = 0; k < n; k++) {
        const m = reponse.moyenne[k]
        const ic = reponse.demiIC[k]
        if (m === undefined) continue
        const significatif = ic !== undefined && Math.abs(m) > ic
        ctx.beginPath()
        ctx.arc(enX(k), enY(m), significatif ? 3.2 : 2.2, 0, Math.PI * 2)
        ctx.fillStyle = significatif ? accent : lireJeton('--c-fond')
        ctx.fill()
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.2
        ctx.stroke()
      }

      // Axe des décalages.
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = attenue
      for (let k = 0; k < n; k++) {
        const d = reponse.decalages[k]!
        ctx.fillStyle = d === 0 ? lireJeton('--c-texte') : attenue
        ctx.fillText(d === 0 ? 'J' : `${d > 0 ? '+' : ''}${d}`, enX(k), MARGE.haut + h + 8)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `theme` force le redessin au changement de thème
    [reponse, refCanvas, theme],
  )

  useEffect(() => {
    dessiner()
  }, [dessiner])
  useRedessinSurRedimensionnement(canvas, dessiner)

  if (types.length === 0 || metriques.length === 0) {
    return (
      <Vide titre="Il faut des événements datés et une série à étudier.">
        Ajoute des événements dans <strong className="text-texte">ANNO</strong>, ou génère un
        historique de démonstration depuis <strong className="text-texte">DONN</strong>.
      </Vide>
    )
  }

  const pic = reponse ? picReponse(reponse) : undefined
  const unite = metrique ? definitionOuGenerique(metrique).unite : ''

  return (
    <div className="flex h-full flex-col">
      <EnteteFenetre>
        <Selecteur
          valeur={type}
          options={types.map((t) => ({
            valeur: t.type,
            label: `${LIBELLES_ANNOTATION[t.type]} (${t.n})`,
          }))}
          onChange={(v) => setType(v as TypeAnnotation)}
          label="Événement"
        />
        <Selecteur
          valeur={metrique}
          options={metriques.map((id) => ({ valeur: id, label: definitionOuGenerique(id).label }))}
          onChange={setMetrique}
          label="Effet sur"
        />
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-attenue">Intensité ≥</span>
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.05}
            value={intensiteMin}
            onChange={(e) => setIntensiteMin(Number(e.target.value))}
            className="w-20 accent-[var(--c-accent)]"
          />
          <span className="w-7 tabular-nums text-[11px] text-attenue">
            {intensiteMin.toFixed(2)}
          </span>
        </label>
      </EnteteFenetre>

      {reponse && (
        <div className="shrink-0 border-b border-bord px-3 py-1.5 text-[11px]">
          {reponse.nEvenements < 5 ? (
            <span className="text-alerte">
              Seulement {reponse.nEvenements} occurrence{reponse.nEvenements > 1 ? 's' : ''}{' '}
              exploitable{reponse.nEvenements > 1 ? 's' : ''} : la moyenne ne veut pas dire
              grand-chose.
            </span>
          ) : pic && Math.abs(pic.ecart) > (reponse.demiIC[reponse.decalages.indexOf(pic.decalage)] ?? Infinity) ? (
            <span className="text-texte">
              Sur {reponse.nEvenements} occurrences, l’écart le plus net tombe à{' '}
              <strong className="text-accent">
                J{pic.decalage > 0 ? `+${pic.decalage}` : pic.decalage}
              </strong>{' '}
              :{' '}
              <strong style={{ color: pic.ecart >= 0 ? 'var(--c-favorable)' : 'var(--c-defavorable)' }}>
                {pic.ecart >= 0 ? '+' : '−'}
                {formaterValeur(metrique, Math.abs(pic.ecart))}
              </strong>{' '}
              par rapport aux jours qui précèdent.
            </span>
          ) : (
            <span className="text-attenue">
              Sur {reponse.nEvenements} occurrences, aucun écart ne se distingue du bruit.
            </span>
          )}
          {reponse.nContamines > 0 && (
            <span className="ml-2 text-attenue">
              Ligne de base contaminée pour {reponse.nContamines} occurrence
              {reponse.nContamines > 1 ? 's' : ''} (événements trop rapprochés).
            </span>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {reponse ? (
          <canvas ref={refCanvas} className="h-full w-full" />
        ) : (
          <Vide titre="Aucune occurrence à ce seuil d’intensité." />
        )}
      </div>

      <PiedNote>
        Écart {unite ? `en ${unite} ` : ''}à la moyenne des quatre jours précédant chaque
        occurrence ; bande = intervalle de confiance à 95 %. Point plein quand l’intervalle exclut
        zéro. Les jours suivant de près une autre occurrence sont exclus de la ligne de base ;
        quand les occurrences sont trop denses pour qu'il en reste, la base contaminée est
        utilisée et signalée. Monter le seuil d’intensité ne retient que les occurrences les plus
        marquées et donne souvent une lecture plus nette. {AVERTISSEMENT}
      </PiedNote>
    </div>
  )
}

function formaterAxe(v: number): string {
  if (Math.abs(v) >= 100) return String(Math.round(v))
  if (Math.abs(v) >= 10) return v.toFixed(1)
  return v.toFixed(2)
}
