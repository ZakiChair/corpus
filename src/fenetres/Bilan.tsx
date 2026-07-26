import { useMemo, useState } from 'react'
import { ecartAMediane, lireEcart, lireRang, lireRegime, AVERTISSEMENT } from '../analyse/lecture'
import { bandeDuRegime, calculerRegime, contributionDominante } from '../analyse/regime'
import { derniersJours, rangPercentile, zScoreGlissant } from '../analyse/stats'
import { useEtat } from '../core/hooks'
import {
  definitionOuGenerique,
  FAMILLES,
  formaterHeureCoucher,
  formaterValeur,
  LIBELLES_FAMILLE,
  type DefinitionMetrique,
  type Famille,
} from '../core/metriques'
import { serie as lireSerie, seriesRenseignees } from '../core/series'
import { formaterJourCourt, formaterJourLong } from '../core/temps'
import type { Serie } from '../core/types'
import { nomJetonSerie } from '../ui/jetonsCanvas'
import { BarreEcart, EnteteFenetre, PiedNote, Segments, Sparkline, Vide } from '../ui/ui'

/**
 * Bilan : l'état du jour en un écran.
 *
 * Chaque tuile répond à trois questions différentes, et c'est délibéré :
 * « combien » (la valeur), « est-ce inhabituel POUR MOI » (le z-score sur la
 * fenêtre de référence), « et par rapport à tout mon historique » (le rang
 * percentile). Une VFC de 48 ms ne dit rien seule ; à 1,8 σ sous sa normale et
 * au 6ᵉ percentile, elle dit quelque chose.
 */

const FENETRES_REFERENCE = [
  { valeur: '14', label: '14 j' },
  { valeur: '30', label: '30 j' },
  { valeur: '90', label: '90 j' },
] as const

/** Facteurs d'élargissement successifs quand la fenêtre demandée est trop pauvre. */
const ELARGISSEMENTS = [1, 3, 6, 12]

/**
 * Z-score du dernier point, sur la fenêtre demandée — ou sur la première
 * fenêtre élargie qui contienne assez d'observations.
 *
 * Sans cela, les métriques mesurées une fois par semaine (composition
 * corporelle, tour de taille) n'auraient jamais de z : quatre points en trente
 * jours ne suffisent pas, et le calcul a raison de le refuser. Élargir puis
 * ANNONCER la fenêtre réellement utilisée est la seule réponse honnête —
 * mieux que mentir sur quatre points, mieux que ne rien afficher.
 */
function zAvecFenetreAdaptee(
  s: Serie,
  jours: number,
  jourCible: string,
): { z: number; fenetre: number } | undefined {
  for (const facteur of ELARGISSEMENTS) {
    const fenetre = jours * facteur
    const zs = zScoreGlissant(s, fenetre)
    const dernier = zs[zs.length - 1]
    // Le z doit porter sur le dernier point MESURÉ : sinon on afficherait
    // l'anomalie d'avant-hier sous la valeur d'hier.
    if (dernier?.j === jourCible) return { z: dernier.v, fenetre }
  }
  return undefined
}

export function Bilan() {
  const etat = useEtat()
  const [fenetre, setFenetre] = useState<'14' | '30' | '90'>('30')
  const jours = Number(fenetre)

  const regime = useMemo(() => calculerRegime(etat.series, { fenetre: jours }), [etat, jours])
  const dernierRegime = regime.serie[regime.serie.length - 1]

  // On parcourt les séries RENSEIGNÉES et non le catalogue : sinon une
  // métrique arrivée par import — une performance ATHLOS, une colonne CSV
  // hors catalogue — apparaîtrait dans SERI et CORR mais jamais ici.
  const tuiles = useMemo(
    () =>
      seriesRenseignees(etat).map((id) => {
        const def = definitionOuGenerique(id)
        const s = lireSerie(etat, id)
        if (s.length === 0) return null
        const dernier = s[s.length - 1]!
        const reference = zAvecFenetreAdaptee(s, jours, dernier.j)
        return {
          def,
          serie: s,
          dernier,
          z: reference?.z,
          fenetreUtilisee: reference?.fenetre ?? jours,
          rang: rangPercentile(s.map((p) => p.v), dernier.v),
          ecart: ecartAMediane(s, jours),
          apercu: derniersJours(s, 90),
        }
      }).filter((t): t is NonNullable<typeof t> => t !== null),
    [etat, jours],
  )

  if (tuiles.length === 0) {
    return (
      <Vide titre="Aucune mesure pour l’instant.">
        Ouvre <strong className="text-texte">DONN</strong> pour générer un historique de
        démonstration, importer un fichier, ou <strong className="text-texte">SAIS</strong> pour
        saisir ta première journée.
      </Vide>
    )
  }

  const parFamille = FAMILLES.map((f) => ({
    famille: f,
    tuiles: tuiles.filter((t) => t.def.famille === f),
  })).filter((g) => g.tuiles.length > 0)

  return (
    <div className="flex h-full flex-col">
      <EnteteFenetre>
        <span className="text-[11px] text-attenue">Référence</span>
        <Segments valeur={fenetre} options={[...FENETRES_REFERENCE]} onChange={setFenetre} />
        <span className="ml-auto text-[11px] text-attenue">
          {tuiles.length} métriques suivies
        </span>
      </EnteteFenetre>

      {dernierRegime && (
        <BanniereRegime
          composite={dernierRegime.v}
          jour={dernierRegime.j}
          dominante={contributionDominante(regime, dernierRegime.j)}
        />
      )}

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {parFamille.map((groupe) => (
          <section key={groupe.famille} className="mt-3">
            <h3 className="mb-1.5 text-[10px] uppercase tracking-[0.15em] text-attenue">
              {LIBELLES_FAMILLE[groupe.famille as Famille]}
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
              {groupe.tuiles.map((t, i) => (
                <Tuile key={t.def.id} {...t} indexCouleur={i} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <PiedNote>{AVERTISSEMENT}</PiedNote>
    </div>
  )
}

function BanniereRegime({
  composite,
  jour,
  dominante,
}: {
  composite: number
  jour: string
  dominante: ReturnType<typeof contributionDominante>
}) {
  const bande = bandeDuRegime(composite)
  return (
    <div
      className="mx-3 mt-3 rounded border px-3 py-2"
      style={{
        borderColor: `color-mix(in srgb, var(${bande.jeton}) 45%, transparent)`,
        backgroundColor: `color-mix(in srgb, var(${bande.jeton}) 8%, transparent)`,
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.15em] text-attenue">
          État composite — {formaterJourLong(jour)}
        </span>
        <span className="tabular-nums text-[11px] text-attenue">
          {composite >= 0 ? '+' : ''}
          {composite.toFixed(2)} σ
        </span>
      </div>
      <p className="mt-0.5 text-[14px]" style={{ color: `var(${bande.jeton})` }}>
        {lireRegime(composite, dominante)}
      </p>
    </div>
  )
}

interface PropsTuile {
  def: DefinitionMetrique
  serie: Serie
  dernier: { j: string; v: number }
  z: number | undefined
  fenetreUtilisee: number
  rang: number
  ecart: number
  apercu: Serie
  indexCouleur: number
}

function Tuile({ def, dernier, z, fenetreUtilisee, rang, ecart, apercu, indexCouleur }: PropsTuile) {
  const jeton = nomJetonSerie(indexCouleur)
  // L'heure de coucher est stockée en heures décimales pouvant dépasser 24
  // pour rester monotone ; elle s'affiche en horloge.
  const valeurAffichee =
    def.id === 'sommeil_coucher'
      ? formaterHeureCoucher(dernier.v)
      : formaterValeur(def.id, dernier.v)

  const jetonEcart =
    def.sens === 'neutre' || z === undefined || Math.abs(z) < 0.5
      ? '--c-attenue'
      : (z > 0) === (def.sens === 'haut')
        ? '--c-favorable'
        : '--c-defavorable'

  return (
    <div className="rounded border border-bord bg-elevee/40 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-attenue" title={def.label}>
          {def.abrege}
        </span>
        <span className="shrink-0 text-[10px] text-attenue/70">
          {formaterJourCourt(dernier.j)}
        </span>
      </div>

      <div className="mt-0.5 tabular-nums text-[19px] leading-tight text-texte">
        {valeurAffichee}
      </div>

      <div className="mt-1.5">
        <BarreEcart z={z ?? 0} />
      </div>

      <div className="mt-1 text-[10px] leading-snug" style={{ color: `var(${jetonEcart})` }}>
        {z === undefined ? 'pas assez d’historique' : lireEcart(z, fenetreUtilisee)}
      </div>

      <div className="text-[10px] text-attenue">
        {lireRang(rang)}
        {Number.isFinite(ecart) && (
          <>
            {' · '}
            {ecart >= 0 ? '+' : '−'}
            {formaterValeur(def.id, Math.abs(ecart))} vs médiane
          </>
        )}
      </div>

      <div className="mt-1.5">
        <Sparkline serie={apercu} jeton={jeton} />
      </div>
    </div>
  )
}

export function descriptionTuile(id: string): string {
  return definitionOuGenerique(id).label
}
