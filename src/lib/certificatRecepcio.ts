// Cliente del **certificado de recepción** (`CR`): el espejo del certificado del donante,
// pero para la entidad que RECIBE. Kilos de una ventana de fechas, donación y compra
// juntas, y **ni un importe** — no es un documento fiscal y no va a ninguna declaración.
//
// Mismo reparto que `tancament.ts` y `albarans.ts`: todo es RPC y **ninguna escritura
// directa**. `authenticated` no tiene INSERT ni UPDATE sobre `cierres_receptor` ni sobre
// `cierre_receptor_lineas` (20260921223245), porque cada acción mueve varias tablas en una
// transacción —pedir número de serie, congelar el snapshot, encolar el PDF, sustituir los
// certificados contenidos— y eso no cabe en un `update` desde el navegador.
//
// Y **nunca lanza**: devuelve `ok`, y cuando no, el mensaje que da la base. Ese mensaje es
// mejor que cualquier frase nuestra porque dice la regla incumplida con sus cifras dentro:
// «Un certificat no pot cobrir dos exercicis (2026 i 2027): la serie es anual».

import { supabase } from './supabase'
import type { ResultatRpc } from './albarans'
import type { CierreReceptor, KgRebutsExercici } from '../types'

/**
 * Envoltorio de `supabase.rpc`, gemelo del de `tancament.ts`.
 *
 * Está copiado a propósito y no importado: `crida` es privada en cada módulo de cliente
 * (`albarans.ts`, `tancament.ts`), y exportarla desde uno de ellos convertiría en pública
 * una decisión interna —qué clave de respaldo usa cada familia de RPC— para ahorrar diez
 * líneas.
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

/** Lo que devuelve `emetre_certificat_recepcio()`. Sin ninguna cifra de euros: no existe. */
export interface ResultatCertificatRecepcio {
  document: string
  numero: string | null
  data?: string | null
  kg?: number | null
  kg_donacio?: number | null
  kg_compra?: number | null
  /** Cuántos certificados anteriores de esta entidad quedan sustituidos por este. */
  substitueix?: number
  /** Solo en la rectificación: la versión que acaba de nacer. */
  versio?: number
}

/**
 * El borrador de una ventana, con sus kilos y sus bloqueos.
 *
 * ⚠️ **Escribe**, igual que `calcular_certificado_periodo()`: inserta la fila de
 * `cierres_receptor` antes de que nadie decida emitir. Es lo que permite enseñar los kilos
 * y los bloqueos *antes* de quemar un número de serie, y el precio es que probar tres
 * ventanas deja tres borradores sin número (deuda §12.112).
 */
export function calcularCertificatRecepcio(c: {
  entitat: string
  desde: string
  hasta: string
  modo: 'prueba' | 'real'
}): Promise<ResultatRpc<CierreReceptor>> {
  return crida('calcular_certificat_recepcio', {
    p_entidad: c.entitat,
    p_desde: c.desde,
    p_hasta: c.hasta,
    p_modo: c.modo,
  }, 'crec.err_generic')
}

/**
 * Emitirlo. Consume un número de la serie `CR` (o `P-CR` en prueba) y no se deshace: solo
 * se rectifica.
 *
 * ⚠️ `p_motiu` **no es la excepción de D4 de otros tiempos** ni un parámetro que se acepta
 * y se ignora (deuda §12.111): es una nota INTERNA opcional que se guarda en
 * `cierres_receptor.notas` y **no se imprime**. Un certificado que dijera por qué se emitió
 * estaría afirmando algo sobre quien lo pidió que nadie ha comprobado.
 */
export function emetreCertificatRecepcio(
  id: string,
  motiu?: string | null,
): Promise<ResultatRpc<ResultatCertificatRecepcio>> {
  return crida('emetre_certificat_recepcio', {
    p_id: id,
    p_motiu: motiu && motiu.trim() !== '' ? motiu.trim() : null,
  }, 'crec.err_generic')
}

/** Rectificar: **no consume número nuevo**, es la versión siguiente del mismo `CR`. */
export function rectificarCertificatRecepcio(
  id: string,
  motiu: string,
): Promise<ResultatRpc<ResultatCertificatRecepcio>> {
  return crida('rectificar_certificat_recepcio', { p_id: id, p_motiu: motiu }, 'crec.err_generic')
}

/** Marcarlo como enviado. Solo desde `certificat_emes`. */
export function marcarEnviatRecepcio(id: string): Promise<ResultatRpc<CierreReceptor>> {
  return crida('marcar_enviat_recepcio', { p_id: id }, 'crec.err_generic')
}

/**
 * El acumulado del año de una entidad: kilos conciliados (los oficiales) y lo que todavía
 * está pendiente de conciliar.
 *
 * 🔴 **Se lee de la base, no se suma en el navegador.** Sumar aquí las canalizaciones sería
 * la forma de que la cifra de la pantalla y la del certificado acaben discrepando: la RPC
 * usa exactamente la misma expresión que `cierre_base_recepcio()`, empezando por el
 * `coalesce(valorizacion, 'donacio')` de las canalizaciones antiguas.
 *
 * `kg_rebuts_exercici()` es `security invoker`: agrega **solo lo que quien pregunta ya puede
 * leer**, así que la misma llamada sirve para la entidad (ve lo suyo) y para el equipo.
 * Devuelve 0 filas cuando no hay nada ese año, y eso no es un error: es `null`.
 */
export async function kgRebutsExercici(
  entitat: string,
  exercici?: number | null,
): Promise<ResultatRpc<KgRebutsExercici | null>> {
  const res = await crida<KgRebutsExercici[]>('kg_rebuts_exercici', {
    p_ejercicio: exercici ?? null,
    p_entidad: entitat,
  }, 'crec.err_kg')
  if (!res.ok) return res
  return { ok: true, data: res.data?.[0] ?? null }
}
