// «Entrades i sortides» (punto 6.7 del Excel de la Fundació, 20-11-2026): la vista global de
// las SALIDAS de producto, la hoja «Aprofitat» del Excel ARA con el que trabaja hoy el equipo.
//
//   · «Sortides»: una fila por salida de un ofertante a un receptor (una canalización), sin
//     agrupar, paginada en el servidor de 25 en 25 y por fecha de salida, la más reciente arriba.
//     Clicar la fila abre la ficha de la operación (`?canalitzacio=<id>`, para poder compartirla).
//   · «Resum»: los indicadores agrupados (`?per=`): por entidad productora, receptora, producto,
//     modalidad, tipus d'operació, mes, zona o estado, con los kilos recogidos de cada modalidad.
//   · «Exporta a Excel»: TODO lo filtrado, en páginas de 1.000, y la agrupación del Resum.
//
// Espigoladors no aparece como intermediaria: la fila va del ofertante al receptor. Las ofertas
// sin ninguna salida no salen (se consultan en «Ofertes»). Los datos los dan dos RPC del equipo
// (`entrades_sortides`, `entrades_sortides_resum`; migración 20270612100000) con los MISMOS
// diez filtros; la lógica pura (filtros → argumentos, etiquetas, Excel) vive en `lib/sortides.ts`.
//
// FASE 4 (25-11-2026): la modalidad es la REAL (donació · venda · maquila) y el TIPUS D'OPERACIÓ
// (excedent ja collit · espigolada) es un filtro propio (`p_tipus_operacio`), también desde la URL
// (`?tipus=espigolada`, al llegar), una agrupación del Resum y una columna del Excel.
//
// Patrones copiados del Històric de `OffersList`: la página va atada a la clave de los filtros
// (cambiar un filtro vuelve a la 1 sin un efecto que la resetee), el buscador va al servidor con
// espera y cada petición lleva su número para que una respuesta lenta no pise a una nueva.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, FileDown } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { avuiLocal, kg, nombre } from '../../lib/format'
import { descarregarBlob } from '../../lib/tancament'
import { nombrePagines, textPagina } from '../../lib/llistatOfertes'
import {
  AGRUPACIONS_SORTIDES, ESTATS_SORTIDA, MIDA_PAGINA_SORTIDES, MODALITATS_SORTIDA, PAGINA_EXPORTACIO_SORTIDES,
  TIPUS_OPERACIO, ambFiltres, argsFiltres, blobSortides, clauAgrupacio, clauError, clauEstat, clauModalitat,
  clauTipusOperacio, esTipusOperacio,
  llegeixAgrupacio, llegeixEntrades, llegeixPestanyaSortides, llegeixResum, nomFitxerSortides,
  opcionsDeGrups, rangInvertit,
  type ArgsFiltresSortides, type OpcionsFiltre, type PestanyaSortides,
} from '../../lib/sortides'
import type { AgrupacioSortides, EntradesSortides as Pagina, FilaSortida, ResumSortides } from '../../types'
import { useFiltresLlistat } from '../../hooks/useFiltresLlistat'
import { useCerca } from '../../hooks/useCerca'
import { useDialegPerUrl } from '../../hooks/useDialegPerUrl'
import BarraFiltres from '../../components/BarraFiltres'
import Desplegable from '../../components/Desplegable'
import CarregantSeccio from '../../components/CarregantSeccio'
import FranjaXifres from '../../components/sortides/FranjaXifres'
import TaulaSortides from '../../components/sortides/TaulaSortides'
import TaulaResum from '../../components/sortides/TaulaResum'
import DialegSortida from '../../components/sortides/DialegSortida'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/** La espera del buscador antes de preguntar al servidor (la del Històric de Ofertes). */
const ESPERA_CERCA_MS = 300

/** Las dimensiones con opciones de la base (las demás son listas fijas). */
const DIMS_AMB_OPCIONS = ['ofertant', 'receptor', 'producte', 'zona'] as const
type DimOpcions = typeof DIMS_AMB_OPCIONS[number]
/** El `p_per` del resumen que da las opciones de cada dimensión. */
const PER_DE_DIM: Record<DimOpcions, AgrupacioSortides> = {
  ofertant: 'ofertant', receptor: 'receptor', producte: 'producte', zona: 'zona',
}

const OPCIONS_BUIDES: Record<DimOpcions, OpcionsFiltre> = {
  ofertant: { valors: [], noms: {} },
  receptor: { valors: [], noms: {} },
  producte: { valors: [], noms: {} },
  zona: { valors: [], noms: {} },
}

/** Una página de salidas. Nunca lanza. */
async function carregaPagina(args: ArgsFiltresSortides, pagina: number, mida: number): Promise<{ ok: true; dades: Pagina } | { ok: false; missatge: string }> {
  try {
    const { data, error } = await supabase.rpc('entrades_sortides', { ...args, p_limit: mida, p_offset: pagina * mida })
    if (error) return { ok: false, missatge: error.message ?? '' }
    return { ok: true, dades: llegeixEntrades(data) }
  } catch (e) {
    return { ok: false, missatge: e instanceof Error ? e.message : String(e) }
  }
}

/** El resumen agrupado. Nunca lanza. */
async function carregaResum(args: ArgsFiltresSortides | null, per: AgrupacioSortides): Promise<{ ok: true; dades: ResumSortides } | { ok: false; missatge: string }> {
  try {
    const { data, error } = await supabase.rpc('entrades_sortides_resum', { ...(args ?? {}), p_per: per })
    if (error) return { ok: false, missatge: error.message ?? '' }
    return { ok: true, dades: llegeixResum(data) }
  } catch (e) {
    return { ok: false, missatge: e instanceof Error ? e.message : String(e) }
  }
}

export default function EntradesSortides() {
  const { t } = useT()

  // --- La pestaña y la agrupación, en la URL ------------------------------------------------
  const [params, setParams] = useSearchParams()
  const pestanya = llegeixPestanyaSortides(params.get('pestanya'))
  const per = llegeixAgrupacio(params.get('per'))
  const posaParam = (clau: string, valor: string | null) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev)
      if (valor) n.set(clau, valor)
      else n.delete(clau)
      return n
    }, { replace: true, preventScrollReset: true })
  }
  // Los valores por defecto no se escriben: la URL limpia es la pestaña «Sortides».
  const canviaPestanya = (v: string) => {
    const p: PestanyaSortides = llegeixPestanyaSortides(v)
    posaParam('pestanya', p === 'sortides' ? null : p)
  }

  // --- La ficha de una salida, en la URL (`?canalitzacio=`) ----------------------------------
  const dialeg = useDialegPerUrl(['canalitzacio'] as const)
  const canalOberta = dialeg.valors.canalitzacio

  // --- Filtros y buscador --------------------------------------------------------------------
  const f = useFiltresLlistat('equip-entrades-sortides')
  // `?tipus=` fija el tipus d'operació al llegar (como `?rol=` en Entitats): un enlace a «solo las
  // espigolades» abre filtrado. Después manda la barra, y el parámetro se quita de la URL para que
  // «Neteja els filtres» no se contradiga con ella.
  const tipusUrl = params.get('tipus')
  useEffect(() => {
    if (tipusUrl === null) return
    if (esTipusOperacio(tipusUrl)) f.setValors({ ...f.valors, tipus_operacio: tipusUrl })
    posaParam('tipus', null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al llegar con `?tipus=`
  }, [tipusUrl])
  const { cerca, setCerca } = useCerca()
  const [cercaServ, setCercaServ] = useState(cerca)
  useEffect(() => {
    const id = setTimeout(() => setCercaServ(cerca), ESPERA_CERCA_MS)
    return () => clearTimeout(id)
  }, [cerca])
  const args = useMemo(
    () => argsFiltres({ valors: f.valors, desDe: f.desDe, finsA: f.finsA, cerca: cercaServ }),
    [f.valors, f.desDe, f.finsA, cercaServ],
  )
  const clauArgs = JSON.stringify(args)
  const invertit = rangInvertit(args)
  const filtrat = ambFiltres(args)
  // Sube tras un cambio en la ficha (registrar una recogida): las dos pestañas se releen.
  const [versio, setVersio] = useState(0)
  const recarrega = useCallback(() => setVersio((v) => v + 1), [])

  // --- Las opciones de los filtros: el resumen SIN filtros por cada dimensión ----------------
  const [opcions, setOpcions] = useState<Record<DimOpcions, OpcionsFiltre>>(OPCIONS_BUIDES)
  const [totalSenseFiltres, setTotalSenseFiltres] = useState(0)
  useEffect(() => {
    let viu = true
    void Promise.all(DIMS_AMB_OPCIONS.map((d) => carregaResum(null, PER_DE_DIM[d]))).then((rs) => {
      if (!viu) return
      const nous = { ...OPCIONS_BUIDES }
      rs.forEach((r, i) => { if (r.ok) nous[DIMS_AMB_OPCIONS[i]] = opcionsDeGrups(r.dades.grups) })
      setOpcions(nous)
      const primer = rs.find((r) => r.ok)
      if (primer?.ok) setTotalSenseFiltres(primer.dades.total.sortides)
    })
    return () => { viu = false }
  }, [versio])

  // --- «Sortides»: la página, atada a la clave de los filtros --------------------------------
  const [paginaFiltres, setPaginaFiltres] = useState({ clau: clauArgs, n: 0 })
  const pagina = paginaFiltres.clau === clauArgs ? paginaFiltres.n : 0
  const anaAPagina = (n: number) => setPaginaFiltres({ clau: clauArgs, n })
  const [dades, setDades] = useState<Pagina | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const peticio = useRef(0)

  useEffect(() => {
    if (pestanya !== 'sortides') return
    const meva = ++peticio.current
    if (invertit) { setErrorKey('sort.err_periode'); setCarregant(false); return }
    setErrorKey(null)
    setCarregant(true)
    void carregaPagina(JSON.parse(clauArgs) as ArgsFiltresSortides, pagina, MIDA_PAGINA_SORTIDES).then((r) => {
      if (meva !== peticio.current) return
      if (!r.ok) { setErrorKey(clauError(r.missatge)); setDades(null); setCarregant(false); return }
      // La página se ha quedado más allá del final (algo se ha anulado): a la última.
      if (r.dades.files.length === 0 && pagina > 0 && r.dades.total > 0) {
        setPaginaFiltres({ clau: clauArgs, n: nombrePagines(r.dades.total, MIDA_PAGINA_SORTIDES) - 1 })
        return
      }
      setErrorKey(null)
      setDades(r.dades)
      setCarregant(false)
    })
  }, [pestanya, clauArgs, invertit, pagina, versio])

  // --- «Resum» -------------------------------------------------------------------------------
  const [resum, setResum] = useState<ResumSortides | null>(null)
  const [carregantResum, setCarregantResum] = useState(true)
  const [errorResum, setErrorResum] = useState<string | null>(null)
  const peticioResum = useRef(0)
  useEffect(() => {
    if (pestanya !== 'resum') return
    const meva = ++peticioResum.current
    if (invertit) { setErrorResum('sort.err_periode'); setCarregantResum(false); return }
    setErrorResum(null)
    setCarregantResum(true)
    void carregaResum(JSON.parse(clauArgs) as ArgsFiltresSortides, per).then((r) => {
      if (meva !== peticioResum.current) return
      if (!r.ok) { setErrorResum(clauError(r.missatge)); setResum(null); setCarregantResum(false); return }
      setErrorResum(null)
      setResum(r.dades)
      setCarregantResum(false)
    })
  }, [pestanya, clauArgs, invertit, per, versio])

  // --- Exporta a Excel -----------------------------------------------------------------------
  const [exportant, setExportant] = useState(false)
  async function exporta() {
    if (invertit) { toast.error(t('sort.err_periode')); return }
    setExportant(true)
    const id = toast.loading(t('sort.export_inici'))
    try {
      // Todo lo filtrado, de 1.000 en 1.000 hasta el total (la RPC no da más por petición).
      const files: FilaSortida[] = []
      for (let p = 0; p < 1000; p++) {
        const r = await carregaPagina(args, p, PAGINA_EXPORTACIO_SORTIDES)
        if (!r.ok) { toast.error(t('sort.export_err'), { id }); return }
        files.push(...r.dades.files)
        if (r.dades.files.length < PAGINA_EXPORTACIO_SORTIDES || files.length >= r.dades.total) break
      }
      if (files.length === 0) { toast.info(t('sort.export_buit'), { id }); return }
      // La segunda hoja: la agrupación del Resum si se está en él; si no, por modalidad.
      const perExcel: AgrupacioSortides = pestanya === 'resum' ? per : 'modalitat'
      const rr = await carregaResum(args, perExcel)
      if (!rr.ok) { toast.error(t('sort.export_err'), { id }); return }
      const blob = await blobSortides(files, rr.dades, perExcel, t)
      if (!blob) { toast.error(t('sort.export_err'), { id }); return }
      descarregarBlob(nomFitxerSortides(avuiLocal()), blob)
      toast.success(t('sort.export_ok', { n: files.length }), { id })
    } finally {
      setExportant(false)
    }
  }

  // --- Lo que se pinta -----------------------------------------------------------------------
  const files = dades?.files ?? []
  const fila = canalOberta ? files.find((x) => x.canalizacion_id === canalOberta) : undefined
  const total = dades?.total ?? 0
  const nPagines = nombrePagines(total, MIDA_PAGINA_SORTIDES)
  const pag = textPagina(pagina, files.length, total, MIDA_PAGINA_SORTIDES)
  const buitKey = filtrat ? 'sort.no_match' : 'sort.empty'
  const mostrant = pestanya === 'resum' ? (resum?.total.sortides ?? 0) : total

  const textOpcio = (d: DimOpcions) => (v: string) => opcions[d].noms[v] ?? v

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle>{t('sort.title')}</CardTitle>
          <Button variant="outline" className="h-11 shrink-0 whitespace-nowrap md:h-8" onClick={() => void exporta()}
            disabled={exportant} data-testid="es-exporta">
            <FileDown className="size-4" aria-hidden /> {t('sort.exporta')}
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('sort.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input type="search" placeholder={t('sort.search')} value={cerca} onChange={(e) => setCerca(e.target.value)}
          aria-label={t('sort.search')} data-testid="es-cerca" />
        <BarraFiltres
          id="es"
          desplegables={[
            { clau: 'ofertant', etiquetaKey: 'fl.d_ofertant', opcions: opcions.ofertant.valors, text: textOpcio('ofertant'), cercador: true },
            { clau: 'receptor', etiquetaKey: 'sort.f_receptor', opcions: opcions.receptor.valors, text: textOpcio('receptor'), cercador: true },
            { clau: 'producte', etiquetaKey: 'fl.d_producte', opcions: opcions.producte.valors, text: textOpcio('producte'), cercador: true },
            { clau: 'zona', etiquetaKey: 'fl.d_comarca', opcions: opcions.zona.valors, text: textOpcio('zona'), cercador: true },
            { clau: 'modalitat', etiquetaKey: 'fl.d_modalitat', opcions: [...MODALITATS_SORTIDA], text: (v: string) => t(clauModalitat(v)), cercador: false },
            { clau: 'tipus_operacio', etiquetaKey: 'fl.d_tipus_operacio', opcions: [...TIPUS_OPERACIO], text: (v: string) => t(clauTipusOperacio(v)), cercador: false },
            { clau: 'estat', etiquetaKey: 'fl.d_estat', opcions: [...ESTATS_SORTIDA], text: (v: string) => t(clauEstat(v)), cercador: false },
          ]}
          valors={f.valors}
          onValors={f.setValors}
          rang={{ etiquetaKey: 'sort.r_data', desDe: f.desDe, finsA: f.finsA, onCanvi: f.setRang }}
          mostrant={mostrant}
          total={totalSenseFiltres}
        />

        <Tabs value={pestanya} onValueChange={canviaPestanya}>
          {/* Dos pestañas cortas: caben a 360 px sin la lista que scrollea de Ofertes. */}
          <TabsList>
            <TabsTrigger value="sortides" data-testid="es-tab-sortides">{t('sort.tab_sortides')}</TabsTrigger>
            <TabsTrigger value="resum" data-testid="es-tab-resum">{t('sort.tab_resum')}</TabsTrigger>
          </TabsList>

          <TabsContent value="sortides" className="space-y-4">
            {errorKey ? (
              <p className="text-sm text-error" role="alert">{t(errorKey)}</p>
            ) : !dades ? (
              <CarregantSeccio files={5} ambCapcalera={false} />
            ) : (
              <>
                <FranjaXifres carregant={carregant} xifres={[
                  { clau: 'sortides', etiqueta: t('sort.x_sortides'), valor: nombre(dades.total, 0) },
                  { clau: 'kg_sortida', etiqueta: t('sort.x_kg_sortida'), valor: `${kg(dades.kg_sortida)} kg` },
                  { clau: 'kg_recollits', etiqueta: t('sort.x_kg_recollits'), valor: `${kg(dades.kg_recollits)} kg` },
                ]} />
                <TaulaSortides files={files} buitKey={buitKey} carregant={carregant}
                  onObre={(x) => dialeg.obre({ canalitzacio: x.canalizacion_id })} />
                {total > MIDA_PAGINA_SORTIDES && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2" data-testid="es-paginacio">
                    <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                      {t('off.pag_rang', { a: pag.a, b: pag.b, total: pag.total })}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" className="h-11 shrink-0 whitespace-nowrap md:h-8" disabled={pagina === 0 || carregant}
                        onClick={() => anaAPagina(pagina - 1)}>
                        <ChevronLeft className="size-4" aria-hidden /> {t('off.pag_anterior')}
                      </Button>
                      <Button variant="outline" className="h-11 shrink-0 whitespace-nowrap md:h-8" disabled={pagina >= nPagines - 1 || carregant}
                        onClick={() => anaAPagina(pagina + 1)}>
                        {t('off.pag_seguent')} <ChevronRight className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="resum" className="space-y-4">
            <div className="min-w-0 space-y-1 md:w-56">
              <label htmlFor="es-per" className="text-xs text-muted-foreground">{t('sort.agrupa')}</label>
              <Desplegable id="es-per" mida="sm" value={per}
                onChange={(v) => posaParam('per', llegeixAgrupacio(v))}
                opcions={AGRUPACIONS_SORTIDES.map((a) => ({ valor: a, text: t(clauAgrupacio(a)) }))} />
            </div>
            {errorResum ? (
              <p className="text-sm text-error" role="alert">{t(errorResum)}</p>
            ) : !resum ? (
              <CarregantSeccio files={5} ambCapcalera={false} />
            ) : (
              <>
                <FranjaXifres carregant={carregantResum} xifres={[
                  { clau: 'sortides', etiqueta: t('sort.x_sortides'), valor: nombre(resum.total.sortides, 0) },
                  { clau: 'kg_sortida', etiqueta: t('sort.x_kg_sortida'), valor: `${kg(resum.total.kg_sortida)} kg` },
                  { clau: 'kg_recollits', etiqueta: t('sort.x_kg_recollits'), valor: `${kg(resum.total.kg_recollits)} kg` },
                  { clau: 'ofertants', etiqueta: t('sort.x_ofertants'), valor: nombre(resum.total.ofertants, 0) },
                  { clau: 'receptors', etiqueta: t('sort.x_receptors'), valor: nombre(resum.total.receptors, 0) },
                  { clau: 'espigolades', etiqueta: t('sort.x_espigolades'), valor: nombre(resum.total.espigolades, 0) },
                ]} />
                <p className="hidden text-xs text-muted-foreground xl:block">{t('sort.resum_hint')}</p>
                <TaulaResum resum={resum} per={per} buitKey={buitKey} carregant={carregantResum} />
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
      <DialegSortida canalizacionId={canalOberta} fila={fila} onTanca={dialeg.tanca} onCanvi={recarrega} />
    </Card>
  )
}
