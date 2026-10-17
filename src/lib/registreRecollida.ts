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
