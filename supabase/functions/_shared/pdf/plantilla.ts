// Plantillas de documento: un `cuerpo` jsonb de bloques + marcadores {{clave}}.
//
// Por qué en la base y no en el código: el texto de un convenio o de un certificado
// lo redacta la Fundación, cambia sin que cambie el software y hay que poder saber
// con qué texto EXACTO se emitió un documento de hace dos años. Un literal en
// TypeScript no cumple ninguna de las tres cosas.
//
// El bloque es deliberadamente pobre —seis tipos— porque un editor rico en la base
// obligaría a un intérprete rico aquí, y lo que se imprime tiene que ser predecible.
//
// ⚠️ DESDE LA FASE 2 ESTE FICHERO SOLO PINTA. La parte pura (qué es un bloque, cómo se
//    interpola y cómo se aplana a texto) se mudó a `bloques.ts`, que **no importa nada**,
//    porque `enlace-publico` la necesita para enseñar y hashear el convenio y no puede
//    arrastrar `npm:pdf-lib` a su bundle. Aquí se reexporta entera: los renderizadores
//    que ya existían siguen importando de donde importaban.

import { Maquetador } from "./maquetador.ts";
import type { Bloque } from "./bloques.ts";

export type {
  Bloque,
  CuerpoInterpolado,
  ResultadoInterpolacion,
  TipoBloque,
  Valores,
} from "./bloques.ts";
export { cuerpoATexto, esCuerpo, interpolar, interpolarCuerpo } from "./bloques.ts";

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
