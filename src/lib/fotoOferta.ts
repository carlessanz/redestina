// QUÉ FOTO ENSEÑA UNA OFERTA. Puro, sin red, con test: es la única regla y la comparten el
// Mercat, Interessos, Històric y los listados del productor y del equipo.
//
//   1. Si la oferta tiene fotos propias, la primera.
//   2. Si no, el ICONO DEL PRODUCTO (`public/icones-productes/`, `iconaProducte.ts`). Si el
//      producto no tiene dibujo, el de su familia.
//
// ⚠️ Hasta el 29-09-2026 el paso 2 era una FOTO del catálogo (bucket `fotos-productes`) y
//    `excedentes.foto_producte` permitía desactivarla. Las fotos se sustituyeron por iconos
//    —un dibujo no se confunde con la foto del lote— y la casilla dejó de tener sentido:
//    la columna sigue en la base, pero ya no la lee nadie.

export interface ProducteFoto {
  familia: string | null
}

export interface OfertaAmbFotos {
  producto: string | null
  fotos?: string[] | null
  foto_producte?: boolean | null
}

export type FotoPrincipal =
  | { tipus: 'oferta'; ruta: string }
  | { tipus: 'icona'; producto: string | null; familia: string | null }

export function fotoPrincipal(
  o: OfertaAmbFotos,
  cataleg: ReadonlyMap<string, ProducteFoto>,
): FotoPrincipal {
  const propia = o.fotos?.find(Boolean)
  if (propia) return { tipus: 'oferta', ruta: propia }
  const p = o.producto ? cataleg.get(o.producto) : undefined
  return { tipus: 'icona', producto: o.producto ?? null, familia: p?.familia ?? null }
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
