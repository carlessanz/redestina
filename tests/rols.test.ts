// Quién ve qué panel: el contexto de sesión y el par ruta↔rol.
//
// POR QUÉ IMPORTA: desde el 31-07-2026 el panel activo **se deriva de la URL** y ya no es un
// `useState` (§6ter). Eso convirtió `rutaArrel` y `rolDeLaRuta` en un par inverso del que
// depende toda la navegación: si dejaran de serlo, `RoleGuard` denegaría la ruta a la que
// acaba de mandar, y el síntoma sería **una pantalla en blanco sin ningún error** —no un
// fallo ruidoso—. Y `rolDeLaRuta` compara el primer segmento ENTERO justamente porque un
// `startsWith` haría que una hipotética `/productors` (el listado del equipo, que nada impide
// que se mueva fuera de `/equip/`) se leyera como el panel del productor.
//
// El resto de la suite cubre lo que el menú unificado puso a un clic de distancia: el doble
// rol, que hasta esa fecha no tenía ninguna cuenta real y por eso escondía el conmutador roto.

import { describe, it, expect } from 'vitest'
import {
  mapejaContext,
  contextDegradat,
  rolInicial,
  rutaArrel,
  rolDeLaRuta,
  organitzacioActiva,
  type ContextCru,
  type Organitzacio,
  type Rol,
} from '../src/lib/rols'

const ROLS: Rol[] = ['intern', 'productor', 'receptor']

function org(tipo: 'productor' | 'entidad', id: string, nombre: string): Organitzacio {
  return { tipo, id, nombre, rol_org: 'titular', tipo_receptor: null, modalitat: null, poblacion: null }
}

function cru(parcial: Partial<ContextCru> = {}): ContextCru {
  return {
    user_id: 'u-1',
    email: 'algu@example.com',
    nombre: 'Algú',
    idioma: 'ca',
    activo: true,
    rol: null,
    roles_activos: true,
    es_intern: false,
    pot_aprovar: false,
    es_super_admin: false,
    vista_defecto: null,
    organizaciones: [],
    ...parcial,
  }
}

// ---------------------------------------------------------------------------
// mapejaContext: de la fila de la RPC al contexto que consume la interfaz
// ---------------------------------------------------------------------------
describe('mapejaContext', () => {
  it('una cuenta del equipo tiene el panel intern y ningún otro', () => {
    const ctx = mapejaContext(cru({ rol: 'admin', es_intern: true, pot_aprovar: true }))
    expect(ctx.rols).toEqual(['intern'])
    expect(ctx.esIntern).toBe(true)
    expect(ctx.potAprovar).toBe(true)
    expect(ctx.degradat).toBe(false)
  })

  it('una membresía de productor da el panel de productor', () => {
    const ctx = mapejaContext(cru({ organizaciones: [org('productor', 'p-1', 'Can Test')] }))
    expect(ctx.rols).toEqual(['productor'])
  })

  it('una membresía de entidad da el panel de receptor (tipo «entidad» → rol «receptor»)', () => {
    // El vocabulario cambia de lado: en la base la membresía es de tipo `entidad`; en la
    // interfaz el panel se llama `receptor`. Es el único sitio donde se traduce.
    const ctx = mapejaContext(cru({ organizaciones: [org('entidad', 'e-1', 'Rebost Test')] }))
    expect(ctx.rols).toEqual(['receptor'])
  })

  it('DOBLE ROL: productor y entidad a la vez, en ese orden', () => {
    // El orden no es cosmético: `rolInicial` cae en `rols[0]` cuando no hay preferencia,
    // así que decide qué panel se abre al entrar.
    const ctx = mapejaContext(cru({
      organizaciones: [org('entidad', 'e-1', 'Rebost'), org('productor', 'p-1', 'Finca')],
    }))
    expect(ctx.rols).toEqual(['productor', 'receptor'])
  })

  it('triple: equipo + productor + receptor', () => {
    const ctx = mapejaContext(cru({
      es_intern: true,
      rol: 'super_admin',
      es_super_admin: true,
      organizaciones: [org('productor', 'p-1', 'Finca'), org('entidad', 'e-1', 'Rebost')],
    }))
    expect(ctx.rols).toEqual(['intern', 'productor', 'receptor'])
  })

  it('varias fichas del mismo tipo no duplican el panel', () => {
    const ctx = mapejaContext(cru({
      organizaciones: [org('productor', 'p-1', 'Una'), org('productor', 'p-2', 'Altra')],
    }))
    expect(ctx.rols).toEqual(['productor'])
  })

  it('sin organizaciones ni rol, no hay ningún panel', () => {
    expect(mapejaContext(cru()).rols).toEqual([])
  })

  it('el idioma cae al català cuando la RPC lo devuelve nulo', () => {
    expect(mapejaContext(cru({ idioma: null })).idioma).toBe('ca')
    expect(mapejaContext(cru({ idioma: 'es' })).idioma).toBe('es')
  })

  it('sobrevive a una RPC antigua: sin organizaciones y sin las marcas de registro', () => {
    // La migración del registro público añadió `registre_pendent`/`registre_rebutjat`. Sin
    // ella llegan `undefined`, y el contexto tiene que decir `false`, no dejar pasar el
    // undefined a la interfaz (que enseñaría la pantalla de «pendent» a cualquiera).
    const viejo = cru()
    delete (viejo as Partial<ContextCru>).organizaciones
    const ctx = mapejaContext(viejo as ContextCru)
    expect(ctx.organitzacions).toEqual([])
    expect(ctx.registrePendent).toBe(false)
    expect(ctx.registreRebutjat).toBe(false)
  })

  it('distingue «esperando validación» de «rechazado», que llegan los dos sin organizaciones', () => {
    // Los dos casos son `organizaciones: []`: sin estas dos marcas la interfaz no podría
    // decirle a una persona que su alta está en curso y a la otra que no se aceptó.
    const pendent = mapejaContext(cru({ registre_pendent: true }))
    const rebutjat = mapejaContext(cru({ registre_rebutjat: true }))
    expect([pendent.rols, rebutjat.rols]).toEqual([[], []])
    expect(pendent.registrePendent).toBe(true)
    expect(pendent.registreRebutjat).toBe(false)
    expect(rebutjat.registreRebutjat).toBe(true)
    expect(rebutjat.registrePendent).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// contextDegradat: el fallback que NO puede montarse sin sesión
// ---------------------------------------------------------------------------
describe('contextDegradat', () => {
  // Es correcto dentro de la aplicación y catastrófico fuera: simula equipo interno, así que
  // `AppContextProvider` vive dentro de `RequireSessio` (§6quater). Lo que se fija aquí es
  // que sigue siendo exactamente eso —permisivo y marcado—, para que nadie lo «arregle»
  // dejándolo a medias sin darse cuenta de para qué sirve.
  it('se comporta como el equipo de siempre y se declara degradado', () => {
    const ctx = contextDegradat('u-9', 'algu@example.com')
    expect(ctx.degradat).toBe(true)
    expect(ctx.rols).toEqual(['intern'])
    expect(ctx.esIntern).toBe(true)
    expect(ctx.potAprovar).toBe(true)
    expect(ctx.esSuperAdmin).toBe(true)
  })

  it('no inventa ninguna organización ni ningún registro pendiente', () => {
    const ctx = contextDegradat('u-9', null)
    expect(ctx.organitzacions).toEqual([])
    expect(ctx.registrePendent).toBe(false)
    expect(ctx.registreRebutjat).toBe(false)
    expect(ctx.rolesActivos).toBe(false)
    expect(ctx.email).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// rolInicial
// ---------------------------------------------------------------------------
describe('rolInicial', () => {
  const dobleRol = mapejaContext(cru({
    organizaciones: [org('productor', 'p-1', 'Finca'), org('entidad', 'e-1', 'Rebost')],
  }))

  it('respeta la preferencia guardada cuando la cuenta tiene ese panel', () => {
    expect(rolInicial(dobleRol, 'receptor')).toBe('receptor')
  })

  it('ignora una preferencia a la que la cuenta ya no tiene acceso', () => {
    // Pasa de verdad: `localStorage` guarda `intern` de cuando la persona era del equipo, y
    // al retirarle el rol esa preferencia la mandaría a una ruta que `RoleGuard` deniega.
    expect(rolInicial(dobleRol, 'intern')).toBe('productor')
  })

  it('sin preferencia, el primero de sus paneles', () => {
    expect(rolInicial(dobleRol, null)).toBe('productor')
  })

  it('una cuenta sin ningún panel devuelve null', () => {
    expect(rolInicial(mapejaContext(cru()), null)).toBeNull()
    expect(rolInicial(mapejaContext(cru()), 'productor')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// El par inverso: la invariante de la que depende la navegación entera
// ---------------------------------------------------------------------------
describe('rutaArrel y rolDeLaRuta son un par inverso', () => {
  it.each(ROLS)('rolDeLaRuta(rutaArrel(%s)) devuelve el mismo rol', (rol) => {
    expect(rolDeLaRuta(rutaArrel(rol))).toBe(rol)
  })

  it('las tres raíces son distintas entre sí', () => {
    const rutas = ROLS.map(rutaArrel)
    expect(new Set(rutas).size).toBe(ROLS.length)
  })

  it('sin rol, la raíz es la pantalla de «sense accés», que no pertenece a ningún panel', () => {
    expect(rutaArrel(null)).toBe('/sense-acces')
    expect(rolDeLaRuta('/sense-acces')).toBeNull()
  })
})

describe('rolDeLaRuta', () => {
  it('reconoce una ruta profunda de cada panel', () => {
    expect(rolDeLaRuta('/equip/ofertes/123')).toBe('intern')
    expect(rolDeLaRuta('/productor/ofertes/nova')).toBe('productor')
    expect(rolDeLaRuta('/receptor/interessos')).toBe('receptor')
  })

  it('COMPARA EL SEGMENTO ENTERO: /productors no es el panel del productor', () => {
    // La razón de que no sea un `startsWith`. Un prefijo confundiría estas cuatro.
    expect(rolDeLaRuta('/productors')).toBeNull()
    expect(rolDeLaRuta('/productorX/inici')).toBeNull()
    expect(rolDeLaRuta('/equipo/tauler')).toBeNull()
    expect(rolDeLaRuta('/receptors/mercat')).toBeNull()
  })

  it('las rutas que no son de ningún panel devuelven null', () => {
    expect(rolDeLaRuta('/panell')).toBeNull()
    expect(rolDeLaRuta('/')).toBeNull()
    expect(rolDeLaRuta('')).toBeNull()
    expect(rolDeLaRuta('/login')).toBeNull()
    expect(rolDeLaRuta('/registre')).toBeNull()
  })

  it('es sensible a mayúsculas: /Equip no es el panel del equipo', () => {
    expect(rolDeLaRuta('/Equip/tauler')).toBeNull()
  })

  it('la raíz de un panel sin subruta también se reconoce', () => {
    expect(rolDeLaRuta('/equip')).toBe('intern')
    expect(rolDeLaRuta('/productor/')).toBe('productor')
  })
})

// ---------------------------------------------------------------------------
// organitzacioActiva
// ---------------------------------------------------------------------------
describe('organitzacioActiva', () => {
  const dobleRol = mapejaContext(cru({
    organizaciones: [org('productor', 'p-1', 'Finca'), org('entidad', 'e-1', 'Rebost')],
  }))

  it('DOBLE ROL: cada panel resuelve su propia ficha, no la del panel de al lado', () => {
    // Esto es exactamente lo que se rompió con el perfil compartido entre
    // `/productor/perfil` y `/receptor/perfil`: la pantalla cambiaba de campos pero seguía
    // leyendo la fila anterior, y «Desar» sobrescribía la ficha equivocada.
    expect(organitzacioActiva(dobleRol, 'productor')?.id).toBe('p-1')
    expect(organitzacioActiva(dobleRol, 'receptor')?.id).toBe('e-1')
  })

  it('el panel del equipo no tiene organización propia', () => {
    expect(organitzacioActiva(dobleRol, 'intern')).toBeNull()
    expect(organitzacioActiva(dobleRol, null)).toBeNull()
  })

  it('devuelve null cuando la cuenta no tiene ficha de ese tipo', () => {
    const soloProductor = mapejaContext(cru({ organizaciones: [org('productor', 'p-1', 'Finca')] }))
    expect(organitzacioActiva(soloProductor, 'receptor')).toBeNull()
  })

  it('con dos fichas del mismo tipo se queda con la primera (deuda §12.31)', () => {
    // No es una preferencia: `find` hace que la segunda sea **inalcanzable** desde la
    // interfaz, porque el id no viaja en la URL. Se fija aquí para que el día que se
    // arregle (`/productor/:orgId/…`) este test falle y obligue a mirarlo.
    const dos = mapejaContext(cru({
      organizaciones: [org('productor', 'p-1', 'Primera'), org('productor', 'p-2', 'Segona')],
    }))
    expect(organitzacioActiva(dos, 'productor')?.id).toBe('p-1')
  })
})
