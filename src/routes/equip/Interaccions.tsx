// «Interaccions i seguiment» (proceso 1.2 del cliente, 25-11-2026): la sección de Organitzacions
// que centraliza las interacciones del equipo con las entidades.
//
// No hay tabla nueva ni copia: son las MISMAS filas de `notes_internes` que se registran en la
// ficha de cada entidad (pestaña «Gestió interna»), donde el hilo se sigue viendo. Tres vistas,
// en `?vista=` (la URL limpia es «Pendents»):
//   · Pendents: los próximos pasos sin hacer, lo vencido primero (en `aviso`); «Fet» pide el
//     resultado (`DialegSeguimentFet`) y la fila pasa al Historial.
//   · Historial: todas las interacciones, la más reciente arriba, con su próximo paso y resultado.
//   · Previsions de producte: las interacciones con previsión, por fecha prevista. 🔴 Una
//     previsión NO crea oferta: la fila lleva a la ficha de la entidad.
// «Afegir interacció» abre el mismo formulario de la ficha (`FormulariInteraccio`) en un diálogo,
// con la entidad a elegir.
//
// Datos: `interaccions_llistat()` e `interaccions_opcions()` (20270616100100), solo del equipo.
// Patrones copiados de «Entrades i sortides»: la página va atada a la clave de los filtros y de la
// vista (cambiar algo vuelve a la 1 sin un efecto que la resetee), el buscador va al servidor con
// espera y cada petición lleva su número para que una respuesta lenta no pise a una nueva. La
// lógica pura vive en `lib/interaccions.ts`. 🔴 Nada de aquí sale por ningún canal (AGENTS §8).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { nombrePagines, textPagina } from '../../lib/llistatOfertes'
import { TIPUS_NOTA_LLEGITS } from '../../lib/notesInternes'
import {
  ESTATS_SEGUIMENT_FILTRE, MIDA_PAGINA_INTERACCIONS, VISTES_INTERACCIONS,
  ambFiltresInteraccions, argsFiltresInteraccions, clauBuit, clauVista, clauErrorInteraccions, clauEstatSeguiment, clauTipus,
  llegeixOpcionsInteraccions, llegeixPaginaInteraccions, llegeixVista, opcionsZona, rangInvertitInteraccions, textZona,
  type ArgsFiltresInteraccions,
} from '../../lib/interaccions'
import type { FilaInteraccio, OpcionsInteraccions, PaginaInteraccions, VistaInteraccions } from '../../types'
import { useFiltresLlistat } from '../../hooks/useFiltresLlistat'
import { useCerca } from '../../hooks/useCerca'
import BarraFiltres from '../../components/BarraFiltres'
import CarregantSeccio from '../../components/CarregantSeccio'
import FormulariInteraccio from '../../components/fitxa/FormulariInteraccio'
import DialegSeguimentFet, { type SeguimentPerTancar } from '../../components/fitxa/DialegSeguimentFet'
import TaulaInteraccions from '../../components/interaccions/TaulaInteraccions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** La espera del buscador antes de preguntar al servidor (la de «Entrades i sortides»). */
const ESPERA_CERCA_MS = 300

const OPCIONS_BUIDES: OpcionsInteraccions = { responsables: [], productes: [], zones: [], municipis: [] }
const ZERO: Record<VistaInteraccions, number> = { pendents: 0, historial: 0, previsions: 0 }

type Resultat<T> = { ok: true; dades: T } | { ok: false; missatge: string }

/** Una página de una vista. Nunca lanza. */
async function carregaPagina(
  vista: VistaInteraccions, args: ArgsFiltresInteraccions | null, pagina: number, mida: number,
): Promise<Resultat<PaginaInteraccions>> {
  try {
    const { data, error } = await supabase.rpc('interaccions_llistat', {
      p_vista: vista, ...(args ?? {}), p_limit: mida, p_offset: pagina * mida,
    })
    if (error) return { ok: false, missatge: error.message ?? '' }
    return { ok: true, dades: llegeixPaginaInteraccions(data) }
  } catch (e) {
    return { ok: false, missatge: e instanceof Error ? e.message : String(e) }
  }
}

/** Cuántas hay en cada vista (con esos filtros, o sin ninguno). Nunca lanza: un fallo cuenta 0. */
async function carregaComptes(args: ArgsFiltresInteraccions | null): Promise<Record<VistaInteraccions, number>> {
  const rs = await Promise.all(VISTES_INTERACCIONS.map((v) => carregaPagina(v, args, 0, 1)))
  const out = { ...ZERO }
  rs.forEach((r, i) => { if (r.ok) out[VISTES_INTERACCIONS[i]] = r.dades.total })
  return out
}

export default function Interaccions() {
  const { t } = useT()

  // --- La vista, en la URL -----------------------------------------------------------------
  const [params, setParams] = useSearchParams()
  const vista = llegeixVista(params.get('vista'))
  const canviaVista = (v: string) => {
    const nova = llegeixVista(v)
    setParams((prev) => {
      const n = new URLSearchParams(prev)
      if (nova === 'pendents') n.delete('vista')
      else n.set('vista', nova)
      return n
    }, { replace: true, preventScrollReset: true })
  }

  // --- Filtros y buscador --------------------------------------------------------------------
  const f = useFiltresLlistat('equip-interaccions')
  const { cerca, setCerca } = useCerca()
  const [cercaServ, setCercaServ] = useState(cerca)
  useEffect(() => {
    const id = setTimeout(() => setCercaServ(cerca), ESPERA_CERCA_MS)
    return () => clearTimeout(id)
  }, [cerca])
  const args = useMemo(
    () => argsFiltresInteraccions({ valors: f.valors, desDe: f.desDe, finsA: f.finsA, cerca: cercaServ }),
    [f.valors, f.desDe, f.finsA, cercaServ],
  )
  const clauArgs = JSON.stringify(args)
  const invertit = rangInvertitInteraccions(args)
  const filtrat = ambFiltresInteraccions(args)
  // Sube tras añadir una interacción o cerrar un seguimiento: todo se relee.
  const [versio, setVersio] = useState(0)
  const recarrega = useCallback(() => setVersio((v) => v + 1), [])

  // --- Las opciones de los filtros -----------------------------------------------------------
  const [opcions, setOpcions] = useState<OpcionsInteraccions>(OPCIONS_BUIDES)
  const [orgs, setOrgs] = useState<{ ids: string[]; noms: Record<string, string> }>({ ids: [], noms: {} })
  const [totalsSenseFiltres, setTotalsSenseFiltres] = useState(ZERO)
  useEffect(() => {
    let viu = true
    void (async () => {
      try {
        const { data } = await supabase.rpc('interaccions_opcions')
        if (viu) setOpcions(llegeixOpcionsInteraccions(data))
      } catch { /* sin opciones: los desplegables no salen */ }
    })()
    void carregaComptes(null).then((c) => { if (viu) setTotalsSenseFiltres(c) })
    return () => { viu = false }
  }, [versio])
  // Las entidades, para el filtro «Entitat» (buscador predictivo).
  useEffect(() => {
    let viu = true
    void supabase.from('v_organizaciones').select('id, nombre').order('nombre').then(({ data }) => {
      if (!viu) return
      const files = (data ?? []) as { id: string; nombre: string | null }[]
      setOrgs({ ids: files.map((o) => o.id), noms: Object.fromEntries(files.map((o) => [o.id, o.nombre ?? '—'])) })
    })
    return () => { viu = false }
  }, [])
  const nomResponsable = useMemo(
    () => Object.fromEntries(opcions.responsables.map((r) => [r.id, r.nom])) as Record<string, string>,
    [opcions.responsables],
  )

  // --- Cuántas hay en cada vista con los filtros puestos (las pestañas) ----------------------
  const [comptes, setComptes] = useState(ZERO)
  const peticioComptes = useRef(0)
  useEffect(() => {
    const meva = ++peticioComptes.current
    if (invertit) return
    void carregaComptes(JSON.parse(clauArgs) as ArgsFiltresInteraccions).then((c) => {
      if (meva === peticioComptes.current) setComptes(c)
    })
  }, [clauArgs, invertit, versio])

  // --- La página de la vista, atada a la vista y a la clave de los filtros -------------------
  const clauPagina = `${vista}|${clauArgs}`
  const [paginaFiltres, setPaginaFiltres] = useState({ clau: clauPagina, n: 0 })
  const pagina = paginaFiltres.clau === clauPagina ? paginaFiltres.n : 0
  const anaAPagina = (n: number) => setPaginaFiltres({ clau: clauPagina, n })
  const [dades, setDades] = useState<PaginaInteraccions | null>(null)
  const [dadesVista, setDadesVista] = useState<VistaInteraccions>(vista)
  const [carregant, setCarregant] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const peticio = useRef(0)

  useEffect(() => {
    const meva = ++peticio.current
    if (invertit) { setErrorKey('ixs.err_rang'); setCarregant(false); return }
    setErrorKey(null)
    setCarregant(true)
    void carregaPagina(vista, JSON.parse(clauArgs) as ArgsFiltresInteraccions, pagina, MIDA_PAGINA_INTERACCIONS).then((r) => {
      if (meva !== peticio.current) return
      if (!r.ok) { setErrorKey(clauErrorInteraccions(r.missatge)); setDades(null); setCarregant(false); return }
      // La página se ha quedado más allá del final (se ha cerrado un seguimiento): a la última.
      if (r.dades.files.length === 0 && pagina > 0 && r.dades.total > 0) {
        setPaginaFiltres({ clau: clauPagina, n: nombrePagines(r.dades.total, MIDA_PAGINA_INTERACCIONS) - 1 })
        return
      }
      setErrorKey(null)
      setDades(r.dades)
      setDadesVista(vista)
      setCarregant(false)
    })
  }, [vista, clauArgs, clauPagina, invertit, pagina, versio])

  // --- Añadir y cerrar -----------------------------------------------------------------------
  const [nova, setNova] = useState(false)
  const [perTancar, setPerTancar] = useState<SeguimentPerTancar | null>(null)

  // --- Lo que se pinta -----------------------------------------------------------------------
  const files: FilaInteraccio[] = dades?.files ?? []
  const total = dades?.total ?? 0
  const nPagines = nombrePagines(total, MIDA_PAGINA_INTERACCIONS)
  const pag = textPagina(pagina, files.length, total, MIDA_PAGINA_INTERACCIONS)
  const buitKey = filtrat ? 'ixs.no_match' : clauBuit(vista)
  const valorsZona = opcionsZona(opcions)
  const posaPrev = (clau: 'prev_desde' | 'prev_hasta', v: string) => {
    const n = { ...f.valors }
    if (v) n[clau] = v
    else delete n[clau]
    f.setValors(n)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle>{t('ixs.title')}</CardTitle>
          <Button className="h-11 shrink-0 whitespace-nowrap md:h-8" onClick={() => setNova(true)} data-testid="int-afegir">
            <Plus className="size-4" aria-hidden /> {t('ixs.afegir')}
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('ixs.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input type="search" placeholder={t('ixs.search')} value={cerca} onChange={(e) => setCerca(e.target.value)}
          aria-label={t('ixs.search')} data-testid="int-cerca" />
        <BarraFiltres
          id="int"
          desplegables={[
            { clau: 'entitat', etiquetaKey: 'ixs.f_entitat', opcions: orgs.ids, text: (v: string) => orgs.noms[v] ?? v, cercador: true },
            { clau: 'zona', etiquetaKey: 'ixs.f_zona', opcions: valorsZona, text: (v: string) => textZona(v, opcions), cercador: true },
            { clau: 'tipus', etiquetaKey: 'ixs.f_tipus', opcions: [...TIPUS_NOTA_LLEGITS], text: (v: string) => t(clauTipus(v)), cercador: false },
            { clau: 'responsable', etiquetaKey: 'ixs.f_responsable', opcions: opcions.responsables.map((r) => r.id), text: (v: string) => nomResponsable[v] ?? v, cercador: false },
            { clau: 'producte', etiquetaKey: 'fl.d_producte', opcions: opcions.productes },
            { clau: 'estat', etiquetaKey: 'ixs.f_estat', opcions: [...ESTATS_SEGUIMENT_FILTRE], text: (v: string) => t(clauEstatSeguiment(v)), cercador: false },
          ]}
          valors={f.valors}
          onValors={f.setValors}
          rang={{ etiquetaKey: 'ixs.r_data', desDe: f.desDe, finsA: f.finsA, onCanvi: f.setRang }}
          extra={(
            <>
              <div className="min-w-0 space-y-1 md:w-36">
                <Label htmlFor="int-prev-des" className="text-xs font-normal text-muted-foreground">{t('ixs.r_prev')} · {t('fl.des_de')}</Label>
                <Input id="int-prev-des" type="date" className="md:h-7" value={f.valors.prev_desde ?? ''}
                  onChange={(e) => posaPrev('prev_desde', e.target.value)} />
              </div>
              <div className="min-w-0 space-y-1 md:w-36">
                <Label htmlFor="int-prev-fins" className="text-xs font-normal text-muted-foreground">{t('fl.fins_a')}</Label>
                <Input id="int-prev-fins" type="date" className="md:h-7" value={f.valors.prev_hasta ?? ''}
                  onChange={(e) => posaPrev('prev_hasta', e.target.value)} />
              </div>
            </>
          )}
          mostrant={comptes[vista]}
          total={totalsSenseFiltres[vista]}
        />

        <Tabs value={vista} onValueChange={canviaVista}>
          {/* Tres pestañas: en móvil, el nombre corto de las previsiones para que quepan a 360 px. */}
          <TabsList className="w-full sm:w-fit">
            {VISTES_INTERACCIONS.map((v) => (
              <TabsTrigger key={v} value={v} className="px-1 sm:px-2" data-testid={`int-tab-${v}`}>
                {v === 'previsions' ? (
                  <>
                    <span className="hidden sm:inline">{t('ixs.tab_previsions')}</span>
                    <span className="sm:hidden">{t('ixs.tab_previsions_curt')}</span>
                  </>
                ) : t(clauVista(v))}
                <span className="text-xs tabular-nums text-muted-foreground" data-testid={`int-compte-${v}`}>{comptes[v]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {errorKey ? (
          <p className="text-sm text-error" role="alert">{t(errorKey)}</p>
        ) : !dades ? (
          <CarregantSeccio files={5} ambCapcalera={false} />
        ) : (
          <>
            {/* Mientras llega la vista nueva, la tabla de la anterior se queda (atenuada) en vez de
                pintar sus filas con las columnas de la otra. */}
            <TaulaInteraccions vista={dadesVista} files={files} buitKey={buitKey}
              carregant={carregant} onFet={(x) => setPerTancar({ id: x.id, propera_accio: x.propera_accio })} />
            {total > MIDA_PAGINA_INTERACCIONS && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2" data-testid="int-paginacio">
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
      </CardContent>

      <Dialog open={nova} onOpenChange={setNova}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="int-dialeg">
          <DialogHeader>
            <DialogTitle>{t('ixs.afegir')}</DialogTitle>
            <DialogDescription>{t('ixs.afegir_d')}</DialogDescription>
          </DialogHeader>
          <FormulariInteraccio idPrefix="int-nova" estret onCancel={() => setNova(false)}
            onDesat={() => { setNova(false); recarrega() }} />
        </DialogContent>
      </Dialog>
      <DialegSeguimentFet seguiment={perTancar} onTanca={() => setPerTancar(null)} onFet={recarrega} />
    </Card>
  )
}
