// Las fotos del producto de una oferta (20270404100000).
//
// Tres cosas que hace este módulo y que no son obvias:
//
//   1. **Recomprime en el navegador antes de subir** (JPEG, lado mayor 1600 px). Una foto de
//      móvil pesa 3-8 MB y aquí se enseña en una tarjeta; pero sobre todo, redibujar la
//      imagen en un `canvas` **borra los metadatos EXIF**, que incluyen la posición GPS de
//      donde se hizo — la finca—, y eso identificaría al donante (D3).
//   2. **La carpeta es el productor** (`<productor_id>/<uuid>.jpg`), no la oferta: la foto se
//      sube ANTES de que la oferta exista. Es también lo que mira la política de Storage.
//   3. **Las URLs son firmadas y caducan** (1 h): el bucket es privado. Se piden en lote y se
//      guardan en memoria para no pedir la misma firma en cada render.
//
// Mismo contrato que el resto de clientes: nunca lanza, devuelve `{ ok, … }`.

import { supabase } from './supabase'

export const BUCKET_FOTOS = 'fotos-ofertes'
export const MAX_FOTOS = 3
const COSTAT_MAXIM = 1600
const VALIDESA_S = 3600

/** Redibuja la imagen a JPEG: más ligera y SIN EXIF (ubicación incluida). */
export async function comprimeix(fitxer: File): Promise<Blob | null> {
  try {
    // `from-image` respeta la orientación de la cámara antes de perder el EXIF que la dice.
    const bmp = await createImageBitmap(fitxer, { imageOrientation: 'from-image' })
    const k = Math.min(1, COSTAT_MAXIM / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * k)
    const h = Math.round(bmp.height * k)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.82))
  } catch {
    // Un formato que el navegador no sabe decodificar (HEIC en escritorio, por ejemplo).
    return null
  }
}

export async function pujaFoto(
  productorId: string, fitxer: File,
): Promise<{ ok: true; ruta: string } | { ok: false; error: string }> {
  const blob = await comprimeix(fitxer)
  if (!blob) return { ok: false, error: 'foto.err_format' }
  const ruta = `${productorId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(BUCKET_FOTOS)
    .upload(ruta, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, ruta }
}

/** Quitar una foto que se acaba de subir (antes de publicar, o al cambiarla). */
export async function esborraFoto(ruta: string, bucket = BUCKET_FOTOS): Promise<void> {
  try {
    await supabase.storage.from(bucket).remove([ruta])
    cache.delete(`${bucket}:${ruta}`)
  } catch { /* si no se puede borrar, se queda huérfana: no es un dato, es un fichero */ }
}

/**
 * Las fotos de una oferta ya publicada (el productor no tiene UPDATE: va por RPC). Con
 * `rutes = null` no se tocan las fotos: sirve para cambiar solo `fotoProducte`
 * (20270405100100).
 */
export async function fixaFotos(
  excedenteId: string, rutes: string[] | null, fotoProducte?: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('fixar_fotos_oferta', {
    p_excedente: excedenteId,
    p_fotos: rutes,
    ...(fotoProducte === undefined ? {} : { p_foto_producte: fotoProducte }),
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

const cache = new Map<string, { url: string; caduca: number }>()

/**
 * URLs firmadas de un lote de rutas de UN bucket. Las que no se pueden firmar (sin permiso)
 * no vienen. La caché va por `bucket:ruta`: las rutas de los dos buckets de fotos no se
 * pisan, pero nada garantiza que no coincidan.
 */
export async function urlsFotos(rutes: string[], bucket = BUCKET_FOTOS): Promise<Record<string, string>> {
  const ara = Date.now()
  const out: Record<string, string> = {}
  const falten: string[] = []
  for (const r of new Set(rutes)) {
    const c = cache.get(`${bucket}:${r}`)
    // Margen de 5 minutos: una URL que caduca mientras se mira es una imagen rota.
    if (c && c.caduca - ara > 300_000) out[r] = c.url
    else falten.push(r)
  }
  if (falten.length === 0) return out
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(falten, VALIDESA_S)
    for (const d of data ?? []) {
      if (!d.path || !d.signedUrl || d.error) continue
      cache.set(`${bucket}:${d.path}`, { url: d.signedUrl, caduca: ara + VALIDESA_S * 1000 })
      out[d.path] = d.signedUrl
    }
  } catch { /* sin fotos, la pantalla sigue funcionando */ }
  return out
}
