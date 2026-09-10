// Cliente de convenios (fase 2).
//
// Todo lo que mueve un convenio es una RPC, nunca un `update`: `authenticated` solo tiene
// SELECT sobre `convenios` (20270111100000), así que aquí no hay —ni puede haber— ninguna
// escritura directa. Preparar compone el texto con la plantilla vigente, enviar crea el
// enlace de firma y **revoca el anterior**, contrafirmar estampa la firma de la apoderada
// y emite el PDF definitivo. Cada una de esas cosas mueve varias tablas en una
// transacción, y una transacción no cabe en un `update` desde el navegador.
//
// Mismo contrato que `albarans.ts`, `documents.ts` y `redestina.ts`: **nunca lanza**.
// Devuelve `ok` y, cuando no, el mensaje que da la base —que ya viene en catalán y dice
// qué regla se ha incumplido— más una clave i18n de respaldo para lo genérico.
//
// ⚠️ EL TOKEN EN CLARO SOLO EXISTE UNA VEZ. `enviar_convenio()` e
// `iniciar_firma_asistida()` lo devuelven porque en la base solo vive su sha256. La
// pantalla lo enseña como enlace copiable —el modelo de Redestina es asistido (§1bis)— y
// puede mandarlo por correo con la plantilla de marca. No se guarda en ningún sitio.

import { supabase } from './supabase'
import { enviarEmail } from './email'
import type { ResultatRpc } from './albarans'
import type { Convenio, ConvenioEstado, ConvenioTipo } from '../types'

export type { ResultatRpc }

/** El enlace recién creado, con su token. Es lo único que hay que copiar o mandar. */
export interface EnllacFirma {
  id: string
  token: string
  destinatari?: string | null
  nom?: string | null
  canal?: 'email' | 'asistido'
}

export interface ResultatEnviament {
  conveni: Convenio
  enllac: EnllacFirma
}

export interface ResultatFirmaAssistida {
  conveni: Convenio
  enllac: EnllacFirma
  /** 6 cifras, 10 minutos. `null` cuando la ficha no tiene correo: entonces no hay 2º factor. */
  codi: string | null
  destinatari_codi: string | null
}

/** Fila de `v_fitxes_incompletes_conveni` (vista, no tabla: por eso vive aquí). */
export interface FitxaIncompleta {
  tipo_org: 'productor' | 'entidad'
  org_id: string
  nom: string | null
  email: string | null
  comarca: string | null
  es_test: boolean | null
  tipo: ConvenioTipo
  te_conveni_vigent: boolean
  /** `correu` · `nif` · `domicili` · `poblacio`. Vacío = lista para enviar. */
  falta: string[] | null
  nomes_firma_assistida: boolean
}

/** Fila de `v_campanya_convenis`. */
export interface CampanyaFila {
  tipo_org: 'productor' | 'entidad'
  tipo: ConvenioTipo
  comarca: string
  organitzacions: number
  vigents: number
  per_contrasignar: number
  pendents_firma: number
  retornats: number
  esborranys: number
  resolts: number
  sense_conveni: number
  pct_vigent: number | null
}

/**
 * Envoltorio único de `supabase.rpc`.
 *
 * Copiado a propósito de `albarans.ts` en vez de compartirlo: son doce líneas y
 * exportarlo desde allí ataría dos módulos que no tienen nada más en común. Lo que sí se
 * comparte es el **tipo** del resultado, que es el contrato que las pantallas leen.
 */
async function crida<T>(
  nom: string,
  args: Record<string, unknown>,
  claveFallback: string,
): Promise<ResultatRpc<T>> {
  try {
    const { data, error } = await supabase.rpc(nom, args)
    if (error) {
      return { ok: false, missatge: error.message || claveFallback, codi: error.code ?? null }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, missatge: claveFallback, codi: null }
  }
}

/**
 * El borrador. Es **idempotente por organización y modelo**: si ya hay uno en marcha lo
 * devuelve en vez de crear otro, así que la campaña se puede relanzar sin multiplicar
 * borradores.
 */
export function prepararConveni(
  tipusOrg: 'productor' | 'entidad',
  org: string,
  tipus: ConvenioTipo,
  idioma: 'ca' | 'es' | null = null,
  rolsCom: string[] | null = null,
): Promise<ResultatRpc<Convenio>> {
  return crida('preparar_convenio', {
    p_tipo_org: tipusOrg,
    p_org: org,
    p_tipo: tipus,
    p_idioma: idioma,
    p_roles_com: rolsCom,
  }, 'conv.err_generic')
}

/** Crea el enlace de firma (30 días) y revoca el anterior. Devuelve el token en claro. */
export function enviarConveni(id: string, email: string | null = null): Promise<ResultatRpc<ResultatEnviament>> {
  return crida('enviar_convenio', { p_id: id, p_email: email }, 'conv.err_generic')
}

/** Valida y estampa: el convenio pasa a `vigent` y sale el PDF definitivo. */
export function contrafirmarConveni(id: string): Promise<ResultatRpc<Convenio>> {
  return crida('contrafirmar_convenio', { p_id: id }, 'conv.err_generic')
}

/** Devolver NO anula la firma: corrige un dato y vuelve a pedirla. El motivo es obligatorio. */
export function retornarConveni(id: string, motiu: string): Promise<ResultatRpc<Convenio>> {
  return crida('retornar_convenio', { p_id: id, p_motiu: motiu }, 'conv.err_generic')
}

/** La baja, con su fecha de efecto (por defecto, dos meses de preaviso). */
export function resoldreConveni(
  id: string,
  motiu: string,
  dataEfecte: string | null = null,
): Promise<ResultatRpc<Convenio>> {
  return crida('resolver_convenio', {
    p_id: id,
    p_motiu: motiu,
    p_fecha_efecto: dataEfecte,
  }, 'conv.err_generic')
}

/** El enlace que no se manda: lo abre el dinamizador con el firmante delante (§3.2.5). */
export function iniciarFirmaAssistida(id: string): Promise<ResultatRpc<ResultatFirmaAssistida>> {
  return crida('iniciar_firma_asistida', { p_id: id }, 'conv.err_generic')
}

/** ¿Esta organización puede operar en esta valorización? Lo decide la base, no la pantalla. */
export function conveniVigent(
  tipusOrg: 'productor' | 'entidad',
  org: string,
  valoritzacio: 'donacio' | 'venda' | 'maquila',
  part: 'entrega' | 'recibe',
): Promise<ResultatRpc<boolean>> {
  return crida('convenio_vigente', {
    p_tipo_org: tipusOrg,
    p_org: org,
    p_valorizacion: valoritzacio,
    p_parte: part,
  }, 'conv.err_generic')
}

/** La URL pública de firma. Un solo sitio la compone, para que no haya dos formatos. */
export function urlSignatura(token: string): string {
  return `${window.location.origin}/signar/${token}`
}

/**
 * Manda el enlace por correo con la plantilla de marca (el servidor maqueta, §9bis).
 *
 * No lo hace la RPC porque la base no puede enviar correo, y no lo hace `generar-documento`
 * porque en este punto **todavía no hay PDF**: el número y el documento nacen al firmar.
 * Así que el envío es de quien tiene el token, que es esta pantalla.
 */
export async function enviarCorreuConveni(camps: {
  email: string
  nom: string | null
  token: string
  assumpte: string
  titol: string
  preheader: string
  cos: string
  boto: string
  nota: string
}): Promise<{ ok: boolean; missatge: string | null }> {
  const res = await enviarEmail({
    to: camps.email,
    subject: camps.assumpte,
    text: camps.cos,
    plantilla: {
      titulo: camps.titol,
      preheader: camps.preheader,
      boton: { texto: camps.boto, url: urlSignatura(camps.token) },
      nota: camps.nota,
    },
  })
  if (res.ok) return { ok: true, missatge: null }
  const cos = res.data as { error?: string; code?: string } | null
  return { ok: false, missatge: cos?.error ?? cos?.code ?? null }
}

/** Estado → clase de token. El error es rojo; el coral no significa fallo (§2bis). */
export function estilEstatConveni(estat: ConvenioEstado | string): string {
  switch (estat) {
    case 'vigent': return 'bg-exito-fondo text-exito'
    case 'firmat': return 'bg-aviso-fondo text-aviso'
    case 'pendent_firma': return 'bg-aviso-fondo text-aviso'
    case 'retornat': return 'bg-error-fondo text-error'
    case 'resolt': return 'bg-error-fondo text-error'
    case 'substituit': return 'bg-muted text-muted-foreground'
    default: return 'bg-secondary text-secondary-foreground'
  }
}

/** Los siete estados, en el orden del circuito. Lo usan el filtro y las pestañas. */
export const ESTATS_CONVENI: ConvenioEstado[] = [
  'esborrany', 'pendent_firma', 'firmat', 'vigent', 'retornat', 'resolt', 'substituit',
]

export const TIPUS_CONVENI: ConvenioTipo[] = ['don_gen', 'don_rec', 'com']

/**
 * Nombre de la organización de un convenio, venga de donde venga.
 *
 * La copia congelada (`datos_org.raso_social`) manda sobre la ficha: es lo que se firmó.
 * Mientras el convenio es un borrador todavía no hay copia, así que cae a la ficha.
 */
export function nomOrganitzacio(
  datosOrg: Record<string, unknown> | null,
  nomFitxa: string | null,
): string {
  const raso = datosOrg?.raso_social
  if (typeof raso === 'string' && raso.trim() !== '') return raso
  return nomFitxa || '—'
}
