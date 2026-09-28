// «Productes» (antes «Costos per quilo», renombrada el 27-09-2026): el CATÁLOGO del equipo.
// Cada producto con su foto —la que sale de respaldo en el Mercat cuando una oferta no trae
// ninguna— y su COSTE DE REFERENCIA.
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
// La FOTO se gestiona en el detalle (`/equip/productes/:nom`); aquí sale en miniatura.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { useAppContext } from '../../hooks/useAppContext'
import { esborrarCostProducte, eurKg, fixarCostProducte } from '../../lib/tancament'
import { dataCurta } from '../../lib/albarans'
import type { CosteProducto } from '../../types'
import { FotoOferta, useUrlsFotos } from '../../components/FotosOferta'
import { BUCKET_PRODUCTES } from '../../lib/fotosProducte'
import DialegMotiu from '../../components/DialegMotiu'
import BotoAmbMotiu from '../../components/proces/BotoAmbMotiu'
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
  foto_mini: string | null
}

/** La ruta del detalle de un producto: el nombre lleva acentos, espacios y «·». */
export const rutaProducte = (nom: string) => `/equip/productes/${encodeURIComponent(nom)}`

function num(v: string): number | null {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

export default function Productes() {
  const { t } = useT()
  const { ctx } = useAppContext()
  const potAprovar = ctx?.potAprovar ?? false
  // Fijar el coste es de `pot_aprovar()`, pero BORRARLO exige `es_super_admin()`
  // (`borrar_coste_producto`): a un admin se le deja gris con el motivo.
  const esSuperAdmin = ctx?.esSuperAdmin ?? false

  const [productes, setProductes] = useState<Producte[]>([])
  const [costos, setCostos] = useState<CosteProducto[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  /** Solo los productos que ya tienen coste; apagado, salen todos los del catálogo. */
  const [nomesAmbCost, setNomesAmbCost] = useState(false)
  const [ocupat, setOcupat] = useState(false)

  /** Producto sobre el que se está tecleando un coste (fila abierta). */
  const [editant, setEditant] = useState<string | null>(null)
  const [valor, setValor] = useState('')
  const [motiu, setMotiu] = useState('')
  const [esborrant, setEsborrant] = useState<string | null>(null)

  useEffect(() => {
    let viu = true
    void (async () => {
      // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
      const { data, error: err } = await supabase
        .from('productos')
        .select('nombre, familia, foto_mini')
        .order('familia', { ascending: true, nullsFirst: false })
        .order('nombre', { ascending: true })
      if (!viu) return
      if (err) setError(err.message)
      else setProductes((data as Producte[] | null) ?? [])
    })()
    return () => { viu = false }
  }, [])

  const carrega = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('costes_producto')
      .select('producto, coste_kg, motivo, fijado_por, updated_at')
    return { llista: (data as CosteProducto[] | null) ?? [], err }
  }, [])

  const refresca = useCallback(async () => {
    const { llista, err } = await carrega()
    if (err) { setError(err.message); return }
    setError(null)
    setCostos(llista)
  }, [carrega])

  useEffect(() => {
    let viu = true
    setCarregant(true)
    void (async () => {
      const { llista, err } = await carrega()
      if (!viu) return
      if (err) setError(err.message)
      else { setError(null); setCostos(llista) }
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [carrega])

  const perProducte = useMemo(() => {
    const mapa: Record<string, CosteProducto> = {}
    for (const c of costos) mapa[c.producto] = c
    return mapa
  }, [costos])

  const files = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    return productes.filter((p) => {
      if (nomesAmbCost && !perProducte[p.nombre]) return false
      if (!q) return true
      return [p.nombre, p.familia].some((c) => (c ?? '').toLowerCase().includes(q))
    })
  }, [productes, perProducte, cerca, nomesAmbCost])

  const senseCost = useMemo(
    () => productes.filter((p) => !perProducte[p.nombre]).length,
    [productes, perProducte],
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

  const urls = useUrlsFotos(
    productes.map((p) => p.foto_mini).filter((r): r is string => Boolean(r)),
    BUCKET_PRODUCTES,
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('cost.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('cost.subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
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
              {t('cost.with_cost', { n: costos.length })}
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
          {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
          {!potAprovar && <p className="text-sm text-muted-foreground">{t('cost.readonly')}</p>}

          {!carregant && files.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('cost.no_match')}</p>
          )}

          {files.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14"><span className="sr-only">{t('prod.c_photo')}</span></TableHead>
                    <TableHead>{t('cost.c_product')}</TableHead>
                    <TableHead>{t('cost.c_family')}</TableHead>
                    <TableHead className="text-right">{t('cost.c_cost')}</TableHead>
                    <TableHead>{t('cost.c_reason')}</TableHead>
                    <TableHead>{t('cost.c_updated')}</TableHead>
                    <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((p) => {
                    const c = perProducte[p.nombre]
                    const obert = editant === p.nombre
                    return (
                      <TableRow key={p.nombre}>
                        <TableCell>
                          <Link to={rutaProducte(p.nombre)} aria-label={t('prod.open', { p: p.nombre })}>
                            <FotoOferta url={p.foto_mini ? urls[p.foto_mini] : null} alt=""
                              familia={p.familia} className="size-10" />
                          </Link>
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link to={rutaProducte(p.nombre)} className="text-primary hover:underline">{p.nombre}</Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.familia ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {c
                            ? eurKg(c.coste_kg)
                            : <Badge className="bg-aviso-fondo text-aviso">{t('cost.missing')}</Badge>}
                        </TableCell>
                        <TableCell className="max-w-64 text-sm text-muted-foreground">
                          {obert
                            ? (
                              <Input
                                value={motiu}
                                onChange={(e) => setMotiu(e.target.value)}
                                placeholder={t('cost.f_reason')}
                                aria-label={t('cost.f_reason')}
                              />
                            )
                            : <span className="line-clamp-2">{c?.motivo ?? '—'}</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dataCurta(c?.updated_at ?? null)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap justify-end gap-1">
                            {obert
                              ? (
                                <>
                                  <Input
                                    className="w-28"
                                    inputMode="decimal"
                                    value={valor}
                                    onChange={(e) => setValor(e.target.value)}
                                    aria-label={t('cost.f_cost')}
                                    autoFocus
                                  />
                                  <Button
                                    size="sm"
                                    className="h-11 whitespace-normal md:h-8"
                                    disabled={ocupat}
                                    onClick={() => void desa(p.nombre)}
                                  >
                                    {t('c.save')}
                                  </Button>
                                  <Button
                                    size="sm" variant="outline"
                                    className="h-11 whitespace-normal md:h-8"
                                    disabled={ocupat}
                                    onClick={() => setEditant(null)}
                                  >
                                    {t('c.cancel')}
                                  </Button>
                                </>
                              )
                              : potAprovar && (
                                <>
                                  <Button
                                    size="sm" variant="outline"
                                    className="h-11 whitespace-normal md:h-8"
                                    onClick={() => obreEdicio(p.nombre)}
                                  >
                                    {t(c ? 'cost.a_edit' : 'cost.a_set')}
                                  </Button>
                                  {c && (
                                    <BotoAmbMotiu
                                      size="sm" variant="outline"
                                      className="h-11 whitespace-normal md:h-8"
                                      disabled={!esSuperAdmin}
                                      motiu={esSuperAdmin ? undefined : t('cost.del_only_super')}
                                      onClick={() => setEsborrant(p.nombre)}
                                    >
                                      {t('c.delete')}
                                    </BotoAmbMotiu>
                                  )}
                                </>
                              )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
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
