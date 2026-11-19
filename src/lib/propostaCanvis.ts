// Proponer cambios a un interés (fase 5 de los puntos 4-6, Excel 5.2, nivel 2). PURO, con test
// (`tests/propostaCanvis.test.ts`); las llamadas a la base viven en `propostaCanvisApi.ts`.
//
// EL CIRCUITO. Ante un interés `acceptada` + `pendent`, quien puede aprobar (`pot_aprovar()`)
// tiene una tercera vía además de aprobar o rechazar: PROPONER otros kilos, otra modalidad u
// otra hora, con un motivo (`proposar_canvis`). La respuesta pasa a `proposada` y sale de la cola
// de Aprovacions; la entidad la acepta o la rechaza desde «Els meus interessos»
// (`respondre_proposta`), o el equipo por ella (vía asistida):
//
//   pendent ──proposar_canvis──▶ proposada ──acepta──▶ aprovada (canalización confirmada)
//                                    │            └───▶ pendent (venta: el equipo pone el precio)
//                                    └──rechaza──▶ pendent (con lo que pidió, y el motivo)
//
// LO QUE SE COMPARA. Mientras está `proposada`, la petición de la entidad (`kg_solicitados`,
// `modalitat`, `recollida_at`) no se toca y la propuesta vive en `proposta_*` con los valores
// EFECTIVOS completos. Al aceptarla, la petición pasa a ser la propuesta y lo pedido antes queda
// en `proposta_original`. Por eso «antes» es `proposta_original` si está y, si no, la petición.

import type { Modalitat } from '../types'
import { localDateTime } from './franja'

/** Lo que hace falta de una fila de `oferta_respuestas` para hablar de su propuesta. */
export interface RespostaAmbProposta {
  aprovacio: string
  kg_solicitados: number | null
  modalitat?: Modalitat | string | null
  recollida_at?: string | null
  proposta_kg?: number | null
  proposta_modalitat?: Modalitat | string | null
  proposta_recollida_at?: string | null
  proposta_motiu?: string | null
  proposta_original?: {
    kg_solicitados?: number | null
    modalitat?: Modalitat | string | null
    recollida_at?: string | null
  } | null
  proposta_resposta?: 'acceptada' | 'rebutjada' | string | null
  proposta_resposta_motiu?: string | null
}

export type CampProposta = 'kg' | 'modalitat' | 'recollida'

export interface CanviProposta {
  camp: CampProposta
  abans: string | number | null
  ara: string | number | null
}

/** Dos instantes iguales aunque lleguen escritos distinto (`+00:00` frente a `Z`). */
function mateixInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  const x = new Date(a).getTime()
  const y = new Date(b).getTime()
  return Number.isNaN(x) || Number.isNaN(y) ? a === b : x === y
}

/**
 * Qué cambia la propuesta respecto de lo que pidió la entidad, campo a campo y solo lo que
 * cambia. Vacío si no hay propuesta (sin `proposta_kg` y sin `proposta_modalitat`).
 */
export function canvisProposta(r: RespostaAmbProposta): CanviProposta[] {
  if (r.proposta_kg == null && r.proposta_modalitat == null && r.proposta_recollida_at == null) return []
  const o = r.proposta_original ?? null
  const kgAbans = o ? (o.kg_solicitados ?? null) : r.kg_solicitados
  const modAbans = o ? (o.modalitat ?? null) : (r.modalitat ?? null)
  const recAbans = o ? (o.recollida_at ?? null) : (r.recollida_at ?? null)
  const out: CanviProposta[] = []
  if (r.proposta_kg != null && Number(r.proposta_kg) !== Number(kgAbans ?? NaN)) {
    out.push({ camp: 'kg', abans: kgAbans == null ? null : Number(kgAbans), ara: Number(r.proposta_kg) })
  }
  if (r.proposta_modalitat != null && r.proposta_modalitat !== modAbans) {
    out.push({ camp: 'modalitat', abans: modAbans, ara: r.proposta_modalitat })
  }
  if (r.proposta_recollida_at != null && !mateixInstant(r.proposta_recollida_at, recAbans)) {
    out.push({ camp: 'recollida', abans: recAbans, ara: r.proposta_recollida_at })
  }
  return out
}

/**
 * En qué punto está la propuesta de una respuesta, desde el lado del equipo:
 *   · `esperant`     — propuesta hecha, la entidad todavía no ha contestado;
 *   · `rebutjada`    — la entidad la rechazó: el interés vuelve a la cola con lo que pidió;
 *   · `acceptada_preu` — la aceptó y es una venta: los valores ya son los propuestos y falta
 *                      que el equipo apruebe con el precio;
 *   · null           — no hay propuesta (o ya no importa: aprobada o rechazada por el equipo).
 */
export type EstatProposta = 'esperant' | 'rebutjada' | 'acceptada_preu'

export function estatProposta(r: Pick<RespostaAmbProposta, 'aprovacio' | 'proposta_resposta'>): EstatProposta | null {
  if (r.aprovacio === 'proposada') return 'esperant'
  if (r.aprovacio !== 'pendent') return null
  if (r.proposta_resposta === 'rebutjada') return 'rebutjada'
  if (r.proposta_resposta === 'acceptada') return 'acceptada_preu'
  return null
}

/** Lo que se teclea en el diálogo de «Proposa canvis». */
export interface FormProposta {
  kg: string
  modalitat: Modalitat | ''
  /** `datetime-local` (hora local del navegador). */
  recollida: string
  motiu: string
}

/** El formulario, precargado con lo que pidió la entidad. */
export function formInicialProposta(
  r: Pick<RespostaAmbProposta, 'kg_solicitados' | 'modalitat' | 'recollida_at'>,
  modalitats: readonly Modalitat[],
): FormProposta {
  const mod = r.modalitat && (modalitats as readonly string[]).includes(r.modalitat)
    ? r.modalitat as Modalitat
    : (modalitats.length === 1 ? modalitats[0] : '')
  return {
    kg: r.kg_solicitados != null ? String(r.kg_solicitados) : '',
    modalitat: mod,
    recollida: localDateTime(r.recollida_at ?? null),
    motiu: '',
  }
}

/** Kilos tecleados con coma o punto. `null` si no es un número. */
function llegeixKg(v: string): number | null {
  const t = v.trim().replace(/\s/g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export type ArgsProposta =
  | { ok: true; kg: number | null; modalitat: Modalitat | null; recollidaAt: string | null; motiu: string }
  | { ok: false; error: 'cal_kg' | 'cal_motiu' | 'cal_canvi' | 'motiu_llarg' }

/**
 * Los argumentos de `proposar_canvis` a partir del formulario. La RPC entiende `null` como «lo
 * que pidió la entidad», así que solo viaja lo que cambia. Las mismas comprobaciones que la base,
 * dichas antes de llamar: kilos > 0, motivo (≤ 1000) y que algo cambie.
 */
export function argsProposta(
  f: FormProposta,
  r: Pick<RespostaAmbProposta, 'kg_solicitados' | 'modalitat' | 'recollida_at'>,
): ArgsProposta {
  const kg = llegeixKg(f.kg)
  if (kg == null || kg <= 0) return { ok: false, error: 'cal_kg' }
  const motiu = f.motiu.trim()
  if (motiu === '') return { ok: false, error: 'cal_motiu' }
  if (motiu.length > 1000) return { ok: false, error: 'motiu_llarg' }
  const kgCanvia = r.kg_solicitados == null || Number(r.kg_solicitados) !== kg
  const modCanvia = f.modalitat !== '' && f.modalitat !== (r.modalitat ?? '')
  const recInicial = localDateTime(r.recollida_at ?? null)
  const recCanvia = f.recollida !== '' && f.recollida !== recInicial
  if (!kgCanvia && !modCanvia && !recCanvia) return { ok: false, error: 'cal_canvi' }
  const quan = recCanvia ? new Date(f.recollida) : null
  return {
    ok: true,
    kg: kgCanvia ? kg : null,
    modalitat: modCanvia ? f.modalitat as Modalitat : null,
    recollidaAt: quan && !Number.isNaN(quan.getTime()) ? quan.toISOString() : null,
    motiu,
  }
}

