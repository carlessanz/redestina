// Consentimientos RGPD desde el panel del equipo (04-11-2026, 20270506100000):
//   · pedirlo por correo: `demanar_consentiment` acuña el enlace y `enviar-email` lo manda
//     con la plantilla de marca; la persona responde en `/consentiment/:token`;
//   · exportar la lista: `llista_consentiments()` da el valor vigente por persona y tipo, y
//     `filesExport` lo pliega en una fila por persona para el CSV (PURO, con test).
//
// 🔴 El equipo ya no declara ningún consentimiento en nombre de nadie: solo lo pide.

import { supabase } from './supabase'
import { enviarEmail } from './email'

export type TipusConsentiment = 'privacitat' | 'comunicacions_plataforma' | 'comunicacions_espigoladors'

export interface FilaConsentiment {
  organizacion_id: string | null
  entitat: string | null
  es_generadora: boolean
  es_receptora: boolean
  email: string | null
  tipus: TipusConsentiment
  valor: boolean
  origen: string
  versio_text: string
  created_at: string
}

export interface FilaExport {
  entitat: string
  papers: string[]
  email: string
  privacitat: boolean | null
  comunicacions_plataforma: boolean | null
  comunicacions_espigoladors: boolean | null
  origen: string
  data: string
}

/** Una fila por persona (organización + correo) con sus tres valores vigentes. */
export function filesExport(files: FilaConsentiment[]): FilaExport[] {
  const per = new Map<string, FilaExport>()
  for (const f of files) {
    const email = (f.email ?? '').trim().toLowerCase()
    if (!email) continue
    const clau = `${f.organizacion_id ?? ''}|${email}`
    let e = per.get(clau)
    if (!e) {
      const papers: string[] = []
      if (f.es_generadora) papers.push('ofertant')
      if (f.es_receptora) papers.push('receptor')
      e = {
        entitat: f.entitat ?? '', papers, email,
        privacitat: null, comunicacions_plataforma: null, comunicacions_espigoladors: null,
        origen: f.origen, data: f.created_at,
      }
      per.set(clau, e)
    }
    e[f.tipus] = f.valor
    if (f.created_at > e.data) { e.data = f.created_at; e.origen = f.origen }
  }
  return [...per.values()].sort((a, b) => a.entitat.localeCompare(b.entitat) || a.email.localeCompare(b.email))
}

/** Solo quien ha dicho que sí a alguna de las dos comunicaciones: la base de envíos. */
export function ambComunicacions(files: FilaExport[]): FilaExport[] {
  return files.filter((f) => f.comunicacions_plataforma === true || f.comunicacions_espigoladors === true)
}

function celda(v: string): string {
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** CSV con `;` (lo abre Excel en catalán/castellano sin asistente) y BOM para los acentos. */
export function csvConsentiments(files: FilaExport[], capcalera: string[], siNo: (v: boolean | null) => string): string {
  const linies = [capcalera.map(celda).join(';')]
  for (const f of files) {
    linies.push([
      f.entitat, f.papers.join(' + '), f.email,
      siNo(f.privacitat), siNo(f.comunicacions_plataforma), siNo(f.comunicacions_espigoladors),
      f.origen, f.data.slice(0, 10),
    ].map(celda).join(';'))
  }
  return '﻿' + linies.join('\n') + '\n'
}

export async function llistaConsentiments(): Promise<{ ok: true; files: FilaConsentiment[] } | { ok: false; missatge: string }> {
  const { data, error } = await supabase.rpc('llista_consentiments')
  if (error) return { ok: false, missatge: error.message }
  return { ok: true, files: (data ?? []) as FilaConsentiment[] }
}

export function urlConsentiment(token: string): string {
  return `${window.location.origin}/consentiment/${token}`
}

export interface TextosCorreuConsentiment {
  assumpte: string
  titol: string
  preheader: string
  cos: string
  boto: string
  nota: string
}

export interface EnllacConsentiment { token: string; destinatari: string; nom: string | null }

/**
 * Acuña el enlace de consentimiento (revoca el anterior) SIN mandar nada. Lo usan el envío por
 * correo y «Copia l’enllaç», que es la vía con el correo apagado (§8): el super_admin lo manda
 * desde su propio correo y la respuesta queda registrada igual.
 */
export async function crearEnllacConsentiment(orgId: string, email: string): Promise<
  { ok: true; enllac: EnllacConsentiment } | { ok: false; codi: string | null; missatge: string | null }
> {
  const { data, error } = await supabase.rpc('demanar_consentiment', { p_org: orgId, p_email: email || null })
  if (error) return { ok: false, codi: error.message?.trim() ?? null, missatge: error.message ?? null }
  return { ok: true, enllac: data as EnllacConsentiment }
}

/** El texto para pegar en un correo propio: el cuerpo, el enlace y la nota de caducidad. */
export function textCopiaConsentiment(t: { cos: string; boto: string; nota: string }, token: string): string {
  return `${t.cos}\n\n${t.boto}: ${urlConsentiment(token)}\n\n${t.nota}`
}

/**
 * Pide el consentimiento: acuña el enlace (revoca el anterior) y lo manda por correo.
 * `fase` dice dónde se paró: con `correu` el enlace existe pero el correo no salió.
 */
export async function demanarConsentiment(
  orgId: string,
  email: string,
  textos: TextosCorreuConsentiment,
  idioma: 'ca' | 'es',
  /** Con las notificaciones apagadas, si la persona lo ha aceptado (`acceptaEnviament`). */
  manual = false,
): Promise<{ ok: true; simulat: boolean } | { ok: false; fase: 'enllac' | 'correu'; codi: string | null; missatge: string | null }> {
  const r = await crearEnllacConsentiment(orgId, email)
  if (!r.ok) return { ok: false, fase: 'enllac', codi: r.codi, missatge: r.missatge }
  const enllac = r.enllac
  const res = await enviarEmail({
    to: enllac.destinatari,
    subject: textos.assumpte,
    text: textos.cos,
    plantilla: {
      titulo: textos.titol,
      preheader: textos.preheader,
      boton: { texto: textos.boto, url: urlConsentiment(enllac.token) },
      nota: textos.nota,
      idioma,
    },
    proposito: 'consentiment_rgpd',
    objeto_tipo: 'organizacion',
    objeto_id: orgId,
    manual,
  })
  if (!res.ok) {
    const cos = res.data as { code?: string; error?: string } | null
    return { ok: false, fase: 'correu', codi: cos?.code ?? null, missatge: cos?.error ?? null }
  }
  return { ok: true, simulat: res.simulat === true }
}
