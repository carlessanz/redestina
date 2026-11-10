// El PDF del DIAGNÒSTIC OPERATIU de un productor, bajo demanda (Plan 2, A2, 10-11-2026).
//
// 🔴 D2: **no es un documento emitido.** No hay fila en `documentos`, ni número, ni serie, ni
//    código de verificación, ni fichero en el bucket: se renderiza al pedirlo con el estado
//    de AHORA (`diagnostic_datos()`) y se devuelve tal cual al navegador
//    (`supabase/functions/diagnostic-pdf`). Por eso el pie lleva solo «<Fundació> ·
//    REDESTINA» y el documento dice, en una caja, que es informativo.
//
// Qué imprime, en el orden del resumen de la pantalla (`ResumDiagnostic`), para que el papel
// y la pantalla no cuenten lo mismo de dos maneras:
//   1. organización, cuándo se ha generado y cuándo (y quién) lo actualizó, estado;
//   2. la OPERATIVA de la ficha (A4: `diagnostic_datos().operativa`), con `filesOperativa()`
//      del módulo hoja `_shared/operativaLlegible.ts` —la misma función que la pantalla— y
//      sus etiquetas `ETIQUETES_OPERATIVA` (copia vigilada de `i18n.tsx`);
//   3. los EXCEDENTES por producto y causa (A3, `20270522100000`: `diagnostic_datos().excedents`),
//      con las funciones del módulo hoja `_shared/excedentsLlegible.ts` —las mismas que la
//      pantalla y que la sección «Diagnòstic operatiu» del expediente— y `ETIQUETES_EXCEDENTS`
//      (copia vigilada de `i18n.tsx`): por producto, «Sense excedent» o la tabla de causas
//      (Causa | Freqüència | Volum | Gestió actual | Destins) y la de acciones
//      (Causa | Destí | Acció | Estat, con la nota de seguimiento en la celda de la acción),
//      y sus observaciones; los productos que ya no son principales salen al final, marcados;
//   4. SOLO si el productor no tiene todavía ningún bloque de excedentes, las respuestas del
//      cuestionario v3 (legado, `respostes`) bajo «Respostes del qüestionari anterior», con
//      `respostesLlegibles()` de `pla.ts`; con bloques, no se imprimen;
//   5. las notas.

import { PDFDocument } from "npm:pdf-lib@1";
import { type BytesActivos, embeberFuentes, embeberLogo } from "../fuentes.ts";
import { COLORES, type Columna, Maquetador } from "../maquetador.ts";
import { fechaLargaConArticulo, paresLlenos, type Renderizado } from "./cierre.ts";
import { peuFundacio } from "../fundacio.ts";
import { respostesLlegibles } from "./pla.ts";
import {
  filesOperativa,
  type OperativaLlegible,
  traduccioOperativa,
} from "../../operativaLlegible.ts";
import {
  blocsExcedents,
  celaAccio,
  celaCausa,
  filesAccions,
  filesCausa,
  titolBloc,
  traduccioExcedents,
} from "../../excedentsLlegible.ts";

/** Lo que devuelve `diagnostic_datos(p_tipo_org, p_org, p_user)` (A1 + A4 + A3). */
export interface DatosDiagnostic {
  diagnostic_id?: string | null;
  organitzacio?: { nom?: string | null; nif?: string | null; municipi?: string | null } | null;
  operativa?: OperativaLlegible | null;
  questionari?: { titol?: unknown; versio?: number | null; provisional?: boolean | null } | null;
  /** Autocontenidas (`diagnostics.sobre.respostes`): `{id, tipus, seccio, pregunta:{ca,es}, valor, …}`. */
  respostes?: unknown[] | null;
  /**
   * A3: los bloques de excedentes (`diagnostic_excedents_json()`), forma
   * `BlocExcedentsLlegible[]` de `_shared/excedentsLlegible.ts`. Llega como JSON y se normaliza
   * con `blocsExcedents()` (lo que no encaja se descarta sin lanzar).
   */
  excedents?: unknown[] | null;
  notes?: string | null;
  complet?: boolean | null;
  falten?: string[] | null;
  actualitzat_at?: string | null;
  actualitzat_per_nom?: string | null;
  provisional?: boolean | null;
}

export interface OpcionesDiagnostic {
  datos: DatosDiagnostic;
  /** Cuándo se pide (`YYYY-MM-DD`, hora de Madrid). Por defecto, hoy. */
  generatEl?: string;
  /** Código del catálogo `tipus_activitat` → nombre en el idioma del PDF. */
  nomActivitat?: (codi: string) => string;
}

const MESES: Record<"ca" | "es", string[]> = {
  ca: ["gener", "febrer", "març", "abril", "maig", "juny", "juliol", "agost", "setembre", "octubre", "novembre", "desembre"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

const CA = {
  titulo: "Diagnòstic operatiu",
  org: "Organització", nif: "NIF", municipi: "Municipi", estat: "Estat",
  estats: { complet: "Contestat", incomplet: "Incomplet", sense: "Sense començar" },
  generat: (d: string) => `Generat ${d}.`,
  actualitzat: (d: string) => `Actualitzat ${d}.`,
  actualitzat_per: (d: string, n: string) => `Actualitzat ${d} per ${n}.`,
  falten: (n: number) => (n === 1 ? "Falta 1 dada per completar-lo." : `Falten ${n} dades per completar-lo.`),
  informatiu_t: "Document informatiu",
  informatiu: "Aquest document es genera a demanda amb les dades d’avui: no té número ni codi de verificació i no substitueix cap document emès.",
  provisional: "El qüestionari del diagnòstic és text de treball: encara no l’han validat la Fundació ni l’assessoria.",
  operativa: "Operativa",
  dada: "Dada", valor: "Valor", pregunta: "Pregunta", resposta: "Resposta",
  notes: "Notes",
  buit: "Encara no hi ha cap resposta del diagnòstic. L’actualitza l’equip de REDESTINA amb l’organització.",
  pagina: (n: number, t: number) => `pàg. ${n} de ${t}`,
};
const ES: typeof CA = {
  titulo: "Diagnóstico operativo",
  org: "Organización", nif: "NIF", municipi: "Municipio", estat: "Estado",
  estats: { complet: "Contestado", incomplet: "Incompleto", sense: "Sin empezar" },
  generat: (d: string) => `Generado ${d}.`,
  actualitzat: (d: string) => `Actualizado ${d}.`,
  actualitzat_per: (d: string, n: string) => `Actualizado ${d} por ${n}.`,
  falten: (n: number) => (n === 1 ? "Falta 1 dato para completarlo." : `Faltan ${n} datos para completarlo.`),
  informatiu_t: "Documento informativo",
  informatiu: "Este documento se genera a demanda con los datos de hoy: no tiene número ni código de verificación y no sustituye a ningún documento emitido.",
  provisional: "El cuestionario del diagnóstico es texto de trabajo: todavía no lo han validado la Fundació ni la asesoría.",
  operativa: "Operativa",
  dada: "Dato", valor: "Valor", pregunta: "Pregunta", resposta: "Respuesta",
  notes: "Notas",
  buit: "Todavía no hay ninguna respuesta del diagnóstico. Lo actualiza el equipo de REDESTINA con la organización.",
  pagina: (n: number, t: number) => `pág. ${n} de ${t}`,
};

const txt = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** Hoy en Madrid, `YYYY-MM-DD` (la función corre en UTC: a las 00:30 de Madrid aún sería ayer). */
export function avuiMadrid(ara: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(ara);
}

/**
 * `diagnostic-<organització>.pdf`, en minúsculas y sin acentos ni signos: el nombre lo guarda
 * el navegador tal cual, y una barra o unas comillas ahí rompen la descarga.
 */
export function nomFitxerDiagnostic(nom: string | null | undefined): string {
  const slug = txt(nom)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/g, "");
  return slug ? `diagnostic-${slug}.pdf` : "diagnostic.pdf";
}

export async function renderDiagnostic(
  activos: BytesActivos,
  op: OpcionesDiagnostic,
  idioma?: string | null,
): Promise<Renderizado> {
  const lengua: "ca" | "es" = idioma === "es" ? "es" : "ca";
  const t = lengua === "es" ? ES : CA;
  const d = op.datos;
  const o = d.organitzacio ?? {};
  const nomOrg = txt(o.nom);
  const conMeses = { mesos: MESES[lengua] };

  const doc = await PDFDocument.create();
  doc.setTitle(`${t.titulo}${nomOrg ? ` · ${nomOrg}` : ""}`);
  doc.setProducer("Redestina");
  doc.setCreator("Redestina");
  const fuentes = await embeberFuentes(doc, activos);
  const logo = await embeberLogo(doc, activos);
  const m = new Maquetador(doc, {
    fuentes,
    logo,
    // Sin número: la cabecera dice qué es y de quién.
    cabecera: t.titulo,
    subcabecera: nomOrg,
    // `diagnostic_datos()` no trae la Fundació: el pie cae a su nombre por defecto.
    pie: peuFundacio(null),
    paginacion: t.pagina,
  });

  const taula = (columnas: Columna[], filas: string[][]) =>
    m.tabla({ columnas, filas, cebra: true, tamano: 9, despues: 8 });

  // ------------------------------------------------------------- cabecera
  m.titulo(nomOrg ? `${t.titulo} · ${nomOrg}` : t.titulo, 1);
  const tieneRespuestas = Boolean(d.diagnostic_id);
  const estat = !tieneRespuestas ? t.estats.sense : d.complet ? t.estats.complet : t.estats.incomplet;
  m.campos(paresLlenos([
    [t.org, nomOrg],
    [t.nif, o.nif],
    [t.municipi, o.municipi],
    [t.estat, estat],
  ]), { anchoEtiqueta: 130, tamano: 9.5, despues: 4 });

  const generat = fechaLargaConArticulo(op.generatEl ?? avuiMadrid(), conMeses, lengua);
  const actualitzat = fechaLargaConArticulo(d.actualitzat_at ?? null, conMeses, lengua);
  const per = txt(d.actualitzat_per_nom);
  const linia = [
    generat ? t.generat(generat) : "",
    actualitzat ? (per ? t.actualitzat_per(actualitzat, per) : t.actualitzat(actualitzat)) : "",
  ].filter(Boolean).join(" ");
  if (linia) m.parrafo(linia, { color: COLORES.verdeGris, tamano: 9, despues: 4 });
  const falten = Array.isArray(d.falten) ? d.falten.length : 0;
  if (tieneRespuestas && !d.complet && falten > 0) {
    m.parrafo(t.falten(falten), { color: COLORES.verdeGris, tamano: 9, despues: 4 });
  }

  // A3: con bloques de excedentes, el cuestionario v3 ya no se imprime (ni su aviso).
  const blocs = blocsExcedents(d.excedents);
  const respostes = blocs.length > 0 ? [] : respostesLlegibles(d.respostes ?? [], lengua);

  // Siempre: no es un documento emitido (D2). Y, si se imprimen las respuestas de un
  // cuestionario provisional, se dice.
  const avisProvisional = Boolean(d.provisional) && respostes.length > 0;
  m.caja(avisProvisional ? `${t.informatiu} ${t.provisional}` : t.informatiu, {
    titulo: t.informatiu_t, fondo: COLORES.crema, barra: COLORES.coral,
  });

  // ------------------------------------------------------------ operativa
  const tOp = traduccioOperativa(lengua);
  const operativa = filesOperativa(d.operativa ?? null, tOp, lengua, op.nomActivitat);
  if (operativa.length > 0) {
    m.titulo(t.operativa, 2);
    taula(
      [{ titulo: t.dada, ancho: 34 }, { titulo: t.valor, ancho: 66 }],
      operativa.map((f) => [tOp(f.clau), f.text]),
    );
  }

  // ------------------------------------------------------------ excedentes
  // Por producto (los principales en su orden y los conservados al final, como los da la
  // base): «Sense excedent» o la tabla de causas, la de acciones y las observaciones.
  const tEx = traduccioExcedents(lengua);
  if (blocs.length > 0) {
    m.titulo(tEx("dexc.titol"), 2);
    // P7: los kilos son aproximados y por vez (la frecuencia va al lado).
    m.parrafo(tEx("dexc.volum_nota"), { color: COLORES.verdeGris, tamano: 9, despues: 2 });
    for (const b of blocs) {
      // El título, la cabecera y una fila de dos o tres líneas juntos: la tabla solo reserva
      // una fila de una línea y la cabecera se quedaba sola al pie.
      m.asegurar(100);
      m.titulo(titolBloc(b, tEx), 3);
      if (b.sense_excedent) {
        m.parrafo(tEx("dexc.sense_excedent"), { tamano: 9.5, despues: 4 });
      } else if (b.causes.length > 0) {
        taula([
          { titulo: tEx("dexc.causa"), ancho: 23 },
          { titulo: tEx("dexc.frequencia"), ancho: 18 },
          { titulo: tEx("dexc.volum_kg"), ancho: 15, alinear: "derecha" },
          { titulo: tEx("dexc.gestio"), ancho: 23 },
          { titulo: tEx("dexc.destins"), ancho: 21 },
        ], filesCausa(b, tEx, lengua).map((f) => [celaCausa(f, tEx), f.frequencia, f.volum, f.gestio, f.destins]));
        const accions = filesAccions(b, tEx, lengua);
        if (accions.length > 0) {
          m.asegurar(75);
          m.parrafo(tEx("dexc.accions"), { fuente: m.fuentes.titulo, color: COLORES.verde, tamano: 9.5, antes: 2, despues: 3 });
          taula([
            { titulo: tEx("dexc.causa"), ancho: 20 },
            { titulo: tEx("dexc.desti"), ancho: 14 },
            { titulo: tEx("dexc.accio"), ancho: 50 },
            { titulo: tEx("dexc.estat"), ancho: 16 },
          ], accions.map((f) => [f.causa, f.desti, celaAccio(f, tEx), f.estat]));
        }
      }
      if (b.observacions) {
        m.parrafo(`${tEx("dexc.observacions")}: ${b.observacions}`, { tamano: 9.5, despues: 6 });
      }
    }
  }

  // ------------------------------- respuestas del cuestionario anterior (legado v3)
  if (blocs.length === 0 && respostes.length === 0) {
    m.espacio(4);
    m.parrafo(t.buit, { color: COLORES.verdeGris, tamano: 9.5, despues: 6 });
  }
  if (respostes.length > 0) m.titulo(tEx("dexc.respostes_anteriors"), 2);
  let i = 0;
  while (i < respostes.length) {
    const seccio = respostes[i].seccio;
    const filas: string[][] = [];
    for (; i < respostes.length && respostes[i].seccio === seccio; i++) {
      filas.push([respostes[i].pregunta, respostes[i].resposta]);
    }
    m.titulo(seccio, 3);
    taula([{ titulo: t.pregunta, ancho: 50 }, { titulo: t.resposta, ancho: 50 }], filas);
  }

  // --------------------------------------------------------------- notas
  const notes = txt(d.notes);
  if (notes) {
    m.titulo(t.notes, 2);
    m.parrafo(notes, { tamano: 9.5, despues: 6 });
  }

  m.finalizar();
  const bytes = await doc.save();
  return { bytes, paginas: m.numPaginas };
}
