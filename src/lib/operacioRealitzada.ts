// «Registrar operació realitzada» (proceso 3.7 del cliente, fase 5 del plan de noviembre de 2026).
//
// El equipo registra A POSTERIORI una operación que ya ocurrió fuera del circuito (sin publicar →
// interés → asignación → recogida): ofertante, producto, kg reales recogidos, fecha, lugar, tipo
// de operación, modalidad, a qué entidades fue y, si sobró algo, a qué destino final. La base lo
// hace todo en una transacción (`registrar_operacio_realitzada()`, 20270619100200) y es la
// autoridad: oferta `origen = 'registre'`, asignación, recogida validada con la fecha real,
// ENT + REC (donación) o conciliada sin albarán, destinos y oferta `cerrada`, sin avisos.
//
// PURO y sin red (pruebas en `tests/operacioRealitzada.test.ts`): lo que el diálogo necesita para
// no dejar enviar lo que la base rechazaría —kg que no cuadran, fecha fuera del ejercicio, venta
// sin precio— y para construir los argumentos de la RPC. Las reglas son las mismas que en SQL;
// si una cambia allí, cambia aquí.
//
// 🔴 El texto de la oferta («Comparteix», deuda 208) sale de `textoOfertaDeDades()`, el módulo
//    hoja `_shared/textOferta.ts` que usa el servidor en el alta: importado, no copiado (§7).

import type { DestiOperacio, DestinatariOperacio, Modalitat } from '../types'
import { kgDeText } from './destiFinal'
import { modalitatsDelTipus } from './modalitats'
import { modalitatsDeLaNaturalesa } from './naturalesa'
import { textoOfertaDeDades } from '../../supabase/functions/_shared/textOferta.ts'
import { trobaSubcausa, type CausaAmbSubcauses } from '../../supabase/functions/_shared/causes.ts'

/** El tipus d'operació: ya cosechado o espigolada (solo donación). */
export type TipusOperacioForm = 'excedent' | 'espigolada'

/** Una entidad destinataria, tal como se teclea. */
export interface FilaDestinatari {
  entitat: string
  kg: string
  /** Solo en venta: el precio acordado por kg. */
  preu: string
  caixes: string
}

/** Un destino final del sobrante (`destins_finals.codi`), tal como se teclea. */
export interface FilaDestiOperacio {
  desti: string
  kg: string
  receptor: string
}

export interface FormOperacio {
  productor: string
  /** `productos.nombre` (el valor del catálogo). */
  producte: string
  varietat: string
  /** `productor_ubicaciones.id`; vacío = el principal (lo decide la base). */
  ubicacio: string
  /** `subcausas.codigo`, opcional. */
  subcausa: string
  /** Kg reales recogidos. */
  kg: string
  /** `AAAA-MM-DD`. */
  data: string
  /** `HH:MM`, opcional. */
  hora: string
  tipus: TipusOperacioForm
  modalitat: Modalitat | ''
  destinataris: FilaDestinatari[]
  destins: FilaDestiOperacio[]
  observacions: string
}

/** Tope de las observaciones (el mismo que la RPC: `observacions_llargues`). */
export const MAX_OBSERVACIONS = 1000

export const FILA_DESTINATARI_BUIDA: FilaDestinatari = { entitat: '', kg: '', preu: '', caixes: '' }
export const FILA_DESTI_BUIDA: FilaDestiOperacio = { desti: '', kg: '', receptor: '' }

/** El formulario vacío: hoy, ya cosechado, donación (el core) y una fila de entidad para rellenar. */
export function formInicial(avui: string): FormOperacio {
  return {
    productor: '', producte: '', varietat: '', ubicacio: '', subcausa: '',
    kg: '', data: avui, hora: '', tipus: 'excedent', modalitat: 'donacio',
    destinataris: [{ ...FILA_DESTINATARI_BUIDA }], destins: [], observacions: '',
  }
}

/** El calendario: del 1 de enero del ejercicio en curso a hoy (Madrid). */
export function limitsData(avui: string): { min: string; max: string } {
  return { min: `${avui.slice(0, 4)}-01-01`, max: avui }
}

/** Dos decimales, como redondea la base cada línea antes de sumar. */
export function arrodoneix2(n: number): number {
  return Math.round(n * 100) / 100
}

export function filaDestinatariBuida(f: FilaDestinatari): boolean {
  return !f.entitat && !f.kg.trim() && !f.preu.trim() && !f.caixes.trim()
}

export function filaDestiBuida(f: FilaDestiOperacio): boolean {
  return !f.desti && !f.kg.trim() && !f.receptor.trim()
}

/**
 * Cuánto hay recogido, cuánto va a entidades y a destinos y cuánto QUEDA por asignar (negativo =
 * se ha asignado de más). Con la misma regla que la RPC: cada línea redondeada a dos decimales.
 */
export function resumKg(form: Pick<FormOperacio, 'kg' | 'destinataris' | 'destins'>): {
  total: number
  destinataris: number
  destins: number
  queden: number
} {
  const n = (v: string) => {
    const x = kgDeText(v)
    return x != null && x > 0 ? arrodoneix2(x) : 0
  }
  const total = n(form.kg)
  const destinataris = arrodoneix2(form.destinataris.reduce((a, f) => a + n(f.kg), 0))
  const destins = arrodoneix2(form.destins.reduce((a, f) => a + n(f.kg), 0))
  return { total, destinataris, destins, queden: arrodoneix2(total - destinataris - destins) }
}

/** «HH:MM» de ahora en Madrid (para no registrar una hora que aún no ha llegado hoy). */
export function horaMadrid(ara: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(ara)
}

const DIA = /^\d{4}-\d{2}-\d{2}$/
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Qué impide registrar, como clave i18n (`opr.err_*`), o `null` si se puede. En el orden en que
 * se rellena el formulario, para señalar el primer problema y no el último.
 */
export function errorOperacio(form: FormOperacio, avui: string, araHora?: string): string | null {
  if (!form.productor) return 'opr.err_productor'
  if (!form.producte.trim()) return 'opr.err_producte'
  const kg = kgDeText(form.kg)
  if (kg == null || kg <= 0 || kg > 1_000_000) return 'opr.err_kg'
  if (!DIA.test(form.data)) return 'opr.err_data'
  if (form.data > avui) return 'opr.err_data_futura'
  if (form.data.slice(0, 4) !== avui.slice(0, 4)) return 'opr.err_fora_exercici'
  if (form.hora) {
    if (!HORA.test(form.hora)) return 'opr.err_hora'
    if (form.data === avui && araHora && form.hora > araHora) return 'opr.err_hora_futura'
  }
  if (!form.modalitat) return 'opr.err_modalitat'
  if (form.tipus === 'espigolada' && form.modalitat !== 'donacio') return 'opr.err_espigolada'

  const destinataris = form.destinataris.filter((f) => !filaDestinatariBuida(f))
  if (destinataris.length === 0) return 'opr.err_cal_destinatari'
  const vistes = new Set<string>()
  for (const f of destinataris) {
    if (!f.entitat) return 'opr.err_entitat'
    if (vistes.has(f.entitat)) return 'opr.err_entitat_repetida'
    vistes.add(f.entitat)
    const k = kgDeText(f.kg)
    if (k == null || k <= 0) return 'opr.err_kg_entitat'
    if (form.modalitat === 'venda') {
      const p = kgDeText(f.preu)
      if (p == null || p < 0) return 'opr.err_cal_preu'
    }
    if (f.caixes.trim()) {
      const c = Number(f.caixes.trim())
      if (!Number.isInteger(c) || c < 0) return 'opr.err_caixes'
    }
  }
  for (const d of form.destins.filter((x) => !filaDestiBuida(x))) {
    if (!d.desti) return 'opr.err_desti'
    const k = kgDeText(d.kg)
    if (k == null || k <= 0) return 'opr.err_kg_desti'
  }
  const { queden } = resumKg(form)
  if (queden > 0) return 'opr.err_queden'
  if (queden < 0) return 'opr.err_sobren'
  if (form.observacions.trim().length > MAX_OBSERVACIONS) return 'opr.err_observacions'
  return null
}

/** Los argumentos de `registrar_operacio_realitzada()`, con nombre (los de la RPC). */
export interface ArgsOperacio {
  p_productor: string
  p_producto: string
  p_kg: number
  p_data: string
  p_modalitat: Modalitat
  p_destinataris: DestinatariOperacio[]
  p_destins: DestiOperacio[]
  p_variedad: string | null
  p_ubicacion: string | null
  p_espigolada: boolean
  p_subcausa: string | null
  p_hora: string | null
  p_observacions: string | null
  p_texto_oferta: string | null
}

/**
 * Los argumentos de la RPC a partir de un formulario VÁLIDO (`errorOperacio` = null): sin las
 * filas vacías, con los números convertidos y el precio solo en venta.
 */
export function argumentsOperacio(form: FormOperacio, textoOferta: string | null = null): ArgsOperacio {
  const venda = form.modalitat === 'venda'
  return {
    p_productor: form.productor,
    p_producto: form.producte.trim(),
    p_kg: arrodoneix2(kgDeText(form.kg) ?? 0),
    p_data: form.data,
    p_modalitat: (form.modalitat || 'donacio') as Modalitat,
    p_destinataris: form.destinataris.filter((f) => !filaDestinatariBuida(f)).map((f) => ({
      entidad_id: f.entitat,
      kg: arrodoneix2(kgDeText(f.kg) ?? 0),
      ...(venda ? { preu_kg: kgDeText(f.preu) ?? 0 } : {}),
      ...(f.caixes.trim() ? { caixes: Number(f.caixes.trim()) } : {}),
    })),
    p_destins: form.destins.filter((d) => !filaDestiBuida(d)).map((d) => ({
      desti: d.desti,
      kg: arrodoneix2(kgDeText(d.kg) ?? 0),
      ...(d.receptor.trim() ? { receptor: d.receptor.trim() } : {}),
    })),
    p_variedad: form.varietat.trim() || null,
    p_ubicacion: form.ubicacio || null,
    p_espigolada: form.tipus === 'espigolada',
    p_subcausa: form.subcausa || null,
    p_hora: form.hora || null,
    p_observacions: form.observacions.trim() || null,
    p_texto_oferta: textoOferta,
  }
}

/** Lo que el texto de la oferta necesita y el formulario no tiene. */
export interface ContextTextOperacio {
  /** El nombre de la organización (`empresa`, o `name` de respaldo). */
  productor: string
  /** El municipio del lugar o, si no, el de la ficha. */
  municipi: string
  mapsLloc?: string | null
  /** El catálogo de causas del descriptor (para nombrar la subcausa, en catalán como el servidor). */
  cataleg: readonly CausaAmbSubcauses[]
}

/**
 * El `texto_oferta` de la operación: el MISMO compositor que el alta (`textoOfertaDeDades`) sobre
 * la fila que va a crear la RPC (disponible hasta el día de la operación, una sola modalidad).
 */
export function textOfertaOperacio(form: FormOperacio, ctx: ContextTextOperacio): string {
  const espigolada = form.tipus === 'espigolada'
  const causa = trobaSubcausa(ctx.cataleg, form.subcausa || null)
  return textoOfertaDeDades({
    producto: form.producte.trim(),
    variedad: form.varietat.trim() || null,
    kg_total: arrodoneix2(kgDeText(form.kg) ?? 0),
    modalitats: form.modalitat ? [form.modalitat] : [],
    disponible_hasta: form.data,
    producte_al_camp: espigolada,
    espigolada_demanada: espigolada,
    observacions: form.observacions.trim() || null,
  }, {
    productor: ctx.productor,
    municipi: ctx.municipi,
    mapsLloc: ctx.mapsLloc ?? null,
    causa: causa?.causa.nombre ?? null,
    subcausa: causa?.subcausa.nombre ?? null,
  })
}

/**
 * ¿Puede esta entidad recibir esta modalidad? Su tipo (`modalitat_receptor_compat`) y, con la
 * naturalesa confirmada, P8 (`modalitat_naturalesa_compat`): el mismo cruce que `comprova_interes()`.
 * Una regla que no se pudo leer (`null`) no filtra: decide la base.
 */
export function entitatAdmet(
  ent: {
    tipo_receptor: string | null
    organizaciones: { naturalesa: string | null; naturalesa_origen: string | null } | null
  },
  modalitat: Modalitat,
  matriu: readonly { modalitat: string; tipo_receptor: string }[] | null,
  reglaNat: readonly { modalitat: string; naturalesa: string }[] | null,
): boolean {
  if (matriu && !modalitatsDelTipus(ent.tipo_receptor, matriu).includes(modalitat)) return false
  const o = ent.organizaciones
  const perNat = modalitatsDeLaNaturalesa(o?.naturalesa, o?.naturalesa_origen, reglaNat)
  return perNat ? perNat.includes(modalitat) : true
}

/**
 * Los códigos propios de la RPC (22023). Todos tienen texto en `textError()` (`lib/textError.ts`);
 * la prueba lo vigila.
 */
export const CODIS_OPERACIO = [
  'modalitat_invalida', 'espigolada_nomes_donacio', 'kg_invalids', 'cal_data', 'data_futura',
  'fora_exercici', 'observacions_llargues', 'preu_invalid', 'productor_inexistent',
  'producte_desconegut', 'ubicacio_aliena', 'cal_destinatari', 'destinatari_invalid',
  'entitat_repetida', 'entitat_inexistent', 'cal_preu_acordat', 'destins_invalids',
  'desti_desconegut', 'kg_no_quadren', 'periode_certificat', 'id_excedent_invalid',
  'id_excedent_ocupat', 'sense_conveni', 'entitat_inactiva',
] as const
