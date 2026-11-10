// La Operativa del productor en LECTURA (Plan 2, A4 `20270521100000`; movido aquí en A2): de
// la clave `operativa` de `diagnostic_datos()` a filas «etiqueta → texto».
//
// MÓDULO HOJA (§7, `tests/puresa.test.ts`): sin red, sin `Deno.` y sin imports. Lo usan dos
// sitios que tienen que contar exactamente lo mismo:
//   · el resumen del diagnóstico en pantalla (`ResumDiagnostic`, vía `src/lib/operativaLlegible.ts`,
//     con la `t()` de `src/lib/i18n.tsx`);
//   · el PDF del diagnóstico bajo demanda (`_shared/pdf/render/diagnostic.ts`, función
//     `diagnostic-pdf`), con `ETIQUETES_OPERATIVA` como `t()`.
// Pruebas en `tests/operativaLlegible.test.ts` (incluida la paridad de `ETIQUETES_OPERATIVA`
// con el diccionario de la pantalla).
//
// Solo salen las filas con algo: un resumen lleno de «—» no dice nada a quien lo lee.

export type TraduccioOperativa = (clau: string, vars?: Record<string, string | number>) => string

/** Un lugar de recogida tal como lo devuelve `diagnostic_datos().operativa.llocs`. */
export interface LlocOperativaLlegible {
  alias: string | null
  municipi: string | null
  principal: boolean
  dies: number[] | null
  franges: { inici: string; fi: string }[] | null
  horari: string | null
}

/** La clave `operativa` de `diagnostic_datos()` (A4). Mismo contrato que `OperativaDiagnostic` de `src/types.ts`. */
export interface OperativaLlegible {
  activitat: string[] | null
  productes: string[] | null
  principals: string[] | null
  varietats: Record<string, string[]> | null
  volum: Record<string, number> | null
  temporada: Record<string, number[]> | null
  envasos: string[] | null
  canals: string[] | null
  clients: string[] | null
  facturacio_eur: number | null
  facturacio_rang: string | null
  volum_comercialitzat_kg: number | null
  suport: string[] | null
  llocs: LlocOperativaLlegible[]
}

export interface FilaOperativa {
  /** Clave i18n de la etiqueta (la misma que en la ficha). */
  clau: string
  text: string
}

const MESOS: Record<'ca' | 'es', string[]> = {
  ca: ['gen', 'feb', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'des'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
}

const llista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter((x) => x.trim() !== '') : [])
const mapa = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** «1.200» en ca/es (punto de miles, sin decimales si no hacen falta). */
function nombre(n: number, lang: 'ca' | 'es'): string {
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'ca-ES', { maximumFractionDigits: 2 }).format(n)
}

/** Meses 1–12 → «gen, feb, mar». */
export function textMesos(mesos: unknown, lang: 'ca' | 'es'): string {
  return (Array.isArray(mesos) ? mesos : [])
    .map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
    .sort((a, b) => a - b).map((m) => MESOS[lang][m - 1]).join(', ')
}

/** «dl, dc · 08:00–12:00» de un lugar (días y franjas); vacío si no hay ninguno. */
export function textDiesFranges(
  l: Pick<LlocOperativaLlegible, 'dies' | 'franges'>,
  t: TraduccioOperativa,
): string {
  const dies = (l.dies ?? []).filter((d) => d >= 1 && d <= 7).map((d) => t(`org.dia_${d}`)).join(', ')
  const franges = (l.franges ?? []).map((f) => `${f.inici}–${f.fi}`).join(', ')
  return [dies, franges].filter(Boolean).join(' · ')
}

export function filesOperativa(
  op: OperativaLlegible | null | undefined,
  t: TraduccioOperativa,
  lang: 'ca' | 'es',
  nomActivitat: (codi: string) => string = (c) => c,
): FilaOperativa[] {
  if (!op) return []
  const out: FilaOperativa[] = []
  const posa = (clau: string, text: string) => { if (text.trim() !== '') out.push({ clau, text }) }
  // Cada prefijo, escrito entero en su plantilla: así `tests/cobertura.test.ts` ve las claves.
  const opcions = (v: unknown, clau: (x: string) => string) => llista(v).map((x) => t(clau(x))).join(', ')

  posa('org.f_activitat', llista(op.activitat).map(nomActivitat).join(', '))
  posa('f.productos_habituales', llista(op.productes).join(', '))
  posa('op.f_principals', llista(op.principals).join(', '))

  const varietats = Object.entries(mapa(op.varietats))
    .map(([p, v]) => [p, llista(v).join(', ')] as const).filter(([, v]) => v !== '')
    .map(([p, v]) => `${p}: ${v}`)
  posa('op.f_varietats', varietats.join('\n'))

  const volum = Object.entries(mapa(op.volum))
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([p, v]) => `${p}: ${nombre(v as number, lang)} ${t('op.kg_any')}`)
  posa('op.f_volum', volum.join('\n'))

  const temporada = Object.entries(mapa(op.temporada))
    .map(([p, m]) => [p, textMesos(m, lang)] as const).filter(([, m]) => m !== '')
    .map(([p, m]) => `${p}: ${m}`)
  posa('op.f_temporada', temporada.join('\n'))

  posa('op.f_envasos', opcions(op.envasos, (x) => `op.env_${x}`))
  posa('op.f_canals', opcions(op.canals, (x) => `op.canal_${x}`))
  posa('op.f_clients', opcions(op.clients, (x) => `op.client_${x}`))
  if (typeof op.facturacio_eur === 'number') posa('op.f_facturacio_eur', `${nombre(op.facturacio_eur, lang)} €`)
  if (op.facturacio_rang) posa('op.f_facturacio_rang', op.facturacio_rang)
  if (typeof op.volum_comercialitzat_kg === 'number') {
    posa('op.f_volum_comercialitzat', `${nombre(op.volum_comercialitzat_kg, lang)} kg`)
  }
  posa('op.f_suport', opcions(op.suport, (x) => `op.suport_${x}`))

  // Los lugares, el principal primero (ya viene así) y marcado.
  const llocs = (op.llocs ?? []).map((l) => {
    const nom = [l.alias, l.municipi].filter(Boolean).join(' · ') || '—'
    const extra = textDiesFranges(l, t) || (l.horari ?? '')
    return `${nom}${l.principal ? ` (${t('org.place_principal')})` : ''}${extra ? ` — ${extra}` : ''}`
  })
  posa('diag.operativa_llocs', llocs.join('\n'))
  return out
}

/**
 * Las etiquetas que pide `filesOperativa()`, para quien no tiene el diccionario de la pantalla
 * (el PDF, en Deno). 🔴 **Copia exacta de `src/lib/i18n.tsx`**: `tests/operativaLlegible.test.ts`
 * falla si un texto difiere o si la pantalla gana una opción (`op.env_*`, `op.canal_*`,
 * `op.client_*`, `op.suport_*`) que aquí no está. Se cambian los dos a la vez.
 */
export const ETIQUETES_OPERATIVA: Record<'ca' | 'es', Record<string, string>> = {
  ca: {
    'org.f_activitat': 'Tipus d’activitat (què fa l’organització)',
    'f.productos_habituales': 'Productes habituals',
    'op.f_principals': 'Productes principals',
    'op.f_varietats': 'Varietats',
    'op.f_volum': 'Volum de producció anual',
    'op.kg_any': 'kg/any',
    'op.f_temporada': 'Temporada',
    'op.f_envasos': 'Envasos habituals',
    'op.env_caixes': 'Caixes', 'op.env_palets': 'Palets', 'op.env_granel': 'A granel', 'op.env_sacs': 'Sacs', 'op.env_altres': 'Altres',
    'op.f_canals': 'Canals de comercialització',
    'op.canal_mercats_majoristes': 'Mercats majoristes', 'op.canal_distribucio_gran_superficie': 'Distribució i gran superfície',
    'op.canal_comerc_minorista': 'Comerç minorista', 'op.canal_restauracio_catering': 'Restauració i càtering',
    'op.canal_industria_alimentaria': 'Indústria alimentària', 'op.canal_venda_directa': 'Venda directa',
    'op.canal_cooperatives_productors': 'Cooperatives de productors', 'op.canal_altres': 'Altres',
    'op.f_clients': 'Tipologia de clients',
    'op.client_majoristes_distribuidors': 'Majoristes i distribuïdors', 'op.client_comercos_botigues': 'Comerços i botigues',
    'op.client_supermercats_cadenes': 'Supermercats i cadenes', 'op.client_restaurants_catering': 'Restaurants i càtering',
    'op.client_industria_transformadora': 'Indústria transformadora', 'op.client_consumidors_finals': 'Consumidors finals',
    'op.client_administracions': 'Administracions', 'op.client_altres': 'Altres',
    'op.f_facturacio_eur': 'Facturació anual (€)',
    'op.f_facturacio_rang': 'Rang de facturació',
    'op.f_volum_comercialitzat': 'Volum comercialitzat (kg/any)',
    'op.f_suport': 'En què us podem ajudar?',
    'op.suport_compradors': 'Trobar compradors', 'op.suport_donacions': 'Canalitzar donacions',
    'op.suport_transformacio': 'Transformar el producte', 'op.suport_logistica': 'Logística i recollides',
    'op.suport_prevencio': 'Prevenir excedents', 'op.suport_anticipar': 'Anticipar excedents', 'op.suport_altres': 'Altres',
    'org.place_principal': 'Principal',
    'org.dia_1': 'dl', 'org.dia_2': 'dt', 'org.dia_3': 'dc', 'org.dia_4': 'dj', 'org.dia_5': 'dv', 'org.dia_6': 'ds', 'org.dia_7': 'dg',
    'diag.operativa_llocs': 'Llocs de recollida',
  },
  es: {
    'org.f_activitat': 'Tipo de actividad (qué hace la organización)',
    'f.productos_habituales': 'Productos habituales',
    'op.f_principals': 'Productos principales',
    'op.f_varietats': 'Variedades',
    'op.f_volum': 'Volumen de producción anual',
    'op.kg_any': 'kg/año',
    'op.f_temporada': 'Temporada',
    'op.f_envasos': 'Envases habituales',
    'op.env_caixes': 'Cajas', 'op.env_palets': 'Palés', 'op.env_granel': 'A granel', 'op.env_sacs': 'Sacos', 'op.env_altres': 'Otros',
    'op.f_canals': 'Canales de comercialización',
    'op.canal_mercats_majoristes': 'Mercados mayoristas', 'op.canal_distribucio_gran_superficie': 'Distribución y gran superficie',
    'op.canal_comerc_minorista': 'Comercio minorista', 'op.canal_restauracio_catering': 'Restauración y cáterin',
    'op.canal_industria_alimentaria': 'Industria alimentaria', 'op.canal_venda_directa': 'Venta directa',
    'op.canal_cooperatives_productors': 'Cooperativas de productores', 'op.canal_altres': 'Otros',
    'op.f_clients': 'Tipología de clientes',
    'op.client_majoristes_distribuidors': 'Mayoristas y distribuidores', 'op.client_comercos_botigues': 'Comercios y tiendas',
    'op.client_supermercats_cadenes': 'Supermercados y cadenas', 'op.client_restaurants_catering': 'Restaurantes y cáterin',
    'op.client_industria_transformadora': 'Industria transformadora', 'op.client_consumidors_finals': 'Consumidores finales',
    'op.client_administracions': 'Administraciones', 'op.client_altres': 'Otros',
    'op.f_facturacio_eur': 'Facturación anual (€)',
    'op.f_facturacio_rang': 'Rango de facturación',
    'op.f_volum_comercialitzat': 'Volumen comercializado (kg/año)',
    'op.f_suport': '¿En qué os podemos ayudar?',
    'op.suport_compradors': 'Encontrar compradores', 'op.suport_donacions': 'Canalizar donaciones',
    'op.suport_transformacio': 'Transformar el producto', 'op.suport_logistica': 'Logística y recogidas',
    'op.suport_prevencio': 'Prevenir excedentes', 'op.suport_anticipar': 'Anticipar excedentes', 'op.suport_altres': 'Otros',
    'org.place_principal': 'Principal',
    'org.dia_1': 'lu', 'org.dia_2': 'ma', 'org.dia_3': 'mi', 'org.dia_4': 'ju', 'org.dia_5': 'vi', 'org.dia_6': 'sá', 'org.dia_7': 'do',
    'diag.operativa_llocs': 'Lugares de recogida',
  },
}

/** `t()` sobre `ETIQUETES_OPERATIVA`: una clave que falte sale tal cual (y la prueba de paridad la caza). */
export function traduccioOperativa(lang: 'ca' | 'es'): TraduccioOperativa {
  const dict = ETIQUETES_OPERATIVA[lang]
  return (clau) => dict[clau] ?? clau
}
