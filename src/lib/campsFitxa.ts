// La ÚNICA definición de los campos de la ficha de una organización (plan 1, rebanada 1C,
// D8, 02-11-2026). Lo que el equipo ve en `/equip/entitats/:id` y lo que el actor ve en
// «La meva organització» sale de aquí: cada campo dice en qué tabla vive, en qué bloque va,
// quién lo ve y quién lo edita. Es lo que cierra por construcción la subtarea 1.6 («la ficha
// del equipo y la del actor no coinciden»): ya no hay dos listas que puedan separarse.
//
// PURO: sin React ni Supabase, con prueba (`tests/campsFitxa.test.ts`), que comprueba tres
// cosas que no se pueden vigilar a ojo:
//   · que CADA columna de `productores` y `entidades` está clasificada (en un campo, en
//     `GESTIONATS_PER_COMPONENT` o en `NO_ES_MOSTRA`), y solo una vez;
//   · que lo que el actor puede editar (`edita: 'tots'`) coincide EXACTAMENTE con la lista
//     blanca de `actualitzar_fitxa_productor()` / `actualitzar_fitxa_entitat()`;
//   · que toda etiqueta existe en catalán y castellano.
//
// UN CAMPO, DOS COLUMNAS. Las dos tablas nombran distinto lo mismo (`empresa`/`nombre`,
// `name`/`contacto`, `phone`/`telefono`…). Un campo COMÚN tiene columna en las dos y, en una
// organización con doble rol, la ficha del equipo lo enseña UNA vez y lo escribe en las dos
// fichas; si hoy difieren, lo dice junto al campo. Un campo de un solo papel se enseña solo
// si la organización tiene ese papel (`rolDe()`).

export type Taula = 'productores' | 'entidades'

/** Los bloques de la ficha, en el orden en que se pintan. */
export type Bloc =
  | 'identitat' | 'rols' | 'contacte' | 'adreca' | 'ofertant' | 'receptor'
  | 'diagnostic' | 'documentacio' | 'intern'

export const BLOCS: readonly Bloc[] = [
  'identitat', 'rols', 'contacte', 'adreca', 'ofertant', 'receptor', 'diagnostic', 'documentacio', 'intern',
]

/** Quién ve el campo: todos (equipo y actor) o solo el equipo. */
export type Veu = 'tots' | 'equip'
/** Quién lo edita: todos, solo el equipo o nadie (derivado: lo escribe un trigger). */
export type Edita = 'tots' | 'equip' | 'ningu'
export type Rol = 'ofertant' | 'receptor' | 'ambdos'

export type TipusCamp =
  | 'text' | 'tel' | 'email' | 'nif' | 'cp' | 'textarea' | 'number' | 'bool' | 'boolnull'
  | 'list' // text[] separado por comas
  | 'select' // lista fija (`opcions`), con `etiquetaOpcio` como prefijo i18n si se guarda un identificador
  | 'tipus_empresa' // lista cerrada TIPUS_EMPRESA; conserva un valor antiguo de texto libre
  | 'municipi' // codi INE (SelectorMunicipi); el trigger rellena población y comarca
  | 'comarca' // una comarca de `municipios`; conserva un valor antiguo del import
  | 'xips_activitat' // catálogo `tipus_activitat`, filtrado por papel
  | 'xips_modalitats' // donacio · venda · maquila
  | 'data' // `yyyy-mm-dd` (productores.data_alta es date; entidades.data_alta, texto)

export interface CampFitxa {
  /** Clave única del campo en la ficha (no es el nombre de la columna). */
  clau: string
  /** Columna en cada tabla. Con las dos, es un campo COMÚN. */
  columnes: Partial<Record<Taula, string>>
  bloc: Bloc
  tipus?: TipusCamp
  /** Clave i18n de la etiqueta. */
  labelKey: string
  /** Clave i18n de la ayuda bajo el campo. */
  ajudaKey?: string
  veu: Veu
  edita: Edita
  /** Valores del `select`. */
  opcions?: readonly string[]
  /** Prefijo i18n de cada opción (`org.tr_` → `org.tr_social`). */
  etiquetaOpcio?: string
  ample?: 'full'
  /** No se puede dejar vacío (el actor lo valida en pantalla; la RPC también). */
  obligatori?: boolean
  /** Longitud máxima de un texto (la base tiene el mismo CHECK). */
  maxim?: number
}

/** El papel al que pertenece un campo: común si tiene columna en las dos tablas. */
export function rolDe(c: CampFitxa): Rol {
  if (c.columnes.productores && c.columnes.entidades) return 'ambdos'
  return c.columnes.productores ? 'ofertant' : 'receptor'
}

export const CAMPS_FITXA: readonly CampFitxa[] = [
  // ------------------------------------------------------------------ Identitat
  { clau: 'nom_comercial', columnes: { productores: 'empresa', entidades: 'nombre' }, bloc: 'identitat',
    labelKey: 'org.f_nom_comercial', veu: 'tots', edita: 'tots', obligatori: true },
  { clau: 'razon_social', columnes: { productores: 'razon_social', entidades: 'razon_social' }, bloc: 'identitat',
    labelKey: 'org.f_rao_social', ajudaKey: 'org.h_rao_social', veu: 'tots', edita: 'tots' },
  { clau: 'nif', columnes: { productores: 'nif', entidades: 'nif' }, bloc: 'identitat', tipus: 'nif',
    labelKey: 'f.nif', veu: 'tots', edita: 'tots' },
  { clau: 'tipus_empresa', columnes: { productores: 'tipo_empresa', entidades: 'tipo_entidad' }, bloc: 'identitat',
    tipus: 'tipus_empresa', labelKey: 'org.f_tipus_entitat', veu: 'tots', edita: 'tots' },
  // Qué hace la organización. El catálogo distingue a qué papel aplica cada actividad: con
  // doble rol se enseña la unión y cada ficha guarda las de su papel (`activitatsDeTaula`).
  { clau: 'tipus_activitat', columnes: { productores: 'tipus_activitat', entidades: 'tipus_activitat' }, bloc: 'identitat',
    tipus: 'xips_activitat', labelKey: 'org.f_activitat', veu: 'tots', edita: 'tots', ample: 'full' },

  // ------------------------------------------------------------------ Contacte i accés
  // Un solo contacto por entidad (D3): la persona de la ficha es la que puede tener acceso.
  { clau: 'persona_contacte', columnes: { productores: 'name', entidades: 'contacto' }, bloc: 'contacte',
    labelKey: 'org.f_persona_contacte', veu: 'tots', edita: 'tots' },
  { clau: 'email', columnes: { productores: 'email', entidades: 'email' }, bloc: 'contacte', tipus: 'email',
    labelKey: 'f.email', veu: 'tots', edita: 'tots' },
  { clau: 'telefon', columnes: { productores: 'phone', entidades: 'telefono' }, bloc: 'contacte', tipus: 'tel',
    labelKey: 'org.f_telefon', veu: 'tots', edita: 'tots' },
  { clau: 'telefon2', columnes: { productores: 'telefono_alt', entidades: 'telefono2' }, bloc: 'contacte', tipus: 'tel',
    labelKey: 'org.f_telefon2', veu: 'tots', edita: 'tots' },

  // ------------------------------------------------------------------ Adreça
  { clau: 'direccion', columnes: { productores: 'direccion', entidades: 'direccion' }, bloc: 'adreca',
    labelKey: 'f.direccion', veu: 'tots', edita: 'tots' },
  { clau: 'codigo_postal', columnes: { productores: 'codigo_postal', entidades: 'codigo_postal' }, bloc: 'adreca',
    tipus: 'cp', labelKey: 'f.codigo_postal', veu: 'tots', edita: 'tots' },
  // La población ES el municipio (20270505100000): se elige de la lista oficial y el trigger
  // `*_municipi` escribe `poblacion` con su nombre. Lo que no es un municipio va a Ubicació.
  { clau: 'municipio_ine', columnes: { productores: 'municipio_ine', entidades: 'municipio_ine' }, bloc: 'adreca',
    tipus: 'municipi', labelKey: 'f.poblacion', ajudaKey: 'org.h_poblacio', veu: 'tots', edita: 'tots' },
  // La comarca: sale sola al elegir la población y se puede cambiar.
  { clau: 'area_geografica', columnes: { productores: 'area_geografica', entidades: 'area_geografica' }, bloc: 'adreca',
    tipus: 'comarca', labelKey: 'org.f_area', ajudaKey: 'org.h_area', veu: 'tots', edita: 'tots' },
  { clau: 'ubicacio', columnes: { productores: 'ubicacio', entidades: 'ubicacio' }, bloc: 'adreca',
    labelKey: 'org.f_ubicacio', ajudaKey: 'org.h_ubicacio', veu: 'tots', edita: 'tots', maxim: 120 },

  // ------------------------------------------------------------------ Ofertant
  { clau: 'productos_habituales', columnes: { productores: 'productos_habituales' }, bloc: 'ofertant', tipus: 'list',
    labelKey: 'f.productos_habituales', veu: 'tots', edita: 'equip', ample: 'full' },

  // ------------------------------------------------------------------ Receptor
  // Decide qué ofertas ve en el Mercat (§4bis): lo fija el equipo, el actor lo ve.
  { clau: 'tipo_receptor', columnes: { entidades: 'tipo_receptor' }, bloc: 'receptor', tipus: 'select',
    opcions: ['social', 'animal', 'transformador', 'comercial'], etiquetaOpcio: 'org.tr_',
    labelKey: 'f.tipo_receptor', veu: 'tots', edita: 'equip' },
  { clau: 'modalitats_interes', columnes: { entidades: 'modalitats_interes' }, bloc: 'receptor', tipus: 'xips_modalitats',
    labelKey: 'org.f_modalitats_interes', ajudaKey: 'org.h_modalitats_interes', veu: 'tots', edita: 'tots', ample: 'full' },
  { clau: 'horario', columnes: { entidades: 'horario' }, bloc: 'receptor',
    labelKey: 'org.f_horari', veu: 'tots', edita: 'tots' },
  { clau: 'calendari_repartiment', columnes: { entidades: 'calendari_repartiment' }, bloc: 'receptor',
    labelKey: 'f.calendari_repartiment', veu: 'tots', edita: 'tots' },
  // La logística (P5): es suya, la edita.
  { clau: 'productes_frescos', columnes: { entidades: 'productes_frescos' }, bloc: 'receptor', tipus: 'boolnull',
    labelKey: 'f.productes_frescos', veu: 'tots', edita: 'tots' },
  { clau: 'productes_frescos_txt', columnes: { entidades: 'productes_frescos_txt' }, bloc: 'receptor',
    labelKey: 'f.productes_frescos_txt', veu: 'tots', edita: 'tots' },
  { clau: 'transport_plataforma', columnes: { entidades: 'transport_plataforma' }, bloc: 'receptor', tipus: 'boolnull',
    labelKey: 'f.transport_plataforma', veu: 'tots', edita: 'tots' },
  { clau: 'transport_plataforma_txt', columnes: { entidades: 'transport_plataforma_txt' }, bloc: 'receptor',
    labelKey: 'f.transport_plataforma_txt', veu: 'tots', edita: 'tots' },
  { clau: 'descarrega_toro', columnes: { entidades: 'descarrega_toro' }, bloc: 'receptor', tipus: 'boolnull',
    labelKey: 'f.descarrega_toro', veu: 'tots', edita: 'tots' },
  { clau: 'descarrega_toro_txt', columnes: { entidades: 'descarrega_toro_txt' }, bloc: 'receptor',
    labelKey: 'f.descarrega_toro_txt', veu: 'tots', edita: 'tots' },
  // El contacto SECUNDARIO: un dato de la ficha, no una persona con acceso (D3).
  { clau: 'contacto2', columnes: { entidades: 'contacto2' }, bloc: 'receptor',
    labelKey: 'ef.f_contacte2', ajudaKey: 'ef.h_contacte2', veu: 'tots', edita: 'tots' },
  { clau: 'telefono3', columnes: { entidades: 'telefono3' }, bloc: 'receptor', tipus: 'tel',
    labelKey: 'ef.f_telefon3', veu: 'tots', edita: 'tots' },
  { clau: 'email2', columnes: { entidades: 'email2' }, bloc: 'receptor', tipus: 'email',
    labelKey: 'ef.f_email2', veu: 'tots', edita: 'tots' },

  // ------------------------------------------------------------------ Gestió interna
  { clau: 'codigo', columnes: { productores: 'codigo', entidades: 'codigo' }, bloc: 'intern',
    labelKey: 'f.codigo', veu: 'equip', edita: 'equip' },
  { clau: 'data_alta', columnes: { productores: 'data_alta', entidades: 'data_alta' }, bloc: 'intern', tipus: 'data',
    labelKey: 'f.data_alta', veu: 'equip', edita: 'equip' },
  { clau: 'es_test', columnes: { productores: 'es_test', entidades: 'es_test' }, bloc: 'intern', tipus: 'bool',
    labelKey: 'f.es_test', veu: 'equip', edita: 'equip' },
  { clau: 'opt_in', columnes: { entidades: 'opt_in' }, bloc: 'intern', tipus: 'bool',
    labelKey: 'f.opt_in', veu: 'equip', edita: 'equip' },
  // Texto heredado del Excel (la nota del convenio en papel): `BadgeConveni` lo enseña como lo
  // que es, papel histórico que no habilita a operar.
  { clau: 'conveni_paper', columnes: { productores: 'conveni' }, bloc: 'intern',
    labelKey: 'f.conveni', veu: 'equip', edita: 'equip' },
  { clau: 'visitado', columnes: { productores: 'visitado' }, bloc: 'intern',
    labelKey: 'f.visitado', veu: 'equip', edita: 'equip' },
  { clau: 'familia', columnes: { entidades: 'familia' }, bloc: 'intern',
    labelKey: 'f.familia', veu: 'equip', edita: 'equip' },
  { clau: 'prioritat', columnes: { entidades: 'prioritat' }, bloc: 'intern', tipus: 'number',
    labelKey: 'f.prioritat', veu: 'equip', edita: 'equip' },
  { clau: 'estat_paper', columnes: { entidades: 'estat' }, bloc: 'intern',
    labelKey: 'f.estat', veu: 'equip', edita: 'equip' },
  { clau: 'gestio', columnes: { entidades: 'gestio' }, bloc: 'intern',
    labelKey: 'f.gestio', veu: 'equip', edita: 'equip' },
  { clau: 'modalitat_paper', columnes: { entidades: 'modalitat' }, bloc: 'intern', tipus: 'select',
    opcions: ['Donació', 'Transformació', 'Venda', 'Maquila', 'Altres'],
    labelKey: 'f.modalitat', veu: 'equip', edita: 'equip' },
  { clau: 'comentari', columnes: { productores: 'comentario', entidades: 'comentarios' }, bloc: 'intern',
    tipus: 'textarea', labelKey: 'f.comentario', veu: 'equip', edita: 'equip', ample: 'full' },
]

/**
 * Columnas que la ficha enseña y edita con un COMPONENTE propio, no con un campo:
 *   · `activo` → bloque «Rols» («Activa» / «Desactiva», por `activar_fitxa()`; el alta no lo
 *     manda y la columna toma su `default true`, que es lo que cierra la deuda §12.147);
 *   · `perfil_receptor` → `CampsPerfilReceptor` (el actor lo edita en «El meu perfil de
 *     recepció» por la misma RPC, de ahí que cuente como editable por el actor).
 */
export const GESTIONATS_PER_COMPONENT: Readonly<Record<Taula, readonly string[]>> = {
  productores: ['activo'],
  entidades: ['activo', 'perfil_receptor'],
}

/** Columnas que NO se enseñan en ninguna ficha, con el porqué. */
export const NO_ES_MOSTRA: Readonly<Record<Taula, readonly string[]>> = {
  productores: [
    'id', 'organizacion_id', 'created_at',
    'temporada', // la escribe el diagnóstico operativo (20270423100000); se ve en «Diagnòstic»
    'ref_externa', // origen de una ficha importada (ARA26:<hoja>:<fila>, 1E): trazabilidad, no un dato
    'poblacion', // el nombre del municipio, que escribe el trigger: se ve en el selector de «Població»
  ],
  entidades: ['id', 'organizacion_id', 'created_at', 'ref_externa', 'poblacion'],
}

/** Columnas que el actor puede escribir por su RPC, además de los campos `edita: 'tots'`. */
const EDITABLES_PER_COMPONENT: Readonly<Record<Taula, readonly string[]>> = {
  productores: [],
  entidades: ['perfil_receptor'],
}

/** Los campos de un bloque que ve esa voz, para una organización con esos papeles. */
export function campsDelBloc(
  bloc: Bloc, veu: Veu, rols: { ofertant: boolean; receptor: boolean },
): CampFitxa[] {
  return CAMPS_FITXA.filter((c) => c.bloc === bloc
    && (veu === 'equip' || c.veu === 'tots')
    && ((c.columnes.productores && rols.ofertant) || (c.columnes.entidades && rols.receptor)))
}

/** Los campos que tienen columna en una tabla (la ficha del actor, de un solo papel). */
export function campsDeTaula(taula: Taula, veu: Veu): CampFitxa[] {
  return CAMPS_FITXA.filter((c) => c.columnes[taula] && (veu === 'equip' || c.veu === 'tots'))
}

/** ¿Puede esta voz editar el campo? */
export function potEditar(c: CampFitxa, veu: Veu): boolean {
  return c.edita === 'tots' || (c.edita === 'equip' && veu === 'equip')
}

/**
 * Las columnas de una tabla que el actor puede escribir: tiene que coincidir con la lista
 * blanca de su RPC (`tests/campsFitxa.test.ts` lo comprueba contra el SQL).
 */
export function columnesEditablesActor(taula: Taula): string[] {
  const cols = CAMPS_FITXA.filter((c) => c.edita === 'tots' && c.columnes[taula]).map((c) => c.columnes[taula] as string)
  return [...cols, ...EDITABLES_PER_COMPONENT[taula]].sort()
}

/**
 * Los campos del ALTA de una entidad (plan 1, rebanada 1B): lo mínimo para crearla, con las
 * mismas claves que la ficha. Es exactamente lo que acepta la RPC `crear_entitat(p_dades)`
 * (`tests/campsFitxa.test.ts` lo compara con el SQL), que además recibe `rols` y `es_test`.
 * Lo demás se completa después en la ficha.
 */
export const CLAUS_ALTA: readonly string[] = [
  'nom_comercial', 'razon_social', 'nif', 'tipus_empresa', 'tipus_activitat',
  'persona_contacte', 'email', 'telefon',
  'direccion', 'codigo_postal', 'municipio_ine', 'ubicacio',
  'tipo_receptor',
]

/** Lo que el alta exige: nace activa (NIF y razón social, P9) y, si es receptor, su tipo. */
export const OBLIGATORIS_ALTA: readonly string[] = ['nom_comercial', 'razon_social', 'nif', 'tipo_receptor']

/** Los campos del alta de un bloque, para los papeles elegidos. */
export function campsAlta(bloc: Bloc, rols: { ofertant: boolean; receptor: boolean }): CampFitxa[] {
  return campsDelBloc(bloc, 'equip', rols).filter((c) => CLAUS_ALTA.includes(c.clau))
}

/** Todas las claves i18n que usa este módulo: para la prueba de cobertura. */
export function clausFitxa(): string[] {
  const claus = new Set<string>()
  for (const c of CAMPS_FITXA) {
    claus.add(c.labelKey)
    if (c.ajudaKey) claus.add(c.ajudaKey)
    if (c.etiquetaOpcio) for (const o of c.opcions ?? []) claus.add(`${c.etiquetaOpcio}${o}`)
  }
  return [...claus]
}

// ------------------------------------------------------------------ valores

/** Un valor normalizado para guardarlo: vacío → null, teléfonos solo dígitos, listas… */
export function normalitzaValor(c: CampFitxa, v: unknown): unknown {
  const tp = c.tipus ?? 'text'
  if (tp === 'list') {
    if (typeof v === 'string') {
      const arr = v.split(',').map((s) => s.trim()).filter(Boolean)
      return arr.length ? arr : null
    }
    return Array.isArray(v) && v.length ? v : null
  }
  if (tp === 'xips_activitat' || tp === 'xips_modalitats') return Array.isArray(v) ? v : []
  if (tp === 'number') return v == null || v === '' ? null : Number(v)
  if (tp === 'bool') return Boolean(v)
  if (tp === 'boolnull') return v == null || v === '' ? null : Boolean(v)
  if (tp === 'tel') {
    const s = String(v ?? '').replace(/\D/g, '')
    return s === '' ? null : s
  }
  if (tp === 'nif') {
    const s = String(v ?? '').toUpperCase().replace(/[\s.-]/g, '')
    return s === '' ? null : s
  }
  const s = typeof v === 'string' ? v.trim() : v
  return s === '' || s == null ? null : s
}

/** ¿Son el mismo valor, a efectos de «ha cambiado»? */
export function mateixValor(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  if (a == null && b == null) return true
  return a === b
}

/**
 * Con doble rol, el valor que se enseña de un campo común: el de la ficha de productor si lo
 * tiene, si no el de la entidad. Y, si las dos lo tienen y difieren, el OTRO valor, para
 * decirlo junto al campo en vez de pisarlo en silencio.
 */
export function valorComu(c: CampFitxa, prod: Record<string, unknown> | null, ent: Record<string, unknown> | null):
  { valor: unknown; altre?: { rol: 'ofertant' | 'receptor'; valor: unknown } } {
  const vp = c.columnes.productores && prod ? prod[c.columnes.productores] : undefined
  const ve = c.columnes.entidades && ent ? ent[c.columnes.entidades] : undefined
  const buit = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0)
  if (!buit(vp) && !buit(ve) && !mateixValor(vp, ve)) {
    return { valor: vp, altre: { rol: 'receptor', valor: ve } }
  }
  if (!buit(vp)) return { valor: vp }
  if (!buit(ve)) return { valor: ve }
  return { valor: vp === undefined ? ve : vp }
}
