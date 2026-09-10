// Plantillas de documento: un `cuerpo` jsonb de bloques + marcadores {{clave}}.
//
// Por qué en la base y no en el código: el texto de un convenio o de un certificado
// lo redacta la Fundación, cambia sin que cambie el software y hay que poder saber
// con qué texto EXACTO se emitió un documento de hace dos años. Un literal en
// TypeScript no cumple ninguna de las tres cosas.
//
// El bloque es deliberadamente pobre —seis tipos— porque un editor rico en la base
// obligaría a un intérprete rico aquí, y lo que se imprime tiene que ser predecible.

import { Maquetador } from "./maquetador.ts";

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

/** Pinta un cuerpo ya interpolado con las primitivas del maquetador. */
export function pintarCuerpo(m: Maquetador, bloques: Bloque[]): void {
  for (const b of bloques) {
    const texto = Array.isArray(b.text) ? b.text.join("\n") : (b.text ?? "");
    switch (b.tipo) {
      case "h1":
        m.titulo(texto, 1);
        break;
      case "h2":
        m.titulo(texto, 2);
        break;
      case "h3":
        m.titulo(texto, 3);
        break;
      case "lista":
        m.lista(Array.isArray(b.text) ? b.text : [texto], { despues: 6 });
        break;
      case "salt":
        m.saltoPagina();
        break;
      case "p":
      default:
        m.parrafo(texto, { despues: 6 });
        break;
    }
  }
}
