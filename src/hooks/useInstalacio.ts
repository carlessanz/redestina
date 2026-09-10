// ¿Se puede ofrecer instalar Redestina en este dispositivo, y de qué manera?
//
// La aplicación ya es una PWA instalable (vite.config.ts). Lo que faltaba era que
// alguien se enterara: el navegador esconde la opción en un menú que nadie abre.
//
// DOS CAMINOS, y no son intercambiables:
//
//   · Android/Chrome dispara `beforeinstallprompt`. Si lo interceptamos podemos
//     ofrecer un botón que abre el diálogo real del sistema.
//   · iOS/Safari NO dispara ese evento y no lo hará: Apple obliga a instalar a mano
//     desde Compartir → «Afegir a pantalla d'inici». Sin esta segunda rama, ningún
//     iPhone vería jamás el aviso, que es justo el caso que más nos importa.
//
// ⚠️ El evento llega UNA vez y suele llegar ANTES de que monte ningún componente, así
// que capturarlo dentro de un `useEffect` llega tarde y el aviso no saldría nunca. Lo
// captura `escoltaInstalacio()`, que se llama en `main.tsx` al arrancar, y lo guarda
// en el estado de módulo de aquí abajo; el hook solo se suscribe a él.

import { useCallback, useSyncExternalStore } from 'react'

/**
 * TypeScript no conoce este evento: no está en lib.dom porque no es estándar (es una
 * extensión de Chromium). Se declara aquí en vez de tocar `tsconfig.json`.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Cómo se puede instalar: no se puede · hay diálogo del sistema · hay que explicarlo. */
export type ModeInstalacio = 'no' | 'automatica' | 'manual-ios'

const CLAU_DESCARTAT = 'redestina-install-descartat'
/** Quien lo descarta no lo vuelve a ver en 30 días. */
const DIES_ESPERA = 30

// ── Estado de módulo ────────────────────────────────────────────────────────────
// Vive fuera de React porque el evento llega antes que React.

let esdeveniment: BeforeInstallPromptEvent | null = null
let instalada = false
let descartat = false
const oients = new Set<() => void>()

function avisa() { for (const f of oients) f() }

function subscriu(f: () => void) {
  oients.add(f)
  return () => { oients.delete(f) }
}

/** ¿Se está ejecutando ya como aplicación instalada? */
function jaInstalada(): boolean {
  if (instalada) return true
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // iOS no implementa `display-mode`: usa esta propiedad propia de Safari.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** iOS de verdad, incluido el iPad moderno, que se presenta como un Mac con táctil. */
function esIOS(): boolean {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/**
 * ¿Descartado hace menos de 30 días? Se guarda la FECHA, no un booleano: un booleano
 * no sabría expresar «vuelve a ofrecerlo dentro de un mes».
 */
function descartatFaPoc(): boolean {
  try {
    const quan = Number(localStorage.getItem(CLAU_DESCARTAT))
    return Number.isFinite(quan) && quan > 0 && Date.now() - quan < DIES_ESPERA * 86_400_000
  } catch {
    // Safari en navegación privada lanza al tocar localStorage. Mejor enseñar el aviso
    // de más que romper el panel entero por un recordatorio.
    return false
  }
}

/** El valor que lee el hook. Es un string para que `useSyncExternalStore` pueda
 *  compararlo por identidad sin recrear objetos en cada render. */
function llegeixMode(): ModeInstalacio {
  if (descartat || descartatFaPoc() || jaInstalada()) return 'no'
  if (esdeveniment) return 'automatica'
  return esIOS() ? 'manual-ios' : 'no'
}

/** Se llama UNA vez, en el arranque (`main.tsx`), antes de montar React. */
export function escoltaInstalacio() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Sin esto Chrome enseña su propia barra y perdemos el control del momento.
    e.preventDefault()
    esdeveniment = e as BeforeInstallPromptEvent
    avisa()
  })
  window.addEventListener('appinstalled', () => {
    instalada = true
    esdeveniment = null
    avisa()
  })
}

export function useInstalacio() {
  // En servidor no hay window; el tercer argumento evita reventar si algún día se
  // prerenderiza.
  const mode = useSyncExternalStore(subscriu, llegeixMode, () => 'no' as ModeInstalacio)

  const descarta = useCallback(() => {
    try { localStorage.setItem(CLAU_DESCARTAT, String(Date.now())) } catch { /* ver arriba */ }
    descartat = true
    avisa()
  }, [])

  /** Abre el diálogo del sistema. Devuelve si la persona aceptó. */
  const installa = useCallback(async (): Promise<boolean> => {
    const e = esdeveniment
    if (!e) return false
    // El evento es de un solo uso: reutilizarlo hace que Chrome lance.
    esdeveniment = null
    await e.prompt()
    const { outcome } = await e.userChoice
    // Si dice que no, no se lo volvemos a preguntar hasta dentro de 30 días.
    if (outcome !== 'accepted') descarta()
    avisa()
    return outcome === 'accepted'
  }, [descarta])

  return { mode, installa, descarta }
}
