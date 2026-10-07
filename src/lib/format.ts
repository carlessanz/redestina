// Cómo se escriben en pantalla los números y las fechas: una sola vez para toda la interfaz.
//
// POR QUÉ UN MÓDULO (07-10-2026). Cada pantalla traía su `fmtKg`, su `dataCurta` o su
// «hoy en Madrid», y no todas eran iguales aunque lo pareciera: el `fmtKg` del listado de
// ofertas del equipo admitía dos decimales y el del productor ninguno. Aquí vive cada
// variante UNA vez, con su nombre y sus pruebas (`tests/format.test.ts`).
//
// ⚠️ PURO A PROPÓSITO, sin importar nada de `src/lib` que toque la red: `albarans.ts` y
//    `tancament.ts` importan el cliente de Supabase, que lanza al cargarse sin variables de
//    entorno, y un módulo que lo importe no se puede probar desde Vitest. Por eso
//    `dataCurta` y `kg` están DEFINIDAS aquí y no reexportadas de `albarans.ts`, que conserva
//    las suyas (idénticas) hasta que pase a reexportar estas.
//
// ⚠️ DOS LOCALES, Y NO ES DESCUIDO. Los números van en `ca-ES` —agrupa los miles desde
//    cuatro cifras («1.000»); `es-ES` no («1000»)— y las fechas en `es-ES`, que es como las
//    pintaba ya toda la aplicación («21/09/2026»). Cambiar uno es cambiar lo que se ve.

const MADRID = 'Europe/Madrid'

/** Lo que se pinta cuando no hay valor. */
const BUIT = '—'

/**
 * Una cantidad con separador de miles y hasta `maxDecimals` decimales, sin ceros de
 * relleno: «1.320», «12,5», «0,75». Nulo, cadena vacía o no numérico → «—».
 */
export function nombre(
  valor: number | string | null | undefined,
  maxDecimals = 2,
): string {
  if (valor === null || valor === undefined || valor === '') return BUIT
  const n = Number(valor)
  if (Number.isNaN(n)) return BUIT
  return n.toLocaleString('ca-ES', { maximumFractionDigits: maxDecimals })
}

/** Kilos, con hasta dos decimales. El mismo contrato que `kg()` de `albarans.ts`. */
export function kg(valor: number | string | null | undefined): string {
  return nombre(valor, 2)
}

/** Un precio con exactamente dos decimales, sin unidad: «0,45», «1.200,00». */
export function preu(valor: number | string): string {
  return Number(valor).toLocaleString('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** «21/09/2026». Sin hora: las tablas no necesitan más. Nulo → «—». */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return BUIT
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

/** «21/09/2026, 10:05»: de un correo o un envío importa el momento, no solo el día. */
export function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Día y hora sin año, para un hilo o una cola de esta semana: «21/9 10:05».
 * ⚠️ El mes puede salir sin cero —el `2-digit` que algunos motores ignoran, ver `diaMes`—;
 *    se conserva porque es lo que ya se veía. Corregirlo es cambiar lo que se ve.
 */
export function diaMesHora(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} `
    + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

/**
 * «23/09», en hora de Madrid. Para una píldora, donde el año sobra. Nulo → null (quien
 * llama decide si pinta algo).
 */
export function diaMes(iso: string | null | undefined): string | null {
  if (!iso) return null
  // Montada a mano: con `toLocaleDateString` algunos navegadores ignoran el `2-digit` del
  // mes en esta combinación y pintan «21/9».
  const parts = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', timeZone: MADRID })
    .formatToParts(new Date(iso))
  const v = (tipus: string) => parts.find((p) => p.type === tipus)?.value ?? ''
  return `${v('day').padStart(2, '0')}/${v('month').padStart(2, '0')}`
}

/**
 * Hoy en hora de Madrid, `AAAA-MM-DD`: lo que espera un `<input type="date">`. La del
 * servicio, no la del navegador, que puede ir en otra zona.
 */
export function avuiMadrid(ara: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MADRID }).format(ara)
}

/**
 * Hoy en la hora LOCAL del navegador, `AAAA-MM-DD`. Distinta de `avuiMadrid` a propósito:
 * es el tope de un calendario que la persona rellena con su propio «hoy».
 */
export function avuiLocal(ara: Date = new Date()): string {
  const mes = String(ara.getMonth() + 1).padStart(2, '0')
  const dia = String(ara.getDate()).padStart(2, '0')
  return `${ara.getFullYear()}-${mes}-${dia}`
}
