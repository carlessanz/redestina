// El estado de la barra de filtros de un listado, recordado por pantalla y organización en
// este navegador (`llegeixFiltresDesats`). Fase 6 de la revisión del 08-10-2026.
//
// ⚠️ Actualizaciones FUNCIONALES: «Neteja els filtres» cambia los valores y el rango seguidos,
//    y con `{ ...estat, … }` el segundo cambio partía del estado de antes del primero y
//    volvía a poner los filtros que se acababan de quitar. Lo destapó el E2E.

import { useCallback, useEffect, useRef, useState } from 'react'
import { desaFiltresLlistat, llegeixFiltresDesats, type ValorsFiltre } from '../lib/filtres'

export function useFiltresLlistat(clau: string | null) {
  const [estat, setEstat] = useState(() => llegeixFiltresDesats(clau))
  // Cambiar de organización (o de pantalla) recupera lo suyo, sin volver a guardarlo.
  const carregat = useRef(clau)
  useEffect(() => {
    if (carregat.current === clau) return
    carregat.current = clau
    setEstat(llegeixFiltresDesats(clau))
  }, [clau])
  useEffect(() => { if (carregat.current === clau) desaFiltresLlistat(clau, estat) }, [clau, estat])

  const setValors = useCallback((valors: ValorsFiltre) => setEstat((e) => ({ ...e, valors })), [])
  const setRang = useCallback((desDe: string, finsA: string) => setEstat((e) => ({ ...e, desDe, finsA })), [])
  return { valors: estat.valors, desDe: estat.desDe, finsA: estat.finsA, setValors, setRang }
}
