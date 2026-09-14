// Los helpers que necesitan las pantallas de documentos de los paneles externos.
//
// Son puros y viven aquí, fuera de los componentes, por dos motivos: los comparten el
// panel del productor y el del receptor —que enseñan lo mismo salvo los importes— y son
// lo único de esas pantallas que se puede probar sin montar React.

import type { ConvenioEstado, DocumentoTipo } from '../types'

/** Para qué sirve un enlace pendiente. Mismo vocabulario que `enlaces_token.proposito`. */
export type ProposicPendent = 'firma_convenio' | 'confirmacion_albaran'

/**
 * La ruta pública que le toca a cada propósito.
 *
 * Vive aquí, y no en `pendents.ts`, porque ese módulo importa el cliente de Supabase y
 * esto es una decisión pura que conviene poder probar. Es el respaldo del `url_path` que
 * ya devuelve la base: dos sitios que componen la misma ruta tienen que poder compararse.
 *
 * Equivocarla no da un error claro: un token de firma en la página de confirmación
 * responde «enlace desconocido», que parece un problema del token y no de la ruta.
 */
export function rutaPerProposit(proposito: ProposicPendent, token: string): string {
  return proposito === 'firma_convenio' ? `/signar/${token}` : `/confirmar/${token}`
}

/** Lo mínimo que hace falta de una fila de `documentos` para agrupar y etiquetar. */
export interface DocMinim {
  objeto_tipo: string
  objeto_id: string
  tipo: DocumentoTipo
  ejercicio: number | null
  vigente?: boolean
}

/**
 * Agrupa por ejercicio, del más reciente al más antiguo, y deja al final lo que no tiene
 * año. Un `null` no es «año 0»: es un documento que todavía no ha pedido su número (el
 * ejercicio se fija al emitir), así que ponerlo el primero lo haría parecer lo más nuevo.
 */
export function agrupaPerExercici<T extends { ejercicio: number | null }>(
  files: T[],
): { exercici: number | null; files: T[] }[] {
  const mapa = new Map<number | null, T[]>()
  for (const f of files) {
    const clau = f.ejercicio ?? null
    const llista = mapa.get(clau) ?? []
    llista.push(f)
    mapa.set(clau, llista)
  }
  return [...mapa.entries()]
    .map(([exercici, files]) => ({ exercici, files }))
    .sort((a, b) => {
      if (a.exercici === b.exercici) return 0
      if (a.exercici === null) return 1
      if (b.exercici === null) return -1
      return b.exercici - a.exercici
    })
}

/**
 * El PDF que vale hoy para un objeto. Se busca entre los que la RLS ya ha devuelto: el
 * panel nunca pregunta por un documento que no sea suyo.
 *
 * Prefiere el `vigente` explícito y, si no lo hay —porque quien llama no pidió esa
 * columna—, la primera coincidencia, que es como llegan ya ordenados por fecha.
 */
export function docVigent<T extends DocMinim>(
  docs: T[],
  objetoTipo: string,
  objetoId: string,
): T | undefined {
  const seus = docs.filter((d) => d.objeto_tipo === objetoTipo && d.objeto_id === objetoId)
  return seus.find((d) => d.vigente === true) ?? seus[0]
}

/**
 * La clave i18n del nombre de un tipo de documento. Devuelve una clave y no un texto
 * porque las pantallas son bilingües; las doce están en `i18n.tsx` (`doc.tipus_*`).
 */
export function etiquetaTipusDocument(tipo: DocumentoTipo): string {
  return `doc.tipus_${tipo}`
}

/**
 * Orden del circuito del convenio: el estado más avanzado es el que describe a la
 * organización. Estaba copiado en `useConveni.ts` y en `BadgeConveni.tsx`, y dos copias de
 * un orden son dos sitios donde se puede colar un estado nuevo en el lugar equivocado.
 */
export const ORDRE_CONVENI: ConvenioEstado[] = [
  'substituit', 'resolt', 'esborrany', 'retornat', 'pendent_firma', 'firmat', 'vigent',
]

/** El estado más avanzado de una lista de convenios, o null si no hay ninguno. */
export function estatConveniMesAvancat(
  files: { estado: ConvenioEstado }[],
): ConvenioEstado | null {
  let millor: ConvenioEstado | null = null
  for (const f of files) {
    if (!millor || ORDRE_CONVENI.indexOf(f.estado) > ORDRE_CONVENI.indexOf(millor)) {
      millor = f.estado
    }
  }
  return millor
}
