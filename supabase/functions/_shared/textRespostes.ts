// Lo que el bot le dice a una entidad que contesta a una oferta, sin red ni Deno.
// Módulo «hoja» (27-10-2026): sale de `respuestas.ts`, que importa el cliente de WhatsApp,
// para que el panel del equipo pueda enseñar, cuando registra un interés en nombre de una
// entidad, exactamente lo que el bot le habría contestado (R4 del plan de gestión autónoma:
// un solo texto). Los literales son los de siempre: no se reescriben, se mueven.
// `respuestas.ts` reexporta lo que ya exportaba. Lo vigila `tests/puresa.test.ts`.

/** Sin decimales cuando no hacen falta, y con coma: «300», «212,5». */
export function formatKg(n: number): string {
  return (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))).replace(".", ",");
}

/** «0,80 €/kg», igual que en el texto de la oferta. */
export function eurKg(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €/kg`;
}

/** «de Tomàquet» / «d'Albercoc». */
export function deProducte(nom: string): string {
  return /^[aeiouàèéíòóúh]/i.test(nom.trim()) ? `d'${nom}` : `de ${nom}`;
}

/** De qué oferta se habla, para que la pregunta no sea anónima: « de Tomàquet (E-…)». */
export function textQuinaOferta(producto: string | null | undefined, idExcedente?: string | null): string {
  if (!producto) return "";
  return ` ${deProducte(String(producto))}${idExcedente ? ` (${idExcedente})` : ""}`;
}

/** El trozo « El màxim són N kg.» que acompaña a la pregunta, o nada si no se sabe. */
export function textMaxim(disp: number): string {
  if (disp <= 0) return "";
  return disp === 1 ? " El màxim és 1 kg." : ` El màxim són ${formatKg(disp)} kg.`;
}

/** El aviso de pasarse, o `null` si el número cabe (o si no hay tope que aplicar). */
export function avisKgExcessius(kg: number, disp: number): string | null {
  if (disp <= 0 || kg <= disp) return null;
  const max = formatKg(disp);
  return `D'aquesta oferta en queden ${max} kg i n'has demanat ${formatKg(kg)}. ` +
    `Escriu un número igual o inferior a ${max}. Si els vols tots, escriu ${max}.`;
}

/** Los dos botones con los que se envía la oferta (`OfferDetail`). */
export const BOTONS_OFERTA = [
  { id: "accept:si", titulo: "M'interessa" },
  { id: "accept:no", titulo: "Ara no" },
];

/** Botones de confirmación del preu mínim. */
export const BOTONS_PREU = [
  { id: "accept:preu_si", titulo: "Sí, accepto" },
  { id: "accept:preu_no", titulo: "No" },
];

/** Tras un sí: cuántos kg quiere. `quina` = `textQuinaOferta(...)`. */
export function textPreguntaKg(quina: string, disp: number): string {
  return `Perfecte! Quants kg${quina} en vols?${textMaxim(disp)} Escriu només el número.`;
}

/** En el paso `kg`, algo que no es un número. */
export function textKgNoEntes(disp: number): string {
  return `No t'he entès. Escriu quants kg en vols (p. ex. 200), o *NO* si ja no la vols.${textMaxim(disp)}`;
}

/** Venta o maquila sin donación: confirmar el precio mínimo (va con `BOTONS_PREU`). */
export function textConfirmaPreu(preuMinim: number): string {
  return `El preu mínim d'aquesta oferta és ${eurKg(preuMinim)}. Hi estàs d'acord?`;
}

/** En el paso `preu`, algo que no es ni sí ni no. */
export const TEXT_REPETEIX_PREU = "Tria una opció: hi estàs d'acord amb el preu mínim?";

/** Interés registrado, pendiente de que el equipo lo apruebe. */
export function textGracies(kg: number): string {
  return `Perfecte, hem registrat que en vols ${formatKg(kg)} kg. L'equip de Redestina ho ` +
    "confirmarà i coordinarà la recollida. 🚚";
}

/** Ha dicho que no al precio mínimo: el equipo lo revisa. */
export function textPreuRebutjat(kg: number): string {
  return `D'acord. Hem apuntat que en vols ${formatKg(kg)} kg però que no acceptes el preu mínim. ` +
    "L'equip de Redestina ho revisarà.";
}

/** «Ara no» o un no claro. */
export const TEXT_REBUIG = "D'acord, gràcies per contestar. Ho tindrem en compte per a properes ofertes. 🙌";

/** Contesta a una oferta ya cubierta, cancelada o cerrada. */
export function textNoDisponible(quina: string): string {
  return `Aquesta oferta${quina} ja no està disponible: s'ha repartit o s'ha retirat. Gràcies igualment!`;
}

/** Un mensaje que no es ni sí ni no, con la oferta enviada hace poco (va con `BOTONS_OFERTA`). */
export function textPendentResposta(quina: string): string {
  return `Tens pendent de resposta l'oferta${quina}. T'interessa?`;
}
