// Los mensajes del ciclo de una oferta, para copiarlos o leerlos (27-10-2026).
//
// POR QUÉ EXISTE. Con las notificaciones apagadas (§8) el equipo gestiona el ciclo entero y
// avisa a las partes A MANO. Para eso necesita el texto EXACTO que la plataforma habría
// mandado en cada paso: el de la oferta, el de «interés aprobado», el de «recogida por
// registrar»… Y ofertante y receptor, en su panel, el texto íntegro de lo que se les dirigió.
//
// LA REGLA. Si el paso deja una fila en `avisos`, el mensaje se compone con la MISMA función
// con la que `enviar-avis` lo manda (`textAvis` + `formatWhatsappAvis`, importadas del
// servidor: §7, módulos hoja) — así lo que se copia es lo que salió, o lo que habría salido.
// Si el paso no pasa por `avisos` (la oferta a las entidades, el agradecimiento del alta, lo
// que el bot contesta a un interés, RECOLLIDA CONFIRMADA al grupo), se compone de los datos.
//
// Puro y sin red: lo prueba `tests/missatgesOferta.test.ts`. Quien llama carga los datos.

import {
  formatTextAvisCorreu, formatWhatsappAvis, quan, textAvis, TIPUS_AVIS,
} from '../../supabase/functions/_shared/textAvis.ts'
import type { TipusAvis } from '../../supabase/functions/_shared/textAvis.ts'
import { textAgraimentIntake } from '../../supabase/functions/_shared/textIntake.ts'
import {
  textCorreuOfertaRegistrada, textPlaCorreuOfertaRegistrada,
} from '../../supabase/functions/_shared/textOfertaRegistrada.ts'
import { TEXT_REBUIG, textGracies } from '../../supabase/functions/_shared/textRespostes.ts'
import { textoRecollidaConfirmada } from './textos'
import { enllacInteresOferta, enllacRecollidaSollicitud, enllacRegistreRecollida } from './enllacosDirectes'

/** Las fases del ciclo guiado (`FASES_EQUIP` de `procesOferta.ts`). */
export type FaseMissatge = 'conveni' | 'entrada' | 'distribucio' | 'aprovacio' | 'lliurament' | 'tancament'
/** A quién va. `grup` es el grupo de WhatsApp de canalizaciones. */
export type DestinatariMissatge = 'productor' | 'entidad' | 'grup'
/**
 * `enviat`: la plataforma lo mandó. `no_enviat`: lo cortaron los interruptores o los gates.
 * `pendent`: el aviso existe y todavía no se ha intentado. `compost`: no es un aviso, es el
 * texto que corresponde a ese paso; no se sabe si salió.
 */
export type EstatMissatge = 'enviat' | 'no_enviat' | 'pendent' | 'compost'

export interface Missatge {
  /** Estable, para la `key` de React. */
  id: string
  /** El tipo de aviso, o qué mensaje compuesto es. */
  clau: string
  fase: FaseMissatge
  destinatari: DestinatariMissatge
  destinatariNom: string | null
  /** El texto EXACTO de WhatsApp. */
  whatsapp: string
  correu: { assumpte: string; text: string } | null
  estat: EstatMissatge
  canalEnviat: 'whatsapp' | 'email' | null
  enviatAt: string | null
  /** El motivo por el que no salió (`error_envio`), si se sabe. */
  motiuNoEnviat: string | null
  /** Cuándo ocurrió el paso, para ordenar. */
  at: string | null
  origen: 'avis' | 'compost'
}

export interface AvisMissatge {
  id: string
  tipus: string
  params: Record<string, unknown> | null
  objecte_id: string
  destinatari_tipo: 'productor' | 'entidad'
  destinatari_id: string
  canal_enviat: string | null
  enviat_at: string | null
  error_envio: string | null
  created_at: string
}

export interface FetsMissatges {
  oferta: {
    id: string
    producto: string | null
    id_excedente: string | null
    estado: string
    texto_oferta: string | null
    kg_total: number | null
    origen?: string | null
    validada_at?: string | null
    created_at?: string | null
  }
  productor?: { id: string; nom: string | null } | null
  respostes?: {
    id: string
    entidad_id: string | null
    canal: string | null
    estado: string
    kg_solicitados: number | null
    respondido_at?: string | null
    enviado_at?: string | null
  }[]
  canalitzacions?: {
    id: string
    entidad_id: string | null
    kg_confirmados: number | null
    data_hora_recollida: string | null
    estado: string | null
    comentarios?: string | null
    created_at?: string | null
    /** Multiproducto (fase 6c): la solicitud conjunta a la que pertenece esta entrega. */
    sollicitud_id?: string | null
  }[]
  /**
   * Multiproducto (fase 6c): de cada solicitud de las entregas de esta oferta, TODAS sus líneas
   * (también las de las otras ofertas de la disponibilidad), para el mensaje único. Sin esto, el
   * mensaje se compone con las entregas de esta oferta.
   */
  sollicituds?: Record<string, { linies: LiniaRecollidaGrup[] }>
  avisos?: AvisMissatge[]
  /** id de la entidad → nombre. */
  entitats?: Record<string, string>
}

export interface OpcionsMissatges {
  idioma: 'ca' | 'es'
  /** El origen público de la aplicación (`window.location.origin`). */
  appUrl: string
  t: (key: string, params?: Record<string, string | number>) => string
}

/** De qué fase del ciclo es cada aviso. */
export const FASE_AVIS: Record<TipusAvis, FaseMissatge> = {
  oferta_validada: 'entrada',
  oferta_rebutjada: 'entrada',
  oferta_modificada: 'distribucio',
  oferta_enviada: 'distribucio',
  interes_aprovat: 'aprovacio',
  interes_rebutjat: 'aprovacio',
  sortida_trobada: 'aprovacio',
  // Fase 6 del plan DIC 26: una solicitud multiproducto resuelta (un aviso por solicitud).
  sollicitud_resolta: 'aprovacio',
  // Fase 5 de los puntos 4-6: el equipo propone otros kilos, modalidad u hora a un interés.
  canvis_proposats: 'aprovacio',
  recollida_canviada: 'lliurament',
  kg_assignats_canviats: 'lliurament',
  assignacio_anulada: 'lliurament',
  recollida_per_registrar: 'lliurament',
  recollida_retornada: 'lliurament',
  recollida_confirmada: 'tancament',
  oferta_sense_desti: 'tancament',
  certificat_per_revisar: 'tancament',
  // Circuito de firma (05-11-2026): la versión firmada ya está en la biblioteca; es del cierre.
  document_signat: 'tancament',
}

const ORDRE_FASE: readonly FaseMissatge[] = ['conveni', 'entrada', 'distribucio', 'aprovacio', 'lliurament', 'tancament']

function esTipus(v: string): v is TipusAvis {
  return (TIPUS_AVIS as readonly string[]).includes(v)
}

/** Un aviso de la tabla, compuesto como lo manda `enviar-avis`. `null` si el tipo no se conoce. */
export function missatgeDAvis(
  a: AvisMissatge,
  o: Pick<OpcionsMissatges, 'idioma' | 'appUrl'>,
  nom: string | null = null,
): Missatge | null {
  if (!esTipus(a.tipus)) return null
  const txt = textAvis(a.tipus, a.params ?? {}, o.idioma, a.objecte_id, a.destinatari_tipo)
  const canal = a.canal_enviat === 'whatsapp' || a.canal_enviat === 'email' ? a.canal_enviat : null
  const estat: EstatMissatge = canal ? 'enviat' : a.canal_enviat === 'cap' ? 'no_enviat' : 'pendent'
  return {
    id: `avis:${a.id}`,
    clau: a.tipus,
    fase: FASE_AVIS[a.tipus],
    destinatari: a.destinatari_tipo,
    destinatariNom: nom,
    whatsapp: formatWhatsappAvis(txt, o.appUrl),
    correu: { assumpte: txt.asunto, text: formatTextAvisCorreu(txt, o.appUrl) },
    estat,
    canalEnviat: canal,
    enviatAt: a.enviat_at,
    motiuNoEnviat: estat === 'no_enviat' ? a.error_envio : null,
    at: a.created_at,
    origen: 'avis',
  }
}

/**
 * RECOLLIDA CONFIRMADA para el grupo, desde las entregas vivas de la oferta: quién, cuándo,
 * cuántos kilos asignados y cuántos faltan. La fecha, en hora de Madrid como los avisos.
 *
 * Con `appUrl`, acaba con el enlace para registrar los kilos reales (fase 4 de los puntos 4-6):
 * a la operación si solo hay una entrega viva; a «Els meus interessos» si hay varias.
 */
export function textRecollidaGrup(
  canalitzacions: NonNullable<FetsMissatges['canalitzacions']>,
  kgTotal: number,
  nomEntitat: (id: string | null) => string,
  idioma: 'ca' | 'es',
  appUrl?: string | null,
): string {
  const vives = canalitzacions.filter((c) => c.estado !== 'anulada')
  const kg = vives.reduce((s, c) => s + Number(c.kg_confirmados ?? 0), 0)
  return textoRecollidaConfirmada({
    entitat: vives.map((c) => nomEntitat(c.entidad_id)).join(', '),
    dataHora: vives.map((c) => quan(c.data_hora_recollida, idioma)).filter(Boolean).join(' · '),
    kgRecollits: String(kg),
    kgFalten: String(Math.max(0, kgTotal - kg)),
    comentaris: vives.map((c) => c.comentarios?.trim()).filter(Boolean).join(' · '),
    enllac: appUrl && vives.length > 0 ? enllacRegistreRecollida(appUrl, vives.map((c) => c.id)) : null,
  })
}

/** Una línea (un producto) de una solicitud multiproducto. */
export interface LiniaRecollidaGrup {
  producte: string
  kg: number | null
  estado: string | null
  entidad_id?: string | null
  data_hora_recollida?: string | null
  comentarios?: string | null
}

/**
 * RECOLLIDA CONFIRMADA de una SOLICITUD multiproducto (fase 6c, 25-11-2026): UN mensaje con todos
 * los productos confirmados de la solicitud (las líneas anuladas no cuentan), la fecha común y
 * UN enlace (`/receptor/interessos?recollida=<sollicitud>`) para registrar la recogida de todos a
 * la vez. En catalán, como todo lo que sale por WhatsApp (§7).
 */
export function textRecollidaSollicitud(a: {
  sollicitudId: string
  linies: readonly LiniaRecollidaGrup[]
  entitat: string
  idioma: 'ca' | 'es'
  appUrl?: string | null
}): string {
  const vives = a.linies.filter((l) => l.estado !== 'anulada')
  const kgTotal = Math.round(vives.reduce((s, l) => s + Number(l.kg ?? 0), 0) * 100) / 100
  const dates = [...new Set(vives.map((l) => quan(l.data_hora_recollida ?? null, a.idioma)).filter(Boolean))]
  const comentaris = [...new Set(vives.map((l) => l.comentarios?.trim()).filter(Boolean))]
  const lineas = [
    '🚚 *RECOLLIDA CONFIRMADA*',
    '',
    `🏛️ SDA / ENTITAT: ${a.entitat}`,
    `📅 DATA i HORA: ${dates.join(' · ')}`,
    '📦 PRODUCTES:',
    ...vives.map((l) => `• ${l.producte}: ${Number(l.kg ?? 0)} kg`),
    `⚖️ KG RECOLLITS: ${kgTotal}`,
    `👥 Comentaris: ${comentaris.join(' · ')}`,
  ]
  if (a.appUrl && vives.length > 0) {
    lineas.push('', `✅ Quan hagis fet la recollida, registra els kg reals de tots els productes aquí:\n${enllacRecollidaSollicitud(a.appUrl, a.sollicitudId)}`)
  }
  return lineas.join('\n')
}

/** Todos los mensajes de una oferta, ordenados por fase y, dentro de cada una, por momento. */
export function missatgesDeLOferta(f: FetsMissatges, o: OpcionsMissatges): Missatge[] {
  const out: Missatge[] = []
  const oferta = f.oferta
  const nomEntitat = (id: string | null) => (id && f.entitats?.[id]) || ''
  const nomDe = (tipus: 'productor' | 'entidad', id: string) =>
    tipus === 'entidad' ? (f.entitats?.[id] ?? null) : (f.productor?.id === id ? f.productor.nom : null)

  // 1. Lo que el productor recibe al registrar la oferta (intake por WhatsApp, panel o
  //    asistida). Una espigolada de hoy (`tipus_operacio = 'espigolada'`, fase 3 del
  //    25-11-2026) es una oferta más y lo tiene; solo el lote HEREDADO de una jornada
  //    (`origen = 'espigolament'`, ya no nace ninguno) no tuvo alta que avisar.
  if (oferta.origen !== 'espigolament' && oferta.id_excedente) {
    // Esperó validación si ahora la espera o si ya la pasó.
    const estatInicial = oferta.estado === 'pendent_validacio' || oferta.validada_at
      ? 'pendent_validacio' : 'publicada'
    const correu = textCorreuOfertaRegistrada(f.productor?.nom ?? '', oferta.id_excedente,
      oferta.producto ?? '', estatInicial)
    out.push({
      id: 'oferta_registrada', clau: 'oferta_registrada', fase: 'entrada',
      destinatari: 'productor', destinatariNom: f.productor?.nom ?? null,
      whatsapp: textAgraimentIntake(oferta.producto ?? '', oferta.id_excedente, estatInicial),
      correu: { assumpte: correu.assumpte, text: textPlaCorreuOfertaRegistrada(correu, o.appUrl) },
      estat: 'compost', canalEnviat: null, enviatAt: null, motiuNoEnviat: null,
      at: oferta.created_at ?? null, origen: 'compost',
    })
  }

  // 2. La oferta a las entidades, con los botones «M'interessa / Ara no» (los pone WhatsApp).
  if (oferta.texto_oferta) {
    const producto = oferta.producto ?? ''
    out.push({
      id: 'oferta', clau: 'oferta', fase: 'distribucio',
      destinatari: 'entidad', destinatariNom: null,
      whatsapp: oferta.texto_oferta,
      correu: {
        assumpte: o.t('od.email_subject', { producto }),
        // Directo a ESTA oferta con el formulario de interés abierto (fase 4 de los puntos 4-6).
        text: `${oferta.texto_oferta}\n\n${o.t('od.email_note')}\n\n${enllacInteresOferta(o.appUrl, oferta.id)}`,
      },
      estat: 'compost', canalEnviat: null, enviatAt: null, motiuNoEnviat: null,
      at: oferta.validada_at ?? oferta.created_at ?? null, origen: 'compost',
    })
  }

  // 3. Lo que el bot contesta a un interés. Solo cuando no lo dijo la propia entidad en su
  //    panel (ahí no hay conversación que contestar).
  for (const r of f.respostes ?? []) {
    if (r.canal === 'panel') continue
    const kg = Number(r.kg_solicitados ?? 0)
    const text = r.estado === 'acceptada' && kg > 0 ? textGracies(kg)
      : r.estado === 'rebutjada' ? TEXT_REBUIG : null
    if (!text) continue
    out.push({
      id: `resposta:${r.id}`, clau: r.estado === 'acceptada' ? 'resposta_gracies' : 'resposta_rebuig',
      fase: 'aprovacio', destinatari: 'entidad', destinatariNom: nomEntitat(r.entidad_id) || null,
      whatsapp: text, correu: null,
      estat: 'compost', canalEnviat: null, enviatAt: null, motiuNoEnviat: null,
      at: r.respondido_at ?? r.enviado_at ?? null, origen: 'compost',
    })
  }

  // 4. Los avisos de la tabla: el texto exacto que salió o habría salido.
  for (const a of f.avisos ?? []) {
    const m = missatgeDAvis(a, o, nomDe(a.destinatari_tipo, a.destinatari_id))
    if (m) out.push(m)
  }

  // 5. RECOLLIDA CONFIRMADA, para el grupo, en cuanto hay alguna entrega asignada. Las entregas
  //    de una SOLICITUD multiproducto (fase 6c) van en su propio mensaje, uno por solicitud, con
  //    todos sus productos y un solo enlace; las demás, en el de siempre.
  const vives = (f.canalitzacions ?? []).filter((c) => c.estado !== 'anulada')
  const soltes = vives.filter((c) => !c.sollicitud_id)
  if (soltes.length > 0) {
    // Lo que falta se cuenta contra TODO lo asignado de la oferta, también lo de las solicitudes.
    const kgSollicituds = vives.filter((c) => c.sollicitud_id).reduce((s, c) => s + Number(c.kg_confirmados ?? 0), 0)
    out.push({
      id: 'recollida_grup', clau: 'recollida_grup', fase: 'lliurament',
      destinatari: 'grup', destinatariNom: null,
      whatsapp: textRecollidaGrup(soltes, Math.max(0, Number(oferta.kg_total ?? 0) - kgSollicituds), nomEntitat, o.idioma, o.appUrl),
      correu: null,
      estat: 'compost', canalEnviat: null, enviatAt: null, motiuNoEnviat: null,
      at: soltes.map((c) => c.created_at ?? '').sort().at(-1) || null, origen: 'compost',
    })
  }
  const perSollicitud = new Map<string, typeof vives>()
  for (const c of vives) {
    if (!c.sollicitud_id) continue
    perSollicitud.set(c.sollicitud_id, [...(perSollicitud.get(c.sollicitud_id) ?? []), c])
  }
  for (const [sid, cans] of perSollicitud) {
    const linies: LiniaRecollidaGrup[] = f.sollicituds?.[sid]?.linies ?? cans.map((c) => ({
      producte: oferta.producto ?? '', kg: c.kg_confirmados, estado: c.estado,
      entidad_id: c.entidad_id, data_hora_recollida: c.data_hora_recollida, comentarios: c.comentarios ?? null,
    }))
    out.push({
      id: `recollida_grup:${sid}`, clau: 'recollida_grup', fase: 'lliurament',
      destinatari: 'grup', destinatariNom: null,
      whatsapp: textRecollidaSollicitud({
        sollicitudId: sid, linies, entitat: nomEntitat(cans[0].entidad_id), idioma: o.idioma, appUrl: o.appUrl,
      }),
      correu: null,
      estat: 'compost', canalEnviat: null, enviatAt: null, motiuNoEnviat: null,
      at: cans.map((c) => c.created_at ?? '').sort().at(-1) || null, origen: 'compost',
    })
  }

  return out.sort((a, b) =>
    ORDRE_FASE.indexOf(a.fase) - ORDRE_FASE.indexOf(b.fase)
    || (a.at ?? '').localeCompare(b.at ?? ''))
}

/**
 * Lo que se enseña en «Missatges de l'oferta» de la ficha de la oferta del equipo
 * (23-11-2026, petición de la Fundació para la demo): SOLO los dos mensajes que se consultan
 * y se copian —la oferta para compartir y RECOLLIDA CONFIRMADA con el enlace para registrar
 * los kg—. El resto del ciclo sigue en el ciclo guiado (`/equip/canalitzacio/:id`, paso a paso)
 * y en los paneles externos.
 */
export const CLAUS_MISSATGES_FITXA_OFERTA = ['oferta', 'recollida_grup'] as const

/**
 * Los mensajes de la ficha de la oferta: los de `CLAUS_MISSATGES_FITXA_OFERTA`, en ese orden y
 * cada mensaje una vez. RECOLLIDA CONFIRMADA puede salir más de una vez desde la fase 6c: el de
 * las entregas sueltas y uno por solicitud multiproducto (ids distintos).
 */
export function missatgesFitxaOferta(missatges: readonly Missatge[]): Missatge[] {
  const vistos = new Set<string>()
  return CLAUS_MISSATGES_FITXA_OFERTA.flatMap((clau) => missatges.filter((m) => {
    if (m.clau !== clau || vistos.has(m.id)) return false
    vistos.add(m.id)
    return true
  }))
}
