// Cliente de albaranes y espigoladas.
//
// Todo lo que cambia un albarán es una RPC, nunca un `update`: `authenticated` solo tiene
// SELECT sobre `albaranes` y `albaran_lineas` (20261012100300), así que aquí no hay —ni
// puede haber— ninguna escritura directa. Emitir pide número, congela las partes y encola
// el PDF; conciliar escribe los kilos oficiales y emite una versión nueva del documento.
// Cada una de esas cosas mueve varias tablas en una transacción, y una transacción no cabe
// en un `update` desde el navegador.
//
// Mismo contrato que `redestina.ts`, `ofertes.ts` y `documents.ts`: **nunca lanza**.
// Devuelve `ok` y, cuando no, el mensaje que da la base (que ya viene en catalán y dice
// exactamente qué regla se ha incumplido) más una clave i18n de respaldo para lo genérico.

import { supabase } from './supabase'

/** Resultado uniforme. `missatge` ya es texto listo para enseñar; `codi` es el SQLSTATE. */
export type ResultatRpc<T> =
  | { ok: true; data: T }
  | { ok: false; missatge: string; codi: string | null }

/**
 * Fila de `v_albaranes_bandeja`.
 *
 * Vive aquí y no en `types.ts` porque es la forma de una VISTA, no de una tabla, y la
 * consume solo esta parte de la aplicación. Si algún día la lee otra pantalla, se sube.
 */
export interface AlbaranBandeja {
  id: string
  tipo: 'REC' | 'ENT' | 'OPE'
  numero_completo: string | null
  estado: string
  ejercicio: number | null
  excedente_id: string | null
  espigolada_id: string | null
  canalizacion_id: string | null
  id_excedente: string | null
  producto: string | null
  productor_id: string | null
  entidad_id: string | null
  codigo_lote: string | null
  emitido_at: string | null
  entregado_at: string | null
  confirmado_at: string | null
  conciliado_at: string | null
  rechazo: 'cap' | 'parcial' | 'total'
  kg_previstos: number | null
  kg_neto: number | null
  kg_confirmados: number | null
  kg_validados: number | null
  /** Días desde que salió el enlace de confirmación; null si ya confirmó o no se entregó. */
  dias_esperando: number | null
}

/** Una línea tal como la pide `emitir_albaran(p_lineas)`. Los nombres son los del jsonb. */
export interface LiniaEntrada {
  orden?: number
  producto?: string | null
  variedad?: string | null
  familia?: string | null
  causa?: string | null
  num_cajas?: number | null
  tipo_caja?: string | null
  kg_bruto?: number | null
  /** Si no se da, la RPC la calcula: `num_cajas × tipos_caja.tara_kg`. */
  tara_kg?: number | null
  /** Si no se da, la RPC la calcula: `kg_bruto − tara`. */
  kg_neto?: number | null
  kg_previstos?: number | null
  lote_origen?: string | null
  /**
   * Solo lo lee `crear_espigolada()`: es el peso de la jornada, que va a la vez al registro
   * (`excedentes.kg_total`) y a la línea del albarán de recepción. `emitir_albaran()` lo
   * ignora, que ahí el peso es `kg_neto`.
   */
  kg?: number | null
}

/** `marcar_entregado()` devuelve el token EN CLARO: es la única vez que existe. */
export interface EnllacConfirmacio {
  id: string
  destinatari: string
  nom: string | null
  token: string
}

export interface ResultatEntregat {
  albara: Record<string, unknown>
  enllacos: EnllacConfirmacio[]
}

/** Lo que devuelve `propuesta_conciliacion()`. */
export interface PropostaConciliacio {
  albara_rec: string | null
  kg_recepcio: number
  kg_entregues: number
  entregues: { albara: string | null; estat: string; entitat: string | null; kg: number }[]
  document_productor: { numero: string | null; data: string | null }[]
  diferencia: number
  diferencia_pct: number | null
  tolerancia_pct: number
  dins_tolerancia: boolean
  /** ¿Se puede conciliar sin confirmación? Solo si venció el plazo del parámetro. */
  termini_vencut: boolean
}

export interface LotEspigolada {
  excedente_id: string
  entidad_id: string
  kg: number
  nota?: string | null
  codigo_lote?: string | null
}

export interface ResultatRepartiment {
  lots: { canalitzacio_id: string; excedente_id: string; kg: number }[]
  /** Avisos de convenio. Hoy el `exigir_convenio()` de la base es un stub que solo avisa. */
  avisos: string[]
}

export interface ResultatEspigolada {
  espigolada_id: string
  albara_rec: string
  registres: { excedente_id: string; producte: string | null; kg: number }[]
}

/**
 * Envoltorio único de `supabase.rpc`.
 *
 * La base habla en catalán y con SQLSTATE propios (`42501` sin permiso, `22023` regla de
 * negocio incumplida), y ese mensaje es más útil que cualquier frase genérica nuestra:
 * dice «Encara no ha vencut el termini de confirmació», no «error». Por eso se enseña tal
 * cual y la clave i18n solo cubre el caso de que no venga ninguno.
 */
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

/** Emite el albarán: pide número, congela las partes y encola el PDF. */
export function emetreAlbara(
  id: string,
  recollida: Record<string, unknown> | null,
  linies: LiniaEntrada[] | null,
  idioma: 'ca' | 'es' | null,
): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('emitir_albaran', {
    p_id: id,
    p_recogida: recollida,
    p_lineas: linies,
    p_idioma: idioma,
  }, 'alb.err_generic')
}

/** La recogida se ha hecho: crea los enlaces de confirmación y devuelve sus tokens. */
export function marcarEntregat(id: string): Promise<ResultatRpc<ResultatEntregat>> {
  return crida('marcar_entregado', { p_id: id }, 'alb.err_generic')
}

/** Propuesta de conciliación de un REC: neto recibido, entregado y la diferencia. */
export function propostaConciliacio(recId: string): Promise<ResultatRpc<PropostaConciliacio>> {
  return crida('propuesta_conciliacion', { p_rec: recId }, 'alb.err_generic')
}

/** Los kilos que cuentan. `kgValidats` null = se valida lo confirmado (o lo entregado). */
export function conciliarAlbara(
  id: string,
  kgValidats: { linea_id: string; kg: number }[] | null,
  motiu: string | null,
  destiFinal: string | null,
): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('conciliar_albaran', {
    p_id: id,
    p_kg_validados: kgValidats,
    p_motivo: motiu,
    p_destino_final: destiFinal,
  }, 'alb.err_generic')
}

/** Anular (solo admin/super_admin). El motivo es obligatorio y lo exige la base. */
export function anullarAlbara(id: string, motiu: string): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('anular_albaran', { p_id: id, p_motivo: motiu }, 'alb.err_generic')
}

/** Rectificar: crea un albarán nuevo de la serie `R-*` y lo emite acto seguido. */
export function rectificarAlbara(
  id: string,
  linies: LiniaEntrada[],
  motiu: string,
): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('rectificar_albaran', {
    p_id: id,
    p_lineas: linies,
    p_motivo: motiu,
  }, 'alb.err_generic')
}

/** La jornada: cabecera, un registro por producto y el albarán de recepción. */
export function crearEspigolada(camps: {
  productor: string
  ubicacio: string | null
  data: string | null
  voluntaris: number | null
  notes: string | null
  linies: LiniaEntrada[]
  refExterna: string | null
}): Promise<ResultatRpc<ResultatEspigolada>> {
  return crida('crear_espigolada', {
    p_productor: camps.productor,
    p_ubicacion: camps.ubicacio,
    p_fecha: camps.data,
    p_num_voluntarios: camps.voluntaris,
    p_notas: camps.notes,
    p_lineas: camps.linies,
    p_ref_externa: camps.refExterna,
  }, 'esp.err_generic')
}

/** Cada lote es una canalización y, por el trigger, un albarán de entrega en borrador. */
export function repartirEspigolada(
  id: string,
  lots: LotEspigolada[],
): Promise<ResultatRpc<ResultatRepartiment>> {
  return crida('repartir_espigolada', { p_id: id, p_lotes: lots }, 'esp.err_generic')
}

/** Estado → clase de token. El error es rojo; el coral no significa fallo (§2bis). */
export function estilEstatAlbara(estat: string): string {
  switch (estat) {
    case 'conciliado': return 'bg-exito-fondo text-exito'
    case 'confirmado': return 'bg-exito-fondo text-exito'
    case 'entregado': return 'bg-aviso-fondo text-aviso'
    case 'emitido': return 'bg-secondary text-secondary-foreground'
    case 'anulado': return 'bg-error-fondo text-error'
    case 'rectificado': return 'bg-error-fondo text-error'
    default: return 'bg-muted text-muted-foreground'
  }
}

/** Fecha corta, sin hora. Las tablas de albaranes no necesitan más precisión. */
export function dataCurta(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

/** Número con hasta 2 decimales y sin ceros de relleno: 1000, 12,5, 0,75. */
export function kg(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const n = Number(valor)
  if (Number.isNaN(n)) return '—'
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 })
}
