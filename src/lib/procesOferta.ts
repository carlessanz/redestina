// El proceso de una oferta, contado desde donde está cada quien.
//
// POR QUÉ EXISTE. La aplicación ejecuta el ciclo completo de un lote —se publica, el equipo
// la reparte, se recoge, se confirma y se concilia— pero hasta ahora no lo NARRABA en
// ninguna pantalla: cada panel enseñaba un badge con el estado crudo (`bloqueada`,
// `acceptada`) y quien mira tenía que saberse el circuito de memoria para deducir si le
// tocaba hacer algo. Este módulo traduce los estados reales a cuatro frases —en qué etapa
// está, qué está pasando, qué toca ahora y quién lo hace— y a un índice para pintar los
// pasos.
//
// ES PURO Y DEVUELVE CLAVES i18n, NO TEXTOS. Mismo criterio que `documentsPanell.ts`: lo
// que se puede probar sin montar React vive fuera de los componentes, y la aplicación es
// bilingüe, así que un texto escrito aquí sería un texto que solo existe en un idioma.
//
// ⚠️ LAS CLAVES SE COMPONEN (`proc.${rol}_${etapa}_${parte}`), así que `cobertura.test.ts`
//    —que busca literales `t('...')`— NO las ve. La red es `tests/procesOferta.test.ts`,
//    que recorre todas las combinaciones y exige que existan en `ca` y en `es`. Sin esa
//    prueba, una etapa nueva sin traducir saldría en pantalla como `proc.p_loquesea_t`.

import type { EstadoAlbaran, EstadoExcedente, ConvenioEstado, EstatCierreDonante } from '../types'

// --- Vocabulario -----------------------------------------------------------------------

/** Las cinco etapas por las que pasa una oferta, en orden. */
export type EtapaOferta = 'publicada' | 'assignada' | 'recollida' | 'confirmada' | 'tancada'
/** Los dos finales que no son el final bueno. Ganan a cualquier etapa. */
export type SortidaOferta = 'sense_desti' | 'cancellada'
/**
 * El aviso que no es ni etapa ni salida: la oferta sigue viva pero se le ha pasado la
 * fecha. Solo lo ve el equipo, que es quien puede ampliarla o darla por no colocada.
 */
export type AvisOferta = 'vencuda'

/** Las seis etapas de un interés, desde que la entidad recibe la oferta. */
export type EtapaInteres =
  'oferta_rebuda' | 'interes_enviat' | 'assignada' | 'entrega' | 'confirmada' | 'tancada'
/** Los tres finales de un interés que no acaba en entrega. */
export type SortidaInteres = 'no_assignada' | 'retirada' | 'declinada'

/**
 * Los casos del cierre de un ejercicio: el estado solo no basta.
 *
 * `obert` son TRES —sin calcular, con bloqueos, limpio— y desde 2027-04 `tancat` son DOS:
 * con certificados pendientes de emitir y sin ellos. Lo segundo apareció al retirar la
 * factura como condición del certificado (decisión del cliente, 21-09-2026): antes,
 * cerrar el ejercicio era casi el final; ahora quedan N certificados por emitir y son dos
 * botones distintos.
 */
export type CasExercici =
  'obert_sense_calcul' | 'obert_bloquejats' | 'obert_net' | 'provisional'
  | 'tancat' | 'tancat_certs' | 'declarat'

/**
 * Cualquier punto de cualquiera de las máquinas de estados que este módulo y `seguentPas.ts`
 * saben contar. Es una unión cerrada a propósito: si mañana se añade un estado a una tabla,
 * el compilador obliga a decidir qué se cuenta de él en vez de dejar pasar una cadena.
 */
export type EtapaProces =
  | EtapaOferta | SortidaOferta | AvisOferta
  | EtapaInteres | SortidaInteres
  | EstadoAlbaran | ConvenioEstado | EstatCierreDonante | CasExercici

/** Quién mira. El receptor no elige: su lectura es siempre la del interés. */
export type RolMira = 'productor' | 'equip'

// --- La pieza que consumen las pantallas -----------------------------------------------

export interface PuntProces {
  etapa: EtapaProces
  /**
   * Posición dentro de su lista de etapas (0 = la primera). **-1 en las salidas**, que no
   * son un paso del camino sino una bifurcación fuera de él. `vencuda` SÍ conserva el
   * índice de la etapa que sustituye: la oferta sigue donde estaba, solo que tarde.
   */
  index: number
  variant: string | null
  /** Claves i18n, nunca textos: `titol` · `passa` (qué pasa) · `toca` · `qui`. */
  claus: { titol: string; passa: string; toca: string; qui: string }
  /** Lo que hay que interpolar. Sus nombres son exactamente los `{x}` de esos textos. */
  vars: Record<string, string | number>
  /** `true` = la acción es de quien mira. Es lo que decide el color del bloque. */
  emToca: boolean
  /** Ruta interna de la acción, si la hay. */
  enllac?: string
}

export interface FetsOferta {
  estado: EstadoExcedente
  kgTotal: number
  kgCanalitzats: number
  /** Solo si quien mira puede saberlo (el equipo siempre; el productor por RPC). */
  nEnviades?: number
  nInteressades?: number
  nPerAprovar?: number
  albaraRec?: { estado: EstadoAlbaran; numero: string | null; diesEsperant: number | null } | null
  motiu?: string | null
  /** `disponible_hasta` pasada con kilos sin cubrir. */
  vencuda?: boolean
  /** Solo productor: hay un pendiente de confirmación suyo para el REC (de `pendents_meus`). */
  pendentDeMi?: boolean
}

export interface FetsInteres {
  estado: 'pendent' | 'acceptada' | 'rebutjada'
  aprovacio: 'pendent' | 'aprovada' | 'rebutjada'
  kg?: number | null
  ofertaEstado: EstadoExcedente
  albaraEnt?: { estado: EstadoAlbaran; numero: string | null } | null
  motiu?: string | null
}

export const ETAPES_OFERTA: readonly EtapaOferta[] = [
  'publicada', 'assignada', 'recollida', 'confirmada', 'tancada',
] as const

export const ETAPES_INTERES: readonly EtapaInteres[] = [
  'oferta_rebuda', 'interes_enviat', 'assignada', 'entrega', 'confirmada', 'tancada',
] as const

/**
 * Las etiquetas cortas de cada paso, para el indicador de progreso.
 *
 * Son claves propias y no los títulos de `claus.titol` porque el título cambia con la
 * variante («Amb destí parcial», «Destí complet») y un indicador cuyas etiquetas se mueven
 * bajo los pies no se puede leer de un vistazo.
 */
export const PASSOS_OFERTA_CLAUS: readonly string[] =
  ETAPES_OFERTA.map((e) => `proc.pas_${e}`)
export const PASSOS_INTERES_CLAUS: readonly string[] =
  ETAPES_INTERES.map((e) => `proc.pasi_${e}`)

// --- La oferta -------------------------------------------------------------------------

/** Un REC anulado o rectificado no cuenta: la oferta vuelve a estar donde estaba. */
const REC_VIU: EstadoAlbaran[] = ['emitido', 'entregado', 'confirmado', 'conciliado']

function claus(prefix: string): PuntProces['claus'] {
  return { titol: `${prefix}_t`, passa: `${prefix}_passa`, toca: `${prefix}_toca`, qui: `${prefix}_qui` }
}

/**
 * En qué punto está una oferta y qué toca hacer con ella.
 *
 * El orden de las comprobaciones ES la regla de negocio: las salidas ganan a todo (una
 * oferta cancelada no está «en gestión» aunque tenga interesados), el albarán manda sobre
 * el estado del excedente (el papel es el que dice si ya se ha recogido) y el aviso de
 * vencida solo desplaza a las dos primeras etapas, porque a partir de la recogida la fecha
 * de disponibilidad ya no significa nada.
 */
export function puntOferta(fets: FetsOferta, rol: RolMira): PuntProces {
  const p = rol === 'productor' ? 'p' : 'e'
  const rec = fets.albaraRec && REC_VIU.includes(fets.albaraRec.estado) ? fets.albaraRec : null
  const num = rec?.numero ?? '—'
  const motiu = fets.motiu ?? ''
  const falten = Math.max(0, fets.kgTotal - fets.kgCanalitzats)

  const fes = (
    etapa: EtapaProces,
    variant: string | null,
    index: number,
    vars: Record<string, string | number>,
    emToca: boolean,
    enllac?: string,
  ): PuntProces => ({
    etapa,
    index,
    variant,
    claus: claus(`proc.${p}_${variant ? `${etapa}_${variant}` : etapa}`),
    vars,
    emToca,
    enllac,
  })

  // 1. Las salidas ganan a todo.
  if (fets.estado === 'cancelada') return fes('cancellada', null, -1, { motiu }, false)
  if (fets.estado === 'no_colocada') {
    return fes('sense_desti', null, -1, { motiu }, rol === 'productor',
      rol === 'productor' ? '/productor/ofertes/nova' : undefined)
  }

  // 2. El papel manda sobre el estado del excedente.
  if (rec?.estado === 'conciliado' || fets.estado === 'cerrada') {
    return fes('tancada', null, 4, { kg: fets.kgCanalitzats }, false,
      rol === 'productor' ? '/productor/documents' : undefined)
  }
  if (rec?.estado === 'confirmado') {
    return rol === 'productor'
      ? fes('confirmada', null, 3, {}, false)
      : fes('confirmada', null, 3, { num }, true, '/equip/albarans')
  }
  if (rec?.estado === 'entregado') {
    return rol === 'productor'
      ? fes('recollida', 'entregat', 2, { num }, fets.pendentDeMi === true, '/productor/documents')
      : fes('recollida', 'entregat', 2, { dies: rec.diesEsperant ?? 0 }, false)
  }
  if (rec?.estado === 'emitido') {
    return rol === 'productor'
      ? fes('recollida', 'emes', 2, { num }, false)
      : fes('recollida', 'emes', 2, { num }, true, '/equip/albarans')
  }

  // 3. Todavía en reparto: aquí sí importa que se haya pasado la fecha.
  if (rol === 'equip' && fets.vencuda === true) {
    const index = fets.estado === 'parcial' || fets.estado === 'bloqueada' ? 1 : 0
    return fes('vencuda', null, index, { n: falten }, true)
  }

  if (fets.estado === 'parcial' || fets.estado === 'bloqueada') {
    const variant = fets.estado === 'bloqueada' ? 'coberta' : 'parcial'
    if (variant === 'coberta') {
      return rol === 'productor'
        ? fes('assignada', 'coberta', 1, {}, false)
        : fes('assignada', 'coberta', 1, {}, true, '/equip/albarans')
    }
    return rol === 'productor'
      ? fes('assignada', 'parcial', 1, { n: fets.kgCanalitzats, m: falten }, false)
      : fes('assignada', 'parcial', 1, { kg: fets.kgCanalitzats, total: fets.kgTotal }, true)
  }

  // 4. Recién publicada, con o sin movimiento. Para el equipo «en gestión» empieza al
  // ENVIARLA, aunque todavía no haya contestado nadie; para el productor, solo cuando hay
  // alguien interesado (saber a cuántas entidades se ha escrito no le dice nada).
  const enGestio = rol === 'equip'
    ? (fets.nEnviades ?? 0) > 0 || (fets.nInteressades ?? 0) > 0
    : (fets.nInteressades ?? 0) > 0
  if (enGestio) {
    return rol === 'productor'
      ? fes('publicada', 'gestio', 0, { n: fets.nInteressades ?? 0 }, false)
      : fes('publicada', 'gestio', 0, {
        n: fets.nEnviades ?? 0, m: fets.nInteressades ?? 0, k: fets.nPerAprovar ?? 0,
      }, true, '/equip/aprovacions')
  }
  return fes('publicada', null, 0, {}, rol === 'equip')
}

// --- El interés de una entidad ---------------------------------------------------------

/**
 * En qué punto está el interés de una entidad. No recibe rol: esta lectura es la del
 * receptor, y el equipo ve la oferta entera con `puntOferta`.
 */
export function puntInteres(fets: FetsInteres): PuntProces {
  const ent = fets.albaraEnt ?? null
  const num = ent?.numero ?? '—'
  const motiu = fets.motiu ?? ''

  const fes = (
    etapa: EtapaProces,
    variant: string | null,
    index: number,
    vars: Record<string, string | number>,
    emToca: boolean,
    enllac?: string,
  ): PuntProces => ({
    etapa,
    index,
    variant,
    claus: claus(`proc.r_${variant ? `${etapa}_${variant}` : etapa}`),
    vars,
    emToca,
    enllac,
  })

  // Lo que dijo la entidad manda sobre lo demás: si dijo que no, esa es la historia.
  if (fets.estado === 'rebutjada') return fes('declinada', null, -1, {}, false)
  if (fets.aprovacio === 'rebutjada') return fes('no_assignada', null, -1, { motiu }, false)
  if (
    (fets.ofertaEstado === 'cancelada' || fets.ofertaEstado === 'no_colocada') &&
    fets.aprovacio !== 'aprovada'
  ) {
    return fes('retirada', null, -1, {}, false)
  }

  if (fets.estado === 'pendent') {
    return fes('oferta_rebuda', null, 0, {}, true, '/receptor/mercat')
  }
  if (fets.aprovacio === 'pendent') return fes('interes_enviat', null, 1, {}, false)

  // Aprobada: a partir de aquí lo cuenta el albarán de entrega.
  if (ent?.estado === 'conciliado') {
    return fes('tancada', null, 5, { kg: fets.kg ?? 0 }, false, '/receptor/historic')
  }
  if (ent?.estado === 'confirmado') return fes('confirmada', null, 4, {}, false)
  if (ent?.estado === 'entregado') {
    return fes('entrega', 'entregat', 3, { num }, true, '/receptor/documents')
  }
  if (ent?.estado === 'emitido') return fes('entrega', 'emes', 3, { num }, false)
  return fes('assignada', null, 2, { kg: fets.kg ?? 0 }, false)
}

// --- Etiqueta de estado y leyenda ------------------------------------------------------

/**
 * El badge de estado de una oferta.
 *
 * Sustituye a las dos copias idénticas que había: `estatEtiqueta` (panel del productor) y
 * `estadoLabel` (listado del equipo). Dos copias de un mapa de estados son dos sitios donde
 * un estado nuevo puede caer en el color equivocado.
 */
export function etiquetaEstatOferta(estado: EstadoExcedente): { key: string; clase: string } {
  switch (estado) {
    case 'publicada': return { key: 'off.st_published', clase: 'bg-secondary text-secondary-foreground' }
    case 'parcial': return { key: 'off.st_partial', clase: 'bg-aviso-fondo text-aviso' }
    case 'bloqueada': return { key: 'off.st_blocked', clase: 'bg-exito-fondo text-exito' }
    case 'borrador': return { key: 'off.st_draft', clase: 'bg-muted text-muted-foreground' }
    case 'cancelada': return { key: 'off.st_cancelled', clase: 'bg-error-fondo text-error' }
    case 'no_colocada': return { key: 'off.st_uncoll', clase: 'bg-muted text-muted-foreground' }
    case 'cerrada': return { key: 'off.st_closed', clase: 'bg-muted text-muted-foreground' }
    default: return { key: estado, clase: 'bg-muted text-muted-foreground' }
  }
}

export const ESTATS_OFERTA: readonly EstadoExcedente[] = [
  'borrador', 'publicada', 'parcial', 'bloqueada', 'cerrada', 'no_colocada', 'cancelada',
] as const

/** Los siete estados con su badge y su explicación, para `LlegendaEstats`. */
export function llegendaOferta(): { key: string; clase: string; descKey: string }[] {
  return ESTATS_OFERTA.map((estado) => ({
    ...etiquetaEstatOferta(estado),
    descKey: `proc.llegenda_oferta_${estado}`,
  }))
}

// --- El «Com funciona» del tablero del equipo ------------------------------------------

export interface FaseEquip {
  /** Sufijo de las claves `fase.<clau>_t` y `fase.<clau>_d`. */
  clau: string
  /** A dónde se trabaja esa fase. Todas tienen que existir en `nav.ts`. */
  rutes: string[]
}

/**
 * Las seis fases del servicio, en el mismo orden en que el menú del equipo las lista.
 *
 * Están aquí y no en el componente del tablero porque la prueba comprueba que cada ruta
 * exista de verdad en `nav.ts`: un «Com funciona» que enlaza a una sección retirada es
 * peor que no tener enlace.
 */
export const FASES_EQUIP: readonly FaseEquip[] = [
  { clau: 'conveni', rutes: ['/equip/convenis'] },
  { clau: 'entrada', rutes: ['/equip/ofertes', '/equip/espigolades'] },
  { clau: 'distribucio', rutes: ['/equip/ofertes'] },
  { clau: 'aprovacio', rutes: ['/equip/aprovacions'] },
  { clau: 'lliurament', rutes: ['/equip/albarans'] },
  { clau: 'tancament', rutes: ['/equip/costos', '/equip/tancament'] },
] as const
