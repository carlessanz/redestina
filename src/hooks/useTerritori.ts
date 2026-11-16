// El catálogo de municipios ya leído para los filtros de los listados: comarca → provincias y
// código INE → nombre legible. Se carga una vez por sesión (`carregaMunicipis`); hasta que
// llega, los mapas van vacíos y los filtros de Provincia y Municipi simplemente no aparecen
// (sin opciones, `BarraFiltres` no pinta el desplegable).

import { useEffect, useMemo, useState } from 'react'
import { carregaMunicipis, nomLlegible, type Municipi } from '../lib/municipis'
import { provinciesPerComarca } from '../lib/territori'

export function useTerritori() {
  const [municipis, setMunicipis] = useState<Municipi[]>([])
  useEffect(() => {
    let viu = true
    void carregaMunicipis().then((m) => { if (viu) setMunicipis(m) })
    return () => { viu = false }
  }, [])
  return useMemo(() => {
    const noms = new Map(municipis.map((m) => [m.codi_ine, nomLlegible(m.nom)]))
    return {
      perComarca: provinciesPerComarca(municipis),
      /** El nombre como lo escribe la gente, o null si el código no está en el catálogo. */
      nomMunicipi: (ine: string | null | undefined) => (ine ? noms.get(ine) ?? null : null),
    }
  }, [municipis])
}
