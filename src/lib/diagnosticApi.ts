// Cliente del diagnóstico operativo del productor.
//
// Desde A1 (`20270520100000`, D1·D3·D4·D5) hay UN diagnóstico por productor, en la tabla
// `diagnostics`, que se sobrescribe; el plan básico desapareció de la pantalla (el plan es el
// expediente, `expedientApi.ts`) y solo el EQUIPO guarda (`desar_diagnostic`, D5): el
// productor lo lee. Lo que escribe es una RPC, nunca un `update`: `authenticated` solo tiene
// SELECT sobre `diagnostics`.
//
// Mismo contrato que `albarans.ts`, `canalitzacio.ts` y `documents.ts`: **nunca lanza**.
// Devuelve `ok` y, cuando no, el mensaje que da la base —que ya viene en catalán y dice qué
// regla se ha incumplido— más una clave i18n de respaldo para lo genérico. El `codi` (el
// SQLSTATE) queda para que la pantalla pueda decidir.

import { supabase } from './supabase'
import type {
  Diagnostic, DiagnosticDatos, DiagnosticEquip, DiagnosticEstat, QuestionariDiagnostic,
} from '../types'
import type { Respostes } from './diagnostic'

export type ResultatRpc<T> =
  | { ok: true; data: T }
  | { ok: false; missatge: string; codi: string | null }

async function crida<T>(
  nom: string,
  args: Record<string, unknown>,
  clauFallback: string,
): Promise<ResultatRpc<T>> {
  try {
    const { data, error } = await supabase.rpc(nom, args)
    if (error) {
      return { ok: false, missatge: error.message || clauFallback, codi: error.code ?? null }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, missatge: clauFallback, codi: null }
  }
}

export type TipusOrg = 'productor' | 'entidad'

// ---------------------------------------------------------------------------
// Leer
// ---------------------------------------------------------------------------

/**
 * El cuestionario que toca contestar. `questionari_vigent()` es `setof`, así que devuelve
 * 0 o 1 fila; `null` significa **que no hay ninguno vigente para ese tipo**, que es un
 * estado real del sistema (`sense_questionari`) y no un error.
 */
export async function questionariVigent(
  tipus: TipusOrg,
): Promise<ResultatRpc<QuestionariDiagnostic | null>> {
  const r = await crida<QuestionariDiagnostic[]>(
    'questionari_vigent', { p_tipo_org: tipus }, 'diag.err_generic')
  if (!r.ok) return r
  return { ok: true, data: (r.data ?? [])[0] ?? null }
}

export function diagnosticEstat(
  tipus: TipusOrg,
  org: string,
): Promise<ResultatRpc<DiagnosticEstat>> {
  return crida('diagnostic_estat', { p_tipo_org: tipus, p_org: org }, 'diag.err_generic')
}

export function diagnosticsEquip(): Promise<ResultatRpc<DiagnosticEquip[]>> {
  return crida('diagnostics_equip', {}, 'diag.err_generic')
}

/**
 * Las columnas de `diagnostics`, en UN literal (§7, deuda 46).
 *
 * ⚠️ Es una `const` y no un literal repetido porque TypeScript la estrecha a su tipo literal:
 *    supabase-js la puede analizar igual. Lo que NO se puede hacer nunca es componerla
 *    —concatenada o interpolada, la librería devuelve `GenericStringError`—.
 */
const COLUMNES_DIAGNOSTIC =
  'id, productor_id, questionari_id, versio_questionari, respostes, sobre, complet, falten, notes, idioma, actualitzat_at, actualitzat_per, created_at'

/**
 * EL diagnóstico de un productor, o `null` si todavía no se ha guardado nunca.
 *
 * Se lee por `select` y no por RPC porque **la RLS ya dice exactamente lo que hay que
 * decir**: el equipo los ve todos y un productor el suyo (20270520100000). Es lo que abre el
 * formulario con lo último guardado (`respostes` es el mapa plano `{id: valor}`).
 */
export async function diagnosticActual(org: string): Promise<ResultatRpc<Diagnostic | null>> {
  try {
    const { data, error } = await supabase
      .from('diagnostics')
      .select(COLUMNES_DIAGNOSTIC)
      .eq('productor_id', org)
      .maybeSingle()
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    return { ok: true, data: (data as Diagnostic | null) ?? null }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
}

/**
 * El diagnóstico listo para LEERLO: la organización, el cuestionario y las respuestas ya
 * compuestas por el servidor (pregunta y etiquetas `{ca, es}`), que es lo que pinta el
 * resumen. Con sesión no se pasa `p_user` (la RPC lo exige solo a `service_role`).
 * Una entidad responde `22023 nomes_productors`; un id ajeno, `42501`.
 */
export function diagnosticDatos(
  tipus: TipusOrg,
  org: string,
): Promise<ResultatRpc<DiagnosticDatos>> {
  return crida('diagnostic_datos', { p_tipo_org: tipus, p_org: org }, 'diag.err_generic')
}

// ---------------------------------------------------------------------------
// Escribir
// ---------------------------------------------------------------------------

export interface ResultatDesat {
  /** Siempre `null` desde A1: guardar ya no toca ningún plan */
  pla: null
  diagnostic_id: string
  questionari_id: string
  versio_questionari: number
  questionari_provisional: boolean
  falten: string[]
  complet: boolean
}

/**
 * Guarda el diagnóstico (solo el equipo, D5: un productor recibe `42501`). **Guarda SIEMPRE**,
 * completo o no: un cuestionario largo no se contesta de una sentada, y perder lo tecleado
 * porque falta una obligatoria sería la forma más segura de que nadie lo termine. Si está
 * completo lo decide el servidor (`complet`, `falten`).
 *
 * ⚠️ Se manda el mapa PLANO `{pregunta_id: valor}`. El array autocontenido —con el texto de
 *    cada pregunta congelado dentro— lo compone el servidor: si lo compusiera el navegador,
 *    lo que queda impreso sería lo que el navegador dice haber enseñado, no lo que el
 *    cuestionario dice.
 */
export function desarDiagnostic(
  tipus: TipusOrg,
  org: string,
  respostes: Respostes,
  notes: string | null,
  idioma: 'ca' | 'es' | null,
): Promise<ResultatRpc<ResultatDesat>> {
  return crida('desar_diagnostic', {
    p_tipo_org: tipus,
    p_org: org,
    p_respostes: respostes,
    p_notes: notes,
    p_idioma: idioma,
  }, 'diag.err_generic')
}

/** Los cuestionarios de un tipo, el vigente y los retirados. Solo el equipo ve los viejos. */
export async function questionarisDelTipus(
  tipus: TipusOrg,
): Promise<ResultatRpc<QuestionariDiagnostic[]>> {
  try {
    const { data, error } = await supabase
      .from('questionaris_diagnostic')
      .select('id, tipo_org, versio, provisional, vigente, valida_desde, titol, preguntes, created_by, created_at')
      .eq('tipo_org', tipus)
      .order('versio', { ascending: false })
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    return { ok: true, data: (data as QuestionariDiagnostic[] | null) ?? [] }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
}

export interface ResultatPublicacio {
  questionari: QuestionariDiagnostic
  versio: number
  vigent: boolean
  provisional: boolean
}

/**
 * Publica la versión siguiente del cuestionario y retira la anterior.
 *
 * ⚠️ Editar uno que ya ha generado diagnósticos está prohibido por trigger, así que esta es
 *    la única forma de cambiar el texto: se publica la versión N+1. Es exactamente el
 *    camino de `plantillas_documento`, y por el mismo motivo — hay que poder responder con
 *    qué cuestionario EXACTO se hizo un diagnóstico de hace cinco años.
 */
export function publicarQuestionari(
  tipus: TipusOrg,
  titol: { ca: string; es: string },
  preguntes: unknown[],
  provisional: boolean,
  vigent: boolean,
): Promise<ResultatRpc<ResultatPublicacio>> {
  return crida('publicar_questionari', {
    p_tipo_org: tipus,
    p_titol: titol,
    p_preguntes: preguntes,
    p_provisional: provisional,
    p_vigent: vigent,
  }, 'diag.err_generic')
}

/**
 * La lista de problemas de un cuestionario, **antes** de intentar publicarlo.
 *
 * Existe por lo mismo que `comprovaConvenis()` (§12.78): el editor tiene que poder avisar
 * antes, no enterarse con un error a mitad. La lista la compone SQL —es la misma función
 * que sostiene el CHECK de la tabla—, así que no hay una segunda definición de «qué es un
 * cuestionario válido».
 */
export function problemesQuestionari(preguntes: unknown): Promise<ResultatRpc<string[]>> {
  return crida('questionari_problemes', { p_preguntes: preguntes }, 'diag.err_generic')
}
