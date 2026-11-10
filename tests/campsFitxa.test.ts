// La definición única de campos de la ficha (plan 1, rebanada 1C, D8).
//
// POR QUÉ MERECE PRUEBA. La subtarea 1.6 («la ficha del equipo y la del actor no coinciden»)
// era un bug de dos listas que se separaron con el tiempo. Ahora hay una, y esta prueba es
// lo que impide que vuelva a pasar por otra vía: una columna nueva sin clasificar, una
// columna que la RPC del actor admite y la ficha no enseña (o al revés), o una etiqueta que
// existe en un idioma y no en el otro. Ninguna de las tres la ve el compilador.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  BLOCS, CAMPS_FITXA, CLAUS_ALTA, GESTIONATS_PER_COMPONENT, NO_ES_MOSTRA, OBLIGATORIS_ALTA, campsAlta,
  campsDelBloc, campsDeTaula,
  clausFitxa, columnesEditablesActor, mateixValor, normalitzaValor, rolDe, valorComu,
  type CampFitxa, type Taula,
} from '../src/lib/campsFitxa'
import { DICTS } from '../src/lib/i18n'

const RAIZ = new URL('..', import.meta.url).pathname

/**
 * Las columnas REALES de las dos tablas, a mano y en el orden de `information_schema`
 * (clon, 02-11-2026, tras `20270503100000`). Si una migración añade una columna, hay que
 * añadirla aquí y clasificarla en `campsFitxa.ts`: ese es el punto.
 */
const COLUMNES: Record<Taula, string[]> = {
  productores: [
    'id', 'name', 'email', 'phone', 'created_at', 'empresa', 'codigo', 'comentario', 'visitado', 'conveni',
    'tipo_empresa', 'telefono_alt', 'direccion', 'codigo_postal', 'nif', 'area_geografica', 'poblacion',
    'productos_habituales', 'data_alta', 'activo', 'es_test', 'organizacion_id', 'razon_social', 'municipio_ine',
    'tipus_activitat', 'temporada', 'ref_externa', 'ubicacio',
    // 20270517100000: datos fiscales y de facturación (Taula mestra, Fundació 09-11-2026).
    'regim_iva', 'domicili_fiscal', 'codi_postal_fiscal', 'poblacio_fiscal', 'contacte_facturacio_nom', 'contacte_facturacio_email',
    // 20270518100000 (Plan 2, B1): estado CRM por papel.
    'estat_crm',
  ],
  entidades: [
    'id', 'nombre', 'codigo', 'familia', 'prioritat', 'estat', 'gestio', 'comentarios', 'area_geografica',
    'poblacion', 'direccion', 'codigo_postal', 'horario', 'nif', 'telefono', 'telefono2', 'telefono3', 'email',
    'email2', 'contacto', 'contacto2', 'calendari_repartiment', 'productes_frescos', 'productes_frescos_txt',
    'transport_plataforma', 'transport_plataforma_txt', 'descarrega_toro', 'descarrega_toro_txt', 'data_alta',
    'opt_in', 'created_at', 'modalitat', 'es_test', 'tipo_receptor', 'organizacion_id', 'razon_social',
    'municipio_ine', 'tipo_entidad', 'perfil_receptor', 'tipus_activitat', 'modalitats_interes', 'activo',
    'ref_externa', 'ubicacio',
    // 20270517100000: datos fiscales y de facturación (Taula mestra, Fundació 09-11-2026).
    'regim_iva', 'domicili_fiscal', 'codi_postal_fiscal', 'poblacio_fiscal', 'contacte_facturacio_nom', 'contacte_facturacio_email',
    // 20270518100000 (Plan 2, B1): estado CRM por papel.
    'estat_crm',
  ],
}

/** Cómo clasifica `campsFitxa.ts` cada columna de una tabla: una lista con repeticiones si las hay. */
function classificacio(taula: Taula): string[] {
  return [
    ...CAMPS_FITXA.flatMap((c) => (c.columnes[taula] ? [c.columnes[taula] as string] : [])),
    ...GESTIONATS_PER_COMPONENT[taula],
    ...NO_ES_MOSTRA[taula],
  ]
}

/**
 * Las claves `d ? 'xxx'` de la ÚLTIMA definición de una RPC en `supabase/migrations/`: la
 * lista blanca de lo que el actor puede escribir. Se lee el SQL como texto, igual que
 * `cobertura.test.ts` lee el router: importar nada no haría falta y montar una base, menos.
 */
function llistaBlancaRpc(nom: string, patro = /d \? '([a-z_0-9]+)'/g): string[] {
  const dir = join(RAIZ, 'supabase', 'migrations')
  const fitxers = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const re = new RegExp(`create or replace function public\\.${nom}\\s*\\(`, 'i')
  let ultim: string | null = null
  for (const f of fitxers) {
    if (re.test(readFileSync(join(dir, f), 'utf8'))) ultim = f
  }
  if (!ultim) throw new Error(`no hi ha cap migració que defineixi ${nom}`)
  const sql = readFileSync(join(dir, ultim), 'utf8')
  const inici = sql.search(re)
  const cos = sql.slice(inici)
  const fi = cos.indexOf('$$;', cos.indexOf('$$') + 2)
  const funcio = cos.slice(0, fi)
  const claus = new Set<string>()
  for (const m of funcio.matchAll(patro)) claus.add(m[1])
  return [...claus].sort()
}

describe('campsFitxa: cobertura de las columnas', () => {
  for (const taula of ['productores', 'entidades'] as const) {
    it(`cada columna de ${taula} está clasificada una sola vez`, () => {
      const cls = classificacio(taula)
      const sense = COLUMNES[taula].filter((col) => !cls.includes(col))
      expect(sense, `columnes de ${taula} sense classificar: ${sense.join(', ')}`).toEqual([])
      const repetides = cls.filter((col, i) => cls.indexOf(col) !== i)
      expect(repetides, `columnes de ${taula} classificades dues vegades: ${repetides.join(', ')}`).toEqual([])
      const inventades = cls.filter((col) => !COLUMNES[taula].includes(col))
      expect(inventades, `columnes que ${taula} no té: ${inventades.join(', ')}`).toEqual([])
    })
  }

  it('las claves de campo son únicas y cada campo tiene al menos una columna', () => {
    const claus = CAMPS_FITXA.map((c) => c.clau)
    expect(new Set(claus).size).toBe(claus.length)
    for (const c of CAMPS_FITXA) expect(Object.keys(c.columnes).length, c.clau).toBeGreaterThan(0)
  })

  it('un campo que el actor ve y nadie edita es un derivado; uno que solo ve el equipo no lo edita el actor', () => {
    for (const c of CAMPS_FITXA) {
      if (c.veu === 'equip') expect(c.edita, `${c.clau}: el actor no lo ve, así que no puede editarlo`).not.toBe('tots')
    }
    // Desde 20270505100000 la población es el municipio elegido y el área se edita: no queda
    // ningún campo derivado que se enseñe sin poder tocarse. Lo único de solo lectura es la fecha
    // de sistema «Alta a la plataforma» (`created_at`, B4), que solo ve el equipo.
    expect(CAMPS_FITXA.filter((c) => c.edita === 'ningu').map((c) => c.clau)).toEqual(['alta_plataforma'])
    const alta = CAMPS_FITXA.find((c) => c.clau === 'alta_plataforma')!
    expect(alta).toMatchObject({ columnes: { productores: 'created_at', entidades: 'created_at' }, veu: 'equip', bloc: 'intern', tipus: 'data' })
    // Nunca entra en lo que se escribe: ni el actor ni el equipo.
    for (const taula of ['productores', 'entidades'] as const) expect(columnesEditablesActor(taula)).not.toContain('created_at')
  })

  it('rolDe: común si tiene columna en las dos tablas', () => {
    const per = Object.fromEntries(CAMPS_FITXA.map((c) => [c.clau, rolDe(c)]))
    expect(per.nom_comercial).toBe('ambdos')
    expect(per.productos_habituales).toBe('ofertant')
    expect(per.tipo_receptor).toBe('receptor')
  })
})

describe('campsFitxa: paridad con las RPC del actor (1.6)', () => {
  it('actualitzar_fitxa_productor acepta exactamente lo que el actor puede editar', () => {
    expect(llistaBlancaRpc('actualitzar_fitxa_productor')).toEqual(columnesEditablesActor('productores'))
  })
  it('actualitzar_fitxa_entitat acepta exactamente lo que el actor puede editar', () => {
    expect(llistaBlancaRpc('actualitzar_fitxa_entitat')).toEqual(columnesEditablesActor('entidades'))
  })
})

// 1B (20270501300000): el alta lee `d->>'clau'` / `d->'clau'` / `d ? 'clau'` con las claves
// de la ficha. Si se añade un campo al alta en un lado y no en el otro, esto falla.
describe('campsFitxa: el alta y crear_entitat() (1B)', () => {
  it('crear_entitat acepta exactamente los campos del alta, más rols y es_test', () => {
    const claus = llistaBlancaRpc('crear_entitat', /\bd(?:->>|->| \? )'([a-z_0-9]+)'/g)
    expect(claus).toEqual([...CLAUS_ALTA, 'rols', 'es_test'].sort())
  })
  it('cada campo del alta existe en la ficha y lo edita el equipo', () => {
    for (const k of CLAUS_ALTA) {
      const c = CAMPS_FITXA.find((x) => x.clau === k)
      expect(c, k).toBeDefined()
      expect(c?.edita, k).not.toBe('ningu')
    }
    for (const k of OBLIGATORIS_ALTA) expect(CLAUS_ALTA, k).toContain(k)
  })
  it('campsAlta solo da el tipo de receptor si es receptor', () => {
    const ofertant = campsAlta('receptor', { ofertant: true, receptor: false }).map((c) => c.clau)
    expect(ofertant).toEqual([])
    const receptor = campsAlta('receptor', { ofertant: false, receptor: true }).map((c) => c.clau)
    expect(receptor).toEqual(['tipo_receptor'])
    expect(campsAlta('identitat', { ofertant: true, receptor: true }).map((c) => c.clau))
      .toEqual(['nom_comercial', 'razon_social', 'nif', 'tipus_empresa', 'tipus_activitat'])
  })
})

describe('campsFitxa: etiquetas en los dos idiomas', () => {
  it('toda clave existe en ca y en es', () => {
    const claus = clausFitxa()
    expect(claus.length).toBeGreaterThan(30)
    for (const clau of claus) {
      expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
      expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
    }
  })
})

describe('campsFitxa: selección por bloque, voz y papel', () => {
  it('el actor no ve el bloque interno', () => {
    expect(campsDelBloc('intern', 'tots', { ofertant: true, receptor: true })).toEqual([])
    expect(campsDelBloc('intern', 'equip', { ofertant: true, receptor: true }).length).toBeGreaterThan(5)
  })
  it('una organización solo receptora no ve los campos del ofertante', () => {
    expect(campsDelBloc('ofertant', 'equip', { ofertant: false, receptor: true })).toEqual([])
    expect(campsDelBloc('identitat', 'equip', { ofertant: false, receptor: true }).map((c) => c.clau))
      .toContain('nom_comercial')
  })
  it('campsDeTaula da los campos con columna en esa tabla', () => {
    const claus = campsDeTaula('productores', 'tots').map((c) => c.clau)
    expect(claus).toContain('telefon2')
    expect(claus).not.toContain('horario')
    expect(claus).not.toContain('codigo')
  })
  it('los bloques declarados son los que se pintan', () => {
    const usats = new Set(CAMPS_FITXA.map((c) => c.bloc))
    for (const b of usats) expect(BLOCS).toContain(b)
  })
})

describe('campsFitxa: valores', () => {
  const camp = (tipus?: CampFitxa['tipus']): CampFitxa => ({
    clau: 'x', columnes: { productores: 'x' }, bloc: 'intern', labelKey: 'f.nif', veu: 'equip', edita: 'equip', tipus,
  })
  it('normaliza vacíos a null, teléfonos a dígitos y el NIF a mayúsculas', () => {
    expect(normalitzaValor(camp(), '  ')).toBeNull()
    expect(normalitzaValor(camp('tel'), '+34 600 00 00 00')).toBe('34600000000')
    expect(normalitzaValor(camp('nif'), ' b-12345678 ')).toBe('B12345678')
    expect(normalitzaValor(camp('list'), 'poma, pera, ')).toEqual(['poma', 'pera'])
    expect(normalitzaValor(camp('list'), '')).toBeNull()
    expect(normalitzaValor(camp('boolnull'), '')).toBeNull()
    expect(normalitzaValor(camp('bool'), undefined)).toBe(false)
    expect(normalitzaValor(camp('number'), '3')).toBe(3)
    expect(normalitzaValor(camp('xips_modalitats'), undefined)).toEqual([])
  })
  it('mateixValor compara listas por contenido', () => {
    expect(mateixValor(['a'], ['a'])).toBe(true)
    expect(mateixValor(['a'], ['b'])).toBe(false)
    expect(mateixValor(null, undefined)).toBe(true)
    expect(mateixValor('a', null)).toBe(false)
  })
  it('valorComu prefiere la ficha de productor y avisa si la de entidad dice otra cosa', () => {
    const c = CAMPS_FITXA.find((x) => x.clau === 'nom_comercial') as CampFitxa
    expect(valorComu(c, { empresa: 'Mas' }, { nombre: 'Mas' })).toEqual({ valor: 'Mas' })
    expect(valorComu(c, { empresa: null }, { nombre: 'Obrador' })).toEqual({ valor: 'Obrador' })
    expect(valorComu(c, { empresa: 'Mas' }, { nombre: 'Obrador' })).toEqual({ valor: 'Mas', altre: { rol: 'receptor', valor: 'Obrador' } })
    expect(valorComu(c, { empresa: 'Mas' }, null)).toEqual({ valor: 'Mas' })
  })
  it('«Alta a la plataforma» con doble rol: la más antigua de las dos fichas, sin discrepancia', () => {
    const c = CAMPS_FITXA.find((x) => x.clau === 'alta_plataforma') as CampFitxa
    const antiga = '2026-07-30T10:00:00.123+00:00'
    const nova = '2026-09-01T08:00:00+00:00'
    expect(valorComu(c, { created_at: nova }, { created_at: antiga })).toEqual({ valor: antiga })
    expect(valorComu(c, { created_at: antiga }, { created_at: nova })).toEqual({ valor: antiga })
    expect(valorComu(c, null, { created_at: nova })).toEqual({ valor: nova })
  })
})
