// «Preus» (punto 3, fase D1): la revisión de los precios de referencia de un mes.
//
// Una fila por producto con lo que propone la base (Gencat → Mercabarna → manual, o el manual
// si el producto es `preu_manual`), lo ya validado, el mes anterior validado y la variación
// (aviso si salta un 30 % o más). «Valida el mes» guarda lo que tenga propuesta y aún no esté
// validado; nada ya validado cambia sin motivo (el lápiz de cada fila). «Valida en bloc» es para
// la carga inicial de Gencat: rellena los meses pasados que falten, sin tocar lo validado.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { AlertTriangle, CheckCheck, Pencil } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { casaCerca } from '../../lib/cerca'
import { useCerca } from '../../hooks/useCerca'
import { usePuntTall } from '../../hooks/usePuntTall'
import { textError } from '../../lib/textError'
import { eurKg } from '../../lib/tancament'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import {
  MESOS, carregaCanalitzacionsMes, carregaPropostaMes, esMesFutur, mesDeParam, esSaltGran, exercicisDisponibles, fixaPreu, fontHaCanviat, mesActual,
  mesAnterior, preuDeFila, resumMes, textVariacio, validaMes, validaPeriode, valorDeFont, variacio,
  type CanalitzacionsMes, type FontPreu, type PropostaPreu,
} from '../../lib/preus'
import { useConfirma } from '../DialegConfirma'
import Desplegable from '../Desplegable'
import BotoIcona from '../BotoIcona'
import { FilaClicable } from '../FilaClicable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/** La ruta del detalle de un producto (la misma que `rutaProducte` de la pantalla). */
const rutaProducte = (nom: string) => `/equip/productes/${encodeURIComponent(nom)}`

export function BadgeFont({ font }: { font: FontPreu | null }) {
  const { t } = useT()
  if (!font) return null
  const estil = font === 'gencat' ? 'bg-secondary text-secondary-foreground'
    : font === 'mercabarna' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
  return <Badge className={estil}>{t(`preu.font_${font}`)}</Badge>
}

interface PropsBloc {
  obert: boolean
  onObert: (v: boolean) => void
  ocupat: boolean
  onConfirma: (des: { exercici: number; mes: number }, fins: { exercici: number; mes: number }) => void
}

/** El diálogo de «Valida en bloc»: desde / hasta (por defecto, todo lo pasado desde 2020). */
function DialegBloc({ obert, onObert, ocupat, onConfirma }: PropsBloc) {
  const { t } = useT()
  const anterior = mesAnterior(mesActual().exercici, mesActual().mes)
  const [desA, setDesA] = useState('2020')
  const [desM, setDesM] = useState('1')
  const [finsA, setFinsA] = useState(String(anterior.exercici))
  const [finsM, setFinsM] = useState(String(anterior.mes))
  const anys = exercicisDisponibles().map((a) => ({ valor: String(a), text: String(a) }))
  const mesos = MESOS.map((m) => ({ valor: String(m), text: t(`preu.mes_${m}`) }))
  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('preu.bloc_title')}</DialogTitle>
          <DialogDescription>{t('preu.bloc_desc')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bloc-des-a">{t('preu.bloc_from')}</Label>
            <Desplegable id="bloc-des-a" value={desA} onChange={setDesA} opcions={anys} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bloc-des-m" className="invisible">{t('preu.f_month')}</Label>
            <Desplegable id="bloc-des-m" value={desM} onChange={setDesM} opcions={mesos} aria-label={t('preu.f_month')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bloc-fins-a">{t('preu.bloc_to')}</Label>
            <Desplegable id="bloc-fins-a" value={finsA} onChange={setFinsA} opcions={anys} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bloc-fins-m" className="invisible">{t('preu.f_month')}</Label>
            <Desplegable id="bloc-fins-m" value={finsM} onChange={setFinsM} opcions={mesos} aria-label={t('preu.f_month')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onObert(false)} disabled={ocupat}>{t('c.cancel')}</Button>
          <Button disabled={ocupat} data-testid="preu-bloc-confirma"
            onClick={() => onConfirma({ exercici: Number(desA), mes: Number(desM) }, { exercici: Number(finsA), mes: Number(finsM) })}>
            {t('preu.a_validate_block')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface PropsEdicio {
  fila: PropostaPreu
  columnes: number
  ocupat: boolean
  onDesa: (font: FontPreu, eurKg: number | null, motiu: string) => void
  onCancel: () => void
}

/** La fila que se abre bajo un producto para fijar fuente o precio con motivo. */
function FilaEdicio({ fila, columnes, ocupat, onDesa, onCancel }: PropsEdicio) {
  const { t } = useT()
  const inicial = preuDeFila(fila)
  const [font, setFont] = useState<string>(inicial.font ?? 'manual')
  const [valor, setValor] = useState(inicial.eur_kg === null ? '' : String(inicial.eur_kg))
  const [motiu, setMotiu] = useState('')
  const opcions = (['gencat', 'mercabarna', 'manual'] as const).map((f) => {
    const v = valorDeFont(fila, f)
    return { valor: f, text: `${t(`preu.font_${f}`)}${v === null ? '' : ` · ${eurKg(v)}`}` }
  })
  function triaFont(f: string) {
    setFont(f)
    const v = valorDeFont(fila, f as FontPreu)
    if (v !== null) setValor(String(v))
  }
  function desa() {
    const n = valor.trim() === '' ? null : Number(valor.trim().replace(',', '.'))
    if (n !== null && (Number.isNaN(n) || n <= 0)) { toast.error(t('cost.bad_value')); return }
    if (motiu.trim() === '') { toast.error(t('cost.reason_required')); return }
    onDesa(font as FontPreu, n, motiu.trim())
  }
  return (
    <TableRow className="bg-muted/50 hover:bg-muted/50">
      <TableCell colSpan={columnes} className="whitespace-normal">
        <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[12rem_8rem_minmax(0,1fr)_auto]"
          onSubmit={(e) => { e.preventDefault(); desa() }}>
          <div className="space-y-1.5">
            <Label htmlFor="preu-font">{t('preu.f_source')}</Label>
            <Desplegable id="preu-font" value={font} onChange={triaFont} opcions={opcions} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="preu-valor">{t('cost.f_cost')}</Label>
            <Input id="preu-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="preu-motiu">{t('cost.f_reason')}</Label>
            <Input id="preu-motiu" value={motiu} onChange={(e) => setMotiu(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="h-11 w-full sm:w-auto md:h-8" disabled={ocupat}>{t('c.save')}</Button>
            <Button type="button" variant="outline" className="h-11 w-full sm:w-auto md:h-8" disabled={ocupat} onClick={onCancel}>
              {t('c.cancel')}
            </Button>
          </div>
        </form>
      </TableCell>
    </TableRow>
  )
}

export default function PestanyaPreus({ potAprovar }: { potAprovar: boolean }) {
  const { t } = useT()
  // `?mes=aaaa-mm` (D2): los enlaces de un certificado bloqueado traen aquí el mes que falta.
  const [params] = useSearchParams()
  const mesParam = params.get('mes')
  const actual = mesActual()
  const inicial = mesDeParam(mesParam) ?? mesAnterior(actual.exercici, actual.mes)
  const [exercici, setExercici] = useState(inicial.exercici)
  const [mes, setMes] = useState(inicial.mes)
  useEffect(() => {
    const m = mesDeParam(mesParam)
    if (!m) return
    setExercici(m.exercici)
    setMes(m.mes)
  }, [mesParam])
  /** Las canalizaciones que esperan el precio de este mes, por producto (D2). */
  const [esperen, setEsperen] = useState<CanalitzacionsMes[]>([])
  const [files, setFiles] = useState<PropostaPreu[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)
  const [editant, setEditant] = useState<string | null>(null)
  const [nomesPendents, setNomesPendents] = useState(false)
  const [bloc, setBloc] = useState(false)
  const { cerca, setCerca, q } = useCerca()
  const { confirma, dialeg } = useConfirma()
  const columnes = 3 + Number(usePuntTall('sm')) + Number(usePuntTall('md')) + Number(usePuntTall('lg')) + Number(potAprovar)

  const carrega = useCallback(async () => {
    const [r, c] = await Promise.all([carregaPropostaMes(exercici, mes), carregaCanalitzacionsMes(exercici, mes)])
    // Lo que espera es un aviso: si falla, la tabla de precios sigue sirviendo.
    setEsperen(c.ok ? (c.data ?? []) : [])
    if (!r.ok) { setError(textError(t, r)); setFiles([]); return }
    setError(null)
    setFiles(r.data ?? [])
  }, [exercici, mes, t])

  useEffect(() => {
    let viu = true
    setCarregant(true)
    setEditant(null)
    void carrega().finally(() => { if (viu) setCarregant(false) })
    return () => { viu = false }
  }, [carrega])

  const resum = useMemo(() => resumMes(files), [files])
  const visibles = useMemo(() => files.filter((p) => {
    if (nomesPendents && p.validat_eur_kg !== null) return false
    return casaCerca([p.producto, p.familia, p.gencat_nom, p.mercabarna_nom], q)
  }), [files, nomesPendents, q])
  const futur = esMesFutur(exercici, mes)
  const esperaPerProducte = useMemo(() => new Map(esperen.map((e) => [e.producto, e])), [esperen])
  const totalEsperen = esperen.reduce((a, e) => a + e.provisionals, 0)
  const senseCapPreu = esperen.filter((e) => e.sense_preu > 0).map((e) => e.producto)

  async function validaTot() {
    const ok = await confirma({
      titol: t('preu.validate_q', { m: `${t(`preu.mes_${mes}`)} ${exercici}` }),
      descripcio: t('preu.validate_desc', { n: resum.perValidar }),
      confirmar: t('preu.a_validate'),
    })
    if (!ok) return
    setOcupat(true)
    const r = await validaMes(exercici, mes)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('preu.validated', { n: r.data.validats }))
    void refrescaComptadors()
    await carrega()
  }

  async function validaBloc(des: { exercici: number; mes: number }, fins: { exercici: number; mes: number }) {
    setOcupat(true)
    const r = await validaPeriode(des, fins)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    setBloc(false)
    toast.success(t('preu.block_validated', { n: r.data.validats, m: r.data.mesos }))
    void refrescaComptadors()
    await carrega()
  }

  async function desaFila(p: PropostaPreu, font: FontPreu, valor: number | null, motiu: string) {
    setOcupat(true)
    const r = await fixaPreu(p.producto, exercici, mes, font, valor, motiu)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('preu.saved', { p: p.producto }))
    setEditant(null)
    await carrega()
  }

  const anys = exercicisDisponibles().map((a) => ({ valor: String(a), text: String(a) }))
  const mesos = MESOS.map((m) => ({ valor: String(m), text: t(`preu.mes_${m}`) }))

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('preu.subtitle')}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_10rem_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor="preu-any">{t('preu.f_year')}</Label>
          <Desplegable id="preu-any" value={String(exercici)} onChange={(v) => setExercici(Number(v))} opcions={anys} data-testid="preu-any" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preu-mes">{t('preu.f_month')}</Label>
          <Desplegable id="preu-mes" value={String(mes)} onChange={(v) => setMes(Number(v))} opcions={mesos} data-testid="preu-mes" />
        </div>
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="preu-cerca">{t('c.search')}</Label>
          <Input id="preu-cerca" type="search" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder={t('cost.search')} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="preu-resum">
        <Badge className="bg-exito-fondo text-exito">{t('preu.n_validated', { n: resum.validats })}</Badge>
        <Badge className={resum.perValidar > 0 ? 'bg-aviso-fondo text-aviso' : 'bg-secondary text-secondary-foreground'}>
          {t('preu.n_pending', { n: resum.perValidar })}
        </Badge>
        <Badge className={resum.sensePreu > 0 ? 'bg-error-fondo text-error' : 'bg-secondary text-secondary-foreground'}>
          {t('preu.n_without', { n: resum.sensePreu })}
        </Badge>
        {resum.salts > 0 && <Badge className="bg-aviso-fondo text-aviso">{t('preu.n_jumps', { n: resum.salts })}</Badge>}
        <Button size="sm" variant={nomesPendents ? 'default' : 'outline'} className="h-11 md:h-8"
          onClick={() => setNomesPendents((v) => !v)}>
          {t('preu.only_pending')}
        </Button>
      </div>

      {totalEsperen > 0 && (
        <div className="rounded-md border border-aviso bg-aviso-fondo p-3 text-sm" data-testid="preu-esperen">
          <p className="font-medium text-aviso">
            {t('preu.waiting', { n: totalEsperen, m: `${t(`preu.mes_${mes}`)} ${exercici}` })}
          </p>
          <p className="mt-1 text-muted-foreground">{t('preu.waiting_desc')}</p>
          {senseCapPreu.length > 0 && (
            <p className="mt-1 text-error">{t('preu.waiting_without', { p: senseCapPreu.join(', ') })}</p>
          )}
        </div>
      )}

      {potAprovar && (
        <div className="flex flex-wrap gap-2">
          <Button className="h-11 md:h-8" disabled={ocupat || futur || resum.perValidar === 0}
            onClick={() => void validaTot()} data-testid="preu-valida-mes">
            <CheckCheck className="size-4" aria-hidden /> {t('preu.a_validate')}
          </Button>
          <Button variant="outline" className="h-11 md:h-8" disabled={ocupat} onClick={() => setBloc(true)}>
            {t('preu.a_validate_block')}
          </Button>
        </div>
      )}
      {!potAprovar && <p className="text-sm text-muted-foreground">{t('preu.readonly')}</p>}
      {futur && <p className="text-sm text-muted-foreground">{t('preu.future')}</p>}

      {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!carregant && visibles.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">{t('cost.no_match')}</p>
      )}

      {visibles.length > 0 && (
        <Table data-testid="preu-taula">
          <TableHeader>
            <TableRow>
              <TableHead className="text-center whitespace-normal">{t('cost.c_product')}</TableHead>
              <TableHead className="w-28 text-center whitespace-normal sm:w-36">{t('preu.c_price')}</TableHead>
              <TableHead className="hidden text-center whitespace-normal sm:table-cell">{t('preu.c_source')}</TableHead>
              <TableHead className="hidden w-32 text-center whitespace-normal md:table-cell">{t('preu.c_previous')}</TableHead>
              <TableHead className="hidden w-24 text-center whitespace-normal lg:table-cell">{t('preu.c_change')}</TableHead>
              <TableHead className="w-12 text-center whitespace-normal">
                <span className="sr-only">{t('preu.c_state')}</span>
              </TableHead>
              {potAprovar && (
                <TableHead className="w-15 text-center whitespace-normal">
                  <span className="sr-only">{t('doc.c_actions')}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map((p) => {
              const preu = preuDeFila(p)
              const v = variacio(preu.eur_kg, p.anterior_eur_kg)
              const salt = esSaltGran(v)
              const canviat = fontHaCanviat(p)
              const detall = (preu.validat ? p.validat_nom : (p.proposta_font === 'gencat' ? p.gencat_nom : p.proposta_font === 'mercabarna' ? p.mercabarna_nom : null))
              const dies = preu.validat ? p.validat_dies : (p.proposta_font === 'mercabarna' ? p.mercabarna_dies : null)
              const obert = editant === p.producto
              return (
                <Fragment key={p.producto}>
                  <FilaClicable className={obert ? 'bg-muted/50' : undefined} data-producte={p.producto} to={rutaProducte(p.producto)}>
                    <TableCell className="whitespace-normal break-words">
                      <Link to={rutaProducte(p.producto)} className="font-medium text-primary hover:underline">{p.producto}</Link>
                      {p.familia && <span className="block text-xs text-muted-foreground">{p.familia}</span>}
                      {p.preu_manual && <span className="block text-xs text-muted-foreground">{t('preu.manual_product')}</span>}
                      {(esperaPerProducte.get(p.producto)?.provisionals ?? 0) > 0 && (
                        <Badge className="mt-1 bg-aviso-fondo text-aviso" data-testid="preu-espera-fila">
                          {t('preu.waiting_row', { n: esperaPerProducte.get(p.producto)!.provisionals })}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center tabular-nums whitespace-normal">
                      {preu.eur_kg === null
                        ? <Badge className="bg-error-fondo text-error">{t('preu.without')}</Badge>
                        : <span className={preu.validat ? 'font-medium' : 'text-muted-foreground'}>{eurKg(preu.eur_kg)}</span>}
                      <span className="block text-xs sm:hidden"><BadgeFont font={preu.font} /></span>
                    </TableCell>
                    <TableCell className="hidden text-center whitespace-normal sm:table-cell">
                      <BadgeFont font={preu.font} />
                      {detall && <span className="block text-xs text-muted-foreground">{detall}</span>}
                      {dies !== null && dies !== undefined && (
                        <span className="block text-xs text-muted-foreground">{t('preu.days', { n: dies })}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-center tabular-nums whitespace-normal text-muted-foreground md:table-cell">
                      {p.anterior_eur_kg === null ? '—' : (
                        <>
                          {eurKg(p.anterior_eur_kg)}
                          <span className="block text-xs">{t(`preu.mes_${p.anterior_mes}`)} {p.anterior_exercici}</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-center tabular-nums lg:table-cell">
                      {salt
                        ? <Badge className="bg-aviso-fondo text-aviso">{textVariacio(v)}</Badge>
                        : <span className="text-muted-foreground">{textVariacio(v)}</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        {preu.validat
                          ? <Badge className="bg-exito-fondo text-exito">{t('preu.validated_short')}</Badge>
                          : preu.eur_kg !== null && <Badge className="bg-aviso-fondo text-aviso">{t('preu.proposed_short')}</Badge>}
                        {(canviat || salt) && (
                          <span title={canviat ? t('preu.source_changed') : t('preu.jump')} className="text-aviso">
                            <AlertTriangle className="size-4" aria-label={canviat ? t('preu.source_changed') : t('preu.jump')} />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    {potAprovar && (
                      <TableCell className="text-center">
                        <BotoIcona icona={Pencil} etiqueta={t('preu.a_edit')} aria-expanded={obert}
                          disabled={futur} motiu={t('preu.future')}
                          onClick={() => setEditant(obert ? null : p.producto)} />
                      </TableCell>
                    )}
                  </FilaClicable>
                  {obert && (
                    <FilaEdicio fila={p} columnes={columnes} ocupat={ocupat}
                      onCancel={() => setEditant(null)}
                      onDesa={(f, val, m) => void desaFila(p, f, val, m)} />
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}

      <DialegBloc obert={bloc} onObert={setBloc} ocupat={ocupat} onConfirma={(d, f) => void validaBloc(d, f)} />
      {dialeg}
    </div>
  )
}
