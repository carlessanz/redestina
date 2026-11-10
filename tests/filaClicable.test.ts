// `clicDinsControl` con nodos de mentira: el repo no lleva entorno DOM en Vitest y la función
// solo usa `matches`, `parentElement` y `contains`.
import { describe, expect, it } from 'vitest'
import { clicDinsControl } from '../src/lib/filaClicable'

type Nodo = { tag: string; attrs: Record<string, string>; parentElement: Nodo | null }

function nodo(tag: string, pare: Nodo | null, attrs: Record<string, string> = {}): Nodo {
  return { tag, attrs, parentElement: pare }
}

// Un Element de mentira por nodo (la identidad importa: la función compara `el !== fila`).
// `matches` entiende lo que usa el selector: etiquetas, `[role="x"]` y `[atribut]`.
const cache = new Map<Nodo, Element>()
function el(n: Nodo): Element {
  const ja = cache.get(n)
  if (ja) return ja
  const fals = {
    __n: n,
    get parentElement() { return n.parentElement ? el(n.parentElement) : null },
    matches: (selector: string) => selector.split(',').some((s) => {
      const attr = s.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/)
      if (attr) return attr[2] === undefined ? attr[1] in n.attrs : n.attrs[attr[1]] === attr[2]
      return s === n.tag
    }),
    contains: (altre: Element | null) => {
      let actual = (altre as unknown as { __n?: Nodo } | null)?.__n ?? null
      while (actual) { if (actual === n) return true; actual = actual.parentElement }
      return false
    },
  }
  cache.set(n, fals as unknown as Element)
  return fals as unknown as Element
}

describe('clicDinsControl', () => {
  const tr = nodo('tr', null)
  const td = nodo('td', tr)

  it('un clic en una celda de texto abre la fila', () => {
    expect(clicDinsControl(el(nodo('span', td)), el(tr))).toBe(false)
    expect(clicDinsControl(el(td), el(tr))).toBe(false)
  })

  it('un botón, un enlace o un icono dentro de un botón son suyos', () => {
    const boto = nodo('button', td)
    expect(clicDinsControl(el(nodo('path', nodo('svg', boto))), el(tr))).toBe(true)
    expect(clicDinsControl(el(nodo('a', td)), el(tr))).toBe(true)
    expect(clicDinsControl(el(nodo('input', td)), el(tr))).toBe(true)
  })

  it('roles ARIA y data-no-fila también', () => {
    expect(clicDinsControl(el(nodo('div', td, { role: 'checkbox' })), el(tr))).toBe(true)
    expect(clicDinsControl(el(nodo('span', nodo('div', td, { 'data-no-fila': '' }))), el(tr))).toBe(true)
  })

  it('lo que está fuera de la fila (un portal) no abre nada', () => {
    expect(clicDinsControl(el(nodo('div', null)), el(tr))).toBe(true)
    expect(clicDinsControl(null, el(tr))).toBe(true)
  })

  it('no mira más arriba de la fila', () => {
    const a = nodo('a', null)
    const fila = nodo('tr', nodo('table', a))
    expect(clicDinsControl(el(nodo('td', fila)), el(fila))).toBe(false)
  })
})
