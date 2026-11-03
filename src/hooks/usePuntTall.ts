// ¿La ventana llega a este punto de corte de Tailwind? (03-11-2026)
//
// Para las tablas que esconden columnas por ancho (`hidden md:table-cell`): una fila que
// ocupa toda la tabla —la de editar, por ejemplo— necesita un `colSpan` igual al número de
// columnas VISIBLES. Uno mayor crea columnas fantasma que se comen el ancho; las columnas
// con `display: none` no cuentan. Los valores son los de Tailwind v4 por defecto.

import { useSyncExternalStore } from 'react'

const PUNTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const
export type PuntTall = keyof typeof PUNTS

export function usePuntTall(punt: PuntTall): boolean {
  const consulta = `(min-width: ${PUNTS[punt]}px)`
  return useSyncExternalStore(
    (avisa) => {
      const mql = window.matchMedia(consulta)
      mql.addEventListener('change', avisa)
      return () => mql.removeEventListener('change', avisa)
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  )
}
