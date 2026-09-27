// Los campos de la ficha que dependen del TIPO de receptor (revisión funcional del
// 23-09-2026): una entidad social, una empresa compradora y un obrador no necesitan que se
// les pregunte lo mismo. Se guardan en `entidades.perfil_receptor` (jsonb, 20270402100000).
//
// DECLARATIVO Y PURO: la pantalla los pinta recorriendo esta lista, y
// `tests/perfilReceptor.test.ts` comprueba que cada etiqueta y cada opción existen en los dos
// idiomas —las claves se COMPONEN (`pr.<camp>`, `pr.o_<opcio>`), así que `cobertura.test.ts`
// no las vería—.
//
// ⚠️ Las opciones son LISTAS CERRADAS a propósito: «usar desplegables/selección múltiple con
//    variables cerradas por nosotros» para poder cruzarlas en el ERP. El `id` es lo que se
//    guarda; el texto se puede reescribir sin tocar datos. Son provisionales: la Fundació
//    las revisará, y cambiar una lista es cambiar este fichero.

export type TipusCampPerfil = 'numero' | 'text' | 'select' | 'multi' | 'sino'

export interface CampPerfil {
  clau: string
  tipus: TipusCampPerfil
  /** Solo en `select` y `multi`: los ids de las opciones (su texto es `pr.o_<id>`). */
  opcions?: readonly string[]
  /** Unidad que se pinta al lado (kg/setmana…), también clave i18n. */
  unitatKey?: string
}

const FREQUENCIES = ['diaria', 'setmanal', 'quinzenal', 'mensual', 'puntual'] as const
const PRODUCTES = ['fruita', 'verdura', 'tuberculs', 'fruita_seca', 'tots'] as const
const LOGISTICA = ['transport_propi', 'cambra_frigorifica', 'moll_carrega', 'transpalet', 'cap'] as const

export const PERFIL_RECEPTOR: Record<string, readonly CampPerfil[]> = {
  social: [
    { clau: 'persones_ateses', tipus: 'numero', unitatKey: 'pr.u_persones' },
    { clau: 'families_ateses', tipus: 'numero', unitatKey: 'pr.u_families' },
    {
      clau: 'tipus_atencio', tipus: 'multi',
      opcions: ['menjador', 'lots', 'economat', 'residencial', 'altres'],
    },
    { clau: 'productes_rebre', tipus: 'multi', opcions: PRODUCTES },
    { clau: 'frequencia', tipus: 'select', opcions: FREQUENCIES },
    { clau: 'capacitat', tipus: 'numero', unitatKey: 'pr.u_kg_setmana' },
    { clau: 'recollida_propia', tipus: 'sino' },
    { clau: 'conservacio', tipus: 'multi', opcions: ['cambra_frigorifica', 'nevera', 'congelador', 'magatzem_sec', 'cap'] },
  ],
  comercial: [
    {
      clau: 'activitat', tipus: 'select',
      opcions: ['restauracio', 'comerc', 'distribucio', 'industria', 'altres'],
    },
    { clau: 'us_producte', tipus: 'text' },
    { clau: 'productes_interes', tipus: 'multi', opcions: PRODUCTES },
    { clau: 'volum', tipus: 'numero', unitatKey: 'pr.u_kg_setmana' },
    { clau: 'format', tipus: 'text' },
    { clau: 'zona', tipus: 'text' },
    { clau: 'frequencia', tipus: 'select', opcions: FREQUENCIES },
    { clau: 'rang_preu', tipus: 'text' },
    { clau: 'logistica', tipus: 'multi', opcions: LOGISTICA },
  ],
  transformador: [
    {
      clau: 'tipus_transformacio', tipus: 'multi',
      opcions: ['conserves', 'melmelades', 'sucs', 'deshidratats', 'congelats', 'cuina', 'altres'],
    },
    { clau: 'productes_transformar', tipus: 'multi', opcions: PRODUCTES },
    { clau: 'capacitat', tipus: 'numero', unitatKey: 'pr.u_kg_setmana' },
    { clau: 'formats_finals', tipus: 'text' },
    { clau: 'fa_maquila', tipus: 'sino' },
    { clau: 'condicions_maquila', tipus: 'text' },
    { clau: 'logistica', tipus: 'multi', opcions: LOGISTICA },
  ],
  animal: [
    { clau: 'capacitat', tipus: 'numero', unitatKey: 'pr.u_kg_setmana' },
    { clau: 'frequencia', tipus: 'select', opcions: FREQUENCIES },
    { clau: 'recollida_propia', tipus: 'sino' },
  ],
}

/** Los tipos de empresa o entidad, lista cerrada (y el check de la RPC los repite). */
export const TIPUS_EMPRESA = ['cooperativa', 'sl', 'sa', 'autonom', 'fundacio', 'associacio', 'altres'] as const

/** Todas las claves i18n que usa este módulo: para la prueba de cobertura. */
export function clausPerfil(): string[] {
  const claus = new Set<string>()
  for (const camps of Object.values(PERFIL_RECEPTOR)) {
    for (const c of camps) {
      claus.add(`pr.${c.clau}`)
      for (const o of c.opcions ?? []) claus.add(`pr.o_${o}`)
      if (c.unitatKey) claus.add(c.unitatKey)
    }
  }
  for (const t of TIPUS_EMPRESA) claus.add(`org.te_${t}`)
  return [...claus]
}
