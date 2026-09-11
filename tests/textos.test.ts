// El aviso de «RECOLLIDA CONFIRMADA» que el equipo copia y pega en el grupo de WhatsApp.
//
// POR QUÉ IMPORTA: este texto no es un documento —el albarán legal se retiró de aquí en la
// fase 3 y hoy es una fila numerada con su PDF—, es el mensaje que el equipo pega en un grupo
// donde nadie va a verificar nada. Reproduce el formato que se escribía a mano, emojis
// incluidos, y su valor está justamente en que **siempre tiene la misma forma**: quien lo lee
// busca la línea de los kg que faltan sin leer el resto. Un salto de línea perdido o un
// campo movido de sitio no rompe ninguna prueba de la aplicación y sí rompe esa lectura.
//
// El otro detalle que se fija aquí es que los saltos son `\n` de verdad: `OfferDetail` escribe
// al portapapeles en `text/plain` y en `text/html` con cada línea en su `<div>` porque
// WhatsApp aplana un `<br>` al pegar. Si esta función dejara de separar por `\n`, esa
// conversión se quedaría sin nada que separar.

import { describe, it, expect } from 'vitest'
import { textoRecollidaConfirmada } from '../src/lib/textos'

const CAMPOS = {
  entitat: 'Rebost Solidari del Baix',
  dataHora: '12/09/2026 a les 10:00',
  kgRecollits: '320',
  kgFalten: '80',
  comentaris: 'Porten transpalet',
}

describe('textoRecollidaConfirmada', () => {
  it('tiene siete líneas: título, blanco y los cinco campos', () => {
    const lineas = textoRecollidaConfirmada(CAMPOS).split('\n')
    expect(lineas).toHaveLength(7)
    expect(lineas[1]).toBe('')
  })

  it('abre con el título en negrita de WhatsApp', () => {
    // Los asteriscos son el marcado de WhatsApp, no decoración: sin ellos el aviso no
    // destaca en un grupo con conversación.
    expect(textoRecollidaConfirmada(CAMPOS).startsWith('🚚 *RECOLLIDA CONFIRMADA*')).toBe(true)
  })

  it('mantiene el orden de los campos que el equipo lee de arriba abajo', () => {
    const lineas = textoRecollidaConfirmada(CAMPOS).split('\n').slice(2)
    expect(lineas.map((l) => l.split(':')[0])).toEqual([
      '🏛️ SDA / ENTITAT',
      '📅 DATA i HORA',
      '⚖️ KG RECOLLITS',
      '🔴 KG FALTEN RECOLLIR',
      '👥 Comentaris',
    ])
  })

  it('coloca cada valor en su línea', () => {
    const texto = textoRecollidaConfirmada(CAMPOS)
    expect(texto).toContain('🏛️ SDA / ENTITAT: Rebost Solidari del Baix')
    expect(texto).toContain('📅 DATA i HORA: 12/09/2026 a les 10:00')
    expect(texto).toContain('⚖️ KG RECOLLITS: 320')
    expect(texto).toContain('🔴 KG FALTEN RECOLLIR: 80')
    expect(texto).toContain('👥 Comentaris: Porten transpalet')
  })

  it('los saltos son «\\n», no «\\r\\n» ni HTML', () => {
    const texto = textoRecollidaConfirmada(CAMPOS)
    expect(texto).not.toContain('\r')
    expect(texto).not.toContain('<br')
  })

  it('con los campos vacíos sigue saliendo el esqueleto entero', () => {
    // Es el caso real de una recogida a medio registrar: se copia igual y la persona
    // rellena a mano. Lo que no puede pasar es que desaparezcan líneas.
    const texto = textoRecollidaConfirmada({
      entitat: '', dataHora: '', kgRecollits: '', kgFalten: '', comentaris: '',
    })
    expect(texto.split('\n')).toHaveLength(7)
    expect(texto).toContain('🔴 KG FALTEN RECOLLIR: ')
  })

  it('no interpreta el contenido: lo pega tal cual', () => {
    // No hay escapado ni plantillas: un valor con dos puntos o con asteriscos entra igual.
    const texto = textoRecollidaConfirmada({ ...CAMPOS, comentaris: 'Avisar: *urgent*' })
    expect(texto).toContain('👥 Comentaris: Avisar: *urgent*')
  })

  it('ya no compone ningún albarán (se retiró en la fase 3)', async () => {
    // `textoAlbaran()` vivía aquí con el nombre del productor siempre en blanco (deuda 40).
    // Si reapareciera, sería una segunda fuente de verdad compitiendo con el PDF numerado.
    const mod = await import('../src/lib/textos')
    expect(Object.keys(mod)).toEqual(['textoRecollidaConfirmada'])
  })
})
