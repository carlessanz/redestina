// Envíos MANUALES con las notificaciones apagadas (04-11-2026, decisión de Carles).
//
// Los interruptores de Configuració › Notificacions (§8) cortan lo que sale SOLO: triggers,
// jobs, avisos, recordatorios, el PDF al generarse, el correo que acompaña a «Marcar
// entregat». No cortan unos pocos envíos que alguien del equipo lanza a mano con un botón y
// acepta en el momento (el diálogo lo dice: «Les notificacions estan apagades…»).
//
// La lista es CERRADA y vive en el servidor:
//   · por `enviar-email`, solo los propósitos de aquí (el cliente dice `manual: true`, pero
//     con cualquier otro propósito se ignora y el correo se corta como siempre);
//   · por función propia, que lo decide ella: `reenviar-documento` («Reenvia»),
//     `donar-acces` («Dona-li accés») y `enviar-albara` («Envia per correu» del albarán).
//
// Lo manual se salta SOLO los interruptores: el modo test, la lista blanca y los documentos
// de prueba siguen mandando (`sendEmail` con `{ manual: true }`).
//
// Puro y sin Deno: lo importa también Vitest.

/** Propósitos de `enviar-email` que pueden salir a mano con las notificaciones apagadas. */
export const PROPOSITS_MANUALS: ReadonlySet<string> = new Set([
  "consentiment_rgpd", // Gestió interna › «Demana el consentiment per correu»
  "firma_conveni", // «Envia'l per correu per signar» (ficha y detalle del convenio)
]);

/** ¿Este envío de `enviar-email` puede saltarse los interruptores? */
export function esEnviamentManual(proposito: string, demanat: unknown): boolean {
  return demanat === true && PROPOSITS_MANUALS.has(proposito);
}
