// «Registra la recollida» del receptor (17-10-2026): lo que se puede comprobar ANTES de
// llamar a la base. PURO, con prueba (`tests/registreRecollida.test.ts`).
//
// ⚠️ Es la misma regla que `registrar_recollida()` (`20270426100000`), escrita otra vez para
//    poder avisar bajo el campo en vez de con un error al pulsar. Quien manda es la base: si
//    las dos divergen, lo peor que pasa es que el botón deje pasar algo que la base rechaza
//    con su código, y el diálogo lo enseña traducido.

export type ResultatRecollida = 'coincideix' | 'menys' | 'mes'

export interface EntradaRegistre {
  resultat: ResultatRecollida
  /** Lo que escribe la persona, tal cual (admite coma decimal). */
  kg: string
  /** Los kilos asignados a esta canalización. */
  kgAssignats: number | null
  observacions: string
  /** La fecha y hora declaradas (ISO), o null = ahora. */
  data: string | null
  /** «Ahora», inyectable para la prueba. */
  ara?: Date
}

/** Clave i18n del primer problema, o null si se puede enviar. */
export type ErrorRegistre =
  | 'rrec.err_kg'
  | 'rrec.err_kg_zero'
  | 'rrec.err_no_menys'
  | 'rrec.err_no_mes'
  | 'rrec.err_motiu'
  | 'rrec.err_motiu_llarg'
  | 'rrec.err_data_futura'

/** El número que ha escrito la persona, o null si no es un número válido. */
export function llegeixKg(text: string): number | null {
  const net = text.trim().replace(/\s/g, '').replace(',', '.')
  if (net === '' || !/^\d+(\.\d+)?$/.test(net)) return null
  const n = Number(net)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Los kilos que se enviarán: con «coincideix», exactamente los asignados. */
export function kgDelRegistre(e: Pick<EntradaRegistre, 'resultat' | 'kg' | 'kgAssignats'>): number | null {
  if (e.resultat === 'coincideix') return e.kgAssignats
  return llegeixKg(e.kg)
}

export function validaRegistre(e: EntradaRegistre): ErrorRegistre | null {
  const ara = e.ara ?? new Date()
  if (e.data) {
    const d = new Date(e.data)
    if (!Number.isNaN(d.getTime()) && d.getTime() > ara.getTime() + 5 * 60 * 1000) return 'rrec.err_data_futura'
  }
  if (e.resultat === 'coincideix') return null
  const kg = llegeixKg(e.kg)
  if (kg == null || kg > 1_000_000) return 'rrec.err_kg'
  if (kg === 0) return 'rrec.err_kg_zero'
  if (e.kgAssignats != null && e.resultat === 'menys' && kg >= e.kgAssignats) return 'rrec.err_no_menys'
  if (e.kgAssignats != null && e.resultat === 'mes' && kg <= e.kgAssignats) return 'rrec.err_no_mes'
  const obs = e.observacions.trim()
  if (obs === '') return 'rrec.err_motiu'
  if (obs.length > 1000) return 'rrec.err_motiu_llarg'
  return null
}

/** La diferencia frente a lo asignado (positiva = más), o null si no se puede calcular. */
export function diferenciaKg(e: Pick<EntradaRegistre, 'resultat' | 'kg' | 'kgAssignats'>): number | null {
  const kg = kgDelRegistre(e)
  if (kg == null || e.kgAssignats == null) return null
  return Math.round((kg - e.kgAssignats) * 100) / 100
}

/** Los códigos con los que la base rechaza un registro, con su texto. */
export const ERRORS_BASE: Record<string, string> = {
  resultat_invalid: 'c.error',
  kg_no_coincideixen: 'rrec.err_no_coincideixen',
  kg_invalids: 'rrec.err_kg',
  kg_zero: 'rrec.err_kg_zero',
  kg_no_menys: 'rrec.err_no_menys',
  kg_no_mes: 'rrec.err_no_mes',
  falta_motiu_diferencia: 'rrec.err_motiu',
  motiu_llarg: 'rrec.err_motiu_llarg',
  data_futura: 'rrec.err_data_futura',
  data_anterior: 'rrec.err_data_anterior',
  ja_registrada: 'rrec.err_ja_registrada',
  sense_albara: 'rrec.err_sense_albara',
  canalitzacio_anulada: 'rrec.err_anulada',
}

/** El texto de un rechazo de la base: por su código, si es nuestro; si no, null. */
export function clauErrorBase(missatge: string | null | undefined, codi: string | null | undefined): string | null {
  if (codi === '42501') return 'rrec.err_permis'
  const m = missatge ?? ''
  for (const [c, clau] of Object.entries(ERRORS_BASE)) if (m === c || m.includes(c)) return clau
  return null
}

// ---------------------------------------------------------------------------------------
// La validación del equipo (17-10-2026, regla de Carles): registrar la recogida ya NO genera
// los albaranes. Lo que declara el receptor queda «pendent de validació de l'equip» hasta que
// un admin (`pot_aprovar()`) lo valida —y entonces se emiten y se concilian— o lo devuelve al
// receptor con un motivo para que lo vuelva a registrar.
// ---------------------------------------------------------------------------------------

/** En qué punto está el registro de una recogida, visto desde sus fechas. */
export type EstatValidacio = 'sense_registre' | 'pendent_validacio' | 'validada' | 'retornada'

export interface DatesValidacio {
  recollida_registrada_at?: string | null
  recollida_validada_at?: string | null
  recollida_retornada_at?: string | null
}

/**
 * Lo deduce de las tres fechas de la canalización, sin suponer qué deja la base al retornar:
 * si borra `recollida_registrada_at`, o si lo conserva y solo escribe `recollida_retornada_at`,
 * sale lo mismo. Un registro POSTERIOR a la devolución vuelve a estar pendiente.
 */
export function estatValidacio(c: DatesValidacio): EstatValidacio {
  if (c.recollida_validada_at) return 'validada'
  const reg = c.recollida_registrada_at ? new Date(c.recollida_registrada_at).getTime() : null
  const ret = c.recollida_retornada_at ? new Date(c.recollida_retornada_at).getTime() : null
  if (reg != null && (ret == null || reg > ret)) return 'pendent_validacio'
  if (ret != null) return 'retornada'
  return 'sense_registre'
}

/**
 * Los kilos que valida el equipo: lo que escribe, o lo declarado si lo deja vacío. Y si hace
 * falta motivo: con diferencia frente a lo asignado, o si corrige lo que declaró el receptor
 * (la base lo exige igual: `cal_motiu_validacio`).
 */
export function validacioCalMotiu(e: {
  kg: number | null
  kgAssignats: number | null
  kgDeclarats: number | null
}): boolean {
  if (e.kg == null) return false
  const difAssignats = e.kgAssignats != null && Math.abs(e.kg - e.kgAssignats) > 0.001
  const canviDeclarats = e.kgDeclarats != null && Math.abs(e.kg - e.kgDeclarats) > 0.001
  return difAssignats || canviDeclarats
}

/** Los rechazos de `validar_recollida()` y `retornar_recollida()`, con su texto. */
//
// ⚠️ El ORDEN importa (se busca por `includes()`): `cal_motiu_validacio` antes que `cal_motiu`.
export const ERRORS_VALIDACIO: [string, string][] = [
  ['cal_motiu_validacio', 'vrec.err_cal_motiu'],
  ['cal_motiu', 'vrec.err_cal_motiu_retorn'],
  ['no_registrada', 'vrec.err_no_registrada'],
  ['ja_validada', 'vrec.err_ja_validada'],
  ['kg_invalids', 'rrec.err_kg'],
  ['motiu_llarg', 'rrec.err_motiu_llarg'],
  ['albara_ja_confirmat', 'vrec.err_albara_ja_confirmat'],
  ['sense_albara', 'rrec.err_sense_albara'],
  ['canalitzacio_anulada', 'rrec.err_anulada'],
  ['canalitzacio_inexistent', 'vrec.err_inexistent'],
]

export function clauErrorValidacio(missatge: string | null | undefined, codi: string | null | undefined): string | null {
  if (codi === '42501') return 'vrec.err_permis'
  const m = missatge ?? ''
  for (const [c, clau] of ERRORS_VALIDACIO) if (m === c || m.includes(c)) return clau
  return null
}

// ---------------------------------------------------------------------------------------
// El modo ASISTIDO (27-10-2026, gestión autónoma, fase 3): el equipo registra la recogida en
// nombre de la receptora (`registrar_recollida_assistida()`) y la valida en la misma llamada.
// El formulario es el MISMO que ve la receptora y la regla de los kilos también; cambia qué
// se manda y qué rechazos puede haber.
// ---------------------------------------------------------------------------------------

/**
 * Lo que va a la RPC asistida a partir del texto del formulario. Con diferencia, el motivo
 * es a la vez lo que guarda el registro (`p_observacions`, como el motivo de la receptora) y
 * el de la validación (`p_motiu`): un solo campo, porque es un solo hecho y teclearlo dos
 * veces solo serviría para que dijeran cosas distintas. Sin diferencia, el texto es una
 * observación y la validación no pide motivo.
 */
export function campsAssistit(e: Pick<EntradaRegistre, 'resultat' | 'observacions'>): {
  observacions: string | null
  motiu: string | null
} {
  const text = e.observacions.trim() || null
  return e.resultat === 'coincideix'
    ? { observacions: text, motiu: null }
    : { observacions: text, motiu: text }
}

/**
 * La validación del modo asistido: la misma que la de la receptora (`validaRegistre`) — con
 * diferencia, el motivo es obligatorio también aquí (la base: `cal_motiu`).
 */
export function validaRegistreAssistit(e: EntradaRegistre): ErrorRegistre | null {
  return validaRegistre(e)
}

/**
 * Los rechazos de `registrar_recollida_assistida()` y `fixar_hora_recollida()`.
 *
 * ⚠️ El ORDEN importa (se busca por `includes()`): `cal_motiu_validacio` antes que
 *    `cal_motiu`, y las dos antes que las listas del registro y de la validación, donde
 *    `cal_motiu` significa otra cosa (el motivo de retornar).
 */
export const ERRORS_ASSISTIT: [string, string][] = [
  ['cal_motiu_validacio', 'vrec.err_cal_motiu'],
  ['cal_motiu', 'rrec.err_motiu'],
  ['foto_aliena', 'rrec.err_foto_aliena'],
  ['hora_passada', 'rrec.err_hora_passada'],
  ['cal_hora', 'rrec.err_cal_hora'],
  ['canalitzacio_inexistent', 'vrec.err_inexistent'],
  ['ja_validada', 'vrec.err_ja_validada'],
  ['albara_ja_confirmat', 'vrec.err_albara_ja_confirmat'],
]

export function clauErrorAssistit(missatge: string | null | undefined, codi: string | null | undefined): string | null {
  if (codi === '42501') return 'recol.need_admin'
  const m = missatge ?? ''
  for (const [c, clau] of ERRORS_ASSISTIT) if (m === c || m.includes(c)) return clau
  // Lo demás son los mismos rechazos que tiene la receptora al registrar.
  return clauErrorBase(m, null)
}

/** Los rechazos de fijar la hora: los suyos y los del registro que comparte. */
export function clauErrorHora(missatge: string | null | undefined, codi: string | null | undefined): string | null {
  if (codi === '42501') return 'rrec.err_hora_permis'
  return clauErrorAssistit(missatge, null)
}
