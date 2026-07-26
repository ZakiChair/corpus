import { useRef, useState } from 'react'
import { AVERTISSEMENT, lireCouverture } from '../analyse/lecture'
import { storeDonnees } from '../core/donneesStore'
import { useEtat } from '../core/hooks'
import { definitionOuGenerique } from '../core/metriques'
import { bornesGlobales, nombreDePoints, seriesRenseignees, typesPresents } from '../core/series'
import { diffJours, formaterJourLong } from '../core/temps'
import { LIBELLES_ANNOTATION } from '../core/types'
import { importerAthlos } from '../donnees/importAthlos'
import { importerCsv } from '../donnees/importCsv'
import { ImportAnnule, importerSante, type ProgressionSante } from '../donnees/importSante'
import { Bouton, EnteteFenetre, PiedNote } from '../ui/ui'

/**
 * Fenêtre Données : peupler, exporter, effacer.
 *
 * C'est la seule porte d'entrée de l'application, donc celle qu'on ouvre
 * automatiquement au premier lancement.
 */

type Message = { ton: 'ok' | 'avert' | 'erreur'; texte: string; details?: string[] }

const ID_CHAMP_FICHIER = 'corpus-champ-fichier'

export function Donnees() {
  const etat = useEtat()
  const [message, setMessage] = useState<Message | null>(null)
  const [confirmationEffacement, setConfirmationEffacement] = useState(false)
  const [progression, setProgression] = useState<ProgressionSante | null>(null)
  const [survolDepot, setSurvolDepot] = useState(false)
  const refFichier = useRef<HTMLInputElement>(null)
  const refAnnulation = useRef<AbortController | null>(null)

  const ids = seriesRenseignees(etat)
  const bornes = bornesGlobales(etat)
  const couverture =
    'debut' in bornes ? diffJours(bornes.debut, bornes.fin) + 1 : 0

  async function traiterFichier(fichier: File) {
    const nom = fichier.name.toLowerCase()

    if (nom.endsWith('.xml') || nom.endsWith('.zip')) {
      await importerAppleSante(fichier)
      return
    }

    // Les autres formats tiennent en mémoire sans difficulté ; seul l'export
    // Apple justifie une lecture en flux.
    const texte = await fichier.text()

    if (nom.endsWith('.json')) {
      let brut: unknown
      try {
        brut = JSON.parse(texte)
      } catch {
        setMessage({ ton: 'erreur', texte: 'Ce fichier n’est pas du JSON valide.' })
        return
      }
      // Un export CORPUS se reconnaît à sa version et à ses séries ; un profil
      // ATHLOS à son dictionnaire `metrics`.
      if (
        typeof brut === 'object' &&
        brut !== null &&
        'series' in brut &&
        'version' in brut
      ) {
        storeDonnees.getState().remplacer(brut as never)
        setMessage({ ton: 'ok', texte: 'Sauvegarde CORPUS restaurée.' })
        return
      }
      const athlos = importerAthlos(brut)
      if (!athlos) {
        setMessage({
          ton: 'erreur',
          texte: 'JSON non reconnu : ni une sauvegarde CORPUS, ni un profil ATHLOS.',
        })
        return
      }
      storeDonnees.getState().fusionner(athlos.series, athlos.annotations)
      setMessage({
        ton: 'ok',
        texte: `Profil ATHLOS importé${athlos.nomProfil ? ` (${athlos.nomProfil})` : ''} : ${
          Object.keys(athlos.series).length
        } séries, ${athlos.annotations.length} séances.`,
        details: athlos.avertissements,
      })
      return
    }

    const resultat = importerCsv(texte)
    const nbSeries = Object.keys(resultat.series).length
    if (nbSeries === 0) {
      setMessage({
        ton: 'erreur',
        texte: 'Aucune colonne exploitable trouvée.',
        details: resultat.avertissements,
      })
      return
    }
    storeDonnees.getState().fusionner(resultat.series)
    setMessage({
      ton: resultat.avertissements.length > 0 ? 'avert' : 'ok',
      texte: `${resultat.lignesLues} lignes lues, ${nbSeries} séries importées.`,
      details: [
        ...resultat.colonnes.map(
          (c) =>
            `« ${c.entete} » → ${definitionOuGenerique(c.idMetrique).label}${
              c.connue ? '' : ' (hors catalogue)'
            }, ${c.points} points`,
        ),
        ...resultat.avertissements,
      ],
    })
  }

  async function importerAppleSante(fichier: File) {
    const controleur = new AbortController()
    refAnnulation.current = controleur
    setMessage(null)
    setProgression({ octetsLus: 0, octetsTotal: fichier.size, enregistrementsLus: 0 })
    try {
      const r = await importerSante(fichier, fichier.name, {
        onProgression: setProgression,
        signal: controleur.signal,
      })
      const nbSeries = Object.keys(r.series).length
      if (nbSeries === 0 && r.annotations.length === 0) {
        setMessage({
          ton: 'erreur',
          texte: `Aucune donnée exploitable dans ce fichier (${r.enregistrementsLus.toLocaleString('fr-CH')} enregistrements lus).`,
          details: r.typesIgnores.map((t) => `${t.type} : ${t.n.toLocaleString('fr-CH')} — non pris en charge`),
        })
        return
      }
      storeDonnees.getState().fusionner(r.series, r.annotations, r.profil)
      setMessage({
        ton: 'ok',
        texte: `${r.enregistrementsLus.toLocaleString('fr-CH')} enregistrements lus, ${nbSeries} séries et ${r.annotations.length} séances importées.`,
        details: [
          ...Object.entries(r.series).map(
            ([id, s]) => `${definitionOuGenerique(id).label} : ${s.length} jours`,
          ),
          ...r.avertissements,
          ...(r.typesIgnores.length > 0
            ? [
                `Types non pris en charge, ignorés : ${r.typesIgnores
                  .slice(0, 6)
                  .map((t) => t.type)
                  .join(', ')}.`,
              ]
            : []),
        ],
      })
    } catch (e) {
      const annule = e instanceof ImportAnnule
      setMessage({
        ton: annule ? 'avert' : 'erreur',
        texte: annule ? 'Import annulé.' : `Lecture impossible : ${(e as Error).message}`,
      })
    } finally {
      setProgression(null)
      refAnnulation.current = null
    }
  }

  function exporter() {
    const blob = new Blob([JSON.stringify(etat, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `corpus-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage({ ton: 'ok', texte: 'Sauvegarde téléchargée.' })
  }

  return (
    <div className="flex h-full flex-col">
      <EnteteFenetre>
        <span className="text-[11px] text-attenue">
          {ids.length} séries · {nombreDePoints(etat).toLocaleString('fr-CH')} points
        </span>
        {'debut' in bornes && (
          <span className="ml-auto text-[11px] text-attenue">
            {formaterJourLong(bornes.debut)} → {formaterJourLong(bornes.fin)}
          </span>
        )}
      </EnteteFenetre>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        <Section titre="Démarrer">
          <p className="mb-2 text-[11px] leading-relaxed text-attenue">
            L’historique de démonstration n’est pas du bruit : il simule un modèle causal
            explicite — une séance déprime la variabilité cardiaque du lendemain, une soirée
            arrosée fait monter la fréquence au repos. Les fenêtres d’analyse retrouvent ces
            effets, ce qui permet de juger l’outil avant d’y verser ses propres données.
          </p>
          <div className="flex flex-wrap gap-2">
            <Bouton
              variante="accent"
              onClick={() => {
                storeDonnees.getState().genererDemonstration(540)
                setMessage({ ton: 'ok', texte: '18 mois de démonstration générés.' })
              }}
            >
              Générer 18 mois
            </Bouton>
            <Bouton
              onClick={() => {
                storeDonnees.getState().genererDemonstration(1095)
                setMessage({ ton: 'ok', texte: '3 ans de démonstration générés.' })
              }}
            >
              Générer 3 ans
            </Bouton>
          </div>
        </Section>

        <Section titre="Importer">
          <p className="mb-2 text-[11px] leading-relaxed text-attenue">
            CSV — une colonne de date, puis une colonne par métrique. Le séparateur, le format
            de date et la virgule décimale sont détectés. Ou le JSON exporté par ATHLOS, ou une
            sauvegarde CORPUS.
          </p>
          <p className="mb-2 text-[11px] leading-relaxed text-attenue">
            <strong className="text-texte">Apple Santé</strong> — l’<code>export.zip</code> tel
            que l’application le produit (Profil → Exporter toutes les données), ou l’
            <code>export.xml</code> qu’il contient. La lecture se fait en flux, sans charger le
            fichier en mémoire ; sur plusieurs centaines de mégaoctets, compte quelques minutes.
          </p>
          {progression ? (
            <BarreProgression
              progression={progression}
              onAnnuler={() => refAnnulation.current?.abort()}
            />
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setSurvolDepot(true)
              }}
              onDragLeave={() => setSurvolDepot(false)}
              onDrop={(e) => {
                e.preventDefault()
                setSurvolDepot(false)
                const f = e.dataTransfer.files?.[0]
                if (f) void traiterFichier(f)
                else setMessage({ ton: 'erreur', texte: 'Dépose un fichier, pas un dossier.' })
              }}
              className={`flex flex-wrap items-center gap-2 rounded border border-dashed px-2.5 py-2 transition-colors ${
                survolDepot ? 'border-accent bg-accent/10' : 'border-bord'
              }`}
            >
              {/*
                Un <label for> et non un bouton qui appellerait `input.click()` :
                Safari REFUSE le clic programmatique sur un champ de fichier
                masqué, là où Chrome l'accepte — un test sous Chromium ne révèle
                donc rien. Le label passe par le mécanisme natif d'activation du
                navigateur, sans une ligne de JavaScript, et reste accessible au
                clavier.
              */}
              <input
                id={ID_CHAMP_FICHIER}
                ref={refFichier}
                type="file"
                accept=".csv,.txt,.json,.tsv,.xml,.zip"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void traiterFichier(f)
                  // Réinitialise pour permettre de réimporter le même fichier.
                  e.target.value = ''
                }}
              />
              <label
                htmlFor={ID_CHAMP_FICHIER}
                className="cursor-pointer rounded border border-accent/60 px-2.5 py-1 text-[12px] text-accent transition-colors hover:bg-accent/10"
              >
                Choisir un fichier…
              </label>
              <span className="text-[11px] text-attenue">ou dépose-le ici</span>
            </div>
          )}
        </Section>

        <Section titre="Sauvegarder">
          <p className="mb-2 text-[11px] leading-relaxed text-attenue">
            Tes données vivent dans le stockage de ce navigateur, sur cette machine. Vider les
            données de site les effacerait : exporte régulièrement.
          </p>
          <div className="flex flex-wrap gap-2">
            <Bouton onClick={exporter} desactive={ids.length === 0}>
              Exporter en JSON
            </Bouton>
            {confirmationEffacement ? (
              <>
                <Bouton
                  variante="danger"
                  onClick={() => {
                    storeDonnees.getState().reinitialiser()
                    setConfirmationEffacement(false)
                    setMessage({ ton: 'avert', texte: 'Toutes les données ont été effacées.' })
                  }}
                >
                  Confirmer l’effacement
                </Bouton>
                <Bouton onClick={() => setConfirmationEffacement(false)}>Annuler</Bouton>
              </>
            ) : (
              <Bouton
                variante="danger"
                onClick={() => setConfirmationEffacement(true)}
                desactive={ids.length === 0}
              >
                Tout effacer
              </Bouton>
            )}
          </div>
        </Section>

        {message && (
          <div
            className="rounded border px-2.5 py-2 text-[11px] leading-relaxed"
            style={{
              borderColor:
                message.ton === 'erreur'
                  ? 'var(--c-defavorable)'
                  : message.ton === 'avert'
                    ? 'var(--c-alerte)'
                    : 'var(--c-favorable)',
              color:
                message.ton === 'erreur'
                  ? 'var(--c-defavorable)'
                  : message.ton === 'avert'
                    ? 'var(--c-alerte)'
                    : 'var(--c-favorable)',
            }}
          >
            {message.texte}
            {message.details && message.details.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-attenue">
                {message.details.map((d, i) => (
                  <li key={i}>· {d}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {ids.length > 0 && (
          <Section titre="Contenu">
            <div className="space-y-0.5">
              {ids.map((id) => {
                const s = etat.series[id]!
                return (
                  <div key={id} className="flex items-baseline justify-between gap-3 text-[11px]">
                    <span className="truncate text-texte">{definitionOuGenerique(id).label}</span>
                    <span className="shrink-0 tabular-nums text-attenue">
                      {lireCouverture(s.length, couverture)}
                    </span>
                  </div>
                )
              })}
            </div>
            {etat.annotations.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-bord pt-2 text-[10px] text-attenue">
                {typesPresents(etat).map((t) => (
                  <span key={t.type} className="rounded bg-bord/50 px-1.5 py-0.5">
                    {LIBELLES_ANNOTATION[t.type]} · {t.n}
                  </span>
                ))}
              </div>
            )}
          </Section>
        )}
      </div>

      <PiedNote>{AVERTISSEMENT}</PiedNote>
    </div>
  )
}

function BarreProgression({
  progression,
  onAnnuler,
}: {
  progression: ProgressionSante
  onAnnuler: () => void
}) {
  const { octetsLus, octetsTotal, enregistrementsLus } = progression
  const part = octetsTotal > 0 ? Math.min(1, octetsLus / octetsTotal) : 0
  const mo = (o: number) => (o / 1024 / 1024).toFixed(1)
  return (
    <div className="rounded border border-bord px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="text-texte">Lecture en cours…</span>
        <span className="tabular-nums text-attenue">
          {mo(octetsLus)} / {mo(octetsTotal)} Mo ·{' '}
          {enregistrementsLus.toLocaleString('fr-CH')} enregistrements
        </span>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-bord/60">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${(part * 100).toFixed(1)}%` }}
        />
      </div>
      <div className="mt-1.5">
        <Bouton variante="danger" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
    </div>
  )
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[10px] uppercase tracking-[0.15em] text-attenue">{titre}</h3>
      {children}
    </section>
  )
}
