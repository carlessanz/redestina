// Maquetador de PDF de Redestina — A4, cabecera, pie paginado, párrafos, tablas
// con cabecera repetida, marca de agua e imágenes.
//
// Por qué un maquetador propio: `pdf-lib` dibuja, no maqueta. No corta líneas, no
// pagina y no sabe qué es una tabla. Lo que hay aquí son las primitivas que
// necesitan los documentos de Redestina (albarán, certificado, convenio, resumen),
// que son estructuralmente simples. A cambio, el control de los bytes es total y no
// entra ninguna dependencia de `node:stream`, `Buffer` ni `fs` en el runtime.
//
// SIN ESTADO GLOBAL: todo el estado (página actual, cursor, páginas emitidas) vive en
// la instancia. Dos peticiones concurrentes en el mismo isolate no se pisan.
//
// Unidades: puntos PostScript (1 pt = 1/72"). A4 = 595,28 × 841,89 pt.

import {
  degrees,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  rgb,
  type RGB,
} from "npm:pdf-lib@1";
import type { Fuentes } from "./fuentes.ts";

export const A4 = { ancho: 595.28, alto: 841.89 } as const;

/** Paleta del sistema de diseño (design/tokens.json). Nada de hex sueltos. */
export const COLORES = {
  verde: rgb(0x4e / 255, 0x6b / 255, 0x45 / 255),
  verdeOscuro: rgb(0x3e / 255, 0x51 / 255, 0x39 / 255),
  verdeClaro: rgb(0x7d / 255, 0x97 / 255, 0x75 / 255),
  verdeSuave: rgb(0xe4 / 255, 0xea / 255, 0xdf / 255),
  coral: rgb(0xef / 255, 0x7d / 255, 0x77 / 255),
  crema: rgb(0xf5 / 255, 0xf1 / 255, 0xea / 255),
  crema100: rgb(0xeb / 255, 0xe6 / 255, 0xda / 255),
  crema300: rgb(0xcf / 255, 0xc6 / 255, 0xb3 / 255),
  negro: rgb(0x1d / 255, 0x1d / 255, 0x1b / 255),
  verdeGris: rgb(0x5f / 255, 0x6b / 255, 0x5a / 255),
  blanco: rgb(1, 1, 1),
} as const;

export interface Margenes {
  arriba: number;
  abajo: number;
  izquierda: number;
  derecha: number;
}

export type Alineacion = "izquierda" | "derecha" | "centro";

export interface EstiloTexto {
  fuente?: PDFFont;
  tamano?: number;
  color?: RGB;
  /** Multiplicador del alto de línea sobre el tamaño (1.35 por defecto). */
  interlineado?: number;
  alinear?: Alineacion;
  /** Espacio libre por encima y por debajo del bloque. */
  antes?: number;
  despues?: number;
  /** Sangría por la izquierda, en puntos. */
  sangria?: number;
}

export interface Columna {
  titulo: string;
  /** Peso relativo; los anchos se escalan al ancho útil de la página. */
  ancho: number;
  alinear?: Alineacion;
}

export interface OpcionesTabla {
  columnas: Columna[];
  /** Cada fila, una celda por columna. `null`/`undefined` se pintan vacías. */
  filas: (string | number | null | undefined)[][];
  tamano?: number;
  /** Repetir la cabecera al saltar de página (por defecto, sí). */
  cabeceraRepetida?: boolean;
  /** Fondo alterno en las filas impares. */
  cebra?: boolean;
  padding?: number;
  antes?: number;
  despues?: number;
}

export interface OpcionesImagen {
  ancho?: number;
  alto?: number;
  alinear?: Alineacion;
  antes?: number;
  despues?: number;
}

export interface OpcionesMarcaAgua {
  texto: string;
  color?: RGB;
  opacidad?: number;
  tamano?: number;
  /** Grados en sentido antihorario. 45 por defecto. */
  giro?: number;
}

export interface OpcionesMaquetador {
  fuentes: Fuentes;
  /** Logo ya embebido (`embeberLogo`). Sin él la cabecera solo lleva texto. */
  logo?: PDFImage | null;
  /** Rótulo de la cabecera, a la derecha del logo (p. ej. el número del documento). */
  cabecera?: string;
  /** Segunda línea de la cabecera, más pequeña. */
  subcabecera?: string;
  /** Texto del pie, a la izquierda. La derecha siempre lleva «pàg. n de N». */
  pie?: string;
  marcaAgua?: OpcionesMarcaAgua | string | null;
  margenes?: Partial<Margenes>;
  /** Cómo se escribe la paginación. Por defecto, en catalán. */
  paginacion?: (n: number, total: number) => string;
}

const MARGENES: Margenes = { arriba: 48, abajo: 48, izquierda: 56, derecha: 56 };
const ALTO_CABECERA = 46;
const ALTO_PIE = 30;
const ALTO_LOGO = 24;

/** Caracteres invisibles que ensucian el ancho medido y no aportan nada. */
const INVISIBLES = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g;

/**
 * Quita lo que no se puede dibujar. Los caracteres de control rompen el flujo de
 * texto (y el tabulador sale como .notdef); el salto de línea sí se respeta, porque
 * el cortador lo trata como separador de párrafo.
 */
export function sanear(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(INVISIBLES, "");
}

export class Maquetador {
  readonly doc: PDFDocument;
  readonly fuentes: Fuentes;
  readonly margenes: Margenes;

  private readonly logo: PDFImage | null;
  private readonly cabeceraTexto: string;
  private readonly subcabecera: string;
  private readonly pieTexto: string;
  private readonly marca: OpcionesMarcaAgua | null;
  private readonly paginacion: (n: number, total: number) => string;

  private paginas: PDFPage[] = [];
  private pagina: PDFPage | null = null;
  private cursor = 0;
  private cerrado = false;
  /** Anchos ya medidos: las mismas palabras se repiten mucho en una tabla. */
  private anchos = new Map<string, number>();

  constructor(doc: PDFDocument, op: OpcionesMaquetador) {
    this.doc = doc;
    this.fuentes = op.fuentes;
    this.margenes = { ...MARGENES, ...(op.margenes ?? {}) };
    this.logo = op.logo ?? null;
    this.cabeceraTexto = sanear(op.cabecera ?? "");
    this.subcabecera = sanear(op.subcabecera ?? "");
    this.pieTexto = sanear(op.pie ?? "");
    this.marca = typeof op.marcaAgua === "string"
      ? { texto: op.marcaAgua }
      : (op.marcaAgua ?? null);
    this.paginacion = op.paginacion ?? ((n, total) => `pàg. ${n} de ${total}`);
    this.nuevaPagina();
  }

  // ---------------------------------------------------------------- geometría

  get x(): number {
    return this.margenes.izquierda;
  }

  get anchoUtil(): number {
    return A4.ancho - this.margenes.izquierda - this.margenes.derecha;
  }

  /** Y por debajo de la cual ya no cabe contenido (empieza el pie). */
  get limiteInferior(): number {
    return this.margenes.abajo + ALTO_PIE;
  }

  get y(): number {
    return this.cursor;
  }

  get numPaginas(): number {
    return this.paginas.length;
  }

  /** Página actual, por si un renderizador necesita dibujar algo a mano. */
  get paginaActual(): PDFPage {
    if (!this.pagina) throw new Error("maquetador: sin página activa");
    return this.pagina;
  }

  // ------------------------------------------------------------------ páginas

  saltoPagina(): void {
    this.nuevaPagina();
  }

  /** Reserva `alto` puntos: si no caben, abre página nueva. Devuelve si saltó. */
  asegurar(alto: number): boolean {
    if (this.cursor - alto >= this.limiteInferior) return false;
    this.nuevaPagina();
    return true;
  }

  espacio(alto: number): void {
    this.cursor -= alto;
    if (this.cursor < this.limiteInferior) this.nuevaPagina();
  }

  private nuevaPagina(): void {
    const p = this.doc.addPage([A4.ancho, A4.alto]);
    this.paginas.push(p);
    this.pagina = p;
    this.cursor = A4.alto - this.margenes.arriba;
    this.dibujarCabecera(p);
  }

  private dibujarCabecera(p: PDFPage): void {
    const top = A4.alto - this.margenes.arriba;
    if (this.logo) {
      const escala = ALTO_LOGO / this.logo.height;
      p.drawImage(this.logo, {
        x: this.margenes.izquierda,
        y: top - ALTO_LOGO,
        width: this.logo.width * escala,
        height: ALTO_LOGO,
      });
    }
    if (this.cabeceraTexto) {
      const tam = 10.5;
      const ancho = this.medir(this.cabeceraTexto, this.fuentes.tituloFuerte, tam);
      p.drawText(this.cabeceraTexto, {
        x: A4.ancho - this.margenes.derecha - ancho,
        y: top - ALTO_LOGO + 12,
        size: tam,
        font: this.fuentes.tituloFuerte,
        color: COLORES.verde,
      });
    }
    if (this.subcabecera) {
      const tam = 8;
      const ancho = this.medir(this.subcabecera, this.fuentes.cuerpo, tam);
      p.drawText(this.subcabecera, {
        x: A4.ancho - this.margenes.derecha - ancho,
        y: top - ALTO_LOGO + 1,
        size: tam,
        font: this.fuentes.cuerpo,
        color: COLORES.verdeGris,
      });
    }
    const yLinea = top - ALTO_CABECERA + 8;
    p.drawLine({
      start: { x: this.margenes.izquierda, y: yLinea },
      end: { x: A4.ancho - this.margenes.derecha, y: yLinea },
      thickness: 0.75,
      color: COLORES.crema300,
    });
    this.cursor = yLinea - 18;
  }

  // -------------------------------------------------------------------- texto

  /** Ancho de un fragmento sin espacios, memorizado. */
  private medirAtomo(texto: string, fuente: PDFFont, tamano: number): number {
    const clave = `${fuente.name}|${tamano}|${texto}`;
    const guardado = this.anchos.get(clave);
    if (guardado !== undefined) return guardado;
    const ancho = fuente.widthOfTextAtSize(texto, tamano);
    this.anchos.set(clave, ancho);
    return ancho;
  }

  /**
   * Ancho de un texto. Se mide **palabra a palabra** y se suma, en vez de medir la
   * línea entera: el cortador prueba prefijos que crecen, y medir cada prefijo
   * multiplica por cien las llamadas a la fuente (que es la parte cara). Las palabras
   * se repiten muchísimo en una tabla, así que la caché acierta casi siempre.
   * El único coste es que no se cuenta el kerning ENTRE palabras, que a través de un
   * espacio es cero en Inter y en Sora.
   */
  medir(texto: string, fuente: PDFFont, tamano: number): number {
    if (!texto) return 0;
    if (!texto.includes(" ")) return this.medirAtomo(texto, fuente, tamano);
    const trozos = texto.split(" ");
    const espacio = this.medirAtomo(" ", fuente, tamano);
    let total = espacio * (trozos.length - 1);
    for (const trozo of trozos) {
      if (trozo) total += this.medirAtomo(trozo, fuente, tamano);
    }
    return total;
  }

  /**
   * Corta un texto en líneas que caben en `ancho`. Respeta los saltos de línea
   * explícitos y, si una sola palabra no cabe (una URL, un NIF pegado), la parte por
   * caracteres: más vale un corte feo que un desbordamiento fuera del margen.
   */
  cortar(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
    const limpio = sanear(texto);
    if (!limpio) return [""];
    const salida: string[] = [];
    for (const parrafo of limpio.split("\n")) {
      if (parrafo === "") {
        salida.push("");
        continue;
      }
      let linea = "";
      for (const palabra of parrafo.split(/\s+/).filter((p) => p !== "")) {
        const tentativa = linea ? `${linea} ${palabra}` : palabra;
        if (this.medir(tentativa, fuente, tamano) <= ancho) {
          linea = tentativa;
          continue;
        }
        if (linea) salida.push(linea);
        if (this.medir(palabra, fuente, tamano) <= ancho) {
          linea = palabra;
          continue;
        }
        // Palabra más ancha que la caja: corte duro por caracteres.
        let trozo = "";
        for (const car of palabra) {
          if (trozo && this.medir(trozo + car, fuente, tamano) > ancho) {
            salida.push(trozo);
            trozo = car;
          } else {
            trozo += car;
          }
        }
        linea = trozo;
      }
      salida.push(linea);
    }
    return salida;
  }

  /**
   * Párrafo con corte de línea y salto de página automático. Devuelve el alto
   * consumido (sin contar el espacio de antes/después).
   */
  parrafo(texto: string, estilo: EstiloTexto = {}): number {
    const fuente = estilo.fuente ?? this.fuentes.cuerpo;
    const tamano = estilo.tamano ?? 10;
    const color = estilo.color ?? COLORES.negro;
    const alto = tamano * (estilo.interlineado ?? 1.35);
    const sangria = estilo.sangria ?? 0;
    const ancho = this.anchoUtil - sangria;
    const alinear = estilo.alinear ?? "izquierda";

    if (estilo.antes) this.espacio(estilo.antes);

    const lineas = this.cortar(texto, fuente, tamano, ancho);
    let consumido = 0;
    for (const linea of lineas) {
      this.asegurar(alto);
      if (linea) {
        const anchoLinea = this.medir(linea, fuente, tamano);
        const x = alinear === "derecha"
          ? this.x + sangria + ancho - anchoLinea
          : alinear === "centro"
          ? this.x + sangria + (ancho - anchoLinea) / 2
          : this.x + sangria;
        this.paginaActual.drawText(linea, {
          x,
          y: this.cursor - tamano,
          size: tamano,
          font: fuente,
          color,
        });
      }
      this.cursor -= alto;
      consumido += alto;
    }
    if (estilo.despues) this.espacio(estilo.despues);
    return consumido;
  }

  /** Título de sección. Nivel 1 = título del documento; 2 y 3, apartados. */
  titulo(texto: string, nivel: 1 | 2 | 3 = 2, estilo: EstiloTexto = {}): void {
    const preset = nivel === 1
      ? { fuente: this.fuentes.tituloFuerte, tamano: 18, antes: 4, despues: 10 }
      : nivel === 2
      ? { fuente: this.fuentes.titulo, tamano: 13, antes: 14, despues: 6 }
      : { fuente: this.fuentes.titulo, tamano: 11, antes: 10, despues: 4 };
    // Un título no se queda solo al final de la página: si no caben él y un par de
    // líneas de texto, salta antes.
    this.asegurar(preset.tamano * 1.35 + 28);
    this.parrafo(texto, {
      color: nivel === 1 ? COLORES.verdeOscuro : COLORES.verde,
      ...preset,
      ...estilo,
    });
  }

  /** Lista con viñeta coral. */
  lista(items: string[], estilo: EstiloTexto = {}): void {
    const fuente = estilo.fuente ?? this.fuentes.cuerpo;
    const tamano = estilo.tamano ?? 10;
    const alto = tamano * (estilo.interlineado ?? 1.35);
    const sangria = (estilo.sangria ?? 0) + 14;
    for (const item of items) {
      const lineas = this.cortar(item, fuente, tamano, this.anchoUtil - sangria);
      let primera = true;
      for (const linea of lineas) {
        this.asegurar(alto);
        if (primera) {
          this.paginaActual.drawText("•", {
            x: this.x + sangria - 12,
            y: this.cursor - tamano,
            size: tamano,
            font: fuente,
            color: COLORES.coral,
          });
          primera = false;
        }
        if (linea) {
          this.paginaActual.drawText(linea, {
            x: this.x + sangria,
            y: this.cursor - tamano,
            size: tamano,
            font: fuente,
            color: estilo.color ?? COLORES.negro,
          });
        }
        this.cursor -= alto;
      }
    }
    if (estilo.despues) this.espacio(estilo.despues);
  }

  /**
   * Pares etiqueta/valor en dos columnas (la cabecera de datos de un albarán o de un
   * certificado). La etiqueta va en Inter 600 y ocupa `anchoEtiqueta`.
   */
  campos(
    pares: [string, string][],
    op: { anchoEtiqueta?: number; tamano?: number; despues?: number } = {},
  ): void {
    const tamano = op.tamano ?? 10;
    const anchoEtiqueta = op.anchoEtiqueta ?? 130;
    const alto = tamano * 1.4;
    for (const [etiqueta, valor] of pares) {
      const lineas = this.cortar(
        valor,
        this.fuentes.cuerpo,
        tamano,
        this.anchoUtil - anchoEtiqueta,
      );
      this.asegurar(alto * lineas.length);
      const yInicio = this.cursor;
      this.paginaActual.drawText(sanear(etiqueta), {
        x: this.x,
        y: yInicio - tamano,
        size: tamano,
        font: this.fuentes.cuerpoFuerte,
        color: COLORES.verdeGris,
      });
      let y = yInicio;
      for (const linea of lineas) {
        if (linea) {
          this.paginaActual.drawText(linea, {
            x: this.x + anchoEtiqueta,
            y: y - tamano,
            size: tamano,
            font: this.fuentes.cuerpo,
            color: COLORES.negro,
          });
        }
        y -= alto;
      }
      this.cursor = y;
    }
    if (op.despues) this.espacio(op.despues);
  }

  // -------------------------------------------------------------------- tabla

  /**
   * Tabla con anchos proporcionales, celdas multilínea y **cabecera repetida** al
   * saltar de página. Devuelve cuántas páginas ocupó.
   *
   * ⚠️ Una fila **no se parte**: si una sola celda es más alta que una página entera
   * (unas 50 líneas), se sale por el pie en vez de continuar en la siguiente. No pasa
   * con los datos reales —los conceptos de un albarán son cortos— y partir una fila
   * exige decidir qué se repite arriba, que es una decisión de diseño, no un arreglo.
   */
  tabla(op: OpcionesTabla): number {
    const tamano = op.tamano ?? 9;
    const padding = op.padding ?? 5;
    const repetir = op.cabeceraRepetida ?? true;
    const altoLinea = tamano * 1.3;
    const pesoTotal = op.columnas.reduce((s, c) => s + c.ancho, 0) || 1;
    const anchos = op.columnas.map((c) => (c.ancho / pesoTotal) * this.anchoUtil);
    const xs: number[] = [];
    let acumulado = this.x;
    for (const a of anchos) {
      xs.push(acumulado);
      acumulado += a;
    }

    if (op.antes) this.espacio(op.antes);

    const altoCabecera = altoLinea + padding * 2;
    const paginaInicial = this.paginas.length;

    const pintarCabecera = () => {
      // La cabecera no se queda sola al pie: se reserva también una fila.
      this.asegurar(altoCabecera + altoLinea + padding * 2);
      const y = this.cursor;
      this.paginaActual.drawRectangle({
        x: this.x,
        y: y - altoCabecera,
        width: this.anchoUtil,
        height: altoCabecera,
        color: COLORES.verdeSuave,
      });
      op.columnas.forEach((c, i) => {
        const texto = sanear(c.titulo);
        if (!texto) return;
        const anchoTexto = this.medir(texto, this.fuentes.cuerpoFuerte, tamano);
        this.paginaActual.drawText(texto, {
          x: this.alinearEnCelda(xs[i], anchos[i], anchoTexto, padding, c.alinear ?? "izquierda"),
          y: y - padding - tamano,
          size: tamano,
          font: this.fuentes.cuerpoFuerte,
          color: COLORES.verdeOscuro,
        });
      });
      this.cursor = y - altoCabecera;
    };

    pintarCabecera();

    let indice = 0;
    for (const fila of op.filas) {
      const celdas = op.columnas.map((c, i) =>
        this.cortar(sanear(fila[i]), this.fuentes.cuerpo, tamano, anchos[i] - padding * 2)
      );
      const lineas = Math.max(1, ...celdas.map((c) => c.length));
      const altoFila = lineas * altoLinea + padding * 2;

      // Si la fila no cabe, página nueva Y cabecera otra vez: una tabla partida sin
      // cabecera obliga a volver a la página anterior para saber qué es cada columna.
      if (this.cursor - altoFila < this.limiteInferior) {
        this.nuevaPagina();
        if (repetir) pintarCabecera();
      }

      const y = this.cursor;
      if (op.cebra && indice % 2 === 1) {
        this.paginaActual.drawRectangle({
          x: this.x,
          y: y - altoFila,
          width: this.anchoUtil,
          height: altoFila,
          color: COLORES.crema,
        });
      }
      celdas.forEach((lineasCelda, i) => {
        let yTexto = y - padding;
        for (const linea of lineasCelda) {
          if (linea) {
            const anchoTexto = this.medir(linea, this.fuentes.cuerpo, tamano);
            this.paginaActual.drawText(linea, {
              x: this.alinearEnCelda(
                xs[i],
                anchos[i],
                anchoTexto,
                padding,
                op.columnas[i].alinear ?? "izquierda",
              ),
              y: yTexto - tamano,
              size: tamano,
              font: this.fuentes.cuerpo,
              color: COLORES.negro,
            });
          }
          yTexto -= altoLinea;
        }
      });
      this.paginaActual.drawLine({
        start: { x: this.x, y: y - altoFila },
        end: { x: this.x + this.anchoUtil, y: y - altoFila },
        thickness: 0.5,
        color: COLORES.crema100,
      });
      this.cursor = y - altoFila;
      indice++;
    }

    if (op.despues) this.espacio(op.despues);
    return this.paginas.length - paginaInicial + 1;
  }

  private alinearEnCelda(
    x: number,
    ancho: number,
    anchoTexto: number,
    padding: number,
    alinear: Alineacion,
  ): number {
    if (alinear === "derecha") return x + ancho - padding - anchoTexto;
    if (alinear === "centro") return x + (ancho - anchoTexto) / 2;
    return x + padding;
  }

  // ----------------------------------------------------------------- imágenes

  /** Estampa una imagen ya embebida en el flujo, con salto de página si no cabe. */
  imagen(img: PDFImage, op: OpcionesImagen = {}): void {
    let ancho = op.ancho ?? img.width;
    let alto = op.alto ?? img.height;
    if (op.ancho && !op.alto) alto = (img.height / img.width) * op.ancho;
    if (op.alto && !op.ancho) ancho = (img.width / img.height) * op.alto;
    if (op.antes) this.espacio(op.antes);
    this.asegurar(alto);
    const x = op.alinear === "derecha"
      ? this.x + this.anchoUtil - ancho
      : op.alinear === "centro"
      ? this.x + (this.anchoUtil - ancho) / 2
      : this.x;
    this.paginaActual.drawImage(img, {
      x,
      y: this.cursor - alto,
      width: ancho,
      height: alto,
    });
    this.cursor -= alto;
    if (op.despues) this.espacio(op.despues);
  }

  /** Filete horizontal de separación. */
  filete(color: RGB = COLORES.crema300, grosor = 0.75): void {
    this.asegurar(grosor + 2);
    this.paginaActual.drawLine({
      start: { x: this.x, y: this.cursor },
      end: { x: this.x + this.anchoUtil, y: this.cursor },
      thickness: grosor,
      color,
    });
    this.cursor -= grosor + 2;
  }

  /** Caja destacada (aviso, nota legal) con fondo y filete coral a la izquierda. */
  caja(texto: string, op: { titulo?: string; fondo?: RGB; barra?: RGB } = {}): void {
    const tamano = 9.5;
    const padding = 10;
    const sangria = 12;
    const anchoTexto = this.anchoUtil - padding - sangria;
    const lineasTitulo = op.titulo
      ? this.cortar(op.titulo, this.fuentes.cuerpoFuerte, tamano, anchoTexto)
      : [];
    const lineas = this.cortar(texto, this.fuentes.cuerpo, tamano, anchoTexto);
    const altoLinea = tamano * 1.35;
    const alto = (lineas.length + lineasTitulo.length) * altoLinea + padding * 2;
    this.asegurar(alto);
    const y = this.cursor;
    this.paginaActual.drawRectangle({
      x: this.x,
      y: y - alto,
      width: this.anchoUtil,
      height: alto,
      color: op.fondo ?? COLORES.crema,
    });
    this.paginaActual.drawRectangle({
      x: this.x,
      y: y - alto,
      width: 3,
      height: alto,
      color: op.barra ?? COLORES.coral,
    });
    let yTexto = y - padding;
    for (const linea of lineasTitulo) {
      if (linea) {
        this.paginaActual.drawText(linea, {
          x: this.x + sangria,
          y: yTexto - tamano,
          size: tamano,
          font: this.fuentes.cuerpoFuerte,
          color: COLORES.verdeOscuro,
        });
      }
      yTexto -= altoLinea;
    }
    for (const linea of lineas) {
      if (linea) {
        this.paginaActual.drawText(linea, {
          x: this.x + sangria,
          y: yTexto - tamano,
          size: tamano,
          font: this.fuentes.cuerpo,
          color: COLORES.negro,
        });
      }
      yTexto -= altoLinea;
    }
    this.cursor = y - alto;
  }

  // ------------------------------------------------------------------- cierre

  /**
   * Pinta pie y marca de agua en TODAS las páginas y deja el documento listo.
   * El pie no se puede pintar antes: «pàg. n de N» necesita la N, que solo se
   * conoce cuando ya no queda contenido.
   */
  finalizar(): void {
    if (this.cerrado) return;
    this.cerrado = true;
    const total = this.paginas.length;
    this.paginas.forEach((p, i) => {
      if (this.marca) this.dibujarMarcaAgua(p, this.marca);
      const y = this.margenes.abajo + 10;
      p.drawLine({
        start: { x: this.margenes.izquierda, y: y + 12 },
        end: { x: A4.ancho - this.margenes.derecha, y: y + 12 },
        thickness: 0.5,
        color: COLORES.crema300,
      });
      if (this.pieTexto) {
        // El pie es una sola línea: lo que no cabe en el ancho útil menos el hueco
        // de la paginación, no se pinta.
        const [primera] = this.cortar(this.pieTexto, this.fuentes.cuerpo, 7.5, this.anchoUtil - 90);
        if (primera) {
          p.drawText(primera, {
            x: this.margenes.izquierda,
            y,
            size: 7.5,
            font: this.fuentes.cuerpo,
            color: COLORES.verdeGris,
          });
        }
      }
      const etiqueta = this.paginacion(i + 1, total);
      const ancho = this.medir(etiqueta, this.fuentes.cuerpo, 7.5);
      p.drawText(etiqueta, {
        x: A4.ancho - this.margenes.derecha - ancho,
        y,
        size: 7.5,
        font: this.fuentes.cuerpo,
        color: COLORES.verdeGris,
      });
    });
  }

  private dibujarMarcaAgua(p: PDFPage, marca: OpcionesMarcaAgua): void {
    const texto = sanear(marca.texto).toUpperCase();
    if (!texto) return;
    const giro = marca.giro ?? 45;
    const rad = (giro * Math.PI) / 180;
    // Sin tamaño explícito, se ajusta para que el texto girado ocupe ~el 90 % del ancho.
    let tamano = marca.tamano ?? 0;
    if (!tamano) {
      const anchoUnidad = this.medir(texto, this.fuentes.tituloFuerte, 100) / 100;
      tamano = Math.min(110, (A4.ancho * 0.9) / (anchoUnidad * Math.cos(rad)));
    }
    const ancho = this.medir(texto, this.fuentes.tituloFuerte, tamano);
    p.drawText(texto, {
      x: A4.ancho / 2 - (ancho / 2) * Math.cos(rad) + (tamano / 3) * Math.sin(rad),
      y: A4.alto / 2 - (ancho / 2) * Math.sin(rad) - (tamano / 3) * Math.cos(rad),
      size: tamano,
      font: this.fuentes.tituloFuerte,
      color: marca.color ?? COLORES.coral,
      opacity: marca.opacidad ?? 0.14,
      rotate: degrees(giro),
    });
  }
}
