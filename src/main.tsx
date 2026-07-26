import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { appliquerThemeInitial } from './shell/theme'

// Le thème est posé sur <html> avant le premier rendu : sinon un flash clair
// apparaît le temps que React monte.
appliquerThemeInitial()

// PWA : en production seulement — en développement, Vite sert à chaud et un
// worker qui met en cache rendrait chaque modification invisible.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
