import { describe, expect, it } from 'vitest'
import {
  clamperGeometrie,
  coteAncrageDepuisPointeur,
  geometrieAncrage,
  grilleMosaique,
  HAUTEUR_BARRE_BAS,
  HAUTEUR_BARRE_HAUT,
  HAUTEUR_MIN,
  LARGEUR_MIN,
  mettreAuSommet,
  normaliserOrdreZ,
  positionCascade,
  Z_MIN,
  type FenetreOuverte,
} from './gestionnaireFenetres'
import { REGISTRE_FENETRES, estIdFenetre } from './registre'

const ZONE = { l: 1600, h: 1000 }

// De vrais identifiants du registre : IdFenetre est une union littérale, des
// noms inventés ne typeraient pas — et c'est précisément la garantie voulue.
const A = 'bilan'
const B = 'series'
const C = 'charge'

function fenetre(id: typeof A | typeof B | typeof C, z: number): FenetreOuverte {
  return { id, x: 0, y: 60, largeur: 400, hauteur: 300, z, reduite: false }
}

describe('registre', () => {
  it('n’a ni identifiant ni mnémonique en double', () => {
    const ids = REGISTRE_FENETRES.map((f) => f.id)
    const mnemos = REGISTRE_FENETRES.map((f) => f.mnemonique)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(mnemos).size).toBe(mnemos.length)
  })

  it('donne à chaque mnémonique quatre caractères', () => {
    for (const f of REGISTRE_FENETRES) expect(f.mnemonique).toHaveLength(4)
  })

  it('reconnaît ses identifiants et rejette les autres', () => {
    expect(estIdFenetre('bilan')).toBe(true)
    expect(estIdFenetre('inexistante')).toBe(false)
    expect(estIdFenetre(42)).toBe(false)
  })
})

describe('normaliserOrdreZ', () => {
  it('renumérote sans changer l’ordre relatif', () => {
    const r = normaliserOrdreZ([fenetre(A, 500), fenetre(B, 12), fenetre(C, 900)])
    expect(r.find((f) => f.id === B)!.z).toBe(Z_MIN)
    expect(r.find((f) => f.id === A)!.z).toBe(Z_MIN + 1)
    expect(r.find((f) => f.id === C)!.z).toBe(Z_MIN + 2)
  })
})

describe('mettreAuSommet', () => {
  it('place la fenêtre visée au-dessus des autres', () => {
    const r = mettreAuSommet([fenetre(A, 1), fenetre(B, 2), fenetre(C, 3)], A)
    const za = r.find((f) => f.id === A)!.z
    expect(za).toBeGreaterThan(r.find((f) => f.id === C)!.z)
  })

  it('ne fait rien si elle est déjà au sommet', () => {
    const avant = [fenetre(A, 1), fenetre(B, 2)]
    expect(mettreAuSommet(avant, B)).toBe(avant)
  })

  it('renumérote plutôt que de dériver indéfiniment', () => {
    const r = mettreAuSommet([fenetre(A, 199), fenetre(B, 200)], A)
    for (const f of r) expect(f.z).toBeLessThanOrEqual(200)
  })

  it('ignore un identifiant absent', () => {
    const avant = [fenetre(A, 1)]
    expect(mettreAuSommet(avant, 'inconnue' as FenetreOuverte['id'])).toBe(avant)
  })
})

describe('clamperGeometrie', () => {
  it('impose les tailles minimales', () => {
    const g = clamperGeometrie({ x: 10, y: 100, largeur: 10, hauteur: 10 }, ZONE)
    expect(g.largeur).toBe(LARGEUR_MIN)
    expect(g.hauteur).toBe(HAUTEUR_MIN)
  })

  it('garde la barre de titre attrapable', () => {
    // Une fenêtre poussée loin en haut ou à droite deviendrait impossible à
    // rattraper à la souris : on borne la position, pas seulement la taille.
    const g = clamperGeometrie({ x: 99999, y: -5000, largeur: 400, hauteur: 300 }, ZONE)
    expect(g.x).toBeLessThanOrEqual(ZONE.l - 80)
    expect(g.y).toBeGreaterThanOrEqual(HAUTEUR_BARRE_HAUT)
  })

  it('autorise un débord partiel à droite', () => {
    const g = clamperGeometrie({ x: 1400, y: 100, largeur: 400, hauteur: 300 }, ZONE)
    expect(g.x).toBe(1400)
  })

  it('ne laisse pas une fenêtre dépasser la hauteur utile', () => {
    const g = clamperGeometrie({ x: 0, y: 60, largeur: 400, hauteur: 99999 }, ZONE)
    expect(g.hauteur).toBeLessThanOrEqual(ZONE.h - HAUTEUR_BARRE_HAUT)
  })
})

describe('positionCascade', () => {
  it('décale chaque nouvelle fenêtre', () => {
    const taille = { largeur: 400, hauteur: 300 }
    const p0 = positionCascade(0, taille, ZONE)
    const p1 = positionCascade(1, taille, ZONE)
    expect(p1.x).toBeGreaterThan(p0.x)
    expect(p1.y).toBeGreaterThan(p0.y)
  })

  it('repart du haut quand la diagonale sort de la zone', () => {
    const taille = { largeur: 400, hauteur: 300 }
    const positions = Array.from({ length: 40 }, (_, i) => positionCascade(i, taille, ZONE))
    for (const p of positions) {
      expect(p.y).toBeLessThan(ZONE.h)
      expect(p.y).toBeGreaterThanOrEqual(HAUTEUR_BARRE_HAUT)
    }
    // La suite doit boucler et non filer indéfiniment vers le bas.
    expect(new Set(positions.map((p) => p.y)).size).toBeLessThan(40)
  })
})

describe('coteAncrageDepuisPointeur', () => {
  it('propose une moitié sur les bords gauche et droit', () => {
    expect(coteAncrageDepuisPointeur(5, 500, ZONE)).toBe('gauche')
    expect(coteAncrageDepuisPointeur(ZONE.l - 5, 500, ZONE)).toBe('droite')
  })

  it('propose un quart aux extrémités de ces bords', () => {
    expect(coteAncrageDepuisPointeur(5, HAUTEUR_BARRE_HAUT + 10, ZONE)).toBe('no')
    expect(coteAncrageDepuisPointeur(ZONE.l - 5, HAUTEUR_BARRE_HAUT + 10, ZONE)).toBe('ne')
    expect(coteAncrageDepuisPointeur(5, ZONE.h - 10, ZONE)).toBe('so')
    expect(coteAncrageDepuisPointeur(ZONE.l - 5, ZONE.h - 10, ZONE)).toBe('se')
  })

  it('propose le plein écran sur le bord haut', () => {
    expect(coteAncrageDepuisPointeur(800, 5, ZONE)).toBe('plein')
  })

  it('ne propose rien au centre ni sur le bord bas', () => {
    expect(coteAncrageDepuisPointeur(800, 500, ZONE)).toBeNull()
    // Le bas, c'est la barre des tâches : y ancrer serait un piège à clics.
    expect(coteAncrageDepuisPointeur(800, ZONE.h - 5, ZONE)).toBeNull()
  })
})

describe('geometrieAncrage', () => {
  const utile = ZONE.h - HAUTEUR_BARRE_HAUT - HAUTEUR_BARRE_BAS

  it('fait carreler exactement les deux moitiés, même sur largeur impaire', () => {
    const zone = { l: 1601, h: 1000 }
    const g = geometrieAncrage('gauche', zone)
    const d = geometrieAncrage('droite', zone)
    expect(g.x).toBe(0)
    expect(g.largeur + d.largeur).toBe(zone.l)
    expect(d.x).toBe(g.largeur)
  })

  it('occupe toute la zone utile entre les barres en plein écran', () => {
    const p = geometrieAncrage('plein', ZONE)
    expect(p).toEqual({ x: 0, y: HAUTEUR_BARRE_HAUT, largeur: ZONE.l, hauteur: utile })
  })

  it('fait carreler les quatre quarts', () => {
    const quarts = (['no', 'ne', 'so', 'se'] as const).map((c) => geometrieAncrage(c, ZONE))
    const surface = quarts.reduce((s, q) => s + q.largeur * q.hauteur, 0)
    expect(surface).toBe(ZONE.l * utile)
    // Les quarts du bas commencent là où ceux du haut s'arrêtent.
    expect(quarts[2]!.y).toBe(quarts[0]!.y + quarts[0]!.hauteur)
  })
})

describe('grilleMosaique', () => {
  it('rend autant de cases que de fenêtres', () => {
    for (const n of [1, 2, 3, 5, 8]) expect(grilleMosaique(n, ZONE)).toHaveLength(n)
  })

  it('ne rend rien pour zéro fenêtre', () => {
    expect(grilleMosaique(0, ZONE)).toEqual([])
  })

  it('ne fait pas se chevaucher les cases', () => {
    const cases = grilleMosaique(4, ZONE)
    for (let i = 0; i < cases.length; i++) {
      for (let j = i + 1; j < cases.length; j++) {
        const a = cases[i]!
        const b = cases[j]!
        const disjoint =
          a.x + a.largeur <= b.x ||
          b.x + b.largeur <= a.x ||
          a.y + a.hauteur <= b.y ||
          b.y + b.hauteur <= a.y
        expect(disjoint, `cases ${i} et ${j} se chevauchent`).toBe(true)
      }
    }
  })

  it('respecte les tailles minimales même sur une petite zone', () => {
    for (const c of grilleMosaique(9, { l: 800, h: 600 })) {
      expect(c.largeur).toBeGreaterThanOrEqual(LARGEUR_MIN)
      expect(c.hauteur).toBeGreaterThanOrEqual(HAUTEUR_MIN)
    }
  })
})
