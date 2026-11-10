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

// ---------------------------------------------------------------------------
// P5 en el panel (11-11-2026): igual que en WhatsApp, con un lugar principal el formulario
// pide «confirma el lloc habitual o canvia’l». El lugar propuesto desde la ficha NO cuenta
// como respuesta hasta que alguien lo confirma o elige otro. Lo usan el formulario del
// productor y el de la oferta asistida del equipo (el mismo `FormulariNovaOferta`).
// ---------------------------------------------------------------------------

/** Qué enseña el campo «ubicació»: pedir confirmación, el habitual ya confirmado, o la lista. */
export type EstatLlocHabitual =
  | { tipus: 'confirmar'; principalId: string }
  | { tipus: 'confirmat'; principalId: string }
  | { tipus: 'llista' }

export function estatLlocHabitual(
  valor: unknown,
  proposat: boolean,
  ubicacions: ReadonlyArray<{ id: string; es_principal?: boolean | null }>,
  canvia: boolean,
): EstatLlocHabitual {
  const principal = ubicacions.find((u) => u.es_principal)
  if (!principal || canvia) return { tipus: 'llista' }
  if (buit(valor) || (valor === principal.id && proposat)) return { tipus: 'confirmar', principalId: principal.id }
  if (valor === principal.id) return { tipus: 'confirmat', principalId: principal.id }
  return { tipus: 'llista' }
}

/**
 * El lugar habitual sin confirmar falta, como un campo vacío, si el campo aplica (con el
 * transporte a cargo del productor no se pregunta). Solo cuando se está pidiendo confirmar:
 * lo propuesto en la lista (un único lugar sin marcar) sigue valiendo como antes.
 */
export function ubicacioPerConfirmar(estat: EstatLlocHabitual, aplicaUbicacio: boolean): boolean {
  return aplicaUbicacio && estat.tipus === 'confirmar'
}
