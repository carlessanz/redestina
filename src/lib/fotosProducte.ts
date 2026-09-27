// Las fotos del CATÁLOGO de productos (20270405100000): una por producto, en el bucket
// `fotos-productes`, separado del de las ofertas. La gestiona el super_admin desde
// «Productes»; la ve cualquiera con sesión, porque hace de respaldo en el Mercat cuando una
// oferta no trae foto (la regla, pura, en `fotoOferta.ts`).
//
// Cada producto guarda DOS ficheros: la foto grande (1000×750, 4:3, la del detalle) y la
// miniatura (240×240, la de las listas). Se generan aquí, en el navegador, desde la misma
// foto: recorte central y JPEG, que además borra el EXIF.
//
// Mismo contrato que el resto de clientes: nunca lanza.

import { supabase } from './supabase'
import { esborraFoto } from './fotos'
import type { ProducteFoto } from './fotoOferta'

export const BUCKET_PRODUCTES = 'fotos-productes'

export interface CreditFoto {
  titol?: string | null
  autor?: string | null
  llicencia?: string | null
  llicencia_url?: string | null
  font_url?: string | null
}

export interface ProducteCataleg extends ProducteFoto {
  nombre: string
  foto_credit: CreditFoto | null
}

let promesa: Promise<Map<string, ProducteCataleg>> | null = null

/**
 * El catálogo con sus fotos, UNA vez por sesión (patrón de `municipis.ts`). Si falla se
 * olvida la promesa, así la siguiente llamada lo reintenta en vez de quedarse vacía.
 */
export function carregaCataleg(): Promise<Map<string, ProducteCataleg>> {
  if (!promesa) {
    promesa = (async () => {
      const { data, error } = await supabase
        .from('productos').select('nombre, familia, foto, foto_mini, foto_credit').order('nombre')
      if (error) { promesa = null; return new Map() }
      return new Map(((data ?? []) as ProducteCataleg[]).map((p) => [p.nombre, p]))
    })()
  }
  return promesa
}

/** Tras cambiar una foto: la próxima lectura vuelve a la base. */
export function invalidaCataleg() {
  promesa = null
}

/** Recorte central a `w×h` y JPEG. Sin EXIF: el `canvas` no lo copia. */
async function recompon(fitxer: File, w: number, h: number): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(fitxer, { imageOrientation: 'from-image' })
    const escala = Math.max(w / bmp.width, h / bmp.height)
    const sw = w / escala
    const sh = h / escala
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, w, h)
    bmp.close()
    return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.82))
  } catch {
    return null
  }
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

async function fixa(
  producte: string, foto: string | null, mini: string | null, credit: CreditFoto | null,
): Promise<{ ok: true; velles: string[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('fixar_foto_producte', {
    p_producto: producte, p_foto: foto, p_foto_mini: mini, p_credit: credit,
  })
  if (error) return { ok: false, error: error.message }
  const ant = (data ?? {}) as { foto?: string | null; foto_mini?: string | null }
  return { ok: true, velles: [ant.foto, ant.foto_mini].filter((r): r is string => Boolean(r)) }
}

/** Subir (o cambiar) la foto de un producto. Solo el super_admin: lo imponen Storage y la RPC. */
export async function pujaFotoProducte(
  producte: string, fitxer: File,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [gran, mini] = await Promise.all([recompon(fitxer, 1000, 750), recompon(fitxer, 240, 240)])
  if (!gran || !mini) return { ok: false, error: 'foto.err_format' }
  const base = `${slug(producte)}-${crypto.randomUUID().slice(0, 8)}`
  const rutaGran = `${base}.jpg`
  const rutaMini = `${base}-mini.jpg`
  const pujades: string[] = []
  for (const [ruta, blob] of [[rutaGran, gran], [rutaMini, mini]] as const) {
    const { error } = await supabase.storage.from(BUCKET_PRODUCTES)
      .upload(ruta, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) {
      for (const r of pujades) await esborraFoto(r, BUCKET_PRODUCTES)
      return { ok: false, error: error.message }
    }
    pujades.push(ruta)
  }
  const r = await fixa(producte, rutaGran, rutaMini, { font_url: null, llicencia: 'pujada per l’equip' })
  if (!r.ok) {
    for (const p of pujades) await esborraFoto(p, BUCKET_PRODUCTES)
    return r
  }
  for (const v of r.velles) await esborraFoto(v, BUCKET_PRODUCTES)
  invalidaCataleg()
  return { ok: true }
}

/** Quitar la foto: el producto vuelve al icono genérico. */
export async function treuFotoProducte(producte: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await fixa(producte, null, null, null)
  if (!r.ok) return r
  for (const v of r.velles) await esborraFoto(v, BUCKET_PRODUCTES)
  invalidaCataleg()
  return { ok: true }
}
