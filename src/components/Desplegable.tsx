// El desplegable de Redestina (03-11-2026). Uno solo, para toda la aplicación: el `Select` de
// shadcn (Radix) con los tokens del sistema de diseño, en vez del `<select>` nativo, que en Mac
// y en Windows se pinta a su manera —borde azul del sistema, flecha propia, altura distinta en
// cada navegador— y era lo que Carles veía «feo» en los filtros.
//
// La API imita la del `<select>` nativo para que migrar sea mecánico: `value` es un string,
// `onChange` recibe el string elegido y `''` significa «nada». Sin `value`, va sin controlar
// con `defaultValue` (para los formularios que se leen con `FormData` por su `name`). Radix NO admite un ítem con valor
// vacío, así que la opción vacía (`buit`, p. ej. «Tots» o «— Tria —») viaja con un centinela
// interno y sale de aquí otra vez como `''`.
//
// Se abre DEBAJO del control (`position="popper"`), como un menú, y no tapándolo (el modo
// por defecto de Radix imita al de macOS). Con `name`, el valor viaja en un `<form>` por un
// `<input hidden>` propio y no por el `<select>` oculto de Radix, que mandaría el centinela.
// Una opción vacía que NO se puede elegir («— Tria —» con `disabled`) es `placeholder`, no `buit`.
//
// ⚠️ Las E2E no pueden usar `selectOption` (eso es solo para `<select>` nativos): `tria()` de
// `tests/e2e/ajuda.ts` abre el control y pulsa la opción por su valor (`data-valor`), su texto
// o su posición.

import { Fragment, useState } from 'react'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface OpcioDesplegable {
  valor: string
  text: string
  disabled?: boolean
  /** Agrupa las opciones consecutivas con el mismo grupo bajo un título (`<optgroup>`). */
  grup?: string
}

interface Props {
  id?: string
  /** Controlado. Sin él, no controlado con `defaultValue`. */
  value?: string
  defaultValue?: string
  onChange?: (valor: string) => void
  opcions: readonly OpcioDesplegable[]
  /** Texto de la opción vacía, elegible (`''`): «Tots», «— Tria —»… Sin él, no hay opción vacía. */
  buit?: string
  /** Lo que se lee cuando no hay valor y tampoco hay opción vacía. */
  placeholder?: string
  disabled?: boolean
  required?: boolean
  name?: string
  /** `sm` para filtros y barras; `default` para formularios. */
  mida?: 'sm' | 'default'
  className?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  'data-testid'?: string
}

const BUIT = '__buit__'

export default function Desplegable({
  id, value, defaultValue, onChange, opcions, buit, placeholder, disabled, required, name, mida = 'default', className, ...aria
}: Props) {
  // Agrupar por `grup` sin reordenar: un bloque por cada tramo consecutivo.
  const trams: { grup?: string; opcions: OpcioDesplegable[] }[] = []
  // Una opción con valor '' rompe Radix (lanza al pintarla): la vacía es `buit`, no una opción.
  for (const o of opcions.filter((x) => x.valor !== '')) {
    const darrer = trams[trams.length - 1]
    if (darrer && darrer.grup === o.grup) darrer.opcions.push(o)
    else trams.push({ grup: o.grup, opcions: [o] })
  }
  const intern = (v: string) => (v === '' && buit !== undefined ? BUIT : v)
  // El valor vigente, también sin controlar: lo necesita el `<input hidden>` del formulario.
  const [propi, setPropi] = useState(defaultValue ?? '')
  const actual = value ?? propi

  return (
    <>
      <Select
        value={intern(actual)}
        onValueChange={(v) => {
          const net = v === BUIT ? '' : v
          setPropi(net)
          onChange?.(net)
        }}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger id={id} size={mida} className={cn('w-full min-w-0', className)} {...aria}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-80">
          {buit !== undefined && <SelectItem value={BUIT} data-valor="">{buit}</SelectItem>}
          {trams.map((tram, i) => (
            <Fragment key={`${tram.grup ?? ''}-${i}`}>
              {tram.grup !== undefined ? (
                <SelectGroup>
                  {(i > 0 || buit !== undefined) && <SelectSeparator />}
                  <SelectLabel>{tram.grup}</SelectLabel>
                  {tram.opcions.map((o) => (
                    <SelectItem key={o.valor} value={o.valor} disabled={o.disabled} data-valor={o.valor}>{o.text}</SelectItem>
                  ))}
                </SelectGroup>
              ) : tram.opcions.map((o) => (
                <SelectItem key={o.valor} value={o.valor} disabled={o.disabled} data-valor={o.valor}>{o.text}</SelectItem>
              ))}
            </Fragment>
          ))}
        </SelectContent>
      </Select>
      {name && <input type="hidden" name={name} value={actual} />}
    </>
  )
}
