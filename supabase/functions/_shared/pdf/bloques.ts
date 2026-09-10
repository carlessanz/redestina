// Los bloques de una plantilla y sus marcadores, SIN pdf-lib.
//
// Por qué existe este fichero aparte de `plantilla.ts`: desde la fase 2 hay **dos**
// consumidores del cuerpo de una plantilla y solo uno pinta un PDF.
//
//   · `generar-documento` lo pinta (`plantilla.ts`, que importa el maquetador y con él
//     `npm:pdf-lib`).
//   · `enlace-publico` lo **muestra y lo hashea**: la página de firma tiene que enseñar
//     el texto completo del convenio y `evidencias.sha256_texto` es la huella de ese
//     texto exacto. Esa función es pública, la abre alguien desde el móvil y su arranque
//     en frío importa: arrastrar `pdf-lib` a su bundle solo para interpolar cuatro
//     marcadores sería pagar 1,8 MB por una expresión regular.
//
// Así que la parte pura —qué es un bloque, cómo se interpola y cómo se aplana a texto—
// vive aquí y **no importa nada**. `plantilla.ts` la reexporta entera, de modo que los
// renderizadores que ya existían siguen importando de donde importaban.

export type TipoBloque = "h1" | "h2" | "h3" | "p" | "lista" | "salt";

export interface Bloque {
  tipo: TipoBloque;
  /** Texto del bloque; en `lista`, una entrada por elemento. En `salt`, nada. */
  text?: string | string[];
}

/** Valores para los marcadores. Se admiten anidados: `{{donant.nom}}`. */
export type Valores = Record<string, unknown>;

const MARCADOR = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function buscar(valores: Valores, ruta: string): unknown {
  return ruta.split(".").reduce<unknown>((actual, parte) => {
    if (actual && typeof actual === "object" && parte in (actual as Valores)) {
      return (actual as Valores)[parte];
    }
    return undefined;
  }, valores);
}

export interface ResultadoInterpolacion {
  texto: string;
  /** Marcadores que no se han podido resolver, en orden de aparición. */
  faltan: string[];
}

/**
 * Sustituye los `{{marcadores}}`. Un marcador sin valor **se deja tal cual** y se
 * devuelve en `faltan`: es preferible que se vea el hueco en el borrador (y que el
 * llamante pueda negarse a emitir) a imprimir un documento legal con un silencio.
 */
export function interpolar(texto: string, valores: Valores): ResultadoInterpolacion {
  const faltan: string[] = [];
  const salida = texto.replace(MARCADOR, (entero, ruta: string) => {
    const valor = buscar(valores, ruta);
    if (valor === undefined || valor === null || valor === "") {
      faltan.push(ruta);
      return entero;
    }
    return String(valor);
  });
  return { texto: salida, faltan };
}

export interface CuerpoInterpolado {
  bloques: Bloque[];
  faltan: string[];
}

/** Interpola todos los bloques de un cuerpo y acumula los marcadores sin resolver. */
export function interpolarCuerpo(bloques: Bloque[], valores: Valores): CuerpoInterpolado {
  const faltan: string[] = [];
  const salida = bloques.map((b): Bloque => {
    if (b.text === undefined) return { tipo: b.tipo };
    if (Array.isArray(b.text)) {
      const items = b.text.map((t) => {
        const r = interpolar(t, valores);
        faltan.push(...r.faltan);
        return r.texto;
      });
      return { tipo: b.tipo, text: items };
    }
    const r = interpolar(b.text, valores);
    faltan.push(...r.faltan);
    return { tipo: b.tipo, text: r.texto };
  });
  return { bloques: salida, faltan: [...new Set(faltan)] };
}

/** ¿Es esto un cuerpo de bloques válido? Valida lo que llega de un jsonb. */
export function esCuerpo(valor: unknown): valor is Bloque[] {
  return Array.isArray(valor) && valor.every((b) =>
    b && typeof b === "object" &&
    ["h1", "h2", "h3", "p", "lista", "salt"].includes((b as Bloque).tipo)
  );
}

/**
 * Aplana un cuerpo YA INTERPOLADO a texto plano, que es lo que se enseña en la página de
 * firma y lo que se hashea en `evidencias.sha256_texto`.
 *
 * ⚠️ La forma exacta de esta salida es parte del contrato de la evidencia: cambiarla
 *    (añadir una línea en blanco, cambiar la viñeta) hace que la huella de una firma
 *    futura no se pueda comparar con la de una anterior sobre el mismo texto. No es un
 *    detalle de presentación; es lo que se compara dentro de dos años.
 *
 * Reglas, deliberadamente pobres para que sean estables: los títulos van en su propia
 * línea, los párrafos también, las listas con «· » delante de cada elemento, y los
 * bloques se separan con una línea en blanco. El salto de página no imprime nada: es
 * maquetación del PDF y en la pantalla no existe.
 */
export function cuerpoATexto(bloques: Bloque[]): string {
  const partes: string[] = [];
  for (const b of bloques) {
    if (b.tipo === "salt") continue;
    if (b.tipo === "lista") {
      const items = Array.isArray(b.text) ? b.text : [b.text ?? ""];
      partes.push(items.map((t) => `· ${t}`).join("\n"));
      continue;
    }
    const texto = Array.isArray(b.text) ? b.text.join("\n") : (b.text ?? "");
    if (texto !== "") partes.push(texto);
  }
  return partes.join("\n\n");
}
