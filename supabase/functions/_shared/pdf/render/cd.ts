// Certificado de donación (CD) — anexo B.2 del plan funcional.
//
// Es el único documento del sistema con efecto fiscal directo: es el papel que el donante
// se lleva a su declaración para aplicar la deducción del **artículo 16 de la Ley 49/2002**.
// De ahí las cuatro cosas que lo distinguen de todo lo demás que se imprime aquí:
//
//   1. **Lleva el importe, y dos veces**: en cifras y en letras (`_shared/pdf/lletres.ts`).
//      Es la garantía clásica contra un dígito cambiado a mano, y las dos formas salen del
//      mismo número para que no puedan discrepar.
//   2. **Cita la factura del donante**, que tiene que coincidir con ese importe a dos
//      decimales. `emitir_certificado()` no deja emitirlo si no coincide, salvo excepción
//      del super_admin con motivo (D4) — y entonces la excepción se imprime, porque un
//      certificado que se emitió por excepción no puede parecer uno normal.
//   3. **Lo firma una persona**: nombre, cargo y DNI de la apoderada, con su firma y el
//      sello estampados. El DNI **no está en `documentos.datos`** a propósito (ese jsonb lo
//      lee el propio donante): lo lee `generar-documento` con `service_role` de
//      `parametros_documentales` y llega aquí por parámetro.
//   4. **Lleva la fecha y el lugar de GENERACIÓN** (D14), no la del cierre ni la del
//      último kilo: es la fecha en la que la Fundación afirma lo que afirma.
//
// ⚠️ Y por eso la filigrana «PROVA · SENSE VALIDESA FISCAL» del modo prueba no es
//    decorativa: es lo que impide que un ensayo del cierre —que tiene el mismo aspecto,
//    los mismos kilos y el mismo importe que el de verdad— acabe en una declaración. La
//    serie `P-CD` sola no basta: un prefijo no se lee de un vistazo.
//
// Contrato de siempre: este fichero no lee ficheros ni habla con la base.

import type { BytesActivos } from "../fuentes.ts";
import { COLORES, type Columna } from "../maquetador.ts";
import { importEnLletres, importEnXifres } from "../lletres.ts";
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
 * El cuerpo del certificado MIENTRAS la fase 0 no entregue el texto validado por la
 * asesoría. Se imprime dentro de la caja que dice que es provisional, como en los
 * albaranes: un texto con aspecto de certificado y sin aviso sería lo único indefendible.
 *
 * Los marcadores son los mismos que espera la plantilla definitiva, así que el día que
 * llegue solo hay que cargarla en `plantillas_documento` — este texto deja de imprimirse
 * sin tocar una línea de código.
 */
const CUERPO_PROVISIONAL: Record<"ca" | "es", Bloque[]> = {
  ca: [
    {
      tipo: "p",
      text:
        "Que {{donant.rao_social}}, amb NIF {{donant.nif}} i domicili a {{donant.domicili}}, ha lliurat a {{fundacio.rao_social}}, amb CIF {{fundacio.cif}}, aliments fora del circuit de venda habitual durant el període comprès entre {{periode.des_de_art}} i {{periode.fins_a_art}}.",
    },
    {
      tipo: "p",
      text:
        "Que aquest lliurament té caràcter de donació pura, simple i irrevocable, feta a títol gratuït, sense contraprestació de cap mena i sense que el donant hagi rebut ni hagi de rebre cap pagament ni cap bé o servei a canvi.",
    },
    {
      tipo: "p",
      text:
        "Que els aliments donats sumen {{kg}} quilos nets conciliats, valorats en {{import_lletres}} ({{import_xifres}}), d'acord amb el cost per quilo de cada producte fixat per a l'exercici {{exercici}}.",
    },
    {
      tipo: "p",
      text:
        "Que els aliments s'han rebut efectivament i s'han destinat íntegrament a les finalitats d'interès general de la Fundació, per fer-los arribar a entitats socials.",
    },
    {
      tipo: "p",
      text:
        "Que aquesta donació dona dret al donant a aplicar les deduccions previstes a l'article 16 de la Llei 49/2002, de 23 de desembre, de règim fiscal de les entitats sense fins lucratius i dels incentius fiscals al mecenatge, i que la Fundació la inclourà en la declaració informativa anual corresponent (model 182).",
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
        "Que {{donant.rao_social}}, con NIF {{donant.nif}} y domicilio en {{donant.domicili}}, ha entregado a {{fundacio.rao_social}}, con CIF {{fundacio.cif}}, alimentos fuera del circuito de venta habitual durante el periodo comprendido entre {{periode.des_de_art}} y {{periode.fins_a_art}}.",
    },
    {
      tipo: "p",
      text:
        "Que esta entrega tiene carácter de donación pura, simple e irrevocable, hecha a título gratuito, sin contraprestación de ningún tipo y sin que el donante haya recibido ni deba recibir ningún pago ni ningún bien o servicio a cambio.",
    },
    {
      tipo: "p",
      text:
        "Que los alimentos donados suman {{kg}} kilos netos conciliados, valorados en {{import_lletres}} ({{import_xifres}}), de acuerdo con el coste por kilo de cada producto fijado para el ejercicio {{exercici}}.",
    },
    {
      tipo: "p",
      text:
        "Que los alimentos se han recibido efectivamente y se han destinado íntegramente a los fines de interés general de la Fundación, para hacerlos llegar a entidades sociales.",
    },
    {
      tipo: "p",
      text:
        "Que esta donación da derecho al donante a aplicar las deducciones previstas en el artículo 16 de la Ley 49/2002, de 23 de diciembre, de régimen fiscal de las entidades sin fines lucrativos y de los incentivos fiscales al mecenazgo, y que la Fundación la incluirá en la declaración informativa anual correspondiente (modelo 182).",
    },
    {
      tipo: "p",
      text:
        "Y para que así conste, se expide este certificado con número {{numero}} y código de verificación {{codi}}.",
    },
  ],
};

export async function renderCd(
  activos: BytesActivos,
  op: OpcionesCierre,
  idioma?: string | null,
): Promise<Renderizado> {
  const lengua: "ca" | "es" = idioma === "es" ? "es" : "ca";
  const datos = op.datos;
  const t = diccionarioCierre(lengua);

  const ctx = await abrirCierre(activos, op, {
    titulo: op.rectificativo ? `${t.cd} · ${t.rectificatiu}` : t.cd,
    subtitulo: t.cd_sub,
    idioma: lengua,
  });
  const { m } = ctx;

  const periodo = datos.periode ?? {};
  const kg = typeof datos.kg === "number" ? datos.kg : Number(datos.kg ?? 0);
  const importe = typeof datos.import === "number" ? datos.import : Number(datos.import ?? 0);
  const letras = importEnLletres(importe, lengua);
  const cifras = importEnXifres(importe);

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
      // El DNI llega por parámetro: `documentos.datos` no lo lleva (cabecera del fichero).
      [t.dni, op.apoderadaDni],
    ]),
    { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
  );
  m.espacio(4);
  pintarOrganizacion(ctx, t.emet, datos.fundacio, { esFundacion: true });
  m.espacio(4);
  pintarOrganizacion(ctx, t.donant, datos.donant, {});

  // ----------------------------------------------------------------- CERTIFICA
  const valores = {
    numero: datos.numero ?? "",
    exercici: datos.exercici ?? "",
    codi: codigoVerificacion(op.sha256Datos),
    kg: num(kg, 1),
    import_xifres: cifras,
    import_lletres: letras.texto,
    // Claves ASCII: los marcadores son `[a-zA-Z0-9_.]` y el snapshot trae `raó_social`.
    donant: {
      rao_social: datos.donant?.["raó_social"] ?? "",
      nif: datos.donant?.nif ?? "",
      domicili: domicilioCompleto(datos.donant),
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
    factura: {
      numero: datos.factura?.numero ?? "",
      data: fechaLarga(datos.factura?.data, t, lengua),
      import: datos.factura?.import === null || datos.factura?.import === undefined
        ? ""
        : importEnXifres(Number(datos.factura.import)),
    },
    lloc: datos.lloc ?? "",
    data_generacio: fechaLarga(datos.data_generacio, t, lengua),
  };
  pintarLegal(ctx, CUERPO_PROVISIONAL[lengua], valores, { titulo: t.certifica });

  // ------------------------------------------------------------- el importe
  // Repetido a propósito fuera del cuerpo legal: el cuerpo se puede sustituir por una
  // plantilla que lo diga de otra manera, y esta caja es la que garantiza que las dos
  // formas del importe salgan SIEMPRE, juntas y con el mismo origen.
  m.espacio(8);
  m.caja(
    `${t.quilos}: ${num(kg, 1)} kg\n${t.import_xifres}: ${cifras}\n${t.import_lletres}: ${letras.texto}`,
    { titulo: t.import_titol, fondo: COLORES.verdeSuave, barra: COLORES.verde },
  );

  // -------------------------------------------------------------- la factura
  m.espacio(8);
  if (datos.excepcio_sense_factura) {
    // D4: si se emitió sin factura coincidente, el papel lo dice. Un certificado emitido
    // por excepción que pareciera normal convertiría la excepción en invisible.
    m.caja(
      `${t.excepcio_text} ${datos.excepcio_motiu ?? "—"}`,
      { titulo: t.excepcio_titol, fondo: COLORES.crema100 },
    );
  } else if (datos.factura?.numero) {
    m.titulo(t.factura_citada, 3);
    m.campos(
      paresLlenos([
        [t.numero, datos.factura.numero],
        [t.data_emissio, fechaLarga(datos.factura.data, t, lengua)],
        [
          t.factura_import,
          datos.factura.import === null || datos.factura.import === undefined
            ? null
            : importEnXifres(Number(datos.factura.import)),
        ],
      ]),
      { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
    );
  } else {
    m.parrafo(t.factura_citada_sense, { color: COLORES.verdeGris, tamano: 9.5, despues: 4 });
  }

  // ------------------------------------------------------ detalle por producto
  const detalle = (Array.isArray(datos.detall) ? datos.detall : []).filter((l) => l && l.producte);
  if (detalle.length > 0) {
    m.espacio(6);
    m.titulo(t.detall_cd, 3);
    const columnas: Columna[] = [
      { titulo: t.col.producte, ancho: 50 },
      { titulo: t.col.kg, ancho: 25, alinear: "derecha" },
      { titulo: t.col.valor, ancho: 25, alinear: "derecha" },
    ];
    m.tabla({
      columnas,
      filas: detalle.map((l) => [
        l.producte ?? "",
        `${num(l.kg, 1)} kg`,
        importEnXifres(Number(l.valor ?? 0)),
      ]),
      cebra: true,
      despues: 6,
    });
  }

  // --------------------------------------------------------- lugar, fecha, firma
  // El bloque de firma es el MISMO del CT: vive en `cierre.ts` desde la fase 5, porque
  // los dos certificados los firma la misma apoderada con el mismo PNG.
  await pintarFirma(ctx);

  return await cerrarCierre(ctx);
}
