// «Productes» (antes «Costos per quilo», renombrada el 27-09-2026): el CATÁLOGO del equipo.
// Cada producto con su ICONO —el que sale en el Mercat cuando una oferta no trae foto;
// desde el 29-09-2026 sustituye a las fotos del catálogo— y su COSTE DE REFERENCIA.
//
// ⚠️ EL COSTE ES DE REFERENCIA, NO EL QUE VALORA LA DONACIÓN. Desde el 27-09-2026 el coste
// de cada oferta lo declara el productor al publicarla (`excedentes.coste_kg`), y esta cifra
// es la que se le PROPONE —por el panel y por WhatsApp— y la que se usa si no declara
// ninguna. La canalización copia el coste al crearse y lo congela al conciliar: cambiarlo
// aquí no toca nada ya conciliado.
//
// ⚠️ Y YA NO HAY EJERCICIO: un precio por producto, que se actualiza cuando hace falta
// (20270405100200). El motivo sigue siendo obligatorio: `costes_producto_hist` guarda cada
// valor sobrescrito con el suyo.
//
// Los iconos no se editan desde la aplicación: salen de `scripts/icones-productes.ts`.
//
// Desde el 17-11-2026 (punto 3, fase D1) la pantalla tiene tres pestañas (`?pestanya=`):
// «Catàleg» (lo de siempre), «Preus de referència» (el precio de cada producto por mes, con
// la propuesta de Gencat/Mercabarna/manual y la validación del equipo: `PestanyaPreus`) y
// «Càrregues» (los ficheros que se han descargado de cada fuente: `PestanyaCarregues`). Y el
// botón «Nou producte» (`DialegNouProducte`). Los precios por mes AÚN NO valoran nada (D2).

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { CirclePlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { casaCerca } from '../../lib/cerca'
import { useCerca } from '../../hooks/useCerca'
import { usePuntTall } from '../../hooks/usePuntTall'
import { textError } from '../../lib/textError'
import { useAppContext } from '../../hooks/useAppContext'
import { esborrarCostProducte, eurKg, fixarCostProducte } from '../../lib/tancament'
import { dataCurta } from '../../lib/albarans'
import { carregaPreusVigents, type PreuVigent } from '../../lib/preus'
import { textMes } from '../../lib/sortides'
import type { CosteProducto } from '../../types'
import { IconaProducte } from '../../components/FotosOferta'
import DialegMotiu from '../../components/DialegMotiu'
import BotoIcona from '../../components/BotoIcona'
import { FilaClicable } from '../../components/FilaClicable'
import PestanyaPreus from '../../components/preus/PestanyaPreus'
import PestanyaCarregues from '../../components/preus/PestanyaCarregues'
import DialegNouProducte from '../../components/preus/DialegNouProducte'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Producte {
  nombre: string
  familia: string | null
}

/** La ruta del detalle de un producto: el nombre lleva acentos, espacios y «·». */
export const rutaProducte = (nom: string) => `/equip/productes/${encodeURIComponent(nom)}`

function num(v: string): number | null {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

const PESTANYES = ['cataleg', 'preus', 'carregues'] as const
type Pestanya = typeof PESTANYES[number]

export default function Productes() {
  const { t } = useT()
  const navigate = useNavigate()
  const { ctx } = useAppContext()
  const potAprovar = ctx?.potAprovar ?? false
  // Fijar el coste es de `pot_aprovar()`, pero BORRARLO exige `es_super_admin()`
  // (`borrar_coste_producto`): a un admin se le deja gris con el motivo.
  const esSuperAdmin = ctx?.esSuperAdmin ?? false

  const [productes, setProductes] = useState<Producte[]>([])
  const [errorProductes, setErrorProductes] = useState<string | null>(null)
  const [nouObert, setNouObert] = useState(false)

  // La pestaña activa, en la URL: un enlace o «atrás» vuelven al mismo sitio.
  const [params, setParams] = useSearchParams()
  const enUrl = params.get('pestanya')
  const pestanya: Pestanya = (PESTANYES as readonly string[]).includes(enUrl ?? '') ? enUrl as Pestanya : 'cataleg'
  function triaPestanya(p: Pestanya) {
    setParams((prev) => {
      const n = new URLSearchParams(prev)
      if (p === 'cataleg') n.delete('pestanya'); else n.set('pestanya', p)
      return n
    }, { replace: true })
  }

  useEffect(() => {
    let viu = true
    void (async () => {
      // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
      const { data, error: err } = await supabase
        .from('productos')
        .select('nombre, familia')
        .order('familia', { ascending: true, nullsFirst: false })
        .order('nombre', { ascending: true })
      if (!viu) return
      if (err) setErrorProductes(err.message)
      else setProductes((data as Producte[] | null) ?? [])
    })()
    return () => { viu = false }
  }, [])

  const families = useMemo(
    () => [...new Set(productes.map((p) => p.familia).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b, 'ca')),
    [productes],
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>{t('cost.title')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{t('cost.subtitle')}</p>
            </div>
            {potAprovar && (
              <Button className="h-11 md:h-8" onClick={() => setNouObert(true)} data-testid="nou-producte">
                <Plus className="size-4" aria-hidden /> {t('preu.a_new_product')}
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      <Tabs value={pestanya} onValueChange={(v) => triaPestanya(v as Pestanya)}>
        {/* En móvil la barra se desliza en horizontal, sin desbordar la página. */}
        <div className="min-w-0 overflow-x-auto pb-1">
          <TabsList variant="line" className="w-max">
            <TabsTrigger value="cataleg">{t('preu.tab_catalog')}</TabsTrigger>
            <TabsTrigger value="preus">{t('preu.tab_prices')}</TabsTrigger>
            <TabsTrigger value="carregues">{t('preu.tab_loads')}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="cataleg" className="mt-4">
          <Cataleg productes={productes} errorProductes={errorProductes}
            potAprovar={potAprovar} esSuperAdmin={esSuperAdmin} />
        </TabsContent>
        <TabsContent value="preus" className="mt-4">
          <PestanyaPreus potAprovar={potAprovar} />
        </TabsContent>
        <TabsContent value="carregues" className="mt-4">
          <PestanyaCarregues potAprovar={potAprovar} esSuperAdmin={esSuperAdmin} />
        </TabsContent>
      </Tabs>

      <DialegNouProducte obert={nouObert} onObert={setNouObert} families={families}
        onCreat={(nom) => navigate(rutaProducte(nom))} />
    </div>
  )
}

interface PropsCataleg {
  productes: Producte[]
  errorProductes: string | null
  potAprovar: boolean
  esSuperAdmin: boolean
}

function Cataleg({ productes, errorProductes, potAprovar, esSuperAdmin }: PropsCataleg) {
  const { t } = useT()
  const [costos, setCostos] = useState<CosteProducto[]>([])
  /** El precio de referencia validado que se aplica hoy (Gencat, Mercabarna o manual del mes). */
  const [vigents, setVigents] = useState<Map<string, PreuVigent>>(new Map())
  /** Las fuentes de cada producto (`productes_fonts`): explican por qué uno aún no tiene precio. */
  const [fontsDe, setFontsDe] = useState<Map<string, Set<string>>>(new Map())
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { cerca, setCerca, q } = useCerca()
  /** Solo los productos que ya tienen coste; apagado, salen todos los del catálogo. */
  const [nomesAmbCost, setNomesAmbCost] = useState(false)
  const [ocupat, setOcupat] = useState(false)

  /** Producto sobre el que se está tecleando un coste (fila abierta). */
  const [editant, setEditant] = useState<string | null>(null)
  const [valor, setValor] = useState('')
  const [motiu, setMotiu] = useState('')
  const [esborrant, setEsborrant] = useState<string | null>(null)
  // La fila de editar ocupa las columnas VISIBLES, que cambian con el ancho (usePuntTall).
  const columnes = 2 + Number(usePuntTall('sm')) + Number(usePuntTall('md'))
    + Number(usePuntTall('xl')) + Number(potAprovar)

  const carrega = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('costes_producto')
      .select('producto, coste_kg, motivo, fijado_por, updated_at')
    // Lo que de verdad valora una canalización (`preu_referencia_de`): el último mes validado y,
    // solo si no hay ninguno, el coste manual. Sin esto, Poma o Pera salían «Sense cost».
    const [v, f] = await Promise.all([
      carregaPreusVigents(),
      supabase.from('productes_fonts').select('producto, font'),
    ])
    const fonts = new Map<string, Set<string>>()
    for (const r of (f.data as { producto: string; font: string }[] | null) ?? []) {
      fonts.set(r.producto, (fonts.get(r.producto) ?? new Set()).add(r.font))
    }
    setFontsDe(fonts)
    return { llista: (data as CosteProducto[] | null) ?? [], err: err ?? (v.error ? { message: v.error } : null), mapa: v.mapa }
  }, [])

  const refresca = useCallback(async () => {
    const { llista, err, mapa } = await carrega()
    if (err) { setError(err.message); return }
    setError(null)
    setCostos(llista)
    setVigents(mapa)
  }, [carrega])

  useEffect(() => {
    let viu = true
    setCarregant(true)
    void (async () => {
      const { llista, err, mapa } = await carrega()
      if (!viu) return
      if (err) setError(err.message)
      else { setError(null); setCostos(llista); setVigents(mapa) }
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [carrega])

  const perProducte = useMemo(() => {
    const mapa: Record<string, CosteProducto> = {}
    for (const c of costos) mapa[c.producto] = c
    return mapa
  }, [costos])

  const ambPreu = useCallback(
    (nom: string) => vigents.has(nom) || Boolean(perProducte[nom]),
    [vigents, perProducte],
  )

  const files = useMemo(() => {
    return productes.filter((p) => {
      if (nomesAmbCost && !ambPreu(p.nombre)) return false
      return casaCerca([p.nombre, p.familia], q)
    })
  }, [productes, ambPreu, q, nomesAmbCost])

  const senseCost = useMemo(
    () => productes.filter((p) => !ambPreu(p.nombre)).length,
    [productes, ambPreu],
  )

  function obreEdicio(producte: string) {
    const actual = perProducte[producte]
    setEditant(producte)
    setValor(actual ? String(actual.coste_kg) : '')
    setMotiu('')
  }

  async function desa(producte: string) {
    const cost = num(valor)
    if (cost === null || cost <= 0) { toast.error(t('cost.bad_value')); return }
    if (motiu.trim() === '') { toast.error(t('cost.reason_required')); return }
    setOcupat(true)
    const res = await fixarCostProducte({ producte, cost, motiu: motiu.trim() })
    setOcupat(false)
    if (!res.ok) { toast.error(textError(t, res)); return }
    toast.success(t('cost.saved', { p: producte }))
    setEditant(null)
    await refresca()
  }

  async function esborra(producte: string, motiu: string) {
    setOcupat(true)
    const res = await esborrarCostProducte(producte, motiu)
    setOcupat(false)
    setEsborrant(null)
    if (!res.ok) { toast.error(textError(t, res)); return }
    toast.success(t('cost.deleted', { p: producte }))
    await refresca()
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          {/* El aviso que evita una tarde de desconcierto: sin coste, el donante entero se
              bloquea y el mensaje que sale en el cierre habla de otra pantalla. */}
          <div className="rounded-md border border-aviso bg-aviso-fondo p-3 text-sm text-aviso">
            {t('cost.blocking_hint')}
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="cost-cerca">{t('c.search')}</Label>
              <Input
                id="cost-cerca"
                type="search"
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
                placeholder={t('cost.search')}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Badge className="bg-secondary text-secondary-foreground">
              {t('cost.with_cost', { n: productes.length - senseCost })}
            </Badge>
            <Badge className={senseCost > 0 ? 'bg-aviso-fondo text-aviso' : 'bg-exito-fondo text-exito'}>
              {t('cost.without_cost', { n: senseCost })}
            </Badge>
            <Button
              size="sm"
              variant={nomesAmbCost ? 'default' : 'outline'}
              className="h-11 whitespace-normal md:h-8"
              onClick={() => setNomesAmbCost((v) => !v)}
            >
              {t('cost.only_with_cost')}
            </Button>
          </div>

          {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
          {(error || errorProductes) && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
          {!potAprovar && <p className="text-sm text-muted-foreground">{t('cost.readonly')}</p>}

          {!carregant && files.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('cost.no_match')}</p>
          )}

          {/* El criterio de las tablas (03-11-2026, AGENTS.md §2): cabe sin scroll horizontal
              —en móvil quedan producto, coste y acciones; la familia va bajo el nombre, la
              fecha sale desde `md` y el motivo desde `xl`—, títulos centrados y acciones en
              iconos con tooltip. Editar abre una fila debajo con los dos campos. */}
          {files.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden w-14 sm:table-cell"><span className="sr-only">{t('prod.c_photo')}</span></TableHead>
                  <TableHead className="text-center whitespace-normal">{t('cost.c_product')}</TableHead>
                  <TableHead className="w-24 text-center whitespace-normal sm:w-32">{t('cost.c_cost')}</TableHead>
                  <TableHead className="hidden text-center whitespace-normal xl:table-cell">{t('cost.c_reason')}</TableHead>
                  <TableHead className="hidden w-28 text-center whitespace-normal md:table-cell">{t('cost.c_updated')}</TableHead>
                  {potAprovar && (
                    <TableHead className="w-15 text-center whitespace-normal md:w-22">
                      <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((p) => {
                  const c = perProducte[p.nombre]
                  const v = vigents.get(p.nombre)
                  // Sin precio: por qué (solo Mercabarna = sale el día 1 del mes siguiente).
                  const fp = fontsDe.get(p.nombre)
                  const motiuSense = v || c ? null
                    : fp?.has('gencat') ? t('preu.motiu_gencat_sense_dades')
                    : fp?.has('mercabarna') ? t('preu.motiu_mercabarna_mes_obert')
                    : t('preu.motiu_manual')
                  const obert = editant === p.nombre
                  return (
                    <Fragment key={p.nombre}>
                      <FilaClicable className={obert ? 'bg-muted/50' : undefined} to={rutaProducte(p.nombre)}>
                        <TableCell className="hidden sm:table-cell">
                          <Link to={rutaProducte(p.nombre)} aria-label={t('prod.open', { p: p.nombre })}>
                            <IconaProducte producto={p.nombre} familia={p.familia} className="size-10" />
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-normal break-words">
                          <Link to={rutaProducte(p.nombre)} className="font-medium text-primary hover:underline">{p.nombre}</Link>
                          {p.familia && <span className="block text-xs text-muted-foreground">{p.familia}</span>}
                        </TableCell>
                        <TableCell className="text-center tabular-nums whitespace-normal">
                          {v ? (
                            <>
                              {eurKg(v.eur_kg)}
                              <span className="block text-xs text-muted-foreground" data-testid="cost-font">
                                {t(`preu.font_${v.font}`)} · {textMes(`${v.exercici}-${String(v.mes).padStart(2, '0')}`, t)}
                              </span>
                            </>
                          ) : c ? (
                            <>
                              {eurKg(c.coste_kg)}
                              <span className="block text-xs text-muted-foreground" data-testid="cost-font">{t('cost.font_manual')}</span>
                            </>
                          ) : <Badge className="bg-aviso-fondo text-aviso" title={motiuSense ?? undefined}>{t('cost.missing')}</Badge>}
                          {v && c && Number(c.coste_kg) !== Number(v.eur_kg) && (
                            <span className="block text-xs text-muted-foreground">{t('cost.manual_reserva', { e: eurKg(c.coste_kg) })}</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-sm whitespace-normal text-muted-foreground xl:table-cell">
                          <span className="line-clamp-2">{c?.motivo ?? motiuSense ?? '—'}</span>
                        </TableCell>
                        <TableCell className="hidden text-center text-muted-foreground md:table-cell">
                          {dataCurta(c?.updated_at ?? null)}
                        </TableCell>
                        {potAprovar && (
                          <TableCell>
                            <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                              <BotoIcona
                                icona={c ? Pencil : CirclePlus}
                                etiqueta={t(c ? 'cost.a_edit' : 'cost.a_set')}
                                aria-expanded={obert}
                                onClick={() => (obert ? setEditant(null) : obreEdicio(p.nombre))}
                              />
                              {c && (
                                <BotoIcona
                                  icona={Trash2}
                                  etiqueta={t('cost.del_title')}
                                  className="text-destructive hover:text-destructive"
                                  disabled={!esSuperAdmin}
                                  motiu={t('cost.del_only_super')}
                                  onClick={() => setEsborrant(p.nombre)}
                                />
                              )}
                            </div>
                          </TableCell>
                        )}
                      </FilaClicable>
                      {obert && (
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableCell colSpan={columnes} className="whitespace-normal">
                            <form
                              className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
                              onSubmit={(e) => { e.preventDefault(); void desa(p.nombre) }}
                            >
                              <div className="space-y-1.5">
                                <Label htmlFor="cost-valor">{t('cost.f_cost')}</Label>
                                <Input
                                  id="cost-valor"
                                  inputMode="decimal"
                                  value={valor}
                                  onChange={(e) => setValor(e.target.value)}
                                  autoFocus
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="cost-motiu">{t('cost.f_reason')}</Label>
                                <Input id="cost-motiu" value={motiu} onChange={(e) => setMotiu(e.target.value)} />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button type="submit" className="h-11 w-full sm:w-auto md:h-8" disabled={ocupat}>
                                  {t('c.save')}
                                </Button>
                                <Button
                                  type="button" variant="outline"
                                  className="h-11 w-full sm:w-auto md:h-8"
                                  disabled={ocupat}
                                  onClick={() => setEditant(null)}
                                >
                                  {t('c.cancel')}
                                </Button>
                              </div>
                            </form>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Borrar un coste NO es un `delete` inocente: el histórico solo guarda lo que se
          sobrescribe, así que lo borrado desaparece. Por eso pide motivo, aunque la RPC
          no lo reciba: queda en el diálogo y en la consola de quien lo hizo. */}
      <DialegMotiu
        obert={esborrant !== null}
        onObert={(v) => { if (!v) setEsborrant(null) }}
        titol={t('cost.del_title')}
        descripcio={t('cost.del_desc')}
        etiqueta={t('cost.f_del_reason')}
        confirmar={t('c.delete')}
        destructiu
        ocupat={ocupat}
        onConfirma={(m) => {
          if (!esborrant) return
          void esborra(esborrant, m)
        }}
      />
    </div>
  )
}
