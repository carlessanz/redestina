// Descargar un PDF, con la espera de «Generant…» incluida.
//
// Las tres pantallas de la fase 1 y la 3 (`equip/Documents`, `equip/AlbaraDetall`) repetían
// la misma secuencia de veinte líneas: pedir la URL firmada, y si el servidor contesta que
// todavía no hay fichero, esperar por polling a que la Edge Function acabe y reintentar una
// vez. La fase 4 la necesita en cuatro sitios más —el detalle del cierre, los dos paneles
// de organización—, así que aquí deja de copiarse.
//
// Lo que NO hace: construir ninguna URL de Storage. La única puerta al bucket sigue siendo
// `descarregarDocument()` (§B.3), y este hook solo la llama.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { descarregarDocument, esperarGeneracio } from '../lib/documents'

export interface Descarregador {
  /** Id del documento cuya descarga está en curso; `null` si no hay ninguna. */
  ocupat: string | null
  /** Id del documento cuyo PDF se está esperando («Generant…»). */
  generant: string | null
  descarrega: (documentoId: string) => Promise<void>
}

/**
 * @param onAcabat se llama cuando la espera termina, para que la pantalla refresque la
 *   fila (el estado del documento ya no dirá «pendent de PDF»).
 */
export function useDescarregaDocument(onAcabat?: () => void | Promise<void>): Descarregador {
  const { t } = useT()
  const [ocupat, setOcupat] = useState<string | null>(null)
  const [generant, setGenerant] = useState<string | null>(null)
  // La espera puede durar 30 s: si la pantalla se desmonta antes, hay que cortarla.
  const avortar = useRef<AbortController | null>(null)
  // El callback en una ref: si la pantalla lo redefine en cada render (y lo hace, porque
  // suele ser una función inline), meterlo en las dependencias recrearía `descarrega` en
  // cada render y con ella cualquier efecto que dependa de él.
  const acabat = useRef(onAcabat)
  acabat.current = onAcabat

  useEffect(() => () => avortar.current?.abort(), [])

  const descarrega = useCallback(async (documentoId: string) => {
    setOcupat(documentoId)
    const res = await descarregarDocument(documentoId)

    if (res.ok) {
      toast.success(t('doc.downloaded', { name: res.data.nombre }))
      setOcupat(null)
      return
    }
    // Cualquier motivo que no sea «todavía no hay fichero» se cuenta y se acaba aquí.
    if (res.codi !== 'sense_fitxer') {
      toast.error(t(res.motiuKey))
      setOcupat(null)
      return
    }

    setGenerant(documentoId)
    toast.info(t('doc.generating_wait'))
    avortar.current?.abort()
    const control = new AbortController()
    avortar.current = control

    const espera = await esperarGeneracio(documentoId, control.signal)
    setGenerant(null)

    if (espera.resultat === 'cancellat') { setOcupat(null); return }
    if (espera.resultat !== 'emitido') {
      if (espera.motiuKey) toast.error(t(espera.motiuKey))
      await acabat.current?.()
      setOcupat(null)
      return
    }

    const segon = await descarregarDocument(documentoId)
    if (segon.ok) toast.success(t('doc.downloaded', { name: segon.data.nombre }))
    else toast.error(t(segon.motiuKey))
    await acabat.current?.()
    setOcupat(null)
  }, [t])

  return { ocupat, generant, descarrega }
}
