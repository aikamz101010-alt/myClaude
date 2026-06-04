import './styles/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme, useThemeStore } from './store/themeStore'

// WKWebView (the webview Tauri ships) fails to decode GLB-embedded textures via
// `createImageBitmap` under the packaged app's custom URL scheme — three.js'
// GLTFLoader picks the ImageBitmapLoader path for Safari ≥17, so every VRM
// material renders pure white in the .dmg build (geometry loads, textures don't).
// Clearing `createImageBitmap` forces GLTFLoader onto the HTMLImageElement path,
// which the webview handles correctly. Nothing else in the app uses it, and the
// HTMLImage path works identically in dev, so this is safe everywhere.
;(window as unknown as { createImageBitmap?: unknown }).createImageBitmap = undefined

// Apply saved theme before first paint (avoids flash)
const savedTheme = useThemeStore.getState().theme
applyTheme(savedTheme)

// Watch system preference changes when theme = 'system'
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { theme } = useThemeStore.getState()
  if (theme === 'system') applyTheme('system')
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
