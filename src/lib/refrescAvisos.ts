// Las bandas y las marcas del panel (convenio, ficha incompleta, diagnóstico, contadores de
// «Documents») viven en `AppShell`, que es un layout PERSISTENTE: se calculan al montar y no
// se volvían a leer. Así, tras guardar la ficha, firmar el convenio o emitir el plan, la banda
// seguía pidiendo lo que ya estaba hecho hasta recargar la página (revisión del 28-09-2026).
//
// Esto es un contador de módulo: quien hace algo que cambia una banda llama a
// `refrescaAvisos()`, y los hooks que las calculan incluyen `useTicAvisos()` en sus
// dependencias. Mismo patrón que `refrescaComptadors()` del equipo (`pendentsEquip.ts`).

import { useSyncExternalStore } from 'react'

let tic = 0
const oients = new Set<() => void>()

/** Pide a todas las bandas y contadores del panel que se vuelvan a calcular. */
export function refrescaAvisos(): void {
  tic++
  for (const o of oients) o()
}

/** Un número que cambia cada vez que alguien llama a `refrescaAvisos()`. */
export function useTicAvisos(): number {
  return useSyncExternalStore(
    (o) => { oients.add(o); return () => { oients.delete(o) } },
    () => tic,
    () => tic,
  )
}
