import { useMemo, useState } from 'react'
import { comparerPeriodes, fenetresAdjacentes } from '../analyse/comparaison'
import { AVERTISSEMENT } from '../analyse/lecture'
import { useEtat, useMemoRefs } from '../core/hooks'
import { definitionOuGenerique, formaterHeureCoucher, formaterValeur } from '../core/metriques'
import { bornesGlobales, serieAnalyse, seriesRenseignees } from '../core/series'
import { formaterJourCourt } from '../core/temps'
import { storeIntentions } from '../shell/intentions'
import { EnteteFenetre, Etiquette, PiedNote, Segments, Vide } from '../ui/ui'

/**
 * Comparaison de périodes : « ce bloc vs le précédent », pour toutes les
 * métriques d'un coup.
 *
 * Chaque ligne oppose les médianes de deux fenêtres adjacentes ; seul un
 * écart dont l'intervalle bootstrap exclut zéro est mis en avant — sans ce
 * garde-fou, n'importe quel couple de périodes « montre » un changement.
 */

const PERIODES = [
  { valeur: '7', label: '7 j' },
  { valeur: '14', label: '14 j' },
  { valeur: '28', label: '28 j' },
  { valeur: '56', label: '56 j' },
] as const

export function ComparaisonPeriodes() {
  const etat = useEtat()
  const [periode, setPeriode] = useState<'7' | '14' | '28' | '56'>('28')
  const jours = Number(periode)

  const bornes = bornesGlobales(etat)
  const fin = 'fin' in bornes ? bornes.fin : undefined

  const idsRenseignes = useMemo(() => seriesRenseignees(etat), [etat])
  // Un bootstrap de 500 tirages par métrique : à ne refaire que quand une
  // série, la fenêtre ou la fin de l'historique change réellement.
  const lignes = useMemoRefs(() => {
    if (!fin) return []
    const { ancienne, recente } = fenetresAdjacentes(fin, jours)
    return idsRenseignes.map((id) => ({
      id,
      def: definitionOuGenerique(id),
      ecart: comparerPeriodes(serieAnalyse(etat, id), ancienne, recente),
      ancienne,
      recente,
    }))
  }, [fin, jours, idsRenseignes.join('|'), ...idsRenseignes.map((id) => etat.series[id])])

  if (!fin || lignes.length === 0) {
    return (
      <Vide titre="Aucune série à comparer.">
        Génère un historique de démonstration depuis <strong className="text-texte">DONN</strong>.
      </Vide>
    )
  }

  const { ancienne, recente } = fenetresAdjacentes(fin, jours)
  const formater = (id: string, v: number) =>
    id === 'sommeil_coucher' ? formaterHeureCoucher(v) : formaterValeur(id, v)

  return (
    <div className="flex h-full flex-col">
      <EnteteFenetre>
        <span className="text-[11px] text-attenue">Fenêtres</span>
        <Segments valeur={periode} options={[...PERIODES]} onChange={setPeriode} />
        <span className="ml-auto text-[10px] tabular-nums text-attenue">
          {formaterJourCourt(ancienne.debut)} – {formaterJourCourt(ancienne.fin)} vs{' '}
          {formaterJourCourt(recente.debut)} – {formaterJourCourt(recente.fin)}
        </span>
      </EnteteFenetre>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-attenue">
              <th className="px-3 py-1.5 font-normal">Métrique</th>
              <th className="px-2 py-1.5 text-right font-normal">Avant</th>
              <th className="px-2 py-1.5 text-right font-normal">Récent</th>
              <th className="px-2 py-1.5 text-right font-normal">Écart</th>
              <th className="px-3 py-1.5 text-right font-normal">IC 95 %</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map(({ id, def, ecart }) => (
              <tr
                key={id}
                className="cursor-pointer border-t border-bord/40 transition-colors hover:bg-bord/30"
                title="Tracer dans SERI"
                onClick={() => storeIntentions.getState().demanderSeries({ ids: [id] })}
              >
                <td className="truncate px-3 py-1.5 text-texte">{def.abrege}</td>
                {ecart ? (
                  <>
                    <td className="px-2 py-1.5 text-right tabular-nums text-attenue">
                      {formater(id, ecart.medianeA)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-texte">
                      {formater(id, ecart.medianeB)}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right tabular-nums"
                      style={{
                        color: ecart.significatif ? 'var(--c-accent)' : 'var(--c-attenue)',
                        fontWeight: ecart.significatif ? 600 : 400,
                      }}
                    >
                      {ecart.delta >= 0 ? '+' : '−'}
                      {formaterValeur(id, Math.abs(ecart.delta))}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {ecart.significatif ? (
                        <Etiquette jeton="--c-accent" titre="L'intervalle exclut zéro">
                          net
                        </Etiquette>
                      ) : (
                        <span className="text-[10px] text-attenue">≈ bruit</span>
                      )}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="px-2 py-1.5 text-right text-[10px] text-attenue">
                    pas assez de mesures sur ces fenêtres
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PiedNote>
        Médianes de deux fenêtres adjacentes de {jours} jours ; « net » quand l'intervalle
        bootstrap à 95 % exclut zéro. Sur {lignes.length} métriques, un écart « net » par pur
        hasard reste possible. {AVERTISSEMENT}
      </PiedNote>
    </div>
  )
}
