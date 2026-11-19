// Un diálogo que se abre desde la URL (fase 4 de los puntos 4-6, Excel 4.2 y 5.4).
//
// Los enlaces de los mensajes llevan a una pantalla CON algo abierto: la oferta del Mercat con
// el formulario de interés, la operación con «Registra la recollida»… Este hook lee esos
// parámetros de la query (`?oferta=…&accio=interes`) y los escribe al abrir y al cerrar.
//
// ⚠️ `replace: true` SIEMPRE: abrir y cerrar un diálogo no es navegar. Con `push`, el botón
//    «enrere» del móvil reabriría el diálogo que se acaba de cerrar en vez de salir de la
//    pantalla. Y `preventScrollReset`: cambiar la query no debe subir la página.
//
// Lo que NO hace: decidir qué significa el parámetro ni comprobar que lo pedido exista. Eso es
// de cada pantalla, que tiene los datos y sabe qué decir si ya no está disponible.

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

export interface DialegPerUrl<K extends string> {
  /** El valor de cada parámetro en la URL (`null` si no está). */
  valors: Record<K, string | null>
  /** Escribe los parámetros dados (vacío o `null` = lo quita); los demás de `claus`, fuera. */
  obre: (v: Partial<Record<K, string | null>>) => void
  /** Quita de la URL todos los parámetros de `claus`. */
  tanca: () => void
}

export function useDialegPerUrl<K extends string>(claus: readonly K[]): DialegPerUrl<K> {
  const [params, setParams] = useSearchParams()
  // Las claves, como texto: el array lo crea quien llama en cada render y no puede ser dependencia.
  const clausText = claus.join('|')

  const valors = useMemo(() => {
    const v = {} as Record<K, string | null>
    for (const k of clausText.split('|') as K[]) v[k] = params.get(k)
    return v
  }, [params, clausText])

  const obre = useCallback((nous: Partial<Record<K, string | null>>) => {
    setParams((actuals) => {
      const n = new URLSearchParams(actuals)
      for (const k of clausText.split('|') as K[]) {
        const x = nous[k]
        if (x) n.set(k, x)
        else n.delete(k)
      }
      return n
    }, { replace: true, preventScrollReset: true })
  }, [setParams, clausText])

  const tanca = useCallback(() => {
    setParams((actuals) => {
      const n = new URLSearchParams(actuals)
      for (const k of clausText.split('|')) n.delete(k)
      return n
    }, { replace: true, preventScrollReset: true })
  }, [setParams, clausText])

  return { valors, obre, tanca }
}
