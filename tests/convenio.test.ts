// El convenio como datos: tipo, fechas, domicilio, código de verificación y avisos.
//
// Por qué este módulo no importa nada y por qué eso obliga a probarlo aparte: el convenio
// tiene DOS salidas que están obligadas a decir lo mismo —el PDF que se archiva
// (`render/conv.ts`) y la página de firma (`enlace-publico`), que enseña el texto y guarda
// su sha256 en `evidencias.sha256_texto`—. Si cada una compusiera por su cuenta, la huella
// describiría una redacción y el papel otra, y la firma dejaría de acreditar qué se firmó.
// Estas funciones son las piezas que las dos comparten.
//
// Lo que cada una se juega:
//   · `tipoConvenio` decide QUÉ modelo se firma. Cae a `don_gen` ante cualquier valor raro,
//     así que un error aquí no rompe: firma otra cosa.
//   · `fechaLargaConvenio` imprime la fecha del convenio. El `d'` ante vocal no es estética:
//     un documento legal con «de abril» en un texto catalán se lee como una chapuza.
//   · `codigoVerificacionConvenio` es lo que una persona teclea o compara para verificar
//     un documento; su agrupación tiene que ser estable.
//   · `esPlantillaProvisional` es lo que dispara la filigrana de «sense valor contractual»
//     en TODAS las páginas. Si devolviera false por error, saldría a firmar un texto que la
//     asesoría jurídica no ha validado (deuda §12.77).

import { describe, it, expect } from 'vitest'
import {
  tipoConvenio,
  diccionarioConvenio,
  fechaLargaConvenio,
  fechaHoraConvenio,
  codigoVerificacionConvenio,
  domicilioConvenio,
  esPlantillaProvisional,
  tituloSinMarca,
  rolesEnTexto,
} from '../supabase/functions/_shared/pdf/convenio.ts'

const CA = diccionarioConvenio('ca')
const ES = diccionarioConvenio('es')

describe('tipoConvenio', () => {
  it('reconoce los tres modelos', () => {
    expect(tipoConvenio('don_gen')).toBe('don_gen')
    expect(tipoConvenio('don_rec')).toBe('don_rec')
    expect(tipoConvenio('com')).toBe('com')
  })

  // Caer a `don_gen` es la decisión segura: el convenio del generador es el más común y
  // no concede nada que los otros no concedan. Devolver undefined reventaría el render.
  it('cualquier otra cosa cae a don_gen', () => {
    for (const v of [null, undefined, '', 'donacio', 'DON_REC', 42, {}, []]) {
      expect(tipoConvenio(v)).toBe('don_gen')
    }
  })

  it('los tres tipos tienen subtítulo y modelo en los dos idiomas', () => {
    for (const t of ['don_gen', 'don_rec', 'com'] as const) {
      expect(CA.subtitulo[t]).toBeTruthy()
      expect(CA.modelo[t]).toBeTruthy()
      expect(ES.subtitulo[t]).toBeTruthy()
      expect(ES.modelo[t]).toBeTruthy()
    }
  })
})

describe('fechaLargaConvenio · català y el apóstrofo', () => {
  it('mes que empieza por consonante: «de»', () => {
    expect(fechaLargaConvenio('2027-01-11', CA, 'ca')).toBe('11 de gener de 2027')
    expect(fechaLargaConvenio('2027-06-03', CA, 'ca')).toBe('3 de juny de 2027')
    expect(fechaLargaConvenio('2027-12-24', CA, 'ca')).toBe('24 de desembre de 2027')
  })

  // Los cuatro meses catalanes que empiezan por vocal, uno a uno. Es la regla que la
  // cabecera de la función destaca, y la única forma de comprobarla es enumerarlos.
  it('mes que empieza por vocal: «d\'» pegado, sin espacio', () => {
    expect(fechaLargaConvenio('2027-04-01', CA, 'ca')).toBe("1 d'abril de 2027")
    expect(fechaLargaConvenio('2027-08-15', CA, 'ca')).toBe("15 d'agost de 2027")
    expect(fechaLargaConvenio('2027-10-31', CA, 'ca')).toBe("31 d'octubre de 2027")
  })

  it('los doce meses catalanes eligen bien la preposición', () => {
    const esperado = [
      'de gener', 'de febrer', 'de març', "d'abril", 'de maig', 'de juny',
      'de juliol', "d'agost", 'de setembre', "d'octubre", 'de novembre', 'de desembre',
    ]
    esperado.forEach((frag, i) => {
      const mes = String(i + 1).padStart(2, '0')
      expect(fechaLargaConvenio(`2027-${mes}-05`, CA, 'ca')).toBe(`5 ${frag} de 2027`)
    })
  })
})

describe('fechaLargaConvenio · castellano y los bordes', () => {
  // En castellano nunca hay apóstrofo: «1 de abril», con «de» y espacio, aunque el mes
  // empiece por vocal. La regla del `d'` es exclusivamente catalana.
  it('el castellano no apostrofa nunca', () => {
    expect(fechaLargaConvenio('2027-04-01', ES, 'es')).toBe('1 de abril de 2027')
    expect(fechaLargaConvenio('2027-08-15', ES, 'es')).toBe('15 de agosto de 2027')
    expect(fechaLargaConvenio('2027-01-11', ES, 'es')).toBe('11 de enero de 2027')
  })

  it('no pone cero delante del día', () => {
    expect(fechaLargaConvenio('2027-03-05', CA, 'ca')).toBe('5 de març de 2027')
  })

  it('acepta un timestamp completo y se queda con la fecha', () => {
    expect(fechaLargaConvenio('2027-01-11T09:30:00Z', CA, 'ca')).toBe('11 de gener de 2027')
  })

  // Sin fecha, cadena vacía: en un documento, un hueco es mejor que un «Invalid Date».
  it('lo que no es una fecha no inventa nada', () => {
    expect(fechaLargaConvenio(null, CA, 'ca')).toBe('')
    expect(fechaLargaConvenio(undefined, CA, 'ca')).toBe('')
    expect(fechaLargaConvenio('', CA, 'ca')).toBe('')
    expect(fechaLargaConvenio(12345, CA, 'ca')).toBe('')
  })

  it('un texto que no tiene forma de fecha se devuelve tal cual', () => {
    expect(fechaLargaConvenio('pendent', CA, 'ca')).toBe('pendent')
    expect(fechaLargaConvenio('11/01/2027', CA, 'ca')).toBe('11/01/2027')
  })
})

describe('fechaHoraConvenio · siempre en hora de Madrid', () => {
  // Es la hora que se imprime en la página de evidencias: cuándo firmó esa persona. Si
  // saliera en el huso del servidor, una firma de las 00:30 de Madrid aparecería fechada
  // el día anterior, y la evidencia contradiría al resto del documento.
  //
  // La comparación tolera el separador entre fecha y hora porque lo pone ICU y no el
  // código: Node y Deno no lo escriben igual (uno con coma —que la función cambia por
  // «·»— y otro con un espacio). Lo que se comprueba es el instante, que es lo que
  // depende de nosotros.
  it('invierno: UTC+1', () => {
    expect(fechaHoraConvenio('2027-01-11T09:30:00Z')).toMatch(/^11\/01\/2027[\s·]+10:30$/)
  })

  it('verano: UTC+2', () => {
    expect(fechaHoraConvenio('2027-07-11T09:30:00Z')).toMatch(/^11\/07\/2027[\s·]+11:30$/)
  })

  // El caso que de verdad justifica fijar el huso: en Madrid ya es el día siguiente.
  it('el cambio de día se resuelve en Madrid, no en UTC', () => {
    expect(fechaHoraConvenio('2027-01-11T23:30:00Z')).toMatch(/^12\/01\/2027[\s·]+00:30$/)
  })

  it('día, mes y hora van a dos cifras', () => {
    expect(fechaHoraConvenio('2027-03-05T07:05:00Z')).toMatch(/^05\/03\/2027[\s·]+08:05$/)
  })

  it('lo que no es una fecha válida no revienta', () => {
    expect(fechaHoraConvenio(null)).toBe('')
    expect(fechaHoraConvenio('')).toBe('')
    expect(fechaHoraConvenio(42)).toBe('')
    expect(fechaHoraConvenio('pendent')).toBe('pendent')
  })
})

describe('codigoVerificacionConvenio', () => {
  const sha = 'a3f5b9c1d2e4f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f'

  it('16 hex del sha, en mayúsculas y en grupos de cuatro', () => {
    expect(codigoVerificacionConvenio(sha)).toBe('A3F5-B9C1-D2E4-F607')
  })

  it('el mismo sha da siempre el mismo código', () => {
    expect(codigoVerificacionConvenio(sha)).toBe(codigoVerificacionConvenio(sha))
  })

  it('sha distintos dan códigos distintos', () => {
    expect(codigoVerificacionConvenio(sha))
      .not.toBe(codigoVerificacionConvenio('b3f5b9c1d2e4f607' + sha.slice(16)))
  })

  // Lo que no es hexadecimal se descarta antes de contar, así que un código ya agrupado
  // (o pegado con espacios desde un correo) vuelve a dar el mismo código. Es lo que
  // permite comparar lo que alguien teclea con lo que el PDF imprime.
  it('tolera mayúsculas, guiones y espacios en la entrada', () => {
    expect(codigoVerificacionConvenio('A3F5-B9C1-D2E4-F607')).toBe('A3F5-B9C1-D2E4-F607')
    expect(codigoVerificacionConvenio('a3f5 b9c1 d2e4 f607')).toBe('A3F5-B9C1-D2E4-F607')
    expect(codigoVerificacionConvenio('a3f5b9c1d2e4f607-zzzz')).toBe('A3F5-B9C1-D2E4-F607')
  })

  it('trunca a 16 hex aunque el sha entero sea de 64', () => {
    expect(codigoVerificacionConvenio(sha).replace(/-/g, '')).toHaveLength(16)
  })

  // La raya em dash es el hueco visible: un documento sin código lo dice, no deja el sitio
  // en blanco como si nadie se hubiera acordado de imprimirlo.
  it('sin sha imprime una raya, no un vacío', () => {
    expect(codigoVerificacionConvenio(null)).toBe('—')
    expect(codigoVerificacionConvenio(undefined)).toBe('—')
    expect(codigoVerificacionConvenio('')).toBe('—')
  })

  it('un sha más corto que 16 hex se agrupa igual, sin rellenar', () => {
    expect(codigoVerificacionConvenio('a3f5b9')).toBe('A3F5-B9')
  })
})

describe('domicilioConvenio', () => {
  it('domicilio, CP y población', () => {
    expect(domicilioConvenio({
      domicili: 'Carrer de Prova, 1',
      codi_postal: '08850',
      poblacio: 'Gavà',
    })).toBe('Carrer de Prova, 1 · 08850 Gavà')
  })

  // «Los huecos no dejan rastro»: lo que falta desaparece, sin separadores colgando ni
  // comas huérfanas. Es lo que evita imprimir «Carrer de Prova, 1 ·  » en un convenio.
  it('sin código postal no queda un espacio de más', () => {
    expect(domicilioConvenio({ domicili: 'Carrer de Prova, 1', poblacio: 'Gavà' }))
      .toBe('Carrer de Prova, 1 · Gavà')
  })

  it('sin domicilio no queda el punto volado delante', () => {
    expect(domicilioConvenio({ codi_postal: '08850', poblacio: 'Gavà' })).toBe('08850 Gavà')
  })

  it('solo con domicilio, solo el domicilio', () => {
    expect(domicilioConvenio({ domicili: 'Carrer de Prova, 1' })).toBe('Carrer de Prova, 1')
  })

  it('los campos en blanco cuentan como ausentes', () => {
    expect(domicilioConvenio({ domicili: '   ', codi_postal: '', poblacio: 'Gavà' })).toBe('Gavà')
  })

  it('sin organización, cadena vacía', () => {
    expect(domicilioConvenio(null)).toBe('')
    expect(domicilioConvenio(undefined)).toBe('')
    expect(domicilioConvenio({})).toBe('')
  })
})

describe('esPlantillaProvisional · la filigrana de «sin valor contractual»', () => {
  it('reconoce la marca del seed en los dos idiomas', () => {
    expect(esPlantillaProvisional('[ESBORRANY] Conveni de donació')).toBe(true)
    expect(esPlantillaProvisional('[BORRADOR] Convenio de donación')).toBe(true)
  })

  it('no le importan las mayúsculas ni los espacios de dentro de los corchetes', () => {
    expect(esPlantillaProvisional('[esborrany] Conveni')).toBe(true)
    expect(esPlantillaProvisional('[ Esborrany ] Conveni')).toBe(true)
    expect(esPlantillaProvisional('  [BORRADOR] Convenio')).toBe(true)
  })

  // La marca tiene que ir DELANTE. Un título que mencione la palabra por el medio no es
  // una plantilla provisional, y tratarlo como tal pondría filigrana a un convenio bueno.
  it('solo cuenta si va al principio', () => {
    expect(esPlantillaProvisional('Conveni [ESBORRANY]')).toBe(false)
    expect(esPlantillaProvisional('Esborrany de conveni')).toBe(false)
  })

  it('un título validado no lleva marca', () => {
    expect(esPlantillaProvisional('Conveni de donació de la part generadora')).toBe(false)
    expect(esPlantillaProvisional(null)).toBe(false)
    expect(esPlantillaProvisional(undefined)).toBe(false)
    expect(esPlantillaProvisional('')).toBe(false)
  })

  it('tituloSinMarca deja el título limpio para imprimirlo', () => {
    expect(tituloSinMarca('[ESBORRANY] Conveni de donació')).toBe('Conveni de donació')
    expect(tituloSinMarca('[ Borrador ]  Convenio de donación')).toBe('Convenio de donación')
    expect(tituloSinMarca('Conveni de donació')).toBe('Conveni de donació')
    expect(tituloSinMarca(null)).toBe('')
  })

  // Las dos van juntas y hacen cosas contrarias: una detecta la marca, la otra la quita.
  // Si una cambiara su expresión regular y la otra no, el título saldría con el corchete
  // impreso o sin filigrana. Se prueban acopladas a propósito.
  it('detectar y limpiar son la misma regla vista al derecho y al revés', () => {
    for (const t of ['[ESBORRANY] A', '[borrador] B', '[ BORRADOR ] C']) {
      expect(esPlantillaProvisional(t)).toBe(true)
      expect(tituloSinMarca(t)).not.toContain('[')
    }
  })
})

describe('rolesEnTexto', () => {
  it('traduce los roles del convenio de compraventa', () => {
    expect(rolesEnTexto(['venedora'], CA)).toBe('part venedora')
    expect(rolesEnTexto(['venedora', 'compradora'], CA))
      .toBe('part venedora, part compradora')
    expect(rolesEnTexto(['obrador'], CA)).toBe('obrador')
  })

  it('en castellano', () => {
    expect(rolesEnTexto(['venedora', 'compradora'], ES))
      .toBe('parte vendedora, parte compradora')
  })

  it('conserva el orden en que vienen', () => {
    expect(rolesEnTexto(['compradora', 'venedora'], CA))
      .toBe('part compradora, part venedora')
  })

  // Un rol que no esté en el diccionario se imprime crudo en vez de desaparecer: en un
  // convenio, un rol que se pierde cambia lo que la organización está firmando.
  it('un rol desconocido se imprime tal cual, no se traga', () => {
    expect(rolesEnTexto(['transportista'], CA)).toBe('transportista')
    expect(rolesEnTexto(['venedora', 'transportista'], CA))
      .toBe('part venedora, transportista')
  })

  it('sin roles, cadena vacía', () => {
    expect(rolesEnTexto(null, CA)).toBe('')
    expect(rolesEnTexto(undefined, CA)).toBe('')
    expect(rolesEnTexto([], CA)).toBe('')
  })
})
