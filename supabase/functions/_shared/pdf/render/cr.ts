// Certificado de recepción (CR) — lo que Redestina acredita a quien RECIBE.
//
// Todo el circuito documental anterior mira hacia el lado del generador: el resumen
// anual, el certificado de donación y el de transacción dicen lo que una organización
// ENTREGÓ. Este dice lo que una entidad receptora ha recibido en una ventana de fechas,
// que es lo que necesita para una memoria, una subvención o una auditoría de
// sostenibilidad.
//
// Comparte con el CT el esqueleto entero (`cierre.ts`): mismo formato, misma firma de la
// apoderada, misma filigrana de prueba. Tres cosas lo separan:
//
//   1. **El sujeto es la RECEPTORA** (`datos.receptora`), no un donante ni un generador.
//      No se lee `donant` ni `generador` como respaldo: si llegara vacío, el papel tiene
//      que enseñar el hueco y no rellenarlo con la clave de otro documento.
//   2. **NO LLEVA NINGÚN IMPORTE**, como el CT y por el mismo motivo: el snapshot
//      (`recepcio_datos_certificat()`) no trae ni un euro, así que aquí no hay nada que
//      filtrar. ⚠️ Por eso este fichero **no importa `lletres.ts` ni `importEnXifres`**;
//      si algún día alguien necesita ese import aquí, lo que hay que revisar es por qué.
//      Y no es solo que no lleve dinero: **tampoco es un documento fiscal**. El papel lo
//      dice en su propia caja (`no_fiscal_*`), para que nadie lo confunda con un CD.
//   3. 🔴 **LAS DOS PROCEDENCIAS SE IMPRIMEN DISTINTO, Y ESO ES LA DECISIÓN DE FONDO.**
//
// ---------------------------------------------------------------------------
// D3 en esta página, dicho de la forma más corta posible
// ---------------------------------------------------------------------------
//   · `procedencies_compra` (venta y maquila) → **SÍ nombra al generador**, con su NIF.
//     Hay dos partes que ya han contratado entre ellas: ocultarlo no protegería a nadie.
//     Misma regla que el albarán OPE.
//   · `procedencies_donacio` → **municipio y comarca, NUNCA la organización.**
//
// Y eso no lo sostiene este comentario, lo sostienen tres capas puestas a propósito:
//   (a) en SQL, un `check` en `cierre_receptor_lineas` que hace imposible guardar nombre,
//       NIF o id del donante en una línea de donación;
//   (b) en el snapshot, DOS listas separadas —y la de donación no tiene ninguna clave
//       capaz de llevar un nombre—;
//   (c) aquí, DOS interfaces (`ProcedenciaDonacio` / `ProcedenciaCompra`) y DOS bloques
//       con DOS juegos de columnas.
//
// ⚠️ NO UNIFICAR LOS DOS BLOQUES en uno con una columna de tipo, aunque sea la mitad de
//    código: el día que eso ocurra, la columna «Generador» existe para las dos listas y
//    lo único que impide imprimir al donante vuelve a ser que nadie se equivoque. Con dos
//    bloques, imprimir el donante no es un descuido — es que no compila.
//
// Contrato de siempre: no lee ficheros ni habla con la base.

import type { BytesActivos } from "../fuentes.ts";
import { COLORES, type Columna } from "../maquetador.ts";
import { num } from "./comu.ts";
import type { Bloque } from "../plantilla.ts";
import {
  abrirCierre,
  cerrarCierre,
  codigoVerificacion,
  diccionarioCierre,
  type DiccionarioCierre,
  domicilioCompleto,
  fechaLarga,
  fechaLargaConArticulo,
  type OpcionesCierre,
  paresLlenos,
  pintarFirma,
  pintarLegal,
  pintarOrganizacion,
  type ProcedenciaCompra,
  type ProcedenciaDonacio,
  type Renderizado,
} from "./cierre.ts";

/**
 * El cuerpo MIENTRAS no haya plantilla vigente. Hoy sí la hay —`20260921223245` siembra
 * la de `CR` en ca y es— y `emetre_certificat_recepcio()` se niega a emitir sin ella, así
 * que esto no se imprime nunca por el camino normal. Se mantiene por dos motivos: es la
 * red si alguien retira la plantilla sin publicar la siguiente, y es donde se lee qué
 * marcadores tiene que traer la definitiva.
 *
 * ⚠️ Los marcadores son EXACTAMENTE los que declara esa plantilla sembrada. Uno que no
 *    esté en `valores` no se sustituye por vacío: queda visible en el PDF y sale en
 *    `faltan` (aviso en el log).
 *
 * ⚠️ Ni un marcador de importe, y el diccionario de valores tampoco tiene ninguno: una
 *    plantilla futura que pidiera `{{import}}` se quedaría sin resolver y lo diría.
 */
const CUERPO_PROVISIONAL: Record<"ca" | "es", Bloque[]> = {
  ca: [
    {
      tipo: "p",
      text:
        "Que {{fundacio.rao_social}}, amb CIF {{fundacio.cif}} i domicili a {{fundacio.domicili}}, certifica que {{receptora.rao_social}}, amb NIF {{receptora.nif}} i domicili a {{receptora.domicili}}, ha rebut aliments locals fora del circuit de venda habitual durant el període comprès entre {{periode.des_de_art}} i {{periode.fins_a_art}}.",
    },
    {
      tipo: "p",
      text:
        "Que els aliments rebuts dins d'aquest període sumen {{kg}} quilos nets conciliats, dels quals {{kg_donacio}} quilos corresponen a lliuraments en concepte de donació i {{kg_compra}} quilos a operacions de compra o de transformació per maquila.",
    },
    {
      tipo: "p",
      text:
        "Que aquests quilos provenen d'operacions conciliades: la quantitat certificada és la que consta als albarans de lliurament validats per les dues parts, i no una previsió ni una estimació.",
    },
    {
      tipo: "p",
      text:
        "Que la procedència dels aliments consta al detall d'aquest certificat. En els lliuraments en concepte de donació s'hi expressa per municipi i comarca d'origen, sense identificar l'organització donant; en les operacions de compra o maquila hi consta l'organització generadora, atès que és part contractant.",
    },
    {
      tipo: "p",
      text:
        "Que aquest certificat acredita únicament els quilos rebuts i no recull cap import, i que no és un certificat de donació als efectes de la Llei 49/2002 ni substitueix cap document fiscal.",
    },
    {
      tipo: "p",
      text:
        "I perquè així consti, s'expedeix aquest certificat de recepció amb número {{numero}} i codi de verificació {{codi}}.",
    },
  ],
  es: [
    {
      tipo: "p",
      text:
        "Que {{fundacio.rao_social}}, con CIF {{fundacio.cif}} y domicilio en {{fundacio.domicili}}, certifica que {{receptora.rao_social}}, con NIF {{receptora.nif}} y domicilio en {{receptora.domicili}}, ha recibido alimentos locales fuera del circuito de venta habitual durante el periodo comprendido entre {{periode.des_de_art}} y {{periode.fins_a_art}}.",
    },
    {
      tipo: "p",
      text:
        "Que los alimentos recibidos dentro de este periodo suman {{kg}} kilos netos conciliados, de los cuales {{kg_donacio}} kilos corresponden a entregas en concepto de donación y {{kg_compra}} kilos a operaciones de compra o de transformación por maquila.",
    },
    {
      tipo: "p",
      text:
        "Que estos kilos provienen de operaciones conciliadas: la cantidad certificada es la que consta en los albaranes de entrega validados por ambas partes, y no una previsión ni una estimación.",
    },
    {
      tipo: "p",
      text:
        "Que la procedencia de los alimentos consta en el detalle de este certificado. En las entregas en concepto de donación se expresa por municipio y comarca de origen, sin identificar a la organización donante; en las operaciones de compra o maquila consta la organización generadora, por ser parte contratante.",
    },
    {
      tipo: "p",
      text:
        "Que este certificado acredita únicamente los kilos recibidos y no recoge ningún importe, y que no es un certificado de donación a efectos de la Ley 49/2002 ni sustituye a ningún documento fiscal.",
    },
    {
      tipo: "p",
      text:
        "Y para que así conste, se expide este certificado de recepción con número {{numero}} y código de verificación {{codi}}.",
    },
  ],
};

/** «Gavà · Baix Llobregat». Los huecos no dejan rastro (misma regla que el domicilio). */
function origen(p: { municipi?: string | null; comarca?: string | null }): string {
  return [p.municipi, p.comarca].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
}

/** `venda` → «Venda». Lo que no esté en el diccionario se imprime tal cual, no vacío. */
function via(valor: string | null | undefined, t: DiccionarioCierre): string {
  const clave = (valor ?? "").trim();
  return t.via[clave] ?? clave;
}

/**
 * ⚠️ El idioma NO sale del snapshot: sale de `documentos.idioma`, que decide
 * `recepcio_emet_document()` con el perfil del titular de la entidad. Mismo contrato que
 * RES, CD y CT.
 */
export async function renderCr(
  activos: BytesActivos,
  op: OpcionesCierre,
  idioma?: string | null,
): Promise<Renderizado> {
  const lengua: "ca" | "es" = idioma === "es" ? "es" : "ca";
  const datos = op.datos;
  const t = diccionarioCierre(lengua);

  const ctx = await abrirCierre(activos, op, {
    // Una rectificación no cambia de tipo ni consume número: es otra versión del mismo CR
    // con `motiu_rectificacio` en el snapshot. Eso es lo que hay que mirar, igual que en
    // el CD.
    titulo: op.rectificativo ? `${t.cr} · ${t.rectificatiu}` : t.cr,
    subtitulo: t.cr_sub,
    idioma: lengua,
  });
  const { m } = ctx;

  const periodo = datos.periode ?? {};
  const kg = typeof datos.kg === "number" ? datos.kg : Number(datos.kg ?? 0);
  const kgDonacio = typeof datos.kg_donacio === "number"
    ? datos.kg_donacio
    : Number(datos.kg_donacio ?? 0);
  const kgCompra = typeof datos.kg_compra === "number"
    ? datos.kg_compra
    : Number(datos.kg_compra ?? 0);

  // ------------------------------------------------------------ identificación
  m.campos(
    paresLlenos([
      [t.numero, datos.numero],
      [t.exercici, datos.exercici],
      [
        t.periode,
        periodo.des_de && periodo.fins_a
          ? `${fechaLarga(periodo.des_de, t, lengua)} — ${fechaLarga(periodo.fins_a, t, lengua)}`
          : null,
      ],
      [t.data_emissio, fechaLarga(datos.data_generacio, t, lengua)],
      [t.codi_verificacio, codigoVerificacion(op.sha256Datos)],
      [t.motiu_rectificacio, op.rectificativo ? datos.motiu_rectificacio : null],
    ]),
    { anchoEtiqueta: 150, despues: 8 },
  );

  // -------------------------------------------------------- quién certifica
  m.filete();
  m.espacio(6);
  m.titulo(t.qui_certifica, 3);
  m.campos(
    paresLlenos([
      [t.rao_social, datos.apoderada?.nom],
      [t.carrec, datos.apoderada?.carrec],
      // El DNI llega por parámetro: `documentos.datos` no lo lleva (§cd.ts). Meterlo en el
      // snapshot anularía el GRANT por columnas, porque ese jsonb lo lee la propia entidad.
      [t.dni, op.apoderadaDni],
    ]),
    { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
  );
  m.espacio(4);
  pintarOrganizacion(ctx, t.emet, datos.fundacio, { esFundacion: true });
  m.espacio(4);
  pintarOrganizacion(ctx, t.receptora, datos.receptora, {});

  // ----------------------------------------------------------------- CERTIFICA
  const valores = {
    numero: datos.numero ?? "",
    exercici: datos.exercici ?? "",
    codi: codigoVerificacion(op.sha256Datos),
    kg: num(kg, 1),
    kg_donacio: num(kgDonacio, 1),
    kg_compra: num(kgCompra, 1),
    // Claves ASCII: los marcadores son `[a-zA-Z0-9_.]` y el snapshot trae `raó_social`.
    receptora: {
      rao_social: datos.receptora?.["raó_social"] ?? "",
      nif: datos.receptora?.nif ?? "",
      domicili: domicilioCompleto(datos.receptora),
      poblacio: datos.receptora?.poblacio ?? "",
    },
    fundacio: {
      rao_social: datos.fundacio?.["raó_social"] ?? "",
      cif: datos.fundacio?.cif ?? "",
      domicili: domicilioCompleto(datos.fundacio),
      inscripcio: datos.fundacio?.inscripcio ?? "",
    },
    periode: {
      des_de: fechaLarga(periodo.des_de, t, lengua),
      fins_a: fechaLarga(periodo.fins_a, t, lengua),
      des_de_art: fechaLargaConArticulo(periodo.des_de, t, lengua),
      fins_a_art: fechaLargaConArticulo(periodo.fins_a, t, lengua),
    },
    lloc: datos.lloc ?? "",
    data_generacio: fechaLarga(datos.data_generacio, t, lengua),
  };
  pintarLegal(ctx, CUERPO_PROVISIONAL[lengua], valores, { titulo: t.certifica_cr });

  // --------------------------------------------------------------- los kilos
  // El equivalente de la caja del importe en el CD: el cuerpo legal se puede sustituir por
  // una plantilla que lo diga de otra manera, y esta caja garantiza que la cifra que el
  // certificado acredita salga siempre — y con su desglose, que es lo que distingue este
  // documento de uno que solo contara donaciones.
  m.espacio(8);
  m.caja(
    `${t.total_kg}: ${num(kg, 1)} kg\n${t.quilos_cr_desglos(num(kgDonacio, 1), num(kgCompra, 1))}`,
    { titulo: t.quilos_cr, fondo: COLORES.verdeSuave, barra: COLORES.verde },
  );

  // ------------------------------------------------------ por qué no hay importes
  // La frase la escribe SQL (`datos.nota`) para que el papel y la base digan lo mismo; si
  // el snapshot no la trae, la del diccionario. Esta caja es lo que impide que la ausencia
  // de importes se lea como un olvido.
  m.espacio(8);
  m.caja((datos.nota ?? "").trim() || t.sense_imports_cr, {
    titulo: t.sense_imports_titol,
    fondo: COLORES.crema100,
  });

  // ------------------------------------------------------ detalle por producto
  const detalle = (Array.isArray(datos.detall) ? datos.detall : []).filter((l) => l && l.producte);
  if (detalle.length > 0) {
    m.espacio(8);
    m.titulo(t.detall_cr, 3);
    const columnas: Columna[] = [
      { titulo: t.col.producte, ancho: 40 },
      { titulo: t.col.operacions, ancho: 15, alinear: "derecha" },
      { titulo: t.col.kg_donacio, ancho: 15, alinear: "derecha" },
      { titulo: t.col.kg_compra, ancho: 15, alinear: "derecha" },
      { titulo: t.col.kg, ancho: 15, alinear: "derecha" },
    ];
    m.tabla({
      columnas,
      filas: detalle.map((l) => [
        l.producte ?? "",
        // Sin decimales: son operaciones contadas. `num(_, 0)` deja vacío lo que no es un
        // número, que es mejor que imprimir un 0 que nadie ha contado.
        num(l.operacions, 0),
        num(l.kg_donacio, 1),
        num(l.kg_compra, 1),
        `${num(l.kg, 1)} kg`,
      ]),
      cebra: true,
      despues: 6,
    });
    m.parrafo(`${t.total_kg}: ${num(kg, 1)} kg`, {
      fuente: m.fuentes.cuerpoFuerte,
      alinear: "derecha",
      despues: 6,
    });
  }

  // =========================================================================
  // PROCEDENCIA — los dos bloques que NO se pueden unificar (D3)
  // =========================================================================

  // ---- (1) DONACIÓN: municipio y comarca. Sin ninguna columna de organización, y sin
  //          ningún dato del que sacarla: `ProcedenciaDonacio` no tiene ni nombre ni NIF.
  const donacion: ProcedenciaDonacio[] = Array.isArray(datos.procedencies_donacio)
    ? datos.procedencies_donacio.filter((p) => p)
    : [];
  m.espacio(8);
  m.titulo(t.procedencia_donacio, 3);
  m.parrafo(t.procedencia_donacio_text, { color: COLORES.verdeGris, tamano: 9, despues: 6 });
  if (donacion.length > 0) {
    m.tabla({
      columnas: [
        { titulo: t.col.municipi, ancho: 35 },
        { titulo: t.col.comarca, ancho: 35 },
        { titulo: t.col.operacions, ancho: 15, alinear: "derecha" },
        { titulo: t.col.kg, ancho: 15, alinear: "derecha" },
      ],
      // Un municipio vacío se imprime vacío: el bloqueo `sense_procedencia` ya avisó al
      // emitir, y un «—» inventado se leería como un origen que no consta.
      filas: donacion.map((p) => [
        p.municipi ?? "",
        p.comarca ?? "",
        num(p.operacions, 0),
        `${num(p.kg, 1)} kg`,
      ]),
      cebra: true,
      despues: 6,
    });
  } else {
    m.parrafo(t.sense_procedencia_donacio, { color: COLORES.verdeGris, tamano: 9.5, despues: 6 });
  }

  // ---- (2) COMPRA (venta y maquila): aquí SÍ va el generador, con su NIF. Tabla propia,
  //          columnas propias, tipo propio.
  const compra: ProcedenciaCompra[] = Array.isArray(datos.procedencies_compra)
    ? datos.procedencies_compra.filter((p) => p)
    : [];
  m.espacio(6);
  m.titulo(t.procedencia_compra, 3);
  m.parrafo(t.procedencia_compra_text, { color: COLORES.verdeGris, tamano: 9, despues: 6 });
  if (compra.length > 0) {
    m.tabla({
      columnas: [
        { titulo: t.col.generador, ancho: 30 },
        { titulo: t.nif, ancho: 15 },
        { titulo: t.col.municipi, ancho: 22 },
        { titulo: t.col.via, ancho: 13 },
        { titulo: t.col.operacions, ancho: 10, alinear: "derecha" },
        { titulo: t.col.kg, ancho: 15, alinear: "derecha" },
      ],
      filas: compra.map((p) => [
        p.generador ?? "",
        p.nif ?? "",
        origen(p),
        via(p.tipus, t),
        num(p.operacions, 0),
        `${num(p.kg, 1)} kg`,
      ]),
      cebra: true,
      despues: 6,
    });
  } else {
    m.parrafo(t.sense_procedencia_compra, { color: COLORES.verdeGris, tamano: 9.5, despues: 6 });
  }

  // ------------------------------------------------------------- qué NO es esto
  // La diferencia con el CD no se puede dejar al criterio de quien lo lea: este papel
  // acredita kilos y nada más, y quien lo reciba puede acabar enseñándolo donde se espera
  // un certificado fiscal.
  m.espacio(6);
  m.caja(t.no_fiscal_text, { titulo: t.no_fiscal_titol, fondo: COLORES.crema100 });

  // ⚠️ Los bloqueos NO se imprimen (igual que en el CD y el CT): los que bloquean impiden
  // la emisión, así que en un CR emitido no puede haber ninguno, y los que no bloquean
  // hablan de lo que falta en la ficha o de una entrega sin albarán — nada que un tercero
  // tenga que leer en el papel.

  // --------------------------------------------------------- lugar, fecha, firma
  await pintarFirma(ctx);

  return await cerrarCierre(ctx);
}
