// Qué dice cada aviso (05-10-2026, rebanada 2). PURO y sin red, con pruebas en
// `tests/textAvis.test.ts`: lo usa `enviar-avis` para el correo y el WhatsApp.
//
// ⚠️ El panel pinta el MISMO aviso con sus claves `avis.t_<tipus>` de `src/lib/i18n.tsx`
//    (el navegador no importa Deno). Si cambia lo que dice un aviso, cambian los dos; la
//    prueba comprueba que cada tipo tiene texto en los dos idiomas y que no queda ningún
//    marcador sin rellenar.

export type TipusAvis =
  | "oferta_validada"
  | "oferta_rebutjada"
  | "sortida_trobada"
  | "interes_aprovat"
  | "interes_rebutjat";

export const TIPUS_AVIS: readonly TipusAvis[] = [
  "oferta_validada", "oferta_rebutjada", "sortida_trobada", "interes_aprovat", "interes_rebutjat",
];

export interface TextAvis {
  asunto: string;
  titulo: string;
  /** Texto plano, una idea por línea. Quien lo pinta en HTML lo escapa. */
  cuerpo: string;
  boton: string;
  /** Ruta de la aplicación a la que lleva el botón. */
  ruta: string;
}

type Idioma = "ca" | "es";
type Params = Record<string, unknown>;

function kg(v: unknown, idioma: Idioma): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(idioma === "es" ? "es-ES" : "ca-ES", { maximumFractionDigits: 2 }).format(n);
}

function s(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** El texto de un aviso. `objecteId` es el de la fila: hace falta para el enlace. */
export function textAvis(
  tipus: TipusAvis,
  params: Params,
  idioma: Idioma,
  objecteId: string,
): TextAvis {
  const es = idioma === "es";
  const producte = s(params.producte) || (es ? "tu oferta" : "la teva oferta");
  const ref = s(params.ref);
  const refTxt = ref ? ` (${ref})` : "";

  switch (tipus) {
    case "oferta_validada":
      return {
        asunto: es ? `Tu oferta de ${producte} ya está publicada` : `La teva oferta de ${producte} ja està publicada`,
        titulo: es ? "Oferta publicada" : "Oferta publicada",
        cuerpo: es
          ? `El equipo de Redestina ha revisado tu oferta de ${producte}${refTxt} y ya la pueden ver las entidades.`
          : `L’equip de Redestina ha revisat la teva oferta de ${producte}${refTxt} i ja la poden veure les entitats.`,
        boton: es ? "Ver la oferta" : "Veure l’oferta",
        ruta: `/productor/ofertes/${objecteId}`,
      };
    case "oferta_rebutjada": {
      const motiu = s(params.motiu);
      return {
        asunto: es ? `No hemos publicado tu oferta de ${producte}` : `No hem publicat la teva oferta de ${producte}`,
        titulo: es ? "Oferta no publicada" : "Oferta no publicada",
        cuerpo: (es
          ? `El equipo de Redestina no ha publicado tu oferta de ${producte}${refTxt}.`
          : `L’equip de Redestina no ha publicat la teva oferta de ${producte}${refTxt}.`)
          + (motiu ? `\n${es ? "Motivo" : "Motiu"}: ${motiu}` : ""),
        boton: es ? "Ver la oferta" : "Veure l’oferta",
        ruta: `/productor/ofertes/${objecteId}`,
      };
    }
    case "sortida_trobada": {
      const entitat = s(params.entitat);
      return {
        asunto: es ? `Hemos encontrado salida para tu ${producte}` : `Hem trobat sortida per al teu ${producte}`,
        titulo: es ? "Salida encontrada" : "Sortida trobada",
        cuerpo: (es
          ? `Se han asignado ${kg(params.kg, idioma)} kg de ${producte}${refTxt}`
          : `S’han assignat ${kg(params.kg, idioma)} kg de ${producte}${refTxt}`)
          + (entitat ? (es ? ` a ${entitat}.` : ` a ${entitat}.`) : "."),
        boton: es ? "Ver la oferta" : "Veure l’oferta",
        ruta: `/productor/ofertes/${objecteId}`,
      };
    }
    case "interes_aprovat": {
      const sol = Number(params.kg_sol);
      const apr = Number(params.kg_apr);
      const diferents = Number.isFinite(sol) && Number.isFinite(apr) && sol !== apr;
      const productor = s(params.productor);
      const municipi = s(params.municipi);
      const qui = productor ? `${productor}${municipi ? ` (${municipi})` : ""}` : "";
      const linies = [
        es
          ? `Te hemos asignado ${kg(apr, idioma)} kg de ${producte}.`
          : `T’hem assignat ${kg(apr, idioma)} kg de ${producte}.`,
      ];
      if (diferents) {
        linies.push(es
          ? `Habías pedido ${kg(sol, idioma)} kg; el equipo ha aprobado ${kg(apr, idioma)}.`
          : `N’havies demanat ${kg(sol, idioma)} kg; l’equip n’ha aprovat ${kg(apr, idioma)}.`);
      }
      if (qui) linies.push(es ? `Lo ofrece: ${qui}.` : `L’ofereix: ${qui}.`);
      return {
        asunto: es ? `Te hemos asignado ${producte}` : `T’hem assignat ${producte}`,
        titulo: diferents ? (es ? "Interés aprobado en parte" : "Interès aprovat en part") : (es ? "Interés aprobado" : "Interès aprovat"),
        cuerpo: linies.join("\n"),
        boton: es ? "Ver mis intereses" : "Veure els meus interessos",
        ruta: "/receptor/interessos",
      };
    }
    case "interes_rebutjat": {
      const motiu = s(params.motiu);
      return {
        asunto: es ? `No te hemos podido asignar ${producte}` : `No t’hem pogut assignar ${producte}`,
        titulo: es ? "Interés no aprobado" : "Interès no aprovat",
        cuerpo: (es
          ? `El equipo de Redestina no te ha podido asignar ${producte}.`
          : `L’equip de Redestina no t’ha pogut assignar ${producte}.`)
          + (motiu ? `\n${es ? "Motivo" : "Motiu"}: ${motiu}` : ""),
        boton: es ? "Ver mis intereses" : "Veure els meus interessos",
        ruta: "/receptor/interessos",
      };
    }
  }
}

/**
 * El correo con el enlace de confirmación de una recogida programada (rebanada 3). Lo manda
 * `recollides-programades` justo después de emitir el albarán y, si a las 4 h sigue sin
 * usarse, otra vez con un enlace nuevo (`reenviament`): el del primer correo deja de valer,
 * y hay que decirlo para que nadie lo intente.
 */
export function textConfirmacioRecollida(
  numero: string,
  idioma: Idioma,
  reenviament: boolean,
): { asunto: string; titulo: string; cuerpo: string; boton: string; nota: string } {
  const es = idioma === "es";
  const linies = [
    es
      ? `La recogida del albarán ${numero} ya ha llegado a su hora. Con este enlace confirmas los kilos o haces constar cualquier incidencia. Es un minuto y no hace falta cuenta.`
      : `La recollida de l’albarà ${numero} ja ha arribat a la seva hora. Amb aquest enllaç confirmes els quilos o fas constar qualsevol incidència. És un minut i no cal tenir compte.`,
  ];
  if (reenviament) {
    linies.push(es
      ? "Te lo volvemos a enviar porque todavía no está confirmado. El enlace del correo anterior ya no sirve: usa este."
      : "Te’l tornem a enviar perquè encara no està confirmat. L’enllaç del correu anterior ja no serveix: fes servir aquest.");
  }
  linies.push(es
    ? "Mientras no se confirme, no podrás publicar ni pedir ofertas nuevas pasadas 48 horas."
    : "Mentre no es confirmi, passades 48 hores no podràs publicar ni demanar ofertes noves.");
  return {
    asunto: es
      ? `${reenviament ? "Recordatorio: " : ""}confirma la recogida del albarán ${numero}`
      : `${reenviament ? "Recordatori: " : ""}confirma la recollida de l’albarà ${numero}`,
    titulo: es ? "Confirma la recogida" : "Confirma la recollida",
    cuerpo: linies.join("\n"),
    boton: es ? "Confirma la recogida" : "Confirma la recollida",
    nota: es
      ? "El enlace es personal y caduca a los 15 días."
      : "L’enllaç és personal i caduca al cap de 15 dies.",
  };
}
