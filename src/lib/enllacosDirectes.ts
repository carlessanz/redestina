// Los enlaces directos que viajan en los mensajes (fase 4 de los puntos 4-6, Excel 4.2 y 5.4):
// a la oferta del Mercat con el formulario de interés abierto, a la operación con «Registra la
// recollida» desplegado y, para el equipo, a la ficha de la oferta con la acción que toca.
//
// Las rutas y los parámetros son los que leen las pantallas (`useDialegPerUrl`): si cambian,
// cambian aquí y en ellas a la vez. Puro: lo prueba `tests/enllacosDirectes.test.ts`.

/** Quita la barra final del origen (`https://x/` → `https://x`). */
function origen(appUrl: string): string {
  return appUrl.replace(/\/+$/, '')
}

/** `/receptor/mercat?oferta=<id>&accio=interes`: la oferta, con el formulario de interés. */
export function rutaInteresOferta(excedenteId: string): string {
  return `/receptor/mercat?oferta=${encodeURIComponent(excedenteId)}&accio=interes`
}

/** La misma, absoluta: es lo que va dentro del texto que se copia o se comparte. */
export function enllacInteresOferta(appUrl: string, excedenteId: string): string {
  return `${origen(appUrl)}${rutaInteresOferta(excedenteId)}`
}

/**
 * Registrar los kilos reales de una recogida. Con UNA canalización viva, a esa operación con el
 * formulario abierto; con varias (el mensaje va a un grupo y no se sabe quién lo abre), a la
 * lista de «Els meus interessos», donde cada entidad ve la suya.
 */
export function rutaRegistreRecollida(canalitzacioIds: readonly string[]): string {
  return canalitzacioIds.length === 1
    ? `/receptor/interessos?operacio=${encodeURIComponent(canalitzacioIds[0])}&accio=recollida`
    : '/receptor/interessos'
}

export function enllacRegistreRecollida(appUrl: string, canalitzacioIds: readonly string[]): string {
  return `${origen(appUrl)}${rutaRegistreRecollida(canalitzacioIds)}`
}

/** Equipo: la ficha de la oferta con el formulario «Assigna l’oferta» a la vista. */
export function rutaAssignaOferta(excedenteId: string): string {
  return `/equip/ofertes/${encodeURIComponent(excedenteId)}?accio=assigna`
}

/** Equipo: la ficha de la oferta con «Registrar la recollida» de esa canalización abierto. */
export function rutaRecollidaEquip(excedenteId: string, canalitzacioId: string): string {
  return `/equip/ofertes/${encodeURIComponent(excedenteId)}?accio=recollida&canalitzacio=${encodeURIComponent(canalitzacioId)}`
}

/**
 * El texto de la oferta para copiarlo a mano, con el cierre que se puede cumplir fuera de la
 * conversación del bot: con enlace (a la oferta del Mercat) o pidiendo que responda. Vive en el
 * servidor (`_shared/textOferta.ts`, módulo hoja): se importa, no se copia (§7).
 */
export { textOfertaPerCopiar } from '../../supabase/functions/_shared/textOferta.ts'
