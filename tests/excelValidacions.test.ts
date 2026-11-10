// Desplegables de un .xlsx (Plan 2 B2): el XML de `<dataValidations>` y dónde se inserta en la hoja.
// El orden de los hijos de `<worksheet>` lo fija el esquema OOXML; si se rompe, Excel «repara» el
// fichero y se come los desplegables. La prueba con el fichero real está en `importEntitats.test.ts`.

import { describe, expect, it } from 'vitest'
import {
  featureValidacions, insereixValidacions, lletraColumna, nomFullaFormula, rangLlista, xmlValidacions,
} from '../src/lib/excelValidacions'

const FULLA = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="x"><sheetViews/><cols/>'
  + '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&lt;pageMargins x&gt;</t></is></c></row></sheetData>'

describe('excelValidacions', () => {
  it('letras de columna', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(lletraColumna))
      .toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])
    expect(() => lletraColumna(-1)).toThrow()
  })

  it('el rango de una lista, con la hoja entre comillas cuando hace falta', () => {
    expect(rangLlista('Llistes', 6, 947)).toBe('Llistes!$G$2:$G$948')
    expect(rangLlista('Llistes', 0, 1)).toBe('Llistes!$A$2:$A$2')
    expect(rangLlista('Llistes', 0, 0)).toBeNull()
    expect(nomFullaFormula("Les d'en Pep")).toBe("'Les d''en Pep'")
    expect(rangLlista('Dades 2026', 1, 3)).toBe("'Dades 2026'!$B$2:$B$4")
  })

  it('una validación por lista; las de varios valores no avisan, las de uno avisan sin bloquear', () => {
    const xml = xmlValidacions([
      { columna: 0, rang: 'Llistes!$A$2:$A$4', multiple: false },
      { columna: 6, rang: 'Llistes!$D$2:$D$9', multiple: true },
    ], { primeraFila: 2, ultimaFila: 302, avisTitol: 'Valor fora de la llista i molt més llarg que 32', avis: 'A & <b> "c"' })
    expect(xml.startsWith('<dataValidations count="2">')).toBe(true)
    const [a, b] = [...xml.matchAll(/<dataValidation [^>]*>/g)].map((m) => m[0])
    expect(a).toContain('sqref="A2:A302"')
    expect(a).toContain('showErrorMessage="1"')
    expect(a).toContain('errorStyle="warning"')
    expect(a).toContain('errorTitle="Valor fora de la llista i molt m"') // 32 caracteres
    expect(a).toContain('error="A &amp; &lt;b&gt; &quot;c&quot;"')
    expect(b).toContain('sqref="G2:G302"')
    expect(b).toContain('showErrorMessage="0"')
    expect(b).not.toContain('error=')
    expect(xml).not.toContain('showDropDown') // =1 escondería la flecha
    expect(xml).toContain('<formula1>Llistes!$D$2:$D$9</formula1>')
    expect(xmlValidacions([], { primeraFila: 2, ultimaFila: 3 })).toBe('')
    expect(() => xmlValidacions([{ columna: 0, rang: 'x', multiple: false }], { primeraFila: 5, ultimaFila: 4 })).toThrow()
  })

  const V = '<dataValidations count="1"><dataValidation/></dataValidations>'

  it('se inserta tras </sheetData> y antes de lo que el esquema pone detrás', () => {
    const conMargins = `${FULLA}<mergeCells count="1"/><pageMargins left="0.7"/><drawing r:id="rId1"/></worksheet>`
    const r = insereixValidacions(conMargins, V)
    expect(r).toContain(`<mergeCells count="1"/>${V}<pageMargins left="0.7"/>`)
    // El texto de una celda que «parece» una etiqueta no cuenta: está escapado y dentro de sheetData.
    expect(r.indexOf(V)).toBeGreaterThan(r.indexOf('</sheetData>'))
  })

  it('sin nada detrás, va justo antes de </worksheet>; con drawing, delante de drawing', () => {
    expect(insereixValidacions(`${FULLA}</worksheet>`, V)).toBe(`${FULLA}${V}</worksheet>`)
    expect(insereixValidacions(`${FULLA}<drawing r:id="rId1"/></worksheet>`, V)).toBe(`${FULLA}${V}<drawing r:id="rId1"/></worksheet>`)
    const buida = '<worksheet><sheetData/><pageMargins/></worksheet>'
    expect(insereixValidacions(buida, V)).toBe(`<worksheet><sheetData/>${V}<pageMargins/></worksheet>`)
  })

  it('no mezcla con unas validaciones que ya estén, ni inventa una hoja', () => {
    expect(() => insereixValidacions(`${FULLA}${V}</worksheet>`, V)).toThrow('validacions_ja_existeixen')
    expect(() => insereixValidacions('<worksheet></worksheet>', V)).toThrow('sense_sheetData')
    expect(insereixValidacions(`${FULLA}</worksheet>`, '')).toBe(`${FULLA}</worksheet>`)
  })

  it('la feature solo toca la hoja indicada', () => {
    const f = featureValidacions([{ columna: 0, rang: 'Llistes!$A$2:$A$3', multiple: false }], { primeraFila: 2, ultimaFila: 10 })
    const tr = f.files!.transform!['xl/worksheets/sheet{id}.xml']!.transform!
    const xml = `${FULLA}</worksheet>`
    const opcions = {} as Parameters<typeof tr>[1]
    expect(tr(xml, opcions, { sheetIndex: 0, sheetId: '1' })).toContain('<dataValidations count="1">')
    expect(tr(xml, opcions, { sheetIndex: 1, sheetId: '2' })).toBe(xml)
  })
})
