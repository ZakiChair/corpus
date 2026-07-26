import { useEffect, useMemo, useState } from 'react'
import { comparerEchantillons } from '../analyse/comparaison'
import { AVERTISSEMENT } from '../analyse/lecture'
import { quantile, valeurAuJour } from '../analyse/stats'
import { useEtat } from '../core/hooks'
import { definitionOuGenerique, formaterValeur } from '../core/metriques'
import { serieAnalyse, seriesRenseignees } from '../core/series'
import { decalerJour } from '../core/temps'
import { storeIntentions } from '../shell/intentions'
import { EnteteFenetre, PiedNote, Segments, Selecteur, Vide } from '../ui/ui'

/**
 * Hypothèses conditionnelles — l'étude d'événement généralisée aux conditions
 * continues : « les jours où je dors dans mon quart bas, mon énergie du
 * lendemain est-elle différente ? »
 *
 * Deux garde-fous tiennent la fenêtre : l'effectif du groupe conditionnel est
 * toujours affiché (un « effet » sur neuf jours n'apprend rien), et l'écart
 * n'est déclaré que si son intervalle bootstrap exclut zéro.
 */

const CONDITIONS = [
  { valeur: 'basP25', label: 'dans son quart bas (≤ P25)', q: 0.25, sens: 'bas' },
  { valeur: 'hautP75', label: 'dans son quart haut (≥ P75)', q: 0.75, sens: 'haut' },
  { valeur: 'basP10', label: 'dans son dixième bas (≤ P10)', q: 0.1, sens: 'bas' },
  { valeur: 'hautP90', label: 'dans son dixième haut (≥ P90)', q: 0.9, sens: 'haut' },
] as const
type IdCondition = (typeof CONDITIONS)[number]['valeur']

const DECALAGES = [
  { valeur: '0', label: 'le jour même' },
  { valeur: '1', label: 'le lendemain' },
  { valeur: '2', label: 'à J+2' },
  { valeur: '3', label: 'à J+3' },
] as const

const POINTS_MINIMUM = 30

export function Hypotheses() {
  const etat = useEtat()
  const disponibles = useMemo(
    () => seriesRenseignees(etat).filter((id) => (etat.series[id]?.length ?? 0) >= POINTS_MINIMUM),
    [etat],
  )

  const [condId, setCondId] = useState('')
  const [effetId, setEffetId] = useState('')
  const [condition, setCondition] = useState<IdCondition>('basP25')
  const [decalage, setDecalage] = useState<'0' | '1' | '2' | '3'>('1')

  // Sélections initiales : une cause plausible et un effet différent.
  useEffect(() => {
    if (condId === '' && disponibles.length > 0) {
      setCondId(
        ['sommeil_duree', 'charge_seance', 'stress'].find((id) => disponibles.includes(id)) ??
          disponibles[0]!,
      )
    }
    if (effetId === '' && disponibles.length > 0) {
      setEffetId(['energie', 'vfc', 'humeur'].find((id) => disponibles.includes(id)) ?? disponibles[0]!)
    }
  }, [disponibles, condId, effetId])

  const resultat = useMemo(() => {
    if (condId === '' || effetId === '') return null
    const cond = serieAnalyse(etat, condId)
    const effet = serieAnalyse(etat, effetId)
    if (cond.length < POINTS_MINIMUM || effet.length === 0) return null
    const regle = CONDITIONS.find((c) => c.valeur === condition)!
    const seuil = quantile(cond.map((p) => p.v), regle.q)
    const d = Number(decalage)

    const groupeCondition: number[] = []
    const groupeAutres: number[] = []
    for (const p of cond) {
      const v = valeurAuJour(effet, d === 0 ? p.j : decalerJour(p.j, d))
      if (v === undefined) continue
      const remplit = regle.sens === 'bas' ? p.v <= seuil : p.v >= seuil
      ;(remplit ? groupeCondition : groupeAutres).push(v)
    }
    const ecart = comparerEchantillons(groupeAutres, groupeCondition)
    return ecart ? { ecart, seuil } : null
  }, [etat, condId, effetId, condition, decalage])

  if (disponibles.length < 2) {
    return (
      <Vide titre={`Il faut au moins deux séries de ${POINTS_MINIMUM} points.`}>
        Génère un historique de démonstration depuis <strong className="text-texte">DONN</strong>.
      </Vide>
    )
  }

  const defCond = definitionOuGenerique(condId)
  const defEffet = definitionOuGenerique(effetId)
  const regle = CONDITIONS.find((c) => c.valeur === condition)!
  const libDecalage = DECALAGES.find((x) => x.valeur === decalage)!.label

  return (
    <div className="flex h-full flex-col">
      <EnteteFenetre>
        <Selecteur
          valeur={condId}
          options={disponibles.map((id) => ({ valeur: id, label: definitionOuGenerique(id).label }))}
          onChange={setCondId}
          label="Quand"
        />
        <Selecteur
          valeur={condition}
          options={CONDITIONS.map((c) => ({ valeur: c.valeur, label: c.label }))}
          onChange={(v) => setCondition(v)}
        />
        <Selecteur
          valeur={effetId}
          options={disponibles.map((id) => ({ valeur: id, label: definitionOuGenerique(id).label }))}
          onChange={setEffetId}
          label="alors"
        />
        <Segments valeur={decalage} options={[...DECALAGES]} onChange={setDecalage} />
      </EnteteFenetre>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!resultat ? (
          <Vide titre="Pas assez de jours appariés pour répondre.">
            Il faut au moins cinq jours dans chaque groupe, condition remplie ou non.
          </Vide>
        ) : (
          <>
            <p className="mb-3 text-[12px] leading-relaxed text-texte">
              Les jours où <strong>{defCond.label.toLowerCase()}</strong> est{' '}
              {regle.label} — c'est-à-dire{' '}
              {regle.sens === 'bas' ? 'au plus' : 'au moins'}{' '}
              <span className="tabular-nums text-accent">{formaterValeur(condId, resultat.seuil)}</span> —
              que vaut <strong>{defEffet.label.toLowerCase()}</strong> {libDecalage} ?
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Groupe
                titre="Condition remplie"
                mediane={resultat.ecart.medianeB}
                n={resultat.ecart.nB}
                idMetrique={effetId}
                accent
              />
              <Groupe
                titre="Les autres jours"
                mediane={resultat.ecart.medianeA}
                n={resultat.ecart.nA}
                idMetrique={effetId}
              />
            </div>

            <div
              className="mt-3 rounded border px-3 py-2"
              style={{
                borderColor: resultat.ecart.significatif
                  ? 'color-mix(in srgb, var(--c-accent) 45%, transparent)'
                  : 'var(--c-bord)',
              }}
            >
              <p className="text-[12px] text-texte">
                Écart des médianes :{' '}
                <strong className="tabular-nums" style={{ color: resultat.ecart.significatif ? 'var(--c-accent)' : 'var(--c-texte)' }}>
                  {resultat.ecart.delta >= 0 ? '+' : '−'}
                  {formaterValeur(effetId, Math.abs(resultat.ecart.delta))}
                </strong>{' '}
                <span className="text-attenue tabular-nums">
                  [IC 95 % : {resultat.ecart.icBas >= 0 ? '+' : '−'}
                  {formaterValeur(effetId, Math.abs(resultat.ecart.icBas))} ;{' '}
                  {resultat.ecart.icHaut >= 0 ? '+' : '−'}
                  {formaterValeur(effetId, Math.abs(resultat.ecart.icHaut))}]
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-attenue">
                {resultat.ecart.significatif
                  ? 'L’intervalle exclut zéro : l’écart ressort du bruit — sur TES données, sans dire pourquoi.'
                  : 'L’intervalle contient zéro : sur cet historique, l’écart est indistinguable du bruit.'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => storeIntentions.getState().demanderSeries({ ids: [condId, effetId] })}
              className="mt-3 text-[11px] text-accent hover:underline"
            >
              Tracer les deux séries dans SERI →
            </button>
          </>
        )}
      </div>

      <PiedNote>
        Un écart conditionnel n'est pas une cause : les nuits courtes viennent souvent avec autre
        chose (une soirée, du stress) qui peut porter l'effet. {AVERTISSEMENT}
      </PiedNote>
    </div>
  )
}

function Groupe({
  titre,
  mediane,
  n,
  idMetrique,
  accent,
}: {
  titre: string
  mediane: number
  n: number
  idMetrique: string
  accent?: boolean
}) {
  return (
    <div
      className="rounded border px-3 py-2"
      style={{
        borderColor: accent ? 'color-mix(in srgb, var(--c-accent) 45%, transparent)' : 'var(--c-bord)',
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.15em] text-attenue">{titre}</div>
      <div className="mt-1 tabular-nums text-[20px] leading-tight text-texte">
        {formaterValeur(idMetrique, mediane)}
      </div>
      <div className="text-[10px] text-attenue">médiane · n = {n}</div>
    </div>
  )
}
