// ¿El clic nació en un control propio de la fila? (10-11-2026, `FilaClicable`)
//
// Puro y aparte para poder probarlo sin React. Una fila clicable abre su detalle, pero un
// botón, un enlace, una casilla o un menú de dentro de ella son suyos: si el clic sale de uno
// de ellos (o de algo marcado con `data-no-fila`), la fila no hace nada. Se busca solo HASTA
// la fila, no más arriba: la propia tabla podría vivir dentro de un enlace o un diálogo.

export const SELECTOR_CONTROLS = [
  'a', 'button', 'input', 'select', 'textarea', 'label', 'summary',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="switch"]',
  '[role="menuitem"]', '[role="combobox"]', '[role="option"]', '[role="tab"]',
  '[contenteditable="true"]', '[data-no-fila]',
].join(',')

export function clicDinsControl(origen: Element | null, fila: Element): boolean {
  // 🔴 Los eventos de React suben por el árbol de COMPONENTES, no por el del DOM: un clic
  // dentro de un diálogo o un menú abierto desde la fila (pintado en un portal, fuera de la
  // tabla) llega también al `onClick` de la fila. Lo que no está dentro de la fila en el DOM
  // no es un clic sobre la fila.
  if (!origen || !fila.contains(origen)) return true
  let el: Element | null = origen
  while (el && el !== fila) {
    if (el.matches(SELECTOR_CONTROLS)) return true
    el = el.parentElement
  }
  return false
}
