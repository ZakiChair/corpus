import { createStore } from 'zustand/vanilla'
import {
  definitionFenetre,
  estIdFenetre,
  FENETRES_PAR_DEFAUT,
  type IdFenetre,
} from './registre'

/**
 * Gestionnaire de fenêtres flottantes.
 *
 * Les fonctions de placement et d'ordre Z sont pures et exportées : elles se
 * testent sans DOM, ce qui est l'essentiel de la logique. Le composant de
 * fenêtre ne fait que traduire des gestes en appels.
 */

export interface Geometrie {
  x: number
  y: number
  largeur: number
  hauteur: number
}

export interface FenetreOuverte extends Geometrie {
  id: IdFenetre
  z: number
  reduite: boolean
  /** Géométrie d'avant l'agrandissement, pour pouvoir la restaurer. */
  avantAgrandissement?: Geometrie
}

export const Z_MIN = 1
export const Z_MAX = 200
const MARGE = 12
export const HAUTEUR_BARRE_HAUT = 40
export const HAUTEUR_BARRE_BAS = 32
export const LARGEUR_MIN = 320
export const HAUTEUR_MIN = 200

/* ————————————————————————— Fonctions pures ————————————————————————— */

/** Renumérote les ordres Z en 1, 2, 3… sans changer leur ordre relatif. */
export function normaliserOrdreZ(fenetres: FenetreOuverte[]): FenetreOuverte[] {
  const tri = [...fenetres].sort((a, b) => a.z - b.z)
  const rangs = new Map<IdFenetre, number>()
  tri.forEach((f, i) => rangs.set(f.id, Z_MIN + i))
  return fenetres.map((f) => ({ ...f, z: rangs.get(f.id)! }))
}

export function mettreAuSommet(fenetres: FenetreOuverte[], id: IdFenetre): FenetreOuverte[] {
  const cible = fenetres.find((f) => f.id === id)
  if (!cible) return fenetres
  const maximum = Math.max(...fenetres.map((f) => f.z))
  if (cible.z === maximum) return fenetres
  const suivant = fenetres.map((f) => (f.id === id ? { ...f, z: maximum + 1 } : f))
  // Renumérotation dès qu'on approche du plafond, pour éviter la dérive.
  return maximum + 1 > Z_MAX ? normaliserOrdreZ(suivant) : suivant
}

/** Maintient une fenêtre visible : au moins un coin reste attrapable. */
export function clamperGeometrie(g: Geometrie, zone: { l: number; h: number }): Geometrie {
  const largeur = Math.max(LARGEUR_MIN, Math.min(g.largeur, zone.l))
  const hauteur = Math.max(HAUTEUR_MIN, Math.min(g.hauteur, zone.h - HAUTEUR_BARRE_HAUT))
  return {
    largeur,
    hauteur,
    // On autorise un débord à droite et en bas, mais jamais assez pour que la
    // barre de titre sorte de l'écran — sinon la fenêtre devient inattrapable.
    x: Math.max(-largeur + 120, Math.min(g.x, zone.l - 80)),
    y: Math.max(HAUTEUR_BARRE_HAUT, Math.min(g.y, zone.h - HAUTEUR_BARRE_BAS - 40)),
  }
}

/**
 * Position en cascade : chaque nouvelle fenêtre est décalée de la précédente,
 * et on repart en haut à gauche quand la diagonale sort de la zone.
 */
export function positionCascade(
  nbOuvertes: number,
  taille: { largeur: number; hauteur: number },
  zone: { l: number; h: number },
): { x: number; y: number } {
  const pas = 28
  const maxRangs = Math.max(1, Math.floor((zone.h - HAUTEUR_BARRE_HAUT - HAUTEUR_BARRE_BAS - taille.hauteur) / pas))
  const rang = nbOuvertes % maxRangs
  return {
    x: Math.min(MARGE + rang * pas, Math.max(MARGE, zone.l - taille.largeur - MARGE)),
    y: HAUTEUR_BARRE_HAUT + MARGE + rang * pas,
  }
}

/* ————————————————————————— Ancrage aux bords ————————————————————————— */

export type CoteAncrage = 'plein' | 'gauche' | 'droite' | 'no' | 'ne' | 'so' | 'se'

/** Distance au bord (px) en deçà de laquelle le glisser propose un ancrage. */
export const SEUIL_BORD_ANCRAGE = 16
/** Longueur (px) des zones de coin le long des bords gauche et droit. */
export const SEUIL_COIN_ANCRAGE = 110

/**
 * Côté d'ancrage proposé pour une position de POINTEUR (pas de fenêtre) :
 * bord gauche ou droit → moitié d'écran, leurs extrémités → quart, bord haut →
 * plein écran. Le bas est laissé libre — c'est la barre des tâches.
 */
export function coteAncrageDepuisPointeur(
  x: number,
  y: number,
  zone: { l: number; h: number },
): CoteAncrage | null {
  const gauche = x <= SEUIL_BORD_ANCRAGE
  const droite = x >= zone.l - SEUIL_BORD_ANCRAGE
  if (gauche || droite) {
    if (y <= HAUTEUR_BARRE_HAUT + SEUIL_COIN_ANCRAGE) return gauche ? 'no' : 'ne'
    if (y >= zone.h - HAUTEUR_BARRE_BAS - SEUIL_COIN_ANCRAGE) return gauche ? 'so' : 'se'
    return gauche ? 'gauche' : 'droite'
  }
  if (y <= SEUIL_BORD_ANCRAGE) return 'plein'
  return null
}

/** Géométrie cible d'un ancrage : la zone utile entre les deux barres. */
export function geometrieAncrage(cote: CoteAncrage, zone: { l: number; h: number }): Geometrie {
  const y0 = HAUTEUR_BARRE_HAUT
  const l = zone.l
  const h = zone.h - HAUTEUR_BARRE_HAUT - HAUTEUR_BARRE_BAS
  // Les moitiés carrellent exactement : demi + (total − demi) = total, sans
  // pixel perdu ni recouvert quand la largeur est impaire.
  const demiL = Math.round(l / 2)
  const demiH = Math.round(h / 2)
  switch (cote) {
    case 'plein':
      return { x: 0, y: y0, largeur: l, hauteur: h }
    case 'gauche':
      return { x: 0, y: y0, largeur: demiL, hauteur: h }
    case 'droite':
      return { x: demiL, y: y0, largeur: l - demiL, hauteur: h }
    case 'no':
      return { x: 0, y: y0, largeur: demiL, hauteur: demiH }
    case 'ne':
      return { x: demiL, y: y0, largeur: l - demiL, hauteur: demiH }
    case 'so':
      return { x: 0, y: y0 + demiH, largeur: demiL, hauteur: h - demiH }
    case 'se':
      return { x: demiL, y: y0 + demiH, largeur: l - demiL, hauteur: h - demiH }
  }
}

/** Découpe la zone en grille pour ranger toutes les fenêtres ouvertes. */
export function grilleMosaique(
  n: number,
  zone: { l: number; h: number },
): Geometrie[] {
  if (n === 0) return []
  const colonnes = Math.ceil(Math.sqrt(n))
  const lignes = Math.ceil(n / colonnes)
  const hauteurUtile = zone.h - HAUTEUR_BARRE_HAUT - HAUTEUR_BARRE_BAS
  const largeurCase = Math.floor((zone.l - MARGE * (colonnes + 1)) / colonnes)
  const hauteurCase = Math.floor((hauteurUtile - MARGE * (lignes + 1)) / lignes)
  const out: Geometrie[] = []
  for (let i = 0; i < n; i++) {
    const c = i % colonnes
    const l = Math.floor(i / colonnes)
    out.push({
      x: MARGE + c * (largeurCase + MARGE),
      y: HAUTEUR_BARRE_HAUT + MARGE + l * (hauteurCase + MARGE),
      largeur: Math.max(LARGEUR_MIN, largeurCase),
      hauteur: Math.max(HAUTEUR_MIN, hauteurCase),
    })
  }
  return out
}

/* ————————————————————————————— Le store ————————————————————————————— */

interface EtatFenetres {
  fenetres: FenetreOuverte[]
  paletteOuverte: boolean

  zone: () => { l: number; h: number }
  ouvrir: (id: IdFenetre) => void
  fermer: (id: IdFenetre) => void
  basculer: (id: IdFenetre) => void
  focaliser: (id: IdFenetre) => void
  deplacer: (id: IdFenetre, x: number, y: number) => void
  redimensionner: (id: IdFenetre, g: Geometrie) => void
  ancrer: (id: IdFenetre, cote: CoteAncrage) => void
  basculerReduction: (id: IdFenetre) => void
  basculerAgrandissement: (id: IdFenetre) => void
  mosaique: () => void
  toutFermer: () => void
  definirPalette: (ouverte: boolean) => void
}

const CLE_DISPOSITION = 'corpus:fenetres'

function zoneCourante(): { l: number; h: number } {
  if (typeof window === 'undefined') return { l: 1440, h: 900 }
  return { l: window.innerWidth, h: window.innerHeight }
}

function lireDisposition(): FenetreOuverte[] | null {
  try {
    const brut = localStorage.getItem(CLE_DISPOSITION)
    if (!brut) return null
    const donnees: unknown = JSON.parse(brut)
    if (!Array.isArray(donnees)) return null
    const zone = zoneCourante()
    const valides: FenetreOuverte[] = []
    for (const f of donnees) {
      if (typeof f !== 'object' || f === null) continue
      const o = f as Record<string, unknown>
      // Une fenêtre retirée du registre entre deux versions doit être ignorée,
      // pas ressuscitée en composant introuvable.
      if (!estIdFenetre(o.id)) continue
      if (typeof o.x !== 'number' || typeof o.y !== 'number') continue
      if (typeof o.largeur !== 'number' || typeof o.hauteur !== 'number') continue
      const g = clamperGeometrie(
        { x: o.x, y: o.y, largeur: o.largeur, hauteur: o.hauteur },
        zone,
      )
      valides.push({
        id: o.id,
        ...g,
        z: typeof o.z === 'number' ? o.z : Z_MIN,
        reduite: o.reduite === true,
      })
    }
    return valides.length > 0 ? normaliserOrdreZ(valides) : null
  } catch {
    return null
  }
}

function ecrireDisposition(fenetres: FenetreOuverte[]): void {
  try {
    localStorage.setItem(CLE_DISPOSITION, JSON.stringify(fenetres))
  } catch {
    // Persistance best-effort : une disposition perdue n'est pas un incident.
  }
}

function dispositionInitiale(): FenetreOuverte[] {
  const enregistree = lireDisposition()
  if (enregistree) return enregistree
  const zone = zoneCourante()
  return FENETRES_PAR_DEFAUT.map((id, i) => {
    const def = definitionFenetre(id)
    const taille = { largeur: def.largeur, hauteur: def.hauteur }
    const pos = positionCascade(i, taille, zone)
    return { id, ...clamperGeometrie({ ...pos, ...taille }, zone), z: Z_MIN + i, reduite: false }
  })
}

export const storeFenetres = createStore<EtatFenetres>((set, get) => {
  const appliquer = (fenetres: FenetreOuverte[]) => {
    set({ fenetres })
    ecrireDisposition(fenetres)
  }

  return {
    fenetres: dispositionInitiale(),
    paletteOuverte: false,

    zone: zoneCourante,

    ouvrir: (id) => {
      const { fenetres } = get()
      const existante = fenetres.find((f) => f.id === id)
      if (existante) {
        appliquer(mettreAuSommet(fenetres.map((f) => (f.id === id ? { ...f, reduite: false } : f)), id))
        return
      }
      const def = definitionFenetre(id)
      const zone = zoneCourante()
      const taille = { largeur: def.largeur, hauteur: def.hauteur }
      const pos = positionCascade(fenetres.length, taille, zone)
      const z = fenetres.length === 0 ? Z_MIN : Math.max(...fenetres.map((f) => f.z)) + 1
      appliquer([
        ...fenetres,
        { id, ...clamperGeometrie({ ...pos, ...taille }, zone), z, reduite: false },
      ])
    },

    fermer: (id) => appliquer(get().fenetres.filter((f) => f.id !== id)),

    basculer: (id) => {
      const ouverte = get().fenetres.find((f) => f.id === id)
      if (ouverte && !ouverte.reduite) get().fermer(id)
      else get().ouvrir(id)
    },

    focaliser: (id) => appliquer(mettreAuSommet(get().fenetres, id)),

    deplacer: (id, x, y) =>
      appliquer(
        get().fenetres.map((f) =>
          f.id === id
            ? { ...f, ...clamperGeometrie({ ...f, x, y }, zoneCourante()), avantAgrandissement: undefined }
            : f,
        ),
      ),

    redimensionner: (id, g) =>
      appliquer(
        get().fenetres.map((f) =>
          f.id === id
            ? // Redimensionner à la main sort de l'état ancré/agrandi : la
              // géométrie de restauration n'a plus de sens.
              { ...f, ...clamperGeometrie(g, zoneCourante()), avantAgrandissement: undefined }
            : f,
        ),
      ),

    ancrer: (id, cote) => {
      const zone = zoneCourante()
      appliquer(
        get().fenetres.map((f) => {
          if (f.id !== id) return f
          return {
            ...f,
            ...clamperGeometrie(geometrieAncrage(cote, zone), zone),
            // La géométrie d'avant le PREMIER ancrage : enchaîner gauche puis
            // droite ne doit pas faire d'une moitié la taille « d'origine ».
            avantAgrandissement:
              f.avantAgrandissement ?? { x: f.x, y: f.y, largeur: f.largeur, hauteur: f.hauteur },
          }
        }),
      )
    },

    basculerReduction: (id) =>
      appliquer(get().fenetres.map((f) => (f.id === id ? { ...f, reduite: !f.reduite } : f))),

    basculerAgrandissement: (id) => {
      const zone = zoneCourante()
      appliquer(
        get().fenetres.map((f) => {
          if (f.id !== id) return f
          if (f.avantAgrandissement) {
            return { ...f, ...clamperGeometrie(f.avantAgrandissement, zone), avantAgrandissement: undefined }
          }
          return {
            ...f,
            avantAgrandissement: { x: f.x, y: f.y, largeur: f.largeur, hauteur: f.hauteur },
            x: MARGE,
            y: HAUTEUR_BARRE_HAUT + MARGE,
            largeur: zone.l - MARGE * 2,
            hauteur: zone.h - HAUTEUR_BARRE_HAUT - HAUTEUR_BARRE_BAS - MARGE * 2,
          }
        }),
      )
    },

    mosaique: () => {
      const visibles = get().fenetres.filter((f) => !f.reduite)
      const cases = grilleMosaique(visibles.length, zoneCourante())
      let k = 0
      appliquer(
        get().fenetres.map((f) => {
          if (f.reduite) return f
          const c = cases[k++]!
          return { ...f, ...c, avantAgrandissement: undefined }
        }),
      )
    },

    toutFermer: () => appliquer([]),

    definirPalette: (ouverte) => set({ paletteOuverte: ouverte }),
  }
})
