// Los campos de una oferta, en un solo sitio.
//
// El intake por WhatsApp (`intake.ts`) y el formulario del panel del productor
// preguntan exactamente lo mismo, así que la lista de pasos vive aquí y la usan los
// dos. El panel no la lleva escrita en TypeScript: la PIDE con
// `GET /functions/v1/crear-oferta/campos`. Es la única forma de que «el mismo
// formulario» siga siendo cierto dentro de seis meses.
//
// Las opciones salen siempre de las tablas (§6bis), nunca escritas a mano, salvo los
// vocabularios cerrados (formato de entrega, retorno, transporte, modalitat).
//
// Y por el mismo motivo viven aquí los TEXTOS que explican cada pregunta —la `ayuda` de
// cada campo, la `descripcion` de cada opción y las secciones en que se agrupan—: un
// texto escrito una vez sirve a los dos canales. Si la explicación de qué es una maquila
// se escribiera en la pantalla, el productor que publica por WhatsApp no la leería nunca.

/** Orden canónico de los pasos. `familia` solo sirve para acotar `producte`. */
export const PASOS = [
  "familia",
  "producte",
  "varietat",
  "producte_al_camp",
  "kg",
  "format_entrega",
  "caixes",
  "retorn",
  "transport",
  "ubicacio",
  "disponible_fins",
  "horari",
  "modalitat",
  "preu_minim",
  "cost_kg",
  "causa",
  "observacions",
] as const;

export type Paso = typeof PASOS[number];

/** Los cinco bloques del cuestionario. `PASOS` respeta este orden: una sección no se parte. */
export type SeccionOferta = "producte" | "quantitat" | "recollida" | "modalitat" | "causa";

export const SECCIONES: readonly { clau: SeccionOferta; titol: string; descripcio?: string }[] = [
  { clau: "producte", titol: "Producte" },
  {
    clau: "quantitat",
    titol: "Quantitat i envasos",
    descripcio: "N'hi ha prou amb una xifra aproximada: els kg definitius es pesen a la recollida.",
  },
  {
    clau: "recollida",
    titol: "Recollida",
    // No da por hecho que venga una entidad: puede ser venta, donación o maquila, y el
    // productor puede llevarlo él (revisión funcional del 23-09-2026).
    descripcio: "Com arriba el producte a qui el rep, i fins quan.",
  },
  {
    clau: "modalitat",
    titol: "Com vols donar-hi sortida",
    descripcio: "Decideix quines entitats la poden rebre i quin document es genera.",
  },
  {
    clau: "causa",
    titol: "Causa i observacions",
    descripcio: "Només per a estadística i per ajudar l'entitat.",
  },
];

/**
 * Cómo se entrega el producto (revisión funcional del 23-09-2026). Sustituye a la pregunta
 * «Quin tipus de caixa?» y su lista de seis modelos de caja, que el productor no sabía
 * contestar y que no decidía nada: las taras se fijan en el albarán, por línea.
 *
 * ⚠️ El `id` es lo que se guarda en `excedentes.format_entrega` (check en la base), así que
 *    tiene que sobrevivir a que alguien reescriba el título. Tope de 24/72 caracteres: el bot
 *    lo pregunta con una LISTA (son cuatro opciones y un mensaje de botones admite tres).
 */
export const FORMATS_ENTREGA = [
  { id: "caixes", titulo: "Caixes", descripcion: "En caixes, de qualsevol tipus." },
  { id: "palet", titulo: "Palet", descripcion: "Paletitzat." },
  {
    id: "envasos_propis",
    titulo: "Envasos de qui ho rep",
    descripcion: "Qui ho reculli ha de portar els seus envasos.",
  },
  { id: "altres", titulo: "Altres", descripcion: "Digue-ho a Observacions." },
];

/** Retorno de envases: sí o no. «Caixes pròpies» ya es un formato de entrega, no un retorno. */
export const OPCIONES_RETORN = ["Sí", "No"];

/** ¿El productor puede llevarlo? Si sí, no hace falta decir dónde se recoge. */
export const OPCIONS_TRANSPORT = [
  { id: "si", titulo: "Sí, el porto jo" },
  { id: "no", titulo: "No, cal recollir-lo" },
];

// «Producte al camp»: lo ofrecido TODAVÍA NO ESTÁ RECOGIDO y hay que ir a cosecharlo.
//
// No es un matiz descriptivo, decide un flujo (20260921221806): esa oferta la puede
// convertir el equipo en una jornada de espigueo con `crear_espigolada(p_excedente => …)`,
// reutilizando el excedente en vez de crear una segunda entrada del mismo producto. Y la
// entidad que la recibe tiene derecho a saberlo ANTES de mostrar interés: comprometerse a
// recoger 300 kg de un palot no es lo mismo que ir a un campo a cogerlos.
//
// ⚠️ Los `id` son `si`/`no` y no el título, al revés que `TIPOS_CAIXA` y `OPCIONES_RETORN`:
//    lo que se guarda es un boolean, así que el valor que viaja tiene que ser estable
//    aunque el título se reescriba. Lo traduce `esProducteAlCamp()` en `oferta.ts`, que es
//    el único sitio que decide qué es «sí».
//
// ⚠️ Mismo tope de 72 caracteres que `MODALITATS`: el intake lo pregunta con lista.
export const OPCIONS_AL_CAMP = [
  {
    id: "si",
    titulo: "Sí, és a la planta",
    descripcion: "Cal collir-ho. Es pot organitzar com a espigolada.",
  },
  {
    id: "no",
    titulo: "No, ja està collit",
    descripcion: "Ja està collit i a punt per recollir.",
  },
];

// La `descripcion` de estas tres no es adorno: la modalidad decide qué entidades pueden
// recibir la oferta (`modalitat_receptor_compat`) y qué documento se acaba emitiendo.
// Elegirla mal no se nota hasta el cierre.
//
// ⚠️ TOPE DURO DE 72 CARACTERES, y no es una preferencia de estilo: el intake pregunta este
//    paso con una LISTA de WhatsApp (`sendLista`), y la Cloud API limita la `description` de
//    una fila a 72 caracteres —el `titulo`, a 24—. `sendLista` recorta con `slice(0, 72)`,
//    así que pasarse no da ningún error: deja la frase cortada a media palabra en el móvil
//    del productor. La descripción de `donacio` medía 97 y perdía justo el final, donde va
//    el certificado. Lo vigila `tests/camposOferta.test.ts`.
//
// Y son estas mismas las que enseña el panel bajo el desplegable, así que el recorte vale
// para los dos canales: una sola fuente, que es de lo que va este módulo. Al bajar de 97 se
// fue «Ho dones» —que ya lo dice el título de la opción, en los dos sitios— y «a final
// d'any»; lo que DECIDE (quién la puede recibir, y que hay certificado de donación) se queda.
export const MODALITATS = [
  {
    id: "donacio",
    titulo: "Donació",
    // Quién la puede recibir sale de `modalitat_receptor_compat` (§4bis), que cambió el
    // 27-09-2026: la social ya recibe venta y maquila, y el comercio, maquila.
    descripcion: "Entitats socials, alimentació animal, obradors · certificat de donació",
  },
  {
    id: "venda",
    titulo: "Venda",
    descripcion: "La vens a un preu mínim per kg. Comerços, obradors i entitats socials.",
  },
  {
    id: "maquila",
    titulo: "Maquila",
    descripcion: "Et transformen el producte i te'l tornen. Obradors, comerços, entitats.",
  },
];

/**
 * Lo que admite la `description` de una fila de lista en la Cloud API de Meta. Vive aquí
 * —y no solo en `whatsapp.ts`— porque quien puede pasarse es quien ESCRIBE el texto, y lo
 * escribe en este fichero. `whatsapp.ts` conserva su `slice` como última red.
 */
export const MAX_DESC_FILA_LISTA = 72;
/** Y lo que admite el `title` de esa misma fila. */
export const MAX_TITULO_FILA_LISTA = 24;

export type TipoCampo = "familia" | "producte" | "text" | "numero" | "opcions" | "ubicacio" | "causa";

export interface OpcionCampo {
  id: string;
  titulo: string;
  /** Una línea: qué implica elegir esta opción. Obligatoria en `modalitat`. */
  descripcion?: string;
}

export interface CondicionCampo { campo: Paso; en: string[] }

export interface CampoOferta {
  clave: Paso;
  tipo: TipoCampo;
  /** Etiqueta en català, la misma que se pregunta por WhatsApp. */
  etiqueta: string;
  ayuda?: string;
  /** En qué bloque del cuestionario va. Los campos de una sección van seguidos en `PASOS`. */
  seccion: SeccionOferta;
  obligatorio: boolean;
  opciones?: OpcionCampo[];
  /**
   * Se pregunta solo si otro campo tiene uno de estos valores. Con una LISTA, basta con que
   * se cumpla una (es un «o»): la ubicación hace falta si nadie la trae **o** si el
   * producto sigue en el campo.
   */
  condicion?: CondicionCampo | CondicionCampo[];
}

/** Descriptor de los 17 pasos, con las mismas preguntas que hace el bot. */
export const CAMPOS: CampoOferta[] = [
  {
    clave: "familia",
    tipo: "familia",
    etiqueta: "De quina família és el producte?",
    ayuda: "Serveix per acotar la llista de productes.",
    seccion: "producte",
    obligatorio: true,
  },
  {
    clave: "producte",
    tipo: "producte",
    etiqueta: "Quin producte?",
    ayuda: "Si no hi és, tria el més semblant i digue-ho a Observacions.",
    seccion: "producte",
    obligatorio: true,
  },
  {
    clave: "varietat",
    tipo: "text",
    etiqueta: "Quina varietat és?",
    ayuda: "Deixa-ho buit si no ho saps",
    seccion: "producte",
    obligatorio: false,
  },
  {
    clave: "producte_al_camp",
    tipo: "opcions",
    etiqueta: "El producte encara és al camp?",
    // Lo que separa las dos respuestas no es el estado del producto, es el trabajo que
    // implica: por eso la ayuda habla de collir y no de «sense recollir».
    ayuda: "«Sí» vol dir que encara s'ha de collir, no que estigui pendent de recollida.",
    seccion: "producte",
    obligatorio: true,
    opciones: OPCIONS_AL_CAMP,
  },
  {
    clave: "kg",
    tipo: "numero",
    etiqueta: "Quants kg aproximadament?",
    ayuda: "Aproximats. Els definitius es pesen a la recollida.",
    seccion: "quantitat",
    obligatorio: true,
  },
  {
    clave: "format_entrega",
    tipo: "opcions",
    etiqueta: "Com es farà l'entrega?",
    ayuda: "Si el producte encara és al camp, no cal: es cull allà mateix.",
    seccion: "quantitat",
    obligatorio: true,
    opciones: FORMATS_ENTREGA,
    condicion: { campo: "producte_al_camp", en: ["no"] },
  },
  {
    clave: "caixes",
    tipo: "numero",
    etiqueta: "Quantes caixes o palets són?",
    ayuda: "Deixa-ho buit si no ho saps",
    seccion: "quantitat",
    obligatorio: false,
    condicion: { campo: "format_entrega", en: ["caixes", "palet"] },
  },
  {
    clave: "retorn",
    tipo: "opcions",
    etiqueta: "Cal retornar els envasos?",
    ayuda: "Si cal retornar-los, ho apuntem a l'albarà.",
    seccion: "quantitat",
    obligatorio: true,
    opciones: OPCIONES_RETORN.map((t) => ({ id: t, titulo: t })),
    // Si el receptor porta els seus envasos, no hi ha res a retornar.
    condicion: { campo: "format_entrega", en: ["caixes", "palet", "altres"] },
  },
  {
    clave: "transport",
    tipo: "opcions",
    etiqueta: "Pots encarregar-te del transport?",
    ayuda: "Si el portes tu, no cal dir on es recull.",
    seccion: "recollida",
    obligatorio: true,
    opciones: OPCIONS_TRANSPORT,
    // Un producte al camp s'ha d'anar a collir: no es pot portar.
    condicion: { campo: "producte_al_camp", en: ["no"] },
  },
  {
    clave: "ubicacio",
    tipo: "ubicacio",
    etiqueta: "On s'ha de recollir?",
    ayuda: "Tria un dels teus llocs o afegeix-ne un de nou (camp, magatzem…).",
    seccion: "recollida",
    obligatorio: true,
    condicion: [
      { campo: "transport", en: ["no"] },
      { campo: "producte_al_camp", en: ["si"] },
    ],
  },
  {
    clave: "disponible_fins",
    tipo: "text",
    etiqueta: "Fins quin dia està disponible?",
    ayuda: "Passat aquest dia, si no s'ha col·locat, l'oferta es tanca sola.",
    seccion: "recollida",
    obligatorio: true,
  },
  {
    clave: "horari",
    tipo: "text",
    etiqueta: "Quin horari de recollida va bé?",
    ayuda: "matí, tarda, hores…",
    seccion: "recollida",
    obligatorio: false,
  },
  {
    clave: "modalitat",
    tipo: "opcions",
    etiqueta: "Quina modalitat és?",
    ayuda: "Decideix quines entitats la poden rebre i quin document es genera.",
    seccion: "modalitat",
    obligatorio: true,
    opciones: MODALITATS,
  },
  {
    clave: "preu_minim",
    tipo: "numero",
    etiqueta: "A quin preu mínim (€/kg) la vols oferir?",
    ayuda: "Les entitats el veuran i no la podran demanar per sota d'aquest preu.",
    seccion: "modalitat",
    obligatorio: true,
    condicion: { campo: "modalitat", en: ["venda", "maquila"] },
  },
  {
    // El COSTE POR KILO lo decide el productor (27-09-2026). El de la pantalla «Productes»
    // es solo una REFERENCIA: el panel lo prellena y el bot lo ofrece con un botón
    // «Mantenir», y el productor lo deja o pone otro. Es lo que valora la donación en el
    // certificado, así que solo se pregunta en donació: venda y maquila ya tienen su
    // `preu_minim`, y el certificado de transacción no lleva importes.
    //
    // No es obligatorio: sin él, la canalización toma la referencia vigente del producto
    // (`trg_canalizaciones_valoriza`, 20270405100200).
    clave: "cost_kg",
    tipo: "numero",
    etiqueta: "Quin és el cost per quilo (€/kg)?",
    ayuda: "És el valor amb què es calcula la donació al certificat. Et proposem el de referència del producte; el pots canviar.",
    seccion: "modalitat",
    obligatorio: false,
    condicion: { campo: "modalitat", en: ["donacio"] },
  },
  {
    clave: "causa",
    tipo: "causa",
    etiqueta: "Quina és la causa de l'excedent?",
    ayuda: "Per què no va pel canal habitual. Només per a estadística.",
    seccion: "causa",
    obligatorio: true,
  },
  {
    clave: "observacions",
    tipo: "text",
    etiqueta: "Alguna observació?",
    ayuda: "Tot el que ajudi l'entitat: accés, càrrega, contacte a la finca…",
    seccion: "causa",
    obligatorio: false,
  },
];

/** ¿Este campo se pregunta, dados los datos ya introducidos? Una lista es un «o». */
export function aplica(campo: CampoOferta, datos: Record<string, unknown>): boolean {
  if (!campo.condicion) return true;
  const conds = Array.isArray(campo.condicion) ? campo.condicion : [campo.condicion];
  return conds.some((c) => c.en.includes(String(datos[c.campo] ?? "")));
}

/** Campos obligatorios que faltan. Lista vacía = se puede crear la oferta. */
export function faltantes(datos: Record<string, unknown>): Paso[] {
  return CAMPOS
    .filter((c) => c.obligatorio && aplica(c, datos))
    .filter((c) => {
      const v = datos[c.clave];
      return v === undefined || v === null || String(v).trim() === "";
    })
    .map((c) => c.clave);
}
