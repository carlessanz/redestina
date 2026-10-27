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
// ⚠️ **VENTA Y MAQUILA NO TIENEN REC** (07-10-2026). El trigger que crea los albaranes
//    (`trg_canalizaciones_crea_albaranes`) solo crea la entrada del generador en donación:
//    en venta y maquila la mercancía va del generador al comprador con el OPE. Hasta hoy
//    la escalera solo sabía de donación y dejaba los cuatro pasos del REC en «ara» para
//    siempre en una venta. Ahora el paso de los albaranes no pide REC (variante
//    `albarans_venda`), el coste
//    por kilo no frena nada —el CT no lleva importes— y el último escalón es el
//    **certificado de transacción** (CT), no el de donación. Una oferta con varias
//    modalidades puede necesitar los dos: lo dicen los albaranes de salida (ENT u OPE), que
//    son la modalidad real de cada entrega; la de la oferta solo vale mientras no hay
//    ninguno.
//
// ⚠️ **LA RECOGIDA SON CUATRO PASOS, NO OCHO** (27-10-2026, gestión autónoma, fase 3). Desde
//    que los albaranes de una recogida los genera la VALIDACIÓN (`validar_recollida`,
//    17-10-2026), nadie los emite, marca entregados ni confirma a mano: «Registra la
//    recollida» —la receptora desde su ficha, o el equipo en su nombre con
//    `registrar_recollida_assistida`— y la validación hacen todo eso en una transacción. Los
//    ocho pasos `rec_*`/`ent_*` describían un circuito que ya no existe y pedían al equipo
//    «emet el REC» sobre un borrador que la base no le deja emitir (`recollida_no_validada`).
//    Quedan: la hora (informativa: NO bloquea registrar), el registro, los albaranes (que
//    salen solos) y la conciliación (que normalmente también).
//
// ⚠️ **`pendent_validacio` ES UN PASO** (`oferta_validar`), no «publicada». La oferta está
//    dada de alta pero no sale al Mercat hasta que el equipo la valida, así que distribuirla
//    queda bloqueado con su motivo hasta entonces.
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
  | 'oferta_alta' | 'oferta_publicar' | 'oferta_validar'
  // 3 · distribucio
  | 'distribuir'
  // 4 · aprovacio
  | 'interes' | 'conv_rec' | 'aprovar'
  // 5 · lliurament
  | 'recollida_hora' | 'recollida_registrar' | 'albarans' | 'conciliar'
  // 6 · tancament
  | 'cost' | 'tancament' | 'certificat'

/** Índice de la fase en `FASES_EQUIP`. Se reutilizan sus seis nombres, no se inventan otros. */
const FASE_DE: Record<PasCanal, number> = {
  conv_gen_preparar: 0, conv_gen_firmar: 0, conv_gen_contrasignar: 0,
  oferta_alta: 1, oferta_publicar: 1, oferta_validar: 1,
  distribuir: 2,
  interes: 3, conv_rec: 3, aprovar: 3,
  recollida_hora: 4, recollida_registrar: 4, albarans: 4, conciliar: 4,
  cost: 5, tancament: 5, certificat: 5,
}

/** En el orden en que se recorren. Es la escalera que ve la pantalla. */
export const PASSOS_CANAL: readonly PasCanal[] = [
  'conv_gen_preparar', 'conv_gen_firmar', 'conv_gen_contrasignar',
  'oferta_alta', 'oferta_publicar', 'oferta_validar',
  'distribuir',
  'interes', 'conv_rec', 'aprovar',
  'recollida_hora', 'recollida_registrar', 'albarans', 'conciliar',
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
  /**
   * La base de sus claves i18n (`canal.<clau>_t/_passa/_toca`) cuando no es el propio
   * `pas`. Existe para los pasos que dicen cosas distintas según la modalidad: el
   * certificado de una venta es el CT (`certificat_ct`), no el de donación. Ausente = `pas`.
   * Léase con `clauPas()`, no a mano.
   */
  clau?: string
}

/** La base de las claves i18n de un paso: su variante si la tiene, si no el propio paso. */
export function clauPas(p: Pick<PasEscala, 'pas' | 'clau'>): string {
  return p.clau ?? p.pas
}

// --- Los hechos ------------------------------------------------------------------------
//
// Son exactamente lo que devuelve la RPC `canalitzacio_assistida(uuid)` (`20270328100400`),
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
  /**
   * Un REC `confirmado` cuyo neto no cuadra con sus salidas dentro de la tolerancia
   * (`propuesta_conciliacion`): no se concilia solo y hay que hacerlo con motivo. La RPC lo
   * devuelve desde `20270430100000`; ausente o null = no se sabe o no aplica.
   */
  fora_tolerancia?: boolean | null
  conciliado_at?: string | null
}

/**
 * Una canalización del lote. Lo que no sea `id` es opcional porque el índice solo tiene un
 * resumen (`canalitzacions_actives`): ahí estos campos no vienen, y **ausente significa «no
 * se sabe»**, no «falta». Por eso la hora solo cuenta como pendiente con un `null` explícito,
 * que es lo que manda la ficha cuando de verdad no hay hora.
 */
export interface CanalitzacioCanal {
  id: string
  kg_conciliados: number | null
  coste_kg: number | null
  estado?: string | null
  entidad_id?: string | null
  entitat?: string | null
  kg_confirmados?: number | null
  valorizacion?: string | null
  data_hora_recollida?: string | null
  /** La receptora (o el equipo en su nombre) ha registrado los kilos. Se borra al retornar. */
  recollida_registrada_at?: string | null
  /** Un admin la validó: desde ese momento hay albaranes. */
  recollida_validada_at?: string | null
  recollida_retornada_at?: string | null
  kg_declarats?: number | null
  resultat_recollida?: string | null
  incidencia?: boolean | null
}

export interface FetsCanal {
  oferta: {
    estado: EstadoExcedente
    kg_total: number | null
    /** `espigolament` = entró por la jornada de espigueo, no por el alta. */
    origen?: string | null
    /**
     * La modalidad PRINCIPAL de la oferta (la donación si la tiene). Solo decide mientras
     * no hay albaranes de salida; en cuanto los hay, mandan ellos (ENT = donación, OPE =
     * venta o maquila). Ausente = se asume donación, que es lo que el ciclo hacía siempre.
     */
    modalitat?: string | null
  }
  conveni_gen: ConveniCanal | null
  respostes: RespostaCanal[]
  canalitzacions: CanalitzacioCanal[]
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
  /**
   * Los acumulados del generador en el cierre del ejercicio (`cierres_donante`): uno por
   * tipo. Tampoco viene de la RPC del ciclo —no lee el cierre—: lo añade la pantalla. Con
   * ellos el escalón del certificado sabe si YA se emitió; sin ellos (el índice, o un fallo
   * de lectura) se conserva la aproximación de antes, «ejercicio declarado».
   */
  certificats?: CertificatGenerador[]
}

/** Lo que la escalera necesita de una fila de `cierres_donante`. */
export interface CertificatGenerador {
  tipo: 'donacio' | 'transaccio'
  certificado_numero: string | null
  /** Algún bloqueo `bloqueja: true` en la fila. */
  bloqueja: boolean
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

/** Las canalizaciones que cuentan: una anulada ya no es una entrega. */
export function canalitzacionsVives(f: Pick<FetsCanal, 'canalitzacions'>): CanalitzacioCanal[] {
  return f.canalitzacions.filter((c) => c.estado !== 'anulada')
}

/**
 * La salida (ENT u OPE) de una canalización. El borrador SÍ cuenta aquí, con avance 0: es
 * el albarán que la validación va a emitir, y saltárselo haría que una entrega sin validar
 * desapareciera del cálculo y la escalera fuera al ritmo de las demás.
 */
function sortidaDe(f: FetsCanal, canalitzacio: string): AlbaraCanal | null {
  return f.albarans
    .filter((a) => (a.tipo === 'ENT' || a.tipo === 'OPE') && a.canalizacion_id === canalitzacio
      && a.estado !== 'anulado' && a.estado !== 'rectificado')
    .sort((a, b) => avanc(b) - avanc(a))[0] ?? null
}

/**
 * El avance de las salidas, al ritmo de la que va más atrás. Por canalización viva —no por
 * albarán suelto—, y si algún albarán de salida no casa con ninguna (el resumen del índice),
 * cuenta también.
 */
function avancSortides(f: FetsCanal): number {
  const vives = canalitzacionsVives(f)
  const perCanal = vives.map((c) => avanc(sortidaDe(f, c.id)))
  const solts = f.albarans
    .filter((a) => (a.tipo === 'ENT' || a.tipo === 'OPE') && VIU.includes(a.estado)
      && !vives.some((c) => c.id === a.canalizacion_id))
    .map((a) => avanc(a))
  const tots = [...perCanal, ...solts]
  return tots.length === 0 ? 0 : Math.min(...tots)
}

/**
 * ¿Está registrada la recogida de esta canalización? Lo dice el registro (de la receptora o
 * del equipo) o la validación; y, para las del circuito anterior al 17-10-2026, que su
 * salida ya esté confirmada: entonces la confirmaron por el enlace y no hay nada que
 * registrar.
 */
export function recollidaRegistrada(f: FetsCanal, c: CanalitzacioCanal): boolean {
  return Boolean(c.recollida_registrada_at || c.recollida_validada_at)
    || c.kg_conciliados != null
    || avanc(sortidaDe(f, c.id)) >= 3
}

/** Registrada y esperando la validación de un admin: los albaranes todavía no existen. */
export function recollidaPerValidar(c: CanalitzacioCanal): boolean {
  return Boolean(c.recollida_registrada_at) && !c.recollida_validada_at
}

const CONVENI_FET: ConvenioEstado[] = ['firmat', 'vigent']

const VENDA = ['venda', 'maquila']

/**
 * Qué certificados pide este lote: el de donación (CD), el de transacción (CT) o los dos.
 *
 * El orden de las preguntas es el de la fiabilidad del hecho: una espigolada o un REC vivo
 * dicen donación sin duda; los albaranes de salida dicen la modalidad REAL de cada entrega
 * (el trigger elige ENT u OPE con la `valorizacion` de la canalización); y solo si todavía
 * no hay ninguno se mira la modalidad principal de la oferta.
 */
export function certificatsDelLot(f: FetsCanal): { donacio: boolean; transaccio: boolean } {
  const sortidesTotes = f.albarans.filter((a) => a.tipo === 'ENT' || a.tipo === 'OPE')
  const ambEnt = sortidesTotes.some((a) => a.tipo === 'ENT')
  const ambOpe = sortidesTotes.some((a) => a.tipo === 'OPE')
  const modalitatVenda = VENDA.includes(f.oferta.modalitat ?? '')
  const donacio = f.oferta.origen === 'espigolament'
    || rec(f) != null
    || ambEnt
    || (sortidesTotes.length === 0 && !modalitatVenda)
  const transaccio = ambOpe || (sortidesTotes.length === 0 && modalitatVenda)
  return { donacio, transaccio }
}

/**
 * La escalera entera: los 17 pasos con su estado.
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
  const vives = canalitzacionsVives(f)
  const totConciliat = vives.length > 0 && vives.every((c) => c.kg_conciliados != null)
  // La hora solo falta con un `null` EXPLÍCITO: en el índice el campo no viene (ver
  // `CanalitzacioCanal`), y decir «fixa l'hora» de un lote que quizá ya la tiene es inventar.
  const ambHora = vives.every((c) => c.data_hora_recollida !== null || recollidaRegistrada(f, c))
  const registrades = vives.every((c) => recollidaRegistrada(f, c))
  const recollidesPerValidar = vives.some((c) => recollidaPerValidar(c))
  const foraTolerancia = r?.estado === 'confirmado' && r.fora_tolerancia === true

  const cancellada = f.oferta.estado === 'cancelada' || f.oferta.estado === 'no_colocada'
  const perValidar = f.oferta.estado === 'pendent_validacio'

  // Venta o maquila PURAS: sin ninguna entrega de donación, no hay REC ni coste que exigir.
  const { donacio, transaccio } = certificatsDelLot(f)
  const senseRec = !donacio

  /**
   * ¿Está emitido el certificado (o los dos) que pide este lote? Con los acumulados del
   * cierre a mano, se mira el número; sin ellos, la aproximación de siempre.
   */
  const cal: ('donacio' | 'transaccio')[] = [
    ...(donacio ? ['donacio' as const] : []),
    ...(transaccio ? ['transaccio' as const] : []),
  ]
  const certs = f.certificats
  const certFet = certs
    ? cal.length > 0 && cal.every((tipo) => certs.some((c) => c.tipo === tipo && c.certificado_numero))
    : f.exercici?.estado === 'declarat'
  const certBloquejat = certs != null && cal.some((tipo) => certs.some(
    (c) => c.tipo === tipo && !c.certificado_numero && c.bloqueja,
  ))
  const clauCert = donacio && transaccio ? 'certificat_mixt' : transaccio ? 'certificat_ct' : undefined

  const brut: { fet: boolean; motiu?: string; bloqueig?: string; clau?: string }[] = PASSOS_CANAL.map((pas) => {
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
      case 'oferta_validar':
        // Lo hace el equipo (`validar_oferta`), así que es un paso con su «ara», no un
        // bloqueo: el bloqueo con motivo lo lleva la distribución, que es lo que frena.
        if (cancellada) return { fet: false, bloqueig: `canal.bl_${f.oferta.estado}` }
        if (espigolada) return { fet: true, motiu: 'canal.bl_espigolada' }
        return { fet: f.oferta.estado !== 'borrador' && !perValidar }

      // ── 3 · distribucio ──
      case 'distribuir':
        if (espigolada) return { fet: true, motiu: 'canal.bl_espigolada' }
        if (cancellada) return { fet: false, bloqueig: `canal.bl_${f.oferta.estado}` }
        if (perValidar) return { fet: false, bloqueig: 'canal.bl_pendent_validacio' }
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
      // Una espigolada no tiene receptora que registre nada: la jornada ya pesó el producto
      // y sus albaranes los emite el equipo desde la ficha. Hora y registro no le tocan.
      case 'recollida_hora':
        if (espigolada) return { fet: true, motiu: 'canal.bl_espigolada' }
        if (vives.length === 0) return { fet: false, bloqueig: 'canal.bl_sense_canalitzacions' }
        return { fet: ambHora }
      case 'recollida_registrar':
        if (espigolada) return { fet: true, motiu: 'canal.bl_espigolada' }
        if (vives.length === 0) return { fet: false, bloqueig: 'canal.bl_sense_canalitzacions' }
        // La hora NO bloquea: es informativa, y una recogida que ya se hizo se registra
        // tenga o no hora acordada.
        return { fet: registrades }
      case 'albarans': {
        // Qué dicen los textos depende de por qué faltan: en venta no hay REC; si alguien ya
        // registró, lo que falta es validar; en una espigolada los emite el equipo a mano.
        const clau = espigolada ? 'albarans_espigolada'
          : recollidesPerValidar ? 'albarans_validar'
            : senseRec ? 'albarans_venda' : undefined
        return {
          fet: vives.length > 0 && aSort >= 3 && (senseRec || aRec >= 3),
          bloqueig: vives.length === 0 ? 'canal.bl_sense_canalitzacions' : undefined,
          clau,
        }
      }
      case 'conciliar':
        // Normalmente llega sola: validar concilia (`validar_recollida`). Lo que queda aquí
        // es un REC fuera de tolerancia, que hay que conciliar con motivo, o una salida
        // confirmada por el circuito anterior que la conciliación automática no recogió.
        return {
          fet: totConciliat && (senseRec || aRec >= 4),
          bloqueig: foraTolerancia ? 'canal.bl_fora_tolerancia' : undefined,
        }

      // ── 6 · tancament ──
      case 'cost':
        // El CT no lleva importes: en venta y maquila el coste por kilo es un indicador
        // interno (`sense_cost` avisa, no bloquea), así que no frena el ciclo.
        if (!donacio) return { fet: true, motiu: 'canal.bl_cost_no_cal' }
        return { fet: f.cost_falten === 0 }
      case 'tancament':
        return {
          fet: f.exercici != null && ['tancat', 'declarat'].includes(f.exercici.estado),
          bloqueig: donacio && f.cost_falten > 0
            ? 'canal.bl_sense_cost'
            : !totConciliat ? 'canal.bl_sense_conciliar' : undefined,
          clau: donacio ? undefined : 'tancament_ct',
        }
      case 'certificat':
        return {
          fet: certFet,
          // No es código: la fila de `parametros_documentales` sigue con valores
          // provisionales y `emitir_certificado()` se niega (42501) — y la del CT igual.
          // Es el último escalón del ciclo y se enseña EXPLICADO, no escondido (§12.10).
          // Solo bloquea en REAL: un certificado de prueba lleva marca de agua y no
          // sale de las fichas `es_test` (mismo criterio que `bloquejaProvisionals`).
          bloqueig: f.dadesProvisionals !== false && f.exercici?.modo !== 'prueba'
            ? 'canal.bl_dades_provisionals'
            : !totConciliat ? 'canal.bl_sense_conciliar'
              : certBloquejat ? 'canal.bl_certificat_bloquejat' : undefined,
          clau: clauCert,
        }
    }
  })

  let jaHiHaAra = false
  return PASSOS_CANAL.map((pas, i) => {
    const b = brut[i]
    const fase = FASE_DE[pas]
    const clau = b.clau ? { clau: b.clau } : {}
    if (b.fet) return { pas, fase, estat: 'fet' as EstatPas, motiuKey: b.motiu, ...clau }
    if (b.bloqueig) return { pas, fase, estat: 'bloquejat' as EstatPas, motiuKey: b.bloqueig, ...clau }
    if (!jaHiHaAra) { jaHiHaAra = true; return { pas, fase, estat: 'ara' as EstatPas, ...clau } }
    return { pas, fase, estat: 'pendent' as EstatPas, ...clau }
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
      titol: `canal.${clauPas(punt)}_t`,
      passa: `canal.${clauPas(punt)}_passa`,
      // Un paso bloqueado no dice «haz esto», dice POR QUÉ no se puede todavía.
      toca: punt.motiuKey ?? `canal.${clauPas(punt)}_toca`,
      qui: 'canal.qui_equip',
    },
    vars: {},
    // Siempre: esta pantalla es del equipo y el modelo es asistido. Incluso lo que firma
    // otra persona lo conduce alguien de aquí.
    emToca: punt.estat === 'ara',
  }
}
