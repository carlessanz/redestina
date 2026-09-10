// Resumen anual de donaciones (RES) — anexo B.1 del plan funcional.
//
// Es el documento que abre el cierre del ejercicio: le dice al donante cuánto ha
// entregado —por producto y por mes—, a qué entidades ha llegado, cuánto vale según el
// coste por kilo congelado al conciliar, y **le pide la factura** con la que después se
// emite el certificado.
//
// Tres cosas que el papel tiene que dejar claras porque son las que más se preguntan:
//   1. la factura va **a nombre de la Fundació Espigoladors**, no al revés;
//   2. la fecha de la operación es el **31 de diciembre** del ejercicio;
//   3. **no hay ningún pago**: el importe es la valoración de lo donado, no una deuda.
//
// Sí lleva importes (§cierre.ts): sin ellos no se puede pedir una factura por un importe.
//
// Se emite **dos veces con el mismo número**: la versión provisional (`subtipo`
// `provisional`, a mediados de diciembre) y la definitiva tras el cierre. Lo único que
// cambia en el papel es el rótulo; el número, no (§A del plan: el número pertenece a la
// fila del dominio, no al PDF).

import type { BytesActivos } from "../fuentes.ts";
import { COLORES, type Columna } from "../maquetador.ts";
import { importEnXifres } from "../lletres.ts";
import { num } from "./comu.ts";
import type { Bloque } from "../plantilla.ts";
import {
  abrirCierre,
  cerrarCierre,
  codigoVerificacion,
  diccionarioCierre,
  fechaLarga,
  nombreMes,
  type OpcionesCierre,
  paresLlenos,
  pintarBloqueos,
  pintarLegal,
  pintarOrganizacion,
  type Renderizado,
} from "./cierre.ts";

/**
 * Texto PROVISIONAL del resumen, mientras la fase 0 no entregue el validado. No es el
 * texto legal de nada —el resumen no certifica, informa— pero sí es lo que explica la
 * valoración, y una explicación equivocada de cómo se ha calculado un importe es tan
 * mala como una cláusula equivocada.
 */
const LEGAL_PROVISIONAL: Record<"ca" | "es", Bloque[]> = {
  ca: [
    {
      tipo: "p",
      text:
        "Els quilos d'aquest resum són els nets conciliats: els que van quedar confirmats per qui va rebre el producte, no els previstos ni els pesats a l'origen. Cap quilo sense conciliar hi entra.",
    },
    {
      tipo: "p",
      text:
        "El valor surt de multiplicar aquests quilos pel cost per quilo de cada producte de l'exercici {{exercici}}, que es congela en el moment de conciliar cada operació. No és un preu de venda ni una oferta: és el criteri de valoració de la donació.",
    },
    {
      tipo: "p",
      text:
        "Aquest resum no és una factura ni comporta cap pagament. La factura l'has d'emetre tu a nom de {{factura.a_nom_de}} per l'import indicat, amb data d'operació {{factura.data}}.",
    },
    {
      tipo: "p",
      text:
        "Codi de verificació d'aquest document: {{codi}}. Si el contingut canviés, el codi deixaria de coincidir.",
    },
  ],
  es: [
    {
      tipo: "p",
      text:
        "Los kilos de este resumen son los netos conciliados: los que quedaron confirmados por quien recibió el producto, no los previstos ni los pesados en origen. Ningún kilo sin conciliar entra aquí.",
    },
    {
      tipo: "p",
      text:
        "El valor sale de multiplicar esos kilos por el coste por kilo de cada producto del ejercicio {{exercici}}, que se congela en el momento de conciliar cada operación. No es un precio de venta ni una oferta: es el criterio de valoración de la donación.",
    },
    {
      tipo: "p",
      text:
        "Este resumen no es una factura ni comporta ningún pago. La factura la tienes que emitir tú a nombre de {{factura.a_nom_de}} por el importe indicado, con fecha de operación {{factura.data}}.",
    },
    {
      tipo: "p",
      text:
        "Código de verificación de este documento: {{codi}}. Si el contenido cambiara, el código dejaría de coincidir.",
    },
  ],
};

/**
 * ⚠️ El idioma NO sale del snapshot: sale de `documentos.idioma`, que decide
 * `cierre_emet_document()` con el perfil del titular del donante. Por eso entra por
 * parámetro y no se deduce de `datos`; sin él, catalán, que es el defecto del proyecto (§7).
 */
export async function renderRes(
  activos: BytesActivos,
  op: OpcionesCierre,
  idioma?: string | null,
): Promise<Renderizado> {
  return await pintar(activos, op, idioma === "es" ? "es" : "ca");
}

async function pintar(
  activos: BytesActivos,
  op: OpcionesCierre,
  idioma: "ca" | "es",
): Promise<Renderizado> {
  const datos = op.datos;
  const t = diccionarioCierre(idioma);
  const provisional = op.subtipo === "provisional";

  const ctx = await abrirCierre(activos, op, {
    titulo: provisional ? `${t.res} · ${t.res_provisional}` : t.res,
    subtitulo: t.res_sub,
    idioma,
  });
  const { m } = ctx;

  // ------------------------------------------------------------ identificación
  m.campos(
    paresLlenos([
      [t.numero, datos.numero],
      [t.exercici, datos.exercici],
      [t.codi_verificacio, codigoVerificacion(op.sha256Datos)],
    ]),
    { anchoEtiqueta: 150, despues: 8 },
  );

  // ------------------------------------------------------------------- partes
  m.filete();
  m.espacio(6);
  pintarOrganizacion(ctx, t.donant, datos.donant, {});
  m.espacio(4);
  pintarOrganizacion(ctx, t.emet, datos.fundacio, { esFundacion: true });

  // -------------------------------------------------------------------- total
  const kg = typeof datos.kg_total === "number" ? datos.kg_total : Number(datos.kg_total ?? 0);
  const valor = typeof datos.valor_total === "number"
    ? datos.valor_total
    : Number(datos.valor_total ?? 0);

  m.espacio(6);
  m.filete();
  m.espacio(6);
  m.titulo(t.total_exercici, 2);
  m.campos(
    [
      [t.total_kg, `${num(kg, 1)} kg`],
      [t.total_valor, importEnXifres(valor)],
    ],
    { anchoEtiqueta: 150, tamano: 11, despues: 6 },
  );

  // ------------------------------------------------------- detalle por producto
  const detalle = Array.isArray(datos.detall) ? datos.detall : [];
  m.titulo(t.detall, 2);
  if (detalle.length === 0) {
    m.parrafo(t.sense_detall, { color: COLORES.verdeGris, tamano: 10, despues: 8 });
  } else {
    const columnas: Columna[] = [
      { titulo: t.col.producte, ancho: 30 },
      { titulo: t.col.mes, ancho: 16 },
      { titulo: t.col.kg, ancho: 16, alinear: "derecha" },
      { titulo: t.col.cost_kg, ancho: 17, alinear: "derecha" },
      { titulo: t.col.valor, ancho: 21, alinear: "derecha" },
    ];
    const filas = detalle.map((l) => [
      l.producte ?? "",
      nombreMes(l.mes, t),
      `${num(l.kg, 1)} kg`,
      // El coste por kilo lleva DOS decimales aunque sea pequeño: con uno solo, 0,85 €/kg
      // se imprimiría como 0,9 y el producto de la fila dejaría de cuadrar a ojo.
      l.cost_kg === null || l.cost_kg === undefined ? "" : importEnXifres(Number(l.cost_kg)),
      importEnXifres(Number(l.valor ?? 0)),
    ]);
    m.tabla({ columnas, filas, cebra: true, despues: 6 });
    m.parrafo(
      `${t.total_valor}: ${importEnXifres(valor)} · ${num(kg, 1)} kg`,
      { fuente: m.fuentes.cuerpoFuerte, alinear: "derecha", despues: 6 },
    );
  }

  // ------------------------------------------------------------- destinaciones
  const destinos = (datos.destinacions ?? [])
    .map((d) => (d?.entitat ?? "").trim())
    .filter((x) => x !== "");
  m.espacio(4);
  m.titulo(t.destinacions, 2);
  if (destinos.length === 0) {
    m.parrafo(t.sense_destinacions, { color: COLORES.verdeGris, tamano: 10, despues: 6 });
  } else {
    m.parrafo(t.destinacions_text, { tamano: 9.5, despues: 6 });
    m.lista(destinos, { despues: 6 });
  }

  // ---------------------------------------------------------------- la factura
  const factura = datos.factura ?? {};
  m.espacio(4);
  m.filete();
  m.espacio(6);
  m.titulo(t.factura_titol, 2);
  m.campos(
    paresLlenos([
      [t.factura_a_nom, factura.a_nom_de ?? datos.fundacio?.["raó_social"]],
      [t.cif, datos.fundacio?.cif],
      [
        t.factura_import,
        factura.import === null || factura.import === undefined
          ? importEnXifres(valor)
          : importEnXifres(Number(factura.import)),
      ],
      // La ayuda («31 de desembre de l'exercici») solo se imprime cuando NO hay fecha:
      // con la fecha delante, repetirla es ruido.
      [
        t.factura_data,
        fechaLarga(factura.data_operacio, t, idioma) || t.factura_data_ajuda,
      ],
      [t.factura_concepte, factura.concepte],
    ]),
    { anchoEtiqueta: 150, despues: 8 },
  );
  m.caja(t.factura_avis, { titulo: t.factura_avis_titol });

  // ----------------------------------------------------------------- el enlace
  m.espacio(8);
  m.titulo(t.enllac_titol, 2);
  if (op.enlaceFactura) {
    m.parrafo(t.enllac_text(op.enlaceDias ?? 60), { tamano: 9.5, despues: 4 });
    // La URL se imprime entera y en el cuerpo del papel: quien lo lea en papel tiene que
    // poder teclearla. `cortar()` la parte por caracteres si no cabe (§maquetador).
    m.parrafo(op.enlaceFactura, {
      fuente: m.fuentes.cuerpoFuerte,
      tamano: 9,
      color: COLORES.verdeOscuro,
      despues: 6,
    });
  } else {
    m.parrafo(t.enllac_sense, { tamano: 9.5, despues: 6 });
  }

  // --------------------------------------------------------------- bloqueos
  pintarBloqueos(ctx);

  // ------------------------------------------------------------- texto legal
  pintarLegal(ctx, LEGAL_PROVISIONAL[idioma], {
    numero: datos.numero ?? "",
    exercici: datos.exercici ?? "",
    codi: codigoVerificacion(op.sha256Datos),
    donant: datos.donant ?? {},
    fundacio: datos.fundacio ?? {},
    factura: {
      ...factura,
      a_nom_de: factura.a_nom_de ?? datos.fundacio?.["raó_social"] ?? "",
      data: fechaLarga(factura.data_operacio, t, idioma),
      import: importEnXifres(
        factura.import === null || factura.import === undefined ? valor : Number(factura.import),
      ),
    },
    kg_total: num(kg, 1),
    valor_total: importEnXifres(valor),
  });

  return await cerrarCierre(ctx);
}
