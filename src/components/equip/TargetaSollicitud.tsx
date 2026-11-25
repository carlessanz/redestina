// Aprovacions › una SOLICITUD multiproducto en UNA tarjeta (proceso 3.3, fase 6b, 25-11-2026).
//
// Una entidad pide varios productos de una disponibilidad con una sola fecha
// (`manifestar_interes_multiple`): cada producto es su interés (`oferta_respuestas`) con el mismo
// `sollicitud_id`. Aquí se resuelven juntos: por producto, aprobar (ajustando kg, modalidad y, en
// venta, precio) o rechazar con un motivo opcional; UNA fecha y hora para todo lo aprobado
// (prerrellenada con la que pidió); «Confirma» → `resoldre_sollicitud()`: una canalización por
// producto aprobado, un solo aviso por destinatario (`sollicitud_resolta`).
//
// 🔴 Tiene que resolver TODAS las líneas pendientes de la solicitud (`falten_linies`): la tarjeta
//    las pinta todas y cada una empieza en «Aprova». Todo o nada: si una falla, se marca su línea
//    (`error.details`) y no queda nada hecho.
//
// Mismas comprobaciones previas que `FormulariAprovacio` (canalizar de más y convenio que falta),
// con un solo diálogo de confirmación para toda la tarjeta.

import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { kg as fmtKg } from '../../lib/format'
import { localDateTime } from '../../lib/franja'
import { modalitatsOferta } from '../../lib/modalitats'
import { comprovaConvenis } from '../../lib/aprovarResposta'
import {
  idLiniaFallida, liniesResolucio, modalitatTriada, validaResolucio,
  type ErrorLinia, type LiniaResolucio,
} from '../../lib/sollicitudMultiproducte'
import { llegeixKg } from '../../lib/registreRecollida'
import { resolSollicitud, textErrorMultiple } from '../../lib/sollicituds'
import { cn } from '../../lib/utils'
import type { Modalitat } from '../../types'
import { useConfirma } from '../DialegConfirma'
import SelectorModalitat from '../SelectorModalitat'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import { FilaCasella } from '../Casella'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Lo que la tarjeta necesita de cada interés de la cola (`Aprovacions`). */
export interface FilaSollicitud {
  id: string
  excedente_id: string
  entidad_id: string | null
  kg_solicitados: number | null
  preu_ofert: number | null
  modalitat: Modalitat | null
  recollida_at: string | null
  canal: string
  respondido_at: string | null
  enviado_at: string
  sollicitud_id?: string | null
  entidades: { nombre: string; poblacion: string | null } | null
  excedentes: {
    id_excedente: string | null
    producto: string | null
    kg_total: number | null
    modalitat: string | null
    modalitats: Modalitat[] | null
    productor_id: string | null
    preu_minim: number | null
  } | null
}

interface Props {
  sollicitudId: string
  files: readonly FilaSollicitud[]
  /** Lo que falta por cubrir de cada oferta: contra eso se avisa al canalizar de más. */
  faltenDe: (excedenteId: string) => number
  potAprovar: boolean
  onFet: () => void
}

function liniaDe(f: FilaSollicitud): LiniaResolucio {
  const mods = modalitatsOferta({
    modalitat: (f.excedentes?.modalitat ?? null) as Modalitat | null,
    modalitats: f.excedentes?.modalitats ?? null,
  })
  const preu = f.preu_ofert ?? f.excedentes?.preu_minim ?? null
  return {
    resposta_id: f.id, accio: 'aprova',
    kg: f.kg_solicitados != null ? String(f.kg_solicitados) : '',
    modalitats: mods,
    modalitat: f.modalitat && mods.includes(f.modalitat) ? f.modalitat : mods.length === 1 ? mods[0] : '',
    preu: preu != null ? String(preu) : '', preuAcceptat: false, motiu: '',
  }
}

export default function TargetaSollicitud({ sollicitudId, files, faltenDe, potAprovar, onFet }: Props) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [linies, setLinies] = useState<Record<string, LiniaResolucio>>(
    () => Object.fromEntries(files.map((f) => [f.id, liniaDe(f)])),
  )
  const recollidaInicial = localDateTime(files.find((f) => f.recollida_at)?.recollida_at ?? null)
  const [recollida, setRecollida] = useState(recollidaInicial)
  const [ocupat, setOcupat] = useState(false)
  const [errors, setErrors] = useState<Record<string, ErrorLinia | string>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  const primera = files[0]
  const entitat = primera?.entidades
  const aprovades = files.filter((f) => linies[f.id]?.accio === 'aprova')

  function canvia(id: string, c: Partial<LiniaResolucio>) {
    setLinies((p) => ({ ...p, [id]: { ...(p[id] ?? liniaDe(files.find((f) => f.id === id)!)), ...c } }))
    setErrors((e) => { const n = { ...e }; delete n[id]; return n })
    setErrorGeneral(null)
  }

  async function confirmar() {
    const llista = files.map((f) => linies[f.id] ?? liniaDe(f))
    const errs = validaResolucio(llista)
    setErrors(errs)
    if (Object.keys(errs).length > 0) { setErrorGeneral(t('smp.err_revisa')); return }

    // Canalizar de más puede ser querido: se pregunta una vez por toda la tarjeta.
    const demes = aprovades.filter((f) => (llegeixKg(linies[f.id].kg) ?? 0) > faltenDe(f.excedente_id))
    if (demes.length > 0 && !(await confirma({
      titol: t('od.over_alloc_t'),
      descripcio: t('smp.over_alloc', { productes: demes.map((f) => f.excedentes?.producto ?? '—').join(', ') }),
    }))) return
    // Los convenios, antes (como `FormulariAprovacio`): desde la fecha de corte la base corta.
    if (primera?.entidad_id) {
      const faltes = new Set<string>()
      for (const f of aprovades) {
        const m = modalitatTriada(linies[f.id]) || f.excedentes?.modalitat || null
        const falta = await comprovaConvenis({ modalitat: m, productor_id: f.excedentes?.productor_id ?? null }, primera.entidad_id, t)
        if (falta) faltes.add(falta)
      }
      if (faltes.size > 0 && !(await confirma({
        titol: t('od.conv_missing_t'),
        descripcio: t('od.conv_missing', { parts: [...faltes].join(' · ') }),
      }))) return
    }

    setOcupat(true)
    const r = await resolSollicitud({
      sollicitud: sollicitudId,
      linies: liniesResolucio(llista),
      // Solo si se ha cambiado: si no, vale la que pidió la entidad.
      recollida: recollida && recollida !== recollidaInicial ? new Date(recollida).toISOString() : null,
    })
    setOcupat(false)
    if (!r.ok) {
      const text = textErrorMultiple(t, r, 'resolucio')
      const id = idLiniaFallida(r.detall, llista.map((l) => l.resposta_id))
      if (id) setErrors((e) => ({ ...e, [id]: text }))
      setErrorGeneral(text)
      toast.error(text)
      return
    }
    toast.success(t('smp.resolta', { a: r.data.aprovades.length, r: r.data.rebutjades.length }))
    onFet()
  }

  const textErr = (e: ErrorLinia | string | undefined) =>
    e == null ? null : typeof e === 'string' ? e : t(e.clau, e.vars)

  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="appr-sollicitud" data-sollicitud={sollicitudId}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t('smp.badge_sollicitud', { n: files.length })}</Badge>
        <span className="font-medium">
          {entitat?.nombre ?? '—'}{entitat?.poblacion ? ` · ${entitat.poblacion}` : ''}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t('smp.appr_hint')}</p>

      <ul className="space-y-2">
        {files.map((f) => {
          const l = linies[f.id] ?? liniaDe(f)
          const err = textErr(errors[f.id])
          const triada = modalitatTriada(l)
          const venda = triada === 'venda'
          const p = `appr-${f.id}`
          return (
            <li key={f.id} data-testid="appr-sollicitud-linia" data-resposta={f.id}
              className={cn('space-y-2 rounded-md border p-3', err && 'border-error', l.accio === 'rebutja' && 'bg-muted/40')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 basis-60">
                  <div className="font-medium">
                    {f.excedentes?.producto ?? '—'}
                    {f.excedentes?.id_excedente && (
                      <Link to={`/equip/ofertes/${f.excedente_id}`} className="ml-2 text-xs font-normal text-primary hover:underline">
                        <code>{f.excedentes.id_excedente}</code>
                      </Link>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      f.kg_solicitados != null ? t('smp.kg_demanats', { n: fmtKg(f.kg_solicitados) }) : null,
                      f.modalitat ? t(`od.mod_${f.modalitat}`) : null,
                      t('appr.progres', { n: fmtKg(faltenDe(f.excedente_id)), m: fmtKg(f.excedentes?.kg_total ?? 0) }),
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex gap-2" role="group" aria-label={t('smp.decisio')}>
                  <Button type="button" size="sm" className="h-11 md:h-8"
                    variant={l.accio === 'aprova' ? 'default' : 'outline'} aria-pressed={l.accio === 'aprova'}
                    disabled={ocupat} onClick={() => canvia(f.id, { accio: 'aprova' })}>
                    {t('smp.aprova')}
                  </Button>
                  <Button type="button" size="sm" className="h-11 md:h-8"
                    variant={l.accio === 'rebutja' ? 'default' : 'outline'} aria-pressed={l.accio === 'rebutja'}
                    disabled={ocupat} onClick={() => canvia(f.id, { accio: 'rebutja' })}>
                    {t('smp.rebutja')}
                  </Button>
                </div>
              </div>
              {l.accio === 'aprova' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor={`${p}-kg`} className="mb-1.5 block text-xs text-muted-foreground">{t('od.f_kg_assignats')}</Label>
                    <Input id={`${p}-kg`} type="number" inputMode="decimal" min="0" step="0.01"
                      className="text-base md:text-sm" aria-invalid={err ? true : undefined}
                      value={l.kg} onChange={(e) => canvia(f.id, { kg: e.target.value })} />
                  </div>
                  {l.modalitats.length > 1 && (
                    <div>
                      <Label htmlFor={`${p}-mode`} className="mb-1.5 block text-xs text-muted-foreground">{t('mod.entrega')}</Label>
                      <SelectorModalitat id={`${p}-mode`} modalitats={l.modalitats} valor={l.modalitat} ambBuit
                        className="h-11 w-full md:h-8" onCanvi={(m) => canvia(f.id, { modalitat: m })} />
                    </div>
                  )}
                  {venda && (
                    <div>
                      <Label htmlFor={`${p}-preu`} className="mb-1.5 block text-xs text-muted-foreground">{t('asg.preu_acordat')}</Label>
                      <Input id={`${p}-preu`} type="number" inputMode="decimal" min="0" step="0.01"
                        className="text-base md:text-sm"
                        value={l.preu} onChange={(e) => canvia(f.id, { preu: e.target.value })} />
                    </div>
                  )}
                  {venda && (
                    <div className="sm:col-span-3">
                      <FilaCasella checked={l.preuAcceptat} onChange={(v) => canvia(f.id, { preuAcceptat: v })}>
                        {t('asg.preu_acceptat')}
                      </FilaCasella>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <Label htmlFor={`${p}-motiu`} className="mb-1.5 block text-xs text-muted-foreground">{t('smp.motiu_rebuig')}</Label>
                  <Input id={`${p}-motiu`} className="text-base md:text-sm" maxLength={1000}
                    value={l.motiu} onChange={(e) => canvia(f.id, { motiu: e.target.value })} />
                </div>
              )}
              {err && <p role="alert" className="text-sm text-error" data-testid="appr-sollicitud-error">{err}</p>}
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <Label htmlFor={`appr-sol-${sollicitudId}-rec`} className="mb-1.5 block text-xs text-muted-foreground">
            {t('smp.recollida_comuna')}
          </Label>
          <Input id={`appr-sol-${sollicitudId}-rec`} type="datetime-local" className="h-11 text-base md:h-8 md:text-sm"
            value={recollida} disabled={aprovades.length === 0}
            onChange={(e) => setRecollida(e.target.value)} />
        </div>
        <BotoAmbMotiu className="h-11 w-full whitespace-normal sm:w-auto md:h-8" data-testid="appr-sollicitud-confirma"
          disabled={!potAprovar || ocupat} motiu={potAprovar ? undefined : t('appr.need_approver')}
          onClick={() => void confirmar()}>
          {t('smp.confirma', { a: aprovades.length, r: files.length - aprovades.length })}
        </BotoAmbMotiu>
      </div>
      {errorGeneral && <p role="alert" className="text-sm text-error">{errorGeneral}</p>}
      {dialeg}
    </div>
  )
}
