// Leer el fichero que sube el super_admin en el importador de entidades (06-11-2026).
//
// `.xlsx` con `read-excel-file` (todas las hojas, cargada con `import()` dinámico para que vaya
// en un chunk aparte) o `.csv` con `;` o `,` y con o sin BOM. Nunca lanza: devuelve el código
// del problema (`ie.err_<codi>`).

import { llegeixCsv, MAX_BYTES, sha256Hex, type Cella } from './importEntitats'

export interface FullaFitxer { nom: string; files: Cella[][] }

export type FitxerLlegit =
  | { ok: true; nom: string; sha256: string; fulles: FullaFitxer[] }
  | { ok: false; codi: 'massa_gran' | 'buit' | 'format' | 'xls' | 'lectura' }

/** Texto de un CSV: UTF-8 (con o sin BOM) y, si no lo es, Windows-1252 (el Excel antiguo). */
function decodifica(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export async function llegeixFitxer(fitxer: File): Promise<FitxerLlegit> {
  if (fitxer.size === 0) return { ok: false, codi: 'buit' }
  if (fitxer.size > MAX_BYTES) return { ok: false, codi: 'massa_gran' }
  const nom = fitxer.name
  const ext = nom.toLowerCase().split('.').pop() ?? ''
  if (ext === 'xls') return { ok: false, codi: 'xls' }
  if (ext !== 'xlsx' && ext !== 'csv') return { ok: false, codi: 'format' }
  try {
    const bytes = new Uint8Array(await fitxer.arrayBuffer())
    const sha256 = await sha256Hex(bytes)
    if (ext === 'csv') {
      const files = llegeixCsv(decodifica(bytes))
      return { ok: true, nom, sha256, fulles: [{ nom: nom.replace(/\.csv$/i, ''), files }] }
    }
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const fulles = await readXlsxFile(fitxer)
    return {
      ok: true, nom, sha256,
      fulles: fulles.map((f) => ({ nom: f.sheet, files: f.data.map((r) => r.map((c) => c as Cella)) })),
    }
  } catch {
    return { ok: false, codi: 'lectura' }
  }
}
