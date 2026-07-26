import { useMemo, useState } from 'react'
import { AVERTISSEMENT } from '../analyse/lecture'
import { storeDonnees, TYPES_SAISISSABLES } from '../core/donneesStore'
import { useEtat } from '../core/hooks'
import { aujourdhui, formaterJourLong } from '../core/temps'
import { COULEURS_ANNOTATION, LIBELLES_ANNOTATION, type TypeAnnotation } from '../core/types'
import { Bouton, EnteteFenetre, Etiquette, PiedNote, Selecteur, Vide } from '../ui/ui'

/**
 * Journal d'événements.
 *
 * Ces annotations ne sont pas décoratives : ce sont elles qui alimentent la
 * fenêtre EVTS. Sans événements datés, aucune étude d'événement n'est possible
 * — d'où le soin mis à rendre l'ajout rapide.
 */

export function Journal() {
  const etat = useEtat()
  const [filtre, setFiltre] = useState<TypeAnnotation | 'tous'>('tous')
  const [jour, setJour] = useState(() => aujourdhui())
  const [type, setType] = useState<TypeAnnotation>('seance')
  const [note, setNote] = useState('')
  const [intensite, setIntensite] = useState(0.6)

  const visibles = useMemo(() => {
    const liste = filtre === 'tous' ? etat.annotations : etat.annotations.filter((a) => a.type === filtre)
    // Le plus récent d'abord : c'est ce qu'on vient de vivre qui intéresse.
    return [...liste].reverse()
  }, [etat.annotations, filtre])

  const optionsFiltre = useMemo(
    () => [
      { valeur: 'tous' as const, label: `Tous (${etat.annotations.length})` },
      ...TYPES_SAISISSABLES.map((t) => ({
        valeur: t,
        label: `${LIBELLES_ANNOTATION[t]} (${etat.annotations.filter((a) => a.type === t).length})`,
      })),
    ],
    [etat.annotations],
  )

  return (
    <div className="flex h-full flex-col">
      <EnteteFenetre>
        <Selecteur
          valeur={filtre}
          options={optionsFiltre}
          onChange={(v) => setFiltre(v as TypeAnnotation | 'tous')}
          label="Filtre"
        />
      </EnteteFenetre>

      <div className="shrink-0 space-y-2 border-b border-bord p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={jour}
            onChange={(e) => e.target.value && setJour(e.target.value)}
            className="rounded border border-bord bg-fond px-1.5 py-1 text-[12px] text-texte outline-none focus:border-accent"
          />
          <Selecteur
            valeur={type}
            options={TYPES_SAISISSABLES.map((t) => ({ valeur: t, label: LIBELLES_ANNOTATION[t] }))}
            onChange={setType}
          />
          <label className="flex items-center gap-1.5">
            <span className="text-[11px] text-attenue">Intensité</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={intensite}
              onChange={(e) => setIntensite(Number(e.target.value))}
              className="w-20 accent-[var(--c-accent)]"
            />
            <span className="w-7 tabular-nums text-[11px] text-attenue">
              {intensite.toFixed(2)}
            </span>
          </label>
        </div>
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (facultative)"
            className="min-w-0 flex-1 rounded border border-bord bg-fond px-2 py-1 text-[12px] text-texte outline-none placeholder:text-attenue focus:border-accent"
          />
          <Bouton
            variante="accent"
            onClick={() => {
              storeDonnees.getState().ajouterAnnotation({
                j: jour,
                type,
                intensite,
                note: note.trim() || undefined,
              })
              setNote('')
            }}
          >
            Ajouter
          </Bouton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {visibles.length === 0 ? (
          <Vide titre="Aucun événement.">
            Les événements datés alimentent la fenêtre <strong className="text-texte">EVTS</strong>,
            qui mesure la réponse moyenne de tes métriques autour de chaque type.
          </Vide>
        ) : (
          <ul>
            {visibles.map((a) => (
              <li
                key={a.id}
                className="group flex items-baseline gap-2 border-b border-bord/40 px-3 py-1.5"
              >
                <span className="w-[92px] shrink-0 text-[11px] tabular-nums text-attenue">
                  {formaterJourLong(a.j)}
                </span>
                <Etiquette jeton={COULEURS_ANNOTATION[a.type]}>
                  {LIBELLES_ANNOTATION[a.type]}
                </Etiquette>
                {a.intensite !== undefined && (
                  <span className="shrink-0 text-[10px] tabular-nums text-attenue/70">
                    {a.intensite.toFixed(2)}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[11px] text-texte">{a.note ?? ''}</span>
                <button
                  type="button"
                  onClick={() => storeDonnees.getState().supprimerAnnotation(a.id)}
                  className="shrink-0 text-[11px] text-attenue opacity-0 transition-opacity hover:text-defavorable group-hover:opacity-100"
                  aria-label="Supprimer"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PiedNote>{AVERTISSEMENT}</PiedNote>
    </div>
  )
}
