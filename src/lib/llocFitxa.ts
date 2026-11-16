// El lugar de recogida que se PROPONE a partir de la dirección de la ficha (16-11-2026).
//
// Casi ningún productor tiene un lugar de recogida dado de alta (en el clon, 2 de 557), pero la
// mayoría tiene la dirección en su ficha (`direccion`, `codigo_postal`, `municipio_ine` →
// `poblacion`). El diagnóstico pedía «un lloc de recollida principal» y enseñaba la lista vacía:
// ahora `LlocsRecollida` propone esa dirección como primer lugar, con el formulario ya rellenado
// para añadir días y franjas o cambiarla antes de guardar. No se crea nada sin que alguien lo
// guarde: un lugar de recogida es una decisión, no una copia de la dirección.

export interface AdrecaFitxa {
  direccion: string | null
  codigo_postal: string | null
  poblacion: string | null
  municipio_ine: string | null
}

export interface LlocProposat {
  direccion: string
  municipio_ine: string | null
  /** Lo que se lee en la propuesta: «Carrer Major, 3 · 08850 Gavà». */
  text: string
}

const net = (v: string | null | undefined) => (v ?? '').trim()

/** La propuesta, o `null` si la ficha no dice ni dirección ni municipio. */
export function llocDeLaFitxa(f: AdrecaFitxa | null | undefined): LlocProposat | null {
  if (!f) return null
  const dir = net(f.direccion)
  const cp = net(f.codigo_postal)
  const pob = net(f.poblacion)
  const ine = net(f.municipio_ine) || null
  if (!dir && !ine) return null
  const lloc = [cp, pob].filter(Boolean).join(' ')
  return { direccion: dir, municipio_ine: ine, text: [dir, lloc].filter(Boolean).join(' · ') }
}
