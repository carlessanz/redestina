// `/equip/canalitzacio/:id` — el ciclo entero de un lote, guiado, de punta a punta.
//
// ES LA PANTALLA QUE EL MODELO ASISTIDO PEDÍA (§1bis). El equipo opera en nombre de las
// organizaciones, pero el circuito estaba repartido en siete pantallas y tres actos del
// ciclo solo los podía hacer un usuario externo. Cuando el equipo intentaba cubrir esos
// huecos lo hacía por atajos que se saltan el circuito documental.
//
// 🔴 **CADA BOTÓN LLAMA A LA RPC REAL DEL CIRCUITO.** Ninguno escribe por atajo. Es lo que
//    hace que salgan exactamente los mismos documentos y los mismos correos que si lo
//    hubiera hecho la organización: cada RPC llama a su `*_emet_document(...)`, el trigger
//    `documentos_encola_generacion` llama a `generar-documento` y este manda el correo por
//    Resend. No hay que construir ni un PDF ni un correo; hay que no saltarse el camino.
//
// ⚠️ **LO QUE NO SE HACE AQUÍ, Y ES DELIBERADO.** Emitir un albarán con sus líneas,
//    conciliar y el cierre anual tienen sus pantallas, con sus editores. Esta enlaza a
//    ellas en vez de duplicarlas: un segundo editor de líneas es un segundo sitio donde el
//    número de kilos puede acabar siendo otro.
//
// ⚠️ **LA PANTALLA ES UNA CONVENCIÓN, NO UNA IMPOSICIÓN** (deuda §12.109). `authenticated`
//    conserva escritura directa sobre `oferta_respuestas` y `canalizaciones`, así que los
//    atajos de `OfferDetail` siguen existiendo. «Salen los mismos documentos» es cierto
//    **cuando se usa esta pantalla**.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ChevronDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { FASES_EQUIP } from '../../lib/procesOferta'
import {
  escalaCanal, PASSOS_FASE_CLAUS, puntCanal,
} from '../../lib/passosCanalitzacio'
import type { FetsCanal, PasCanal, PasEscala } from '../../lib/passosCanalitzacio'
import {
  dadesFiscalsProvisionals, estatCanalitzacio, interesAssistit,
} from '../../lib/canalitzacio'
import { contrafirmarConveni, prepararConveni } from '../../lib/convenis'
import type { ConvenioTipo, Excedente } from '../../types'
import { marcarEntregat } from '../../lib/albarans'
import { aprovarResposta, comprovaConvenis } from '../../lib/aprovarResposta'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import { supabase } from '../../lib/supabase'
import PasosProces from '../../components/proces/PasosProces'
import QueTocaAra from '../../components/proces/QueTocaAra'
import DialegAssistit from '../../components/equip/DialegAssistit'
import DialegEspigolada from '../../components/equip/DialegEspigolada'
import BotoAmbMotiu from '../../components/proces/BotoAmbMotiu'
import DialegFirmaAssistida from '../../components/equip/DialegFirmaAssistida'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Lo que la RPC devuelve además de los hechos del ciclo. */
interface Extra {
  oferta: { id: string; id_excedente: string | null; modalitat: string | null; producto: string | null }
  productor: { id: string; nom: string | null } | null
  respostes: {
    id: string; entidad_id: string | null; entitat: string
    estado: string; aprovacio: string; kg_solicitados: number | null
    /** El convenio que ESTA receptora necesita para esta modalidad, si lo tiene. */
    conveni_rec: { id: string; estado: string; numero: string | null } | null
  }[]
  albarans: { id: string; tipo: string; estado: string; numero: string | null }[]
  conveni_gen: { id: string } | null
}

/**
 * Qué convenio le exige a la RECEPTORA la modalidad de esta oferta.
 *
 * Es la fila `parte = 'recibe'` de `convenios_exigidos`: donación pide `don_rec`, y venta y
 * maquila piden el comercial. Se deriva aquí, y no se pregunta, porque la RPC del ciclo ya
 * devuelve el convenio que le toca a cada entidad: lo único que falta para poder prepararlo
 * desde esta pantalla es su TIPO, y la modalidad del lote lo determina sin ambigüedad.
 *
 * ⚠️ Si algún día la matriz deja de ser una función de la modalidad —dos convenios para una
 *    misma—, esto deja de poder derivarse y hay que pedirlo a la base.
 */
function conveniQueCalRebre(modalitat: string | null): ConvenioTipo | null {
  if (modalitat === 'donacio') return 'don_rec'
  if (modalitat === 'venda' || modalitat === 'maquila') return 'com'
  return null
}

const COLOR_ESTAT: Record<PasEscala['estat'], string> = {
  fet: 'bg-exito-fondo text-exito',
  ara: 'bg-aviso-fondo text-aviso',
  bloquejat: 'bg-error-fondo text-error',
  pendent: 'bg-secondary text-secondary-foreground',
}

export default function CanalitzacioDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()

  const [fets, setFets] = useState<FetsCanal | null>(null)
  const [extra, setExtra] = useState<Extra | null>(null)
  /**
   * La fila entera de la oferta (F3). `canalitzacio_assistida()` devuelve de ella cuatro
   * campos, y la conversión en espigolada necesita más —`producte_al_camp`,
   * `espigolada_id`, la finca y lo que declaró— así que se pide aparte en vez de ensanchar
   * una RPC del circuito para una pantalla.
   */
  const [oferta, setOferta] = useState<Excedente | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)
  const [obertes, setObertes] = useState<Record<number, boolean>>({})

  // Los tres actos asistidos, cada uno con su diálogo.
  const [dlgFirma, setDlgFirma] = useState<string | null>(null)
  const [dlgAlbara, setDlgAlbara] = useState<string | null>(null)
  const [dlgEspigolada, setDlgEspigolada] = useState(false)

  // El interés asistido: entidad y kilos, que es lo mínimo que la RPC necesita.
  const [entitats, setEntitats] = useState<{ id: string; nombre: string }[]>([])
  const [entitatTriada, setEntitatTriada] = useState('')
  const [kgInteres, setKgInteres] = useState('')

  const carrega = useCallback(async () => {
    if (!id) return
    setCarregant(true)
    const [r, provisionals, exc] = await Promise.all([
      estatCanalitzacio(id),
      dadesFiscalsProvisionals(),
      // `:id` de esta ruta ES el excedente (la clave natural del ciclo, §6ter).
      supabase.from('excedentes').select('*').eq('id', id).maybeSingle(),
    ])
    setOferta((exc.data as Excedente | null) ?? null)
    if (!r.ok) {
      setError(r.missatge === 'canalz.err_generic' ? t('c.error') : r.missatge)
      setCarregant(false)
      return
    }
    const cru = r.data as unknown as FetsCanal & Extra
    setFets({ ...cru, dadesProvisionals: provisionals })
    setExtra(cru as unknown as Extra)
    setError(null)
    setCarregant(false)
  }, [id, t])

  useEffect(() => { void carrega() }, [carrega])

  // Las entidades solo hacen falta para el interés asistido, así que se piden una vez y
  // aparte: traerlas con el ciclo cargaría 119 filas en cada refresco del estado.
  useEffect(() => {
    let viu = true
    void (async () => {
      const { data } = await supabase
        .from('entidades')
        .select('id, nombre')
        .order('nombre')
        .limit(500)
      if (viu && data) setEntitats(data as { id: string; nombre: string }[])
    })()
    return () => { viu = false }
  }, [])

  async function fes(accio: () => Promise<{ ok: boolean; missatge?: string }>, okKey: string) {
    setOcupat(true)
    const r = await accio()
    setOcupat(false)
    if (!r.ok) { toast.error(r.missatge ?? t('c.error')); return }
    toast.success(t(okKey))
    void refrescaComptadors()
    await carrega()
  }

  if (carregant) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />{t('c.loading')}
      </p>
    )
  }
  if (!fets || !extra) {
    return <p className="text-sm text-error">{error ?? t('c.error')}</p>
  }

  // Copia no nula tras la guarda: TypeScript no estrecha el estado dentro de las
  // funciones declaradas más abajo, y pasarlo por argumento a todas sería peor.
  const ex = extra

  const escala = escalaCanal(fets)
  const punt = puntCanal(fets)

  /**
   * Por qué NO se puede convertir en espigolada (F3). Las mismas dos razones que anticipa
   * `OfferDetail`, y por lo mismo: la oferta ya tiene una entrada, así que la jornada
   * crearía un segundo REC con los mismos kilos. **La autoridad sigue siendo la RPC**
   * (`ja_te_canalitzacions` / `ja_te_albarans`, 22023); esto solo evita el choque.
   */
  const motiuNoConvertible = fets.canalitzacions.length > 0
    ? t('conv_esp.no_canalitzacions')
    : fets.albarans.some((a) => a.estado !== 'anulado')
      ? t('conv_esp.no_albarans')
      : null
  const perFase = FASES_EQUIP.map((_, i) => escala.filter((p) => p.fase === i))

  /** Un paso concreto, para decidir si su botón está vivo. */
  const pas = (p: PasCanal) => escala.find((x) => x.pas === p)!

  async function aprovaInteres(respostaId: string, entitatId: string | null, kg: number) {
    // El mismo aviso previo que `Aprovacions` y `OfferDetail`: la base va a rechazar con
    // `42501 sense_conveni` desde la fecha de corte, y enterarse con un error a mitad es
    // peor que saberlo antes (§12.78).
    if (entitatId) {
      const falta = await comprovaConvenis(
        { modalitat: ex.oferta.modalitat, productor_id: ex.productor?.id ?? null },
        entitatId,
        t,
      )
      if (falta) { toast.error(`${t('od.conv_blocked')} · ${falta}`); return }
    }
    await fes(
      async () => {
        const r = await aprovarResposta({ id: respostaId, kg })
        return r.ok ? { ok: true } : { ok: false, missatge: r.missatge }
      },
      'canalz.ok_aprovat',
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tabular-nums">{extra.oferta.id_excedente ?? '—'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {extra.productor?.nom ?? '—'}
            {extra.oferta.producto ? ` · ${extra.oferta.producto}` : ''}
            {/* Traducida, no el valor interno: hasta hoy salía «donacio» tal cual,
                sin acento, cuando el resto de la interfaz ya tiene esta clave
                (`Mercat.tsx`) para lo mismo (deuda §12.122). */}
            {extra.oferta.modalitat ? ` · ${t(`od.mod_${extra.oferta.modalitat}`)}` : ''}
          </p>
        </div>
        <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
          <Link to="/equip/canalitzacio">{t('canalz.back')}</Link>
        </Button>
      </div>

      {/* La escalera de las seis fases, con la actual encendida. */}
      <PasosProces etapes={PASSOS_FASE_CLAUS} actual={punt.fase} />
      <QueTocaAra punt={punt} />

      {FASES_EQUIP.map((fase, i) => {
        const passos = perFase[i]
        const ambAra = passos.some((p) => p.estat === 'ara' || p.estat === 'bloquejat')
        const obert = obertes[i] ?? ambAra
        return (
          <Collapsible
            key={fase.clau}
            open={obert}
            onOpenChange={(v) => setObertes((o) => ({ ...o, [i]: v }))}
          >
            <div id={`fase-${fase.clau}`} className="scroll-mt-20 rounded-xl border bg-card shadow-sm">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-4 text-left">
                <span className="font-titulos text-base font-semibold">
                  {i + 1}. {t(`fase.${fase.clau}_t`)}
                </span>
                <span className="flex items-center gap-2">
                  {passos.every((p) => p.estat === 'fet') && (
                    <Badge className="bg-exito-fondo text-exito">{t('canalz.fase_feta')}</Badge>
                  )}
                  <ChevronDown
                    className={cn('size-4 shrink-0 transition-transform', obert && 'rotate-180')}
                    aria-hidden
                  />
                </span>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="space-y-3 px-4 pb-4">
                  {passos.map((p) => (
                    <div key={p.pas} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{t(`canal.${p.pas}_t`)}</span>
                        <Badge className={COLOR_ESTAT[p.estat]}>{t(`canalz.est_${p.estat}`)}</Badge>
                      </div>
                      {/* `_passa` está redactado como «todavía falta esto», así que en
                          cuanto el paso está `fet` se vuelve una afirmación FALSA: «Ja hi ha
                          canalització, però encara no hi ha el document» con el REC ya
                          emitido, o «Algun producte no té cost» con el coste ya fijado
                          (deuda §12.119, medido en el navegador el 22-09-2026). El badge
                          verde de arriba ya dice que está hecho; el texto narrativo solo
                          tiene sentido mientras describe lo que falta. */}
                      {p.estat !== 'fet' && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t(`canal.${p.pas}_passa`)}
                        </p>
                      )}
                      {/* Un paso bloqueado dice POR QUÉ, y lo dice VISIBLE: en táctil no hay
                          hover, así que un tooltip no cuenta como haberlo dicho. */}
                      {p.motiuKey && (
                        <div className={cn(
                          'mt-2 rounded-md p-2 text-sm',
                          p.estat === 'bloquejat' ? 'bg-error-fondo text-error' : 'bg-secondary text-secondary-foreground',
                        )}>
                          <p>{t(p.motiuKey)}</p>
                          {/* Un bloqueo que solo se nombra obliga a buscar dónde se arregla.
                              El del convenio del generador se arregla UNA fila más arriba, en
                              la fase 1, así que el aviso la abre y lleva hasta ella. */}
                          {p.motiuKey === 'canal.bl_sense_conveni_gen' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 h-11 whitespace-normal md:h-8"
                              onClick={() => {
                                setObertes((o) => ({ ...o, 0: true }))
                                document.getElementById('fase-conveni')?.scrollIntoView({
                                  behavior: 'smooth', block: 'start',
                                })
                              }}
                            >
                              {t('canalz.b_ves_conveni')}
                            </Button>
                          )}
                        </div>
                      )}
                      {p.estat === 'ara' && !p.motiuKey && (
                        <p className="mt-2 rounded-md bg-aviso-fondo p-2 text-sm text-aviso">
                          {t(`canal.${p.pas}_toca`)}
                        </p>
                      )}
                    </div>
                  ))}

                  {/* El «producte al camp» cambia lo que significa la fase 2, así que se
                      dice antes de enseñar el botón: la entrada de este lote la produce una
                      jornada de campo, no un albarán tecleado. */}
                  {i === 1 && oferta?.producte_al_camp && (
                    <div className="rounded-md bg-secondary p-2 text-sm text-secondary-foreground">
                      <p>{t(oferta.espigolada_id ? 'conv_esp.done_hint' : 'conv_esp.banner')}</p>
                      {/* En táctil no hay hover, así que el tooltip del botón gris no
                          existe para media aplicación: el motivo va también escrito. */}
                      {!oferta.espigolada_id && motiuNoConvertible && (
                        <p className="mt-1">{motiuNoConvertible}</p>
                      )}
                    </div>
                  )}

                  {/* ── Las acciones de cada fase ── */}
                  <div className="flex flex-wrap gap-2">
                    {i === 0 && (
                      <>
                        {!fets.conveni_gen && extra.productor && (
                          <Button
                            className="h-11 whitespace-normal md:h-9"
                            disabled={ocupat}
                            onClick={() => void fes(
                              async () => {
                                const r = await prepararConveni('productor', extra.productor!.id, 'don_gen')
                                return r.ok ? { ok: true } : { ok: false, missatge: r.missatge }
                              },
                              'canalz.ok_preparat',
                            )}
                          >
                            {t('canalz.b_preparar')}
                          </Button>
                        )}
                        {fets.conveni_gen && pas('conv_gen_firmar').estat !== 'fet' && (
                          <Button
                            className="h-11 whitespace-normal md:h-9"
                            onClick={() => setDlgFirma(fets.conveni_gen!.id)}
                          >
                            {t('canalz.b_firma_assistida')}
                          </Button>
                        )}
                        {fets.conveni_gen?.estado === 'firmat' && (
                          <Button
                            className="h-11 whitespace-normal md:h-9"
                            disabled={ocupat}
                            onClick={() => void fes(
                              async () => {
                                const r = await contrafirmarConveni(fets.conveni_gen!.id)
                                return r.ok ? { ok: true } : { ok: false, missatge: r.missatge }
                              },
                              'canalz.ok_contrasignat',
                            )}
                          >
                            {t('canalz.b_contrasignar')}
                          </Button>
                        )}
                        {fets.conveni_gen && (
                          <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
                            <Link to={`/equip/convenis/${fets.conveni_gen.id}`}>{t('canalz.b_veure_conveni')}</Link>
                          </Button>
                        )}
                      </>
                    )}

                    {(i === 1 || i === 2) && (
                      <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
                        <Link to={`/equip/ofertes/${extra.oferta.id}`}>{t('canalz.b_obre_oferta')}</Link>
                      </Button>
                    )}

                    {/* F3, fase 2 (l'entrada): si el lote declara producto SIN COSECHAR,
                        la entrada no es un albarán que alguien teclea, es una jornada de
                        campo. Y si ya lo es, se enlaza a ella. */}
                    {i === 1 && oferta?.espigolada_id && (
                      <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
                        <Link to={`/equip/espigolades/${oferta.espigolada_id}`}>
                          {t('conv_esp.open')}
                        </Link>
                      </Button>
                    )}
                    {i === 1 && oferta?.producte_al_camp && !oferta.espigolada_id && (
                      <BotoAmbMotiu
                        className="h-11 whitespace-normal md:h-9"
                        disabled={Boolean(motiuNoConvertible)}
                        motiu={motiuNoConvertible ?? undefined}
                        onClick={() => setDlgEspigolada(true)}
                      >
                        {t('conv_esp.cta')}
                      </BotoAmbMotiu>
                    )}

                    {i === 3 && (
                      <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
                        <Link to="/equip/aprovacions">{t('canalz.b_cua_aprovacions')}</Link>
                      </Button>
                    )}

                    {i === 4 && (
                      <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
                        <Link to="/equip/albarans">{t('canalz.b_albarans')}</Link>
                      </Button>
                    )}

                    {i === 5 && (
                      <>
                        <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
                          <Link to="/equip/costos">{t('canalz.b_costos')}</Link>
                        </Button>
                        <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
                          <Link to="/equip/tancament">{t('canalz.b_tancament')}</Link>
                        </Button>
                      </>
                    )}
                  </div>

                  {/* ── Fase 4: el interés asistido ──
                      La entidad dice por teléfono cuántos kilos quiere y el equipo lo
                      registra. NO es un `insert` a `oferta_respuestas`: pasa por
                      `manifestar_interes_assistit`, que conserva las tres comprobaciones
                      que los atajos se saltan (estado, compatibilidad y precio mínimo). */}
                  {i === 3 && (
                    <div className="space-y-2 rounded-md border p-3">
                      <p className="text-sm font-medium">{t('canalz.interes_title')}</p>
                      <p className="text-xs text-muted-foreground">{t('canalz.interes_hint')}</p>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="sm:col-span-2">
                          <Label htmlFor="cd-interes-entitat" className="mb-1 block text-xs text-muted-foreground">
                            {t('canalz.interes_entitat')}
                          </Label>
                          <select
                            id="cd-interes-entitat"
                            name="entitat"
                            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm"
                            value={entitatTriada}
                            onChange={(e) => setEntitatTriada(e.target.value)}
                          >
                            <option value="">—</option>
                            {entitats.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                          </select>
                        </div>
                        <div>
                          <Label htmlFor="cd-interes-kg" className="mb-1 block text-xs text-muted-foreground">
                            {t('canalz.interes_kg')}
                          </Label>
                          <Input
                            id="cd-interes-kg"
                            name="kg"
                            type="number" min="0" step="0.01"
                            value={kgInteres}
                            onChange={(e) => setKgInteres(e.target.value)}
                          />
                        </div>
                      </div>
                      <Button
                        className="h-11 whitespace-normal md:h-9"
                        disabled={ocupat || !entitatTriada || kgInteres.trim() === ''}
                        onClick={() => void fes(
                          async () => {
                            const r = await interesAssistit(
                              ex.oferta.id, entitatTriada, Number(kgInteres), null, null,
                            )
                            if (r.ok) { setEntitatTriada(''); setKgInteres('') }
                            return r.ok ? { ok: true } : { ok: false, missatge: r.missatge }
                          },
                          'canalz.ok_interes',
                        )}
                      >
                        {t('canalz.b_interes_assistit')}
                      </Button>

                      {/* Los intereses que esperan decisión, aprobables desde aquí.
                          Y con EL CONVENIO DE CADA UNA al lado: `aprovar_resposta()` lo exige
                          desde la fecha de corte (42501 `sense_conveni`), así que un botón de
                          aprobar sin decir que falta el convenio manda a chocar contra la
                          base. Los botones que lo resuelven viven aquí, en la misma fila:
                          mandar a otra pantalla es perder el hilo del lote. */}
                      {extra.respostes
                        .filter((r) => r.estado === 'acceptada' && r.aprovacio === 'pendent')
                        .map((r) => {
                          const cv = r.conveni_rec
                          const vigent = cv?.estado === 'vigent'
                          const tipusCal = conveniQueCalRebre(extra.oferta.modalitat)
                          return (
                            <div key={r.id} className="rounded-md border p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm">
                                  {r.entitat}
                                  {r.kg_solicitados != null && (
                                    <span className="tabular-nums"> · {r.kg_solicitados} kg</span>
                                  )}
                                </span>
                                <span className="flex flex-wrap items-center gap-2">
                                  <Badge className={vigent ? 'bg-exito-fondo text-exito' : 'bg-aviso-fondo text-aviso'}>
                                    {cv ? t(`conv.st_${cv.estado}`) : t('canalz.rec_sense_conveni')}
                                  </Badge>
                                  <Button
                                    size="sm"
                                    className="h-11 whitespace-normal md:h-8"
                                    disabled={ocupat || r.kg_solicitados == null || !vigent}
                                    onClick={() => void aprovaInteres(r.id, r.entidad_id, Number(r.kg_solicitados ?? 0))}
                                  >
                                    {t('canalz.b_aprova')}
                                  </Button>
                                </span>
                              </div>

                              {/* Sin convenio vigente: qué falta y el botón que lo resuelve. */}
                              {!vigent && (
                                <div className="mt-2 rounded-md bg-aviso-fondo p-2">
                                  <p className="text-sm text-aviso">{t('canalz.rec_conveni_cal')}</p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {!cv && r.entidad_id && tipusCal && (
                                      <Button
                                        size="sm"
                                        className="h-11 whitespace-normal md:h-8"
                                        disabled={ocupat}
                                        onClick={() => void fes(
                                          async () => {
                                            const res = await prepararConveni('entidad', r.entidad_id!, tipusCal)
                                            return res.ok ? { ok: true } : { ok: false, missatge: res.missatge }
                                          },
                                          'canalz.ok_preparat',
                                        )}
                                      >
                                        {t('canalz.b_preparar')}
                                      </Button>
                                    )}
                                    {cv && cv.estado !== 'firmat' && (
                                      <Button
                                        size="sm"
                                        className="h-11 whitespace-normal md:h-8"
                                        onClick={() => setDlgFirma(cv.id)}
                                      >
                                        {t('canalz.b_firma_assistida')}
                                      </Button>
                                    )}
                                    {cv?.estado === 'firmat' && (
                                      <Button
                                        size="sm"
                                        className="h-11 whitespace-normal md:h-8"
                                        disabled={ocupat}
                                        onClick={() => void fes(
                                          async () => {
                                            const res = await contrafirmarConveni(cv.id)
                                            return res.ok ? { ok: true } : { ok: false, missatge: res.missatge }
                                          },
                                          'canalz.ok_contrasignat',
                                        )}
                                      >
                                        {t('canalz.b_contrasignar')}
                                      </Button>
                                    )}
                                    {cv && (
                                      <Button asChild size="sm" variant="outline" className="h-11 whitespace-normal md:h-8">
                                        <Link to={`/equip/convenis/${cv.id}`}>{t('canalz.b_veure_conveni')}</Link>
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  )}

                  {/* ── Fase 5: los albaranes, uno a uno ── */}
                  {i === 4 && extra.albarans.length > 0 && (
                    <div className="space-y-2">
                      {extra.albarans.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                          <span className="text-sm tabular-nums">
                            {a.tipo} · {a.numero ?? t('canalz.sense_numero')} · {t(`alb.st_${a.estado}`)}
                          </span>
                          <span className="flex flex-wrap gap-2">
                            {a.estado === 'emitido' && (
                              <Button
                                size="sm" variant="outline" className="h-11 whitespace-normal md:h-8"
                                disabled={ocupat}
                                onClick={() => void fes(
                                  async () => {
                                    const r = await marcarEntregat(a.id)
                                    return r.ok ? { ok: true } : { ok: false, missatge: r.missatge }
                                  },
                                  'canalz.ok_entregat',
                                )}
                              >
                                {t('canalz.b_entregat')}
                              </Button>
                            )}
                            {a.estado === 'entregado' && (
                              <Button
                                size="sm" className="h-11 whitespace-normal md:h-8"
                                onClick={() => setDlgAlbara(a.id)}
                              >
                                {t('canalz.b_confirmacio_assistida')}
                              </Button>
                            )}
                            <Button asChild size="sm" variant="outline" className="h-11 whitespace-normal md:h-8">
                              <Link to={`/equip/albarans/${a.id}`}>{t('canalz.b_obre')}</Link>
                            </Button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )
      })}

      {dlgFirma && (
        <DialegFirmaAssistida
          obert
          conveniId={dlgFirma}
          onTancar={() => setDlgFirma(null)}
          onFirmat={() => { setDlgFirma(null); void carrega() }}
        />
      )}
      {oferta && (
        <DialegEspigolada
          obert={dlgEspigolada}
          oferta={oferta}
          productorNom={extra.productor?.nom ?? null}
          onTancar={() => setDlgEspigolada(false)}
          onCreada={() => { setDlgEspigolada(false); void refrescaComptadors(); void carrega() }}
        />
      )}
      {dlgAlbara && (
        <DialegAssistit
          obert
          que="albara"
          objecteId={dlgAlbara}
          onTancar={() => setDlgAlbara(null)}
          onFet={() => { setDlgAlbara(null); void carrega() }}
        />
      )}
    </div>
  )
}
