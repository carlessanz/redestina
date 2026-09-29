import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './lib/i18n'
import { escoltaInstalacio } from './hooks/useInstalacio'
import { retiraServiceWorkers } from './lib/versio'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'

// ANTES de montar React, a propósito: `beforeinstallprompt` se dispara una sola vez y
// normalmente antes del primer render. Si se escuchara dentro de un componente,
// llegaría tarde y el aviso de instalación no saldría nunca en Android.
escoltaInstalacio()

// El service worker se retiró el 29-09-2026 (vite.config.ts): era lo que impedía ver los
// despliegues. Si alguno sigue registrado en este navegador, fuera.
if (import.meta.env.PROD) void retiraServiceWorkers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <TooltipProvider delayDuration={200}>
        <App />
      </TooltipProvider>
      <Toaster richColors position="top-right" />
    </I18nProvider>
  </StrictMode>,
)
