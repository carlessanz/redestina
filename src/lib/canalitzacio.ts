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
  /** Desde `20270406100400`: sin ellos el índice no sabía nada de los albaranes de salida. */
  origen?: string | null
  /** El estado del albarán de salida (ENT/OPE) menos avanzado. */
  sortida_estado?: string | null
  /** Todas las canalizaciones del lote conciliadas; null si no hay ninguna. */
  tot_conciliat?: boolean | null
  /** Desde `20270406100500`: respuestas (envíos) del lote, contesten o no. */
  n_respostes?: number | null
  /** Intereses por aprobar de una receptora sin el convenio vigente que le toca. */
  n_per_aprovar_sense_conveni?: number | null
}

export function lotsActius(limit = 200): Promise<ResultatRpc<LotActiu[]>> {
  return crida('canalitzacions_actives', { p_limit: limit }, 'canalz.err_generic')
}

/**
 * Los avisos que NO salieron, por oferta (`avisos_sense_enviar_per_oferta()`,
 * 20270430100300): con las notificaciones apagadas, a quién hay que avisar a mano. Una sola
 * llamada para todo el índice. Ante un error devuelve `null` —no se sabe—, nunca un mapa vacío
 * que se leería como «nada pendiente».
 */
export async function avisosSenseEnviarPerOferta(): Promise<Record<string, number> | null> {
  const r = await crida<{ excedente_id: string; n: number }[]>('avisos_sense_enviar_per_oferta', {}, 'c.error')
  if (!r.ok) return null
  return Object.fromEntries((r.data ?? []).map((x) => [x.excedente_id, Number(x.n)]))
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
/**
 * ¿Los datos provisionales BLOQUEAN esta emisión?
 *
 * Desde el 21-09-2026 **solo en modo real**. Un documento `modo = 'prueba'` usa serie con
 * prefijo `P-`, sale con marca de agua y `destinatariosPrueba` (§8) solo lo deja llegar a
 * una organización `es_test` o al buzón del equipo: no puede alcanzar a un donante real,
 * así que exigirle los datos fiscales de verdad solo conseguía que el ciclo no se pudiera
 * ensayar entero. Lo mismo hacen las RPC desde `20270328100900`.
 *
 * ⚠️ El modo tiene que constar: si no se sabe —no hay ejercicio todavía— se **bloquea**,
 * igual que `dadesFiscalsProvisionals()` responde `true` ante la duda. Decir «ya puedes
 * certificar» cuando no se puede sigue siendo el único error que cuesta caro.
 *
 * ⚠️ Esto NO relaja lo que el PDF dice: el snapshot sigue llevando `dades_provisionals`,
 * así que un certificado de ensayo se imprime declarando que los datos lo son.
 */
export function bloquejaProvisionals(
  provisionals: boolean,
  mode: string | null | undefined,
): boolean {
  return provisionals && mode !== 'prueba'
}

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
 *    función con dos regímenes de autorización es donde se esconde el fallo. Pero desde
 *    `20270430100100` las DOS llaman a `comprova_interes()`, así que el equipo pasa por las
 *    mismas guardas que el receptor: estado de la oferta, compatibilidad y modalidad
 *    (`cal_modalitat`), convenio, `kg_maxim`, precio mínimo y la hora dentro de la franja.
 *    Los rechazos los traduce `clauErrorInteres()` de `ofertes.ts`, igual que en el Mercat.
 */
export function interesAssistit(args: {
  excedenteId: string
  entitatId: string
  kg: number
  preu?: number | null
  caixes?: number | null
  /** La modalidad de la entrega, si la oferta tiene varias (sin ella: `cal_modalitat`). */
  modalitat?: string | null
  /** Cuándo la recoge (ISO), dentro de la disponibilidad y la franja. */
  recollida?: string | null
}): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('manifestar_interes_assistit', {
    p_excedente: args.excedenteId,
    p_entidad: args.entitatId,
    p_kg: args.kg,
    p_preu: args.preu ?? null,
    p_caixes: args.caixes ?? null,
    p_modalitat: args.modalitat ?? null,
    p_recollida: args.recollida ?? null,
  }, 'canalz.err_interes')
}

/** Los rechazos de `registrar_envio_manual()`, por su código (20270430100100). */
const MOTIU_ENVIAMENT_MANUAL: Record<string, string> = {
  oferta_no_disponible: 'manual.err_no_disponible',
  ja_resposta: 'manual.err_ja_resposta',
  entitat_inexistent: 'manual.err_entitat',
}

/**
 * «Copia i marca com a enviada»: deja constancia de que la oferta se le ha mandado A MANO a
 * esta entidad (`canal = 'manual'`, fila `pendent`). No sale nada: el texto ya lo ha copiado
 * quien pulsa. Con `manual` no salta el aviso `oferta_enviada` (ese es solo del canal
 * `panel`), que es lo correcto: a la entidad ya se le ha dicho.
 *
 * Nunca lanza. Un rechazo conocido vuelve como CLAVE i18n en `missatge`, que `textError()`
 * traduce; lo demás, el texto de la base.
 */
export async function registrarEnviamentManual(
  excedenteId: string,
  entitatId: string,
): Promise<ResultatRpc<Record<string, unknown>>> {
  const r = await crida<Record<string, unknown>>('registrar_envio_manual', {
    p_excedente: excedenteId,
    p_entidad: entitatId,
  }, 'c.error')
  if (r.ok) return r
  const codi = Object.keys(MOTIU_ENVIAMENT_MANUAL).find((c) => r.missatge === c || r.missatge.startsWith(`${c}:`))
  return codi ? { ok: false, missatge: MOTIU_ENVIAMENT_MANUAL[codi], codi: r.codi } : r
}

/** El enlace que el equipo abre con la persona delante. Devuelve el token EN CLARO. */
export interface EnllacAssistit {
  /** `enlaces_token.id`. La RPC lo llama `id`, no `enlace_id`. */
  id: string
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
