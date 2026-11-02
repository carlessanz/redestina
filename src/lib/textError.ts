// El texto que se enseña cuando falla una llamada a la base o a una Edge Function.
//
// Los envoltorios de `src/lib` (albarans.ts, tancament.ts, convenis.ts, canalitzacio.ts,
// diagnosticApi.ts…) devuelven `missatge` de TRES formas distintas y la pantalla no puede
// saber cuál: el texto que levanta la RPC (ya legible, en catalán), una CLAVE i18n de
// respaldo (`c.error`, `diag.err_generic`…) o, cuando Postgres corta antes de la RPC, su
// mensaje en inglés («permission denied for table …»). Enseñar `res.missatge` a pelo
// pintaba la clave cruda en dos de los tres casos (revisión del 28-09-2026). Esto decide
// en un solo sitio.

import { DICTS } from './i18n'

type Traductor = (clau: string, params?: Record<string, string | number>) => string

/** Códigos propios que llegan en `codi` o dentro del mensaje, con su texto. */
//
// ⚠️ El ORDEN importa: se busca por `includes()` en este orden, así que un código que
// contiene a otro va ANTES (`cal_motiu_incidencia` antes que `cal_motiu`).
const CODIS: Record<string, string> = {
  // `emitir_albaran()` sobre un albarán de una recogida sin validar (17-10-2026). Contiene a
  // `recollida`, no a ningún otro código de la lista, pero va arriba igual por si acaso.
  recollida_no_validada: 'alb.err_recollida_no_validada',
  // `validar_recollida()`: antes que `cal_motiu`, que lo contiene.
  cal_motiu_validacio: 'vrec.err_cal_motiu',
  // `conciliar_albaran()` con una incidencia de recogida y sin motivo (17-10-2026).
  cal_motiu_incidencia: 'alb.err_cal_motiu_incidencia',
  sense_conveni: 'od.conv_blocked',
  // `desar_diagnostic()`, fase 9 de la revisión del 08-10-2026.
  massa_productes: 'diag.err_massa_productes',
  // El expediente de prevención, fase 11.
  ja_te_expedient: 'exp.err_ja_te',
  expedient_tancat: 'exp.err_tancat',
  ubicacio_aliena: 'diag.err_ubicacio_aliena',
  // `cancelar_meva_oferta()` desde la fase 1 de la revisión del 08-10-2026.
  te_canalitzacions: 'po.err_te_canalitzacions',
  cal_motiu: 'po.err_cal_motiu',
  // `confirmar_recollida()`, fase 3 de la revisión del 08-10-2026.
  canalitzacio_inexistent: 'recol.err_inexistent',
  canalitzacio_anulada: 'recol.err_anulada',
  sense_albara: 'recol.err_sense_albara',
  ja_confirmada: 'recol.err_ja_confirmada',
  kg_invalids: 'recol.err_kg',
  data_futura: 'recol.err_data_futura',
  // Revisión del certificado (fase 4).
  no_pendent_revisio: 'rev.no_pendent_revisio',
  certificat_bloquejat: 'rev.certificat_bloquejat',
  sense_revisio: 'tan.err_sense_revisio',
  cal_nota: 'tan.err_cal_nota',
  // La ficha de la organización (fase 7).
  nif_invalid: 'val.nif_control',
  nif_en_us: 'org.err_nif_en_us',
  ja_te_paper: 'org.err_ja_te_paper',
  // Estado de las fichas (plan 1, rebanada 1A): activar exige NIF y razón social, y una
  // entidad inactiva no puede mostrar interés (`comprova_interes()`).
  falta_nif: 'org.err_falta_nif',
  falta_rao_social: 'org.err_falta_rao_social',
  entitat_inactiva: 'org.err_entitat_inactiva',
  tipus_activitat_desconegut: 'org.err_activitat',
  // El alta de una entidad (plan 1, 1B, `crear_entitat()`). `cal_nom_comercial` va ANTES
  // que `cal_nom`, que lo contiene.
  cal_nom_comercial: 'ef.nom_obligatori',
  cal_tipus_receptor: 'ne.err_cal_tipus_receptor',
  cal_paper: 'ef.err_paper',
  dades_en_us: 'rec.err_unique',
  cal_nom: 'org.err_cal_nom',
  // Las notas internas (plan 1, 1F, `afegir_nota_interna()` / `esborrar_nota_interna()`).
  canal_nota_desconegut: 'ni.err_canal',
  nota_buida: 'ni.err_buida',
  nota_massa_llarga: 'ni.err_massa_llarga',
  nota_futura: 'ni.err_futura',
  nota_inexistent: 'ni.err_inexistent',
}

/** Códigos que algunas Edge Functions y envoltorios devuelven COMO mensaje. */
const EXACTES: Record<string, string> = {
  unauthorized: 'msg.w_unauth',
  forbidden: 'msg.w_unauth',
  error: 'c.error',
}

/** Mensajes de Postgres/PostgREST que no dicen nada útil a quien usa la pantalla. */
const CRUS = /permission denied|row-level security|violates|JWT|Failed to fetch|NetworkError|no_autoritzat/i

/** ¿Es una clave del diccionario? (en `ca`, que es el que tiene todas). */
export function esClau(s: string): boolean {
  return Object.prototype.hasOwnProperty.call(DICTS.ca, s)
}

/**
 * El texto de un error, listo para un toast.
 *
 * Orden: un código conocido (por `codi` o dentro del mensaje) → su clave; un mensaje que ES
 * una clave → traducido; un mensaje crudo de Postgres o vacío → `fallback`; el resto (el
 * texto que la RPC levanta a propósito) → tal cual.
 */
export function textError(
  t: Traductor,
  r: { missatge?: string | null; codi?: string | null } | string | null | undefined,
  fallback = 'c.error',
): string {
  const missatge = (typeof r === 'string' ? r : r?.missatge) ?? ''
  const codi = typeof r === 'string' ? null : r?.codi ?? null
  if (codi && CODIS[codi]) return t(CODIS[codi])
  for (const [c, clau] of Object.entries(CODIS)) if (missatge.includes(c)) return t(clau)
  if (missatge === '') return t(fallback)
  if (EXACTES[missatge]) return t(EXACTES[missatge])
  if (esClau(missatge)) return t(missatge)
  if (CRUS.test(missatge)) return t(fallback)
  return missatge
}
