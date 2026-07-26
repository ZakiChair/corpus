import { useEffect, useRef } from 'react'
import { storeDonnees, type EtatPersistance } from '../core/donneesStore'

interface PropsEcranPersistance {
  persistance: EtatPersistance
}

export function EcranPersistance({ persistance }: PropsEcranPersistance) {
  const refDialogue = useRef<HTMLElement>(null)
  const statut = persistance.statut

  useEffect(() => {
    if (statut !== 'chargement' && statut !== 'pret') refDialogue.current?.focus()
  }, [statut])

  if (persistance.statut === 'chargement') {
    return (
      <div
        role="status"
        className="fixed inset-0 z-[500] grid place-items-center bg-fond text-[13px] text-attenue"
      >
        Lecture des données…
      </div>
    )
  }

  if (persistance.statut === 'pret') return null

  let titre: string
  let explication: string
  switch (persistance.statut) {
    case 'erreur-lecture':
      titre = 'Lecture impossible'
      explication = 'Le stockage local n’a pas pu être lu. Aucune donnée n’a été effacée.'
      break
    case 'document-corrompu':
      titre = 'Document de données illisible'
      explication =
        'Le document enregistré est corrompu. Aucune donnée n’a été remplacée ni modifiée.'
      break
    case 'version-incompatible':
      titre = 'Version incompatible'
      explication = `Ce document provient d’une version plus récente (version ${persistance.version}). Cette application ne l’écrasera pas.`
      break
    case 'erreur-ecriture':
      titre = 'Enregistrement impossible'
      explication =
        'L’enregistrement n’a pas abouti. Aucune donnée n’a été effacée ; l’état visible reste disponible en mémoire.'
      break
    case 'conflit':
      titre = 'Conflit entre onglets'
      explication =
        'Un autre onglet a enregistré des données entre-temps. L’état en mémoire n’a pas écrasé sa version.'
      break
  }

  const peutReessayer =
    persistance.statut === 'erreur-lecture' ||
    persistance.statut === 'document-corrompu' ||
    persistance.statut === 'version-incompatible'
  const peutTelecharger =
    persistance.statut === 'erreur-ecriture' || persistance.statut === 'conflit'

  function telechargerEtatMemoire(): void {
    const etat = storeDonnees.getState().etat
    const blob = new Blob([JSON.stringify(etat, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const lien = document.createElement('a')
    lien.href = url
    lien.download = `corpus-${new Date().toISOString().slice(0, 10)}.json`
    lien.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-[500] grid place-items-center bg-fond/90 p-5 backdrop-blur-sm">
      <section
        ref={refDialogue}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="titre-persistance"
        aria-describedby="explication-persistance"
        className="w-full max-w-lg rounded border border-alerte/60 bg-elevee p-5 shadow-2xl"
      >
        <h1 id="titre-persistance" className="text-[15px] font-bold text-alerte">
          {titre}
        </h1>
        <p id="explication-persistance" className="mt-2 text-[12px] leading-relaxed text-texte">
          {explication}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {peutReessayer ? (
            <button
              type="button"
              onClick={() => void storeDonnees.getState().hydrater()}
              className="rounded border border-accent/60 px-2.5 py-1 text-[12px] text-accent transition-colors hover:bg-accent/10"
            >
              Réessayer
            </button>
          ) : null}
          {peutTelecharger ? (
            <button
              type="button"
              onClick={telechargerEtatMemoire}
              className="rounded border border-accent/60 px-2.5 py-1 text-[12px] text-accent transition-colors hover:bg-accent/10"
            >
              Télécharger l’état en mémoire
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-bord px-2.5 py-1 text-[12px] text-attenue transition-colors hover:border-attenue hover:text-texte"
          >
            Recharger l’application
          </button>
        </div>
      </section>
    </div>
  )
}
