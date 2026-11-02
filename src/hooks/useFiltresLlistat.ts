// El estado de la barra de filtros de un listado, recordado por pantalla y organización en
// este navegador (`llegeixFiltresDesats`). Fase 6 de la revisión del 08-10-2026.
//
// ⚠️ Actualizaciones FUNCIONALES: «Neteja els filtres» cambia los valores y el rango seguidos,
//    y con `{ ...estat, … }` el segundo cambio partía del estado de antes del primero y
//    volvía a poner los filtros que se acababan de quitar. Lo destapó el E2E.

import { useCallback, useEffect, useRef, useState } from 'react'
import { desaFiltresLlistat, llegeixFiltresDesats, type ValorsFiltre } from '../lib/filtres'

/**
 * `perDefecte`: los filtros con los que abre la pantalla cuando no hay nada recordado (P10 del
 * plan 1: «Entitats» abre con solo las activas). Quitarlos vale para la sesión; al volver,
 * se vuelve a abrir con ellos.
 */
export function useFiltresLlistat(clau: string | null, perDefecte?: ValorsFiltre) {
  const ambDefecte = (f: ReturnType<typeof llegeixFiltresDesats>) =>
    (perDefecte && Object.keys(f.valors).length === 0 && !f.desDe && !f.finsA ? { ...f, valors: perDefecte } : f)
  const [estat, setEstat] = useState(() => ambDefecte(llegeixFiltresDesats(clau)))
  // Cambiar de organización (o de pantalla) recupera lo suyo, sin volver a guardarlo.
  const carregat = useRef(clau)
  useEffect(() => {
    if (carregat.current === clau) return
    carregat.current = clau
    setEstat(ambDefecte(llegeixFiltresDesats(clau)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `perDefecte` es una constante de la pantalla
  }, [clau])
  useEffect(() => { if (carregat.current === clau) desaFiltresLlistat(clau, estat) }, [clau, estat])

  const setValors = useCallback((valors: ValorsFiltre) => setEstat((e) => ({ ...e, valors })), [])
  const setRang = useCallback((desDe: string, finsA: string) => setEstat((e) => ({ ...e, desDe, finsA })), [])
  return { valors: estat.valors, desDe: estat.desDe, finsA: estat.finsA, setValors, setRang }
}
