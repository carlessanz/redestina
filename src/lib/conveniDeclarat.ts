// Los rechazos de `declarar_conveni()` (20270430100000), traducidos.
//
// El convenio DECLARADO: el super_admin lo da por vigente con los datos de la ficha, sin
// firma ni escaneado (gestión autónoma, fase 1). La RPC se niega con SQLSTATE `22023` y el
// CÓDIGO al principio del mensaje —solo, o seguido de `: ` y una frase en catalán sin
// acentos—, y con `42501` si quien llama no es super_admin. `falta_dades_fitxa` trae además,
// en el `details` del error, los campos de la ficha que faltan separados por comas
// (`nif,domicili`): la pantalla los enseña y manda a la ficha a completarlos.
//
// ⚠️ PURO Y APARTE DE `convenis.ts`, como `conversioEspigolada.ts`: aquel importa el cliente
//    de Supabase, y un fichero que lo importe no se puede cargar desde Vitest. Las claves
//    `cdecl.err_*` y `cdecl.camp_*` se componen, así que sin esta separación no habría
//    ninguna prueba que dijera que existen en los dos idiomas.

/** Los rechazos de la RPC, en el orden de sus guardas. */
export const MOTIUS_DECLARAT = [
  'no_autoritzat',
  'tipus_org_desconegut',
  'tipus_desconegut',
  'organitzacio_inexistent',
  'falta_signant',
  'falta_carrec',
  'data_futura',
  'text_massa_llarg',
  'ja_vigent',
  'falta_apoderada',
  'ja_signat',
  'conveni_retornat',
  'estat_inesperat',
  'falta_dades_fitxa',
] as const

export type MotiuDeclarat = (typeof MOTIUS_DECLARAT)[number]

/** Los campos de la ficha que la RPC puede pedir (los mínimos que también exige la firma). */
export const CAMPS_FITXA_DECLARAT = ['nif', 'domicili'] as const

export interface ErrorDeclarat {
  /** El código reconocido, o `null` si el error no es uno de los de la RPC. */
  codi: MotiuDeclarat | null
  /** La clave i18n del motivo. Sin código reconocido, el error genérico de convenios. */
  clau: string
  /** Solo con `falta_dades_fitxa`: los campos que faltan, tal como los nombra la base. */
  camps: string[]
}

/**
 * Del error de PostgREST a un motivo legible.
 *
 * Se busca el código EXACTO o seguido de `:` —nunca como subcadena suelta—: `tipus_desconegut`
 * no debe casar dentro de `tipus_org_desconegut`, ni un código dentro de una frase que lo
 * nombre de pasada. Un `42501` es siempre falta de permiso, venga con el texto que venga.
 */
export function errorConveniDeclarat(err: {
  missatge?: string | null
  detall?: string | null
  codi?: string | null
}): ErrorDeclarat {
  if (err.codi === '42501') return { codi: 'no_autoritzat', clau: 'cdecl.err_no_autoritzat', camps: [] }
  const text = (err.missatge ?? '').trim()
  const codi = MOTIUS_DECLARAT.find((c) => text === c || text.startsWith(`${c}:`)) ?? null
  if (!codi) return { codi: null, clau: 'conv.err_generic', camps: [] }
  const camps = codi === 'falta_dades_fitxa'
    ? (err.detall ?? '').split(',').map((c) => c.trim()).filter((c) => c !== '')
    : []
  return { codi, clau: `cdecl.err_${codi}`, camps }
}

/**
 * La clave i18n de un campo de la ficha que falta, o `null` si la base nombra uno que esta
 * pantalla no conoce (entonces se enseña el nombre tal cual: mejor eso que callarlo).
 */
export function clauCampFitxa(camp: string): string | null {
  return (CAMPS_FITXA_DECLARAT as readonly string[]).includes(camp) ? `cdecl.camp_${camp}` : null
}

/** El convenio que se declara para cada papel: el de col·laboració (fase 5 del 08-10-2026). */
export function tipusConveniDeclarat(tipusOrg: 'productor' | 'entidad'): 'col_productor' | 'col_receptor' {
  return tipusOrg === 'productor' ? 'col_productor' : 'col_receptor'
}

/** Los límites de la RPC, para avisar bajo el campo antes de enviarlo. */
export const LIMITS_DECLARAT = { signantMin: 2, signantMax: 120, referenciaMax: 120, notesMax: 500 } as const

/** ¿Nombre o cargo de quien firma dentro de 2-120 caracteres? (lo mismo que mira la RPC) */
export function textSignantValid(v: string): boolean {
  const n = v.trim().length
  return n >= LIMITS_DECLARAT.signantMin && n <= LIMITS_DECLARAT.signantMax
}
