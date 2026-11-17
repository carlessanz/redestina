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
  "retorn_envasos",
  "retorn_quantitat",
  "transport",
  "ubicacio",
  "disponible_fins",
  "dies_recollida",
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

export const SECCIONES: readonly {
  clau: SeccionOferta; titol: string; descripcio?: string; titol_es: string; descripcio_es?: string;
}[] = [
  { clau: "producte", titol: "Producte", titol_es: "Producto" },
  {
    clau: "quantitat",
    titol: "Quantitat i envasos",
    descripcio: "N'hi ha prou amb una xifra aproximada: els kg definitius es pesen a la recollida.",
    titol_es: "Cantidad y envases",
    descripcio_es: "Basta con una cifra aproximada: los kg definitivos se pesan en la recogida.",
  },
  {
    clau: "recollida",
    titol: "Recollida",
    // No da por hecho que venga una entidad: puede ser venta, donación o maquila, y el
    // productor puede llevarlo él (revisión funcional del 23-09-2026).
    descripcio: "Com arriba el producte a qui el rep, i fins quan.",
    titol_es: "Recogida",
    descripcio_es: "Cómo llega el producto a quien lo recibe, y hasta cuándo.",
  },
  {
    clau: "modalitat",
    titol: "Com vols donar-hi sortida",
    descripcio: "Decideix quines entitats la poden rebre i quin document es genera.",
    titol_es: "Cómo quieres darle salida",
    descripcio_es: "Decide qué entidades pueden recibirla y qué documento se genera.",
  },
  {
    clau: "causa",
    titol: "Causa i observacions",
    descripcio: "Només per a estadística i per ajudar l'entitat.",
    titol_es: "Causa y observaciones",
    descripcio_es: "Solo para estadística y para ayudar a la entidad.",
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
  {
    id: "caixes", titulo: "Caixes", descripcion: "En caixes, de qualsevol tipus.",
    titulo_es: "Cajas", descripcion_es: "En cajas, de cualquier tipo.",
  },
  {
    id: "palet", titulo: "Palet", descripcion: "Paletitzat.",
    titulo_es: "Palé", descripcion_es: "Paletizado.",
  },
  {
    id: "envasos_propis",
    titulo: "Envasos de qui ho rep",
    descripcion: "Qui ho reculli ha de portar els seus envasos.",
    titulo_es: "Envases de quien lo recibe",
    descripcion_es: "Quien lo recoja tiene que traer sus envases.",
  },
  {
    id: "altres", titulo: "Altres", descripcion: "Digue-ho a Observacions.",
    titulo_es: "Otros", descripcion_es: "Dilo en Observaciones.",
  },
];

/** Retorno de envases: sí o no. «Caixes pròpies» ya es un formato de entrega, no un retorno. */
export const OPCIONES_RETORN = ["Sí", "No"];

/** ¿El productor puede llevarlo? Si sí, no hace falta decir dónde se recoge. */
export const OPCIONS_TRANSPORT = [
  { id: "si", titulo: "Sí, el porto jo", titulo_es: "Sí, lo llevo yo" },
  { id: "no", titulo: "No, cal recollir-lo", titulo_es: "No, hay que recogerlo" },
];

// «Producte al camp»: lo ofrecido TODAVÍA NO ESTÁ RECOGIDO y hay que ir a cosecharlo.
//
// No es un matiz descriptivo, decide un flujo (20270328101000): esa oferta la puede
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
    titulo_es: "Sí, está en la planta",
    descripcion_es: "Hay que cosecharlo. Se puede organizar como espigoleo.",
  },
  {
    id: "no",
    titulo: "No, ja està collit",
    descripcion: "Ja està collit i a punt per recollir.",
    titulo_es: "No, ya está cosechado",
    descripcion_es: "Ya está cosechado y listo para recoger.",
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
    titulo_es: "Donación",
    descripcion_es: "Entidades sociales, alimentación animal, obradores · certificado de donación",
  },
  {
    id: "venda",
    titulo: "Venda",
    // Fase A del punto 3 (17-11-2026): el precio es el de VENTA, y solo lo lleva la venta.
    descripcion: "La vens a un preu per kg. Comerços, obradors i entitats socials.",
    titulo_es: "Venta",
    descripcion_es: "La vendes a un precio por kg. Comercios, obradores y entidades sociales.",
  },
  {
    id: "maquila",
    // En WhatsApp, «Maquila» (el título de una fila de lista admite 24 caracteres); en el panel,
    // el nombre largo que pidió la Fundació (fila 3.3 del Excel). Sin campos económicos.
    titulo: "Maquila",
    titulo_panel: "Transformació en obrador (maquila)",
    descripcion: "Et transformen el producte i te'l tornen. Obradors, comerços, entitats.",
    titulo_es: "Maquila",
    titulo_panel_es: "Transformación en obrador (maquila)",
    descripcion_es: "Te transforman el producto y te lo devuelven. Obradores, comercios, entidades.",
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

export type TipoCampo = "familia" | "producte" | "text" | "numero" | "opcions" | "ubicacio" | "causa" | "dies";

export interface OpcionCampo {
  id: string;
  titulo: string;
  /**
   * El título en el PANEL cuando el de WhatsApp tiene que ser corto (17-11-2026, maquila): el
   * bot usa `titulo` (≤24 en una fila de lista, ≤20 en un botón); el panel, este si lo hay.
   */
  titulo_panel?: string;
  titulo_panel_es?: string;
  /** El título en castellano, para el panel. El bot pregunta siempre en catalán. */
  titulo_es?: string;
  descripcion_es?: string;
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
  /**
   * Los mismos textos en castellano (28-09-2026). Viven AQUÍ, al lado del catalán, y no en el
   * diccionario de la aplicación: si vivieran allí, cambiar una pregunta obligaría a
   * acordarse de otro fichero, y el castellano se quedaría preguntando lo de antes. Los usa
   * solo el panel; el bot de WhatsApp habla en catalán. Lo vigila `camposOferta.test.ts`.
   */
  etiqueta_es: string;
  ayuda_es?: string;
  /** En qué bloque del cuestionario va. Los campos de una sección van seguidos en `PASOS`. */
  seccion: SeccionOferta;
  obligatorio: boolean;
  opciones?: OpcionCampo[];
  /**
   * Se pueden marcar VARIAS opciones (05-10-2026, solo `modalitat`). El tipo sigue siendo
   * `opcions` a propósito: un panel anterior que no conoce este campo pinta el desplegable de
   * siempre y manda una sola, que el servidor sigue aceptando (§11: las funciones se publican
   * antes que el frontend). El valor nuevo es una lista de ids.
   */
  multiple?: boolean;
  /**
   * Un texto con forma (05-10-2026, solo `horari`): `franja` = de qué hora a qué hora. El tipo
   * sigue siendo `text` por la misma compatibilidad que `multiple`: el panel nuevo pinta dos
   * pares de desplegables y manda `{inici, fi}`; el viejo y el bot mandan texto, y el servidor
   * intenta leerlo (`franja.ts`).
   */
  format?: "franja";
  /**
   * Se pregunta solo si otro campo tiene uno de estos valores. Con una LISTA, basta con que
   * se cumpla una (es un «o»): la ubicación hace falta si nadie la trae **o** si el
   * producto sigue en el campo.
   */
  condicion?: CondicionCampo | CondicionCampo[];
  /**
   * Oculto TEMPORALMENTE (17-11-2026, `transport`): `aplica()` devuelve false, así que ni se
   * pregunta (panel ni WhatsApp) ni se exige. El campo no se borra: volver a preguntarlo es
   * quitar esta marca. `crear-oferta` tampoco lo sirve al panel.
   */
  oculto?: boolean;
  /**
   * Solo lo pregunta el PANEL (17-11-2026, `dies_recollida`): el intake de WhatsApp lo salta y
   * `faltantes(…, "whatsapp")` no lo exige. Por eso un campo así tiene que ser opcional (test).
   */
  soloPanel?: boolean;
}

/**
 * Las familias vienen de la base (`productos.familia`) y están en catalán. En el panel en
 * castellano se ENSEÑAN traducidas; lo que se guarda sigue siendo el valor catalán. Una familia
 * nueva sin traducción sale tal cual. (Las causas y subcausas traen su `nombre_es` de la base.)
 * ⚠️ Los nombres de PRODUCTO no se traducen: son el nombre del catálogo, el mismo que sale
 *    en el Mercat, en los albaranes y en los certificados.
 */
export const FAMILIES_ES: Record<string, string> = {
  "Bolets": "Setas",
  "Fruita Cítrics": "Fruta cítricos",
  "Fruita Dolça": "Fruta dulce",
  "Fruita Exòtica": "Fruta exótica",
  "Fruita Seca": "Frutos secos",
  "Fruita Vermella": "Frutos rojos",
  "Horta Flor": "Huerta flor",
  "Horta Fruit": "Huerta fruto",
  "Horta Fulla": "Huerta hoja",
  "Horta Tub/Bul/Arr": "Huerta tubérculo/bulbo/raíz",
  "Indeterminat": "Indeterminado",
  "Varis": "Varios",
};

/**
 * Por código de `causas`: las OCHO DE ANTES, inactivas desde la fase B del punto 3
 * (20270529100000). Ya no se sirve (`crear-oferta` lee `causas.nombre_es`); se conserva porque
 * su test de paridad vigila el `nombre_es` sembrado en A3.
 */
export const CAUSES_ES: Record<string, string> = {
  CE: "Criterios estéticos",
  CL: "Clima",
  CN: "Canalización",
  EX: "Excedente",
  FC: "Final de cultivo",
  GD: "Gestión deficiente",
  MQ: "Maquila",
  PR: "Precio",
};

/**
 * Descriptor de los 20 pasos, con las mismas preguntas que hace el bot. Desde el 17-11-2026 uno
 * está oculto (`transport`) y otro es solo del panel (`dies_recollida`).
 */
export const CAMPOS: CampoOferta[] = [
  {
    clave: "familia",
    tipo: "familia",
    etiqueta: "De quina família és el producte?",
    ayuda: "Serveix per acotar la llista de productes.",
    etiqueta_es: "¿De qué familia es el producto?",
    ayuda_es: "Sirve para acotar la lista de productos.",
    seccion: "producte",
    obligatorio: true,
  },
  {
    clave: "producte",
    tipo: "producte",
    etiqueta: "Quin producte?",
    ayuda: "Si no hi és, tria el més semblant i digue-ho a Observacions.",
    etiqueta_es: "¿Qué producto?",
    ayuda_es: "Si no está, elige el más parecido y dilo en Observaciones.",
    seccion: "producte",
    obligatorio: true,
  },
  {
    clave: "varietat",
    tipo: "text",
    etiqueta: "Quina varietat és?",
    // «Els quilos van després» (reunión del 05-10-2026): en la demo se escribió «200» aquí
    // pensando que eran kg. El panel avisa además si la respuesta es solo un número.
    ayuda: "P. ex. Golden, Conference, Raf. Deixa-ho buit si no ho saps; els quilos es demanen després.",
    etiqueta_es: "¿Qué variedad es?",
    ayuda_es: "P. ej. Golden, Conference, Raf. Déjalo vacío si no lo sabes; los kilos se piden después.",
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
    etiqueta_es: "¿El producto todavía está en el campo?",
    ayuda_es: "«Sí» quiere decir que todavía hay que cosecharlo, no que esté pendiente de recogida.",
    seccion: "producte",
    obligatorio: true,
    opciones: OPCIONS_AL_CAMP,
  },
  {
    clave: "kg",
    tipo: "numero",
    etiqueta: "Quants kg aproximadament?",
    ayuda: "Aproximats. Els definitius es pesen a la recollida.",
    etiqueta_es: "¿Cuántos kg aproximadamente?",
    ayuda_es: "Aproximados. Los definitivos se pesan en la recogida.",
    seccion: "quantitat",
    obligatorio: true,
  },
  {
    clave: "format_entrega",
    tipo: "opcions",
    etiqueta: "Com es farà l'entrega?",
    ayuda: "Si el producte encara és al camp, no cal: es cull allà mateix.",
    etiqueta_es: "¿Cómo se hará la entrega?",
    ayuda_es: "Si el producto todavía está en el campo, no hace falta: se cosecha allí mismo.",
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
    etiqueta_es: "¿Cuántas cajas o palés son?",
    ayuda_es: "Déjalo vacío si no lo sabes",
    seccion: "quantitat",
    obligatorio: false,
    condicion: { campo: "format_entrega", en: ["caixes", "palet"] },
  },
  {
    clave: "retorn",
    tipo: "opcions",
    etiqueta: "Cal retornar els envasos?",
    ayuda: "Si cal retornar-los, ho apuntem a l'albarà.",
    etiqueta_es: "¿Hay que devolver los envases?",
    ayuda_es: "Si hay que devolverlos, lo apuntamos en el albarán.",
    seccion: "quantitat",
    obligatorio: true,
    opciones: OPCIONES_RETORN.map((t) => ({ id: t, titulo: t, titulo_es: t })),
    // Si el receptor porta els seus envasos, no hi ha res a retornar.
    condicion: { campo: "format_entrega", en: ["caixes", "palet", "altres"] },
  },
  // Con retorno, QUÉ y CUÁNTOS (fila 3.2 del Excel, 17-11-2026): «Sí» a secas no le decía a
  // quien recoge qué tenía que traer de vuelta. Se guardan en `retorn_envasos_detall` y
  // `retorn_envasos_quantitat` (la columna `retorn_envasos` ya era la respuesta Sí/No).
  {
    clave: "retorn_envasos",
    tipo: "text",
    etiqueta: "Quins envasos s'han de retornar?",
    ayuda: "P. ex. caixes de plàstic verdes, palots, palets europeus…",
    etiqueta_es: "¿Qué envases hay que devolver?",
    ayuda_es: "P. ej. cajas de plástico verdes, palots, palés europeos…",
    seccion: "quantitat",
    obligatorio: true,
    condicion: { campo: "retorn", en: ["Sí"] },
  },
  {
    clave: "retorn_quantitat",
    tipo: "numero",
    etiqueta: "Quants envasos s'han de retornar?",
    ayuda: "Un nombre enter; aproximat, si no ho saps del cert.",
    etiqueta_es: "¿Cuántos envases hay que devolver?",
    ayuda_es: "Un número entero; aproximado, si no lo sabes con certeza.",
    seccion: "quantitat",
    obligatorio: true,
    condicion: { campo: "retorn", en: ["Sí"] },
  },
  {
    clave: "transport",
    tipo: "opcions",
    etiqueta: "Pots encarregar-te del transport?",
    ayuda: "Si el portes tu, no cal dir on es recull.",
    etiqueta_es: "¿Puedes encargarte del transporte?",
    ayuda_es: "Si lo llevas tú, no hace falta decir dónde se recoge.",
    seccion: "recollida",
    obligatorio: true,
    opciones: OPCIONS_TRANSPORT,
    // Un producte al camp s'ha d'anar a collir: no es pot portar.
    condicion: { campo: "producte_al_camp", en: ["no"] },
    // OCULTO desde el 17-11-2026 (fila 3.4 del Excel): de momento siempre se recoge en un lugar,
    // así que la ubicación se pregunta siempre. Se conserva para volver a activarlo.
    oculto: true,
  },
  {
    clave: "ubicacio",
    tipo: "ubicacio",
    etiqueta: "On s'ha de recollir?",
    ayuda: "Tria un dels teus llocs o afegeix-ne un de nou (camp, magatzem…).",
    etiqueta_es: "¿Dónde hay que recogerlo?",
    ayuda_es: "Elige uno de tus lugares o añade uno nuevo (campo, almacén…).",
    seccion: "recollida",
    obligatorio: true,
    // Sin condición desde el 17-11-2026: con el transporte oculto, siempre hay que decir dónde.
  },
  {
    clave: "disponible_fins",
    tipo: "text",
    etiqueta: "Fins quin dia està disponible?",
    ayuda: "Passat aquest dia, si no s'ha col·locat, l'oferta es tanca sola.",
    etiqueta_es: "¿Hasta qué día está disponible?",
    ayuda_es: "Pasado este día, si no se ha colocado, la oferta se cierra sola.",
    seccion: "recollida",
    obligatorio: true,
  },
  {
    // Los DÍAS en que se puede recoger (fila 3.4, 17-11-2026), 1 = dilluns … 7 = diumenge. Solo
    // en el panel, con casillas, precargados del lugar (`dies_setmana`); por WhatsApp serían
    // siete botones más para algo que el lugar ya sabe.
    clave: "dies_recollida",
    tipo: "dies",
    soloPanel: true,
    etiqueta: "Quins dies es pot recollir?",
    ayuda: "Et proposem els del lloc de recollida; els pots canviar per a aquesta oferta.",
    etiqueta_es: "¿Qué días se puede recoger?",
    ayuda_es: "Te proponemos los del lugar de recogida; los puedes cambiar para esta oferta.",
    seccion: "recollida",
    obligatorio: false,
  },
  {
    clave: "horari",
    tipo: "text",
    // Una FRANJA, no una hora (reunión del 05-10-2026): el productor dice de qué hora a qué
    // hora se puede recoger, y quien recoge elige dentro de ella. Por WhatsApp se sigue
    // preguntando en texto y se intenta leer («de 9 a 12», «matí»).
    format: "franja",
    etiqueta: "Entre quines hores es pot recollir?",
    ayuda: "La franja en què hi ha algú per lliurar-lo. Qui el reculli triarà l'hora dins d'aquesta franja.",
    etiqueta_es: "¿Entre qué horas se puede recoger?",
    ayuda_es: "La franja en la que hay alguien para entregarlo. Quien lo recoja elegirá la hora dentro de ella.",
    seccion: "recollida",
    obligatorio: false,
  },
  {
    clave: "modalitat",
    tipo: "opcions",
    // VARIAS a la vez (reunión del 05-10-2026, D2): la definitiva de cada entrega la elige
    // quien la recibe y la confirma el equipo. Ver `modalitats.ts`.
    multiple: true,
    etiqueta: "Quines modalitats vols oferir?",
    ayuda: "Pots marcar-ne més d'una. Si no ho tens clar, marca-les totes: l'equip t'ajudarà a triar.",
    etiqueta_es: "¿Qué modalidades quieres ofrecer?",
    ayuda_es: "Puedes marcar más de una. Si no lo tienes claro, márcalas todas: el equipo te ayudará a elegir.",
    seccion: "modalitat",
    obligatorio: true,
    opciones: MODALITATS,
  },
  {
    // El PREU DE VENDA (fila 3.3, 17-11-2026): solo en venda. La maquila se queda sin campos
    // económicos (`ambPreu()` en `modalitats.ts` dice lo mismo). La clave sigue siendo
    // `preu_minim` —la columna y todo lo que la lee—; cambia lo que se pregunta.
    clave: "preu_minim",
    tipo: "numero",
    etiqueta: "Preu de venda (€/kg)",
    ayuda: "El preu per quilo al qual la vens. Les entitats el veuran i no la podran demanar per sota.",
    etiqueta_es: "Precio de venta (€/kg)",
    ayuda_es: "El precio por kilo al que la vendes. Las entidades lo verán y no podrán pedirla por debajo.",
    seccion: "modalitat",
    obligatorio: true,
    condicion: { campo: "modalitat", en: ["venda"] },
  },
  {
    // El COSTE POR KILO lo decide el productor (27-09-2026). El de la pantalla «Productes»
    // es solo una REFERENCIA: el panel lo prellena y el bot lo ofrece con un botón
    // «Mantenir», y el productor lo deja o pone otro. Es lo que valora la donación en el
    // certificado, así que solo se pregunta en donació: la venda tiene su preu de venda
    // (`preu_minim`), la maquila no lleva importes, y el certificado de transacción tampoco.
    //
    // No es obligatorio: sin él, la canalización toma la referencia vigente del producto
    // (`trg_canalizaciones_valoriza`, 20270405100200).
    clave: "cost_kg",
    tipo: "numero",
    etiqueta: "Valor de cost (€/kg)",
    ayuda: "És el valor amb què es calcula la donació al certificat. Et proposem el de referència del producte; el pots canviar.",
    etiqueta_es: "Valor de coste (€/kg)",
    ayuda_es: "Es el valor con el que se calcula la donación en el certificado. Te proponemos el de referencia del producto; lo puedes cambiar.",
    seccion: "modalitat",
    obligatorio: false,
    condicion: { campo: "modalitat", en: ["donacio"] },
  },
  {
    // Fase B del punto 3 (fila 3.6, 17-11-2026): el catálogo de causas y subcausas del
    // Diagnòstic operatiu (`_shared/causes.ts`). En el PANEL el valor es una SUBCAUSA (`C4.2`,
    // obligatoria: `crear-oferta` responde `subcausa_obligatoria`) y la causa sale de ella; por
    // WHATSAPP, solo la categoría (`C4`), y la subcausa la completa el equipo al editar.
    clave: "causa",
    tipo: "causa",
    etiqueta: "Quina és la causa de l'excedent?",
    ayuda: "Per què no va pel canal habitual. Tria la que s'hi acosti més.",
    etiqueta_es: "¿Cuál es la causa del excedente?",
    ayuda_es: "Por qué no va por el canal habitual. Elige la que más se acerque.",
    seccion: "causa",
    obligatorio: true,
  },
  {
    clave: "observacions",
    tipo: "text",
    etiqueta: "Alguna observació?",
    ayuda: "Tot el que ajudi l'entitat: accés, càrrega, contacte a la finca…",
    etiqueta_es: "¿Alguna observación?",
    ayuda_es: "Todo lo que ayude a la entidad: acceso, carga, contacto en la finca…",
    seccion: "causa",
    obligatorio: false,
  },
];

/**
 * ¿Este campo se pregunta, dados los datos ya introducidos? Una lista es un «o».
 *
 * Un campo `oculto` no se pregunta nunca. Y desde el 17-11-2026 la condición se ENCADENA: solo
 * cuenta si el campo del que depende también se pregunta. Sin eso, un «Sí» al retorno que se
 * quedó escrito antes de cambiar el formato a «envasos de qui ho rep» seguiría pidiendo qué
 * envases devolver, aunque el retorno ya no se pregunte.
 */
export function aplica(campo: CampoOferta, datos: Record<string, unknown>): boolean {
  if (campo.oculto) return false;
  if (!campo.condicion) return true;
  const conds = Array.isArray(campo.condicion) ? campo.condicion : [campo.condicion];
  return conds.some((c) => {
    const del = CAMPOS.find((x) => x.clave === c.campo);
    if (del && del !== campo && !aplica(del, datos)) return false;
    return valorsDe(datos[c.campo]).some((v) => c.en.includes(v));
  });
}

/**
 * Lo que vale un campo, como lista de textos. Un campo `multiple` guarda una lista; el resto,
 * un valor. Así una condición «modalitat en venda/maquila» se cumple con `["donacio","venda"]`
 * igual que con `"venda"`. `"totes"` (la fila de WhatsApp) cuenta como las tres.
 */
export function valorsDe(v: unknown): string[] {
  if (v === "totes") return ["donacio", "venda", "maquila"];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [String(v ?? "")];
}

/** ¿Está vacío? Una lista vacía también lo está: «al menos una» modalidad. */
export function esBuit(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  if (v && typeof v === "object") return Object.keys(v).length === 0;
  return v === undefined || v === null || String(v).trim() === "";
}

/**
 * Campos obligatorios que faltan. Lista vacía = se puede crear la oferta. Por WhatsApp
 * (`canal = "whatsapp"`) no se exige lo que solo pregunta el panel (`soloPanel`).
 */
export function faltantes(datos: Record<string, unknown>, canal: "panel" | "whatsapp" = "panel"): Paso[] {
  return CAMPOS
    .filter((c) => c.obligatorio && aplica(c, datos))
    .filter((c) => !(canal === "whatsapp" && c.soloPanel))
    .filter((c) => esBuit(datos[c.clave]))
    .map((c) => c.clave);
}
