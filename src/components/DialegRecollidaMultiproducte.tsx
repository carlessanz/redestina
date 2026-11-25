// La recogida REAL de una solicitud multiproducto, de una vez (proceso 3.3, fase 6c, 25-11-2026).
//
// `?recollida=<sollicitud>` —el enlace de RECOLLIDA CONFIRMADA de una solicitud— abre este
// diálogo: un producto por fila con lo que se ha recogido de verdad (coincideix · menys · més ·
// no recollit, con los kg reales y el motivo cuando difiere) y UN envío →
// `registrar_recollida_multiple()`.
//
//   · La ENTIDAD («Els meus interessos») DECLARA: cada línea queda pendiente de la validación del
//     equipo, que es quien emite el ENT y el REC de esa recogida (uno por producto).
//   · El EQUIPO (Aprovacions, nivel 1) registra y VALIDA en el mismo acto, como
//     `DialegRegistraRecollida`.
//   · «No recollit» ANULA esa canalización con el motivo y libera sus kg.
//   · Se puede registrar solo una parte (`Encara no`): lo recogido se cierra aunque otra línea
//     quede pendiente.
//
// 🔴 Todo o nada y la regla en la base: cada línea pasa por `registrar_recollida()` (o la
//    asistida). Si una falla no queda nada y se marca esa línea (`error.details`).
//
// `DialegValidaTotes` (abajo, componente aparte) es «Valida totes» del equipo en la cola
// «Recollides per validar»: `validar_recollides_sollicitud()` con un motivo común, obligatorio si
// alguna recogida declarada difiere de lo asignado.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { dataHora, kg as fmtKg } from '../lib/format'
import { localDateTime } from '../lib/franja'
import { estatValidacio, llegeixKg } from '../lib/registreRecollida'
import {
  idLiniaFallida, liniesRecollida, validaRecollidaMultiple, validaTotesCalMotiu,
  type LiniaRecollida, type ResultatLinia,
} from '../lib/sollicitudMultiproducte'
import { registraRecollidaMultiple, textErrorMultiple, validaRecollidesSollicitud } from '../lib/sollicituds'
import { cn } from '../lib/utils'
import Desplegable from './Desplegable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** Una canalización de la solicitud, con su producto. */
interface CanalSollicitud {
  id: string
  excedente_id: string | null
  kg_confirmados: number | null
  estado: string | null
  data_hora_recollida: string | null
  recollida_registrada_at: string | null
  recollida_validada_at: string | null
  recollida_retornada_at: string | null
  kg_declarats: number | null
  motiu_retorn: string | null
  excedentes: { producto: string | null; variedad: string | null } | null
  entidades: { nombre: string | null } | null
}

const RESULTATS: Exclude<ResultatLinia, ''>[] = ['coincideix', 'inferior', 'superior', 'no_recollit']

/** ¿Se puede registrar ahora? Sin registro todavía, o devuelta por el equipo. */
function registrable(c: CanalSollicitud): boolean {
  if (c.estado === 'anulada') return false
  const e = estatValidacio(c)
  return e === 'sense_registre' || e === 'retornada'
}

interface Props {
  /** La solicitud de la URL; `null` = cerrado. */
  sollicitudId: string | null
  /** El equipo registra y valida en un acto; la entidad solo declara. */
  equip: boolean
  onTanca: () => void
  /** Tras registrar: la pantalla relee lo suyo. */
  onFet: () => void
}

export default function DialegRecollidaMultiproducte({ sollicitudId, equip, onTanca, onFet }: Props) {
  const { t } = useT()
  const [canals, setCanals] = useState<CanalSollicitud[]>([])
  const [carregant, setCarregant] = useState(false)
  const [errorCarrega, setErrorCarrega] = useState(false)
  const [linies, setLinies] = useState<Record<string, LiniaRecollida>>({})
  const [quan, setQuan] = useState('')
  const [quanInicial, setQuanInicial] = useState('')
  const [enviant, setEnviant] = useState(false)
  const [intentat, setIntentat] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  useEffect(() => {
    if (!sollicitudId) return
    let viu = true
    setCarregant(true)
    setErrors({})
    setErrorGeneral(null)
    setIntentat(false)
    const ara = localDateTime(new Date().toISOString())
    setQuan(ara)
    setQuanInicial(ara)
    // ⚠️ Lista de columnas en UN literal (§7). La RLS deja a la entidad solo las suyas.
    void supabase.from('canalizaciones')
      .select('id, excedente_id, kg_confirmados, estado, data_hora_recollida, recollida_registrada_at, recollida_validada_at, recollida_retornada_at, kg_declarats, motiu_retorn, excedentes(producto, variedad), entidades(nombre)')
      .eq('sollicitud_id', sollicitudId)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!viu) return
        setCarregant(false)
        if (error) { setErrorCarrega(true); setCanals([]); return }
        setErrorCarrega(false)
        const cs = (data ?? []) as unknown as CanalSollicitud[]
        setCanals(cs)
        const ls: Record<string, LiniaRecollida> = {}
        for (const c of cs) {
          if (!registrable(c)) continue
          ls[c.id] = {
            canalizacion_id: c.id, resultat: 'coincideix',
            kg: c.kg_confirmados != null ? String(c.kg_confirmados) : '',
            kgAssignats: c.kg_confirmados != null ? Number(c.kg_confirmados) : null, motiu: '',
          }
        }
        setLinies(ls)
      })
    return () => { viu = false }
  }, [sollicitudId])

  const registrables = canals.filter(registrable)
  const altres = canals.filter((c) => !registrable(c))
  const entitat = canals[0]?.entidades?.nombre ?? null
  const quanIso = quan && quan !== quanInicial ? new Date(quan).toISOString() : null

  function canvia(id: string, c: Partial<LiniaRecollida>) {
    setLinies((p) => ({ ...p, [id]: { ...p[id], ...c } }))
    setErrors((e) => { const n = { ...e }; delete n[id]; return n })
    setErrorGeneral(null)
  }

  async function envia() {
    if (!sollicitudId) return
    setIntentat(true)
    const llista = registrables.map((c) => linies[c.id]).filter(Boolean)
    const v = validaRecollidaMultiple(llista, quanIso)
    const errs: Record<string, string> = {}
    for (const [id, clau] of Object.entries(v.perLinia)) errs[id] = t(clau)
    setErrors(errs)
    if (v.general) { setErrorGeneral(t(v.general)); return }
    if (Object.keys(errs).length > 0) { setErrorGeneral(t('smp.err_revisa')); return }
    const enviades = liniesRecollida(llista)
    setEnviant(true)
    const r = await registraRecollidaMultiple({ sollicitud: sollicitudId, linies: enviades, quan: quanIso })
    setEnviant(false)
    if (!r.ok) {
      const text = textErrorMultiple(t, r, 'recollida')
      const id = idLiniaFallida(r.detall, enviades.map((l) => String(l.canalizacion_id)))
      if (id) setErrors((e) => ({ ...e, [id]: text }))
      setErrorGeneral(text)
      toast.error(text)
      return
    }
    toast.success(t(equip ? 'smp.rec_validada' : 'smp.rec_declarada'))
    onFet()
  }

  /** En qué punto está una línea que ya no se registra aquí. */
  const estatLinia = (c: CanalSollicitud): string => {
    if (c.estado === 'anulada') return t('smp.st_anulada')
    const e = estatValidacio(c)
    if (e === 'validada') return t('smp.st_validada')
    if (e === 'pendent_validacio') return t('smp.st_registrada', { n: fmtKg(c.kg_declarats ?? c.kg_confirmados) })
    return ''
  }

  return (
    <Dialog open={sollicitudId != null} onOpenChange={(v) => { if (!v && !enviant) onTanca() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="dialeg-recollida-multi"
        onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('smp.rec_titol')}</DialogTitle>
          <DialogDescription>
            {t(equip ? 'smp.rec_desc_equip' : 'smp.rec_desc', { entitat: entitat ?? '—' })}
          </DialogDescription>
        </DialogHeader>

        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {!carregant && errorCarrega && <p className="text-sm text-error">{t('c.load_error')}</p>}
        {!carregant && !errorCarrega && canals.length === 0 && (
          <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso" data-testid="smp-rec-no-disponible">{t('smp.rec_no_disponible')}</p>
        )}
        {!carregant && !errorCarrega && canals.length > 0 && registrables.length === 0 && (
          <p className="rounded-md bg-exito-fondo p-3 text-sm text-exito" data-testid="smp-rec-fet">{t('smp.rec_res_pendent')}</p>
        )}

        {!carregant && registrables.length > 0 && (
          <div className="space-y-4">
            <ul className="space-y-2">
              {registrables.map((c, i) => {
                const l = linies[c.id]
                if (!l) return null
                const err = errors[c.id]
                const difereix = l.resultat === 'inferior' || l.resultat === 'superior'
                const ambMotiu = difereix || l.resultat === 'no_recollit'
                const kgEscrits = llegeixKg(l.kg)
                return (
                  <li key={c.id} data-testid="smp-rec-linia" data-canalitzacio={c.id}
                    className={cn('space-y-3 rounded-lg border p-3', err && 'border-error')}>
                    <div>
                      <div className="font-medium">
                        {c.excedentes?.producto ?? '—'}{c.excedentes?.variedad ? ` · ${c.excedentes.variedad}` : ''}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('smp.rec_assignats', { n: fmtKg(c.kg_confirmados) })}
                        {c.data_hora_recollida ? ` · ${dataHora(c.data_hora_recollida)}` : ''}
                      </div>
                      {estatValidacio(c) === 'retornada' && c.motiu_retorn && (
                        <p className="mt-1 rounded-md bg-aviso-fondo p-2 text-xs text-aviso">
                          {t('smp.rec_retornada', { motiu: c.motiu_retorn })}
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`smp-rec-res-${i}`} className="mb-1.5 block text-xs text-muted-foreground">{t('smp.rec_resultat')}</Label>
                        <Desplegable id={`smp-rec-res-${i}`} value={l.resultat}
                          onChange={(v) => canvia(c.id, { resultat: v as ResultatLinia })}
                          buit={t('smp.r_encara_no')}
                          opcions={RESULTATS.map((r) => ({ valor: r, text: t(`smp.r_${r}`) }))} />
                      </div>
                      {difereix && (
                        <div>
                          <Label htmlFor={`smp-rec-kg-${i}`} className="mb-1.5 block text-xs text-muted-foreground">{t('smp.rec_kg_reals')}</Label>
                          <Input id={`smp-rec-kg-${i}`} inputMode="decimal" className="text-base md:text-sm"
                            aria-invalid={err ? true : undefined}
                            value={l.kg} onChange={(e) => canvia(c.id, { kg: e.target.value })} />
                          {kgEscrits != null && l.kgAssignats != null && Math.abs(kgEscrits - l.kgAssignats) > 0.001 && (
                            <p className="mt-1 text-xs text-aviso">
                              {t('smp.rec_dif', { dif: `${kgEscrits > l.kgAssignats ? '+' : ''}${fmtKg(Math.round((kgEscrits - l.kgAssignats) * 100) / 100)}` })}
                            </p>
                          )}
                        </div>
                      )}
                      {ambMotiu && (
                        <div className="sm:col-span-2">
                          <Label htmlFor={`smp-rec-motiu-${i}`} className="mb-1.5 block text-xs text-muted-foreground">
                            {t(difereix ? 'smp.rec_motiu_obl' : 'smp.rec_motiu_no_recollit')}
                          </Label>
                          <Input id={`smp-rec-motiu-${i}`} className="text-base md:text-sm" maxLength={1000}
                            aria-invalid={intentat && err ? true : undefined}
                            value={l.motiu} onChange={(e) => canvia(c.id, { motiu: e.target.value })} />
                        </div>
                      )}
                    </div>
                    {l.resultat === 'no_recollit' && (
                      <p className="text-xs text-aviso">{t('smp.rec_no_recollit_avis')}</p>
                    )}
                    {err && <p role="alert" className="text-sm text-error" data-testid="smp-rec-error-linia">{err}</p>}
                  </li>
                )
              })}
            </ul>

            <div>
              <Label htmlFor="smp-rec-quan" className="mb-1.5 block text-xs text-muted-foreground">{t('smp.rec_quan')}</Label>
              <Input id="smp-rec-quan" type="datetime-local" className="h-11 text-base md:h-8 md:text-sm"
                value={quan} onChange={(e) => setQuan(e.target.value)} />
            </div>

            <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">
              {t(equip ? 'smp.rec_avis_equip' : 'smp.rec_avis')}
            </p>
          </div>
        )}

        {altres.length > 0 && (
          <ul className="space-y-1 text-sm" data-testid="smp-rec-altres">
            {altres.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 rounded-md border px-3 py-2">
                <span className="min-w-0">{c.excedentes?.producto ?? '—'}</span>
                <span className="text-muted-foreground">{estatLinia(c)}</span>
              </li>
            ))}
          </ul>
        )}

        {errorGeneral && <p role="alert" className="text-sm text-error" data-testid="smp-rec-error">{errorGeneral}</p>}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" className="h-11 md:h-8" disabled={enviant} onClick={onTanca}>
            {t(registrables.length > 0 ? 'c.cancel' : 'c.close')}
          </Button>
          {registrables.length > 0 && (
            <Button className="h-11 whitespace-normal md:h-8" disabled={enviant} data-testid="smp-rec-envia"
              onClick={() => void envia()}>
              {enviant && <Loader2 className="size-4 animate-spin" />}
              {t(equip ? 'smp.rec_envia_equip' : 'smp.rec_envia')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Una recogida declarada de la solicitud, tal como la enseña la cola «Recollides per validar». */
export interface RecollidaPerValidar {
  id: string
  producte: string
  kgAssignats: number | null
  kgDeclarats: number | null
}

/**
 * «Valida totes» (equipo): valida de una vez las recogidas declaradas de una solicitud
 * (`validar_recollides_sollicitud`), cada una con su ENT y su REC, emitidos y conciliados. El
 * motivo común es obligatorio si alguna difiere de lo asignado (`cal_motiu_validacio`).
 * No se cierra al pinchar fuera: con un motivo escrito y a media llamada, un clic sería caro.
 */
export function DialegValidaTotes({
  sollicitudId, entitat, recollides, onTanca, onFet,
}: {
  sollicitudId: string | null
  entitat: string | null
  recollides: readonly RecollidaPerValidar[]
  onTanca: () => void
  onFet: () => void
}) {
  const { t } = useT()
  const [motiu, setMotiu] = useState('')
  const [ocupat, setOcupat] = useState(false)
  const [intentat, setIntentat] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const calMotiu = validaTotesCalMotiu(recollides)

  useEffect(() => { setMotiu(''); setIntentat(false); setError(null) }, [sollicitudId])

  async function valida() {
    if (!sollicitudId) return
    setIntentat(true)
    if (calMotiu && motiu.trim() === '') return
    setOcupat(true)
    const r = await validaRecollidesSollicitud({ sollicitud: sollicitudId, motiu: motiu.trim() || null })
    setOcupat(false)
    if (!r.ok) { setError(textErrorMultiple(t, r, 'validacio')); return }
    toast.success(t('smp.vt_ok', { n: r.data.validades }))
    onFet()
  }

  return (
    <Dialog open={sollicitudId != null} onOpenChange={(v) => { if (!v && !ocupat) onTanca() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="dialeg-valida-totes"
        onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('smp.vt_titol')}</DialogTitle>
          <DialogDescription>{t('smp.vt_desc', { entitat: entitat ?? '—' })}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm">
          {recollides.map((r) => {
            const dif = r.kgAssignats != null && r.kgDeclarats != null && Math.abs(r.kgAssignats - r.kgDeclarats) > 0.001
            return (
              <li key={r.id} className={cn('flex flex-wrap justify-between gap-2 rounded-md border px-3 py-2', dif && 'border-aviso')}>
                <span className="min-w-0 font-medium">{r.producte}</span>
                <span className={cn('tabular-nums', dif ? 'text-aviso' : 'text-muted-foreground')}>
                  {t('vrec.kg', { a: fmtKg(r.kgAssignats), d: fmtKg(r.kgDeclarats) })}
                </span>
              </li>
            )
          })}
        </ul>
        <div className="space-y-1.5">
          <Label htmlFor="smp-vt-motiu">{t(calMotiu ? 'vrec.f_motiu_obl' : 'vrec.f_motiu')}</Label>
          <Textarea id="smp-vt-motiu" rows={3} value={motiu} onChange={(e) => setMotiu(e.target.value)}
            aria-invalid={intentat && calMotiu && motiu.trim() === '' ? true : undefined}
            placeholder={t('vrec.f_motiu_ph')} />
          {intentat && calMotiu && motiu.trim() === '' && (
            <p role="alert" className="text-sm text-error">{t('vrec.err_cal_motiu')}</p>
          )}
        </div>
        <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('smp.vt_avis')}</p>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" className="h-11 md:h-8" disabled={ocupat} onClick={onTanca}>{t('c.cancel')}</Button>
          <Button className="h-11 whitespace-normal md:h-8" disabled={ocupat} data-testid="smp-vt-confirma"
            onClick={() => void valida()}>
            {ocupat && <Loader2 className="size-4 animate-spin" />}{t('smp.vt_go', { n: recollides.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
