// Cliente del diagnóstico de prevención.
//
// Todo lo que escribe es una RPC, nunca un `update`: `authenticated` no tiene ninguna
// escritura sobre `planes_prevencion` ni sobre `questionaris_diagnostic` (20270301100000,
// 20260921231946). Y no podría tenerla aunque se quisiera: guardar el diagnóstico y generar
// su plan **son la misma transacción** —entre dos llamadas existiría un instante con un
// cuestionario contestado y un plan que dice otra cosa, y si la segunda falla ese instante
// se queda para siempre (§20260921231950)—.
//
// Mismo contrato que `albarans.ts`, `canalitzacio.ts` y `documents.ts`: **nunca lanza**.
// Devuelve `ok` y, cuando no, el mensaje que da la base —que ya viene en catalán y dice qué
// regla se ha incumplido: «falten_obligatories», «mesures_editades»— más una clave i18n de
// respaldo para lo genérico. El `codi` (el SQLSTATE) queda para que la pantalla pueda
// decidir: `22023` con `mesures_editades` dentro es lo que abre el diálogo de confirmación.

import { supabase } from './supabase'
import type {
  DiagnosticEquip, DiagnosticEstat, MesuraPla, MesuraPrevencio, PlanPrevencion,
  QuestionariDiagnostic, ReglaPla,
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
 * Las columnas del plan que la pantalla necesita, en UN literal (§7, deuda 46).
 *
 * ⚠️ Es una `const` y no un literal repetido dos veces porque TypeScript la estrecha a su
 *    tipo literal: supabase-js la puede analizar igual. Lo que NO se puede hacer nunca es
 *    componerla —concatenada o interpolada, la librería devuelve `GenericStringError` y la
 *    fila se queda sin columnas—.
 */
const COLUMNES_PLA =
  'id, tipo_org, productor_id, entidad_id, nivel, respuestas, questionari_id, mesures, version, vigente, estado, idioma, serie, ejercicio, numero, numero_completo, creado_por, emitido_por, emitido_at, sustituido_por, created_at, updated_at'

/**
 * El borrador abierto de una organización, si lo hay.
 *
 * Se lee por `select` y no por RPC porque **la RLS ya dice exactamente lo que hay que
 * decir**: el equipo lo ve todo y una organización ve los suyos (20270301100000 §4). Una
 * `security definer` aquí solo podría ampliar el alcance sin ningún motivo.
 */
export async function plaEsborrany(
  tipus: TipusOrg,
  org: string,
): Promise<ResultatRpc<PlanPrevencion | null>> {
  try {
    const columna = tipus === 'productor' ? 'productor_id' : 'entidad_id'
    const { data, error } = await supabase
      .from('planes_prevencion')
      .select(COLUMNES_PLA)
      .eq('tipo_org', tipus)
      .eq(columna, org)
      .eq('estado', 'esborrany')
      .maybeSingle()
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    return { ok: true, data: (data as unknown as PlanPrevencion | null) ?? null }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
}

/** Un plan por su id: el vigente de una organización, para poder leerlo ya emitido. */
export async function plaPerId(id: string): Promise<ResultatRpc<PlanPrevencion | null>> {
  try {
    const { data, error } = await supabase
      .from('planes_prevencion')
      .select(COLUMNES_PLA)
      .eq('id', id)
      .maybeSingle()
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    return { ok: true, data: (data as unknown as PlanPrevencion | null) ?? null }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
}

// ---------------------------------------------------------------------------
// Escribir
// ---------------------------------------------------------------------------

export interface ResultatDesat {
  pla: string
  questionari_id: string
  versio_questionari: number
  questionari_provisional: boolean
  falten: string[]
  complet: boolean
  mesures_editades: boolean
  te_mesures: boolean
  mesures_n: number
  generacio: { pla: string; mesures_n: number; obligatories_n: number } | null
}

/**
 * Guarda el diagnóstico. **Guarda SIEMPRE**, completo o no: un cuestionario de doce
 * preguntas no se contesta de una sentada, y perder lo tecleado porque falta una
 * obligatoria sería la forma más segura de que nadie lo termine. Lo que depende de estar
 * completo es que se genere el plan, y eso lo decide la propia RPC.
 *
 * ⚠️ Se manda el mapa PLANO `{pregunta_id: valor}`. El array autocontenido —con el texto de
 *    cada pregunta congelado dentro— lo compone el servidor: si lo compusiera el navegador,
 *    lo que queda impreso en el plan sería lo que el navegador dice haber enseñado, no lo
 *    que el cuestionario dice. Es el criterio de `sha256_texto` en la firma de un convenio.
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

export interface ResultatGeneracio {
  pla: string
  mesures_n: number
  obligatories_n: number
  regles_aplicades_n: number
}

/**
 * Vuelve a evaluar las reglas sobre el diagnóstico guardado.
 *
 * ⚠️ Responde `22023 mesures_editades` si alguien ya ajustó la lista a mano y no se pasa
 *    `forcar`. No es un estorbo: detrás de esa edición está el criterio de quien estuvo
 *    delante de la persona, y regenerar en silencio se lo llevaría por delante sin que se
 *    notara hasta leer el PDF. Quien llama tiene que preguntar.
 */
export function generarPla(
  tipus: TipusOrg,
  org: string,
  forcar = false,
): Promise<ResultatRpc<ResultatGeneracio>> {
  return crida('generar_pla_des_de_diagnostic', {
    p_tipo_org: tipus, p_org: org, p_forcar: forcar,
  }, 'diag.err_generic')
}

/** ¿El rechazo es «ya se ajustó a mano»? Es el único que abre un diálogo en vez de un toast. */
export function esMesuresEditades(r: { ok: false; missatge: string; codi: string | null }): boolean {
  return r.codi === '22023' && r.missatge.includes('mesures_editades')
}

/**
 * Ajusta la lista a mano. Se manda **el array** de medidas, no el sobre: el `generat_at`,
 * el `editat` y las reglas aplicadas los pone el servidor y no son del cliente.
 *
 * Dos cosas que la base impone y esta pantalla no puede saltarse: el texto de una medida
 * del catálogo se **relee del catálogo** (si no, cualquiera podría reescribir el contenido
 * de un documento que sale con el sello de la Fundación), y una obligatoria que produjeron
 * las reglas **no se puede quitar** (`22023 falten_obligatories`).
 */
export function desarMesuresPla(
  pla: string,
  mesures: MesuraPla[],
  observacions: string | null,
): Promise<ResultatRpc<{ pla: string; mesures_n: number; editat: boolean }>> {
  return crida('desar_mesures_pla', {
    p_plan: pla, p_mesures: mesures, p_observacions: observacions,
  }, 'diag.err_generic')
}

/** Básico o personalizado. Subir a `personalitzat` es de `pot_aprovar()`: es un servicio. */
export function fixarNivellPla(
  pla: string,
  nivell: 'basic' | 'personalitzat',
): Promise<ResultatRpc<{ pla: string; nivell: string }>> {
  return crida('fixar_nivell_pla', { p_plan: pla, p_nivel: nivell }, 'diag.err_generic')
}

export interface ResultatEmissio {
  pla: string
  /** El id del `documentos`: es lo que se le pasa al polling y al visor. */
  document: string
  numero: string | null
  versio: number
  mesures_n: number
  substitueix: string | null
  descarrega_immediata: boolean
}

/** Número, versión, documento y a descargar. Exige el diagnóstico completo y ≥1 medida. */
export function emetrePla(pla: string): Promise<ResultatRpc<ResultatEmissio>> {
  return crida('emitir_plan_basico', { p_plan: pla }, 'diag.err_generic')
}

// ---------------------------------------------------------------------------
// El catálogo (solo equipo: la RLS de las dos tablas es `es_intern()`)
// ---------------------------------------------------------------------------

export async function mesuresCataleg(tipus: TipusOrg): Promise<ResultatRpc<MesuraPrevencio[]>> {
  try {
    const { data, error } = await supabase
      .from('mesures_prevencio')
      .select('codi, tipo_org, bloc, titol, descripcio, obligatoria_per_defecte, ordre, activa, provisional, created_at')
      .eq('tipo_org', tipus)
      .order('bloc')
      .order('ordre')
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    return { ok: true, data: (data as unknown as MesuraPrevencio[]) ?? [] }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
}

export async function reglesCataleg(tipus: TipusOrg): Promise<ResultatRpc<ReglaPla[]>> {
  try {
    const { data, error } = await supabase
      .from('regles_pla')
      .select('id, tipo_org, pregunta_id, operador, valor, mesura_codi, obligatoria, prioritat, activa, motiu, created_at')
      .eq('tipo_org', tipus)
      .order('mesura_codi')
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    return { ok: true, data: (data as unknown as ReglaPla[]) ?? [] }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
}

/**
 * Retira o reactiva una medida o una regla. Es lo único que el editor mínimo deja hacer
 * sobre el catálogo, y es deliberado: **una medida no se borra** —un plan emitido cita su
 * código— y redactar el texto de una nueva es trabajo de la fase 0, no de un formulario.
 */
export async function activarMesura(codi: string, activa: boolean): Promise<ResultatRpc<null>> {
  try {
    // ⚠️ `.select()` PARA PODER DISTINGUIR UN RECHAZO. Un `update` denegado por RLS no da
    //    error: PostgREST no encuentra ninguna fila que cumpla el `using` y responde éxito
    //    con cero afectadas, así que un `tecnic` vería la casilla cambiar y nada cambiaría
    //    en la base. Es el mismo argumento con el que el arnés cuenta filas (§4bis).
    const { data, error } = await supabase
      .from('mesures_prevencio').update({ activa }).eq('codi', codi).select('codi')
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    if ((data ?? []).length === 0) return { ok: false, missatge: 'cfgd.denied', codi: '42501' }
    return { ok: true, data: null }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
}

export async function activarRegla(id: string, activa: boolean): Promise<ResultatRpc<null>> {
  try {
    const { data, error } = await supabase
      .from('regles_pla').update({ activa }).eq('id', id).select('id')
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    if ((data ?? []).length === 0) return { ok: false, missatge: 'cfgd.denied', codi: '42501' }
    return { ok: true, data: null }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
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
    return { ok: true, data: (data as unknown as QuestionariDiagnostic[]) ?? [] }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
}

export interface ResultatPublicacio {
  questionari: QuestionariDiagnostic
  versio: number
  vigent: boolean
  provisional: boolean
  /** Las reglas que apuntan a una pregunta que ya no existe. **No bloquea: avisa.** */
  regles_orfes: { regla: string; pregunta: string; mesura: string }[]
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

// ---------------------------------------------------------------------------
// El PDF del plan
// ---------------------------------------------------------------------------

/**
 * El documento vigente de un plan emitido, para poder verlo o descargarlo.
 *
 * ⚠️ Columnas explícitas, nunca `select('*')`: desde `20270320100300` **`documentos.envio`
 *    está fuera del GRANT** (lleva el token en claro de los enlaces de subida) y un `*`
 *    sobre esa tabla responde `42501 permission denied for column` (§4).
 */
export async function documentDelPla(
  pla: string,
): Promise<ResultatRpc<{ id: string; estado: string; numero_completo: string } | null>> {
  try {
    const { data, error } = await supabase
      .from('documentos')
      .select('id, estado, numero_completo')
      .eq('objeto_tipo', 'plan')
      .eq('objeto_id', pla)
      .eq('vigente', true)
      .maybeSingle()
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    return {
      ok: true,
      data: (data as { id: string; estado: string; numero_completo: string } | null) ?? null,
    }
  } catch {
    return { ok: false, missatge: 'diag.err_generic', codi: null }
  }
}
