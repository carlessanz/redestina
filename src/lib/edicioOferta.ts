// La parte PURA de editar una oferta con el MISMO formulario que el alta (fase C del punto 3,
// 17-11-2026, filas 3.7.3 y 3.7.4 del Excel de la Fundació): de la fila al formulario y del
// formulario a los cambios que acepta `editar_oferta()`. Aparte del componente para probarla
// desde Vitest (`tests/edicioOferta.test.ts`).
//
// El formulario habla el idioma del cuestionario (`producte`, `kg`, `ubicacio`, `retorn`,
// `retorn_envasos`, `horari`…, las claves de `_shared/camposOferta.ts`) y la base el de sus
// columnas (`kg_total`, `ubicacion_id`, `retorn_envasos`, `retorn_envasos_detall`…). Ojo con
// `retorn_envasos`: en el cuestionario es el DETALLE («quins envasos») y en la base la respuesta
// Sí/No. Por eso esta traducción vive en un sitio y tiene pruebas.

import { ddmmaaaaAIso, isoADdmmaaaa } from './esborranyOferta'
import { hhmm } from './franja'
import { ambPreu, modalitatsDe } from './modalitats'

type Datos = Record<string, unknown>

/** Lo que el formulario lee de una oferta (las columnas que tienen pregunta). */
export interface FilaEditable {
  producto: string | null
  familia?: string | null
  variedad?: string | null
  producte_al_camp?: boolean | null
  kg_total?: number | string | null
  num_caixes?: number | null
  format_entrega?: string | null
  retorn_envasos?: string | null
  retorn_envasos_detall?: string | null
  retorn_envasos_quantitat?: number | null
  ubicacion_id?: string | null
  gmaps_url?: string | null
  disponible_hasta?: string | null
  dies_recollida?: number[] | null
  hora_recollida_inici?: string | null
  hora_recollida_fi?: string | null
  modalitat?: string | null
  modalitats?: string[] | null
  preu_minim?: number | string | null
  coste_kg?: number | string | null
  causa_codigo?: string | null
  subcausa_codigo?: string | null
  observacions?: string | null
  fotos?: string[] | null
}

const buit = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const num = (v: unknown): number | null => {
  if (buit(v)) return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Las respuestas del cuestionario a partir de la fila: lo que el formulario enseña al abrir una
 * oferta para editarla. Lo que la fila no sabe se queda sin clave (el formulario lo trata como
 * vacío). La causa es la SUBCAUSA si la hay; si solo hay categoría (WhatsApp), la categoría, que
 * el formulario no puede elegir y deja por contestar.
 */
export function datosDeFila(f: FilaEditable): Datos {
  const d: Datos = {}
  const pon = (k: string, v: unknown) => { if (!buit(v)) d[k] = v }
  pon('producte', f.producto)
  pon('familia', f.familia)
  pon('varietat', f.variedad)
  d.producte_al_camp = f.producte_al_camp ? 'si' : 'no'
  pon('kg', num(f.kg_total))
  pon('format_entrega', f.format_entrega)
  pon('caixes', f.num_caixes)
  pon('retorn', f.retorn_envasos)
  pon('retorn_envasos', f.retorn_envasos_detall)
  pon('retorn_quantitat', f.retorn_envasos_quantitat)
  pon('ubicacio', f.ubicacion_id)
  pon('gmaps_url', f.gmaps_url)
  if (f.disponible_hasta) pon('disponible_fins', isoADdmmaaaa(String(f.disponible_hasta).slice(0, 10)))
  if (Array.isArray(f.dies_recollida) && f.dies_recollida.length > 0) d.dies_recollida = [...f.dies_recollida]
  const inici = hhmm(f.hora_recollida_inici)
  const fi = hhmm(f.hora_recollida_fi)
  if (inici || fi) d.horari = { inici, fi }
  const mods = modalitatsDe(f.modalitats && f.modalitats.length > 0 ? f.modalitats : f.modalitat)
  if (mods.length > 0) d.modalitat = mods
  pon('preu_minim', num(f.preu_minim))
  pon('cost_kg', num(f.coste_kg))
  pon('causa', f.subcausa_codigo ?? f.causa_codigo)
  pon('observacions', f.observacions)
  if (Array.isArray(f.fotos) && f.fotos.length > 0) d.fotos = [...f.fotos]
  return d
}

const igualLlista = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Los cambios para `crear-oferta/editar` (las claves de `canvisOferta()` y `editar_oferta()`):
 * SOLO lo que difiere de la fila. Las preguntas que dejan de aplicar viajan vacías (si el
 * producto pasa a estar en el campo, el formato y el retorno ya no son de esta oferta).
 *
 * `aplica(clau)` dice si la pregunta se hace con las respuestas de ahora (la condición del
 * descriptor); sin él, todas aplican.
 */
export function canvisDeDatos(
  f: FilaEditable,
  d: Datos,
  aplica: (clau: string) => boolean = () => true,
): Datos {
  const c: Datos = {}
  const val = (k: string) => (aplica(k) ? d[k] : null)
  const text = (v: unknown) => (buit(v) ? null : String(v).trim())

  const kg = num(d.kg)
  if (kg !== null && kg !== num(f.kg_total)) c.kg_total = kg

  const mods = modalitatsDe(d.modalitat)
  const abans = modalitatsDe(f.modalitats && f.modalitats.length > 0 ? f.modalitats : f.modalitat)
  if (mods.length > 0 && !igualLlista(mods, abans)) c.modalitats = mods

  const preu = ambPreu(mods) ? num(d.preu_minim) : null
  if (preu !== num(f.preu_minim)) c.preu_minim = preu
  const cost = mods.includes('donacio') ? num(d.cost_kg) : null
  if (cost !== num(f.coste_kg)) c.coste_kg = cost

  const alCamp = d.producte_al_camp === 'si' || d.producte_al_camp === true
  if (alCamp !== Boolean(f.producte_al_camp)) c.producte_al_camp = alCamp

  const format = text(val('format_entrega'))
  if (format !== (f.format_entrega ?? null)) c.format_entrega = format
  const caixesN = num(val('caixes'))
  const caixes = caixesN !== null && Number.isInteger(caixesN) && caixesN > 0 ? caixesN : null
  if (caixes !== (f.num_caixes ?? null)) c.num_caixes = caixes
  const retorn = val('retorn') === 'Sí' || val('retorn') === 'No' ? String(val('retorn')) : null
  if (retorn !== (f.retorn_envasos ?? null)) c.retorn_envasos = retorn
  const detall = retorn === 'Sí' ? text(val('retorn_envasos')) : null
  if (detall !== (f.retorn_envasos_detall ?? null)) c.retorn_envasos_detall = detall
  const qN = retorn === 'Sí' ? num(val('retorn_quantitat')) : null
  if (qN !== (f.retorn_envasos_quantitat ?? null)) c.retorn_envasos_quantitat = qN

  const ubi = text(d.ubicacio)
  if (ubi !== null && ubi !== (f.ubicacion_id ?? null)) c.ubicacion_id = ubi
  const maps = text(d.gmaps_url)
  if (maps !== (f.gmaps_url ?? null)) c.gmaps_url = maps

  const iso = ddmmaaaaAIso(String(d.disponible_fins ?? ''))
  const isoAbans = f.disponible_hasta ? String(f.disponible_hasta).slice(0, 10) : ''
  if (iso && iso !== isoAbans) c.disponible_hasta = iso

  const dies = Array.isArray(d.dies_recollida)
    ? [...new Set((d.dies_recollida as unknown[]).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7))].sort((a, b) => a - b)
    : []
  if (!igualLlista(dies, f.dies_recollida ?? [])) c.dies_recollida = dies

  const h = d.horari && typeof d.horari === 'object' ? d.horari as { inici?: string; fi?: string } : null
  const inici = h?.inici ?? ''
  const fi = h?.fi ?? ''
  if (inici !== hhmm(f.hora_recollida_inici) || fi !== hhmm(f.hora_recollida_fi)) {
    c.franja = inici || fi ? { inici, fi } : null
  }

  // La subcausa solo viaja si es otra y no está vacía: una oferta de WhatsApp sin subcausa se
  // puede editar sin elegirla (la RPC rechaza el vacío).
  const sub = text(d.causa)
  if (sub && sub !== (f.subcausa_codigo ?? null) && sub !== (f.causa_codigo ?? null)) c.subcausa_codigo = sub

  const varietat = text(d.varietat) ?? ''
  if (varietat !== (f.variedad ?? '')) c.variedad = varietat
  const obs = text(d.observacions) ?? ''
  if (obs !== (f.observacions ?? '')) c.observacions = obs

  const fotos = Array.isArray(d.fotos) ? (d.fotos as unknown[]).filter((x): x is string => typeof x === 'string') : []
  if (!igualLlista(fotos, f.fotos ?? [])) c.fotos = fotos
  return c
}
