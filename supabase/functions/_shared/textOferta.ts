// El texto de una oferta, sin red ni Deno: lo que se publica en el grupo y se manda a las
// entidades. Vivía en `oferta.ts`, que importa el cliente de WhatsApp y el de correo; aquí
// queda como módulo «hoja» (27-10-2026) para que el panel del equipo pueda componer y copiar
// EXACTAMENTE el mismo texto que el servidor, importándolo y no copiándolo (§7, la regla de
// los módulos hoja; lo vigila `tests/puresa.test.ts`). `oferta.ts` lo reexporta, así que
// nadie que ya lo usaba cambia su import.

/**
 * Texto que se publica en el grupo de canalizaciones.
 * Reproduce el formato que el equipo usa hoy a mano, emojis incluidos.
 */
export function componerTextoOferta(campos: {
  producte: string;
  /** Solo cuando es cierto se imprime la línea: el silencio significa «ja està collit». */
  producteAlCamp?: boolean;
  productor: string;
  municipi: string;
  /** Sin enlace de Maps no se imprime el bloque entero (ver más abajo). */
  ubicacio?: string;
  quantitat: string;
  disponible: string;
  /** Campo libre y opcional del panel: sin respuesta, no se imprime la línea. */
  horari?: string;
  modalitat: string;
  preu?: string;
  causa: string;
  /** Formato de entrega y retorno, ya compuestos (`textoEnvasos`). Sin nada, no se imprime. */
  envasos?: string;
  /** Solo cuando el productor lo lleva: el silencio significa «cal venir a buscar-lo». */
  transportPropi?: boolean;
  /**
   * `responsable` y `observacions` SIEMPRE se imprimen, aunque estén vacías —al revés que
   * `ubicacio`/`horari`/`envasos` de aquí arriba—, y es una decisión distinta y ya tomada
   * (`tests/oferta.test.ts`, «un campo vacío deja su etiqueta, no borra la línea»): son
   * texto libre que alguien podría haber escrito, y una etiqueta vacía se lee como «no hi
   * ha», mientras que una línea que desaparece se lee como un fallo. No tocar sin revisar
   * ese test.
   */
  responsable: string;
  observacions: string;
}): string {
  const lineas = [
    "📢 *OFERTA DISPONIBLE*",
    "",
    `🌿 PRODUCTE: ${campos.producte}`,
  ];
  // Va pegada al producto, y no al final con las observaciones, porque califica QUÉ se
  // ofrece: la entidad tiene que saber que todavía no está collit **antes** de decir que
  // le interesa, no cuando llegue a la finca.
  //
  // ⚠️ Solo se imprime cuando es cierto, igual que el `preu mínim` de más abajo. Una línea
  //    «PRODUCTE AL CAMP: no» en el caso normal —que es la inmensa mayoría de las ofertas—
  //    sería ruido en un mensaje que se lee en un móvil, y esa asimetría es deliberada: el
  //    silencio significa «ja està collit», que es lo que la oferta ya daba a entender
  //    antes de que este campo existiera.
  if (campos.producteAlCamp) {
    lineas.push("🌱 PRODUCTE AL CAMP: sí (encara no s'ha collit)");
  }
  lineas.push(
    `👩‍🌾 PRODUCTOR: ${campos.productor}`,
    `📍 MUNICIPI: ${campos.municipi}`,
  );
  // Sin enlace de Maps no hay nada que poner bajo la etiqueta: un guion suelto en su
  // propia línea no dice nada y ocupa sitio en un mensaje que se lee en el móvil (mismo
  // criterio que `producte_al_camp`/`preu_minim`, deuda §12.122).
  if (campos.ubicacio) {
    lineas.push(`🗺️ UBICACIÓ:`, campos.ubicacio);
  }
  lineas.push(`📦 QUANTITAT: ${campos.quantitat}`, `📅 DISPONIBLE: ${campos.disponible}`);
  if (campos.horari) lineas.push(`⏰ HORARI RECOLLIDA: ${campos.horari}`);
  lineas.push(`💰 MODALITAT: ${campos.modalitat}`);
  // Preu mínim solo en venda/maquila (el productor lo fija en l'intake).
  if (campos.preu) lineas.push(`💶 PREU MÍNIM: ${campos.preu}`);
  lineas.push(`🔴 CAUSA: ${campos.causa}`);
  if (campos.envasos) lineas.push(`♻️ ENVASOS: ${campos.envasos}`);
  // Misma asimetría que `producte_al_camp`: solo se dice cuando cambia lo que hay que hacer.
  if (campos.transportPropi) lineas.push("🚚 TRANSPORT: el porta la productora");
  lineas.push(
    `👥 RESPONSABLE: ${campos.responsable}`,
    `📝 OBSERVACIONS: ${campos.observacions}`,
    "",
    "✅ Si t'interessa, prem *M'interessa* (o respon *SÍ*); si no, *Ara no*.",
  );
  return lineas.join("\n");
}

/** «1 caixa», «3 caixes», «1 palet», «2 palets». */
export function textCaixes(n: number, format: unknown): string {
  const palet = format === "palet";
  return `${n} ${palet ? (n === 1 ? "palet" : "palets") : (n === 1 ? "caixa" : "caixes")}`;
}

/** El formato de entrega en palabras, para el texto de la oferta. */
const ETIQUETA_FORMAT: Record<string, string> = {
  caixes: "Caixes",
  palet: "Palet",
  envasos_propis: "Cal portar envasos propis",
  altres: "Altres (vegeu observacions)",
};

/**
 * La línea ENVASOS: formato de entrega y, si aplica, si hay que devolverlos. Vacía si no se
 * preguntó (producto en el campo) — y entonces la línea no se imprime.
 */
export function textoEnvasos(format: unknown, retorn: unknown): string {
  const f = ETIQUETA_FORMAT[String(format ?? "")] ?? "";
  const r = String(retorn ?? "");
  const ret = r === "Sí" ? "cal retornar-los" : r === "No" ? "no cal retornar-los" : "";
  return [f, ret].filter(Boolean).join(" · ");
}
