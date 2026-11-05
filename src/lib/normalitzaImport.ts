// Normalizadores GENÉRICOS de una importación de fichas desde una hoja de cálculo.
//
// Los comparten dos importadores que no se pueden juntar: el del ARA 2026 (`scripts/
// ara2026/nucli.ts`, Deno, por línea de comandos) y el del panel (`src/lib/importEntitats.ts`,
// el navegador del super_admin). Vivían en `nucli.ts`; se movieron aquí (06-11-2026) para que
// los dos lean las cabeceras, los teléfonos y los correos exactamente igual, sin dos copias.
//
// 🔴 HOJA PURA Y SIN IMPORTS: la importa Deno desde `scripts/` (con extensión `.ts`) y Vite
//    desde `src/`. Un `import` aquí obligaría a que el otro mundo lo resolviera también; si un
//    día hace falta algo de fuera, se pasa por parámetro.

/** Sin acentos (NFD sin las marcas combinantes). */
export const senseAccents = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Cabecera comparable: «Tipo  Empresa» → «tipo empresa», «Data\nAlta» → «data alta». */
export function normalitzaCapcalera(h: string): string {
  return senseAccents(h).toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Nombre comparable para casar: sin acentos, mayúsculas y sin signos. */
export function normalitzaNom(s: string): string {
  return senseAccents(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/** Similitud de trigramas como `pg_trgm.similarity()` (palabras con dos espacios delante y uno detrás). */
export function similitud(a: string, b: string): number {
  const tri = (s: string) => {
    const set = new Set<string>()
    for (const w of normalitzaNom(s).toLowerCase().split(' ').filter(Boolean)) {
      const p = `  ${w} `
      for (let i = 0; i + 3 <= p.length; i++) set.add(p.slice(i, i + 3))
    }
    return set
  }
  const A = tri(a), B = tri(b)
  if (!A.size || !B.size) return 0
  let comuns = 0
  for (const x of A) if (B.has(x)) comuns++
  return comuns / (A.size + B.size - comuns)
}

/**
 * Los teléfonos de una celda de texto libre, en E.164 sin «+». Es el `extraerTelefonos()` de
 * `scripts/import-ara.ts` (que no se puede importar: ejecuta la carga de julio al cargarse):
 * se quitan paréntesis y extensiones, y se buscan secuencias de 9 cifras con separadores, sin
 * fundir dos números seguidos en uno.
 */
export function extraerTelefonos(raw: string | null | undefined): string[] {
  if (!raw) return []
  let s = raw.replace(/\([^)]*\)/g, ' ')
  s = s.replace(/ext\.?\s*\d+/gi, ' ')
  const out: string[] = []
  for (const m of s.matchAll(/(?:\d[\s.-]*){9,}/g)) {
    let d = m[0].replace(/\D/g, '')
    while (d.length >= 9) {
      if (d.startsWith('34') && d.length >= 11) { out.push(d.slice(0, 11)); d = d.slice(11) }
      else if (/^[6789]/.test(d)) { out.push('34' + d.slice(0, 9)); d = d.slice(9) }
      else d = d.slice(1)
    }
  }
  return [...new Set(out)]
}

const RE_CORREU = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

/** Los correos de una celda de texto libre («contacte: x@y.org / z@w.cat»), sin repetir. */
export function extraerCorreos(raw: string | null | undefined): string[] {
  if (!raw) return []
  return [...new Set((raw.match(RE_CORREU) ?? []).map((c) => c.trim()))]
}

/** «Prat de Llobregat, el» y «El Prat de Llobregat» dan la misma clave. */
export function claveMunicipi(s: string): string {
  const n = normalitzaNom(s.replace(/,\s*(l'|el|la|els|les)\s*$/i, ''))
  return n.replace(/^(EL|LA|ELS|LES|L) /, '')
}

/** CSV RFC 4180 (comillas dobles, `""` escapado, celdas de varias líneas). Quita el BOM. */
export function parseCsv(texto: string, sep = ','): string[][] {
  const t = texto.replace(/^﻿/, '')
  const files: string[][] = []
  let fila: string[] = []
  let cel = ''
  let cometes = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (cometes) {
      if (c === '"') {
        if (t[i + 1] === '"') { cel += '"'; i++ } else cometes = false
      } else cel += c
    } else if (c === '"' && cel === '') cometes = true
    else if (c === sep) { fila.push(cel); cel = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      fila.push(cel); files.push(fila); fila = []; cel = ''
    } else cel += c
  }
  if (cel !== '' || fila.length) { fila.push(cel); files.push(fila) }
  return files
}
