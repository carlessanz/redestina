// El PDF del diagnóstico operativo, bajo demanda (Plan 2, A2).
//
// La Edge Function `diagnostic-pdf` devuelve los BYTES del PDF (no una URL firmada, como
// `descargar-documento`): no hay documento emitido ni fichero en el bucket (D2). Aquí se
// piden con la sesión, se convierten en `Blob` y se guardan con `descarregarBlob()`.
//
// Mismo contrato que `documents.ts`: **nunca lanza**. Devuelve `ok` y, cuando no, una clave
// i18n con el motivo (las de `doc.err_*`, que ya cuentan estos mismos casos).

import { supabase, supabaseUrl } from './supabase'
import { descarregarBlob } from './tancament'

export type CodiDiagnosticPdf =
  | 'unauthorized' | 'forbidden' | 'no_existeix' | 'nomes_productors'
  | 'error_servidor' | 'xarxa' | 'desconegut'

const MOTIU: Record<CodiDiagnosticPdf, string> = {
  unauthorized: 'doc.err_sessio',
  forbidden: 'doc.err_permis',
  no_existeix: 'doc.err_no_existeix',
  nomes_productors: 'doc.err_peticio',
  error_servidor: 'doc.err_servidor',
  xarxa: 'doc.err_xarxa',
  desconegut: 'doc.err_generic',
}

export type ResultatDiagnosticPdf =
  | { ok: true; nom: string; bytes: number }
  | { ok: false; codi: CodiDiagnosticPdf; motiuKey: string }

function falla(codi: CodiDiagnosticPdf): ResultatDiagnosticPdf {
  return { ok: false, codi, motiuKey: MOTIU[codi] }
}

/** El código del cuerpo de error si lo reconocemos; si no, se deduce del status. */
export function codiDiagnosticPdf(status: number, code: unknown): CodiDiagnosticPdf {
  if (code === 'nomes_productors' || code === 'falta_org' || code === 'cos_invalid') return 'nomes_productors'
  if (code === 'error_bd' || code === 'error_render') return 'error_servidor'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'no_existeix'
  if (status >= 500) return 'error_servidor'
  return 'desconegut'
}

/** `attachment; filename="diagnostic-mas.pdf"` → `diagnostic-mas.pdf`. */
export function nomDeDisposicio(cap: string | null, perDefecte = 'diagnostic.pdf'): string {
  const m = (cap ?? '').match(/filename="?([^";]+)"?/i)
  const nom = m?.[1]?.trim() ?? ''
  return /^[\w.-]+\.pdf$/i.test(nom) ? nom : perDefecte
}

/** Pide el PDF del diagnóstico de un productor y lo guarda. */
export async function descarregarDiagnosticPdf(
  productorId: string,
  idioma: 'ca' | 'es',
): Promise<ResultatDiagnosticPdf> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return falla('unauthorized')

    const res = await fetch(`${supabaseUrl}/functions/v1/diagnostic-pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo_org: 'productor', org: productorId, idioma }),
    })
    const tipus = (res.headers.get('Content-Type') ?? '').split(';')[0].trim()
    if (!res.ok || tipus !== 'application/pdf') {
      const body = (await res.json().catch(() => null)) as { code?: string } | null
      return falla(codiDiagnosticPdf(res.status, body?.code))
    }
    const blob = await res.blob()
    const nom = nomDeDisposicio(res.headers.get('Content-Disposition'))
    descarregarBlob(nom, blob)
    return { ok: true, nom, bytes: blob.size }
  } catch {
    return falla('xarxa')
  }
}
