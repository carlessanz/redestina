// Cliente de la pantalla guiada de canalización (modelo asistido, §1bis).
//
// Mismo contrato que `albarans.ts`, `ofertes.ts` y `documents.ts`: **nunca lanza**.
// Devuelve `ok` y, cuando no, el mensaje que da la base —que ya viene en catalán y dice
// exactamente qué regla se ha incumplido— más una clave i18n de respaldo.
//
// ⚠️ **LAS DOS LECTURAS DEVUELVEN HECHOS, NO EL PASO.** Qué toca lo calcula
//    `passosCanalitzacio.ts`, y tenerlo en dos sitios garantiza que diverjan. Aquí solo se
//    traslada lo que la base sabe.
//
// ⚠️ **NINGUNA DE ESTAS FUNCIONES ESCRIBE POR ATAJO.** Cada acción del ciclo llama a la RPC
//    real del circuito —la misma que usan las pantallas de siempre— para que salgan
//    exactamente los mismos documentos y correos que si lo hubiera hecho la organización.
//    Lo que NO se puede hacer es un `update` a `oferta_respuestas` o un `insert` en
//    `canalizaciones`: eso produce lotes que se ven idénticos en el listado y llegan al
//    certificado sin haber pasado por la compatibilidad de modalidad, el precio mínimo ni
//    la comprobación de convenio (deuda §12.109).

import { supabase } from './supabase'
import type { FetsCanal } from './passosCanalitzacio'

export type ResultatRpc<T> =
  | { ok: true; data: T }
  | { ok: false; missatge: string; codi: string | null }

async function crida<T>(
  nom: string,
  args: Record<string, unknown>,
  claveFallback: string,
): Promise<ResultatRpc<T>> {
  try {
    const { data, error } = await supabase.rpc(nom, args)
    if (error) {
      return { ok: false, missatge: error.message || claveFallback, codi: error.code ?? null }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, missatge: claveFallback, codi: null }
  }
}

/** Fila de `canalitzacions_actives()`: un lote en curso, para el índice. */
export interface LotActiu {
  excedente_id: string
  id_excedente: string | null
  productor: string | null
  estado: string
  modalitat: string | null
  kg_total: number | null
  kg_canalitzats: number | null
  n_per_aprovar: number
  rec_estado: string | null
  ents_pendents: number
  conveni_gen: string | null
  created_at: string | null
}

export function lotsActius(limit = 200): Promise<ResultatRpc<LotActiu[]>> {
  return crida('canalitzacions_actives', { p_limit: limit }, 'canalz.err_generic')
}

/**
 * El estado entero de un lote en un viaje.
 *
 * `dadesProvisionals` NO viene de aquí: es de `parametros_documentales`, que el equipo sí
 * puede leer pero es otra tabla. Lo añade la pantalla.
 */
export function estatCanalitzacio(
  excedenteId: string,
): Promise<ResultatRpc<Omit<FetsCanal, 'dadesProvisionals'>>> {
  return crida('canalitzacio_assistida', { p_excedente: excedenteId }, 'canalz.err_generic')
}

/**
 * ¿Siguen siendo provisionales los datos fiscales de Espigoladors?
 *
 * Con `true`, `emitir_certificado()` se niega con 42501 por mucho que el resto del ciclo
 * esté completo, y eso no es un fallo del programa: es material de la fase 0 que falta
 * (§12.10). La pantalla lo enseña EXPLICADO en vez de esconder el botón.
 *
 * Ante cualquier duda —error de lectura, fila ausente— responde `true`: decir «ya puedes
 * certificar» cuando no se puede es el único de los dos errores que cuesta caro.
 */
export async function dadesFiscalsProvisionals(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('parametros_documentales')
      .select('datos_provisionales')
      .eq('id', 1)
      .maybeSingle()
    if (error || !data) return true
    return data.datos_provisionales !== false
  } catch {
    return true
  }
}

/**
 * El interés de una entidad, conducido por el equipo (`canal = 'asistido'`).
 *
 * ⚠️ Es una función distinta de `manifestar_interes()`, no la misma relajada: una sola
 *    función con dos regímenes de autorización es donde se esconde el fallo. Conserva las
 *    tres comprobaciones que los atajos de `OfferDetail` se saltan — estado de la oferta,
 *    `modalitat_receptor_compat` y precio mínimo.
 */
export function interesAssistit(
  excedenteId: string,
  entitatId: string,
  kg: number | null,
  preu: number | null,
  caixes: number | null,
): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('manifestar_interes_assistit', {
    p_excedente: excedenteId,
    p_entidad: entitatId,
    p_kg: kg,
    p_preu: preu,
    p_caixes: caixes,
  }, 'canalz.err_interes')
}

/** El enlace que el equipo abre con la persona delante. Devuelve el token EN CLARO. */
export interface EnllacAssistit {
  enlace_id: string
  token: string
  url_path: string
  caduca_at: string
  destinatari: string | null
}

/**
 * Acuña un enlace `canal = 'asistido'` de 1 hora para conducir el acto.
 *
 * ⚠️ **REVOCA el enlace activo anterior** de ese objeto y parte, igual que
 *    `enviar_convenio()`: dos enlaces vivos son dos confirmaciones posibles y la segunda no
 *    tendría dónde ir. Por eso se acuña **al abrir el diálogo**, no al montar la pantalla.
 */
export function enllacAssistit(
  proposit: 'confirmacion_albaran' | 'subida_factura',
  objecteTipus: string,
  objecteId: string,
  rolPart: 'entrega' | 'recibe' | null = null,
): Promise<ResultatRpc<EnllacAssistit>> {
  return crida('acunar_enllac_assistit', {
    p_proposito: proposit,
    p_objeto_tipo: objecteTipus,
    p_objeto_id: objecteId,
    p_rol_parte: rolPart,
  }, 'canalz.err_enllac')
}
