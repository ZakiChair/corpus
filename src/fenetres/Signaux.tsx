import { useMemo } from 'react'
import { bandeDuRatio, calculerCharge, monotonie } from '../analyse/charge'
import { AVERTISSEMENT, lireEcart } from '../analyse/lecture'
import { bandeDuRegime, calculerRegime, contributionDominante } from '../analyse/regime'
import { ruptureRecente } from '../analyse/ruptures'
import { rangPercentile, zScoreGlissant } from '../analyse/stats'
import { useEtat } from '../core/hooks'
import { definitionOuGenerique, formaterValeur } from '../core/metriques'
import { serie as lireSerie, serieAnalyse, seriesRenseignees } from '../core/series'
import { formaterJourCourt, type Jour } from '../core/temps'
import { storeFenetres } from '../shell/gestionnaireFenetres'
import { storeIntentions } from '../shell/intentions'
import { EnteteFenetre, Etiquette, PiedNote, Vide } from '../ui/ui'

/**
 * Signaux : ce qui est inhabituel en ce moment, en une liste.
 *
 * L'outil renverse la charge de la navigation : au lieu d'ouvrir six fenêtres
 * pour savoir si quelque chose mérite attention, on ouvre celle-ci — et chaque
 * ligne conduit à la fenêtre qui permet de creuser. Les détecteurs sont ceux
 * des autres fenêtres (z-score, rang, ruptures, monotonie, ratio, régime) :
 * SIGN n'invente aucune statistique, elle les rassemble.
 */

interface Signal {
  niveau: 'alerte' | 'info'
  titre: string
  detail: string
  /** Métrique à ouvrir dans SERI au clic ; absente = ouvrir BLAN. */
  metrique?: string
  jour?: Jour
}

const POINTS_MINIMUM = 30

export function Signaux() {
  const etat = useEtat()

  const signaux = useMemo<Signal[]>(() => {
    const out: Signal[] = []

    /* — État composite — */
    const regime = calculerRegime(etat.series)
    const dernierRegime = regime.serie[regime.serie.length - 1]
    if (dernierRegime && Math.abs(dernierRegime.v) >= 1) {
      const dominante = contributionDominante(regime, dernierRegime.j)
      out.push({
        niveau: dernierRegime.v < 0 ? 'alerte' : 'info',
        titre: `État composite ${bandeDuRegime(dernierRegime.v).label.toLowerCase()}`,
        detail: `${dernierRegime.v >= 0 ? '+' : ''}${dernierRegime.v.toFixed(2)} σ${
          dominante ? ` — ${definitionOuGenerique(dominante.id).label} en tête` : ''
        }`,
        jour: dernierRegime.j,
      })
    }

    /* — Par métrique : écart, record, rupture — */
    for (const id of seriesRenseignees(etat)) {
      const s = lireSerie(etat, id)
      if (s.length < POINTS_MINIMUM) continue
      const def = definitionOuGenerique(id)
      const dernier = s[s.length - 1]!

      const zs = zScoreGlissant(s, 30)
      const z = zs[zs.length - 1]
      if (z && z.j === dernier.j && Math.abs(z.v) >= 2) {
        const defavorable =
          def.sens !== 'neutre' && (z.v < 0) === (def.sens === 'haut')
        out.push({
          niveau: defavorable ? 'alerte' : 'info',
          titre: `${def.label} : ${lireEcart(z.v)}`,
          detail: `${formaterValeur(id, dernier.v)} le ${formaterJourCourt(dernier.j)}`,
          metrique: id,
          jour: dernier.j,
        })
      }

      const rang = rangPercentile(s.map((p) => p.v), dernier.v)
      if (rang <= 0.02 || rang >= 0.98) {
        out.push({
          niveau: 'info',
          titre: `${def.label} : record ${rang >= 0.98 ? 'haut' : 'bas'} de l'historique`,
          detail: `${formaterValeur(id, dernier.v)} le ${formaterJourCourt(dernier.j)}`,
          metrique: id,
          jour: dernier.j,
        })
      }

      const rupture = ruptureRecente(s, 21)
      if (rupture) {
        out.push({
          niveau: 'info',
          titre: `${def.label} : changement de palier`,
          detail: `${formaterValeur(id, rupture.avant)} → ${formaterValeur(id, rupture.apres)}, autour du ${formaterJourCourt(rupture.jour)}`,
          metrique: id,
          jour: rupture.jour,
        })
      }
    }

    /* — Charge d'entraînement — */
    const dense = serieAnalyse(etat, 'charge_seance')
    if (dense.length >= POINTS_MINIMUM) {
      const mono = monotonie(dense)
      const derniereMono = mono[mono.length - 1]
      if (derniereMono && derniereMono.v > 2) {
        out.push({
          niveau: 'info',
          titre: 'Entraînement très uniforme',
          detail: `Monotonie à ${derniereMono.v.toFixed(2)} sur 7 jours — peu d'alternance dur / facile`,
          metrique: 'charge_seance',
          jour: derniereMono.j,
        })
      }
      const ratio = calculerCharge(dense).ratio
      const dernierRatio = ratio[ratio.length - 1]
      if (dernierRatio && (dernierRatio.v >= 1.5 || dernierRatio.v < 0.8)) {
        out.push({
          niveau: 'info',
          titre: `Charge ${bandeDuRatio(dernierRatio.v).label}`,
          detail: `Ratio aigu/chronique à ${dernierRatio.v.toFixed(2)}`,
          metrique: 'charge_seance',
          jour: dernierRatio.j,
        })
      }
    }

    // Les alertes d'abord ; à niveau égal, l'ordre de détection suffit.
    return out.sort((a, b) => (a.niveau === b.niveau ? 0 : a.niveau === 'alerte' ? -1 : 1))
  }, [etat])

  const ouvrirSignal = (s: Signal) => {
    if (s.metrique) {
      storeIntentions.getState().demanderSeries({ ids: [s.metrique], centreJour: s.jour })
    } else {
      storeFenetres.getState().ouvrir('bilan')
    }
  }

  if (Object.keys(etat.series).length === 0) {
    return (
      <Vide titre="Aucune donnée à surveiller.">
        Génère un historique de démonstration depuis <strong className="text-texte">DONN</strong>{' '}
        ou importe tes données.
      </Vide>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <EnteteFenetre>
        <span className="text-[11px] text-attenue">
          {signaux.length === 0
            ? 'Rien d’inhabituel'
            : `${signaux.length} signal${signaux.length > 1 ? 'aux' : ''}`}
        </span>
        <span className="ml-auto text-[10px] text-attenue">au dernier jour mesuré</span>
      </EnteteFenetre>

      <div className="min-h-0 flex-1 overflow-auto">
        {signaux.length === 0 ? (
          <Vide titre="Rien d’inhabituel sur les derniers jours mesurés.">
            Les écarts à plus de 2 σ, records, changements de palier et charges hors habitude
            apparaîtront ici.
          </Vide>
        ) : (
          <ul>
            {signaux.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => ouvrirSignal(s)}
                  title={s.metrique ? 'Ouvrir dans SERI' : 'Ouvrir le bilan'}
                  className="flex w-full items-baseline gap-2 border-b border-bord/40 px-3 py-2 text-left transition-colors hover:bg-bord/30"
                >
                  <Etiquette jeton={s.niveau === 'alerte' ? '--c-defavorable' : '--c-accent'}>
                    {s.niveau === 'alerte' ? 'alerte' : 'info'}
                  </Etiquette>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-texte">{s.titre}</span>
                    <span className="block text-[10px] leading-snug text-attenue">{s.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PiedNote>
        Un signal situe une valeur dans ton historique, il ne dit pas quoi faire. Sur une
        quinzaine de métriques, un écart à 2 σ par pur hasard est attendu régulièrement.{' '}
        {AVERTISSEMENT}
      </PiedNote>
    </div>
  )
}
