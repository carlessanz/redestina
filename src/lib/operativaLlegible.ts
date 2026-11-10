// La Operativa del productor en LECTURA (Plan 2, A4, `20270521100000`): de la clave
// `operativa` de `diagnostic_datos()` a filas «etiqueta → texto» para el resumen del
// diagnóstico (`ResumDiagnostic`), el del equipo y el del productor.
//
// Desde A2 la lógica vive en el módulo hoja `supabase/functions/_shared/operativaLlegible.ts`
// (§7: se importa, no se copia), porque el PDF del diagnóstico (`diagnostic-pdf`) tiene que
// imprimir exactamente lo mismo que enseña esta pantalla. Pruebas en
// `tests/operativaLlegible.test.ts`.

export {
  filesOperativa,
  textDiesFranges,
  textMesos,
  type FilaOperativa,
} from '../../supabase/functions/_shared/operativaLlegible.ts'
