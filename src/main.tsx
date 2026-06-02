import './styles/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme, useThemeStore } from './store/themeStore'

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
