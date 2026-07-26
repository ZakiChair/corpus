import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Port FIXE et STRICT. Les autres projets de l'atelier occupent 5173
    // (ATHLOS) et 5174/5176 (AXIOM) ; par défaut Vite se rabat silencieusement
    // sur le port suivant, si bien qu'on croit ouvrir CORPUS et qu'on se
    // retrouve dans une autre application. `strictPort` fait échouer le
    // démarrage au lieu de déplacer l'adresse sans le dire : mieux vaut une
    // erreur franche qu'une confusion silencieuse.
    port: 5230,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
