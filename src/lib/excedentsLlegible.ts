// Los excedentes del diagnóstico en LECTURA (Plan 2, A3, `20270522100000`): de la clave
// `excedents` de `diagnostic_datos()` a textos y filas para el resumen del diagnóstico
// (`ResumDiagnostic`) y la lista de acciones.
//
// La lógica vive en el módulo hoja `supabase/functions/_shared/excedentsLlegible.ts` (§7: se
// importa, no se copia), porque los PDF del diagnóstico (`diagnostic-pdf`) y del expediente
// (`generar-documento`) tienen que imprimir exactamente lo mismo que enseña esta pantalla.
// Pruebas en `tests/excedentsLlegible.test.ts`.

export {
  blocsExcedents,
  celaAccio,
  celaCausa,
  DESTINS,
  ESTATS_ACCIO,
  filaCausa,
  filesAccions,
  filesCausa,
  FREQUENCIES,
  GESTIONS,
  nomCausa,
  teBlocs,
  textDesti,
  textDestins,
  textEstatAccio,
  textFrequencia,
  textGestio,
  textVolum,
  titolBloc,
  type AccioExcedentLlegible,
  type BlocExcedentsLlegible,
  type CausaExcedentLlegible,
  type DestiExcedent,
  type EstatAccio,
  type FilaAccioExcedent,
  type FilaCausaExcedent,
  type Frequencia,
  type GestioActual,
} from '../../supabase/functions/_shared/excedentsLlegible.ts'
