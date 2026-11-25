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
  // D2 del punto 3 (20270601100000): un certificado con valores provisionales no se emite. La
  // base lo dice de dos formas (el guarda de la emisión o el bloqueo del cálculo): las dos
  // llevan a validar el mes en Productes › Preus.
  preus_provisionals: 'cdon.err_preus_provisionals',
  'Preus de referencia provisionals': 'cdon.err_preus_provisionals',
  preus_canviats: 'cdon.err_preus_canviats',
  preu_canalitzacio_protegit: 'alb.err_preu_protegit',
  // `editar_oferta()` al marcar «Espigolada» (proceso 3.4, 20270617100300).
  espigolada_no_donacio: 'edit.err_espigolada_no_donacio',
  espigolada_sense_camp: 'edit.err_espigolada_sense_camp',
  canalitzacio_certificada: 'alb.err_canalitzacio_certificada',
  // `emitir_albaran()` sobre un albarán de una recogida sin validar (17-10-2026). Contiene a
  // `recollida`, no a ningún otro código de la lista, pero va arriba igual por si acaso.
  recollida_no_validada: 'alb.err_recollida_no_validada',
  // `validar_recollida()`: antes que `cal_motiu`, que lo contiene.
  cal_motiu_validacio: 'vrec.err_cal_motiu',
  // La propuesta de cambios (fase 5 de los puntos 4-6, 20270610100000). Los dos primeros son
  // `codi` que pone `propostaCanvisApi.ts` (en el mensaje llegan como `cal_motiu` y
  // `hora_passada`, que en la tabla común significan otra cosa); van antes que `cal_motiu`.
  cal_motiu_proposta: 'prop.err_cal_motiu',
  hora_proposta_passada: 'prop.err_hora_vencuda',
  no_proposable: 'prop.err_no_proposable',
  sense_proposta: 'prop.err_sense_proposta',
  proposta_pendent: 'prop.err_proposta_pendent',
  proposta_protegida: 'prop.err_protegida',
  cal_resposta: 'prop.err_cal_resposta',
  resposta_inexistent: 'prop.err_inexistent',
  motiu_llarg: 'prop.err_motiu_llarg',
  modalitat_invalida: 'prop.err_modalitat',
  cal_modalitat: 'appr.cal_modalitat',
  // `conciliar_albaran()` con una incidencia de recogida y sin motivo (17-10-2026).
  cal_motiu_incidencia: 'alb.err_cal_motiu_incidencia',
  sense_conveni: 'od.conv_blocked',
  // La naturalesa (A5, 20270523100000): el titular, sobre una ya confirmada; y los guardas.
  naturalesa_confirmada: 'nat.err_confirmada',
  naturalesa_desconeguda: 'nat.err_desconeguda',
  nomes_equip_o_titular: 'nat.err_permis',
  // El circuito de firma (05-11-2026, 20270510100100). `cal_motiu` de `rebutjar_signatura` no
  // va aquí (lo comparte con la cancelación de una oferta): lo traduce `AccionsSignatura`.
  versio_substituida: 'sgn.err_versio_substituida',
  usa_firma_conveni: 'sgn.err_usa_firma_conveni',
  ja_signat: 'sgn.err_ja_signat',
  no_signable: 'sgn.err_no_signable',
  estat_incorrecte: 'sgn.err_estat_incorrecte',
  sense_correu: 'sgn.err_sense_correu',
  // `desar_diagnostic()`, fase 9 de la revisión del 08-10-2026.
  massa_productes: 'diag.err_massa_productes',
  // `desar_excedents_diagnostic()` (A3, 20270522100000): lo que la pantalla no puede evitar.
  volum_negatiu: 'dexc.err_volum',
  producte_fora_principals: 'dexc.err_fora_principals',
  // El expediente de prevención, fase 11.
  ja_te_expedient: 'exp.err_ja_te',
  expedient_tancat: 'exp.err_tancat',
  ubicacio_aliena: 'diag.err_ubicacio_aliena',
  // `cancelar_meva_oferta()` desde la fase 1 de la revisión del 08-10-2026.
  te_canalitzacions: 'po.err_te_canalitzacions',
  cal_motiu: 'po.err_cal_motiu',
  cal_font: 'cost.err_cal_font',
  criteri_invalid: 'cost.err_criteri',
  sense_cost: 'cost.err_sense_cost',
  // Asignar, modificar y anular en un acto (puntos 4-6, fase 2: 20270606100100, 20270607100000).
  // `cal_motiu` de `anular_assignacio` no llega: el diálogo exige el motivo antes de llamar.
  cal_preu_acordat: 'asg.err_cal_preu',
  cal_preu_acceptat: 'asg.err_cal_acceptat',
  preu_invalid: 'asg.err_preu_invalid',
  ja_assignada: 'asg.err_ja_assignada',
  cal_canvi: 'asg.err_cal_canvi',
  ja_registrada: 'asg.err_ja_registrada',
  albara_emes: 'asg.err_albara_emes',
  ja_validada: 'asg.err_ja_validada',
  no_es_venda: 'asg.err_no_es_venda',
  hora_passada: 'rrec.err_hora_passada',
  // `comprova_hora_recollida()` (20270618100200): el receptor pide un día que no está en los
  // `dies_recollida` de la oferta (el equipo no se bloquea).
  dia_fora_dies: 'rrec.err_dia_fora_dies',
  // `entrades_sortides*()` (20270618100000): un tipus d'operació que no existe.
  tipus_operacio_invalid: 'sort.err_tipus_operacio',
  // Fase 3 (20270608100100): el REC propio de una recogida se anula anulando la asignación.
  anula_la_canalitzacio: 'asg.err_anula_la_canalitzacio',
  kg_maxim: 'asg.err_kg_maxim',
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
  // El certificado de donación (05-11-2026, 20270509100100/100200/100400).
  data_expedicio_fora_rang: 'cdon.err_data_fora_rang',
  oferta_sense_certificable: 'cdon.err_oferta_sense_certificable',
  oferta_daltri_productor: 'cdon.err_oferta_daltri',
  oferta_no_coincideix: 'cdon.err_oferta_no_coincideix',
  certificat_transaccio_retirat: 'cdon.err_ct_retirat',
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
  // La previsión de producto de una interacción (proceso 1.2, 20270616100000). ANTES que
  // `ubicacio_massa_llarga`, que está contenido en `previsio_ubicacio_massa_llarga`.
  previsio_ubicacio_massa_llarga: 'ni.err_lloc_llarg',
  previsio_incompleta: 'ni.err_previsio_incompleta',
  // Població real, àrea i ubicació (20270505100000).
  comarca_desconeguda: 'org.err_comarca',
  ubicacio_massa_llarga: 'org.err_ubicacio',
  // El alta de una entidad (plan 1, 1B, `crear_entitat()`). `cal_nom_comercial` va ANTES
  // que `cal_nom`, que lo contiene.
  cal_nom_comercial: 'ef.nom_obligatori',
  cal_tipus_receptor: 'ne.err_cal_tipus_receptor',
  cal_paper: 'ef.err_paper',
  dades_en_us: 'rec.err_unique',
  cal_nom: 'org.err_cal_nom',
  // Las notas internas (plan 1, 1F, `afegir_nota_interna()` / `esborrar_nota_interna()`).
  canal_nota_desconegut: 'ni.err_canal',
  // Los seguimientos (Taula mestra 1.5, 20270504100000). `propera_accio_massa_llarga` antes que
  // `nota_massa_llarga` por si acaso (no lo contiene, pero se parecen).
  tipus_nota_desconegut: 'ni.err_tipus',
  responsable_no_equip: 'ni.err_responsable',
  propera_accio_sense_data: 'ni.err_seguiment_incomplet',
  propera_data_sense_accio: 'ni.err_seguiment_incomplet',
  propera_accio_massa_llarga: 'ni.err_accio_llarga',
  nota_sense_seguiment: 'ni.err_sense_seguiment',
  nota_buida: 'ni.err_buida',
  nota_massa_llarga: 'ni.err_massa_llarga',
  nota_futura: 'ni.err_futura',
  nota_inexistent: 'ni.err_inexistent',
  // Proceso 1.2 (20270616100000). `kg_invalid` va DESPUÉS de `kg_invalids` (arriba), que lo contiene.
  resultat_massa_llarg: 'ni.err_resultat_llarg',
  kg_invalid: 'ni.err_kg',
  producte_desconegut: 'ni.err_producte',
  organitzacio_inexistent: 'ni.err_org_inexistent',
  // «Registrar operació realitzada» (proceso 3.7, `registrar_operacio_realitzada()`, 20270619100200).
  // Los que ya estaban arriba (`kg_invalids`, `data_futura`, `preu_invalid`, `cal_preu_acordat`,
  // `modalitat_invalida`, `producte_desconegut`, `ubicacio_aliena`, `sense_conveni`,
  // `entitat_inactiva`) conservan su texto. Ninguno de estos contiene a otro de la lista ni lo
  // contienen sus mensajes; `espigolada_nomes_donacio` no es `espigolada_no_donacio` (arriba).
  espigolada_nomes_donacio: 'opr.err_espigolada',
  cal_data: 'opr.err_data',
  fora_exercici: 'opr.err_fora_exercici',
  observacions_llargues: 'opr.err_observacions',
  productor_inexistent: 'opr.err_productor_inexistent',
  cal_destinatari: 'opr.err_cal_destinatari',
  destinatari_invalid: 'opr.err_destinatari_invalid',
  entitat_repetida: 'opr.err_entitat_repetida',
  entitat_inexistent: 'ni.err_org_inexistent',
  destins_invalids: 'opr.err_destins_invalids',
  desti_desconegut: 'desti.err_desti_desconegut',
  kg_no_quadren: 'opr.err_kg_no_quadren',
  periode_certificat: 'opr.err_periode_certificat',
  id_excedent_invalid: 'opr.err_id_excedent',
  id_excedent_ocupat: 'opr.err_id_excedent',
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

/**
 * El error de una acción con la FIRMA INSTITUCIONAL (contrasignar un convenio, emitir o rectificar
 * un certificado real; proceso 0.1, 25-11-2026): un `42501` dice que es cosa del Superadmin, no un
 * «no tens permís» genérico. El resto, como `textError`.
 */
export function textErrorInstitucional(
  t: Traductor,
  r: { missatge?: string | null; codi?: string | null } | null | undefined,
  fallback = 'c.error',
): string {
  if (r?.codi === '42501') return t('eq.signatura_institucional')
  return textError(t, r, fallback)
}
