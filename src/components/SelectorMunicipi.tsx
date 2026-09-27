// Elegir un municipio de la lista oficial, en vez de teclearlo libre.
//
// POR QUÉ (revisión funcional del 23-09-2026): el municipio escrito a mano da «Sant Cugat»,
// «St. Cugat del Vallès» y «SANT CUGAT» para el mismo sitio, y de ahí no se puede derivar
// ni la comarca ni la provincia ni el área de Redestina. Con el código INE sí.
//
// Es un campo de texto con sugerencias filtradas, no un `<select>` de 947 opciones: en un
// móvil un desplegable así es inmanejable. Se elige tocando una sugerencia; mientras no se
// elige ninguna, el valor sigue siendo el anterior.

import { useEffect, useMemo, useState } from 'react'
import { carregaMunicipis, nomLlegible, normalitza } from '../lib/municipis'
import type { Municipi } from '../lib/municipis'
import { Input } from '@/components/ui/input'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'

export default function SelectorMunicipi({
  id, valor, onChange, invalid,
}: {
  id: string
  /** Código INE elegido, o null. */
  valor: string | null
  onChange: (m: Municipi | null) => void
  invalid?: boolean
}) {
  const { t } = useT()
  const [municipis, setMunicipis] = useState<Municipi[]>([])
  const [text, setText] = useState('')
  const [obert, setObert] = useState(false)

  useEffect(() => {
    let viu = true
    void carregaMunicipis().then((m) => { if (viu) setMunicipis(m) })
    return () => { viu = false }
  }, [])

  const actual = useMemo(() => municipis.find((m) => m.codi_ine === valor) ?? null, [municipis, valor])

  // Cuando llega (o cambia) el valor elegido, el texto lo refleja.
  useEffect(() => {
    if (actual) setText(nomLlegible(actual.nom))
  }, [actual])

  const suggeriments = useMemo(() => {
    const q = normalitza(text)
    if (q.length < 2) return []
    return municipis
      .filter((m) => normalitza(nomLlegible(m.nom)).includes(q) || normalitza(m.nom).includes(q))
      .slice(0, 8)
  }, [municipis, text])

  return (
    <div className="relative">
      <Input
        id={id}
        name={id}
        autoComplete="off"
        aria-invalid={invalid}
        value={text}
        placeholder={t('mun.placeholder')}
        onChange={(e) => { setText(e.target.value); setObert(true) }}
        onFocus={() => setObert(true)}
        // Un poco de margen antes de cerrar: si no, el clic en una sugerencia llega tarde.
        onBlur={() => window.setTimeout(() => {
          setObert(false)
          // Lo escrito sin elegir no vale: se vuelve al municipio elegido (o a vacío).
          setText(actual ? nomLlegible(actual.nom) : '')
        }, 150)}
      />
      {actual && <p className="mt-1 text-xs text-muted-foreground">{actual.comarca} · {actual.provincia}</p>}
      {obert && suggeriments.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggeriments.map((m) => (
            <li key={m.codi_ine} role="option" aria-selected={m.codi_ine === valor}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-baseline justify-between gap-2 rounded px-2 py-2 text-left text-base hover:bg-accent md:text-sm',
                  m.codi_ine === valor && 'bg-accent',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(m)
                  setText(nomLlegible(m.nom))
                  setObert(false)
                }}
              >
                <span>{nomLlegible(m.nom)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{m.comarca}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
