// «Registra l'interès»: el interés de una entidad, conducido por el equipo (gestión autónoma,
// fase 2). La entidad lo dice por teléfono —o el equipo lo decide en su nombre— y aquí se
// registra **exactamente como lo haría ella desde el Mercat**: kilos, modalidad, día y hora
// de recogida, precio y cajas.
//
// 🔴 PARIDAD CON EL RECEPTOR, Y LA IMPONE LA BASE. `manifestar_interes_assistit()` llama a la
//    misma `comprova_interes()` que `manifestar_interes()` (20270430100100): estado de la
//    oferta, compatibilidad y `cal_modalitat`, convenio, `kg_maxim`, precio mínimo y la hora
//    dentro de la franja. Esta pantalla ofrece lo mismo que el Mercat —las modalidades que el
//    tipo de esa entidad puede recibir (`modalitatsPossibles`) y las horas de la franja
//    (`CampsRecollida`)— para que no haya que chocar contra la base; y si se choca, el
//    rechazo se traduce con `clauErrorInteres()`, la misma función que usa el Mercat.
//
// Lo usan el ciclo guiado (`CanalitzacioDetall`, fase 4) y el detalle de la oferta
// (`OfferDetail`), donde sustituye a los atajos que escribían directo en `canalizaciones` y
// `oferta_respuestas` (deuda §12.109).

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { kg as fmtKg } from '../../lib/format'
import { isoRecollida } from '../../lib/franja'
import { modalitatsDelTipus, modalitatsOferta, modalitatsPossibles } from '../../lib/modalitats'
import { clauErrorInteres } from '../../lib/ofertes'
import { interesAssistit } from '../../lib/canalitzacio'
import type { Excedente, Modalitat } from '../../types'
import SelectorModalitat from '../SelectorModalitat'
import CampsRecollida from '../CampsRecollida'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type OfertaInteres = Pick<Excedente, 'id' | 'modalitat' | 'kg_total' | 'preu_minim' | 'disponible_hasta'>
  & Partial<Pick<Excedente, 'modalitats' | 'hora_recollida_inici' | 'hora_recollida_fi'>>

interface EntitatTria { id: string; nombre: string; tipo_receptor: string | null }

interface Props {
  oferta: OfertaInteres
  /** Prefijo de los `id`: el formulario puede convivir con otros en la misma pantalla. */
  idPrefix: string
  /** La entidad preseleccionada (p. ej. la de una fila «pendent» de las respuestas). */
  entitatInicial?: string
  /** Tras registrar: la pantalla relee las respuestas. */
  onFet?: () => void
}

export default function FormulariInteresAssistit({ oferta, idPrefix, entitatInicial = '', onFet }: Props) {
  const { t } = useT()
  const [entitats, setEntitats] = useState<EntitatTria[]>([])
  /** `modalitat_receptor_compat`; `null` = no se pudo leer (no se filtra: decide la base). */
  const [matriu, setMatriu] = useState<{ modalitat: string; tipo_receptor: string }[] | null>(null)
  const [entitat, setEntitat] = useState(entitatInicial)
  const [kg, setKg] = useState('')
  const [modalitat, setModalitat] = useState<Modalitat | ''>('')
  const [preu, setPreu] = useState(oferta.preu_minim != null ? String(oferta.preu_minim) : '')
  const [caixes, setCaixes] = useState('')
  const [dia, setDia] = useState('')
  const [hora, setHora] = useState('')
  const [ocupat, setOcupat] = useState(false)

  // Las entidades y la matriz se piden una vez y aparte: traerlas con cada refresco de la
  // pantalla cargaría cientos de filas sin motivo.
  useEffect(() => {
    let viu = true
    void (async () => {
      const [ents, mat] = await Promise.all([
        supabase.from('entidades').select('id, nombre, tipo_receptor').order('nombre').limit(500),
        supabase.from('modalitat_receptor_compat').select('modalitat, tipo_receptor'),
      ])
      if (!viu) return
      if (ents.data) setEntitats(ents.data as EntitatTria[])
      setMatriu(mat.error ? null : (mat.data as { modalitat: string; tipo_receptor: string }[]))
    })()
    return () => { viu = false }
  }, [])

  const triadaEnt = entitats.find((e) => e.id === entitat) ?? null
  // Lo mismo que puede pedir esa entidad desde el Mercat (sin el filtro de convenio: si le
  // falta, la base lo dice con `sense_conveni` y la fase 4 enseña cómo resolverlo).
  const mods = useMemo(() => (triadaEnt
    ? modalitatsPossibles(oferta, matriu ? modalitatsDelTipus(triadaEnt.tipo_receptor, matriu) : null)
    : modalitatsOferta(oferta)), [oferta, triadaEnt, matriu])
  const triada: Modalitat | '' = modalitat && mods.includes(modalitat) ? modalitat : mods.length === 1 ? mods[0] : ''
  // El precio, solo si la entrega ELEGIDA lleva precio: una donación no lo tiene aunque la
  // oferta también se ofrezca en venta.
  const ambPreuTriat = triada === 'venda' || triada === 'maquila'
  const senseCompat = triadaEnt !== null && mods.length === 0

  function canviaEntitat(v: string) {
    setEntitat(v)
    setModalitat('')
  }

  async function registra() {
    const nKg = Number(kg.replace(',', '.'))
    if (!entitat || !nKg || nKg <= 0) { toast.error(t('mk.need_kg')); return }
    if (oferta.kg_total != null && nKg > Number(oferta.kg_total)) {
      toast.error(t('mk.max_kg', { n: fmtKg(oferta.kg_total) }))
      return
    }
    if (mods.length > 1 && !triada) { toast.error(t('mk.need_mode')); return }
    if ((dia && !hora) || (!dia && hora)) { toast.error(t('mk.need_dia_hora')); return }
    setOcupat(true)
    const r = await interesAssistit({
      excedenteId: oferta.id,
      entitatId: entitat,
      kg: nKg,
      preu: ambPreuTriat && preu.trim() !== '' ? Number(preu.replace(',', '.')) : null,
      caixes: caixes.trim() !== '' ? Number(caixes) : null,
      modalitat: triada || null,
      recollida: isoRecollida(dia, hora),
    })
    setOcupat(false)
    if (!r.ok) {
      // Los rechazos de `comprova_interes()` con la misma traducción que el Mercat; lo que no
      // reconoce (un permiso, la red) cae al texto general.
      const e = clauErrorInteres(r.missatge)
      toast.error(e.clau === 'c.error' ? textError(t, r) : t(e.clau, e.vars))
      return
    }
    toast.success(t('canalz.ok_interes'))
    setEntitat(''); setKg(''); setModalitat(''); setCaixes(''); setDia(''); setHora('')
    setPreu(oferta.preu_minim != null ? String(oferta.preu_minim) : '')
    onFet?.()
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">{t('canalz.interes_title')}</p>
      <p className="text-xs text-muted-foreground">{t('canalz.interes_hint')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor={`${idPrefix}-entitat`} className="mb-1.5 block text-xs text-muted-foreground">
            {t('canalz.interes_entitat')}
          </Label>
          <select
            id={`${idPrefix}-entitat`}
            name="entitat"
            className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base md:h-9 md:text-sm"
            value={entitat}
            onChange={(e) => canviaEntitat(e.target.value)}
          >
            <option value="">—</option>
            {entitats.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-kg`} className="mb-1.5 block text-xs text-muted-foreground">
            {t('canalz.interes_kg')}
          </Label>
          <Input id={`${idPrefix}-kg`} name="kg" type="number" min="0" step="0.01" inputMode="decimal"
            max={oferta.kg_total != null ? String(oferta.kg_total) : undefined}
            value={kg} onChange={(e) => setKg(e.target.value)} />
          {oferta.kg_total != null && (
            <p className="mt-1 text-xs text-muted-foreground">{t('mk.max_kg', { n: fmtKg(oferta.kg_total) })}</p>
          )}
        </div>
      </div>

      {senseCompat && (
        <p className="rounded-md bg-aviso-fondo p-2 text-sm text-aviso">{t('canalz.interes_sense_compat')}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {mods.length > 1 && (
          <div>
            <Label htmlFor={`${idPrefix}-mode`} className="mb-1.5 block text-xs text-muted-foreground">{t('mod.entrega')}</Label>
            <SelectorModalitat id={`${idPrefix}-mode`} name="modalitat" modalitats={mods} valor={triada} ambBuit
              className="h-11 w-full md:h-9" onCanvi={setModalitat} />
          </div>
        )}
        {ambPreuTriat && (
          <div>
            <Label htmlFor={`${idPrefix}-preu`} className="mb-1.5 block text-xs text-muted-foreground">
              {t('canalz.interes_preu')}
            </Label>
            <Input id={`${idPrefix}-preu`} name="preu" type="number" min="0" step="0.01" inputMode="decimal"
              placeholder={oferta.preu_minim != null ? String(oferta.preu_minim) : undefined}
              value={preu} onChange={(e) => setPreu(e.target.value)} />
          </div>
        )}
        <div>
          <Label htmlFor={`${idPrefix}-caixes`} className="mb-1.5 block text-xs text-muted-foreground">
            {t('canalz.interes_caixes')}
          </Label>
          <Input id={`${idPrefix}-caixes`} name="caixes" type="number" min="0" step="1" inputMode="numeric"
            value={caixes} onChange={(e) => setCaixes(e.target.value)} />
        </div>
      </div>

      <CampsRecollida idPrefix={idPrefix} dia={dia} hora={hora} onDia={setDia} onHora={setHora}
        disponibleFins={oferta.disponible_hasta} inici={oferta.hora_recollida_inici} fi={oferta.hora_recollida_fi}
        ajuda={t('canalz.interes_rec_help')} />

      <Button
        className="h-11 w-full whitespace-normal sm:w-auto md:h-9"
        disabled={ocupat || !entitat || kg.trim() === '' || senseCompat || (ambPreuTriat && preu.trim() === '')}
        onClick={() => void registra()}
      >
        {t('canalz.b_interes_assistit')}
      </Button>
    </div>
  )
}
