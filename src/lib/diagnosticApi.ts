// Cliente del diagnóstico operativo del productor.
//
// Desde A1 (`20270520100000`, D1·D3·D4·D5) hay UN diagnóstico por productor, en la tabla
// `diagnostics`, que se sobrescribe; el plan básico desapareció de la pantalla (el plan es el
// expediente, `expedientApi.ts`) y solo el EQUIPO guarda (D5): el productor lo lee. Lo que
// escribe es una RPC, nunca un `update`: `authenticated` solo tiene SELECT sobre `diagnostics`
// y sobre las tres tablas de excedentes.
//
// A3 (`20270522100000`): el cuestionario v3 ya no es vigente y el formulario deja de llamar a
// `desar_diagnostic` (P11). Guarda `desar_excedents_diagnostic` (excedentes por producto ×
// causa, notas e idioma en una transacción) y el estado de cada acción va aparte, al momento,
// por `fixar_estat_accio`. Configuració › Diagnòstic (el editor del cuestionario) se retiró.
//
// Mismo contrato que `albarans.ts`, `canalitzacio.ts` y `documents.ts`: **nunca lanza**.
// Devuelve `ok` y, cuando no, el mensaje que da la base —que ya viene en catalán y dice qué
// regla se ha incumplido— más una clave i18n de respaldo para lo genérico. El `codi` (el
// SQLSTATE) queda para que la pantalla pueda decidir.

import { supabase } from './supabase'
import type {
  CausaCataleg, DiagnosticDatos, DiagnosticEquip, DiagnosticEstat, FilaAccioDiagnostic,
  PayloadBlocDiagnostic, ResultatDesatExcedents,
} from '../types'

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

/** Las columnas del catálogo de causas, en UN literal (§7). */
const COLUMNES_CAUSES = 'codigo, nombre, nombre_es'

/**
 * El catálogo `causas` (el mismo de las ofertas, D7), por código. Lo puede leer cualquier
 * sesión. `nombre_es` existe desde A3; si falta, la pantalla cae al catalán.
 */
export async function causesDiagnostic(): Promise<ResultatRpc<CausaCataleg[]>> {
  try {
    const { data, error } = await supabase
      .from('causas')
      .select(COLUMNES_CAUSES)
      .order('codigo', { ascending: true })
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    return { ok: true, data: (data as CausaCataleg[] | null) ?? [] }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
}

// ---------------------------------------------------------------------------
// Escribir (solo el equipo, D5: un externo recibe `42501`)
// ---------------------------------------------------------------------------

/**
 * Guarda los excedentes del diagnóstico, las notas y el idioma (A3). **REEMPLAZA el conjunto**:
 * un bloque, una causa o una acción que no viaje se borra (las que viajan conservan id, estado,
 * notas y `feta_*`). Guarda SIEMPRE, completo o no; si está completo lo dice el servidor.
 *
 * ⚠️ `notes = null` BORRA las notas: hay que mandar siempre el valor actual del formulario.
 */
export function desarExcedentsDiagnostic(
  productor: string,
  productes: PayloadBlocDiagnostic[],
  notes: string | null,
  idioma: 'ca' | 'es' | null,
): Promise<ResultatRpc<ResultatDesatExcedents>> {
  return crida('desar_excedents_diagnostic', {
    p_productor: productor,
    p_productes: productes,
    p_notes: notes,
    p_idioma: idioma,
  }, 'diag.err_generic')
}

/**
 * Cambia el estado de una acción (`pendent` · `en_curs` · `feta` · `descartada`) y, si llega,
 * su nota de seguimiento (`''` = sin nota; `null` = no la toca). Va al momento, independiente
 * de «Desa el diagnòstic».
 */
export function fixarEstatAccio(
  accio: string,
  estat: string,
  notes: string | null = null,
): Promise<ResultatRpc<FilaAccioDiagnostic>> {
  return crida('fixar_estat_accio', { p_accio: accio, p_estat: estat, p_notes: notes }, 'diag.err_generic')
}
