// Elegir un municipio de la lista oficial, en vez de teclearlo libre.
//
// POR QUÉ (revisión funcional del 23-09-2026): el municipio escrito a mano da «Sant Cugat»,
// «St. Cugat del Vallès» y «SANT CUGAT» para el mismo sitio, y de ahí no se puede derivar
// ni la comarca ni la provincia ni el área de Redestina. Con el código INE sí.
//
// Es un campo de texto con sugerencias filtradas, no un `<select>` de 947 opciones: en un
// móvil un desplegable así es inmanejable. Se elige tocando una sugerencia; mientras no se
// elige ninguna, el valor sigue siendo el anterior. Desde el 17-11-2026 el campo es el
// genérico `CercadorOpcions` (también lo usan el producto de la oferta y la entidad del alta
// asistida); aquí solo quedan los municipios: se busca a partir de dos letras, en el nombre
// legible y en el oficial («Ametlla del Vallès, l'»), y como mucho ocho sugerencias.

import { useEffect, useMemo, useState } from 'react'
import { carregaMunicipis, nomLlegible } from '../lib/municipis'
import type { Municipi } from '../lib/municipis'
import { useT } from '../lib/i18n'
import CercadorOpcions, { type OpcioCercador } from './CercadorOpcions'

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

  useEffect(() => {
    let viu = true
    void carregaMunicipis().then((m) => { if (viu) setMunicipis(m) })
    return () => { viu = false }
  }, [])

  const opcions = useMemo<OpcioCercador[]>(
    () => municipis.map((m) => ({ valor: m.codi_ine, text: nomLlegible(m.nom), detall: m.comarca, claus: [m.nom] })),
    [municipis],
  )
  const actual = useMemo(() => municipis.find((m) => m.codi_ine === valor) ?? null, [municipis, valor])

  return (
    <div>
      <CercadorOpcions
        id={id}
        opcions={opcions}
        valor={valor}
        onChange={(codi) => onChange(municipis.find((m) => m.codi_ine === codi) ?? null)}
        invalid={invalid}
        placeholder={t('mun.placeholder')}
        minLletres={2}
        maxim={8}
        cercaDetall={false}
        detallSota={false}
      />
      {actual && <p className="mt-1 text-xs text-muted-foreground">{actual.comarca} · {actual.provincia}</p>}
    </div>
  )
}
