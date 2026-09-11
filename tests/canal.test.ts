// La política de canal: por dónde se contacta a alguien.
//
// Por qué importa: es la regla que impide que una organización se quede sin recibir una
// oferta por un motivo administrativo. De 345 productores, 61 no tienen móvil utilizable, y
// las 111 entidades importadas llegaron con `opt_in = false` (§8bis): si WhatsApp fuera el
// único camino, la mayor parte de la red no recibiría nada y **nadie se daría cuenta**,
// porque un envío que no se intenta no deja error en ninguna parte.
//
// El otro motivo: aquí se decide POR DÓNDE, y en `gate.ts` se decide A QUIÉN. Son dos
// reglas distintas que se aplican las dos. Confundirlas —dar por hecho que «hay canal»
// significa «se puede enviar»— es exactamente el fallo que abriría el candado del gate.
//
// `ahora` entra por parámetro a propósito, para que el paso del tiempo sea un dato de la
// prueba y no un reloj falseado: la ventana de 24 h se comprueba con instantes explícitos.

import { describe, it, expect } from 'vitest'
import {
  esMovil,
  ventanaAbierta,
  decidirCanal,
  VENTANA_MS,
} from '../supabase/functions/_shared/canal.ts'

const AHORA = new Date('2026-09-11T12:00:00Z').getTime()
const haceHoras = (h: number) => new Date(AHORA - h * 60 * 60 * 1000).toISOString()

describe('esMovil', () => {
  it('acepta los móviles españoles (6xx y 7xx con prefijo 34)', () => {
    expect(esMovil('34612345678')).toBe(true)
    expect(esMovil('34712345678')).toBe(true)
  })

  // Los 6 fijos del import de ARA (§6): tienen número, y aun así no reciben WhatsApp.
  it('descarta los fijos españoles', () => {
    expect(esMovil('34931234567')).toBe(false)
    expect(esMovil('34977667111')).toBe(false)
    expect(esMovil('34812345678')).toBe(false)
  })

  // Decisión explícita del módulo: fuera de España el prefijo no dice si es móvil, así
  // que se intenta y que lo rechace Meta. Descartarlo por nuestra cuenta sería decidir
  // por el destinatario con información que no tenemos.
  it('acepta los extranjeros, que no se pueden clasificar por prefijo', () => {
    expect(esMovil('351912345678')).toBe(true)
    expect(esMovil('33612345678')).toBe(true)
    expect(esMovil('447700900123')).toBe(true)
  })

  it('ignora separadores y el signo de más', () => {
    expect(esMovil('+34 612 34 56 78')).toBe(true)
    expect(esMovil('+34-931-234-567')).toBe(false)
  })

  // ⚠️ La clasificación depende de que el número lleve su prefijo. Un fijo español
  // escrito sin el `34` es indistinguible de un extranjero, y la regla de arriba lo acepta.
  // No es un fallo de esta función —no tiene con qué distinguirlos—, sino la razón por la
  // que la convención (§7) exige E.164 sin `+`: `import-ara.ts` antepone el 34 siempre, y
  // el día que un alta a mano guarde 9 dígitos pelados, ese fijo pasará por móvil.
  it('un fijo español SIN prefijo pasa por móvil: la clasificación exige el prefijo', () => {
    expect(esMovil('931234567')).toBe(true)
    expect(esMovil('34931234567')).toBe(false)
  })

  it('un número demasiado corto no es un móvil', () => {
    expect(esMovil('34612')).toBe(false)
    expect(esMovil('12345678')).toBe(false)
  })

  it('sin teléfono no hay móvil', () => {
    expect(esMovil(null)).toBe(false)
    expect(esMovil(undefined)).toBe(false)
    expect(esMovil('')).toBe(false)
    expect(esMovil('   ')).toBe(false)
    expect(esMovil('no en té')).toBe(false)
  })
})

describe('ventanaAbierta', () => {
  it('sin mensaje entrante la ventana está cerrada', () => {
    expect(ventanaAbierta(null, AHORA)).toBe(false)
    expect(ventanaAbierta(undefined, AHORA)).toBe(false)
  })

  it('un mensaje de hace una hora la mantiene abierta', () => {
    expect(ventanaAbierta(haceHoras(1), AHORA)).toBe(true)
  })

  it('el borde de las 24 h: dentro abierta, un milisegundo después cerrada', () => {
    expect(ventanaAbierta(new Date(AHORA - VENTANA_MS).toISOString(), AHORA)).toBe(true)
    expect(ventanaAbierta(new Date(AHORA - VENTANA_MS - 1).toISOString(), AHORA)).toBe(false)
  })

  it('pasadas 25 h está cerrada', () => {
    expect(ventanaAbierta(haceHoras(25), AHORA)).toBe(false)
  })

  // Una fecha ilegible no puede abrir la ventana: eso convertiría un dato corrupto en
  // permiso para mandar texto libre.
  it('una fecha ilegible no abre la ventana', () => {
    expect(ventanaAbierta('ahir a la tarda', AHORA)).toBe(false)
    expect(ventanaAbierta('', AHORA)).toBe(false)
  })

  it('una fecha en el futuro se considera dentro de la ventana', () => {
    expect(ventanaAbierta(new Date(AHORA + 60_000).toISOString(), AHORA)).toBe(true)
  })
})

// La tabla de AGENTS.md §8bis, fila a fila.
describe('decidirCanal · la tabla del canal preferente', () => {
  it('móvil y ventana abierta → WhatsApp (texto libre, gratis)', () => {
    const d = decidirCanal(
      { telefono: '34612345678', email: 'a@exemple.cat', last_inbound_at: haceHoras(2) },
      AHORA,
    )
    expect(d.canal).toBe('whatsapp')
    expect(d.motivo).toBe('finestra_oberta')
    expect(d.motivoWhatsapp).toBeNull()
    expect(d.whatsappPosible).toBe(true)
  })

  it('móvil y opt-in, con la ventana cerrada → WhatsApp (plantilla)', () => {
    const d = decidirCanal(
      { telefono: '34612345678', opt_in: true, last_inbound_at: haceHoras(72) },
      AHORA,
    )
    expect(d.canal).toBe('whatsapp')
    expect(d.motivo).toBe('opt_in')
  })

  // La ventana manda sobre el opt-in: es el canal gratis y con consentimiento implícito.
  it('con ventana abierta el motivo es la ventana, aunque también haya opt-in', () => {
    const d = decidirCanal(
      { telefono: '34612345678', opt_in: true, last_inbound_at: haceHoras(1) },
      AHORA,
    )
    expect(d.motivo).toBe('finestra_oberta')
  })

  it('sin teléfono → correo', () => {
    const d = decidirCanal({ telefono: null, email: 'a@exemple.cat' }, AHORA)
    expect(d.canal).toBe('email')
    expect(d.motivoWhatsapp).toBe('sense_telefon')
    expect(d.whatsappPosible).toBe(false)
  })

  it('teléfono fijo → correo', () => {
    const d = decidirCanal({ telefono: '34931234567', email: 'a@exemple.cat' }, AHORA)
    expect(d.canal).toBe('email')
    expect(d.motivoWhatsapp).toBe('telefon_no_mobil')
  })

  // El caso de las 111 entidades importadas: móvil bueno, pero sin consentimiento y sin
  // ventana. Es la fila de la tabla que justifica que el correo sea el canal por defecto.
  it('móvil sin opt-in y con la ventana cerrada → correo', () => {
    const d = decidirCanal(
      { telefono: '34612345678', email: 'a@exemple.cat', opt_in: false, last_inbound_at: haceHoras(48) },
      AHORA,
    )
    expect(d.canal).toBe('email')
    expect(d.motivoWhatsapp).toBe('sense_optin_ni_finestra')
    expect(d.emailPosible).toBe(true)
  })

  it('un opt_in nulo cuenta como «sin opt-in», no como «sí»', () => {
    const d = decidirCanal({ telefono: '34612345678', email: 'a@exemple.cat', opt_in: null }, AHORA)
    expect(d.canal).toBe('email')
    expect(d.motivoWhatsapp).toBe('sense_optin_ni_finestra')
  })

  it('ni móvil útil ni correo → ningún canal', () => {
    expect(decidirCanal({ telefono: null, email: null }, AHORA).canal).toBe('cap')
    expect(decidirCanal({ telefono: '34931234567', email: null }, AHORA).canal).toBe('cap')
    expect(decidirCanal({ telefono: '34612345678', email: null, opt_in: false }, AHORA).canal).toBe('cap')
  })

  it('cuando no hay canal sigue diciendo por qué WhatsApp no era viable', () => {
    expect(decidirCanal({ telefono: null, email: null }, AHORA).motivoWhatsapp).toBe('sense_telefon')
    expect(decidirCanal({ telefono: '34931234567' }, AHORA).motivoWhatsapp).toBe('telefon_no_mobil')
    expect(decidirCanal({ telefono: '34612345678' }, AHORA).motivoWhatsapp).toBe('sense_optin_ni_finestra')
    expect(decidirCanal({}, AHORA).motivo).toBe('sense_canal')
  })
})

describe('decidirCanal · qué cuenta como correo y como teléfono', () => {
  it('una dirección sin arroba no es un correo', () => {
    const d = decidirCanal({ telefono: null, email: 'no-en-te' }, AHORA)
    expect(d.emailPosible).toBe(false)
    expect(d.canal).toBe('cap')
  })

  it('los espacios sobrantes no convierten un campo vacío en un canal', () => {
    const d = decidirCanal({ telefono: '   ', email: '   ' }, AHORA)
    expect(d.canal).toBe('cap')
    expect(d.motivoWhatsapp).toBe('sense_telefon')
    expect(d.emailPosible).toBe(false)
  })

  it('el correo se recorta antes de mirarlo', () => {
    expect(decidirCanal({ email: '  a@exemple.cat  ' }, AHORA).canal).toBe('email')
  })
})

// ---------------------------------------------------------------------------
// La invariante que justifica el módulo
// ---------------------------------------------------------------------------
// «Nadie se queda sin recibir por un motivo administrativo»: si hay un correo válido, el
// resultado NUNCA puede ser «ningún canal», pase lo que pase con el teléfono, el opt-in o
// la ventana. Y a la inversa: el único caso en que se devuelve `cap` es cuando de verdad
// no hay por dónde, lo que convierte ese valor en una petición de completar la ficha y no
// en un silencio. Esto es lo que se rompería al añadir una condición nueva a WhatsApp.
describe('con correo válido siempre hay canal', () => {
  const telefonos = [null, '', '   ', '34931234567', '34612345678', '351912345678', 'no en té']
  const optIns = [true, false, null]
  const entrantes = [null, haceHoras(1), haceHoras(48), 'ilegible']

  it('ninguna combinación de teléfono, opt-in y ventana deja sin canal a quien tiene correo', () => {
    for (const telefono of telefonos) {
      for (const opt_in of optIns) {
        for (const last_inbound_at of entrantes) {
          const d = decidirCanal({ telefono, opt_in, last_inbound_at, email: 'a@exemple.cat' }, AHORA)
          expect(d.canal).not.toBe('cap')
          // Y el canal elegido es siempre uno que la propia decisión declara posible.
          expect(d.canal === 'whatsapp' ? d.whatsappPosible : d.emailPosible).toBe(true)
        }
      }
    }
  })

  it('sin correo, el canal es WhatsApp exactamente cuando WhatsApp es posible', () => {
    for (const telefono of telefonos) {
      for (const opt_in of optIns) {
        for (const last_inbound_at of entrantes) {
          const d = decidirCanal({ telefono, opt_in, last_inbound_at, email: null }, AHORA)
          expect(d.canal).toBe(d.whatsappPosible ? 'whatsapp' : 'cap')
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// La preferencia de la organización (deuda §12.22)
// ---------------------------------------------------------------------------
// `organizaciones.canal_preferido` deja que la organización DIGA su canal, en vez de que
// se deduzca siempre de lo que hay en su ficha. Lo que estas pruebas fijan es el límite:
// **una preferencia elige entre los canales viables, no crea uno**. Pedir WhatsApp no abre
// la ventana de 24 h ni sustituye al opt-in —son requisitos de Meta— así que una
// preferencia que se saltara eso no conseguiría un envío, conseguiría un rechazo de la
// Graph API (131047) o una plantilla sin consentimiento.
//
// Y el otro límite, el que da sentido a `preferenciaRespetada`: cuando no se puede
// cumplir, tiene que NOTARSE. Una preferencia ignorada en silencio es peor que no tenerla,
// porque la persona cree haber elegido y el equipo no sabe que no se cumplió.
describe('decidirCanal · la preferencia de la organización', () => {
  const conFinestra = { telefono: '34612345678', email: 'a@exemple.cat', last_inbound_at: haceHoras(2) }
  const sensePermis = { telefono: '34612345678', email: 'a@exemple.cat', opt_in: false, last_inbound_at: haceHoras(48) }

  it('sin preferencia todo se comporta como antes, y se dice que no había', () => {
    const d = decidirCanal(conFinestra, AHORA)
    expect(d.canal).toBe('whatsapp')
    expect(d.motivo).toBe('finestra_oberta')
    expect(d.preferido).toBeNull()
    expect(d.preferenciaRespetada).toBeNull()
  })

  it('una preferencia ausente y una explícitamente nula son lo mismo', () => {
    const a = decidirCanal(sensePermis, AHORA)
    const b = decidirCanal({ ...sensePermis, canal_preferido: null }, AHORA)
    expect(b).toEqual(a)
  })

  // El caso que hoy no se podía expresar: se PUEDE mandar por WhatsApp y aun así se manda
  // por correo, porque es lo que han pedido.
  it('pide correo y se respeta, aunque WhatsApp fuera posible', () => {
    const d = decidirCanal({ ...conFinestra, canal_preferido: 'email' }, AHORA)
    expect(d.canal).toBe('email')
    expect(d.motivo).toBe('preferencia_email')
    expect(d.preferenciaRespetada).toBe(true)
    // La viabilidad no se toca: sigue siendo cierto que WhatsApp se podía.
    expect(d.whatsappPosible).toBe(true)
  })

  it('pide WhatsApp y se respeta cuando es viable', () => {
    const porFinestra = decidirCanal({ ...conFinestra, canal_preferido: 'whatsapp' }, AHORA)
    expect(porFinestra.canal).toBe('whatsapp')
    expect(porFinestra.motivo).toBe('preferencia_whatsapp')
    expect(porFinestra.preferenciaRespetada).toBe(true)

    const perOptIn = decidirCanal(
      { telefono: '34612345678', email: 'a@exemple.cat', opt_in: true, last_inbound_at: haceHoras(72), canal_preferido: 'whatsapp' },
      AHORA,
    )
    expect(perOptIn.canal).toBe('whatsapp')
    expect(perOptIn.preferenciaRespetada).toBe(true)
  })

  // ⚠️ El límite duro. Estas tres son las tres filas de la tabla de §8bis en las que
  // WhatsApp no es viable, y la preferencia no puede moverlas.
  it('pedir WhatsApp NO salta la ventana ni el opt-in ni la falta de móvil', () => {
    const casos = [
      { ...sensePermis, canal_preferido: 'whatsapp' as const, motivo: 'sense_optin_ni_finestra' },
      { telefono: null, email: 'a@exemple.cat', canal_preferido: 'whatsapp' as const, motivo: 'sense_telefon' },
      { telefono: '34931234567', email: 'a@exemple.cat', canal_preferido: 'whatsapp' as const, motivo: 'telefon_no_mobil' },
    ]
    for (const { motivo, ...datos } of casos) {
      const d = decidirCanal(datos, AHORA)
      expect(d.canal).toBe('email')
      expect(d.whatsappPosible).toBe(false)
      // El motivo sigue siendo el accionable (qué falta para poder usar WhatsApp)…
      expect(d.motivo).toBe(motivo)
      expect(d.motivoWhatsapp).toBe(motivo)
      // …y esto es lo que impide que el incumplimiento pase en silencio.
      expect(d.preferido).toBe('whatsapp')
      expect(d.preferenciaRespetada).toBe(false)
    }
  })

  // `sense_correu` estaba en el vocabulario desde el principio y no lo producía nadie:
  // este es exactamente su caso.
  it('pedir correo sin tener correo cae a WhatsApp, y lo dice', () => {
    const d = decidirCanal(
      { telefono: '34612345678', email: null, last_inbound_at: haceHoras(1), canal_preferido: 'email' },
      AHORA,
    )
    expect(d.canal).toBe('whatsapp')
    expect(d.motivo).toBe('sense_correu')
    expect(d.preferenciaRespetada).toBe(false)
  })

  it('una preferencia no inventa un canal cuando no hay ninguno', () => {
    for (const preferido of ['whatsapp', 'email'] as const) {
      const d = decidirCanal({ telefono: null, email: null, canal_preferido: preferido }, AHORA)
      expect(d.canal).toBe('cap')
      expect(d.motivo).toBe('sense_canal')
      expect(d.preferenciaRespetada).toBe(false)
    }
  })

  // La invariante de arriba, repetida con preferencia: ninguna preferencia puede dejar sin
  // canal a quien tiene correo, ni elegir un canal que la propia decisión declara imposible.
  it('con preferencia se mantienen las dos invariantes del módulo', () => {
    const telefonos = [null, '34931234567', '34612345678', '351912345678']
    const optIns = [true, false, null]
    const entrantes = [null, haceHoras(1), haceHoras(48)]
    for (const canal_preferido of ['whatsapp', 'email', null] as const) {
      for (const telefono of telefonos) {
        for (const opt_in of optIns) {
          for (const last_inbound_at of entrantes) {
            const conCorreu = decidirCanal(
              { telefono, opt_in, last_inbound_at, email: 'a@exemple.cat', canal_preferido }, AHORA,
            )
            expect(conCorreu.canal).not.toBe('cap')
            expect(conCorreu.canal === 'whatsapp' ? conCorreu.whatsappPosible : conCorreu.emailPosible).toBe(true)

            const senseCorreu = decidirCanal(
              { telefono, opt_in, last_inbound_at, email: null, canal_preferido }, AHORA,
            )
            expect(senseCorreu.canal).toBe(senseCorreu.whatsappPosible ? 'whatsapp' : 'cap')
          }
        }
      }
    }
  })
})
