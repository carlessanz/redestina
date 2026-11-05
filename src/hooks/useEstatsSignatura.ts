// El estado de firma de los documentos que una pantalla ya tiene cargados (05-11-2026).
//
// Va aparte de la lectura de `documentos` a propósito: es **fail-soft** —si la vista no
// responde, la pantalla se pinta igual, sin etiquetas de firma— y se puede releer sola tras
// firmar o subir sin volver a pedir todo el archivo (subir un fichero no cambia la versión
// vigente hasta que el super_admin la cierra, así que la lista de ids no se mueve).

import { useCallback, useEffect, useState } from 'react'
import { carregaEstatsSignatura } from '../lib/documents'
import type { SignaturaDocument } from '../types'

export function useEstatsSignatura(ids: string[]) {
  const [perDoc, setPerDoc] = useState<Record<string, SignaturaDocument>>({})
  // La clave estable de la lista: un array nuevo con los mismos ids no relee.
  const clau = [...ids].sort().join(',')

  const recarrega = useCallback(async () => {
    const llista = clau ? clau.split(',') : []
    setPerDoc(await carregaEstatsSignatura(llista))
  }, [clau])

  useEffect(() => { void recarrega() }, [recarrega])

  return { perDoc, recarrega }
}
