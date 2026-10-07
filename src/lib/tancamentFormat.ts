// La parte PURA del cliente del cierre anual: formato de importes, estilos de estado y el
// CSV del 182. Aparte de `tancament.ts` porque aquel importa el cliente de Supabase, que
// lanza al cargarse sin variables de entorno, y un fichero que lo importe no se puede
// probar desde Vitest (mismo patrón que `campsFundacio`/`parametresFundacio`).
// `tancament.ts` lo reexporta: los imports de las pantallas no cambian.

import type { BloqueigCierre } from '../types'

/** Fila de `datos_182()`. Es el retorno de una función, no una tabla: vive aquí. */
export interface Fila182 {
  nif: string | null
  razon_social: string | null
  codigo_postal: string | null
  provincia: string | null
  importe: number | null
  kg: number | null
  en_especie: boolean
  certificado_numero: string | null
  fecha: string | null
  modo: string
}

// --- Presentación ---------------------------------------------------------

/** Importe en euros. Siempre con los dos decimales: es una cifra fiscal. */
export function euros(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const n = Number(valor)
  if (Number.isNaN(n)) return '—'
  return n.toLocaleString('es-ES', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

/** Coste por kilo: 4 decimales, porque 0,32 €/kg y 0,3175 €/kg no son lo mismo. */
export function eurKg(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const n = Number(valor)
  if (Number.isNaN(n)) return '—'
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/kg`
}

/** Estado del donante → clase de token. El error es rojo; el coral no significa fallo. */
export function estilEstatDonant(estat: string): string {
  switch (estat) {
    case 'declarat':
    case 'enviat':
    case 'certificat_emes':
    case 'coincident':
      return 'bg-exito-fondo text-exito'
    // Ámbar y no rojo desde el 21-09-2026: una factura que no cuadra es algo que hay que
    // hablar con el donante, pero ya no impide el certificado. Pintarlo de rojo diría que
    // el circuito está parado cuando no lo está.
    case 'discrepancia':
    case 'resum_enviat':
    case 'factura_pendent':
    case 'factura_rebuda':
      return 'bg-aviso-fondo text-aviso'
    // Un certificado a demanda al que el anual dejó atrás: ni pendiente ni un problema.
    case 'substituit':
      return 'bg-muted text-muted-foreground'
    default:
      return 'bg-secondary text-secondary-foreground'
  }
}

/** Estado del cierre → clase de token. */
export function estilEstatTancament(estat: string): string {
  switch (estat) {
    case 'declarat': return 'bg-exito-fondo text-exito'
    case 'tancat': return 'bg-secondary text-secondary-foreground'
    case 'provisional': return 'bg-aviso-fondo text-aviso'
    default: return 'bg-muted text-muted-foreground'
  }
}

/** ¿Hay algún bloqueo que impida el certificado? Los demás solo avisan. */
export function bloqueja(bloqueos: BloqueigCierre[] | null | undefined): boolean {
  return (bloqueos ?? []).some((b) => b.bloqueja)
}

/** Fecha del ISO, sin hora. */
export function dataTancament(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

/**
 * El ejercicio que se lee en un número de serie (`P-RES-2026-0001` → 2026).
 *
 * Hace falta porque la política de `cierres_ejercicio` es **solo del equipo**
 * (20261109100000): el donante ve su fila de `cierres_donante` pero no la cabecera, así
 * que en su panel el año no puede salir de un `join`. Sale de su propio número, que es un
 * dato suyo, o de `documentos.ejercicio`, que también lo es.
 */
export function exerciciDeNumero(numero: string | null | undefined): number | null {
  if (!numero) return null
  const m = /(?:^|-)((?:19|20)\d{2})-/.exec(numero)
  return m ? Number(m[1]) : null
}

// --- Exportación del 182 --------------------------------------------------

const COLUMNES_182: (keyof Fila182)[] = [
  'nif', 'razon_social', 'codigo_postal', 'provincia', 'importe', 'kg',
  'en_especie', 'certificado_numero', 'fecha', 'modo',
]

/**
 * Una celda de CSV con `;`: comillas dobladas y entrecomillado si hace falta.
 *
 * 🔴 Y un TEXTO que empiece por `=`, `+`, `-`, `@` (o tabulador/retorno) se precede de un
 * apóstrofo. Es la inyección de fórmulas de CSV: este fichero lo abre una gestoría en
 * Excel, y una razón social escrita como `=HYPERLINK(…)` desde el registro público se
 * ejecutaría como fórmula. Solo a textos: un importe negativo es un número y no se toca.
 */
function cella(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  // Los números van con COMA decimal: el destino es un Excel en español, y un punto
  // decimal ahí se lee como texto (o como millares, que es peor porque no avisa).
  let text = typeof valor === 'number'
    ? valor.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
    : String(valor)
  if (typeof valor !== 'number' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * El CSV del 182, con `;` y **con BOM**.
 *
 * Las dos cosas son por Excel en español y ninguna es opcional: sin `;` mete la fila
 * entera en la columna A, y sin el BOM `UTF-8` lee los acentos como mojibake —«Fundació»
 * sale «FundaciÃ³»— en un fichero que va a una gestoría. `\r\n` por lo mismo.
 */
export function csv182(files: Fila182[], capceleres: Record<string, string>): string {
  const linies = [
    COLUMNES_182.map((c) => cella(capceleres[c] ?? c)).join(';'),
    ...files.map((f) => COLUMNES_182.map((c) => cella(f[c])).join(';')),
  ]
  return `\uFEFF${linies.join('\r\n')}\r\n`
}

