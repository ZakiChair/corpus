import { defineConfig } from '@playwright/test'

/**
 * Harnais E2E : la leçon fondatrice du projet est que les défauts d'interface
 * se voient dans le navigateur et échappent aux tests unitaires. Ces tests
 * scriptent exactement les vérifications faites à la main à chaque livraison —
 * fenêtres à leur taille PAR DÉFAUT, chemins d'ÉCRITURE exercés.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5230',
    viewport: { width: 1600, height: 1000 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5230',
    reuseExistingServer: true,
  },
})
