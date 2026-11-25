// La llamada de «Registrar operació realitzada» (proceso 3.7, `registrar_operacio_realitzada()`,
// 20270619100200). La lógica pura (validación y argumentos) vive en `operacioRealitzada.ts`.
//
// 🔴 SIN EDGE FUNCTION: la RPC se llama con la sesión del usuario porque `validar_recollida()`
//    exige saber quién valida (con `service_role` la base devuelve 42501). El `E-…` lo genera la
//    base con la fecha de la operación.
//
// Mismo contrato que el resto de clientes de `src/lib`: **nunca lanza**. Devuelve `ok` y, si no,
// el mensaje de la base y el SQLSTATE en `codi`; la pantalla lo traduce con `textError()`.

import { supabase } from './supabase'
import type { ResultatRpc } from './albarans'
import type { ResultatOperacioRealitzada } from '../types'
import type { ArgsOperacio } from './operacioRealitzada'

export async function registraOperacioRealitzada(
  args: ArgsOperacio,
): Promise<ResultatRpc<ResultatOperacioRealitzada>> {
  try {
    const { data, error } = await supabase.rpc('registrar_operacio_realitzada', { ...args })
    if (error) return { ok: false, missatge: error.message || 'c.error', codi: error.code ?? null }
    return { ok: true, data: data as ResultatOperacioRealitzada }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}
