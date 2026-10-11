// El PDF del EXPEDIENTE de prevención (fase 11 de la revisión del 08-10-2026): el Pla de
// Prevenció como servicio, no como formulario. Se emite como `documentos` tipo `PLA` con
// `objeto_tipo = 'expedient'` y el snapshot de `expedient_datos()` (`format: 'expedient'`).
//
// Estructura: la del Excel «Estructura servicio planes de prevención» de la Fundació —
// portada y datos, contexto, objetivos estratégicos y equipo, visitas, procesos y puntos
// críticos, cuantificación (por año, con la comparativa), causas, objetivos y acciones,
// seguimiento trimestral y verificación anual.
//
// ⚠️ PROVISIONAL HASTA QUE LLEGUE EL MODELO PPPMA: el PDF lo dice en una caja arriba.

import { PDFDocument } from "npm:pdf-lib@1";
import { type BytesActivos, embeberFuentes, embeberLogo } from "../fuentes.ts";
import { COLORES, type Columna, Maquetador } from "../maquetador.ts";
import { num } from "./comu.ts";
import {
  codigoVerificacion,
  domicilioCompleto,
  fechaLarga,
  type OrganizacionCierre,
  paresLlenos,
  type Renderizado,
} from "./cierre.ts";
import { avancAccions, comparativaAnual } from "../../expedient.ts";

type Fila = Record<string, unknown>;

export interface DatosExpedient {
  format: "expedient";
  nivell?: string | null;
  estat?: string | null;
  numero?: string | null;
  versio?: number | null;
  exercici?: number | null;
  data_generacio?: string | null;
  data_inici?: string | null;
  lloc?: string | null;
  fundacio?: OrganizacionCierre | null;
  organitzacio?: { nom?: string; rao_social?: string; nif?: string; poblacio?: string; comarca?: string; email?: string } | null;
  tecnic?: string | null;
  objectius_estrategics?: string[] | null;
  context?: string | null;
  equip?: { nom?: string; carrec?: string }[] | null;
  mesures_pla_basic?: { titol?: string; obligatoria?: boolean }[] | null;
  visites?: Fila[];
  processos?: Fila[];
  quantificacio?: Fila[];
  objectius?: Fila[];
  accions?: Fila[];
  seguiments?: Fila[];
  verificacions?: Fila[];
}

export interface OpcionesExpedient {
  datos: DatosExpedient;
  sha256Datos?: string | null;
  modo?: "real" | "prueba";
}

const MESES: Record<"ca" | "es", string[]> = {
  ca: ["gener", "febrer", "març", "abril", "maig", "juny", "juliol", "agost", "setembre", "octubre", "novembre", "desembre"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

const CA = {
  titulo: "Pla de prevenció de pèrdues i malbaratament alimentari",
  subtitulo: "Expedient de seguiment del servei de prevenció de REDESTINA",
  provisional_t: "Estructura provisional",
  provisional: "Aquest document segueix l'estructura provisional del servei. El model definitiu (PPPMA) el facilitarà la Fundació.",
  numero: "Número", versio: "Versió", nivell: "Nivell", estat: "Estat", inici: "Data d'inici",
  data: "Data d'emissió", dia: "Data", codi: "Codi de verificació", tecnic: "Tècnic/a de referència",
  basic: "Bàsic", personalitzat: "Personalitzat",
  estats: { obert: "Obert", en_seguiment: "En seguiment", verificat: "Verificat", tancat: "Tancat" } as Record<string, string>,
  org: "Organització", emet: "Emet", nom: "Nom", rao: "Raó social", nif: "NIF", poblacio: "Població",
  comarca: "Comarca", correu: "Correu", cif: "CIF", domicili: "Domicili",
  context: "Context", objectius_est: "Objectius estratègics", equip: "Equip de treball", carrec: "Càrrec",
  visites: "Visites tècniques", tipus: "Tipus", notes: "Notes", assistents: "Assistents",
  tipus_visita: { diagnosi: "Diagnosi", seguiment: "Seguiment", verificacio: "Verificació", altres: "Altres" } as Record<string, string>,
  processos: "Processos i punts crítics", proces: "Procés", descripcio: "Descripció", punts: "Punts crítics",
  quant: "Quantificació", quant_any: "Per any", any: "Any", perdua: "Pèrdua", excedent: "Excedent", residu: "Residu",
  total: "Total", variacio: "Variació", quant_det: "Detall", mes: "Mes", producte: "Producte",
  categoria: "Categoria", kg: "Kg", desti: "Destí", font: "Font", manual: "Manual", redestina: "Redestina",
  causes: "Anàlisi de causes", causa: "Causa", vegades: "Registres",
  objectius: "Objectius", indicador: "Indicador", inicial: "Inicial", objectiu: "Objectiu", data_obj: "Data objectiu",
  accions: "Pla d'accions", mesura: "Mesura", responsable: "Responsable",
  estats_accio: { pendent: "Pendent", en_curs: "En curs", feta: "Feta", descartada: "Descartada" } as Record<string, string>,
  avanc: (f: number, t: number, p: number) => `Accions fetes: ${f} de ${t} (${p} %).`,
  seguiment: "Seguiment trimestral", trimestre: "Trimestre", resum: "Resum",
  verificacio: "Verificació anual", conclusio: "Conclusió",
  mesures: "Mesures del pla bàsic", obligatoria: "obligatòria", recomanada: "recomanada",
  buit: "Sense registres.", peu: "Fundació Espigoladors · REDESTINA",
  pagina: (n: number, t: number) => `pàg. ${n} de ${t}`, marca: "PROVA",
};
const ES: typeof CA = {
  titulo: "Plan de prevención de pérdidas y desperdicio alimentario",
  subtitulo: "Expediente de seguimiento del servicio de prevención de REDESTINA",
  provisional_t: "Estructura provisional",
  provisional: "Este documento sigue la estructura provisional del servicio. El modelo definitivo (PPPMA) lo facilitará la Fundació.",
  numero: "Número", versio: "Versión", nivell: "Nivel", estat: "Estado", inici: "Fecha de inicio",
  data: "Fecha de emisión", dia: "Fecha", codi: "Código de verificación", tecnic: "Técnico/a de referencia",
  basic: "Básico", personalitzat: "Personalizado",
  estats: { obert: "Abierto", en_seguiment: "En seguimiento", verificat: "Verificado", tancat: "Cerrado" },
  org: "Organización", emet: "Emite", nom: "Nombre", rao: "Razón social", nif: "NIF", poblacio: "Población",
  comarca: "Comarca", correu: "Correo", cif: "CIF", domicili: "Domicilio",
  context: "Contexto", objectius_est: "Objetivos estratégicos", equip: "Equipo de trabajo", carrec: "Cargo",
  visites: "Visitas técnicas", tipus: "Tipo", notes: "Notas", assistents: "Asistentes",
  tipus_visita: { diagnosi: "Diagnosis", seguiment: "Seguimiento", verificacio: "Verificación", altres: "Otras" },
  processos: "Procesos y puntos críticos", proces: "Proceso", descripcio: "Descripción", punts: "Puntos críticos",
  quant: "Cuantificación", quant_any: "Por año", any: "Año", perdua: "Pérdida", excedent: "Excedente", residu: "Residuo",
  total: "Total", variacio: "Variación", quant_det: "Detalle", mes: "Mes", producte: "Producto",
  categoria: "Categoría", kg: "Kg", desti: "Destino", font: "Fuente", manual: "Manual", redestina: "Redestina",
  causes: "Análisis de causas", causa: "Causa", vegades: "Registros",
  objectius: "Objetivos", indicador: "Indicador", inicial: "Inicial", objectiu: "Objetivo", data_obj: "Fecha objetivo",
  accions: "Plan de acciones", mesura: "Medida", responsable: "Responsable",
  estats_accio: { pendent: "Pendiente", en_curs: "En curso", feta: "Hecha", descartada: "Descartada" },
  avanc: (f: number, t: number, p: number) => `Acciones hechas: ${f} de ${t} (${p} %).`,
  seguiment: "Seguimiento trimestral", trimestre: "Trimestre", resum: "Resumen",
  verificacio: "Verificación anual", conclusio: "Conclusión",
  mesures: "Medidas del plan básico", obligatoria: "obligatoria", recomanada: "recomendada",
  buit: "Sin registros.", peu: "Fundació Espigoladors · REDESTINA",
  pagina: (n: number, t: number) => `pág. ${n} de ${t}`, marca: "PRUEBA",
};

const txt = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const dataCurta = (v: unknown): string => {
  const s = txt(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
};

export async function renderExpedient(
  activos: BytesActivos,
  op: OpcionesExpedient,
  idioma?: string | null,
): Promise<Renderizado> {
  const lengua: "ca" | "es" = idioma === "es" ? "es" : "ca";
  const t = lengua === "es" ? ES : CA;
  const d = op.datos;
  const numero = d.numero ?? "";

  const doc = await PDFDocument.create();
  doc.setTitle(`${numero} · ${t.titulo}`.trim());
  doc.setProducer("Redestina");
  doc.setCreator("Redestina");
  const fuentes = await embeberFuentes(doc, activos);
  const logo = await embeberLogo(doc, activos);
  const m = new Maquetador(doc, {
    fuentes,
    logo,
    cabecera: numero,
    subcabecera: t.titulo,
    pie: `${t.peu}${numero ? ` · ${numero}` : ""}`,
    marcaAgua: op.modo === "prueba" ? { texto: t.marca } : null,
    paginacion: t.pagina,
  });

  const taula = (columnas: Columna[], filas: (string | number | null | undefined)[][]) => {
    if (filas.length === 0) {
      m.parrafo(t.buit, { color: COLORES.verdeGris, tamano: 9.5, despues: 6 });
      return;
    }
    m.tabla({ columnas, filas, cebra: true, tamano: 9, despues: 8 });
  };

  // ---------------------------------------------------------------- portada
  m.titulo(t.titulo, 1);
  m.parrafo(t.subtitulo, { color: COLORES.verdeGris, tamano: 10, despues: 10 });
  m.campos(paresLlenos([
    [t.numero, numero],
    [t.versio, d.versio],
    [t.nivell, d.nivell === "personalitzat" ? t.personalitzat : t.basic],
    [t.estat, t.estats[txt(d.estat)] ?? txt(d.estat)],
    [t.inici, dataCurta(d.data_inici)],
    [t.data, fechaLarga(d.data_generacio, { mesos: MESES[lengua] }, lengua)],
    [t.tecnic, d.tecnic],
    [t.codi, codigoVerificacion(op.sha256Datos)],
  ]), { anchoEtiqueta: 160, despues: 8 });
  m.caja(t.provisional, { titulo: t.provisional_t, fondo: COLORES.crema, barra: COLORES.coral });

  // ------------------------------------------------------------- las partes
  m.espacio(6);
  m.titulo(t.org, 3);
  const o = d.organitzacio ?? {};
  m.campos(paresLlenos([
    [t.nom, o.nom], [t.rao, o.rao_social], [t.nif, o.nif], [t.poblacio, o.poblacio],
    [t.comarca, o.comarca], [t.correu, o.email],
  ]), { anchoEtiqueta: 160, tamano: 9.5, despues: 4 });
  m.titulo(t.emet, 3);
  const f = d.fundacio;
  m.campos(paresLlenos([
    [t.rao, f?.["raó_social"]], [t.cif, f?.cif], [t.domicili, domicilioCompleto(f)],
  ]), { anchoEtiqueta: 160, tamano: 9.5, despues: 4 });

  // ----------------------------------------------- contexto, objetivos, equipo
  m.titulo(t.context, 2);
  m.parrafo(txt(d.context) || t.buit, { tamano: 9.5, despues: 6 });
  m.titulo(t.objectius_est, 2);
  const est = (d.objectius_estrategics ?? []).map(txt).filter(Boolean);
  if (est.length > 0) m.lista(est, { tamano: 9.5, despues: 6 });
  else m.parrafo(t.buit, { color: COLORES.verdeGris, tamano: 9.5, despues: 6 });
  m.titulo(t.equip, 3);
  taula([{ titulo: t.nom, ancho: 55 }, { titulo: t.carrec, ancho: 45 }],
    (d.equip ?? []).map((e) => [txt(e.nom), txt(e.carrec)]));

  // ------------------------------------------------------------- visitas
  m.titulo(t.visites, 2);
  taula([
    { titulo: t.dia, ancho: 16 }, { titulo: t.tipus, ancho: 16 },
    { titulo: t.assistents, ancho: 24 }, { titulo: t.notes, ancho: 44 },
  ], (d.visites ?? []).map((v) => [dataCurta(v.data), t.tipus_visita[txt(v.tipus)] ?? txt(v.tipus), txt(v.assistents), txt(v.notes)]));

  // ------------------------------------------------- procesos y puntos críticos
  m.titulo(t.processos, 2);
  taula([{ titulo: t.proces, ancho: 25 }, { titulo: t.descripcio, ancho: 40 }, { titulo: t.punts, ancho: 35 }],
    (d.processos ?? []).map((p) => [txt(p.nom), txt(p.descripcio), txt(p.punts_critics)]));

  // ------------------------------------------------------- cuantificación
  const quant = (d.quantificacio ?? []).map((q) => ({
    mes: txt(q.mes), kg: Number(q.kg) || 0, categoria: txt(q.categoria),
    producte: txt(q.producte), desti: txt(q.desti), causa: txt(q.causa), font: txt(q.font),
  }));
  m.titulo(t.quant, 2);
  m.titulo(t.quant_any, 3);
  taula([
    { titulo: t.any, ancho: 12 }, { titulo: t.perdua, ancho: 17, alinear: "derecha" },
    { titulo: t.excedent, ancho: 17, alinear: "derecha" }, { titulo: t.residu, ancho: 17, alinear: "derecha" },
    { titulo: t.total, ancho: 19, alinear: "derecha" }, { titulo: t.variacio, ancho: 18, alinear: "derecha" },
  ], comparativaAnual(quant).map((a) => [
    String(a.any), num(a.perdua, 0), num(a.excedent, 0), num(a.residu, 0), num(a.total, 0),
    a.variacio === null ? "—" : `${a.variacio > 0 ? "+" : ""}${num(a.variacio, 1)} %`,
  ]));
  m.titulo(t.quant_det, 3);
  const cat: Record<string, string> = { perdua: t.perdua, excedent: t.excedent, residu: t.residu };
  taula([
    { titulo: t.mes, ancho: 12 }, { titulo: t.producte, ancho: 18 }, { titulo: t.categoria, ancho: 14 },
    { titulo: t.kg, ancho: 12, alinear: "derecha" }, { titulo: t.desti, ancho: 26 }, { titulo: t.font, ancho: 18 },
  ], quant.map((q) => [q.mes.slice(0, 7), q.producte, cat[q.categoria] ?? q.categoria, num(q.kg, 0), q.desti,
    q.font === "redestina" ? t.redestina : t.manual]));

  // ------------------------------------------------------------- causas
  m.titulo(t.causes, 2);
  const causes = new Map<string, { n: number; kg: number }>();
  for (const q of quant) {
    if (!q.causa) continue;
    const c = causes.get(q.causa) ?? { n: 0, kg: 0 };
    c.n += 1; c.kg += q.kg;
    causes.set(q.causa, c);
  }
  for (const a of d.accions ?? []) {
    const k = txt(a.causa);
    if (!k) continue;
    const c = causes.get(k) ?? { n: 0, kg: 0 };
    c.n += 1;
    causes.set(k, c);
  }
  taula([{ titulo: t.causa, ancho: 60 }, { titulo: t.vegades, ancho: 20, alinear: "derecha" }, { titulo: t.kg, ancho: 20, alinear: "derecha" }],
    [...causes.entries()].sort((x, y) => y[1].kg - x[1].kg).map(([k, v]) => [k, String(v.n), v.kg > 0 ? num(v.kg, 0) : "—"]));

  // ----------------------------------------------------- objetivos y acciones
  m.titulo(t.objectius, 2);
  taula([
    { titulo: t.descripcio, ancho: 34 }, { titulo: t.indicador, ancho: 20 },
    { titulo: t.inicial, ancho: 14, alinear: "derecha" }, { titulo: t.objectiu, ancho: 14, alinear: "derecha" },
    { titulo: t.data_obj, ancho: 18 },
  ], (d.objectius ?? []).map((ob) => [txt(ob.descripcio), txt(ob.indicador),
    `${num(ob.valor_inicial, 0)} ${txt(ob.unitat)}`.trim(), `${num(ob.valor_objectiu, 0)} ${txt(ob.unitat)}`.trim(),
    dataCurta(ob.data_objectiu)]));
  m.titulo(t.accions, 2);
  const av = avancAccions((d.accions ?? []).map((a) => ({ estat: txt(a.estat) })));
  if (av.total > 0) m.parrafo(t.avanc(av.fetes, av.total, av.pct), { tamano: 9.5, despues: 4 });
  taula([
    { titulo: t.mesura, ancho: 32 }, { titulo: t.causa, ancho: 20 }, { titulo: t.responsable, ancho: 18 },
    { titulo: t.data_obj, ancho: 15 }, { titulo: t.estat, ancho: 15 },
  ], (d.accions ?? []).map((a) => [txt(a.mesura), txt(a.causa), txt(a.responsable), dataCurta(a.data_objectiu),
    t.estats_accio[txt(a.estat)] ?? txt(a.estat)]));

  // ------------------------------------------------- seguimiento y verificación
  m.titulo(t.seguiment, 2);
  taula([{ titulo: t.trimestre, ancho: 15 }, { titulo: t.dia, ancho: 15 }, { titulo: t.resum, ancho: 40 }, { titulo: t.notes, ancho: 30 }],
    (d.seguiments ?? []).map((s) => [txt(s.trimestre), dataCurta(s.data), txt(s.resum), txt(s.notes)]));
  m.titulo(t.verificacio, 2);
  taula([{ titulo: t.any, ancho: 12 }, { titulo: t.dia, ancho: 16 }, { titulo: t.resum, ancho: 36 }, { titulo: t.conclusio, ancho: 36 }],
    (d.verificacions ?? []).map((v) => [txt(v.any), dataCurta(v.data), txt(v.resum), txt(v.conclusio)]));

  // --------------------------------------------- las medidas del plan básico
  const mesures = (d.mesures_pla_basic ?? []).filter((x) => txt(x.titol));
  if (mesures.length > 0) {
    m.titulo(t.mesures, 2);
    m.lista(mesures.map((x) => `${txt(x.titol)} (${x.obligatoria ? t.obligatoria : t.recomanada})`), { tamano: 9.5, despues: 6 });
  }

  const lugar = txt(d.lloc);
  const fecha = fechaLarga(d.data_generacio, { mesos: MESES[lengua] }, lengua);
  if (lugar || fecha) {
    m.espacio(10);
    m.parrafo([lugar, fecha].filter(Boolean).join(", "), { color: COLORES.verdeGris, tamano: 9.5, despues: 4 });
  }

  m.finalizar();
  const bytes = await doc.save();
  return { bytes, paginas: m.numPaginas };
}
