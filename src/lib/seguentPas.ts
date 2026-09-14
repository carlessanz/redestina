// «Què toca ara» en las cuatro fichas largas del equipo: albarán, convenio, ejercicio y
// donante.
//
// Son las pantallas donde el estado crudo cuesta más de leer, porque las máquinas tienen
// siete, siete, cuatro y nueve estados y cada una se avanza con un botón distinto. La regla
// es la misma que en `procesOferta.ts`: aquí se decide QUÉ decir, no cómo se pinta, y se
// devuelven claves i18n. Y se comparte la misma forma de salida (`PuntProces`), para que
// `QueTocaAra` sirva igual en las ocho pantallas.
//
// ⚠️ EL MOTIVO DE UN BOTÓN DESHABILITADO ES PARTE DE ESTO, no del componente. `alb.why_*` y
//    `tan.why_*` viven aquí porque son la otra cara de la misma regla: si «Concilia» está
//    gris, el texto que lo explica y el que dice qué hacer tienen que salir del mismo sitio,
//    o acabarán contradiciéndose.

import type { EstadoAlbaran, EstatCierreDonante, ConvenioEstado, TipoAlbaran } from '../types'
import type { PuntProces } from './procesOferta'

/** Estado de un `cierres_ejercicio`. Cuatro valores, comprobados contra `types.ts`. */
export type EstatExercici = 'obert' | 'provisional' | 'tancat' | 'declarat'

/**
 * Relleno de los huecos de `claus` que una ficha no usa.
 *
 * Estas cuatro máquinas cuentan UNA cosa —qué toca— y no tienen un «qué está pasando»
 * aparte del propio estado, que ya es el título. `c.none` resuelve a «—» en los dos
 * idiomas y `QueTocaAra` se salta cualquier línea que resuelva a «—»: así el hueco no se
 * pinta, y no hace falta una clave vacía (que las pruebas de i18n prohíben, con razón).
 */
const CAP = 'c.none'

function punt(
  etapa: PuntProces['etapa'],
  index: number,
  titol: string,
  toca: string,
  vars: Record<string, string | number> = {},
  emToca = false,
  variant: string | null = null,
): PuntProces {
  return { etapa, index, variant, claus: { titol, passa: CAP, toca, qui: CAP }, vars, emToca }
}

// --- Albarán ---------------------------------------------------------------------------

export const ETAPES_ALBARA: readonly EstadoAlbaran[] = [
  'borrador', 'emitido', 'entregado', 'confirmado', 'conciliado',
] as const
export const PASSOS_ALBARA_CLAUS: readonly string[] =
  ETAPES_ALBARA.map((e) => `alb.st_${e}`)

export interface FetsAlbara {
  tipo: TipoAlbaran
  estado: EstadoAlbaran
  /** Días desde que se marcó entregado; es lo que decide si hay que llamar. */
  diesEntregat?: number | null
  motiu?: string | null
}

/**
 * Qué toca con este albarán.
 *
 * ⚠️ El REC y el ENT divergen en dos estados, y no es cosmético: un REC entregado **ya se
 * puede conciliar** (con motivo, pasado el plazo) mientras que un ENT solo puede esperar a
 * la entidad; y la conciliación de un ENT no existe: se hace desde el REC del registro.
 * Decir lo mismo en los dos mandaría al equipo a buscar un botón que no está.
 */
export function seguentPasAlbara(a: FetsAlbara): PuntProces {
  const esRec = a.tipo === 'REC'
  const index = (ETAPES_ALBARA as readonly string[]).indexOf(a.estado)
  const titol = `alb.st_${a.estado}`
  const n = a.diesEntregat ?? 0

  switch (a.estado) {
    case 'borrador':
      return punt('borrador', index, titol, 'alb.next_borrador', {}, true)
    case 'emitido':
      return punt('emitido', index, titol, 'alb.next_emitido', {}, true)
    case 'entregado':
      return esRec
        ? punt('entregado', index, titol, 'alb.next_entregado_rec', { n }, true, 'rec')
        : punt('entregado', index, titol, 'alb.next_entregado_ent', { n }, false, 'altres')
    case 'confirmado':
      return esRec
        ? punt('confirmado', index, titol, 'alb.next_confirmado_rec', {}, true, 'rec')
        : punt('confirmado', index, titol, 'alb.next_confirmado_ent', {}, false, 'altres')
    case 'conciliado':
      return punt('conciliado', index, titol, 'alb.next_conciliado')
    case 'anulado':
      return punt('anulado', -1, titol, 'alb.next_anulado', { motiu: a.motiu ?? '' })
    case 'rectificado':
      return punt('rectificado', -1, titol, 'alb.next_rectificado')
  }
}

// --- Convenio --------------------------------------------------------------------------

export const ETAPES_CONVENI: readonly ConvenioEstado[] = [
  'esborrany', 'pendent_firma', 'firmat', 'vigent',
] as const
export const PASSOS_CONVENI_CLAUS: readonly string[] =
  ETAPES_CONVENI.map((e) => `conv.st_${e}`)

export interface FetsConveni {
  estado: ConvenioEstado
  nom?: string | null
  carrec?: string | null
  /** Fecha ya formateada por quien llama: este módulo no sabe de idiomas ni de husos. */
  data?: string | null
  motiu?: string | null
}

export function seguentPasConveni(c: FetsConveni): PuntProces {
  const titol = `conv.st_${c.estado}`
  const index = (ETAPES_CONVENI as readonly string[]).indexOf(c.estado)
  const data = c.data ?? '—'

  switch (c.estado) {
    case 'esborrany':
      return punt('esborrany', index, titol, 'conv.next_esborrany', {}, true)
    case 'pendent_firma':
      return punt('pendent_firma', index, titol, 'conv.next_pendent_firma', { data }, false)
    case 'firmat':
      return punt('firmat', index, titol, 'conv.next_firmat', {
        nom: c.nom ?? '—', carrec: c.carrec ?? '—',
      }, true)
    case 'vigent':
      return punt('vigent', index, titol, 'conv.next_vigent', { data })
    // Devuelto para corregir: vuelve al principio del circuito, así que el paso es el 0.
    case 'retornat':
      return punt('retornat', 0, titol, 'conv.next_retornat', { motiu: c.motiu ?? '' }, true)
    case 'resolt':
      return punt('resolt', -1, titol, 'conv.next_resolt', { data })
    case 'substituit':
      return punt('substituit', -1, titol, 'conv.next_substituit')
  }
}

// --- Cierre del ejercicio --------------------------------------------------------------

export const ETAPES_EXERCICI: readonly EstatExercici[] = [
  'obert', 'provisional', 'tancat', 'declarat',
] as const
export const PASSOS_EXERCICI_CLAUS: readonly string[] =
  ETAPES_EXERCICI.map((e) => `tan.st_${e}`)

export interface FetsExercici {
  estado: EstatExercici
  /** ¿Se ha pasado ya `calcular_cierre`? `obert` sin cálculo no es lo mismo que con él. */
  calculat: boolean
  /** Donantes con algún bloqueo que impide emitir. */
  bloquejats: number
}

/**
 * ⚠️ `obert` son TRES situaciones distintas y el estado no las distingue: sin calcular, con
 * bloqueos que hay que resolver, y limpio y listo para enviar los resúmenes. Contar las
 * tres como «Obert» deja al equipo sin saber cuál de los tres botones es el suyo.
 */
export function seguentPasExercici(e: FetsExercici): PuntProces {
  const index = (ETAPES_EXERCICI as readonly string[]).indexOf(e.estado)
  const titol = `tan.st_${e.estado}`

  if (e.estado === 'obert') {
    if (!e.calculat) {
      return punt('obert_sense_calcul', index, titol, 'tan.ex_next_obert_sense_calcul', {}, true)
    }
    if (e.bloquejats > 0) {
      return punt('obert_bloquejats', index, titol, 'tan.ex_next_obert_bloquejats',
        { n: e.bloquejats }, true)
    }
    return punt('obert_net', index, titol, 'tan.ex_next_obert_net', {}, true)
  }
  if (e.estado === 'provisional') {
    return punt('provisional', index, titol, 'tan.ex_next_provisional', {}, true)
  }
  if (e.estado === 'tancat') {
    return punt('tancat', index, titol, 'tan.ex_next_tancat', {}, true)
  }
  return punt('declarat', index, titol, 'tan.ex_next_declarat')
}

// --- Donante dentro de un cierre -------------------------------------------------------

export const ETAPES_DONANT: readonly EstatCierreDonante[] = [
  'calculat', 'resum_enviat', 'factura_pendent', 'factura_rebuda',
  'coincident', 'discrepancia', 'certificat_emes', 'enviat', 'declarat',
] as const
export const PASSOS_DONANT_CLAUS: readonly string[] =
  ETAPES_DONANT.map((e) => `tan.ds_${e}`)

export interface FetsDonant {
  estado: EstatCierreDonante
  /** Ya formateado (importe con su moneda): aquí no se decide cómo se escribe un número. */
  importe?: string | number | null
}

export function seguentPasDonant(d: FetsDonant): PuntProces {
  const index = (ETAPES_DONANT as readonly string[]).indexOf(d.estado)
  const titol = `tan.ds_${d.estado}`
  const acciones: EstatCierreDonante[] = [
    'calculat', 'factura_pendent', 'factura_rebuda', 'coincident', 'discrepancia',
    'certificat_emes',
  ]
  const vars: Record<string, string | number> =
    d.estado === 'factura_pendent' ? { import: d.importe ?? '—' } : {}
  return punt(d.estado, index, titol, `tan.next_${d.estado}`, vars, acciones.includes(d.estado))
}
