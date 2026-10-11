// Confirmar un albarán por WhatsApp (11-10-2026, fase 3 de la revisión del 08-10-2026): la
// parte PURA. Sin red y sin `Deno`, para que Vitest la pueda cargar (`tests/confirmacions.test.ts`).
//
// Una parte con móvil y sin correo recibe, cuando su albarán se marca entregado, dos botones:
// «Tot correcte» (`conf:<enlace>:ok`) y «Hi ha diferències» (`conf:<enlace>:dif`). Con la
// segunda se le piden los kilos, y el siguiente número que escriba es la respuesta.
//
// ⚠️ Se acepta SOLO el id del botón, nunca un «sí» escrito: un número o un «ok» suelto es
//    ambiguo entre esta confirmación, la respuesta a una oferta y el intake. El único texto
//    libre que se acepta es el número de kilos, y solo cuando ESE teléfono tiene exactamente
//    una confirmación esperando los kilos (`wa_pas = 'kg'`).

export type AccioConfirmacio = "ok" | "dif";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATRO = new RegExp(`^conf:(${UUID}):(ok|dif)$`, "i");

/** `conf:<uuid>:ok|dif` → el enlace y la acción; cualquier otra cosa → null. */
export function llegirIdConfirmacio(id: string | null | undefined): { enlace: string; accio: AccioConfirmacio } | null {
  const m = PATRO.exec((id ?? "").trim());
  if (!m) return null;
  return { enlace: m[1].toLowerCase(), accio: m[2].toLowerCase() as AccioConfirmacio };
}

export function idsBotonsConfirmacio(enlace: string): { ok: string; dif: string } {
  return { ok: `conf:${enlace}:ok`, dif: `conf:${enlace}:dif` };
}

/**
 * Los kilos de un mensaje: «95», «95,5», «95.5 kg», «uns 95 kg». Un número y solo uno; con
 * dos («de 90 a 95») no se adivina. Negativos y más de 100.000 kg no valen.
 */
export function llegirKg(text: string | null | undefined): number | null {
  const t = (text ?? "").toLowerCase().replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2");
  const nums = t.match(/\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length !== 1) return null;
  const n = Number(nums[0].replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
  return Math.round(n * 100) / 100;
}

export interface DadesPregunta {
  numero: string | null;
  rol: "entrega" | "recibe" | string | null;
  producte?: string | null;
  kg?: number | null;
  quan?: string | null;
}

/** La pregunta con los dos botones. Va en catalán, como todo lo de WhatsApp (§7). */
export function textPreguntaConfirmacio(d: DadesPregunta): string {
  const verb = d.rol === "entrega" ? "lliurat" : "rebut";
  const que = [d.producte, d.kg != null ? `${d.kg} kg` : null].filter(Boolean).join(" · ");
  return [
    `📦 Albarà ${d.numero ?? ""}`.trim(),
    que ? `${que}${d.quan ? ` · ${d.quan}` : ""}` : d.quan ?? "",
    "",
    `Ens confirmes que s'ha ${verb} tal com consta? Si els quilos no coincideixen, prem «Hi ha diferències» i ens dius els reals.`,
  ].filter((l, i) => l !== "" || i === 2).join("\n");
}

export const BOTO_OK = "Tot correcte";
export const BOTO_DIF = "Hi ha diferències";

export function textDemanaKg(rol: string | null): string {
  return rol === "entrega"
    ? "Quants quilos has lliurat? Escriu només el número (per exemple, 95)."
    : "Quants quilos has rebut? Escriu només el número (per exemple, 95).";
}

export function textConfirmat(numero: string | null, kg: number | null): string {
  return kg != null
    ? `Gràcies! Hem registrat la confirmació de l'albarà ${numero ?? ""} amb ${kg} kg.`.replace("  ", " ")
    : `Gràcies! Hem registrat la confirmació de l'albarà ${numero ?? ""}.`.replace("  ", " ");
}

export const TEXT_NO_ACTIVA =
  "Aquesta confirmació ja no està activa (ja s'ha fet o ha caducat). Si cal, l'equip de Redestina te la tornarà a enviar.";
