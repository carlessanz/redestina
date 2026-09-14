// Los cinco badges del menú del equipo, derivados del store de `pendentsEquip.ts`.
//
// Es un hook aparte y no una línea dentro de `AppShell` para que cualquier pantalla del
// equipo pueda enseñar la misma cifra que el badge (el tablero, el título de cada cola de
// Aprovacions) sin volver a pedirla ni recalcularla de otra manera.

import { useMemo } from 'react'
import { comptadorsDePendents, usePendentsEquip } from '../lib/pendentsEquip'
import type { PendentEquip } from '../lib/pendentsEquip'
import type { Comptador } from '../lib/nav'

export function useComptadorsEquip(): {
  comptadors: Partial<Record<Comptador, number>>
  pendents: PendentEquip[]
  carregat: boolean
} {
  const { pendents, carregat } = usePendentsEquip()
  const comptadors = useMemo(() => comptadorsDePendents(pendents), [pendents])
  return { comptadors, pendents, carregat }
}
