// Elegir la modalidad de UNA entrega entre las que ofrece la oferta (05-10-2026, D2).
//
// Lo usan el receptor al mostrar interés y el equipo al aprobar. Solo se pinta cuando la
// oferta tiene más de una: con una sola no hay nada que elegir y el formulario no debe
// preguntar. Es un `Desplegable` (el `Select` de shadcn, desde el 03-11-2026; antes un
// `<select>` nativo) que manda su valor con `name` por un `<input hidden>`, así que quien lo
// usa lo lee con `FormData` o con `onCanvi`. La opción vacía de `ambBuit` no se puede
// elegir: es el `placeholder` del desplegable, no una opción.
//
// La altura y el `text-base md:text-sm` (§2, regla 1) ya los trae el desplegable; el
// `className` de quien lo usa es para el ancho.

import { useT } from '../lib/i18n'
import Desplegable from './Desplegable'
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
  const opcions = modalitats.map((m) => ({ valor: m, text: t(`od.mod_${m}`) }))
  return (
    <Desplegable
      id={id}
      name={name}
      required
      aria-label={t('mod.tria')}
      opcions={opcions}
      placeholder={ambBuit ? t('mod.tria') : undefined}
      {...(controlat
        ? { value: valor }
        : { defaultValue: inicial && modalitats.includes(inicial) ? inicial : ambBuit ? '' : modalitats[0] })}
      onChange={(v) => onCanvi?.(v as Modalitat | '')}
      className={className}
    />
  )
}
