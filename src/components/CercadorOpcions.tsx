// Un campo de texto con SUGERENCIAS para elegir de una lista (17-11-2026, fase A del punto 3).
//
// Generaliza lo que hacía `SelectorMunicipi` —que ahora lo usa por debajo—: con listas largas
// (productos, entidades productoras, municipios) un desplegable obliga a recorrerlas; aquí se
// escribe un trozo y se toca la sugerencia. La comparación no distingue acentos ni mayúsculas
// (`senseAccents`): «carbasso» encuentra «Carbassó».
//
// Reglas, las mismas que tenía el selector de municipios:
//   · el valor solo cambia al ELEGIR una sugerencia (clic, o flechas + Intro);
//   · al perder el foco sin elegir, el texto vuelve al de la opción elegida (o se vacía);
//   · `detall` es la segunda línea corta de cada opción (la familia de un producto, la comarca
//     de un municipio) y también se busca en ella, salvo `cercaDetall={false}`.
//
// Accesible como combobox: `role="combobox"` en el campo, `listbox`/`option` en la lista y la
// opción activa en `aria-activedescendant`. Texto a 16 px en móvil (`Input` ya lo trae).
//
// 19-11-2026 (buscadores predictivos del panel del equipo, `SelectorEntitat` y `BarraFiltres`):
//   · `buit` añade arriba de la lista una opción que vacía la elección («Tots», «—»); solo
//     sale sin teclear, para que Intro tras escribir elija la primera coincidencia;
//   · `buidaEnTriar` deja el campo en blanco tras elegir (modo «añadir»: la lista de
//     productos habituales, donde lo elegido se pinta aparte como chip);
//   · `className` llega al campo (p. ej. `md:h-7` en la barra de filtros).

import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '../lib/utils'
import { senseAccents } from '../lib/cerca'

export interface OpcioCercador {
  valor: string
  text: string
  /** Segunda línea corta, a la derecha de la sugerencia (y bajo el campo una vez elegida). */
  detall?: string
  /** Más textos en los que buscar, que no se enseñan (p. ej. el nombre oficial de un municipio). */
  claus?: readonly string[]
}

export interface PropsCercadorOpcions {
  id: string
  /** El `name` del campo de texto; por defecto, el `id`. */
  name?: string
  opcions: readonly OpcioCercador[]
  /** El `valor` elegido, o '' / null si no hay ninguno. */
  valor: string | null
  /** Se llama solo al elegir una sugerencia. */
  onChange: (valor: string, opcio: OpcioCercador) => void
  invalid?: boolean
  placeholder?: string
  disabled?: boolean
  /** Cuántas letras hacen falta antes de sugerir (0 = con el foco ya se ve la lista). */
  minLletres?: number
  /** Cuántas sugerencias como mucho. */
  maxim?: number
  /** ¿Se busca también en `detall`? Por defecto, sí. */
  cercaDetall?: boolean
  /** Enseña el `detall` de la opción elegida debajo del campo. Por defecto, sí. */
  detallSota?: boolean
  /** Texto de una opción que vacía la elección (`onChange('')`): «Tots», «—». Sin él, no la hay. */
  buit?: string
  /** Tras elegir, el campo se queda en blanco (para listas en las que se va añadiendo). */
  buidaEnTriar?: boolean
  /** Clases extra del campo de texto. */
  className?: string
  'aria-label'?: string
  'data-testid'?: string
}

export default function CercadorOpcions({
  id, name, opcions, valor, onChange, invalid, placeholder, disabled,
  minLletres = 0, maxim = 50, cercaDetall = true, detallSota = true, buit, buidaEnTriar = false, className, ...aria
}: PropsCercadorOpcions) {
  const triada = useMemo(
    () => (valor ? opcions.find((o) => o.valor === valor) ?? null : null),
    [opcions, valor],
  )
  const [text, setText] = useState(triada?.text ?? '')
  const [obert, setObert] = useState(false)
  /** Lo escrito desde el último foco: sin teclear, se sugiere todo (no solo lo que ya hay). */
  const [escrit, setEscrit] = useState(false)
  const [actiu, setActiu] = useState(0)

  // Cuando cambia lo elegido (o llegan las opciones), el texto lo refleja.
  useEffect(() => { setText(triada?.text ?? '') }, [triada?.text])

  const suggeriments = useMemo(() => {
    // Sin teclear desde el foco, la lista entera; con un mínimo de letras (municipios), lo que
    // haya en el campo, como hacía el selector de municipios.
    const q = escrit || minLletres > 0 ? senseAccents(text) : ''
    if (q.length < minLletres) return []
    const casa = (o: OpcioCercador) => [o.text, ...(cercaDetall && o.detall ? [o.detall] : []), ...(o.claus ?? [])]
      .some((c) => senseAccents(c).includes(q))
    const trobades = (q ? opcions.filter(casa) : opcions).slice(0, maxim)
    // La opción vacía, solo sin consulta: con algo escrito, Intro elige la primera coincidencia.
    return buit !== undefined && !q ? [{ valor: '', text: buit }, ...trobades] : trobades
  }, [opcions, text, escrit, minLletres, maxim, cercaDetall, buit])

  const llista = `${id}-llista`
  const visible = obert && !disabled && suggeriments.length > 0

  function tria(o: OpcioCercador) {
    onChange(o.valor, o)
    // La opción vacía deja el campo en blanco (se lee el `placeholder`), igual que el modo «añadir».
    setText(o.valor === '' || buidaEnTriar ? '' : o.text)
    setObert(false)
    setEscrit(false)
  }

  return (
    <div className="relative min-w-0">
      <Input
        id={id}
        name={name ?? id}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={llista}
        aria-activedescendant={visible ? `${id}-op-${actiu}` : undefined}
        aria-invalid={invalid}
        aria-label={aria['aria-label']}
        data-testid={aria['data-testid']}
        disabled={disabled}
        className={className}
        value={text}
        placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); setEscrit(true); setObert(true); setActiu(0) }}
        onFocus={() => { setObert(true); setEscrit(false); setActiu(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setObert(true); setActiu((i) => Math.min(i + 1, suggeriments.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiu((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' && visible) { e.preventDefault(); const o = suggeriments[actiu]; if (o) tria(o) }
          else if (e.key === 'Escape') { setObert(false) }
        }}
        // Un poco de margen antes de cerrar: si no, el clic en una sugerencia llega tarde.
        onBlur={() => window.setTimeout(() => {
          setObert(false)
          setEscrit(false)
          // Lo escrito sin elegir no vale: se vuelve a lo elegido (o a vacío).
          setText(triada?.text ?? '')
        }, 150)}
      />
      {detallSota && triada?.detall && <p className="mt-1 text-xs text-muted-foreground">{triada.detall}</p>}
      {visible && (
        <ul
          id={llista}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggeriments.map((o, i) => (
            <li key={o.valor} id={`${id}-op-${i}`} role="option" aria-selected={o.valor === (valor ?? '')}
              data-valor={o.valor}>
              <button
                type="button"
                tabIndex={-1}
                className={cn(
                  'flex w-full min-w-0 items-baseline justify-between gap-2 rounded px-2 py-2 text-left text-base hover:bg-accent md:text-sm',
                  (o.valor === (valor ?? '') || i === actiu) && 'bg-accent',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiu(i)}
                onClick={() => tria(o)}
              >
                <span className="min-w-0 break-words">{o.text}</span>
                {o.detall && <span className="shrink-0 text-xs text-muted-foreground">{o.detall}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
