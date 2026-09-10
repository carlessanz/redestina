// Certificado de transacción (CT) — el hermano del CD para venta y maquila.
//
// Acredita al **generador** las operaciones que ha hecho durante el ejercicio con los
// kilos que quedaron conciliados. Comparte con el certificado de donación el esqueleto
// entero (`cierre.ts`): mismo snapshot anual, mismas partes, mismo diccionario, misma
// firma de la apoderada y la misma filigrana de prueba. Solo cambian tres cosas, y las
// tres importan:
//
//   1. **De dónde salen los kilos**: de los albaranes de operación (`OPE`), no de los de
//      recepción. Eso lo resuelve `cierre_datos_certificado_transaccion()`; aquí llega ya
//      hecho.
//   2. **NO LLEVA NINGÚN IMPORTE.** El funcional es explícito: el CT «acredita la
//      operación realizada con los kilos conciliados, no recoge importes; el valor
//      económico queda registrado a nivel interno». No es una decisión de maquetación:
//      el snapshot **no trae ni un euro** (`cierre_datos_certificado_transaccion` deja
//      fuera `valor`, `valor_total` y `coste_kg` a propósito), así que aquí no hay nada
//      que filtrar. La garantía es la misma que en los albaranes: no hay de dónde sacar
//      un símbolo de euro. Lo único que puede traerlo es texto libre escrito por una
//      persona, y ese no se toca.
//      ⚠️ Por eso este fichero **no importa `lletres.ts` ni `importEnXifres`**. Si algún
//      día alguien necesita ese import aquí, lo que hay que revisar es por qué.
//   3. **No hay factura, ni excepción D4**: el pago se tramita fuera de la plataforma y
//      el papel lo dice en su propia caja, con la frase que escribe SQL (`datos.nota`).
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
  domicilioCompleto,
  fechaLarga,
  fechaLargaConArticulo,
  type OpcionesCierre,
  paresLlenos,
  pintarFirma,
  pintarLegal,
  pintarOrganizacion,
  type Renderizado,
} from "./cierre.ts";

/**
 * El cuerpo del certificado MIENTRAS la fase 0 no entregue el texto validado. Mismo
 * criterio que el CD: se imprime dentro de la caja que dice que es provisional, y los
 * marcadores son los que esperará la plantilla definitiva, así que el día que llegue solo
 * hay que cargarla en `plantillas_documento`.
 *
 * ⚠️ Ni un marcador de importe. El diccionario de valores que se le pasa tampoco tiene
 *    ninguno: una plantilla futura que pidiera `{{import}}` se quedaría sin resolver y lo
 *    diría en el log, que es exactamente lo que debe pasar.
 */
const CUERPO_PROVISIONAL: Record<"ca" | "es", Bloque[]> = {
  ca: [
    {
      tipo: "p",
      text:
        "Que {{generador.rao_social}}, amb NIF {{generador.nif}} i domicili a {{generador.domicili}}, ha realitzat amb {{fundacio.rao_social}}, amb CIF {{fundacio.cif}}, operacions de venda o de transformació per maquila d'aliments fora del circuit de venda habitual durant el període comprès entre {{periode.des_de_art}} i {{periode.fins_a_art}}.",
    },
    {
      tipo: "p",
      text:
        "Que aquestes operacions sumen {{kg}} quilos nets conciliats, confirmats per qui va rebre el producte i documentats amb els albarans d'operació corresponents.",
    },
    {
      tipo: "p",
      text:
        "Que aquest certificat acredita únicament les operacions i els quilos: no recull cap import ni cap condició econòmica. El pagament es tramita fora de la plataforma, directament entre les parts.",
    },
    {
      tipo: "p",
      text:
        "Que aquest certificat no té efectes fiscals de donació i no dona dret a cap deducció: les operacions que acredita no són donacions.",
    },
    {
      tipo: "p",
      text:
        "I perquè així consti, s'expedeix aquest certificat amb número {{numero}} i codi de verificació {{codi}}.",
    },
  ],
  es: [
    {
      tipo: "p",
      text:
        "Que {{generador.rao_social}}, con NIF {{generador.nif}} y domicilio en {{generador.domicili}}, ha realizado con {{fundacio.rao_social}}, con CIF {{fundacio.cif}}, operaciones de venta o de transformación por maquila de alimentos fuera del circuito de venta habitual durante el periodo comprendido entre {{periode.des_de_art}} y {{periode.fins_a_art}}.",
    },
    {
      tipo: "p",
      text:
        "Que estas operaciones suman {{kg}} kilos netos conciliados, confirmados por quien recibió el producto y documentados con los albaranes de operación correspondientes.",
    },
    {
      tipo: "p",
      text:
        "Que este certificado acredita únicamente las operaciones y los kilos: no recoge ningún importe ni ninguna condición económica. El pago se tramita fuera de la plataforma, directamente entre las partes.",
    },
    {
      tipo: "p",
      text:
        "Que este certificado no tiene efectos fiscales de donación y no da derecho a ninguna deducción: las operaciones que acredita no son donaciones.",
    },
    {
      tipo: "p",
      text:
        "Y para que así conste, se expide este certificado con número {{numero}} y código de verificación {{codi}}.",
    },
  ],
};

/**
 * ⚠️ El idioma NO sale del snapshot: sale de `documentos.idioma`, que decide
 * `cierre_emet_document()` con el perfil del titular. Mismo contrato que RES y CD.
 */
export async function renderCt(
  activos: BytesActivos,
  op: OpcionesCierre,
  idioma?: string | null,
): Promise<Renderizado> {
  const lengua: "ca" | "es" = idioma === "es" ? "es" : "ca";
  const datos = op.datos;
  const t = diccionarioCierre(lengua);

  const ctx = await abrirCierre(activos, op, {
    titulo: t.ct,
    subtitulo: t.ct_sub,
    idioma: lengua,
  });
  const { m } = ctx;

  const periodo = datos.periode ?? {};
  const kg = typeof datos.kg === "number" ? datos.kg : Number(datos.kg ?? 0);

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
      // El DNI llega por parámetro: `documentos.datos` no lo lleva (§cd.ts).
      [t.dni, op.apoderadaDni],
    ]),
    { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
  );
  m.espacio(4);
  pintarOrganizacion(ctx, t.emet, datos.fundacio, { esFundacion: true });
  m.espacio(4);
  // La contraparte es el generador. `cierre_datos_certificado_transaccion` lo deja en
  // `generador`; el `donant` de un CT no existe y no se lee como respaldo a propósito:
  // si algún día llegara vacío, el papel tiene que enseñar el hueco, no rellenarlo con
  // una clave de otro documento.
  pintarOrganizacion(ctx, t.generador, datos.generador, {});

  // ----------------------------------------------------------------- CERTIFICA
  const valores = {
    numero: datos.numero ?? "",
    exercici: datos.exercici ?? "",
    codi: codigoVerificacion(op.sha256Datos),
    kg: num(kg, 1),
    // Claves ASCII: los marcadores son `[a-zA-Z0-9_.]` y el snapshot trae `raó_social`.
    generador: {
      rao_social: datos.generador?.["raó_social"] ?? "",
      nif: datos.generador?.nif ?? "",
      domicili: domicilioCompleto(datos.generador),
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
  pintarLegal(ctx, CUERPO_PROVISIONAL[lengua], valores, { titulo: t.certifica_ct });

  // --------------------------------------------------------------- los kilos
  // El equivalente de la caja del importe en el CD, y por el mismo motivo: el cuerpo
  // legal se puede sustituir por una plantilla que lo diga de otra manera, y esta caja
  // garantiza que la cifra que el certificado acredita salga siempre.
  m.espacio(8);
  m.caja(`${t.total_kg}: ${num(kg, 1)} kg`, {
    titulo: t.quilos_ct,
    fondo: COLORES.verdeSuave,
    barra: COLORES.verde,
  });

  // ------------------------------------------------------ por qué no hay importes
  // La frase la escribe SQL (`datos.nota`) para que el papel y la base digan lo mismo;
  // si el snapshot no la trae, la del diccionario. Esta caja es lo que impide que la
  // ausencia de importes se lea como un olvido.
  m.espacio(8);
  m.caja((datos.nota ?? "").trim() || t.sense_imports_text, {
    titulo: t.sense_imports_titol,
    fondo: COLORES.crema100,
  });

  // ------------------------------------------------------ detalle por producto
  const detalle = (Array.isArray(datos.detall) ? datos.detall : []).filter((l) => l && l.producte);
  if (detalle.length > 0) {
    m.espacio(8);
    m.titulo(t.detall_ct, 3);
    const columnas: Columna[] = [
      { titulo: t.col.producte, ancho: 55 },
      { titulo: t.col.operacions, ancho: 20, alinear: "derecha" },
      { titulo: t.col.kg, ancho: 25, alinear: "derecha" },
    ];
    m.tabla({
      columnas,
      filas: detalle.map((l) => [
        l.producte ?? "",
        // Sin decimales: son operaciones contadas. `num(_, 0)` deja vacío lo que no es
        // un número, que es mejor que imprimir un 0 que nadie ha contado.
        num(l.operacions, 0),
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

  // ------------------------------------------------------------- destinaciones
  const destinos = (datos.destinacions ?? [])
    .map((d) => (d?.entitat ?? "").trim())
    .filter((x) => x !== "");
  if (destinos.length > 0) {
    m.espacio(4);
    m.titulo(t.destinacions_ct, 3);
    m.lista(destinos, { despues: 6 });
  }

  // ⚠️ Los bloqueos NO se imprimen (igual que en el CD): los que bloquean impiden la
  // emisión, así que en un CT emitido no puede haber ninguno, y los que no bloquean
  // hablan del coste por quilo, que es justo lo que este papel no dice.

  // --------------------------------------------------------- lugar, fecha, firma
  await pintarFirma(ctx);

  return await cerrarCierre(ctx);
}
