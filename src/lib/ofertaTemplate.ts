// Construye el array `components` de la plantilla `oferta_excedent` (Cloud API de
// Meta) a partir de los datos de una oferta. El mapeo de las 7 variables está en
// supabase/functions/_shared/plantillas-meta.md (§1). Solo se envía el componente
// `body` (el header de la plantilla es texto fijo sin variable). Meta rechaza
// parámetros vacíos, así que cada variable lleva un fallback.

export interface DatosOfertaPlantilla {
  producto: string | null
  variedad: string | null
  productor: string | null
  municipi: string | null
  kg: number | null
  caixes: number | null
  disponible: string | null
  horari: string | null
  responsable?: string | null
}

function orDefault(v: string | null | undefined, fallback: string): string {
  const s = (v ?? '').trim()
  return s === '' ? fallback : s
}

/** Devuelve los `components` (solo `body`, 7 variables) de `oferta_excedent`. */
/** «2026-07-30» → «30/07/2026». Cualquier otra cosa se deja como está. */
function dataLlegible(v: string | null | undefined): string | null | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}

export function construirComponentsOferta(d: DatosOfertaPlantilla): unknown[] {
  // ⚠️ Se comprueba `producto` ANTES de interpolar. Con `producto: null` y una variedad
  // puesta, la plantilla anterior producía la cadena literal «null · Pera» —y `orDefault` no
  // la salvaba, porque ya no estaba vacía—, así que eso es lo que le habría llegado a la
  // entidad receptora por WhatsApp. El intake no deja variedad sin producto, pero el alta
  // desde el panel del productor no lo impide y los tipos lo permiten.
  const producte = orDefault(
    d.producto && d.variedad ? `${d.producto} · ${d.variedad}` : (d.producto ?? d.variedad),
    '—',
  )
  const quantitat = d.kg
    ? `${String(d.kg).replace('.', ',')} kg${d.caixes ? ` · ${d.caixes} ${d.caixes === 1 ? 'caixa' : 'caixes'}` : ''}`
    : 'a convenir'
  const textos = [
    producte,
    orDefault(d.productor, '—'),
    orDefault(d.municipi, '—'),
    quantitat,
    // La fecha llega en ISO («2026-07-30») y se lee como se escribe aquí: 30/07/2026.
    orDefault(dataLlegible(d.disponible), 'consultar'),
    orDefault(d.horari, 'a convenir'),
    orDefault(d.responsable, 'Equip Redestina'),
  ]
  return [{ type: 'body', parameters: textos.map((text) => ({ type: 'text', text })) }]
}
