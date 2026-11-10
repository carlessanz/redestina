// La NATURALESA de una organización (Plan 2 A5, 10-11-2026; filas 2.7 y 2.8 de la Taula mestra).
//
// «Entitat social» (fundacions, associacions, sense ànim de lucre) o «Empresa» (societats
// mercantils i altres operadors). Es un eje de la ORGANIZACIÓN (`organizaciones.naturalesa`),
// distinto del rol (ofertant/receptor) y de `tipo_receptor` (lo que la receptora hace con el
// excedente). Decide qué perfil de recepción se le pide (`campsPerfil()` de `perfilReceptor.ts`)
// y, CONFIRMADA, qué modalidades puede recibir (P8: una empresa, compra y maquila; regla en la
// tabla `modalitat_naturalesa_compat`, migración 20270523100000).
//
// SUGERIDA, NO IMPUESTA: la base la deduce del NIF (y de la forma jurídica) con
// `naturalesa_suggerida()`; aquí está el ESPEJO, para enseñar la sugerencia en «Nova entitat»
// antes de que exista la ficha. `tests/naturalesa.test.ts` comprueba la paridad con la migración.
//
// PURO.

import { MODALITATS_IDS } from './modalitats'
import type { Modalitat } from '../types'

export const NATURALESES = ['entitat_social', 'empresa'] as const
export type Naturalesa = typeof NATURALESES[number]
export type OrigenNaturalesa = 'suggerida' | 'confirmada'

export function esNaturalesa(v: unknown): v is Naturalesa {
  return typeof v === 'string' && (NATURALESES as readonly string[]).includes(v)
}

/**
 * La naturalesa que SURTE EFECTO (perfil de recepción, chips de modalidades, regla P8): solo la
 * confirmada. La sugerida se enseña («Suggerida») pero no cambia nada de lo que la organización
 * ve o puede hacer: así una sugerencia equivocada (un DNI de una entidad social) no le quita nada.
 */
export function naturalesaEfectiva(naturalesa: string | null | undefined, origen: string | null | undefined): Naturalesa | null {
  return origen === 'confirmada' && esNaturalesa(naturalesa) ? naturalesa : null
}

/** Letras del NIF que sugieren cada naturalesa (las mismas clases que la migración). */
export const LLETRES_SOCIAL = 'GRPQS'
export const LLETRES_EMPRESA = 'ABCDEJNUW'
/** Formas jurídicas (`TIPUS_EMPRESA`) que sugieren cada una cuando el NIF no lo dice. */
export const FORMES_SOCIAL: readonly string[] = ['fundacio', 'associacio']
export const FORMES_EMPRESA: readonly string[] = ['sl', 'sa', 'autonom', 'sc', 'cb', 'sat']

/** Letras del NIF que pueden ser las dos cosas (cooperativas, comunidades, otros —las SAT—). */
export const LLETRES_AMBIGUES = 'FHV'

/**
 * La sugerencia, igual que `naturalesa_suggerida(p_nif, p_forma, p_tipo_receptor)`: la letra del
 * NIF; si no dice nada (vacío, forma rara, o F/H/V), la forma jurídica; y para F/H/V sin forma que
 * lo diga (deuda §12.177), entidad social si la receptora es de tipo `social` y empresa si no. Sin
 * nada de eso, `null` (lo decide una persona).
 */
export function naturalesaSuggerida(
  nif: string | null | undefined, forma?: string | null, tipoReceptor?: string | null,
): Naturalesa | null {
  const n = (nif ?? '').replace(/[\s.-]/g, '').toUpperCase()
  if (new RegExp(`^[${LLETRES_SOCIAL}][0-9]{7}[0-9A-J]$`).test(n)) return 'entitat_social'
  if (new RegExp(`^[${LLETRES_EMPRESA}][0-9]{7}[0-9A-J]$`).test(n)
    || /^[0-9]{8}[A-Z]$/.test(n) || /^[XYZKLM][0-9]{7}[A-Z]$/.test(n)) return 'empresa'
  const f = (forma ?? '').trim().toLowerCase()
  if (FORMES_SOCIAL.includes(f)) return 'entitat_social'
  if (FORMES_EMPRESA.includes(f)) return 'empresa'
  if (new RegExp(`^[${LLETRES_AMBIGUES}][0-9]{7}[0-9A-J]$`).test(n)) {
    return (tipoReceptor ?? '').trim().toLowerCase() === 'social' ? 'entitat_social' : 'empresa'
  }
  return null
}

/**
 * Las modalidades que se ofrecen en «Modalitats d'interès» según la naturalesa (2.8): una entidad
 * social, donación y compra («Donació, Compra o Ambdues»); una empresa, compra y maquila (P8);
 * sin naturalesa, las tres (como antes). Lo ya marcado se sigue enseñando aunque no toque, para
 * no esconder un valor guardado.
 */
export function modalitatsInteresDe(naturalesa: Naturalesa | null | undefined, triats: readonly string[] = []): Modalitat[] {
  const base: readonly Modalitat[] = naturalesa === 'entitat_social' ? ['donacio', 'venda']
    : naturalesa === 'empresa' ? ['venda', 'maquila']
      : MODALITATS_IDS
  return MODALITATS_IDS.filter((m) => base.includes(m) || triats.includes(m))
}

/**
 * Lo que admite la regla P8 (`modalitat_naturalesa_compat`) para una naturalesa CONFIRMADA; con
 * cualquier otra cosa (sugerida, sin naturalesa, o la regla sin leer), `null` = no restringe. Es
 * el espejo del cruce de `comprova_interes()`: lo usa el interés asistido para no ofrecer lo que
 * la base va a rechazar.
 */
export function modalitatsDeLaNaturalesa(
  naturalesa: string | null | undefined,
  origen: string | null | undefined,
  regla: readonly { modalitat: string; naturalesa: string }[] | null,
): Modalitat[] | null {
  if (origen !== 'confirmada' || !naturalesa || !regla) return null
  const hi = new Set(regla.filter((f) => f.naturalesa === naturalesa).map((f) => f.modalitat))
  return MODALITATS_IDS.filter((m) => hi.has(m))
}

/** La naturalesa de una celda del Excel: código o etiqueta (ca/es); si no casa, `null`. */
export function naturalesaDeText(text: string | null | undefined): Naturalesa | null {
  const t = (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/_/g, ' ')
  if (t === '') return null
  if (['entitat social', 'entidad social', 'social'].includes(t)) return 'entitat_social'
  if (t === 'empresa') return 'empresa'
  return null
}
