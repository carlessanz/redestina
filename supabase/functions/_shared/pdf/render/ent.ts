// Albarán de ENTREGA (ENT) — anexo A.2 del plan funcional.
//
// Lo que sale: la Fundació Espigoladors entrega a una entidad receptora.
//
// ⚠️ DECISIÓN D3 — EL NOMBRE DEL PRODUCTOR NO APARECE EN ESTE DOCUMENTO. La entidad que
//    recibe no tiene por qué saber de qué explotación viene el producto: saberlo la
//    pondría en relación directa con el generador y eso rompe el papel de la Fundación
//    como parte del intercambio. Lo que sí necesita —y es lo que exige la trazabilidad
//    alimentaria— es de dónde viene geográficamente y con qué lote: **municipio,
//    comarca y código de lote**, y nada más.
//
//    Eso no se decide aquí: `albaran_partes()` ya compone `partes.origen` con esos tres
//    campos y `partes.entrega` es la Fundación, no el productor. Este renderizador no
//    tiene acceso al nombre del generador ni aunque quisiera imprimirlo, que es la
//    manera correcta de garantizar una regla como esta. Lo único que sí podría filtrarse
//    es el **lugar de recogida** dentro del bloque de recogida (el alias de la finca),
//    y por eso aquí se pinta con `ocultarLugar` y se sustituye por el municipio.
//
// Y como en los otros dos: **ninguna cifra en euros**.

import type { BytesActivos } from "../fuentes.ts";
import type { Columna } from "../maquetador.ts";
import { COLORES } from "../maquetador.ts";
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

export async function renderEnt(
  activos: BytesActivos,
  op: OpcionesAlbaran,
): Promise<Renderizado> {
  const ctx = await abrirAlbaran(activos, op);
  const { m, t, datos } = ctx;

  // ------------------------------------------------- origen del producto (D3)
  const origen = datos.partes?.origen ?? {};
  const paresOrigen = paresLlenos([
    [t.municipi, origen.municipio],
    [t.comarca, origen.comarca],
    [t.codi_lot, origen.codigo_lote],
    [t.nota_lot, datos.nota_lot],
  ]);
  if (paresOrigen.length > 0) {
    m.espacio(4);
    m.filete();
    m.espacio(6);
    m.titulo(t.origen, 2);
    m.campos(paresOrigen, { anchoEtiqueta: 150, despues: 6 });
  }

  pintarRecogida(m, t, datos.recollida, {
    ocultarOrigen: true,
    municipio: origen.municipio ?? null,
  });

  // ------------------------------------------------------------------ líneas
  const lineas = lineasDe(datos);
  const columnas: Columna[] = [
    { titulo: t.col.n, ancho: 5, alinear: "derecha" },
    { titulo: t.col.producte, ancho: 21 },
    { titulo: t.col.varietat, ancho: 12 },
    { titulo: t.col.caixes, ancho: 8, alinear: "derecha" },
    { titulo: t.col.tipus_caixa, ancho: 15 },
    { titulo: t.col.kg_previstos, ancho: 12, alinear: "derecha" },
    { titulo: t.col.kg_entregats, ancho: 13, alinear: "derecha" },
    { titulo: t.col.kg_confirmats, ancho: 13, alinear: "derecha" },
  ];
  const filas = lineas.map((l, i) => [
    String(l.ordre ?? i + 1),
    l.producte ?? "",
    l.varietat ?? "",
    entero(l.caixes),
    l.tipus_caixa ?? "",
    num(l.kg_previstos),
    num(l.kg_net),
    // Vacío mientras la entidad no haya confirmado: un 0 aquí se leería como «no
    // recibió nada», que es una afirmación distinta de «todavía no ha dicho nada».
    num(l.kg_confirmats),
  ]);

  const entregados = sumaKg(lineas, "kg_net");
  const confirmados = sumaKg(lineas, "kg_confirmats");
  pintarLineas(m, t, lineas, columnas, filas, {
    etiqueta: `${t.total} ${t.col.kg_entregats.toLowerCase()}`,
    valor: `${num(entregados)} kg`,
  });

  if (confirmados > 0 && lineas.length > 0) {
    m.parrafo(
      `${t.total} ${t.col.kg_confirmats.toLowerCase()}: ${num(confirmados)} kg`,
      { fuente: m.fuentes.cuerpoFuerte, alinear: "derecha", color: COLORES.verdeGris, despues: 6 },
    );
  }

  return await cerrarAlbaran(ctx);
}
