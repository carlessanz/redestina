// Albarán de OPERACIÓN (OPE) — anexo A.3 del plan funcional.
//
// La salida comercial y la maquila: aquí el generador entrega directamente al comprador
// o al obrador, y la Fundació Espigoladors no es parte del intercambio, solo lo
// documenta. Por eso, a diferencia del ENT, **sí aparecen las dos organizaciones con su
// nombre**: son ellas las que contratan entre sí, y ocultar una parte a la otra en un
// documento que firman las dos no tendría ningún sentido.
//
// Diferencias con el ENT (anexo A.3):
//   · entrega el generador y recibe el comprador u obrador
//   · **confirman las dos partes**, no solo quien recibe (§3.3.2 del funcional)
//   · en maquila se añade la tipología de transformación y la mención de que el
//     productor conserva la propiedad del producto
//   · **nunca aparece el precio**, que es exactamente lo que hace falta recordar en el
//     único albarán de los tres que documenta una operación con dinero detrás: el dinero
//     se liquida por su cuenta (factura entre las partes), y este papel es la entrega
//     física. `albaran_lineas` no tiene ninguna columna de importe, así que no hay de
//     dónde sacar una cifra ni por descuido.

import type { BytesActivos } from "../fuentes.ts";
import type { Columna } from "../maquetador.ts";
import {
  abrirAlbaran,
  cerrarAlbaran,
  ent as entero,
  lineasDe,
  num,
  type OpcionesAlbaran,
  paresLlenos,
  pintarLineas,
  pintarRecogida,
  type Renderizado,
  sumaKg,
} from "./comu.ts";

export async function renderOpe(
  activos: BytesActivos,
  op: OpcionesAlbaran,
): Promise<Renderizado> {
  const ctx = await abrirAlbaran(activos, op);
  const { m, t, datos } = ctx;

  // El lugar de recogida sí se imprime entero: las dos partes se conocen.
  pintarRecogida(m, t, datos.recollida);

  // Maquila: la tipología de transformación acordada.
  const paresTransformacion = paresLlenos([[t.transformacio, datos.transformacio]]);
  if (paresTransformacion.length > 0) {
    m.espacio(4);
    m.campos(paresTransformacion, { anchoEtiqueta: 150, despues: 6 });
  }

  const lineas = lineasDe(datos);
  // Ocho columnas, no nueve: con el lote dentro, las tres de kilos se quedaban tan
  // estrechas que sus propias cabeceras se pisaban unas a otras. El lote va debajo,
  // igual que en el REC — es trazabilidad, y se lee mejor en una línea que en una
  // casilla de 40 pt partida por la mitad.
  const columnas: Columna[] = [
    { titulo: t.col.n, ancho: 5, alinear: "derecha" },
    { titulo: t.col.producte, ancho: 21 },
    { titulo: t.col.varietat, ancho: 12 },
    { titulo: t.col.caixes, ancho: 8, alinear: "derecha" },
    { titulo: t.col.tipus_caixa, ancho: 15 },
    { titulo: t.col.kg_previstos, ancho: 12, alinear: "derecha" },
    { titulo: t.col.kg_entregats, ancho: 13, alinear: "derecha" },
    { titulo: t.col.kg_confirmats, ancho: 14, alinear: "derecha" },
  ];
  const filas = lineas.map((l, i) => [
    String(l.ordre ?? i + 1),
    l.producte ?? "",
    l.varietat ?? "",
    entero(l.caixes),
    l.tipus_caixa ?? "",
    num(l.kg_previstos),
    num(l.kg_net),
    num(l.kg_confirmats),
  ]);

  pintarLineas(m, t, lineas, columnas, filas, {
    etiqueta: `${t.total} ${t.col.kg_entregats.toLowerCase()}`,
    valor: `${num(sumaKg(lineas, "kg_net"))} kg`,
  });

  const conLote = lineas.filter((l) => l.lot_origen);
  if (conLote.length > 0) {
    m.parrafo(
      `${t.col.lot}: ` + conLote.map((l) => `${l.producte ?? ""} — ${l.lot_origen}`).join(" · "),
      { tamano: 9, despues: 6 },
    );
  }

  // Las DOS partes confirman (§3.3.2): un bloque de firma por cada una, rotulados con
  // su razón social para que no haya duda de quién firma dónde. El `rol` es lo que
  // permite casar cada bloque con su confirmación registrada (`enlaces_token.rol_parte`);
  // usa el vocabulario de `albaran_partes()`, no uno propio.
  ctx.op.conformidades = [
    {
      rotulo: `${t.entrega} · ${datos.partes?.entrega?.razon_social ?? ""}`.trim().replace(/ ·\s*$/, ""),
      rol: "entrega",
    },
    {
      rotulo: `${t.rep} · ${datos.partes?.recibe?.razon_social ?? ""}`.trim().replace(/ ·\s*$/, ""),
      rol: "recibe",
    },
  ];

  return await cerrarAlbaran(ctx);
}
