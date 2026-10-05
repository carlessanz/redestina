// Elegir la modalidad de UNA entrega entre las que ofrece la oferta (05-10-2026, D2).
//
// Lo usan el receptor al mostrar interés y el equipo al aprobar. Solo se pinta cuando la
// oferta tiene más de una: con una sola no hay nada que elegir y el formulario no debe
// preguntar. Es un `<select>` nativo dentro de un formulario (`name`), así que quien lo usa
// lo lee con `FormData` o con `onChange`.
//
// ⚠️ `text-base md:text-sm` no es estético: por debajo de 16 px iOS amplía la página al
//    enfocarlo y no la devuelve (§2, regla 1).

import { useT } from '../lib/i18n'
import type { Modalitat } from '../types'

export default function SelectorModalitat({
  id,
  name = 'modalitat',
  modalitats,
  valor,
  onCanvi,
  className = '',
  ambBuit = false,
  inicial = null,
}: {
  id?: string
  name?: string
  modalitats: readonly Modalitat[]
  /** Controlado si llega; si no, `defaultValue` con la que pidió el receptor o la primera. */
  valor?: Modalitat | ''
  onCanvi?: (m: Modalitat | '') => void
  className?: string
  /** Una opción vacía «tria» al principio: obliga a elegir en vez de aceptar la primera. */
  ambBuit?: boolean
  /** No controlado: la que sale marcada (la que pidió el receptor). */
  inicial?: Modalitat | null
}) {
  const { t } = useT()
  if (modalitats.length <= 1) return null
  const controlat = valor !== undefined
  return (
    <select
      id={id}
      name={name}
      required
      aria-label={t('mod.tria')}
      {...(controlat
        ? { value: valor, onChange: (e) => onCanvi?.(e.target.value as Modalitat | '') }
        : { defaultValue: inicial && modalitats.includes(inicial) ? inicial : ambBuit ? '' : modalitats[0], onChange: (e) => onCanvi?.(e.target.value as Modalitat | '') })}
      className={`h-8 rounded-md border border-input bg-background px-2 text-base md:text-sm ${className}`}
    >
      {ambBuit && <option value="" disabled>{t('mod.tria')}</option>}
      {modalitats.map((m) => <option key={m} value={m}>{t(`od.mod_${m}`)}</option>)}
    </select>
  )
}
