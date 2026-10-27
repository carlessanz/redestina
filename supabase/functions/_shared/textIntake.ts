// Lo que el bot contesta al productor al cerrar el intake por WhatsApp, sin red ni Deno.
// Módulo «hoja» (27-10-2026): el panel del equipo lo importa para enseñar, en una oferta
// asistida, el mensaje que el productor habría recibido si la hubiera dictado él (R4 del
// plan de gestión autónoma: un solo texto, no una copia). Lo vigila `tests/puresa.test.ts`.

/** El agradecimiento con la referencia, según la oferta quede publicada o por validar. */
export function textAgraimentIntake(producto: string, idExcedente: string, estado?: string | null): string {
  return `Gràcies! Hem registrat la teva oferta de ${producto} amb la referència ${idExcedente}. ` +
    (estado === "pendent_validacio"
      // Desde el 05-10-2026 una oferta nueva espera a que el equipo la revise antes de
      // salir al Mercat. Decir «la farem arribar» sin más sería prometer algo que todavía
      // no ha pasado.
      ? "L'equip de Redestina la revisarà i, un cop validada, la farà arribar a les entitats que la puguin aprofitar."
      : "L'equip de Redestina la farà arribar a les entitats que la puguin aprofitar.");
}

/** Sin convenio vigente para ninguna de las modalidades: no se publica. */
export function textSenseConveniIntake(modalitats: readonly string[]): string {
  return modalitats.length === 1 && modalitats[0] === "donacio"
    ? "No podem publicar l'oferta: per a donacions cal tenir vigent el conveni de donació. " +
      "Demana'l a l'equip de Redestina i torna-ho a provar."
    : "No podem publicar l'oferta: cal tenir vigent el conveni de col·laboració per a " +
      "alguna de les modalitats triades. Demana'l a l'equip de Redestina.";
}

/** El alta ha fallado: la sesión se queda en el último paso para reintentar. */
export const TEXT_ERROR_INTAKE =
  "No hem pogut registrar l'oferta per un error tècnic. D'aquí a uns minuts, torna a " +
  "escriure les observacions per tornar-ho a provar, o escriu *Stop* per cancel·lar-la.";
