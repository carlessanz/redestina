// El «tipo de producto» de los filtros (reunión del 05-10-2026). Desde el 16-11-2026 el Mercat
// usa la barra común (`filtres.ts`); de aquí solo queda la categoría, que comparten el Mercat,
// el listado de ofertas del equipo y la priorización.
//
// Por defecto se enseña TODO lo que la RLS deja ver (las ofertas compatibles con el tipo de
// receptor, §4bis); el filtro solo acota, en cliente, sobre lo que ya ha llegado.
//
// ZONA = la COMARCA, no el municipio: es lo único que el Mercat sabe de dónde está una
// oferta (D3: un municipio con un solo generador lo identifica).
//
// TIPO DE PRODUCTO = el MISMO vocabulario que el receptor declara en su ficha
// (`perfil_receptor.productes_*`, `perfilReceptor.ts`): fruita · verdura · tubercles ·
// fruita seca. Las doce familias del catálogo son demasiado finas para elegir de un
// vistazo («Horta Fruit», «Horta Fulla»…) y no tienen traducción en el frontend. Que
// filtro y ficha hablen igual es lo que permitirá, más adelante, filtrar por defecto por
// lo que la entidad dijo que quiere (C3 del plan del 05-10-2026).

/** Las categorías, en el orden en que se ofrecen. `altres` recoge lo que no encaja. */
export const CATEGORIES_PRODUCTE = ['fruita', 'verdura', 'tuberculs', 'fruita_seca', 'altres'] as const
export type CategoriaProducte = typeof CATEGORIES_PRODUCTE[number]

/** De familia del catálogo (`productos.familia`, en catalán) a categoría. */
export function categoriaDeFamilia(familia: string | null | undefined): CategoriaProducte {
  const f = (familia ?? '').trim()
  if (f === 'Fruita Seca') return 'fruita_seca'
  if (f.startsWith('Fruita')) return 'fruita'
  if (f === 'Horta Tub/Bul/Arr') return 'tuberculs'
  if (f.startsWith('Horta')) return 'verdura'
  return 'altres'
}
