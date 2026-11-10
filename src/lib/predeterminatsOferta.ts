// La precarga de una oferta nueva desde la Operativa (Plan 2, A4, `20270521100000`; fila 2.5
// «reutilitzar en crear ofertes»). PURO, con pruebas en `tests/predeterminatsOferta.test.ts`.
//
// El servidor calcula QUÉ proponer (`GET /crear-oferta/campos` → `predeterminats`, en
// `_shared/predeterminatsOferta.ts`): el lugar principal, su primera franja y el formato que
// sale del envase habitual. Aquí se decide CÓMO se aplica en el formulario:
//
// - Solo a los HUECOS: nunca pisa lo que ya hay (un borrador recuperado manda; en ese caso ni
//   se llama).
// - Lo propuesto se MARCA («proposat des de la fitxa») hasta que alguien lo toca: sin la marca
//   sería indistinguible de una respuesta dada.
// - Al publicar, lo propuesto que SIGUE SIN TOCAR y cuyo campo NO APLICA (p. ej. el lugar
//   cuando el productor lleva él el transporte) se quita: no se manda algo que no se ha dicho.

import type { PredeterminatsOferta } from './ofertes'

type Datos = Record<string, unknown>

const buit = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '')
  || (Array.isArray(v) && v.length === 0)

/** Rellena los huecos con lo propuesto y dice qué claves se han propuesto. */
export function aplicaPredeterminats(
  datos: Datos, pred: PredeterminatsOferta | null | undefined,
): { datos: Datos; proposats: string[] } {
  if (!pred) return { datos, proposats: [] }
  const out: Datos = { ...datos }
  const proposats: string[] = []
  const posa = (clau: string, v: unknown) => {
    if (v == null || !buit(out[clau])) return
    out[clau] = v
    proposats.push(clau)
  }
  posa('ubicacio', pred.ubicacio)
  posa('horari', pred.horari ? { inici: pred.horari.inici, fi: pred.horari.fi } : null)
  posa('format_entrega', pred.format_entrega)
  return { datos: out, proposats }
}

/**
 * Antes de publicar: quita lo propuesto y no tocado cuyo campo no aplica con las respuestas
 * de ahora. Lo que el productor sí ha tocado (ya no está en `proposats`) se respeta.
 */
export function treuProposatsQueNoApliquen(
  datos: Datos, proposats: ReadonlySet<string>, aplica: (clau: string) => boolean,
): Datos {
  const out: Datos = { ...datos }
  for (const clau of proposats) if (!aplica(clau)) delete out[clau]
  return out
}
