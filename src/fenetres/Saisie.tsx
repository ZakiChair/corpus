import { useEffect, useMemo, useRef, useState } from 'react'
import { AVERTISSEMENT } from '../analyse/lecture'
import { valeurAuJour } from '../analyse/stats'
import { storeDonnees } from '../core/donneesStore'
import { useAujourdhui, useEtat } from '../core/hooks'
import {
  formaterHeureCoucher,
  LIBELLES_FAMILLE,
  metriquesSaisissables,
  type DefinitionMetrique,
} from '../core/metriques'
import { serie as lireSerie } from '../core/series'
import { decalerJour, formaterJourLong } from '../core/temps'
import { Bouton, EnteteFenetre, PiedNote } from '../ui/ui'

/**
 * Saisie manuelle d'une journée.
 *
 * Seules les métriques déclarées `saisieManuelle` sont proposées : personne ne
 * saisit à la main son nombre de pas ou sa durée de sommeil profond, qui
 * viennent d'un appareil. Les champs sont préremplis avec ce qui existe déjà
 * pour la date choisie, ce qui rend la fenêtre utilisable pour corriger autant
 * que pour saisir.
 */

const SAISISSABLES = metriquesSaisissables()

/**
 * La saisie manuelle est le chemin d'entrée le plus exposé aux fautes de
 * frappe (745 au lieu de 74,5), et les attributs HTML min/max n'empêchent
 * rien au clavier. Les bornes du catalogue — déjà appliquées aux imports —
 * valent donc ici aussi.
 */
function valeurInvalide(def: DefinitionMetrique, texte: string): boolean {
  const t = texte.trim()
  if (t === '') return false
  const v = Number(t.replace(',', '.'))
  return !Number.isFinite(v) || v < def.min || v > def.max
}

export function Saisie() {
  const etat = useEtat()
  const ajd = useAujourdhui()
  const [jour, setJour] = useState(ajd)
  const [brouillon, setBrouillon] = useState<Record<string, string>>({})
  const [enregistre, setEnregistre] = useState(false)

  // À minuit, une fenêtre restée sur « aujourd'hui » suit le changement de
  // date — mais une date choisie à la main est respectée.
  const refAncienAjd = useRef(ajd)
  useEffect(() => {
    if (refAncienAjd.current !== ajd) {
      if (jour === refAncienAjd.current) setJour(ajd)
      refAncienAjd.current = ajd
    }
  }, [ajd, jour])

  // Valeurs déjà connues pour ce jour : le brouillon les surcharge.
  const existant = useMemo(() => {
    const out: Record<string, number | undefined> = {}
    for (const m of SAISISSABLES) out[m.id] = valeurAuJour(lireSerie(etat, m.id), jour)
    return out
  }, [etat, jour])

  function changerJour(nouveau: string) {
    setJour(nouveau)
    // Le brouillon appartient à une date : le garder en changeant de jour
    // écrirait les valeurs d'hier sur aujourd'hui.
    setBrouillon({})
    setEnregistre(false)
  }

  async function enregistrer() {
    const { poserMesure, purgerEcritureEnAttente } = storeDonnees.getState()
    let n = 0
    for (const [id, texte] of Object.entries(brouillon)) {
      const t = texte.trim()
      if (t === '') continue
      const v = Number(t.replace(',', '.'))
      if (!Number.isFinite(v)) continue
      poserMesure(id, jour, v)
      n++
    }
    if (n === 0) return
    // « Enregistré. » doit refléter la persistance réelle, pas l'état en
    // mémoire : l'écriture est différée de 400 ms, et un rechargement dans
    // cette fenêtre perdrait la saisie pourtant confirmée.
    await purgerEcritureEnAttente()
    if (storeDonnees.getState().persistance.statut !== 'pret') return
    setBrouillon({})
    setEnregistre(true)
  }

  const nbRemplis = Object.values(brouillon).filter((v) => v.trim() !== '').length
  const invalides = SAISISSABLES.filter((m) => valeurInvalide(m, brouillon[m.id] ?? ''))
  const parFamille = [...new Set(SAISISSABLES.map((m) => m.famille))].map((f) => ({
    famille: f,
    metriques: SAISISSABLES.filter((m) => m.famille === f),
  }))

  return (
    <div className="flex h-full flex-col">
      <EnteteFenetre>
        <button
          type="button"
          onClick={() => changerJour(decalerJour(jour, -1))}
          className="rounded border border-bord px-1.5 text-attenue hover:text-texte"
          aria-label="Jour précédent"
        >
          ‹
        </button>
        <input
          type="date"
          value={jour}
          max={ajd}
          onChange={(e) => e.target.value && changerJour(e.target.value)}
          className="rounded border border-bord bg-fond px-1.5 py-0.5 text-[12px] text-texte outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => changerJour(decalerJour(jour, 1))}
          disabled={jour >= ajd}
          className="rounded border border-bord px-1.5 text-attenue hover:text-texte disabled:opacity-30"
          aria-label="Jour suivant"
        >
          ›
        </button>
        <span className="ml-auto text-[11px] text-attenue">
          {jour === ajd ? 'aujourd’hui' : formaterJourLong(jour)}
        </span>
      </EnteteFenetre>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {parFamille.map((groupe) => (
          <section key={groupe.famille} className="mb-3">
            <h3 className="mb-1.5 text-[10px] uppercase tracking-[0.15em] text-attenue">
              {LIBELLES_FAMILLE[groupe.famille]}
            </h3>
            <div className="space-y-1.5">
              {groupe.metriques.map((m) => (
                <Champ
                  key={m.id}
                  definition={m}
                  valeurExistante={existant[m.id]}
                  brouillon={brouillon[m.id] ?? ''}
                  invalide={valeurInvalide(m, brouillon[m.id] ?? '')}
                  onChange={(v) => {
                    setBrouillon((b) => ({ ...b, [m.id]: v }))
                    setEnregistre(false)
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-bord px-3 py-2">
        <Bouton
          variante="accent"
          onClick={enregistrer}
          desactive={nbRemplis === 0 || invalides.length > 0}
        >
          Enregistrer{nbRemplis > 0 ? ` (${nbRemplis})` : ''}
        </Bouton>
        {invalides.length > 0 ? (
          <span className="text-[11px] text-defavorable">
            {invalides.length > 1
              ? `${invalides.length} valeurs hors bornes`
              : `${invalides[0]!.abrege} : hors bornes (${invalides[0]!.min} – ${invalides[0]!.max})`}
          </span>
        ) : (
          enregistre && <span className="text-[11px] text-favorable">Enregistré.</span>
        )}
      </div>

      <PiedNote>{AVERTISSEMENT}</PiedNote>
    </div>
  )
}

function Champ({
  definition,
  valeurExistante,
  brouillon,
  invalide,
  onChange,
}: {
  definition: DefinitionMetrique
  valeurExistante: number | undefined
  brouillon: string
  invalide: boolean
  onChange: (v: string) => void
}) {
  const aide =
    definition.id === 'sommeil_coucher'
      ? 'heures décimales, > 24 après minuit (24,5 = 0 h 30)'
      : definition.id === 'charge_seance'
        ? 'durée en minutes × intensité ressentie sur 10'
        : `${definition.min} – ${definition.max}`

  return (
    <label className="flex items-center gap-2">
      <span className="w-[104px] shrink-0 truncate text-[11px] text-texte" title={definition.label}>
        {definition.abrege}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={definition.decimales > 0 ? 0.1 : 1}
        min={definition.min}
        max={definition.max}
        value={brouillon}
        placeholder={
          valeurExistante === undefined
            ? '—'
            : definition.id === 'sommeil_coucher'
              ? formaterHeureCoucher(valeurExistante)
              : String(valeurExistante)
        }
        onChange={(e) => onChange(e.target.value)}
        className={`w-[84px] rounded border bg-fond px-1.5 py-1 text-right text-[12px] tabular-nums outline-none ${
          invalide
            ? 'border-defavorable text-defavorable focus:border-defavorable'
            : `focus:border-accent ${
                valeurExistante !== undefined && brouillon === ''
                  ? 'border-bord text-attenue'
                  : 'border-bord text-texte'
              }`
        }`}
      />
      <span className="w-8 shrink-0 text-[10px] text-attenue">{definition.unite}</span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-attenue/70" title={aide}>
        {aide}
      </span>
    </label>
  )
}
