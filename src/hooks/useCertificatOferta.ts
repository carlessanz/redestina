// El certificado de donación VIGENTE de una oferta (`cierres_periodo` con `abast = 'oferta'`),
// con su documento. Lo usan tres sitios: el diálogo del equipo, la tarjeta de la ficha de la
// oferta del equipo y la del panel del ofertante.
//
// La lectura es la misma para los dos lados y la RLS decide qué devuelve: al equipo, todo; al
// ofertante, solo lo suyo (`cierres_periodo_meus()`), y lo de PRUEBA solo si su ficha es
// `es_test`. Ningún filtro de aquí protege nada.
//
// «Vigente» = con número y no sustituido. Si el certificado anual lo ha sustituido, la fila
// pasa a `substituit` y su documento deja de ser vigente: entonces no hay certificado de la
// oferta que enseñar (lo tiene el anual).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DocCertificat } from '../components/equip/AccionsCertificat'

export interface CertificatOferta {
  periode: {
    id: string
    certificado_numero: string
    periodo_desde: string
    periodo_hasta: string
    data_expedicio: string | null
    modo: 'prueba' | 'real'
  }
  /** `null` si el documento todavía no se lee (recién emitido, o sin permiso). */
  doc: DocCertificat | null
}

export function useCertificatOferta(excedenteId: string | null | undefined) {
  const [cert, setCert] = useState<CertificatOferta | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState(false)

  const carrega = useCallback(async () => {
    if (!excedenteId) { setCert(null); setCarregant(false); return }
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46). Columnas explícitas en
    //    `documentos`: un `select('*')` lo corta el GRANT por columnas (§4).
    const { data, error: e1 } = await supabase
      .from('cierres_periodo')
      .select('id, certificado_numero, periodo_desde, periodo_hasta, data_expedicio, modo, estado')
      .eq('excedente_id', excedenteId)
      .not('certificado_numero', 'is', null)
      .neq('estado', 'substituit')
      .order('certificado_at', { ascending: false })
      .limit(1)
    if (e1) {
      console.warn('useCertificatOferta:', e1.message)
      setError(true); setCarregant(false); return
    }
    const fila = (data as (CertificatOferta['periode'] & { estado: string })[] | null)?.[0] ?? null
    if (!fila) { setCert(null); setError(false); setCarregant(false); return }
    const { data: docs, error: e2 } = await supabase
      .from('documentos')
      .select('id, numero_completo, estado')
      .eq('objeto_tipo', 'cierre_periodo')
      .eq('objeto_id', fila.id)
      .eq('vigente', true)
      .limit(1)
    if (e2) console.warn('useCertificatOferta.doc:', e2.message)
    setError(e2 !== null)
    setCert({ periode: fila, doc: (docs as DocCertificat[] | null)?.[0] ?? null })
    setCarregant(false)
  }, [excedenteId])

  useEffect(() => { void carrega() }, [carrega])

  return { cert, carregant, error, recarrega: carrega }
}
