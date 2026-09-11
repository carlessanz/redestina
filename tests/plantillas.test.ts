// La plantilla de primer contacto y el texto de salutació.
//
// POR QUÉ IMPORTA, Y POR QUÉ ESTA SUITE ES RARA: la deuda §12.15 dice literalmente que «la
// selección de plantilla de primer contacto por rol NO SE EJERCITA EN TEST: siempre cae a
// `hello_world`; solo actúa en producción con `PLANTILLES_CA_APROVADES = true`». Es decir:
// la rama que decide si a un productor se le manda `salutacio_productor` y a una entidad
// `salutacio_entitat` es hoy **código inalcanzable**, y estrenarla en producción el día que
// Meta apruebe las plantillas significaría estrenarla sin haberla ejecutado nunca.
//
// Eso es lo que esta suite cierra. La rama apagada se prueba importando el módulo tal cual;
// la encendida, compilando el MISMO fuente con el flag a `true` (ver `conFlagEncendido`).
// No se toca ni una línea de producción: el flag sigue en `false`, que es donde tiene que
// estar mientras Meta no apruebe nada.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { transform } from 'esbuild'
import {
  plantillaPrimerContacte,
  textoSalutacio,
  PLANTILLES_CA_APROVADES,
  PLANTILLA_OFERTA_APROVADA,
  PLANTILLA_OFERTA,
  type PlantillaRef,
  type RolContacte,
} from '../src/lib/plantillas'

const RUTA = fileURLToPath(new URL('../src/lib/plantillas.ts', import.meta.url))

/**
 * El módulo compilado con `PLANTILLES_CA_APROVADES = true`.
 *
 * El flag es una constante del propio módulo, así que ningún `vi.mock` puede cambiarlo: lo
 * que se hace es leer el fuente, cambiar ese literal, compilarlo con esbuild (el mismo que
 * usa Vite) e importar el resultado como módulo. Sigue siendo **este** código, no una copia:
 * si mañana alguien reescribe la selección por rol, esta prueba ve la versión nueva.
 *
 * La sustitución se verifica (`expect(fuente).not.toBe(encendido)`): si el flag se renombra,
 * la suite falla en voz alta en vez de seguir probando el mismo caso dos veces.
 */
async function conFlagEncendido(): Promise<{
  plantillaPrimerContacte: (rol: RolContacte) => PlantillaRef
  PLANTILLES_CA_APROVADES: boolean
}> {
  const fuente = await readFile(RUTA, 'utf8')
  const encendido = fuente.replace(
    'export const PLANTILLES_CA_APROVADES = false',
    'export const PLANTILLES_CA_APROVADES = true',
  )
  expect(encendido, 'el flag PLANTILLES_CA_APROVADES ya no se declara como se esperaba')
    .not.toBe(fuente)
  const { code } = await transform(encendido, { loader: 'ts', format: 'esm' })
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  return import(/* @vite-ignore */ url)
}

describe('plantillaPrimerContacte · con el flag APAGADO (hoy)', () => {
  it('los tres roles caen a `hello_world` en en_US', () => {
    // La única plantilla aprobada en el número de test. Que el fallback valga también para
    // `null` es lo que hace que el botón de primer contacto no se rompa nunca en pruebas.
    const esperado = { name: 'hello_world', language: 'en_US' }
    expect(plantillaPrimerContacte('productor')).toEqual(esperado)
    expect(plantillaPrimerContacte('entitat')).toEqual(esperado)
    expect(plantillaPrimerContacte(null)).toEqual(esperado)
  })

  it('no devuelve ninguna plantilla catalana, que Meta rechazaría con 132001', () => {
    for (const rol of ['productor', 'entitat', null] as RolContacte[]) {
      expect(plantillaPrimerContacte(rol).name).not.toMatch(/^salutacio_/)
    }
  })
})

describe('plantillaPrimerContacte · con el flag ENCENDIDO (deuda §12.15)', () => {
  let mod: Awaited<ReturnType<typeof conFlagEncendido>>
  beforeAll(async () => { mod = await conFlagEncendido() })

  it('la variante compilada tiene de verdad el flag a true', () => {
    expect(mod.PLANTILLES_CA_APROVADES).toBe(true)
  })

  it('a una entidad receptora le toca `salutacio_entitat`', () => {
    expect(mod.plantillaPrimerContacte('entitat')).toEqual({ name: 'salutacio_entitat', language: 'ca' })
  })

  it('a un productor le toca `salutacio_productor`', () => {
    expect(mod.plantillaPrimerContacte('productor')).toEqual({ name: 'salutacio_productor', language: 'ca' })
  })

  it('sin rol conocido se usa la de productor, no el fallback en inglés', () => {
    // Es la rama `rol === 'entitat' ? entitat : productor`: cualquier cosa que no sea
    // entidad se trata como productor. Conviene saberlo: un contacto sin clasificar
    // recibirá el texto de productor, no un mensaje genérico.
    expect(mod.plantillaPrimerContacte(null)).toEqual({ name: 'salutacio_productor', language: 'ca' })
  })

  it('las dos plantillas catalanas son distintas y van en «ca»', () => {
    const p = mod.plantillaPrimerContacte('productor')
    const e = mod.plantillaPrimerContacte('entitat')
    expect(p.name).not.toBe(e.name)
    expect([p.language, e.language]).toEqual(['ca', 'ca'])
  })
})

describe('textoSalutacio', () => {
  // Va como TEXTO LIBRE dentro de la ventana de 24 h, así que no depende de Meta: es el
  // mensaje que de verdad se ve hoy en pruebas.
  it('el texto de la entidad habla de entidades sociales', () => {
    expect(textoSalutacio('entitat')).toContain('entitats socials')
  })

  it('el texto del productor habla de canalizar SUS excedentes', () => {
    expect(textoSalutacio('productor')).toContain('els teus')
    expect(textoSalutacio('productor')).not.toContain('entitats socials')
  })

  it('sin rol se usa el del productor', () => {
    expect(textoSalutacio(null)).toBe(textoSalutacio('productor'))
  })

  it('los dos piden «respon OK», que es lo que abre la ventana de 24 h', () => {
    // Sin esa respuesta la conversación no se abre y todo lo demás (intake incluido)
    // seguiría necesitando plantilla de pago.
    for (const rol of ['productor', 'entitat'] as const) {
      expect(textoSalutacio(rol)).toContain('*OK*')
    }
  })

  it('los dos se presentan con el nombre del servicio y van en català', () => {
    for (const rol of ['productor', 'entitat'] as const) {
      const texto = textoSalutacio(rol)
      expect(texto).toContain('Redestina')
      expect(texto).toContain('Espigoladors')
      expect(texto.startsWith('Hola!')).toBe(true)
    }
  })

  it('no queda ningún nombre retirado del proyecto en los textos (§10bis)', () => {
    // `POMA` y `pdApp` fueron nombres del servicio de cara al usuario, no solo del repo.
    for (const rol of ['productor', 'entitat', null] as RolContacte[]) {
      expect(textoSalutacio(rol)).not.toMatch(/POMA|pdApp/)
    }
  })

  it('cabe en un mensaje de WhatsApp sin truncarse', () => {
    for (const rol of ['productor', 'entitat'] as const) {
      expect(textoSalutacio(rol).length).toBeLessThan(1024)
    }
  })
})

describe('los interruptores de producción', () => {
  // ⚠️ Estos dos `expect` están puestos para FALLAR el día que Meta apruebe las plantillas.
  // No es un descuido: el checkpoint §12.2 pide que ese commit haga cuatro cosas más además
  // de subir el flag (dar de alta el texto legible en `TEXTO_PLANTILLA`, cambiar
  // `WHATSAPP_PHONE_ID`, vaciar `meta_test_recipients` y decidir sobre el modo test). Que
  // esta suite se pare es el recordatorio de que el flag no viaja solo.
  it('hoy los dos flags están apagados (checkpoint §12.2 sin cerrar)', () => {
    expect(PLANTILLES_CA_APROVADES).toBe(false)
    expect(PLANTILLA_OFERTA_APROVADA).toBe(false)
  })

  it('la plantilla de oferta apunta a `oferta_excedent` en català', () => {
    expect(PLANTILLA_OFERTA).toEqual({ name: 'oferta_excedent', language: 'ca' })
  })
})
