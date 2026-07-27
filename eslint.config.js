import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Garde-fous seulement : les recommandés JS/TS attrapent les vraies fautes
 * (variables mortes, comparaisons impossibles), et les deux règles classiques
 * de react-hooks attrapent l'ordre d'appel et les dépendances d'effets
 * fausses — la famille de bugs qui a laissé les gestes canvas morts. Les
 * règles « compiler » de react-hooks v6 sont laissées de côté : elles
 * condamnent les miroirs en ref, un pattern volontaire ici (écouteurs natifs).
 * Pas de règles stylistiques : le style, c'est le relecteur.
 */
export default defineConfig(
  { ignores: ['dist', 'node_modules', '.worktrees', '.remember', 'test-results', 'playwright-report', 'public'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)
