import { useEffect, useState } from 'react'

/**
 * Nom du thème courant, en tant qu'état React.
 *
 * Un canvas lit les couleurs du thème AU MOMENT DU DESSIN, mais son redessin
 * est déclenché par les dépendances React — données, domaine, taille — parmi
 * lesquelles le thème ne figure pas. Sans ce crochet, changer de thème
 * repeignait toute l'interface en DOM tout en laissant les courbes dans les
 * couleurs de l'ancien thème. Aucun test unitaire ne peut voir ce défaut : il
 * ne se constate qu'à l'œil.
 *
 * On observe l'attribut sur <html> plutôt que de s'abonner au store de thème :
 * le module `ui/` reste indépendant de `shell/`, et le crochet attrape aussi
 * un changement de thème venu d'ailleurs.
 */
export function useThemeCanvas(): string {
  const [theme, setTheme] = useState(() =>
    typeof document === 'undefined'
      ? 'nuit'
      : (document.documentElement.getAttribute('data-theme') ?? 'nuit'),
  )

  useEffect(() => {
    const cible = document.documentElement
    const observateur = new MutationObserver(() => {
      setTheme(cible.getAttribute('data-theme') ?? 'nuit')
    })
    observateur.observe(cible, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observateur.disconnect()
  }, [])

  return theme
}
