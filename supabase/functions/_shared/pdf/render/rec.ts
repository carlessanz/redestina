// Albarán de RECEPCIÓN (REC) — anexo A.1 del plan funcional.
//
// Lo que entra: el generador entrega a la Fundació Espigoladors. Es el documento que
// abre la trazabilidad de un lote, y del que salen luego uno o varios ENT.
//
// Lo propio de este tipo frente a los otros dos:
//   · lleva el TIPO DE ENTRADA (donación o espigolada) y la referencia del registro
//   · lleva el lugar de recogida COMPLETO (aquí sí: el generador es parte del documento)
//   · sus líneas son las del pesaje: bruto, tara y neto, con la familia y el motivo por
//     el que el producto está fuera del circuito de venta
//   · **ninguna cifra en euros** (§comu.ts)

import type { BytesActivos } from "../fuentes.ts";
import type { Columna } from "../maquetador.ts";
import {
  abrirAlbaran,
  cerrarAlbaran,
  ent,
  lineasDe,
  num,
  type OpcionesAlbaran,
  pintarLineas,
  pintarRecogida,
  type Renderizado,
  sumaKg,
} from "./comu.ts";

export async function renderRec(
  activos: BytesActivos,
  op: OpcionesAlbaran,
): Promise<Renderizado> {
  const ctx = await abrirAlbaran(activos, op);
  const { m, t, datos } = ctx;

  pintarRecogida(m, t, datos.recollida);

  const lineas = lineasDe(datos);
  const columnas: Columna[] = [
    { titulo: t.col.n, ancho: 5, alinear: "derecha" },
    { titulo: t.col.producte, ancho: 20 },
    { titulo: t.col.varietat, ancho: 12 },
    { titulo: t.col.causa, ancho: 17 },
    { titulo: t.col.caixes, ancho: 8, alinear: "derecha" },
    { titulo: t.col.tipus_caixa, ancho: 11 },
    { titulo: t.col.kg_brut, ancho: 9, alinear: "derecha" },
    { titulo: t.col.tara, ancho: 8, alinear: "derecha" },
    { titulo: t.col.kg_net, ancho: 10, alinear: "derecha" },
  ];
  const filas = lineas.map((l, i) => [
    String(l.ordre ?? i + 1),
    // La familia acompaña al producto en la misma casilla: como columna propia se
    // comería el ancho de las de kilos, que son las que hay que poder leer.
    l.familia ? `${l.producte ?? ""}\n${l.familia}` : (l.producte ?? ""),
    l.varietat ?? "",
    l.causa ?? "",
    ent(l.caixes),
    l.tipus_caixa ?? "",
    num(l.kg_brut),
    num(l.tara_kg),
    num(l.kg_net),
  ]);

  pintarLineas(m, t, lineas, columnas, filas, {
    etiqueta: `${t.total} ${t.col.kg_net.toLowerCase()}`,
    valor: `${num(sumaKg(lineas, "kg_net"))} kg`,
  });

  // El lote de origen no cabe como columna sin apretar las de kilos, pero es
  // trazabilidad y no se puede perder: va como lista debajo cuando alguna lo trae.
  const conLote = lineas.filter((l) => l.lot_origen);
  if (conLote.length > 0) {
    m.parrafo(
      `${t.col.lot}: ` +
        conLote.map((l) => `${l.producte ?? ""} — ${l.lot_origen}`).join(" · "),
      { tamano: 9, despues: 6 },
    );
  }

  return await cerrarAlbaran(ctx);
}
