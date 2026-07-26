import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { appliquerThemeInitial } from './shell/theme'

// Le thème est posé sur <html> avant le premier rendu : sinon un flash clair
// apparaît le temps que React monte.
appliquerThemeInitial()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
