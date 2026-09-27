// QUÉ FOTO ENSEÑA UNA OFERTA (27-09-2026). Puro, sin red, con test: es la única regla y la
// comparten el Mercat, Interessos, Històric y los listados del productor.
//
//   1. Si la oferta tiene fotos propias, la primera.
//   2. Si no tiene, y el productor no lo ha desactivado (`excedentes.foto_producte`), la foto
//      del PRODUCTO del catálogo (bucket `fotos-productes`), marcada como orientativa.
//   3. Si tampoco hay, o está desactivado, el icono GENÉRICO de su familia.
//
// ⚠️ `foto_producte` ausente vale `true`: es el defecto de la columna, y un `select` que no
//    la pida (o una fila anterior a 20270405100100) tiene que comportarse igual.

export interface ProducteFoto {
  familia: string | null
  foto: string | null
  foto_mini: string | null
}

export interface OfertaAmbFotos {
  producto: string | null
  fotos?: string[] | null
  foto_producte?: boolean | null
}

export type FotoPrincipal =
  | { tipus: 'oferta'; ruta: string }
  | { tipus: 'producte'; ruta: string; mini: string }
  | { tipus: 'generica'; familia: string | null }

export function fotoPrincipal(
  o: OfertaAmbFotos,
  cataleg: ReadonlyMap<string, ProducteFoto>,
): FotoPrincipal {
  const propia = o.fotos?.find(Boolean)
  if (propia) return { tipus: 'oferta', ruta: propia }
  const p = o.producto ? cataleg.get(o.producto) : undefined
  if (o.foto_producte !== false && p?.foto && p.foto_mini) {
    return { tipus: 'producte', ruta: p.foto, mini: p.foto_mini }
  }
  return { tipus: 'generica', familia: p?.familia ?? null }
}

/**
 * Qué icono pinta el hueco sin foto, según la familia del catálogo. Devuelve una CLAVE y no
 * el componente: así esto se prueba sin React, y quien pinta decide el icono de cada clave.
 */
export type ClasseIcona =
  | 'citric' | 'fruita' | 'vermella' | 'seca' | 'exotica'
  | 'fulla' | 'arrel' | 'horta' | 'gra' | 'generic'

export function classeIcona(familia: string | null | undefined): ClasseIcona {
  const f = (familia ?? '').toLowerCase()
  if (f.includes('cítric') || f.includes('citric')) return 'citric'
  if (f.includes('vermella')) return 'vermella'
  if (f.includes('seca')) return 'seca'
  if (f.includes('exòtica') || f.includes('exotica')) return 'exotica'
  if (f.startsWith('fruita')) return 'fruita'
  if (f.includes('fulla')) return 'fulla'
  if (f.includes('tub') || f.includes('arr')) return 'arrel'
  if (f.startsWith('horta')) return 'horta'
  if (f.includes('varis')) return 'gra'
  return 'generic'
}
