// Verificación pública de un certificado: `/verificar/:codi`.
//
// Quien la usa no tiene cuenta y probablemente no sabe qué es Redestina: es el tercero al
// que la entidad receptora le enseña el certificado —un ayuntamiento, quien revisa una
// subvención, quien lee una memoria anual— y lo único que tiene es el código impreso en el
// PDF, o el sello de una web.
//
// Por eso aquí no se toca `supabase.auth` ni se manda ninguna cabecera `Authorization`: la
// Edge Function `verificar-certificat` se despliega con `verify_jwt = false` y lo que
// autoriza es conocer el código. Mismo criterio que `enllacPublic.ts`.
//
// Y, como el resto de clientes del proyecto, **nunca lanza**.

import { supabaseUrl } from './supabase'

// ⚠️ `codiVerificacio()` y `urlVerificacio()` NO están aquí: son puras y viven en
// `codiVerificacio.ts`, porque este módulo importa el cliente de Supabase y por tanto no se
// puede importar desde Vitest (el cliente lanza al cargarse si faltan las variables).

/** Lo que devuelve la Edge Function cuando el código existe. Vocabulario suyo, literal. */
export interface CertificatVerificat {
  numero: string | null
  entitat: string | null
  periode: { des_de: string | null; fins_a: string | null }
  kg: number | null
  /** `false` = sustituido por uno posterior. **Sigue siendo auténtico**, pero no es el vigente. */
  vigent: boolean
  mode: 'real' | 'prueba' | null
  emes_el: string | null
}

/**
 * Los cuatro finales, y ninguno se puede confundir con otro:
 *
 *   · `valid`       — existe y es el vigente.
 *   · `substituit`  — existe, es auténtico, y hay otro posterior que lo sustituye. Un
 *                     tercero tiene que saberlo: no es lo mismo que «vale».
 *   · `desconegut`  — no existe ningún certificado con ese código (404).
 *   · `error`       — no hemos podido preguntar. **No es «no existe»**: decirle a alguien
 *                     que un certificado auténtico no consta, porque se ha caído la red,
 *                     es acusarlo de falsificarlo.
 */
export type ResultatVerificacio =
  | { estat: 'valid'; dades: CertificatVerificat }
  | { estat: 'substituit'; dades: CertificatVerificat }
  | { estat: 'desconegut' }
  | { estat: 'error' }

function text(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function numero(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function normalitza(cos: Record<string, unknown>): CertificatVerificat {
  const per = (cos.periode ?? {}) as Record<string, unknown>
  const mode = text(cos.mode)
  return {
    numero: text(cos.numero),
    entitat: text(cos.entitat),
    periode: { des_de: text(per.des_de), fins_a: text(per.fins_a) },
    kg: numero(cos.kg),
    // Ante la duda, vigente: el servidor solo responde 200 de un certificado que existe, y
    // marcar «sustituido» lo que no consta que lo esté restaría valor a un papel bueno.
    vigent: cos.vigent !== false,
    mode: mode === 'real' || mode === 'prueba' ? mode : null,
    emes_el: text(cos.emes_el),
  }
}

/**
 * Pregunta por un código. Se manda tal cual lo escribió quien llega —con guiones o sin
 * ellos, en minúsculas o no—: normalizarlo aquí y en el servidor serían dos normalizaciones
 * que pueden dejar de coincidir, y la que manda es la del servidor.
 */
export async function verificaCertificat(codi: string): Promise<ResultatVerificacio> {
  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/verificar-certificat?codi=${encodeURIComponent(codi)}`,
      { method: 'GET' },
    )
    if (res.status === 404) return { estat: 'desconegut' }
    const cos = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !cos) return { estat: 'error' }
    // `valid: false` con un 200 es la otra forma que tiene el contrato de decir «no existe».
    if (cos.valid === false) return { estat: 'desconegut' }
    const dades = normalitza(cos)
    return { estat: dades.vigent ? 'valid' : 'substituit', dades }
  } catch {
    return { estat: 'error' }
  }
}
