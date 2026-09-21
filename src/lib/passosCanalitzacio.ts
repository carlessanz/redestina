// El ciclo entero de una canalización, de punta a punta, para la pantalla guiada del
// equipo (modelo asistido, §1bis).
//
// POR QUÉ EXISTE. El panel del equipo ya tiene todas las piezas del circuito —ofertas,
// aprobaciones, albaranes, convenios, cierre— pero repartidas en siete pantallas, y nada
// dice en qué punto está un lote ni qué toca después. Este módulo lo dice UNA vez, en
// claves i18n y sin React, y la pantalla lo pinta.
//
// ⚠️ **COMPONE, NO DUPLICA.** Lo que ya saben `procesOferta.ts` y `seguentPas.ts` se les
//    pregunta a ellos: aquí vive el orden de los pasos y qué los bloquea, que es lo que no
//    estaba escrito en ninguna parte. Una segunda definición de «en qué etapa está una
//    oferta» acabaría discrepando de la primera.
//
// ⚠️ **EL ORDEN DE LAS COMPROBACIONES ES LA REGLA DE NEGOCIO**, igual que en `puntOferta`:
//    el convenio del generador bloquea la oferta; el de la receptora bloquea la
//    aprobación; el albarán manda sobre `excedentes.estado`; el coste por kilo bloquea el
//    cierre; y sin conciliar no hay certificado. Cambiar el orden cambia el producto.
//
// ⚠️ **UNA ESPIGOLADA NO RECORRE LAS SEIS FASES.** `crear_espigolada` crea de golpe la
//    jornada, un `excedente` por producto y su REC, así que entra al ciclo por la fase 5
//    con la entrada ya hecha. Sus fases 2-4 se marcan `fet` CON SU MOTIVO, nunca
//    `pendent`: una pantalla que le pide «publica la oferta» a un lote de espigueo es una
//    pantalla que no entiende de dónde viene su propio producto.
//
// ⚠️ **LAS CLAVES SE COMPONEN** (`canal.<pas>_t`), así que `tests/cobertura.test.ts` no las
//    ve: solo mira literales. Por eso existe `tests/passosCanalitzacio.test.ts`, que exige
//    cada una en `ca` y en `es`. Sin esa red, una fase sin traducir sale en pantalla como
//    `canal.rec_emetre_t`.

import type { ConvenioEstado, EstadoAlbaran, EstadoExcedente } from '../types'
import type { PuntProces } from './procesOferta'
import { FASES_EQUIP } from './procesOferta'

// --- Los pasos -------------------------------------------------------------------------

export type PasCanal =
  // 1 · conveni
  | 'conv_gen_preparar' | 'conv_gen_firmar' | 'conv_gen_contrasignar'
  // 2 · entrada
  | 'oferta_alta' | 'oferta_publicar'
  // 3 · distribucio
  | 'distribuir'
  // 4 · aprovacio
  | 'interes' | 'conv_rec' | 'aprovar'
  // 5 · lliurament
  | 'rec_emetre' | 'rec_entregat' | 'rec_confirmar' | 'rec_conciliar'
  | 'ent_emetre' | 'ent_entregat' | 'ent_confirmar'
  // 6 · tancament
  | 'cost' | 'tancament' | 'certificat'

/** Índice de la fase en `FASES_EQUIP`. Se reutilizan sus seis nombres, no se inventan otros. */
const FASE_DE: Record<PasCanal, number> = {
  conv_gen_preparar: 0, conv_gen_firmar: 0, conv_gen_contrasignar: 0,
  oferta_alta: 1, oferta_publicar: 1,
  distribuir: 2,
  interes: 3, conv_rec: 3, aprovar: 3,
  rec_emetre: 4, rec_entregat: 4, rec_confirmar: 4, rec_conciliar: 4,
  ent_emetre: 4, ent_entregat: 4, ent_confirmar: 4,
  cost: 5, tancament: 5, certificat: 5,
}

/** En el orden en que se recorren. Es la escalera que ve la pantalla. */
export const PASSOS_CANAL: readonly PasCanal[] = [
  'conv_gen_preparar', 'conv_gen_firmar', 'conv_gen_contrasignar',
  'oferta_alta', 'oferta_publicar',
  'distribuir',
  'interes', 'conv_rec', 'aprovar',
  'rec_emetre', 'rec_entregat', 'rec_confirmar', 'rec_conciliar',
  'ent_emetre', 'ent_entregat', 'ent_confirmar',
  'cost', 'tancament', 'certificat',
] as const

/** Las etiquetas cortas de las seis fases, para el indicador de progreso. */
export const PASSOS_FASE_CLAUS: readonly string[] =
  FASES_EQUIP.map((f) => `fase.${f.clau}_t`)

export type EstatPas = 'fet' | 'ara' | 'pendent' | 'bloquejat'

export interface PasEscala {
  pas: PasCanal
  /** 0-5, el índice de su fase en `FASES_EQUIP`. */
  fase: number
  estat: EstatPas
  /**
   * Por qué está así, cuando no es evidente. Clave i18n (`canal.bl_*`).
   *
   * Lo llevan los bloqueados —para poder decirlo en el botón Y en `QueTocaAra`, porque en
   * táctil no hay hover— y también algunos `fet`: una espigolada tiene la entrada hecha
   * sin haber pasado por el alta, y eso hay que explicarlo.
   */
  motiuKey?: string
}

// --- Los hechos ------------------------------------------------------------------------
//
// Son exactamente lo que devuelve la RPC `canalitzacio_assistida(uuid)` (`20270331100000`),
// más dos cosas que esa función no puede saber. La RPC devuelve HECHOS, no el paso: el paso
// se calcula aquí, y tenerlo en dos sitios garantiza que diverjan.

export interface ConveniCanal {
  id: string
  estado: ConvenioEstado
  numero?: string | null
}

export interface RespostaCanal {
  id: string
  entidad_id: string | null
  entitat: string
  estado: 'pendent' | 'acceptada' | 'rebutjada'
  aprovacio: 'pendent' | 'aprovada' | 'rebutjada'
  canalizacion_id: string | null
  conveni_rec: ConveniCanal | null
}

export interface AlbaraCanal {
  id: string
  tipo: string
  estado: EstadoAlbaran
  numero: string | null
  canalizacion_id: string | null
}

export interface FetsCanal {
  oferta: {
    estado: EstadoExcedente
    kg_total: number | null
    /** `espigolament` = entró por la jornada de espigueo, no por el alta. */
    origen?: string | null
  }
  conveni_gen: ConveniCanal | null
  respostes: RespostaCanal[]
  canalitzacions: { id: string; kg_conciliados: number | null; coste_kg: number | null }[]
  albarans: AlbaraCanal[]
  /** Productos del lote sin coste del ejercicio. > 0 bloquea el cierre (`sense_cost`). */
  cost_falten: number
  exercici: { estado: string; modo: string } | null
  /**
   * `parametros_documentales.datos_provisionales`. No viene de la RPC del ciclo: es de la
   * fila única del sistema documental, y con `true` **el certificado no se puede emitir**
   * por mucho que todo lo demás esté hecho (`emitir_certificado`, 42501).
   */
  dadesProvisionals?: boolean
}

// --- El cálculo ------------------------------------------------------------------------

/** Un albarán anulado o rectificado no cuenta: el ciclo vuelve a estar donde estaba. */
const VIU: EstadoAlbaran[] = ['emitido', 'entregado', 'confirmado', 'conciliado']

/** Hasta dónde ha llegado un albarán, como número, para poder comparar entre varios. */
const AVANC: Record<string, number> = {
  borrador: 0, emitido: 1, entregado: 2, confirmado: 3, conciliado: 4,
}

function avanc(a: AlbaraCanal | undefined | null): number {
  if (!a || !VIU.includes(a.estado)) return 0
  return AVANC[a.estado] ?? 0
}

/** El REC del lote: la entrada del generador. Como mucho hay uno vivo. */
function rec(f: FetsCanal): AlbaraCanal | null {
  return f.albarans.find((a) => a.tipo === 'REC' && VIU.includes(a.estado)) ?? null
}

/** Los de salida: ENT en donación, OPE en venta o maquila. Puede haber varios. */
function sortides(f: FetsCanal): AlbaraCanal[] {
  return f.albarans.filter((a) => (a.tipo === 'ENT' || a.tipo === 'OPE') && VIU.includes(a.estado))
}

/** El menos avanzado de los de salida: la escalera va al ritmo del que va más atrás. */
function avancSortides(f: FetsCanal): number {
  const s = sortides(f)
  if (s.length === 0) return 0
  return Math.min(...s.map((a) => avanc(a)))
}

const CONVENI_FET: ConvenioEstado[] = ['firmat', 'vigent']

/**
 * La escalera entera: los 19 pasos con su estado.
 *
 * Primero se decide, paso a paso, si está HECHO y si algo lo BLOQUEA —las dos cosas son
 * propiedades del paso, no de dónde esté el cursor—. Después, el primero que no está hecho
 * ni bloqueado es el que toca (`ara`) y el resto queda `pendent`. Separar las dos pasadas es
 * lo que permite que un paso bloqueado no se lleve por delante a los que vienen detrás.
 */
export function escalaCanal(f: FetsCanal): PasEscala[] {
  const espigolada = f.oferta.origen === 'espigolament'
  const cg = f.conveni_gen
  const cgFet = cg != null && CONVENI_FET.includes(cg.estado)
  const cgVigent = cg?.estado === 'vigent'

  const acceptades = f.respostes.filter((r) => r.estado === 'acceptada')
  const aprovades = acceptades.filter((r) => r.aprovacio === 'aprovada')
  // Una receptora con interés aceptado y sin convenio vigente: `aprovar_resposta()` lo
  // rechaza con `42501 sense_conveni` desde la fecha de corte, así que se dice antes.
  const senseConveniRec = acceptades.filter(
    (r) => r.aprovacio !== 'aprovada' && r.conveni_rec?.estado !== 'vigent',
  )

  const r = rec(f)
  const aRec = avanc(r)
  const aSort = avancSortides(f)
  const totConciliat = f.canalitzacions.length > 0
    && f.canalitzacions.every((c) => c.kg_conciliados != null)

  const cancellada = f.oferta.estado === 'cancelada' || f.oferta.estado === 'no_colocada'

  const brut: { fet: boolean; motiu?: string; bloqueig?: string }[] = PASSOS_CANAL.map((pas) => {
    switch (pas) {
      // ── 1 · conveni ──
      case 'conv_gen_preparar':
        return { fet: cg != null }
      case 'conv_gen_firmar':
        return { fet: cgFet }
      case 'conv_gen_contrasignar':
        return { fet: cgVigent }

      // ── 2 · entrada ──
      case 'oferta_alta':
        // El lote existe: si no, no habría pantalla. Lo que cambia es POR DÓNDE entró.
        return { fet: true, motiu: espigolada ? 'canal.bl_espigolada' : undefined }
      case 'oferta_publicar':
        if (cancellada) return { fet: false, bloqueig: `canal.bl_${f.oferta.estado}` }
        if (espigolada) return { fet: true, motiu: 'canal.bl_espigolada' }
        return {
          fet: f.oferta.estado !== 'borrador',
          bloqueig: !cgVigent ? 'canal.bl_sense_conveni_gen' : undefined,
        }

      // ── 3 · distribucio ──
      case 'distribuir':
        if (espigolada) return { fet: true, motiu: 'canal.bl_espigolada' }
        if (cancellada) return { fet: false, bloqueig: `canal.bl_${f.oferta.estado}` }
        return { fet: f.respostes.length > 0 }

      // ── 4 · aprovacio ──
      case 'interes':
        if (espigolada) return { fet: true, motiu: 'canal.bl_espigolada' }
        return { fet: acceptades.length > 0 }
      case 'conv_rec':
        if (espigolada) return { fet: true, motiu: 'canal.bl_espigolada' }
        return { fet: acceptades.length > 0 && senseConveniRec.length === 0 }
      case 'aprovar':
        if (espigolada) return { fet: true, motiu: 'canal.bl_espigolada' }
        return {
          fet: aprovades.length > 0,
          bloqueig: senseConveniRec.length > 0 ? 'canal.bl_sense_conveni_rec' : undefined,
        }

      // ── 5 · lliurament ──
      case 'rec_emetre':
        return { fet: aRec >= 1 }
      case 'rec_entregat':
        return { fet: aRec >= 2 }
      case 'rec_confirmar':
        return { fet: aRec >= 3 }
      case 'rec_conciliar':
        return {
          fet: aRec >= 4,
          // Conciliar el REC contrasta su neto con la suma de los ENT confirmados: sin
          // ellos no hay con qué contrastar.
          bloqueig: aRec >= 3 && aSort < 3 && sortides(f).length > 0
            ? 'canal.bl_falten_confirmacions'
            : undefined,
        }
      case 'ent_emetre':
        return { fet: aSort >= 1, bloqueig: f.canalitzacions.length === 0 ? 'canal.bl_sense_canalitzacions' : undefined }
      case 'ent_entregat':
        return { fet: aSort >= 2 }
      case 'ent_confirmar':
        return { fet: aSort >= 3 }

      // ── 6 · tancament ──
      case 'cost':
        return { fet: f.cost_falten === 0 }
      case 'tancament':
        return {
          fet: f.exercici != null && ['tancat', 'declarat'].includes(f.exercici.estado),
          bloqueig: f.cost_falten > 0
            ? 'canal.bl_sense_cost'
            : !totConciliat ? 'canal.bl_sense_conciliar' : undefined,
        }
      case 'certificat':
        return {
          fet: f.exercici?.estado === 'declarat',
          // No es código: la fila de `parametros_documentales` sigue con valores
          // provisionales y `emitir_certificado()` se niega (42501). Es el último escalón
          // del ciclo y se enseña EXPLICADO, no escondido (§12.10).
          // Solo bloquea en REAL: un certificado de prueba lleva marca de agua y no
          // sale de las fichas `es_test` (mismo criterio que `bloquejaProvisionals`).
          bloqueig: f.dadesProvisionals !== false && f.exercici?.modo !== 'prueba'
            ? 'canal.bl_dades_provisionals'
            : !totConciliat ? 'canal.bl_sense_conciliar' : undefined,
        }
    }
  })

  let jaHiHaAra = false
  return PASSOS_CANAL.map((pas, i) => {
    const b = brut[i]
    const fase = FASE_DE[pas]
    if (b.fet) return { pas, fase, estat: 'fet' as EstatPas, motiuKey: b.motiu }
    if (b.bloqueig) return { pas, fase, estat: 'bloquejat' as EstatPas, motiuKey: b.bloqueig }
    if (!jaHiHaAra) { jaHiHaAra = true; return { pas, fase, estat: 'ara' as EstatPas } }
    return { pas, fase, estat: 'pendent' as EstatPas }
  })
}

/**
 * Qué toca AHORA en este lote, en la misma forma que consumen `QueTocaAra` y compañía.
 *
 * Es el primer paso `ara`; si no hay ninguno, el primero `bloquejat` —hay que decir qué
 * frena, no callar—; y si tampoco, el ciclo está completo.
 */
export function puntCanal(f: FetsCanal): PuntProces & { pas: PasCanal | null; fase: number } {
  const escala = escalaCanal(f)
  const ara = escala.find((e) => e.estat === 'ara')
  const bloquejat = escala.find((e) => e.estat === 'bloquejat')
  const punt = ara ?? bloquejat ?? null

  if (!punt) {
    return {
      pas: null,
      fase: FASES_EQUIP.length - 1,
      etapa: 'tancada',
      index: FASES_EQUIP.length - 1,
      variant: null,
      claus: {
        titol: 'canal.complet_t',
        passa: 'canal.complet_passa',
        toca: 'canal.complet_toca',
        qui: 'canal.qui_equip',
      },
      vars: {},
      emToca: false,
    }
  }

  return {
    pas: punt.pas,
    fase: punt.fase,
    // El ciclo guiado no tiene etapas propias: se apoya en las seis fases del equipo, y
    // `etapa` solo existe porque `PuntProces` la pide. Lo que se pinta es `fase`.
    etapa: 'publicada',
    index: punt.fase,
    variant: punt.estat === 'bloquejat' ? 'bloquejat' : null,
    claus: {
      titol: `canal.${punt.pas}_t`,
      passa: `canal.${punt.pas}_passa`,
      // Un paso bloqueado no dice «haz esto», dice POR QUÉ no se puede todavía.
      toca: punt.motiuKey ?? `canal.${punt.pas}_toca`,
      qui: 'canal.qui_equip',
    },
    vars: {},
    // Siempre: esta pantalla es del equipo y el modelo es asistido. Incluso lo que firma
    // otra persona lo conduce alguien de aquí.
    emToca: punt.estat === 'ara',
  }
}
