// El buscador predictivo de las listas largas del panel del equipo (19-11-2026): entidades,
// entidades productoras, productos y ofertas. Se escribe un trozo y se toca la sugerencia, en
// vez de recorrer un desplegable de cientos de filas.
//
// Es un envoltorio FINO de `CercadorOpcions` (que hace todo el trabajo: combobox accesible,
// sin acentos, el valor solo cambia al elegir): aquí solo se fija lo que repetían las
// pantallas —el `placeholder` por defecto, `valor` como string con '' = nada y `onChange`
// con el string elegido, como `Desplegable`, para que el cambio en cada pantalla sea mecánico—.
// Las opciones de una ficha salen de `opcioFitxa()` (`lib/opcionsSelector.ts`): nombre,
// municipio de detalle y NIF y razón social como claves de búsqueda.
//
// ⚠️ E2E: no es un `Desplegable`, así que `tria()` no sirve; `triaCercador()` de
//    `tests/e2e/ajuda.ts` escribe en el campo y pulsa la sugerencia.

import { useT } from '../lib/i18n'
import CercadorOpcions, { type OpcioCercador } from './CercadorOpcions'

interface Props {
  id: string
  opcions: readonly OpcioCercador[]
  /** El elegido, o '' si no hay ninguno. */
  valor: string
  /** El valor elegido ('' si se elige la opción vacía `buit`). */
  onChange: (valor: string) => void
  /** Por defecto, «Escriu per cercar…». */
  placeholder?: string
  /** Texto de la opción que vacía la elección («—», «Tots»). Sin él, no se puede vaciar. */
  buit?: string
  invalid?: boolean
  disabled?: boolean
  /** Enseña el detalle de la elegida debajo del campo (el municipio). Por defecto, sí. */
  detallSota?: boolean
  /** Deja el campo en blanco tras elegir (listas en las que se va añadiendo). */
  buidaEnTriar?: boolean
  className?: string
  'aria-label'?: string
  'data-testid'?: string
}

export default function SelectorEntitat({
  id, opcions, valor, onChange, placeholder, buit, invalid, disabled, detallSota, buidaEnTriar, className, ...aria
}: Props) {
  const { t } = useT()
  return (
    <CercadorOpcions
      id={id}
      opcions={opcions}
      valor={valor || null}
      onChange={(v) => onChange(v)}
      placeholder={placeholder ?? t('sel.placeholder')}
      buit={buit}
      invalid={invalid}
      disabled={disabled}
      detallSota={detallSota}
      buidaEnTriar={buidaEnTriar}
      className={className}
      aria-label={aria['aria-label']}
      data-testid={aria['data-testid']}
    />
  )
}
