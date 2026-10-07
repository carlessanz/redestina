// El estado del buscador de un listado: lo que hay escrito y la consulta ya normalizada.
// La regla de comparación vive en `lib/cerca.ts`; esto solo evita repetir el `useState` y
// el `trim().toLowerCase()` en cada pantalla.

import { useState } from 'react'
import { consultaCerca } from '../lib/cerca'

export function useCerca(inicial = '') {
  const [cerca, setCerca] = useState(inicial)
  /** La consulta para `casaCerca`/`filtraCerca`: sin espacios en los extremos y en minúsculas. */
  const q = consultaCerca(cerca)
  return { cerca, setCerca, q }
}
