// Las definiciones de las plantillas de oferta que se presentan a Meta (`_shared/plantillasMeta.ts`)
// y la vuelta: cómo llega al webhook la pulsación de un botón de plantilla.
//
// POR QUÉ: una plantilla rechazada por Meta tarda hasta 24 h en saberse y cada intento queda en
// el historial de la WABA. Lo que se puede comprobar en casa —longitudes, variables seguidas,
// ejemplos, la URL del botón— se comprueba aquí, antes de presentarla. Y el día que se aprueben,
// la respuesta de la entidad llega con OTRA forma (`type: "button"`) que la de los botones de
// dentro de la ventana; sin normalizarla, el «M'interessa» caería al intake.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DOMINI_PLANTILLES, OFERTA_DISPONIBILITAT, OFERTA_EXCEDENT, PLANTILLES_META, cosAmbValors,
  definicioPerMeta, idDeBotoPlantilla, netejaParametre, nombreVariables, problemesDefinicio,
  textConsolaPlantilla, variablesDe, type DefinicioPlantilla,
} from '../supabase/functions/_shared/plantillasMeta.ts'
import { leerRespuesta } from '../supabase/functions/_shared/intake.ts'
import { PLANTILLA_DISPONIBILITAT, PLANTILLA_OFERTA } from '../src/lib/plantillas'
import { construirComponentsDisponibilitat, construirComponentsOferta } from '../src/lib/ofertaTemplate'

const DEFS = Object.values(PLANTILLES_META)

describe('las definiciones cumplen las reglas de Meta', () => {
  it.each(DEFS.map((d) => [d.name, d] as const))('%s no tiene problemas', (_n, def) => {
    expect(problemesDefinicio(def)).toEqual([])
  })

  it('las dos, en català y propuestas como UTILITY', () => {
    for (const d of DEFS) {
      expect(d.language).toBe('ca')
      expect(d.category).toBe('UTILITY')
    }
  })

  it('los nombres coinciden con los de `src/lib/plantillas.ts` (que no puede importar nada)', () => {
    expect(PLANTILLA_OFERTA).toEqual({ name: OFERTA_EXCEDENT.name, language: OFERTA_EXCEDENT.language })
    expect(PLANTILLA_DISPONIBILITAT).toEqual({ name: OFERTA_DISPONIBILITAT.name, language: OFERTA_DISPONIBILITAT.language })
  })

  it('el cuerpo de cada una está, idéntico, en plantillas-meta.md (lo que se lee = lo que se presenta)', () => {
    const md = readFileSync('supabase/functions/_shared/plantillas-meta.md', 'utf8')
    for (const d of DEFS) {
      expect(md).toContain(d.cos)
      expect(md).toContain(d.capcalera)
      expect(md).toContain(d.peu)
    }
  })

  it('oferta_excedent: sin productor ni responsable; con modalidad, precio y los dos botones', () => {
    expect(OFERTA_EXCEDENT.cos).not.toMatch(/Productor|Responsable/)
    expect(OFERTA_EXCEDENT.cos).toContain('Modalitat: {{6}}')
    expect(OFERTA_EXCEDENT.cos).toContain('Preu mínim: {{7}}')
    expect(OFERTA_EXCEDENT.botons.map((b) => b.type === 'QUICK_REPLY' && [b.text, b.payload]))
      .toEqual([["M'interessa", 'accept:si'], ['Ara no', 'accept:no']])
  })

  it('oferta_disponibilitat: botón al Mercat del dominio de producción', () => {
    const b = OFERTA_DISPONIBILITAT.botons[0]
    expect(b.type).toBe('URL')
    if (b.type === 'URL') expect(b.url).toBe(`${DOMINI_PLANTILLES}/receptor/mercat?disponibilitat={{1}}`)
  })

  it('el pie dice cómo darse de baja con la palabra que entiende el webhook', () => {
    for (const d of DEFS) expect(d.peu).toContain('BAIXA')
  })
})

describe('problemesDefinicio detecta lo que Meta rechazaría', () => {
  const base: DefinicioPlantilla = OFERTA_EXCEDENT
  it.each([
    ['cabecera con emoji', { ...base, capcalera: '📢 Nova oferta' }, /emojis/],
    ['cabecera larga', { ...base, capcalera: 'x'.repeat(61) }, /60/],
    ['variable al final', { ...base, cos: `${base.cos} {{8}}`, variables: [...base.variables, 'x'], maxims: [...base.maxims, 1], exemples: [...base.exemples, 'x'] }, /acabar/],
    ['variables desordenadas', { ...base, cos: base.cos.replace('{{2}}', '{{9}}') }, /seguidas/],
    ['ejemplos que no cuadran', { ...base, exemples: base.exemples.slice(1) }, /exemples/],
    ['tope que pasa de 1024', { ...base, maxims: base.maxims.map(() => 200) }, /1024/],
    ['botón largo', { ...base, botons: [{ type: 'QUICK_REPLY' as const, text: 'x'.repeat(26), payload: 'a:b' }] }, /25/],
  ])('%s', (_n, def, re) => {
    expect(problemesDefinicio(def).join(' | ')).toMatch(re)
  })
})

describe('definicioPerMeta: el cuerpo de POST /message_templates', () => {
  it('oferta_excedent: cabecera, cuerpo con ejemplo, pie y respuestas rápidas sin payload', () => {
    const j = definicioPerMeta(OFERTA_EXCEDENT) as { name: string; language: string; category: string; components: Record<string, unknown>[] }
    expect([j.name, j.language, j.category]).toEqual(['oferta_excedent', 'ca', 'UTILITY'])
    expect(j.components.map((c) => c.type)).toEqual(['HEADER', 'BODY', 'FOOTER', 'BUTTONS'])
    const body = j.components[1] as { text: string; example: { body_text: string[][] } }
    expect(body.example.body_text[0]).toHaveLength(nombreVariables(OFERTA_EXCEDENT))
    expect(j.components[3]).toEqual({ type: 'BUTTONS', buttons: [
      { type: 'QUICK_REPLY', text: "M'interessa" }, { type: 'QUICK_REPLY', text: 'Ara no' },
    ] })
  })

  it('oferta_disponibilitat: el botón de URL lleva la URL de ejemplo completa', () => {
    const j = definicioPerMeta(OFERTA_DISPONIBILITAT) as { components: { type: string; buttons?: { url: string; example: string[] }[] }[] }
    const b = j.components.find((c) => c.type === 'BUTTONS')!.buttons![0]
    expect(b.url.endsWith('{{1}}')).toBe(true)
    expect(b.example).toEqual([`${DOMINI_PLANTILLES}/receptor/mercat?disponibilitat=6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b`])
  })

  it('es JSON serializable tal cual', () => {
    for (const d of DEFS) expect(JSON.parse(JSON.stringify(definicioPerMeta(d)))).toEqual(definicioPerMeta(d))
  })
})

describe('netejaParametre', () => {
  it('quita saltos de línea, tabuladores y espacios repetidos', () => {
    expect(netejaParametre('a\nb\r\nc\td      e ')).toBe('a b c d e')
  })
  it('recorta con «…» sin pasarse del tope', () => {
    const s = netejaParametre('x'.repeat(50), 10)
    expect(s).toHaveLength(10)
    expect(s.endsWith('…')).toBe(true)
  })
  it('nulo o vacío → cadena vacía (el valor de reserva lo pone quien llama)', () => {
    expect(netejaParametre(null)).toBe('')
    expect(netejaParametre('   ')).toBe('')
  })
})

describe('el texto de la consola (Mensajería) de una plantilla enviada', () => {
  it('oferta_excedent: con los valores del envío y los botones', () => {
    const c = construirComponentsOferta({
      producto: 'Ceba', variedad: null, municipi: 'Reus', kg: 50, caixes: null, disponible: '2026-08-01',
      horari: null, modalitats: ['donacio'],
    })
    const t = textConsolaPlantilla('oferta_excedent', c)!
    expect(t).toContain("*Nova oferta d'excedent*")
    expect(t).toContain('🌿 Producte: Ceba')
    expect(t).toContain('📅 Disponible fins: 01/08/2026')
    expect(t).toContain("[M'interessa] [Ara no]")
    expect(variablesDe(t)).toEqual([])
  })

  it('oferta_disponibilitat: con la URL completa del botón', () => {
    const c = construirComponentsDisponibilitat({ disponibilitatId: 'abc', municipi: 'Reus', ofertes: [{ producto: 'Ceba', kg_total: 5 }] })
    expect(textConsolaPlantilla('oferta_disponibilitat', c))
      .toContain(`[Obre l'oferta: ${DOMINI_PLANTILLES}/receptor/mercat?disponibilitat=abc]`)
  })

  it('sin components (la simulación sin datos): el texto con los {{n}}; otra plantilla: null', () => {
    expect(textConsolaPlantilla('oferta_excedent')).toContain('{{1}}')
    expect(textConsolaPlantilla('hello_world')).toBeNull()
  })

  it('cosAmbValors deja el hueco si falta un valor', () => {
    expect(cosAmbValors(OFERTA_DISPONIBILITAT, ['a'])).toContain('{{2}}')
  })
})

describe('la pulsación de un botón de PLANTILLA llega al diálogo como `accept:si|no`', () => {
  it('`type: "button"` con payload → el payload es el id (como un `button_reply`)', () => {
    expect(leerRespuesta({ type: 'button', button: { payload: 'accept:si', text: "M'interessa" } }))
      .toEqual({ texto: "M'interessa", id: 'accept:si' })
    expect(leerRespuesta({ type: 'button', button: { payload: 'accept:no', text: 'Ara no' } }))
      .toEqual({ texto: 'Ara no', id: 'accept:no' })
  })

  it('es lo mismo que pulsar el botón del mensaje de dentro de la ventana', () => {
    const plantilla = leerRespuesta({ type: 'button', button: { payload: 'accept:si', text: "M'interessa" } })
    const interactiu = leerRespuesta({ type: 'interactive', interactive: { button_reply: { id: 'accept:si', title: "M'interessa" } } })
    expect(plantilla).toEqual(interactiu)
  })

  it('sin payload propio (Meta devuelve el texto), se reconoce por el texto del botón', () => {
    expect(leerRespuesta({ type: 'button', button: { payload: "M'interessa", text: "M'interessa" } }).id).toBe('accept:si')
    expect(leerRespuesta({ type: 'button', button: { text: 'Ara no' } }).id).toBe('accept:no')
  })

  it('un botón que no es nuestro no inventa un id', () => {
    expect(leerRespuesta({ type: 'button', button: { payload: 'Una altra cosa', text: 'Una altra cosa' } }))
      .toEqual({ texto: 'Una altra cosa', id: null })
    expect(idDeBotoPlantilla(null, null)).toBeNull()
  })

  it('el texto y las pulsaciones interactivas siguen como antes', () => {
    expect(leerRespuesta({ type: 'text', text: { body: 'Sí' } })).toEqual({ texto: 'Sí', id: null })
    expect(leerRespuesta({ type: 'interactive', interactive: { list_reply: { id: 'familia:2', title: 'Fruita' } } }))
      .toEqual({ texto: 'Fruita', id: 'familia:2' })
  })
})
