// El diálogo de conciliar un albarán (extraído de `AlbaraDetall` el 27-10-2026, gestión
// autónoma, fase 5): lo usan la ficha del albarán y el ciclo guiado, que concilia en la misma
// pantalla en vez de mandar a otra. Dos piezas:
//
// - `DialegConciliar`: el formulario, sin red. Quien lo monta le da el albarán, sus líneas y
//   la propuesta, y recibe los kilos, el motivo y el destino.
// - `DialegConciliarAlbara`: lo mismo leyendo él todo eso a partir del id, y llamando a
//   `conciliar_albaran()`. Para quien no tiene el albarán cargado (el ciclo guiado).

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import {
  conciliarAlbara, dataCurta, kg, paramsConciliacio, propostaConciliacio, venciment,
} from '../../lib/albarans'
import type { PropostaConciliacio } from '../../lib/albarans'
import { incidenciesDiferencia, llegeixIncidencia } from '../../lib/incidenciaRecollida'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import type { AlbaranLinea } from '../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** Un input vacío no es 0 sino «no sé». */
function num(v: string): number | null {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

// ---------------------------------------------------------------------------
// Conciliar.
//
// En un REC, la propuesta del servidor con su semáforo: verde = la diferencia cabe en la
// tolerancia; rojo = no cabe, y entonces el motivo es obligatorio (la base lo exige desde
// `20270414100100`, `fora_de_tolerancia`) y hay que decir qué pasó con los kilos que no
// llegaron (`destino_final`). Y avisa de la CASCADA: conciliar el REC concilia también sus
// salidas ya confirmadas, con el mismo motivo.
//
// En un ENT o un OPE no hay propuesta —no hay nada con qué contrastar—: se validan sus
// propios kilos.
//
// En los tres, la misma regla del plazo, que es la de `conciliar_albaran()`: sin
// confirmación, solo con el plazo vencido y con motivo. Antes de vencer, el botón se
// apaga diciendo hasta cuándo: rellenar el formulario para que la base lo rechace no
// ayuda a nadie.
// ---------------------------------------------------------------------------
export default function DialegConciliar({
  obert, onObert, tipus, ambIncidencia, confirmat, venc, proposta, linies, ocupat, onConfirma,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  tipus: string
  /** La entidad receptora declaró una diferencia de kilos: la base exige motivo
   *  (`cal_motiu_incidencia`) aunque cuadre con la tolerancia. */
  ambIncidencia: boolean
  /** `albaranes.confirmado_at` no nulo. En un OPE, cuando han confirmado las dos partes. */
  confirmat: boolean
  /** Cuándo vence el plazo para conciliar sin confirmación (`null` = no consta entregado). */
  venc: Date | null
  proposta: PropostaConciliacio | null
  linies: AlbaranLinea[]
  ocupat: boolean
  onConfirma: (kgValidats: { linea_id: string; kg: number }[], motiu: string, desti: string) => void
}) {
  const { t } = useT()
  const [valors, setValors] = useState<Record<string, string>>({})
  const [motiu, setMotiu] = useState('')
  const [desti, setDesti] = useState('')

  useEffect(() => {
    if (!obert) return
    const inicial: Record<string, string> = {}
    for (const l of linies) {
      const v = l.kg_confirmados ?? l.kg_neto ?? l.kg_previstos
      inicial[l.id] = v != null ? String(v) : ''
    }
    setValors(inicial)
    setMotiu('')
    setDesti('')
  }, [obert, linies])

  const esRec = tipus === 'REC'
  if (esRec && !proposta) return null

  const fora = esRec && proposta != null && !proposta.dins_tolerancia
  // `Date.now()` en el render: es un aviso, no una regla; la que decide es la de la base.
  const ara = Date.now()
  const terminiVencut = venc != null && venc.getTime() < ara
  // Sin confirmación y sin plazo vencido la base lo rechaza: no hay motivo que lo arregle.
  const esperant = !confirmat && !terminiVencut
  const motiuObligatori = fora || !confirmat || ambIncidencia
  const potConfirmar = !ocupat && !esperant && (!motiuObligatori || motiu.trim() !== '')

  // Las salidas que se conciliarán con el REC (las confirmadas) y las que se quedan.
  const sortides = proposta?.entregues ?? []
  const nCascada = sortides.filter((e) => e.estat === 'confirmado').length
  const nEsperen = sortides.filter((e) => e.estat === 'emitido' || e.estat === 'entregado').length

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('alb.reconcile')}</DialogTitle>
          <DialogDescription>
            {t(esRec ? 'alb.reconcile_desc' : 'alb.rc_sortida_desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {/* El semáforo, solo en el REC. `exito` y `error` son tokens; el coral no
              significa fallo. */}
          {esRec && proposta && (
            <div className={`rounded-md p-3 ${fora ? 'bg-error-fondo text-error' : 'bg-exito-fondo text-exito'}`}>
              <p className="font-medium">
                {fora
                  ? t('alb.out_of_tolerance', { pct: proposta.diferencia_pct ?? 0, tol: proposta.tolerancia_pct })
                  : t('alb.in_tolerance', { tol: proposta.tolerancia_pct })}
              </p>
              <p>{t('alb.prop_reception', { kg: kg(proposta.kg_recepcio) })}</p>
              <p>{t('alb.prop_delivered', { kg: kg(proposta.kg_entregues) })}</p>
              <p>{t('alb.prop_diff', { kg: kg(proposta.diferencia) })}</p>
            </div>
          )}

          {/* El plazo: o se espera, o se concilia con motivo. Lo que dice la base. */}
          {esperant && (
            <p className="rounded-md bg-aviso-fondo p-3 text-aviso">
              {venc
                ? t('alb.rc_wait_deadline', { d: dataCurta(venc.toISOString()) })
                : t('alb.rc_wait_no_date')}
            </p>
          )}
          {!confirmat && terminiVencut && (
            <p className="rounded-md bg-aviso-fondo p-3 text-aviso">{t('alb.rc_no_confirm')}</p>
          )}

          {ambIncidencia && (
            <p className="rounded-md bg-aviso-fondo p-3 text-aviso">{t('alb.rc_incidencia')}</p>
          )}

          {/* La cascada (REC): qué se concilia con él y qué se queda esperando. */}
          {esRec && (
            <div className="rounded-md bg-secondary p-3 text-secondary-foreground">
              <p>{t('alb.rc_cascade', { n: nCascada })}</p>
              {nEsperen > 0 && <p className="mt-1">{t('alb.rc_cascade_pending', { n: nEsperen })}</p>}
            </div>
          )}
          {tipus === 'ENT' && (
            <p className="rounded-md bg-secondary p-3 text-secondary-foreground">{t('alb.rc_ent_hint')}</p>
          )}

          {esRec && sortides.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium">{t('alb.prop_entries')}</p>
              {sortides.map((e, i) => (
                <p key={`${e.albara ?? i}`} className="text-muted-foreground">
                  {e.albara ?? '—'} · {e.entitat ?? '—'} · {kg(e.kg)} kg · {t(`alb.st_${e.estat}`)}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <p className="font-medium">{t('alb.validated_kg')}</p>
            {linies.map((l) => (
              <div key={l.id} className="space-y-1.5">
                <Label htmlFor={`cv-${l.id}`}>{l.producto ?? t('alb.ln_product')}</Label>
                <Input
                  id={`cv-${l.id}`} type="number" inputMode="decimal" step="0.01"
                  value={valors[l.id] ?? ''}
                  onChange={(e) => setValors((p) => ({ ...p, [l.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cv-desti">{t('alb.final_destination')}</Label>
            <Input id="cv-desti" value={desti} placeholder={t('alb.final_destination_ph')}
              onChange={(e) => setDesti(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cv-motiu">{t('alb.reason')}</Label>
            <Textarea id="cv-motiu" rows={3} value={motiu} onChange={(e) => setMotiu(e.target.value)} />
            {motiuObligatori && motiu.trim() === '' && (
              <p className="text-xs text-muted-foreground">{t('alb.reason_required')}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onObert(false)} disabled={ocupat}>{t('c.cancel')}</Button>
          <Button className="whitespace-normal" disabled={!potConfirmar}
            onClick={() => onConfirma(
              linies
                .map((l) => ({ linea_id: l.id, kg: num(valors[l.id] ?? '') }))
                .filter((x): x is { linea_id: string; kg: number } => x.kg !== null),
              motiu, desti,
            )}>
            {t('alb.reconcile')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * El mismo diálogo, leyendo el albarán por su id. Lee lo que lee la ficha —líneas, plazo,
 * propuesta del REC y si hay una incidencia de recogida— y concilia con la misma RPC.
 */
export function DialegConciliarAlbara({
  albaraId, onTancar, onFet,
}: {
  /** El albarán a conciliar; `null` = cerrado. */
  albaraId: string | null
  onTancar: () => void
  onFet?: () => void
}) {
  const { t } = useT()
  const [dades, setDades] = useState<{
    tipus: string
    confirmat: boolean
    venc: Date | null
    proposta: PropostaConciliacio | null
    linies: AlbaranLinea[]
    ambIncidencia: boolean
  } | null>(null)
  const [ocupat, setOcupat] = useState(false)
  // `t` y `onTancar` cambian de identidad en cada render de quien lo monta: en refs, el efecto
  // lee el albarán UNA vez por id (el patrón de `useDescarregaDocument`).
  const tRef = useRef(t)
  tRef.current = t
  const tancaRef = useRef(onTancar)
  tancaRef.current = onTancar

  useEffect(() => {
    if (!albaraId) { setDades(null); return }
    const t = tRef.current
    const onTancar = () => tancaRef.current()
    let viu = true
    void (async () => {
      const { data: a, error } = await supabase.from('albaranes')
        .select('id, tipo, estado, confirmado_at, entregado_at, canalizacion_id, excedente_id, espigolada_id, incidencias')
        .eq('id', albaraId).maybeSingle()
      const fila = a as {
        id: string; tipo: string; confirmado_at: string | null; entregado_at: string | null
        canalizacion_id: string | null; excedente_id: string | null; espigolada_id: string | null
        incidencias: unknown
      } | null
      if (!viu) return
      if (error || !fila) { toast.error(textError(t, error?.message ?? null)); onTancar(); return }
      const consultaInc = fila.tipo !== 'REC' && fila.canalizacion_id
        ? supabase.from('canalizaciones').select('incidencia_recollida').eq('id', fila.canalizacion_id)
        : fila.tipo === 'REC' && fila.excedente_id && !fila.espigolada_id
          ? supabase.from('canalizaciones').select('incidencia_recollida')
            .eq('excedente_id', fila.excedente_id).not('incidencia_recollida', 'is', null)
          : null
      const [ln, params, prop, inc] = await Promise.all([
        supabase.from('albaran_lineas')
          .select('id, albaran_id, orden, producto, variedad, familia, causa, num_cajas, tipo_caja, kg_bruto, tara_kg, kg_neto, kg_previstos, kg_entregados, kg_confirmados, kg_validados, lote_origen, created_at')
          .eq('albaran_id', albaraId).order('orden'),
        paramsConciliacio(),
        fila.tipo === 'REC' ? propostaConciliacio(albaraId) : Promise.resolve(null),
        consultaInc ?? Promise.resolve({ data: [] as { incidencia_recollida: unknown }[] }),
      ])
      if (!viu) return
      if (prop && !prop.ok) { toast.error(textError(t, prop)); onTancar(); return }
      const delCanal = ((inc.data as { incidencia_recollida: unknown }[] | null) ?? [])
        .some((c) => llegeixIncidencia(c.incidencia_recollida) !== null)
      setDades({
        tipus: fila.tipo,
        confirmat: fila.confirmado_at != null,
        venc: venciment(fila.entregado_at, params.terminiDies),
        proposta: prop && prop.ok ? prop.data : null,
        linies: (ln.data as AlbaranLinea[] | null) ?? [],
        ambIncidencia: delCanal || incidenciesDiferencia(fila.incidencias).length > 0,
      })
    })()
    return () => { viu = false }
  }, [albaraId])

  async function concilia(kgValidats: { linea_id: string; kg: number }[], motiu: string, desti: string) {
    if (!albaraId || !dades) return
    setOcupat(true)
    const res = await conciliarAlbara(
      albaraId,
      kgValidats.length ? kgValidats : null,
      motiu.trim() || null,
      desti.trim() || null,
    )
    setOcupat(false)
    if (!res.ok) { toast.error(textError(t, res)); return }
    toast.success(t(dades.tipus === 'REC' ? 'alb.reconciled_rec' : 'alb.reconciled'))
    void refrescaComptadors()
    onFet?.()
    onTancar()
  }

  if (albaraId && !dades) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onTancar() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('alb.reconcile')}</DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />{t('c.loading')}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
  }
  if (!dades) return null
  return (
    <DialegConciliar
      obert={albaraId != null}
      onObert={(v) => { if (!v) onTancar() }}
      tipus={dades.tipus}
      ambIncidencia={dades.ambIncidencia}
      confirmat={dades.confirmat}
      venc={dades.venc}
      proposta={dades.proposta}
      linies={dades.linies}
      ocupat={ocupat}
      onConfirma={(k, m, d) => void concilia(k, m, d)}
    />
  )
}
