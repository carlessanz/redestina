// Qué convenios le faltan a una organización para una modalidad (fase 5 de la revisión del
// 08-10-2026). PURO, con prueba: es el espejo en el cliente de `convenio_vigente()`.
//
// Desde el «Conveni de col·laboració» único, `convenios_exigidos` pide `col_productor` o
// `col_receptor`; pero los convenios ANTERIORES siguen valiendo para lo que valían
// (`convenis_equivalents`: un `don_gen` cubre la donación del productor, un `com` la venta y
// la maquila). Sin esta función, el panel bloquearía a quien sí puede operar.
//
// ⚠️ Es solo para AVISAR antes de pulsar: quien decide es la base (`exigir_convenio()`).

export interface Equivalencia {
  tipo_nou: string
  tipo_antic: string
  valorizacion: string
}

export function convenisQueFalten(
  modalitat: string,
  exigits: readonly string[],
  vigents: readonly string[],
  equivalents: readonly Equivalencia[],
): string[] {
  return exigits.filter((req) =>
    !vigents.includes(req)
    && !equivalents.some((e) => e.tipo_nou === req && e.valorizacion === modalitat && vigents.includes(e.tipo_antic)))
}
