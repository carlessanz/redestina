// El catálogo de CAUSAS y SUBCAUSAS en el panel (fase B del punto 3, fila 3.6; migración
// `20270529100000`): el mismo en el alta de la oferta, en su edición y en el Diagnòstic operatiu.
//
// Las formas y lo que las agrupa viven en el módulo hoja `_shared/causes.ts` (§7: se importa, no
// se copia), porque `crear-oferta` y el intake de WhatsApp usan el mismo. Aquí, lo que solo hace
// la pantalla: las opciones AGRUPADAS del desplegable y la lectura del catálogo entero (también
// las causas y subcausas inactivas, para nombrar lo que ya estaba guardado). Nunca lanza.

import { supabase } from './supabase'
import type { OpcioDesplegable } from '../components/Desplegable'
import {
  agrupaCauses, nomEnLlengua, trobaSubcausa,
  type CausaAmbSubcauses, type FilaCausa, type FilaSubcausa,
} from '../../supabase/functions/_shared/causes.ts'

export {
  agrupaCauses, nomEnLlengua, textCausa, trobaSubcausa,
  type CausaAmbSubcauses, type SubcausaCataleg,
} from '../../supabase/functions/_shared/causes.ts'

/** Las columnas de cada tabla, en UN literal (§7). */
const COLUMNES_CAUSES = 'codigo, nombre, nombre_es, activa, orden'
const COLUMNES_SUBCAUSES = 'codigo, causa_codigo, nombre, nombre_es, orden, activa'

/**
 * Las opciones del selector de SUBCAUSA: una por subcausa activa, agrupadas bajo el nombre de su
 * categoría (`grup` de `Desplegable`), en el orden del catálogo. Si `actual` es una subcausa que
 * ya no se ofrece (inactiva), se añade al final para que se siga viendo lo guardado.
 */
export function opcionsSubcausa(
  cataleg: readonly CausaAmbSubcauses[],
  lang: string,
  actual?: string | null,
): OpcioDesplegable[] {
  const out: OpcioDesplegable[] = []
  for (const c of cataleg) {
    if (c.activa === false) continue
    for (const s of c.subcausas) {
      if (s.activa === false) continue
      out.push({ valor: s.codigo, text: nomEnLlengua(s, lang), grup: nomEnLlengua(c, lang) })
    }
  }
  if (actual && !out.some((o) => o.valor === actual)) {
    const t = trobaSubcausa(cataleg, actual)
    if (t) out.push({ valor: actual, text: nomEnLlengua(t.subcausa, lang), grup: nomEnLlengua(t.causa, lang) })
  }
  return out
}

/** «Categoria — Subcausa» de un código de subcausa en el idioma, o '' si no está. */
export function textSubcausa(cataleg: readonly CausaAmbSubcauses[], codi: string | null | undefined, lang: string): string {
  const t = trobaSubcausa(cataleg, codi)
  return t ? `${nomEnLlengua(t.causa, lang)} — ${nomEnLlengua(t.subcausa, lang)}` : ''
}

/**
 * ¿Vale `valor` como subcausa de la oferta? Una subcausa ACTIVA del catálogo. Sirve para limpiar
 * un borrador de antes de la fase B (traía el código de una causa vieja, `CE`).
 */
export function esSubcausaTriable(cataleg: readonly CausaAmbSubcauses[], valor: unknown): boolean {
  if (typeof valor !== 'string' || !valor) return false
  const t = trobaSubcausa(cataleg, valor)
  return Boolean(t && t.causa.activa !== false && t.subcausa.activa !== false)
}

/** El catálogo ENTERO (activas e inactivas, con su `activa`), en orden. */
export async function carregaCatalegCauses(): Promise<
  { ok: true; data: CausaAmbSubcauses[] } | { ok: false; missatge: string; codi: string | null }
> {
  try {
    const [c, s] = await Promise.all([
      supabase.from('causas').select(COLUMNES_CAUSES),
      supabase.from('subcausas').select(COLUMNES_SUBCAUSES),
    ])
    const error = c.error ?? s.error
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    return {
      ok: true,
      data: agrupaCauses((c.data ?? []) as FilaCausa[], (s.data ?? []) as FilaSubcausa[], false),
    }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}

/**
 * Las causas del descriptor de `crear-oferta` (`catalogos.causas`) en forma de catálogo. Un
 * servidor anterior a la fase B las manda sin `subcausas`: entonces sale cada causa sin ninguna
 * (y `teSubcauses()` lo dice).
 */
export function catalegDelDescriptor(
  causas: readonly {
    codigo: string; nombre: string | null; nombre_es?: string | null; activa?: boolean
    subcausas?: { codigo: string; nombre: string; nombre_es: string | null; activa?: boolean }[]
  }[] | null | undefined,
): CausaAmbSubcauses[] {
  return (causas ?? []).map((c) => ({
    codigo: c.codigo,
    nombre: c.nombre ?? c.codigo,
    nombre_es: c.nombre_es ?? null,
    activa: c.activa !== false,
    subcausas: c.subcausas ?? [],
  }))
}

/** ¿El catálogo trae subcausas? (sin ellas, el panel elige la causa, como antes de la fase B). */
export function teSubcauses(cataleg: readonly CausaAmbSubcauses[]): boolean {
  return cataleg.some((c) => c.subcausas.length > 0)
}
