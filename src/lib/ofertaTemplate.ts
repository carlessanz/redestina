// Los `components` de envío (Cloud API de Meta) de las dos plantillas de oferta:
//   · `oferta_excedent` — una oferta, con los botones «M'interessa» / «Ara no»;
//   · `oferta_disponibilitat` — una disponibilidad multiproducto, con el botón al Mercat.
//
// PURO, con test (`tests/ofertaTemplate.test.ts`). El texto de las plantillas, el número y el
// tope de cada variable viven en `supabase/functions/_shared/plantillasMeta.ts` (módulo hoja,
// importado y no copiado, §7): lo que se rellena aquí es exactamente lo que se presenta a Meta.
//
// Meta no tiene nombres de variable, tiene POSICIONES: intercambiar dos parámetros no da error,
// el mensaje sale con el municipio en el hueco de la cantidad. Y rechaza el envío entero si un
// parámetro va vacío, si el número no cuadra (132000) o si lleva saltos de línea (132018). Por
// eso cada variable tiene su valor de reserva y pasa por `netejaParametre()`.
//
// Las dos plantillas están tras un flag a `false` (`plantillas.ts`): hoy no se envía ninguna.

import {
  netejaParametre, OFERTA_DISPONIBILITAT, OFERTA_EXCEDENT, type BotoPlantilla,
} from '../../supabase/functions/_shared/plantillasMeta.ts'
import { ambPreu, etiquetaModalitats, modalitatsDe, type Modalitat } from '../../supabase/functions/_shared/modalitats.ts'
import { textCaixes, textDies } from '../../supabase/functions/_shared/textOferta.ts'

export interface DatosOfertaPlantilla {
  producto: string | null
  variedad: string | null
  /** Municipio del lugar de recogida (o el de la ficha). Sin el nombre del productor (D3). */
  municipi: string | null
  /** Comarca de la oferta (`excedentes.comarca`): va entre paréntesis tras el municipio. */
  comarca?: string | null
  kg: number | null
  caixes: number | null
  /** `format_entrega`: con «palet», las unidades se cuentan en palets. */
  format?: string | null
  /** `disponible_hasta` (ISO o texto). */
  disponible: string | null
  /** `dies_recollida` (1 = dl … 7 = dg). */
  dies?: readonly number[] | null
  /** La franja (`horari_recollida`). */
  horari: string | null
  /** `modalitats` (o la `modalitat` única de siempre). */
  modalitats?: unknown
  /** `preu_minim` (€/kg): solo cuenta si la oferta incluye venta. */
  preuMinim?: number | null
}

/** Una oferta de un grupo, con lo que pide la plantilla multiproducto. */
export interface OfertaDisponibilitatPlantilla {
  producto: string | null
  variedad?: string | null
  kg_total: number | null
  modalitat?: string | null
  modalitats?: readonly string[] | null
  disponible_hasta?: string | null
  dies_recollida?: readonly number[] | null
  horari_recollida?: string | null
}

export interface DatosDisponibilitatPlantilla {
  /** `disponibilitats.id`: el sufijo de la URL del botón. */
  disponibilitatId: string
  municipi: string | null
  comarca?: string | null
  /** Las ofertas del mensaje, en su orden (las que encajan con la entidad). */
  ofertes: readonly OfertaDisponibilitatPlantilla[]
}

function orDefault(v: string | null | undefined, fallback: string, max: number): string {
  const s = netejaParametre(v, max)
  return s === '' ? fallback : s
}

/** «2026-07-30» → «30/07/2026». Cualquier otra cosa se deja como está. */
function dataLlegible(v: string | null | undefined): string | null | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}

/** «120» → «120», «12.5» → «12,5» (coma decimal, como se escribe en catalán). */
function num(n: number): string {
  return String(n).replace('.', ',')
}

/** «El Prat de Llobregat (Baix Llobregat)»; sin comarca o si coincide, el municipio solo. */
function municipiAmbComarca(municipi: string | null | undefined, comarca: string | null | undefined): string {
  const m = (municipi ?? '').trim()
  const c = (comarca ?? '').trim()
  if (!m) return c
  return c && c.toLowerCase() !== m.toLowerCase() ? `${m} (${c})` : m
}

/** «dl, dc, dv · de 8:00 a 12:00», o lo que haya. */
function horariAmbDies(dies: unknown, horari: string | null | undefined): string {
  return [textDies(dies), (horari ?? '').trim()].filter(Boolean).join(' · ')
}

/** El producto con su variedad entre paréntesis; nunca «null». */
function nomProducte(producto: string | null | undefined, variedad: string | null | undefined): string {
  const p = (producto ?? '').trim()
  const v = (variedad ?? '').trim()
  if (p && v) return `${p} (${v})`
  return p || v
}

/** Los `components` de los botones de la plantilla: el payload de las respuestas rápidas, el sufijo de la URL. */
function componentsBotons(botons: readonly BotoPlantilla[], sufixUrl?: string): unknown[] {
  return botons.map((b, i) => b.type === 'QUICK_REPLY'
    ? { type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload: b.payload }] }
    : { type: 'button', sub_type: 'url', index: String(i), parameters: [{ type: 'text', text: sufixUrl ?? '' }] })
}

function body(textos: readonly string[]): unknown {
  return { type: 'body', parameters: textos.map((text) => ({ type: 'text', text })) }
}

/**
 * Los `components` de `oferta_excedent` (plantillas-meta.md §1): el cuerpo con sus 7 variables
 *   1 producte · 2 municipi (comarca) · 3 quantitat · 4 disponible fins · 5 horari · 6 modalitat · 7 preu mínim
 * y las dos respuestas rápidas con su payload (`accept:si`, `accept:no`), que el webhook trata
 * igual que los botones del mensaje de dentro de la ventana.
 */
export function construirComponentsOferta(d: DatosOfertaPlantilla): unknown[] {
  const mx = OFERTA_EXCEDENT.maxims
  const ms: Modalitat[] = modalitatsDe(d.modalitats)
  const unitats = d.caixes && d.caixes > 0 ? ` · ${textCaixes(d.caixes, d.format === 'palet' ? 'palet' : 'caixes')}` : ''
  const quantitat = d.kg && d.kg > 0 ? `${num(d.kg)} kg${unitats}` : ''
  const preu = !ambPreu(ms)
    ? (ms.length > 0 ? "no s'aplica" : '')
    : d.preuMinim != null && Number.isFinite(Number(d.preuMinim)) && Number(d.preuMinim) > 0
      ? `${Number(d.preuMinim).toFixed(2).replace('.', ',')} €/kg`
      : ''
  const textos = [
    orDefault(nomProducte(d.producto, d.variedad), '—', mx[0]),
    orDefault(municipiAmbComarca(d.municipi, d.comarca), '—', mx[1]),
    orDefault(quantitat, 'a convenir', mx[2]),
    orDefault(dataLlegible(d.disponible), 'consultar', mx[3]),
    orDefault(horariAmbDies(d.dies, d.horari), 'a convenir', mx[4]),
    orDefault(etiquetaModalitats(ms), 'a convenir', mx[5]),
    orDefault(preu, 'a convenir', mx[6]),
  ]
  return [body(textos), ...componentsBotons(OFERTA_EXCEDENT.botons)]
}

/**
 * La lista de productos en UNA línea: «Ceba 200 kg · Tomàquet 300 kg». Si pasa de `max`, se
 * dejan los primeros que caben y se cierra con «i N més» (el detalle está tras el botón).
 */
export function llistaProductesPlantilla(ofertes: readonly OfertaDisponibilitatPlantilla[], max: number): string {
  const items = ofertes
    .map((o) => {
      const nom = netejaParametre(nomProducte(o.producto, o.variedad ?? null), max)
      const kg = Number(o.kg_total ?? 0)
      return nom && Number.isFinite(kg) && kg > 0 ? `${nom} ${num(kg)} kg` : nom
    })
    .filter(Boolean)
  const tot = items.join(' · ')
  if (tot.length <= max) return tot
  for (let k = items.length - 1; k >= 1; k--) {
    const s = `${items.slice(0, k).join(' · ')} i ${items.length - k} més`
    if (s.length <= max) return s
  }
  // Ni el primero cabe con la cola: se recorta el primero.
  const cua = ` i ${items.length - 1} més`
  return `${netejaParametre(items[0], Math.max(1, max - cua.length))}${cua}`
}

/** Las modalidades del grupo: la unión de las de sus ofertas, en orden canónico. */
function modalitatsGrup(ofertes: readonly OfertaDisponibilitatPlantilla[]): Modalitat[] {
  return modalitatsDe(ofertes.flatMap((o) => modalitatsDe(
    Array.isArray(o.modalitats) && o.modalitats.length > 0 ? o.modalitats : o.modalitat,
  )))
}

/**
 * Los `components` de `oferta_disponibilitat` (plantillas-meta.md §1bis): el cuerpo con sus 5
 * variables
 *   1 productes · 2 municipi (comarca) · 3 disponible fins · 4 horari · 5 modalitat
 * y el botón de URL dinámica con el id de la disponibilidad como sufijo
 * (`/receptor/mercat?disponibilitat=<id>`). Lo común (fecha, días, franja) se lee de la PRIMERA
 * oferta, como `cosDisponibilitat()`: en el alta es idéntico en todas.
 */
export function construirComponentsDisponibilitat(d: DatosDisponibilitatPlantilla): unknown[] {
  const mx = OFERTA_DISPONIBILITAT.maxims
  const primera = d.ofertes[0]
  const textos = [
    orDefault(llistaProductesPlantilla(d.ofertes, mx[0]), '—', mx[0]),
    orDefault(municipiAmbComarca(d.municipi, d.comarca), '—', mx[1]),
    orDefault(dataLlegible(primera?.disponible_hasta ?? null), 'consultar', mx[2]),
    orDefault(horariAmbDies(primera?.dies_recollida ?? null, primera?.horari_recollida ?? null), 'a convenir', mx[3]),
    orDefault(etiquetaModalitats(modalitatsGrup(d.ofertes)), 'a convenir', mx[4]),
  ]
  return [body(textos), ...componentsBotons(OFERTA_DISPONIBILITAT.botons, d.disponibilitatId)]
}
