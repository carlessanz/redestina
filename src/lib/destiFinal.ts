// El destino final de los kilos de una oferta (fase 1 de la revisión del 08-10-2026).
//
// PURO y sin red, con pruebas en `tests/destiFinal.test.ts`. La autoridad es la base
// (`registrar_desti_final()`, `desti_excedent()`): esto es lo que la pantalla necesita para
// decir «falten N kg» y para no dejar enviar algo que el servidor va a rechazar.
//
// ⚠️ «Kilos con destino Redestina» = lo ASIGNADO (`kg_confirmados` de las canalizaciones no
//    anuladas), la misma cuenta que `desti_excedent()` en SQL. Si una de las dos cambia, la
//    otra también: si no, la pantalla diría «falten 0» y la base respondería `massa_kg`.

/** Una fila del formulario, tal como la teclea quien la rellena. */
export interface FilaDesti {
  desti: string
  kg: string
  receptor: string
  data: string
}

/** Lo que se manda a `registrar_desti_final(p_destins)`. */
export interface DestiPayload {
  desti: string
  kg: number
  receptor?: string
  data?: string
}

/** «12,5» y «12.5» son lo mismo para quien teclea en un móvil en catalán. */
export function kgDeText(v: string): number | null {
  const t = v.trim().replace(/\s/g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Cuánto tiene destino y cuánto falta, con la misma regla que `desti_excedent()`. */
export function resumDesti(kgTotal: number, kgRedestina: number, files: FilaDesti[]): {
  kgExterns: number
  kgSenseDesti: number
  sobren: number
} {
  const kgExterns = files.reduce((acc, f) => acc + Math.max(0, kgDeText(f.kg) ?? 0), 0)
  const resta = kgTotal - kgRedestina - kgExterns
  return {
    kgExterns: arrodoneix(kgExterns),
    kgSenseDesti: arrodoneix(Math.max(0, resta)),
    sobren: arrodoneix(Math.max(0, -resta)),
  }
}

/**
 * Qué impide guardar, como clave i18n (`desti.err_*`), o `null` si se puede.
 * Una fila completamente vacía no cuenta: es la que se añade para empezar a escribir.
 */
export function errorDesti(
  kgTotal: number,
  kgRedestina: number,
  files: FilaDesti[],
  avui: string,
): string | null {
  for (const f of files.filter((x) => !filaBuida(x))) {
    if (!f.desti) return 'desti.err_desti'
    const kg = kgDeText(f.kg)
    if (kg == null || kg <= 0) return 'desti.err_kg'
    if (f.data && f.data > avui) return 'desti.err_data'
  }
  if (resumDesti(kgTotal, kgRedestina, files).sobren > 0) return 'desti.err_massa'
  return null
}

/** Las filas que se envían: sin las vacías y con los números ya convertidos. */
export function payloadDesti(files: FilaDesti[]): DestiPayload[] {
  return files.filter((f) => !filaBuida(f)).map((f) => ({
    desti: f.desti,
    kg: kgDeText(f.kg) ?? 0,
    ...(f.receptor.trim() ? { receptor: f.receptor.trim() } : {}),
    ...(f.data ? { data: f.data } : {}),
  }))
}

export function filaBuida(f: FilaDesti): boolean {
  return !f.desti && !f.kg.trim() && !f.receptor.trim() && !f.data
}

export const FILA_BUIDA: FilaDesti = { desti: '', kg: '', receptor: '', data: '' }

/**
 * ¿Hay que PEDIR el destino (banda roja), o solo ofrecerlo? Se pide cuando la oferta ya es
 * «Sense sortida», o cuando el job de vencidas lo reclamó y aún falta algún kilo.
 */
export function calDemanarDesti(estado: string, destiReclamat: boolean, kgSenseDesti: number): boolean {
  if (kgSenseDesti <= 0) return false
  return estado === 'no_colocada' || destiReclamat
}

/** Los estados en los que se puede registrar o cambiar un destino (los de la RPC). */
export const ESTATS_AMB_DESTI = ['publicada', 'parcial', 'bloqueada', 'no_colocada'] as const

function arrodoneix(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Los rechazos de `registrar_desti_final()` con texto propio (`desti.err_<code>`). Aquí y no
 * en `ofertes.ts` porque aquel importa el cliente de Supabase y entonces no se podría probar.
 */
export const CODIS_DESTI = [
  'massa_kg', 'estat_no_admet_desti', 'desti_desconegut', 'kg_invalids', 'data_futura',
] as const
