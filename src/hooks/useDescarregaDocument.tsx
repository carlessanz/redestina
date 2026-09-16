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
import { type Descarrega, descarregarDocument, esperarGeneracio, urlDocument } from '../lib/documents'
import { useIsMobile } from './use-mobile'
import VisorPdf, { type PdfObert } from '../components/VisorPdf'

export interface Descarregador {
  /** Id del documento cuya descarga está en curso; `null` si no hay ninguna. */
  ocupat: string | null
  /** Id del documento cuyo PDF se está esperando («Generant…»). */
  generant: string | null
  descarrega: (documentoId: string) => Promise<void>
  /**
   * Abre el PDF en el visor, sin descargarlo. En móvil abre una pestaña: iOS Safari no
   * renderiza un PDF dentro de un iframe de forma fiable (ver `VisorPdf`).
   */
  mostra: (documentoId: string) => Promise<void>
  /** El modal. La pantalla lo pinta donde quiera; sin esto el visor no aparece. */
  visor: React.ReactNode
}

/**
 * @param onAcabat se llama cuando la espera termina, para que la pantalla refresque la
 *   fila (el estado del documento ya no dirá «pendent de PDF»).
 */
export function useDescarregaDocument(onAcabat?: () => void | Promise<void>): Descarregador {
  const { t } = useT()
  const [ocupat, setOcupat] = useState<string | null>(null)
  const [generant, setGenerant] = useState<string | null>(null)
  const [pdf, setPdf] = useState<PdfObert | null>(null)
  const esMobil = useIsMobile()
  // La espera puede durar 30 s: si la pantalla se desmonta antes, hay que cortarla.
  const avortar = useRef<AbortController | null>(null)
  // El callback en una ref: si la pantalla lo redefine en cada render (y lo hace, porque
  // suele ser una función inline), meterlo en las dependencias recrearía `descarrega` en
  // cada render y con ella cualquier efecto que dependa de él.
  const acabat = useRef(onAcabat)
  acabat.current = onAcabat

  useEffect(() => () => avortar.current?.abort(), [])

  /**
   * Pide la URL y, si el PDF todavía se está generando, espera y reintenta UNA vez. Es la
   * parte que comparten ver y descargar: un documento recién emitido tarda unos segundos en
   * tener fichero, y eso no depende de qué quieras hacer con él después.
   *
   * Devuelve `null` cuando ya ha avisado del motivo — quien llama solo tiene que parar.
   */
  const obtenirUrl = useCallback(async (documentoId: string): Promise<Descarrega | null> => {
    const res = await urlDocument(documentoId)
    if (res.ok) return res.data
    if (res.codi !== 'sense_fitxer') { toast.error(t(res.motiuKey)); return null }

    setGenerant(documentoId)
    toast.info(t('doc.generating_wait'))
    avortar.current?.abort()
    const control = new AbortController()
    avortar.current = control

    const espera = await esperarGeneracio(documentoId, control.signal)
    setGenerant(null)

    if (espera.resultat === 'cancellat') return null
    if (espera.resultat !== 'emitido') {
      if (espera.motiuKey) toast.error(t(espera.motiuKey))
      await acabat.current?.()
      return null
    }

    const segon = await urlDocument(documentoId)
    await acabat.current?.()
    if (segon.ok) return segon.data
    toast.error(t(segon.motiuKey))
    return null
  }, [t])

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

  /**
   * Lo mismo que `descarrega`, pero al final ENSEÑA el PDF en vez de entregarlo. La espera
   * de «Generant…» es idéntica y por eso vive en `obtenirUrl`: un documento recién emitido
   * tarda unos segundos en tener fichero, y eso no depende de si lo quieres ver o guardar.
   */
  const mostra = useCallback(async (documentoId: string) => {
    setOcupat(documentoId)
    const url = await obtenirUrl(documentoId)
    setOcupat(null)
    if (!url) return
    // En móvil no hay visor: se abre como siempre (ver `VisorPdf`).
    if (esMobil) {
      window.open(url.url, '_blank', 'noopener,noreferrer')
      return
    }
    setPdf({ url: url.url, nombre: url.nombre, documentoId })
  }, [esMobil, obtenirUrl])

  const visor = (
    <VisorPdf pdf={pdf} onTancar={() => setPdf(null)} onDescarregar={(id) => void descarrega(id)} />
  )

  return { ocupat, generant, descarrega, mostra, visor }
}
