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
//
// ⚠️ `missatge` ES SIEMPRE UNA CLAVE i18n, nunca el texto de Postgres (28-09-2026). Antes
//    devolvía `error.message` tal cual, y el toast enseñaba «Aquest conveni no esta pendent
//    de signatura (estat vigent)» —sin acentos y en catalán también en castellano—. Quien
//    llama hace `t(r.missatge)`.

import { supabase } from './supabase'
import type { ResultatRpc } from './albarans'
import type { ProposicPendent } from './documentsPanell'

export type { ProposicPendent }

/** Una fila de `pendents_meus()`. */
export interface Pendent {
  proposito: ProposicPendent
  /** `documento` = un documento que firmar (circuito de firma, `firma_document`). */
  objeto_tipo: 'convenio' | 'albaran' | 'documento'
  objeto_id: string
  tipo_org: 'productor' | 'entidad'
  org_id: string
  /** Solo en albaranes, y solo cuando importa: en un OPE hay dos partes. */
  rol_parte: 'entrega' | 'recibe' | null
  /** Número del documento. Un convenio en borrador todavía no tiene: se pide al firmar. */
  numero: string | null
  /** Los productos del albarán, para reconocerlo sin abrirlo. */
  etiqueta: string | null
  /** `don_gen`/`don_rec`/`com` en convenios; `REC`/`ENT`/`OPE` en albaranes; `CD`/`CR`/`REC`/`ENT` en documentos. */
  tipus: string
  estat_objecte: string
  /** El motivo por el que el equipo devolvió el convenio (o rechazó la firma de un documento). */
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
  /** `/signar/<token>`, `/confirmar/<token>` o `/signar-document/<token>`, compuesto por la base. */
  url_path: string
  rol_part?: 'entrega' | 'recibe'
  caduca_at: string
}

/**
 * El rechazo de `acunar_enllac_propi()` / `signar_conveni_propi()` traducido a una clave.
 * Se reconoce por una subcadena estable del mensaje (el SQLSTATE lo comparten varios).
 */
export function clauErrorPendent(missatge: string | null | undefined): string {
  const m = missatge ?? ''
  // Circuito de firma (20270510100100): códigos propios al principio del mensaje.
  if (m.includes('usa_firma_conveni')) return 'sgn.err_usa_firma_conveni'
  if (m.includes('versio_substituida')) return 'sgn.err_versio_substituida'
  if (m.includes('ja_signat')) return 'sgn.err_ja_signat'
  if (m.includes('no_signable')) return 'sgn.err_no_signable'
  if (m.includes('Nomes la persona titular')) return 'pend.only_titular'
  if (m.includes('Ja has signat')) return 'pend.err_ja_signat'
  if (m.includes('Ja tens un conveni vigent')) return 'pend.err_ja_vigent'
  if (m.includes('no esta pendent')) return 'pend.err_no_pendent'
  if (m.includes('Nomes el titular')) return 'pend.err_titular'
  if (m.includes('no es teu') || m.includes('no es teva')) return 'pend.err_no_teu'
  return 'pend.err_generic'
}

export async function carregaPendents(): Promise<ResultatRpc<Pendent[]>> {
  try {
    const { data, error } = await supabase.rpc('pendents_meus')
    if (error) return { ok: false, missatge: clauErrorPendent(error.message), codi: error.code ?? null }
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
    if (error) return { ok: false, missatge: clauErrorPendent(error.message), codi: error.code ?? null }
    return { ok: true, data: data as EnllacPropi }
  } catch {
    return { ok: false, missatge: 'pend.err_generic', codi: null }
  }
}

/**
 * El enlace de firma de UN CONVENIO CONCRETO que ya está pendiente (`pendent_firma` o
 * `retornat`). Es lo que tiene que usar «Pendent de tu»: el convenio pendiente puede ser de
 * cualquier tipo (un `com`, por ejemplo) y `signarConveniPropi()` solo sabe el del papel
 * (`don_gen`/`don_rec`) — firmar con ella un `com` pendiente abría y firmaba un `don_gen`
 * nuevo encima del vigente, y el `com` seguía pendiente (bug del 08-10-2026).
 */
export async function acunarEnllacConveni(conveniId: string): Promise<ResultatRpc<EnllacPropi>> {
  try {
    const { data, error } = await supabase.rpc('acunar_enllac_propi', {
      p_proposito: 'firma_convenio',
      p_objeto_tipo: 'convenio',
      p_objeto_id: conveniId,
      p_rol_parte: null,
    })
    if (error) return { ok: false, missatge: clauErrorPendent(error.message), codi: error.code ?? null }
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
    if (error) return { ok: false, missatge: clauErrorPendent(error.message), codi: error.code ?? null }
    return { ok: true, data: data as EnllacPropi }
  } catch {
    return { ok: false, missatge: 'pend.err_generic', codi: null }
  }
}

/**
 * El enlace de firma de UN DOCUMENTO (CD, CR, REC, ENT) para firmarlo desde el panel, una
 * hora (`acunar_enllac_propi('firma_document', 'documento', <id>)`). Solo el titular; un CONV
 * contesta `usa_firma_conveni` (se firma por su circuito). Lo llama el diálogo al entrar en
 * «Signa aquí», y una sola vez: acuñar otro revoca el anterior.
 */
export async function acunarEnllacSignatura(documentoId: string): Promise<ResultatRpc<EnllacPropi>> {
  try {
    const { data, error } = await supabase.rpc('acunar_enllac_propi', {
      p_proposito: 'firma_document',
      p_objeto_tipo: 'documento',
      p_objeto_id: documentoId,
      p_rol_parte: null,
    })
    if (error) return { ok: false, missatge: clauErrorPendent(error.message), codi: error.code ?? null }
    return { ok: true, data: data as EnllacPropi }
  } catch {
    return { ok: false, missatge: 'pend.err_generic', codi: null }
  }
}
