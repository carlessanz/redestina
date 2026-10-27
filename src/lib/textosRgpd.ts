// Las tres declaraciones RGPD del alta, en el navegador. COPIA de `supabase/functions/_shared/
// textosRgpd.ts` (el bundle no importa Deno): `tests/textosRgpd.test.ts` comprueba que las dos
// copias dicen exactamente lo mismo. El que manda es el del servidor: recompone el texto y lo
// hashea, así que lo que se enseña aquí tiene que ser letra por letra lo que se guarda.

export const VERSIO_RGPD = "1-provisional";

export const TIPUS_CONSENTIMENT = [
  "privacitat",
  "comunicacions_plataforma",
  "comunicacions_espigoladors",
] as const;
export type TipusConsentiment = typeof TIPUS_CONSENTIMENT[number];

export type IdiomaRgpd = "ca" | "es";

/** Lo que declara la propia persona (registro público). */
const PROPIS: Record<IdiomaRgpd, Record<TipusConsentiment, string>> = {
  ca: {
    privacitat:
      "He llegit i accepto la política de privacitat de Redestina. Les dades es fan servir per gestionar el servei de canalització d'excedents.",
    comunicacions_plataforma:
      "Vull rebre comunicacions informatives de la plataforma Redestina (novetats i millores del servei).",
    comunicacions_espigoladors:
      "Vull rebre comunicacions de la Fundació Espigoladors (activitats, campanyes i butlletins).",
  },
  es: {
    privacitat:
      "He leído y acepto la política de privacidad de Redestina. Los datos se usan para gestionar el servicio de canalización de excedentes.",
    comunicacions_plataforma:
      "Quiero recibir comunicaciones informativas de la plataforma Redestina (novedades y mejoras del servicio).",
    comunicacions_espigoladors:
      "Quiero recibir comunicaciones de la Fundació Espigoladors (actividades, campañas y boletines).",
  },
};

/** Lo que declara el equipo en nombre de la persona (alta asistida). */
const ASSISTITS: Record<IdiomaRgpd, Record<TipusConsentiment, string>> = {
  ca: {
    privacitat:
      "La persona ha llegit i accepta la política de privacitat de Redestina. Les dades es fan servir per gestionar el servei de canalització d'excedents.",
    comunicacions_plataforma:
      "La persona vol rebre comunicacions informatives de la plataforma Redestina (novetats i millores del servei).",
    comunicacions_espigoladors:
      "La persona vol rebre comunicacions de la Fundació Espigoladors (activitats, campanyes i butlletins).",
  },
  es: {
    privacitat:
      "La persona ha leído y acepta la política de privacidad de Redestina. Los datos se usan para gestionar el servicio de canalización de excedentes.",
    comunicacions_plataforma:
      "La persona quiere recibir comunicaciones informativas de la plataforma Redestina (novedades y mejoras del servicio).",
    comunicacions_espigoladors:
      "La persona quiere recibir comunicaciones de la Fundació Espigoladors (actividades, campañas y boletines).",
  },
};

export function textConsentiment(
  tipus: TipusConsentiment,
  idioma: IdiomaRgpd,
  assistit = false,
): string {
  return (assistit ? ASSISTITS : PROPIS)[idioma][tipus];
}

/** La huella del texto exacto, en hexadecimal (Web Crypto: vale en Deno y en Node). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
