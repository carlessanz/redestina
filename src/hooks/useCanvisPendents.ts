// Aviso de cambios sin guardar (Taula mestra 1.1, 25-11-2026: «no perder información»).
//
// Con cambios pendientes en un formulario con «Desa»:
//   · una navegación INTERNA a otra pantalla (el menú, «Tornar», atrás del navegador) se
//     detiene con `useBlocker` de react-router y se pregunta con `DialegCanvisPendents`:
//     «Desa i surt» · «Surt sense desar» · «Continua editant»;
//   · cerrar o recargar la pestaña lo pregunta el propio navegador (`beforeunload`: su texto
//     no se puede cambiar).
// Solo bloquea si cambia la RUTA: cambiar de pestaña de la ficha (`?pestanya=`) no es salir.
//
// ⚠️ `useBlocker` exige un router de datos (`createBrowserRouter`, `src/router/index.tsx`) y
//    un solo bloqueador montado a la vez: lo usa la pantalla, nunca un componente repetido.
//
// Uso: `const avis = useCanvisPendents({ n, desa })` y `<DialegCanvisPendents {...avis.dialeg} />`.
// `permetSortida()` deja pasar la siguiente navegación sin preguntar (tras borrar la ficha,
// por ejemplo: ya no hay nada que guardar).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router'

export interface OpcionsCanvisPendents {
  /** Cuántos cambios hay sin guardar; 0 = ninguno (no se bloquea nada). */
  n: number
  /** Guarda. `true` si ha ido bien (y entonces se sale); `false` se queda en la pantalla. */
  desa: () => Promise<boolean>
}

export interface PropsDialegCanvisPendents {
  obert: boolean
  n: number
  desant: boolean
  onDesa: () => void
  onSurt: () => void
  onContinua: () => void
}

export function useCanvisPendents({ n, desa }: OpcionsCanvisPendents) {
  const pendent = n > 0
  const lliure = useRef(false)
  const [desant, setDesant] = useState(false)

  const bloqueja = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      pendent && !lliure.current && currentLocation.pathname !== nextLocation.pathname,
    [pendent],
  )
  const blocker = useBlocker(bloqueja)

  // Cerrar o recargar la pestaña del navegador.
  useEffect(() => {
    if (!pendent) return
    const avisa = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', avisa)
    return () => window.removeEventListener('beforeunload', avisa)
  }, [pendent])

  const onDesa = useCallback(async () => {
    if (blocker.state !== 'blocked') return
    setDesant(true)
    const ok = await desa()
    setDesant(false)
    if (ok) blocker.proceed()
    // Si no se ha podido guardar (un campo mal escrito), se queda: la ficha ya enseña el error.
    else blocker.reset()
  }, [blocker, desa])

  const dialeg: PropsDialegCanvisPendents = {
    obert: blocker.state === 'blocked',
    n,
    desant,
    onDesa: () => { void onDesa() },
    onSurt: () => { if (blocker.state === 'blocked') blocker.proceed() },
    onContinua: () => { if (blocker.state === 'blocked') blocker.reset() },
  }

  /** La próxima navegación sale sin preguntar (p. ej. tras borrar la ficha). */
  const permetSortida = useCallback(() => { lliure.current = true }, [])

  return { dialeg, permetSortida }
}
