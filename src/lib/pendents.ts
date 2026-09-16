// Lo que la organización tiene PENDIENTE de hacer, y cómo lo hace desde su panel.
//
// Dos RPC y nada más (20270318100000):
//
//   · `pendents_meus()`        — qué falta firmar o confirmar. Sin token: la existencia de
//                                un enlace no es lo que decide, lo decide el estado del
//                                convenio o del albarán.
//   · `acunar_enllac_propi()`  — acuña un enlace PARA UNO MISMO y devuelve su token en
//                                claro, que es la única vez que existe. Con él se abre
//                                `/signar/:token` o `/confirmar/:token`, las páginas
//                                públicas de siempre: mismo texto compuesto por el
//                                servidor, misma evidencia, mismo hash de lo firmado.
//
// ⚠️ ACUÑAR REVOCA EL ENLACE ANTERIOR (lo hace la base, como `enviar_convenio()`). El que
//    la persona tenga en su correo deja de valer. Es aceptable porque quien acuña es esa
//    misma persona y lo usa al momento; si lo pierde, el panel le da otro.
//
// ⚠️ EL TOKEN NO SE GUARDA EN NINGÚN SITIO. Viaja en la navegación y se acabó: ni
//    `localStorage`, ni estado que sobreviva a la pantalla.
//
// Mismo contrato que `albarans.ts`, `convenis.ts` y `documents.ts`: **nunca lanza**.

import { supabase } from './supabase'
import type { ResultatRpc } from './albarans'
import type { ProposicPendent } from './documentsPanell'

export type { ProposicPendent }

/** Una fila de `pendents_meus()`. */
export interface Pendent {
  proposito: ProposicPendent
  objeto_tipo: 'convenio' | 'albaran'
  objeto_id: string
  tipo_org: 'productor' | 'entidad'
  org_id: string
  /** Solo en albaranes, y solo cuando importa: en un OPE hay dos partes. */
  rol_parte: 'entrega' | 'recibe' | null
  /** Número del documento. Un convenio en borrador todavía no tiene: se pide al firmar. */
  numero: string | null
  /** Los productos del albarán, para reconocerlo sin abrirlo. */
  etiqueta: string | null
  /** `don_gen`/`don_rec`/`com` en convenios; `REC`/`ENT`/`OPE` en albaranes. */
  tipus: string
  estat_objecte: string
  /** El motivo por el que el equipo devolvió el convenio, si lo devolvió. */
  motiu: string | null
  ejercicio: number | null
  // --- El último enlace, solo como información -------------------------------
  enlace_id: string | null
  enlace_estado_efectivo: 'activo' | 'usado' | 'caducado' | 'revocado' | null
  enlace_caduca_at: string | null
  enlace_canal: 'email' | 'asistido' | 'panel' | null
  enlace_created_at: string | null
}

export interface EnllacPropi {
  id: string
  token: string
  /** `/signar/<token>` o `/confirmar/<token>`, compuesto por la base. */
  url_path: string
  rol_part?: 'entrega' | 'recibe'
  caduca_at: string
}

export async function carregaPendents(): Promise<ResultatRpc<Pendent[]>> {
  try {
    const { data, error } = await supabase.rpc('pendents_meus')
    if (error) return { ok: false, missatge: error.message || 'pend.err_generic', codi: error.code ?? null }
    return { ok: true, data: (data as Pendent[] | null) ?? [] }
  } catch {
    return { ok: false, missatge: 'pend.err_generic', codi: null }
  }
}

export async function acunarEnllacPropi(p: Pendent): Promise<ResultatRpc<EnllacPropi>> {
  try {
    const { data, error } = await supabase.rpc('acunar_enllac_propi', {
      p_proposito: p.proposito,
      p_objeto_tipo: p.objeto_tipo,
      p_objeto_id: p.objeto_id,
      p_rol_parte: p.rol_parte,
    })
    if (error) return { ok: false, missatge: error.message || 'pend.err_generic', codi: error.code ?? null }
    return { ok: true, data: data as EnllacPropi }
  } catch {
    return { ok: false, missatge: 'pend.err_generic', codi: null }
  }
}

/**
 * Firma del convenio propio desde el panel, sin depender de que el equipo lo haya
 * enviado. Prepara el borrador si no existe, lo pasa a `pendent_firma` y acuña el enlace
 * de una hora; el token en claro solo existe en esta respuesta.
 *
 * Es hermana de `acunarEnllacPropi()` y no la sustituye: aquella firma lo que YA está
 * enviado (y vale también para albaranes), esta arranca el circuito desde cero. Devuelven
 * la misma forma a propósito, para que quien llama no tenga que saber cuál contestó.
 */
export async function signarConveniPropi(
  tipusOrg: 'productor' | 'entidad',
  orgId: string,
): Promise<ResultatRpc<EnllacPropi>> {
  try {
    const { data, error } = await supabase.rpc('signar_conveni_propi', {
      p_tipo_org: tipusOrg,
      p_org: orgId,
    })
    if (error) return { ok: false, missatge: error.message || 'pend.err_generic', codi: error.code ?? null }
    return { ok: true, data: data as EnllacPropi }
  } catch {
    return { ok: false, missatge: 'pend.err_generic', codi: null }
  }
}
