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
//
// DOS NIVELES (puntos 4-6, fase 2, 20270607100000). Quien puede aprobar (`pot_aprovar()`:
// admin o super_admin) registra y confirma en UN acto con `assignar_directe()`: el botón dice
// «Registrar i confirmar recollida» y no queda nada en Aprovacions. En VENTA pide además el
// precio ACORDADO y que el ofertante lo ha aceptado (los dos obligatorios, la base también
// los exige); en maquila y donación no hay precio. Sin `pot_aprovar()` (el `tecnic`,
// retirado el 25-11-2026) queda el flujo de siempre: «Registra l'interès» →
// `manifestar_interes_assistit()` → lo aprueba otro del equipo (nivel 2).

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { kg as fmtKg } from '../../lib/format'
import { isoRecollida } from '../../lib/franja'
import { modalitatsDelTipus, modalitatsOferta, modalitatsPossibles } from '../../lib/modalitats'
import { clauErrorInteres } from '../../lib/ofertes'
import { modalitatsDeLaNaturalesa } from '../../lib/naturalesa'
import { assignarDirecte, interesAssistit } from '../../lib/canalitzacio'
import { comprovaConvenis } from '../../lib/aprovarResposta'
import type { Excedente, Modalitat } from '../../types'
import SelectorModalitat from '../SelectorModalitat'
import CampsRecollida from '../CampsRecollida'
import SelectorEntitat from '../SelectorEntitat'
import { opcioFitxa } from '../../lib/opcionsSelector'
import { FilaCasella } from '../Casella'
import { useConfirma } from '../DialegConfirma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type OfertaInteres = Pick<Excedente, 'id' | 'modalitat' | 'kg_total' | 'preu_minim' | 'disponible_hasta'>
  & Partial<Pick<Excedente, 'modalitats' | 'hora_recollida_inici' | 'hora_recollida_fi' | 'productor_id' | 'dies_recollida'>>

/** Códigos de `assignar_directe()` que traduce `textError()` (antes que `clauErrorInteres()`). */
const CODIS_DIRECTE = /^(cal_preu_acordat|cal_preu_acceptat|preu_invalid|ja_assignada|hora_passada)/

interface EntitatTria {
  id: string
  nombre: string
  /** Para el buscador: municipio de detalle, NIF y razón social como claves (`opcioFitxa`). */
  poblacion: string | null
  nif: string | null
  razon_social: string | null
  tipo_receptor: string | null
  /** A5: la naturalesa de su organización; solo confirmada restringe (P8). */
  organizaciones: { naturalesa: string | null; naturalesa_origen: string | null } | null
}
type ReglaNaturalesa = { modalitat: string; naturalesa: string }

interface Props {
  oferta: OfertaInteres
  /** Prefijo de los `id`: el formulario puede convivir con otros en la misma pantalla. */
  idPrefix: string
  /** La entidad preseleccionada (p. ej. la de una fila «pendent» de las respuestas). */
  entitatInicial?: string
  /**
   * Quien lo usa puede aprobar (`pot_aprovar()`): asigna en un acto (`assignar_directe`).
   * Sin él, registra el interés y lo aprueba un admin (nivel 2).
   */
  potAprovar: boolean
  /** Lo que falta por cubrir: al asignar de más se pregunta (como al aprobar). */
  faltan?: number
  /** Tras registrar: la pantalla relee las respuestas. */
  onFet?: () => void
}

export default function FormulariInteresAssistit({
  oferta, idPrefix, entitatInicial = '', potAprovar, faltan, onFet,
}: Props) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [entitats, setEntitats] = useState<EntitatTria[]>([])
  /** `modalitat_receptor_compat`; `null` = no se pudo leer (no se filtra: decide la base). */
  const [matriu, setMatriu] = useState<{ modalitat: string; tipo_receptor: string }[] | null>(null)
  /** `modalitat_naturalesa_compat` (A5); `null` = no se pudo leer (no se filtra). */
  const [reglaNat, setReglaNat] = useState<ReglaNaturalesa[] | null>(null)
  const [entitat, setEntitat] = useState(entitatInicial)
  const [kg, setKg] = useState('')
  const [modalitat, setModalitat] = useState<Modalitat | ''>('')
  const [preu, setPreu] = useState(oferta.preu_minim != null ? String(oferta.preu_minim) : '')
  const [caixes, setCaixes] = useState('')
  // Venta en un acto: el ofertante ha aceptado el precio acordado (obligatorio).
  const [acceptat, setAcceptat] = useState(false)
  const [dia, setDia] = useState('')
  const [hora, setHora] = useState('')
  const [ocupat, setOcupat] = useState(false)

  // Las entidades y la matriz se piden una vez y aparte: traerlas con cada refresco de la
  // pantalla cargaría cientos de filas sin motivo.
  useEffect(() => {
    let viu = true
    void (async () => {
      const [ents, mat, nat] = await Promise.all([
        // Solo las activas (1A): `comprova_interes()` rechaza una inactiva con `entitat_inactiva`.
        supabase.from('entidades').select('id, nombre, poblacion, nif, razon_social, tipo_receptor, organizaciones(naturalesa, naturalesa_origen)')
          .eq('activo', true).order('nombre').limit(500),
        supabase.from('modalitat_receptor_compat').select('modalitat, tipo_receptor'),
        supabase.from('modalitat_naturalesa_compat').select('modalitat, naturalesa'),
      ])
      if (!viu) return
      if (ents.data) setEntitats(ents.data as unknown as EntitatTria[])
      setMatriu(mat.error ? null : (mat.data as { modalitat: string; tipo_receptor: string }[]))
      setReglaNat(nat.error ? null : (nat.data as ReglaNaturalesa[]))
    })()
    return () => { viu = false }
  }, [])

  const triadaEnt = entitats.find((e) => e.id === entitat) ?? null
  // El buscador de entidades (19-11-2026): por nombre, municipio, NIF o razón social.
  const opcionsEnt = useMemo(
    () => entitats.map((e) => opcioFitxa({ id: e.id, nom: e.nombre, poblacio: e.poblacion, nif: e.nif, rao: e.razon_social })),
    [entitats],
  )
  // Lo mismo que puede pedir esa entidad desde el Mercat (sin el filtro de convenio: si le
  // falta, la base lo dice con `sense_conveni` y la fase 4 enseña cómo resolverlo).
  // A5: y, con la naturalesa confirmada, solo lo que admite P8 (el mismo cruce que `comprova_interes()`).
  const mods = useMemo(() => {
    if (!triadaEnt) return modalitatsOferta(oferta)
    const perTipus = modalitatsPossibles(oferta, matriu ? modalitatsDelTipus(triadaEnt.tipo_receptor, matriu) : null)
    const o = triadaEnt.organizaciones
    const perNat = modalitatsDeLaNaturalesa(o?.naturalesa, o?.naturalesa_origen, reglaNat)
    return perNat ? perTipus.filter((m) => perNat.includes(m)) : perTipus
  }, [oferta, triadaEnt, matriu, reglaNat])
  const triada: Modalitat | '' = modalitat && mods.includes(modalitat) ? modalitat : mods.length === 1 ? mods[0] : ''
  // El precio, solo si la entrega ELEGIDA es una venta: una donación no lo tiene aunque la
  // oferta también se ofrezca en venta, y la maquila tampoco (deuda 180, 20270607100000).
  const ambPreuTriat = triada === 'venda'
  // En un acto, la venta exige además la aceptación del ofertante.
  const calAcceptat = potAprovar && ambPreuTriat
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
    if (potAprovar) { await assigna(nKg); return }
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
    buida()
    onFet?.()
  }

  function buida() {
    setEntitat(''); setKg(''); setModalitat(''); setCaixes(''); setDia(''); setHora(''); setAcceptat(false)
    setPreu(oferta.preu_minim != null ? String(oferta.preu_minim) : '')
  }

  /** Nivel 1: interés + aprobación + canalización confirmada, en un acto. */
  async function assigna(nKg: number) {
    const nPreu = ambPreuTriat && preu.trim() !== '' ? Number(preu.replace(',', '.')) : null
    if (ambPreuTriat && (nPreu == null || Number.isNaN(nPreu) || nPreu < 0)) { toast.error(t('asg.err_cal_preu')); return }
    if (calAcceptat && !acceptat) { toast.error(t('asg.err_cal_acceptat')); return }
    // Aviso no bloqueante, igual que al aprobar: asignar más de lo que falta puede ser querido.
    if (faltan != null && nKg > faltan && !(await confirma({
      titol: t('od.over_alloc_t'),
      descripcio: t('od.over_alloc', { n: fmtKg(faltan) }),
    }))) return
    // Los convenios, antes: desde la fecha de corte la base corta con `sense_conveni`.
    const perConveni = { modalitat: triada || oferta.modalitat, productor_id: oferta.productor_id ?? null }
    const falta = await comprovaConvenis(perConveni, entitat, t)
    if (falta && !(await confirma({
      titol: t('od.conv_missing_t'),
      descripcio: t('od.conv_missing', { parts: falta }),
    }))) return

    setOcupat(true)
    const r = await assignarDirecte({
      excedenteId: oferta.id,
      entitatId: entitat,
      kg: nKg,
      modalitat: triada || null,
      recollida: isoRecollida(dia, hora),
      caixes: caixes.trim() !== '' ? Number(caixes) : null,
      preu: nPreu,
      preuAcceptat: calAcceptat && acceptat,
    })
    setOcupat(false)
    if (!r.ok) {
      // A quién le falta el convenio, si es eso (el genérico mandaba a mirar la ficha equivocada).
      if (r.missatge.includes('sense_conveni')) {
        const qui = await comprovaConvenis(perConveni, entitat, t)
        if (qui) { toast.error(t('od.conv_missing', { parts: qui })); return }
      }
      if (CODIS_DIRECTE.test(r.missatge)) { toast.error(textError(t, r)); return }
      const e = clauErrorInteres(r.missatge)
      toast.error(e.clau === 'c.error' ? textError(t, r) : t(e.clau, e.vars))
      return
    }
    toast.success(t('asg.ok'))
    buida()
    onFet?.()
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">{t(potAprovar ? 'asg.titol' : 'canalz.interes_title')}</p>
      <p className="text-xs text-muted-foreground">{t(potAprovar ? 'asg.hint' : 'canalz.interes_hint')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor={`${idPrefix}-entitat`} className="mb-1.5 block text-xs text-muted-foreground">
            {t('canalz.interes_entitat')}
          </Label>
          <SelectorEntitat
            id={`${idPrefix}-entitat`}
            valor={entitat}
            onChange={canviaEntitat}
            buit={t('c.none')}
            placeholder={t('sel.entitat')}
            opcions={opcionsEnt}
          />
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
              className="h-11 w-full md:h-8" onCanvi={setModalitat} />
          </div>
        )}
        {ambPreuTriat && (
          <div>
            <Label htmlFor={`${idPrefix}-preu`} className="mb-1.5 block text-xs text-muted-foreground">
              {t(potAprovar ? 'asg.preu_acordat' : 'canalz.interes_preu')}
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

      {calAcceptat && (
        <FilaCasella checked={acceptat} onChange={setAcceptat}>{t('asg.preu_acceptat')}</FilaCasella>
      )}

      <CampsRecollida idPrefix={idPrefix} dia={dia} hora={hora} onDia={setDia} onHora={setHora}
        disponibleFins={oferta.disponible_hasta} inici={oferta.hora_recollida_inici} fi={oferta.hora_recollida_fi}
        diesRecollida={oferta.dies_recollida} nomesAvisa
        ajuda={t(potAprovar ? 'asg.rec_help' : 'canalz.interes_rec_help')} />

      <Button
        className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
        disabled={ocupat || !entitat || kg.trim() === '' || senseCompat || (ambPreuTriat && preu.trim() === '')
          || (calAcceptat && !acceptat)}
        onClick={() => void registra()}
      >
        {t(potAprovar ? 'asg.b_assignar' : 'canalz.b_interes_assistit')}
      </Button>
      {dialeg}
    </div>
  )
}
