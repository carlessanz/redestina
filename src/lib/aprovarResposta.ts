// Aprobar (o rechazar) la aceptación de una oferta, desde donde sea.
//
// POR QUÉ EXISTE (14-09-2026). Esto vivía entero dentro de `OfferDetail`: la comprobación
// previa de convenios, la llamada a `aprovar_resposta()` y la traducción de sus dos
// errores. Mientras el único sitio desde el que se aprobaba era el detalle de la oferta,
// eso bastaba. Desde que la cola de «Aprovacions d'ofertes» también aprueba —que es donde
// el equipo mira cada día, y donde caen los intereses que llegan por `manifestar_interes()`
// desde el panel del receptor— habría dos copias de las mismas sesenta líneas, y la que se
// quedara atrás no sería la que falla: sería la que **deja de comprobar el convenio**.
//
// ⚠️ LA COMPROBACIÓN DE CONVENIOS SE HACE ANTES, NO DESPUÉS, y esa es toda la razón de que
//    `comprovaConvenis()` exista (deuda §12.78). `aprovar_resposta()` ya aplica la regla,
//    pero antes de `fecha_corte_convenios` avisa con un `raise notice` —que PostgREST
//    descarta— y después levanta `42501 sense_conveni` a mitad de operación. Sin preguntar
//    primero, el equipo o no se entera de nada o se lleva un error opaco. La autoridad
//    sigue siendo la RPC: esto solo decide si hay que avisar.
//
// Mismo contrato que `albarans.ts`, `convenis.ts` y `documents.ts`: **nunca lanza**.
// Devuelve `ok` y, cuando no, el mensaje que da la base más el SQLSTATE en `codi`.

import { supabase } from './supabase'
import { conveniVigent } from './convenis'
import type { ResultatRpc } from './albarans'
import type { Canalizacion } from '../types'

export type { ResultatRpc }

/** Lo justo de la oferta para saber qué convenios exige: la valorización y quién entrega. */
export interface OfertaPerConveni {
  modalitat: string | null
  productor_id: string | null
}

/**
 * ¿Falta algún convenio vigente para esta canalización? Devuelve las partes que lo tienen
 * pendiente, ya traducidas y unidas, o `null` si no falta ninguno.
 *
 * Recibe `t` por parámetro en vez de importar el i18n: así el módulo sigue sin depender de
 * React y lo puede usar cualquier pantalla (o una prueba, pasando la identidad).
 */
export async function comprovaConvenis(
  oferta: OfertaPerConveni,
  entidadId: string,
  t: (clau: string) => string,
): Promise<string | null> {
  const val = (oferta.modalitat ?? 'donacio') as 'donacio' | 'venda' | 'maquila'
  const falta: string[] = []
  // `productor_id` es nullable: una oferta sin productor (no debería haberla, pero el tipo
  // lo admite) no se puede comprobar, y callar es mejor que afirmar que falta el convenio.
  if (oferta.productor_id) {
    const prod = await conveniVigent('productor', oferta.productor_id, val, 'entrega')
    if (prod.ok && prod.data === false) falta.push(t('od.conv_producer'))
  }
  const ent = await conveniVigent('entidad', entidadId, val, 'recibe')
  if (ent.ok && ent.data === false) falta.push(t('od.conv_entity'))
  return falta.length ? falta.join(' · ') : null
}

/**
 * Aprobar una aceptación y convertirla en canalización, **en una sola transacción**.
 *
 * Antes esto eran cuatro escrituras sueltas (insert de canalización, update de la respuesta,
 * update del excedente) sin transacción y sin comprobar nada, así que la comprobación de
 * convenios que `aprovar_resposta()` sí hace no se aplicaba en la práctica (§12.19).
 *
 * `codi` distingue el rechazo por convenio del resto: `42501` llega por dos motivos
 * distintos —no poder aprobar, o no haber convenio desde la fecha de corte— y el mensaje
 * que se enseña tiene que decir cuál de los dos es.
 */
export async function aprovarResposta(args: {
  id: string
  kg: number
  preu?: number | null
  motiu?: string | null
}): Promise<ResultatRpc<Canalizacion>> {
  try {
    const { data, error } = await supabase.rpc('aprovar_resposta', {
      p_resposta: args.id,
      p_kg: args.kg,
      p_preu: args.preu ?? null,
      p_motiu: args.motiu ?? null,
    })
    if (error) {
      const esConveni = (error.message ?? '').includes('sense_conveni')
      return {
        ok: false,
        missatge: error.message || 'od.conv_blocked',
        codi: esConveni ? 'sense_conveni' : (error.code ?? null),
      }
    }
    return { ok: true, data: data as Canalizacion }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}

/**
 * Rechazar la aceptación, con su motivo. No borra nada: la fila queda con el motivo escrito
 * y la entidad lo ve, igual que un registro rechazado (§4bis).
 *
 * Es un `update` y no una RPC porque no hay ninguna: lo que impide que lo haga quien no
 * debe es el trigger `respuestas_control_aprovacio`, que vigila esas mismas columnas
 * aunque las políticas se relajaran (§4bis).
 */
export async function rebutjarResposta(args: {
  id: string
  motiu: string
}): Promise<ResultatRpc<null>> {
  try {
    const { error } = await supabase.from('oferta_respuestas').update({
      aprovacio: 'rebutjada',
      motiu_aprovacio: args.motiu || null,
      aprovat_at: new Date().toISOString(),
    }).eq('id', args.id)
    if (error) return { ok: false, missatge: error.message || 'c.error', codi: error.code ?? null }
    return { ok: true, data: null }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}
