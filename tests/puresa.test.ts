// Los módulos «hoja» de `supabase/functions/_shared/` (27-10-2026, §7).
//
// El panel importa DIRECTAMENTE algunos textos del servidor —el WhatsApp de un aviso, el de
// la oferta, lo que contesta el bot— para enseñar y copiar exactamente lo mismo que se habría
// enviado (R4 del plan de gestión autónoma). Eso solo es seguro si esos módulos no arrastran
// nada que el navegador no pueda cargar: ni `Deno`, ni el cliente de Supabase, ni WhatsApp ni
// Resend. Esta prueba lo impone en los dos sentidos:
//   1. cada módulo de la lista no usa `Deno.` ni importa nada que no sea otro módulo hoja;
//   2. ningún fichero de `src/` importa de `supabase/functions/` algo fuera de la lista.
// Si un día un texto necesita algo de fuera, se le pasa por parámetro: no se amplía la lista
// con un módulo que tenga red.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SHARED = 'supabase/functions/_shared'

/** Los módulos que el navegador puede importar. Sin extensión. */
const HOJA = [
  'textAvis',
  'textRespostes',
  'textIntake',
  'textOferta',
  'textOfertaRegistrada',
  'confirmacions',
  'correu-document',
  'modalitats',
  'franja',
  'certificatDonacio',
  'cortinaHash',
  // A2 (10-11-2026): la Operativa en lectura, la misma en el resumen y en el PDF del diagnóstico.
  'operativaLlegible',
  // A3 (10-11-2026): los excedentes por producto y causa en lectura (resumen y PDF).
  'excedentsLlegible',
  // Fase A del punto 3 (17-11-2026): días y franja de un lugar, los mismos al proponerlos
  // (`crear-oferta`) y al cambiar de lugar en el panel.
  'predeterminatsOferta',
  // Fase B del punto 3 (17-11-2026): el catálogo de causas y subcausas, el mismo en la oferta,
  // en el intake de WhatsApp y en el diagnóstico.
  'causes',
  // Fase D1 del punto 3 (17-11-2026): normalizar nombres y proponer equivalencias con las
  // fuentes de precios al dar de alta un producto (los lectores de Gencat y Mercabarna, puros).
  'preusFonts',
  // Fase D2 del punto 3 (17-11-2026): cómo se escribe la fuente del valor por kilo, la misma en
  // el REC, en el certificado y en el panel del equipo.
  'fontValor',
  // Fase 6a del plan DIC 26 (25-11-2026): el alta multiproducto (`productes[]`, el máximo y las
  // claves de cada producto), la misma en `crear-oferta` y en el formulario del panel.
  'disponibilitat',
  // 25-11-2026: las plantillas de Meta de la oferta (texto que se presenta y se rellena), las
  // mismas en el panel (`ofertaTemplate.ts`), en la consola (`whatsapp.ts`) y en el script.
  'plantillasMeta',
]

/** El código sin comentarios: «sin red ni Deno.» en un comentario no es un uso. */
function senseComentaris(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Las rutas de `import … from` y `export … from` de un fuente. */
function importacions(src: string): { ruta: string; nomesTipus: boolean }[] {
  const out: { ruta: string; nomesTipus: boolean }[] = []
  const re = /^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm
  for (const m of senseComentaris(src).matchAll(re)) {
    out.push({ ruta: m[3], nomesTipus: Boolean(m[2]) })
  }
  // `import "x"` sin nada que importar (efectos secundarios).
  for (const m of senseComentaris(src).matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    out.push({ ruta: m[1], nomesTipus: false })
  }
  return out
}

describe('los módulos hoja de _shared no tienen red ni Deno', () => {
  for (const nom of HOJA) {
    it(nom, () => {
      const src = readFileSync(join(SHARED, `${nom}.ts`), 'utf8')
      expect(senseComentaris(src)).not.toMatch(/\bDeno\./)
      for (const { ruta, nomesTipus } of importacions(src)) {
        if (nomesTipus) continue
        const m = ruta.match(/^\.\/([\w-]+)\.ts$/)
        expect(m, `${nom}.ts importa «${ruta}», que no es un módulo hoja`).not.toBeNull()
        expect(HOJA, `${nom}.ts importa «${ruta}», que no está en la lista de hojas`).toContain(m![1])
      }
    })
  }
})

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? ficheros(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}

describe('src/ solo importa módulos hoja del servidor', () => {
  it('ningún import de supabase/functions fuera de la lista', () => {
    const fuera: string[] = []
    for (const f of ficheros('src')) {
      for (const { ruta } of importacions(readFileSync(f, 'utf8'))) {
        if (!ruta.includes('supabase/functions/')) continue
        const m = ruta.match(/supabase\/functions\/_shared\/([\w-]+)\.ts$/)
        if (!m || !HOJA.includes(m[1])) fuera.push(`${relative('.', f)} → ${ruta}`)
      }
    }
    expect(fuera).toEqual([])
  })
})
