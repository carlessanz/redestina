// Qué dice cada aviso (05-10-2026, rebanada 2). PURO y sin red, con pruebas en
// `tests/textAvis.test.ts`: lo usa `enviar-avis` para el correo y el WhatsApp.
//
// ⚠️ El panel pinta el MISMO aviso con sus claves `avis.t_<tipus>` de `src/lib/i18n.tsx`
//    (el navegador no importa Deno). Si cambia lo que dice un aviso, cambian los dos; la
//    prueba comprueba que cada tipo tiene texto en los dos idiomas y que no queda ningún
//    marcador sin rellenar.

// «de Tomàquet» / «d’Alvocat» en catalán (27-10-2026: decía «de Alvocat»). Otra «hoja».
// Con el apóstrofo tipográfico, como el resto de los avisos (el bot usa el recto).
import { de } from "./textIntake.ts";
const deProducte = (nom: string) => de(nom).replace(/^d'/, "d’");

export type TipusAvis =
  | "oferta_validada"
  | "oferta_rebutjada"
  | "sortida_trobada"
  | "interes_aprovat"
  | "interes_rebutjat"
  | "oferta_sense_desti"
  | "recollida_canviada"
  | "kg_assignats_canviats"
  | "recollida_confirmada"
  | "oferta_modificada"
  | "oferta_enviada"
  | "certificat_per_revisar"
  | "recollida_per_registrar"
  | "recollida_retornada";

export const TIPUS_AVIS: readonly TipusAvis[] = [
  "oferta_validada", "oferta_rebutjada", "sortida_trobada", "interes_aprovat", "interes_rebutjat",
  "oferta_sense_desti", "recollida_canviada", "kg_assignats_canviats", "recollida_confirmada",
  "oferta_modificada", "oferta_enviada", "certificat_per_revisar", "recollida_per_registrar",
  "recollida_retornada",
];

/** A quién va el aviso: decide el enlace de los que reciben las dos partes (fase 2). */
export type DestinatariAvis = "productor" | "entidad";

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

/** «10/10 · 10:00», en hora de Madrid (la recogida es un momento local). Vacío si no hay. */
export function quan(v: unknown, idioma: Idioma): string {
  if (v == null || v === "") return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "";
  const loc = idioma === "es" ? "es-ES" : "ca-ES";
  const dia = new Intl.DateTimeFormat(loc, { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit" }).format(d);
  const hora = new Intl.DateTimeFormat(loc, { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(d);
  return `${dia} · ${hora}`;
}

/** El texto de un aviso. `objecteId` es el de la fila: hace falta para el enlace. */
export function textAvis(
  tipus: TipusAvis,
  params: Params,
  idioma: Idioma,
  objecteId: string,
  destinatari: DestinatariAvis = "productor",
): TextAvis {
  const es = idioma === "es";
  const producte = s(params.producte) || (es ? "tu oferta" : "la teva oferta");
  // El código `E-…` (params.ref) ya no se imprime: estos avisos van al ofertante, y ese código
  // es de gestión interna del equipo (revisión del cliente del 08-10-2026, §3.5). El parámetro
  // se sigue guardando en `avisos.params` por trazabilidad.

  // Los avisos que reciben LAS DOS partes llevan a su pantalla: el productor a la oferta, el
  // receptor a «Els meus interessos».
  const rutaParts = destinatari === "entidad"
    ? "/receptor/interessos"
    : `/productor/ofertes/${s(params.excedente_id) || objecteId}`;
  const botoParts = destinatari === "entidad"
    ? (es ? "Ver mis intereses" : "Veure els meus interessos")
    : (es ? "Ver la oferta" : "Veure l’oferta");

  switch (tipus) {
    case "recollida_canviada": {
      const q = quan(params.recollida_at, idioma);
      return {
        asunto: es ? `Cambia la recogida de ${producte}` : `Canvia la recollida ${deProducte(producte)}`,
        titulo: es ? "Recogida modificada" : "Recollida modificada",
        cuerpo: es
          ? `La recogida de ${producte} ahora es ${q || "en otra fecha"}.`
          : `La recollida ${deProducte(producte)} ara és ${q || "en una altra data"}.`,
        boton: botoParts,
        ruta: rutaParts,
      };
    }
    case "kg_assignats_canviats":
      return {
        asunto: es ? `Cambian los kilos de ${producte}` : `Canvien els quilos ${deProducte(producte)}`,
        titulo: es ? "Cantidad asignada modificada" : "Quantitat assignada modificada",
        cuerpo: es
          ? `La cantidad asignada de ${producte} pasa de ${kg(params.kg_abans, idioma)} a ${kg(params.kg, idioma)} kg.`
          : `La quantitat assignada ${deProducte(producte)} passa de ${kg(params.kg_abans, idioma)} a ${kg(params.kg, idioma)} kg.`,
        boton: botoParts,
        ruta: rutaParts,
      };
    case "recollida_confirmada": {
      const entitat = s(params.entitat);
      const q = quan(params.recollida_at, idioma);
      // 17-10-2026: los kg reales los registra el receptor y pueden no coincidir con lo
      // asignado. Con `diferencia` y `kg_assignats` se dice, y que la revisa el equipo; sin
      // ellos (avisos anteriores) se mantiene el texto de siempre.
      const assignats = Number(params.kg_assignats);
      const ambDiferencia = (params.diferencia === true || params.diferencia === "true")
        && params.kg_assignats != null && params.kg_assignats !== "" && Number.isFinite(assignats);
      if (ambDiferencia) {
        return {
          asunto: es ? `Recogida registrada con diferencia: ${producte}` : `Recollida registrada amb diferència: ${producte}`,
          titulo: es ? "Recogida con diferencia" : "Recollida amb diferència",
          cuerpo: (es
            ? `${entitat || "La entidad"} ha registrado que ha recogido ${kg(params.kg, idioma)} kg de ${producte}, frente a los ${kg(assignats, idioma)} kg asignados`
            : `${entitat || "L’entitat"} ha registrat que ha recollit ${kg(params.kg, idioma)} kg ${deProducte(producte)}, respecte als ${kg(assignats, idioma)} kg assignats`)
            + (q ? ` (${q}).` : ".")
            + (es
              ? "\nEl equipo de Redestina revisa la diferencia."
              : "\nL’equip de Redestina revisa la diferència."),
          boton: botoParts,
          ruta: rutaParts,
        };
      }
      return {
        asunto: es ? `Recogida confirmada: ${producte}` : `Recollida confirmada: ${producte}`,
        titulo: es ? "Salida confirmada" : "Sortida confirmada",
        cuerpo: (es
          ? `${entitat || "La entidad"} ha confirmado que ha recibido ${kg(params.kg, idioma)} kg de ${producte}`
          : `${entitat || "L’entitat"} ha confirmat que ha rebut ${kg(params.kg, idioma)} kg ${deProducte(producte)}`)
          + (q ? ` (${q}).` : "."),
        boton: botoParts,
        ruta: rutaParts,
      };
    }
    case "recollida_per_registrar": {
      // 17-10-2026: a la hora de recogida ya no se emite nada; se le pide al receptor que
      // registre los kilos reales. Desde el mismo día el registro lo valida el equipo, y
      // solo entonces se generan los albaranes: el texto no puede prometer que registrar
      // los genera.
      const q = quan(params.recollida_at, idioma);
      return {
        asunto: es ? `Registra la recogida de ${producte}` : `Registra la recollida ${deProducte(producte)}`,
        titulo: es ? "Registra la recogida" : "Registra la recollida",
        cuerpo: (es
          ? `Ya ha pasado la hora de recogida de ${kg(params.kg, idioma)} kg de ${producte}${q ? ` (${q})` : ""}.`
          : `Ja ha passat l’hora de recollida de ${kg(params.kg, idioma)} kg ${deProducte(producte)}${q ? ` (${q})` : ""}.`)
          + (es
            ? "\nCuando lo hayas recogido, entra en Redestina y registra los kilos que te has llevado. El equipo de Redestina lo revisará y, entonces, se generarán los albaranes."
            : "\nQuan l’hagis recollit, entra a Redestina i registra els quilos que t’has endut. L’equip de Redestina ho revisarà i, llavors, es generaran els albarans.")
          + (es
            ? "\nSi no has podido ir o no tienes acceso al panel, avisa al equipo de Redestina."
            : "\nSi no hi has pogut anar o no tens accés al panell, avisa l’equip de Redestina."),
        boton: es ? "Registrar la recogida" : "Registrar la recollida",
        ruta: "/receptor/interessos",
      };
    }
    case "recollida_retornada": {
      // 17-10-2026: el equipo revisa los kilos que declara el receptor y, si no cuadran, le
      // devuelve el registro con un motivo para que lo vuelva a hacer. Va a la entidad.
      const motiu = s(params.motiu);
      const declarats = params.kg_declarats != null && params.kg_declarats !== ""
        && Number.isFinite(Number(params.kg_declarats));
      return {
        asunto: es ? `Vuelve a registrar la recogida de ${producte}` : `Torna a registrar la recollida ${deProducte(producte)}`,
        titulo: es ? "Recogida por volver a registrar" : "Recollida per tornar a registrar",
        cuerpo: (es
          ? `El equipo de Redestina ha revisado el registro de la recogida de ${producte}`
          : `L’equip de Redestina ha revisat el registre de la recollida ${deProducte(producte)}`)
          + (declarats
            ? (es
              ? ` (${kg(params.kg_declarats, idioma)} kg declarados) y necesita que lo vuelvas a registrar.`
              : ` (${kg(params.kg_declarats, idioma)} kg declarats) i necessita que el tornis a registrar.`)
            : (es ? " y necesita que lo vuelvas a registrar." : " i necessita que el tornis a registrar."))
          + (motiu ? `\n${es ? "Motivo" : "Motiu"}: ${motiu}` : "")
          + (es
            ? "\nEntra en la ficha de la operación y registra de nuevo los kilos que te has llevado."
            : "\nEntra a la fitxa de l’operació i registra de nou els quilos que t’has endut."),
        boton: es ? "Registrar la recogida" : "Registrar la recollida",
        ruta: "/receptor/interessos",
      };
    }
    case "oferta_modificada":
      return {
        asunto: es ? `La oferta de ${producte} ha cambiado` : `L’oferta ${deProducte(producte)} ha canviat`,
        titulo: es ? "Oferta modificada" : "Oferta modificada",
        cuerpo: es
          ? `La entidad productora ha modificado la oferta de ${producte}. Revisa los datos antes de la recogida.`
          : `L’entitat productora ha modificat l’oferta ${deProducte(producte)}. Revisa’n les dades abans de la recollida.`,
        boton: botoParts,
        ruta: rutaParts,
      };
    case "certificat_per_revisar": {
      // Fase 4 de la revisión del 08-10-2026: el certificado se revisa antes de firmarse.
      const any = s(params.exercici);
      const euros = new Intl.NumberFormat(es ? "es-ES" : "ca-ES", { style: "currency", currency: "EUR" })
        .format(Number(params.valor ?? 0));
      return {
        asunto: es ? `Revisa tu certificado de donación ${any}` : `Revisa el teu certificat de donació ${any}`,
        titulo: es ? "Certificado por revisar" : "Certificat per revisar",
        cuerpo: es
          ? `Tenemos preparado tu certificado de donación ${any}: ${kg(params.kg, idioma)} kg, con un valor de ${euros}.\nRevísalo y apruébalo; después lo firmaremos y te lo enviaremos.`
          : `Tenim preparat el teu certificat de donació ${any}: ${kg(params.kg, idioma)} kg, amb un valor de ${euros}.\nRevisa’l i aprova’l; després el signarem i te l’enviarem.`,
        boton: es ? "Revisar el certificado" : "Revisar el certificat",
        ruta: "/productor/documents",
      };
    }
    case "oferta_enviada":
      return {
        asunto: es ? `Una oferta para ti: ${producte}` : `Una oferta per a tu: ${producte}`,
        titulo: es ? "Oferta para ti" : "Oferta per a tu",
        cuerpo: es
          ? `El equipo de Redestina te propone ${kg(params.kg, idioma)} kg de ${producte}. Dinos si te interesa.`
          : `L’equip de Redestina et proposa ${kg(params.kg, idioma)} kg ${deProducte(producte)}. Digues-nos si t’interessa.`,
        boton: es ? "Ver la oferta" : "Veure l’oferta",
        ruta: "/receptor/interessos",
      };
    case "oferta_validada":
      return {
        asunto: es ? `Tu oferta de ${producte} ya está publicada` : `La teva oferta ${deProducte(producte)} ja està publicada`,
        titulo: es ? "Oferta publicada" : "Oferta publicada",
        cuerpo: es
          ? `El equipo de Redestina ha revisado tu oferta de ${producte} y ya la pueden ver las entidades.`
          : `L’equip de Redestina ha revisat la teva oferta ${deProducte(producte)} i ja la poden veure les entitats.`,
        boton: es ? "Ver la oferta" : "Veure l’oferta",
        ruta: `/productor/ofertes/${objecteId}`,
      };
    case "oferta_rebutjada": {
      const motiu = s(params.motiu);
      return {
        asunto: es ? `No hemos publicado tu oferta de ${producte}` : `No hem publicat la teva oferta ${deProducte(producte)}`,
        titulo: es ? "Oferta no publicada" : "Oferta no publicada",
        cuerpo: (es
          ? `El equipo de Redestina no ha publicado tu oferta de ${producte}.`
          : `L’equip de Redestina no ha publicat la teva oferta ${deProducte(producte)}.`)
          + (motiu ? `\n${es ? "Motivo" : "Motiu"}: ${motiu}` : ""),
        boton: es ? "Ver la oferta" : "Veure l’oferta",
        ruta: `/productor/ofertes/${objecteId}`,
      };
    }
    case "sortida_trobada": {
      const entitat = s(params.entitat);
      // Venda ≠ donació (revisión del 08-10-2026, §5): en una venta Redestina pone en
      // contacto a las partes y son ellas las que acuerdan la operación; en una donación la
      // recogida la coordina el equipo.
      const venda = s(params.modalitat) === "venda" || s(params.modalitat) === "maquila";
      return {
        asunto: es ? `Hemos encontrado salida para tu ${producte}` : `Hem trobat sortida per al teu ${producte}`,
        titulo: es ? "Salida encontrada" : "Sortida trobada",
        cuerpo: (es
          ? `Se han asignado ${kg(params.kg, idioma)} kg de ${producte}`
          : `S’han assignat ${kg(params.kg, idioma)} kg ${deProducte(producte)}`)
          + (entitat ? (es ? ` a ${entitat}.` : ` a ${entitat}.`) : ".")
          + (venda
            ? (es
              ? `\n${entitat || "La empresa"} ha aceptado tu oferta. Contacta con ella para acordar la venta y, después, indica en Redestina qué ha pasado con los kilos.`
              : `\n${entitat || "L’empresa"} ha acceptat la teva oferta. Contacta-hi per acordar la venda i, després, indica a Redestina què ha passat amb els quilos.`)
            : (es
              ? "\nEl equipo de Redestina coordina la recogida y te dirá día y hora."
              : "\nL’equip de Redestina coordina la recollida i et dirà dia i hora.")),
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
          : `T’hem assignat ${kg(apr, idioma)} kg ${deProducte(producte)}.`,
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
    case "oferta_sense_desti": {
      const quants = kg(params.kg, idioma);
      return {
        asunto: es ? `¿Qué ha pasado con tu ${producte}?` : `Què ha passat amb el teu ${producte}?`,
        titulo: es ? "Oferta sin destino registrado" : "Oferta sense destí registrat",
        cuerpo: es
          ? `Ha pasado la fecha límite de tu oferta de ${producte} y todavía no hay destino registrado para ${quants} kg.\nIndica qué ha pasado finalmente con el producto (venta, donación, compostaje…) para cerrar la oferta.`
          : `Ha passat la data límit de la teva oferta ${deProducte(producte)} i encara no hi ha destí registrat per a ${quants} kg.\nIndica què ha passat finalment amb el producte (venda, donació, compostatge…) per tancar l’oferta.`,
        boton: es ? "Indicar el destino" : "Indicar el destí",
        ruta: `/productor/ofertes/${objecteId}`,
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

/**
 * El WhatsApp de un aviso, EXACTAMENTE como lo manda `enviar-avis` (27-10-2026). Existe para
 * que el panel del equipo pueda enseñar y copiar el mismo texto cuando las notificaciones
 * están apagadas y hay que avisar a mano: si `enviar-avis` lo compusiera por su cuenta, las
 * dos versiones divergirían en semanas (R4 del plan de gestión autónoma).
 */
export function formatWhatsappAvis(t: TextAvis, appUrl: string): string {
  return `*${t.titulo}*\n\n${t.cuerpo}\n\n${appUrl}${t.ruta}`;
}

/** El texto plano del correo de un aviso (lo que `enviar-avis` pasa como `text`). */
export function formatTextAvisCorreu(t: TextAvis, appUrl: string): string {
  return `${t.cuerpo}\n\n${appUrl}${t.ruta}`;
}
