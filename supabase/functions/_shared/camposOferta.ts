// Los campos de una oferta, en un solo sitio.
//
// El intake por WhatsApp (`intake.ts`) y el formulario del panel del productor
// preguntan exactamente lo mismo, así que la lista de pasos vive aquí y la usan los
// dos. El panel no la lleva escrita en TypeScript: la PIDE con
// `GET /functions/v1/crear-oferta/campos`. Es la única forma de que «el mismo
// formulario» siga siendo cierto dentro de seis meses.
//
// Las opciones salen siempre de las tablas (§6bis), nunca escritas a mano, salvo los
// vocabularios cerrados que ya estaban en el código (tipo de caja, retorno, modalitat).
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
  "kg",
  "caixes",
  "tipus_caixa",
  "retorn",
  "ubicacio",
  "disponible_fins",
  "horari",
  "modalitat",
  "preu_minim",
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
    descripcio: "Aproximat val: els kg definitius es pesen a la recollida.",
  },
  {
    clau: "recollida",
    titol: "Recollida",
    descripcio: "On i quan pot venir l'entitat.",
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

export const TIPOS_CAIXA = [
  "Rígida FE",
  "Plegable FE",
  "Palot",
  "Retornable",
  "Productor/a",
  "No retorn",
];

export const OPCIONES_RETORN = ["Sí", "No", "Caixes pròpies"];

// La `descripcion` de estas tres no es adorno: la modalidad decide qué entidades pueden
// recibir la oferta (`modalitat_receptor_compat`) y qué documento se acaba emitiendo.
// Elegirla mal no se nota hasta el cierre.
export const MODALITATS = [
  {
    id: "donacio",
    titulo: "Donació",
    descripcion:
      "Ho dones. Entitats socials i d'alimentació animal. Genera un certificat de donació a final d'any.",
  },
  {
    id: "venda",
    titulo: "Venda",
    descripcion: "Ho vens a un preu mínim per kg. Comerços i obradors.",
  },
  {
    id: "maquila",
    titulo: "Maquila",
    descripcion: "Ho transformen per a tu i et tornen producte. Obradors.",
  },
];

export type TipoCampo = "familia" | "producte" | "text" | "numero" | "opcions" | "ubicacio" | "causa";

export interface OpcionCampo {
  id: string;
  titulo: string;
  /** Una línea: qué implica elegir esta opción. Obligatoria en `modalitat`. */
  descripcion?: string;
}

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
  /** Se pregunta solo si otro campo tiene uno de estos valores. */
  condicion?: { campo: Paso; en: string[] };
}

/** Descriptor de los 14 pasos, con las mismas preguntas que hace el bot. */
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
    ayuda: "Deixa-ho buit si no aplica",
    seccion: "producte",
    obligatorio: false,
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
    clave: "caixes",
    tipo: "numero",
    etiqueta: "Quantes caixes són?",
    ayuda: "Deixa-ho buit si no ho saps",
    seccion: "quantitat",
    obligatorio: false,
  },
  {
    clave: "tipus_caixa",
    tipo: "opcions",
    etiqueta: "Quin tipus de caixa?",
    ayuda: "Si són caixes teves, tria «Productor/a».",
    seccion: "quantitat",
    obligatorio: false,
    opciones: TIPOS_CAIXA.map((t) => ({ id: t, titulo: t })),
  },
  {
    clave: "retorn",
    tipo: "opcions",
    etiqueta: "Cal retornar els envasos?",
    ayuda: "Si cal retornar-los, ho apuntem a l'albarà.",
    seccion: "quantitat",
    obligatorio: false,
    opciones: OPCIONES_RETORN.map((t) => ({ id: t, titulo: t })),
  },
  {
    clave: "ubicacio",
    tipo: "ubicacio",
    etiqueta: "On es recull?",
    ayuda: "On ha de venir l'entitat a recollir.",
    seccion: "recollida",
    obligatorio: false,
  },
  {
    clave: "disponible_fins",
    tipo: "text",
    etiqueta: "Fins quin dia està disponible?",
    ayuda: "Passat aquest dia, si no s'ha col·locat, l'oferta es tanca sola. Per exemple 23/07",
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
    ayuda: "Per sota d'aquest preu no s'enviarà l'oferta.",
    seccion: "modalitat",
    obligatorio: true,
    condicion: { campo: "modalitat", en: ["venda", "maquila"] },
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

/** ¿Este campo se pregunta, dados los datos ya introducidos? */
export function aplica(campo: CampoOferta, datos: Record<string, unknown>): boolean {
  if (!campo.condicion) return true;
  return campo.condicion.en.includes(String(datos[campo.condicion.campo] ?? ""));
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
