// «La meva signatura» (proceso 0.1, 25-11-2026): la firma PROPIA de cada cuenta del equipo, la
// que se estampa en los albaranes que valida (`validar_recollida`) o emite (`emitir_albaran`).
// No es la firma institucional de la Fundació (la de la apoderada, en convenios y certificados).
//
// Cliente de la Edge Function `firma-equip` (JWT + `exigirEquipo`), con el mismo patrón que
// `documents.ts`: **nunca lanza**; devuelve `{ ok: true, data }` o `{ ok: false, codi, motiuKey }`.
//
//   GET    → { ruta, url, actualitzada_at }   (`url` firmada y corta, solo para enseñarla)
//   POST   { imatge: 'data:image/png;base64,…' | 'data:image/jpeg;base64,…' } → lo mismo
//          400 { error: 'format_invalid' } · 413 { error: 'massa_gran' } · 401 · 403
//   DELETE → { ruta: null, url: null, actualitzada_at: null }
//
// La validación de aquí (tipo y ≤ 1 MB) es una ayuda para no mandar lo que va a volver con 413:
// la autoridad es la función, que mira los BYTES (`_shared/pujada.ts`), no la extensión.
// Las funciones puras (`validaImatgeFirma`, `bytesDataUri`, `codiFirmaDeResposta`) se prueban
// en `tests/firmaEquip.test.ts`.

import { supabase, supabaseUrl } from './supabase'

/** Lo que devuelve `firma-equip` en los tres métodos. */
export interface FirmaEquip {
  ruta: string | null
  url: string | null
  actualitzada_at: string | null
}

export type CodiFirma = 'format_invalid' | 'massa_gran' | 'unauthorized' | 'forbidden' | 'xarxa' | 'error'

export type ResultatFirma =
  | { ok: true; data: FirmaEquip }
  | { ok: false; codi: CodiFirma; motiuKey: string }

/** El mismo tope que la función: 1 MB de imagen (decodificada). */
export const MAX_BYTES_FIRMA = 1024 * 1024
/** Lo que acepta: PNG (el trazo, con fondo transparente) o JPEG (una foto o un escaneo). */
export const MIMES_FIRMA: readonly string[] = ['image/png', 'image/jpeg']

const MOTIU: Record<CodiFirma, string> = {
  format_invalid: 'fe.err_format',
  massa_gran: 'fe.err_massa_gran',
  unauthorized: 'fe.err_sessio',
  forbidden: 'fe.err_permis',
  xarxa: 'fe.err_generic',
  error: 'fe.err_generic',
}

function falla(codi: CodiFirma): ResultatFirma {
  return { ok: false, codi, motiuKey: MOTIU[codi] }
}

/** El código de un fallo, por el estado HTTP y el `error` del cuerpo. */
export function codiFirmaDeResposta(status: number, error: string | null | undefined): CodiFirma {
  if (error === 'format_invalid' || error === 'massa_gran') return error
  if (status === 413) return 'massa_gran'
  if (status === 400) return 'format_invalid'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  return 'error'
}

/** ¿Vale este fichero? La clave del motivo, o `null`. */
export function validaImatgeFirma(f: { type: string; size: number } | null | undefined): string | null {
  if (!f || f.size <= 0) return 'fe.err_format'
  if (!MIMES_FIRMA.includes(f.type)) return 'fe.err_format'
  if (f.size > MAX_BYTES_FIRMA) return 'fe.err_massa_gran'
  return null
}

/** ¿Es un data URI de PNG o JPEG en base64? */
export function esDataUriImatge(s: string | null | undefined): boolean {
  return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(s ?? '')
}

/** Los bytes que ocupa la imagen de un data URI en base64 (lo que medirá el servidor). */
export function bytesDataUri(dataUri: string): number {
  const coma = dataUri.indexOf(',')
  const b64 = coma >= 0 ? dataUri.slice(coma + 1) : dataUri
  const relleno = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - relleno)
}

/** Un fichero elegido, como data URI. `null` si no se puede leer (nunca lanza). */
export function fitxerADataUri(f: File): Promise<string | null> {
  return new Promise((resol) => {
    try {
      const lector = new FileReader()
      lector.onload = () => resol(typeof lector.result === 'string' ? lector.result : null)
      lector.onerror = () => resol(null)
      lector.readAsDataURL(f)
    } catch {
      resol(null)
    }
  })
}

async function crida(method: 'GET' | 'POST' | 'DELETE', cos?: { imatge: string }): Promise<ResultatFirma> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return falla('unauthorized')
    const res = await fetch(`${supabaseUrl}/functions/v1/firma-equip`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(cos ? { 'Content-Type': 'application/json' } : {}),
      },
      body: cos ? JSON.stringify(cos) : undefined,
    })
    const body = (await res.json().catch(() => null)) as (Partial<FirmaEquip> & { error?: string }) | null
    if (!res.ok) return falla(codiFirmaDeResposta(res.status, body?.error))
    return {
      ok: true,
      data: {
        ruta: body?.ruta ?? null,
        url: body?.url ?? null,
        actualitzada_at: body?.actualitzada_at ?? null,
      },
    }
  } catch {
    return falla('xarxa')
  }
}

/** La firma guardada de quien ha entrado (o todo `null` si aún no tiene). */
export function llegeixFirmaEquip(): Promise<ResultatFirma> {
  return crida('GET')
}

/** Guarda (o sustituye) la firma: el trazo del lienzo o una imagen subida, como data URI. */
export function desaFirmaEquip(imatge: string): Promise<ResultatFirma> {
  if (!esDataUriImatge(imatge)) return Promise.resolve(falla('format_invalid'))
  if (bytesDataUri(imatge) > MAX_BYTES_FIRMA) return Promise.resolve(falla('massa_gran'))
  return crida('POST', { imatge })
}

/** La borra. Lo ya emitido conserva la que llevaba (va congelada en el documento). */
export function esborraFirmaEquip(): Promise<ResultatFirma> {
  return crida('DELETE')
}
