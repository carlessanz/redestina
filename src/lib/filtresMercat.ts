// Los filtros del Mercat del receptor: zona y tipo de producto (reunión del 05-10-2026).
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

export interface FiltresMercat {
  /** `''` = todas. */
  comarca: string
  /** `''` = todas. */
  categoria: '' | CategoriaProducte
}

export const SENSE_FILTRES: FiltresMercat = { comarca: '', categoria: '' }

interface OfertaFiltrable { comarca?: string | null; familia?: string | null }

export function filtraMercat<T extends OfertaFiltrable>(ofertes: readonly T[], f: FiltresMercat): T[] {
  return ofertes.filter((o) =>
    (!f.comarca || o.comarca === f.comarca)
    && (!f.categoria || categoriaDeFamilia(o.familia) === f.categoria))
}

/** Las opciones que de verdad dan resultado: no se ofrece una comarca sin ofertas. */
export function opcionsMercat(ofertes: readonly OfertaFiltrable[]): { comarques: string[]; categories: CategoriaProducte[] } {
  const comarques = [...new Set(ofertes.map((o) => o.comarca).filter((c): c is string => !!c))]
    .sort((a, b) => a.localeCompare(b, 'ca'))
  const hi = new Set(ofertes.map((o) => categoriaDeFamilia(o.familia)))
  return { comarques, categories: CATEGORIES_PRODUCTE.filter((c) => hi.has(c)) }
}

/**
 * Recordar el filtro por ENTIDAD en este navegador. Es comodidad, no estado: si
 * `localStorage` falla (Safari privado) o guarda algo raro, se vuelve a «sin filtro».
 */
const CLAU = 'redestina-mercat-filtres:'

export function llegeixFiltres(entidadId: string | null): FiltresMercat {
  if (!entidadId) return SENSE_FILTRES
  try {
    const cru = localStorage.getItem(CLAU + entidadId)
    if (!cru) return SENSE_FILTRES
    const o = JSON.parse(cru) as Partial<FiltresMercat>
    const categoria = (CATEGORIES_PRODUCTE as readonly string[]).includes(String(o.categoria))
      ? o.categoria as CategoriaProducte : ''
    return { comarca: typeof o.comarca === 'string' ? o.comarca : '', categoria }
  } catch {
    return SENSE_FILTRES
  }
}

export function desaFiltres(entidadId: string | null, f: FiltresMercat): void {
  if (!entidadId) return
  try {
    if (!f.comarca && !f.categoria) localStorage.removeItem(CLAU + entidadId)
    else localStorage.setItem(CLAU + entidadId, JSON.stringify(f))
  } catch { /* sin memoria del filtro, pero el Mercat funciona igual */ }
}
