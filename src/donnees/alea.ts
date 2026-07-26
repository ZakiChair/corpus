/**
 * Générateur pseudo-aléatoire à graine.
 *
 * Math.random n'est pas reproductible : deux exécutions donneraient deux
 * historiques différents, donc des tests non déterministes. Mulberry32 tient en
 * quelques lignes, passe les tests statistiques usuels et se réamorce à
 * l'identique depuis un entier.
 */
export type Alea = () => number

export function creerAlea(graine: number): Alea {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Tirage gaussien centré réduit, par la transformée de Box-Muller. */
export function normale(alea: Alea): number {
  // u strictement positif : log(0) diverge.
  const u = 1 - alea()
  const v = alea()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function gaussienne(alea: Alea, moyenne: number, ecartType: number): number {
  return moyenne + ecartType * normale(alea)
}

export function entre(alea: Alea, min: number, max: number): number {
  return min + alea() * (max - min)
}

export function entierEntre(alea: Alea, min: number, max: number): number {
  return Math.floor(entre(alea, min, max + 1))
}

export function tirage(alea: Alea, probabilite: number): boolean {
  return alea() < probabilite
}

export function borner(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}
