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
// ⚠️ **LO QUE NO SE HACE AQUÍ, Y ES DELIBERADO.** Editar las líneas de un albarán (las de una
//    espigolada) y el cierre anual tienen sus pantallas, con sus editores. Esta enlaza a
//    ellas en vez de duplicarlas: un segundo editor de líneas es un segundo sitio donde el
//    número de kilos puede acabar siendo otro. Desde el 27-10-2026 todo lo demás —firmar o
//    declarar convenios, validar la oferta, mandarla a mano, el interés, aprobar, la hora y el
//    registro de la recogida, conciliar, el coste por kilo y el destino final— se hace aquí.
//
// 🧩 **ORQUESTADOR** (27-10-2026, gestión autónoma, fase 5). Esta pantalla carga el lote,
//    calcula la escalera y pinta el punto y los pasos; cada fase es un componente de
//    `components/equip/fases/` con sus acciones y sus «Missatges d'aquest pas». Los mensajes
//    se leen UNA vez aquí (`useMissatgesOferta`) y se vuelven a leer tras cada acción.
//
// ⚠️ **LA PANTALLA ES UNA CONVENCIÓN, NO UNA IMPOSICIÓN** (deuda §12.109). `authenticated`
//    conserva escritura directa sobre `oferta_respuestas` y `canalizaciones`. Desde el
//    27-10-2026 `OfferDetail` ya no usa los atajos del alta de canalización, el marcado
//    manual de respuestas ni los kilos reales tecleados (registra el interés y aprueba con
//    los mismos formularios que aquí), pero el GRANT sigue abierto: «salen los mismos
//    documentos» es cierto **cuando se usan las pantallas**.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { cn } from '../../lib/utils'
import { FASES_EQUIP } from '../../lib/procesOferta'
import {
  clauPas, escalaCanal, PASSOS_FASE_CLAUS, puntCanal,
} from '../../lib/passosCanalitzacio'
import type { FetsCanal, PasEscala } from '../../lib/passosCanalitzacio'
import { dadesFiscalsProvisionals, estatCanalitzacio } from '../../lib/canalitzacio'
import type { Excedente } from '../../types'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import { certificatsDelGenerador } from '../../lib/tancament'
import { useAppContext } from '../../hooks/useAppContext'
import { useMissatgesOferta } from '../../hooks/useMissatgesOferta'
import { supabase } from '../../lib/supabase'
import PasosProces from '../../components/proces/PasosProces'
import QueTocaAra from '../../components/proces/QueTocaAra'
import FaseConveni from '../../components/equip/fases/Conveni'
import FaseEntrada from '../../components/equip/fases/Entrada'
import FaseDistribucio from '../../components/equip/fases/Distribucio'
import FaseAprovacio from '../../components/equip/fases/Aprovacio'
import FaseRecollida from '../../components/equip/fases/Recollida'
import FaseTancament from '../../components/equip/fases/Tancament'
import type { ContextFase, ExtraCanal } from '../../components/equip/fases/tipus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const COLOR_ESTAT: Record<PasEscala['estat'], string> = {
  fet: 'bg-exito-fondo text-exito',
  ara: 'bg-aviso-fondo text-aviso',
  bloquejat: 'bg-error-fondo text-error',
  pendent: 'bg-secondary text-secondary-foreground',
}

/** Una fase por índice de `FASES_EQUIP`, en su orden. */
const FASES: ((p: { c: ContextFase }) => React.ReactNode)[] = [
  FaseConveni, FaseEntrada, FaseDistribucio, FaseAprovacio, FaseRecollida, FaseTancament,
]

export default function CanalitzacioDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const { ctx } = useAppContext()
  // Contrasignar, aprobar, registrar la recogida y fijar costes exigen `pot_aprovar()`
  // (§4bis): a un técnico se le dejan grises CON el motivo, en vez de chocar con un 42501.
  const potAprovar = ctx?.potAprovar ?? false
  const esSuperAdmin = ctx?.esSuperAdmin ?? false

  const [fets, setFets] = useState<FetsCanal | null>(null)
  const [extra, setExtra] = useState<ExtraCanal | null>(null)
  /**
   * La fila entera de la oferta (F3). `canalitzacio_assistida()` devuelve de ella cuatro
   * campos, y la conversión en espigolada, la distribución y el destino final necesitan más
   * —`producte_al_camp`, `espigolada_id`, el texto, `desti_reclamat_at`— así que se pide
   * aparte en vez de ensanchar una RPC del circuito para una pantalla.
   */
  const [oferta, setOferta] = useState<Excedente | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [obertes, setObertes] = useState<Record<number, boolean>>({})
  // Sube tras cada carga: es lo que hace releer los mensajes (un aviso nace con la acción).
  const [versio, setVersio] = useState(0)
  // Hasta la primera carga no se piden (`null`): si no, se leerían dos veces al entrar.
  const { missatges } = useMissatgesOferta(versio > 0 ? id : null, versio, 'equip')

  const carrega = useCallback(async () => {
    if (!id) return
    const [r, provisionals, exc] = await Promise.all([
      estatCanalitzacio(id),
      dadesFiscalsProvisionals(),
      // `:id` de esta ruta ES el excedente (la clave natural del ciclo, §6ter).
      supabase.from('excedentes').select('*').eq('id', id).maybeSingle(),
    ])
    setOferta((exc.data as Excedente | null) ?? null)
    if (!r.ok) {
      setError(textError(t, r))
      setCarregant(false)
      return
    }
    const cru = r.data as unknown as FetsCanal & ExtraCanal
    // Los acumulados del generador en el cierre del ejercicio: es lo que dice si el último
    // escalón (CD y/o CT) ya está emitido. La RPC del ciclo no lee el cierre, así que se
    // piden aparte, como los datos provisionales. `null` = no se sabe, y la escalera usa
    // entonces su aproximación de siempre.
    const certificats = cru.exercici?.id && cru.productor?.id
      ? await certificatsDelGenerador(cru.exercici.id, cru.productor.id)
      : null
    setFets({
      ...cru,
      dadesProvisionals: provisionals,
      ...(certificats ? { certificats } : {}),
    })
    setExtra(cru)
    setError(null)
    setCarregant(false)
    setVersio((v) => v + 1)
  }, [id, t])

  useEffect(() => { void carrega() }, [carrega])

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

  const escala = escalaCanal(fets)
  const punt = puntCanal(fets)
  const perFase = FASES_EQUIP.map((_, i) => escala.filter((p) => p.fase === i))

  // Abierta si alguien la abrió o la cerró a mano; si no, si tiene un paso pendiente.
  const ambAra = (i: number) => perFase[i].some((p) => p.estat === 'ara' || p.estat === 'bloquejat')
  const esOberta = (i: number) => obertes[i] ?? ambAra(i)

  const c: ContextFase = {
    fets, extra, oferta, escala, missatges, potAprovar, esSuperAdmin,
    // Antes de recargar se congela qué fase está abierta: la acción que acaba de cerrar una
    // fase la dejaría sin paso pendiente, se plegaría sola y se llevaría por delante el
    // diálogo que el equipo tiene abierto dentro (con su resultado).
    onCanvi: () => {
      setObertes(Object.fromEntries(FASES_EQUIP.map((_, i) => [i, esOberta(i)])))
      void refrescaComptadors()
      void carrega()
    },
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tabular-nums">{extra.oferta.id_excedente ?? '—'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {extra.productor?.nom ?? '—'}
            {extra.oferta.producto ? ` · ${extra.oferta.producto}` : ''}
            {/* Traducida, no el valor interno: hasta el 22-09-2026 salía «donacio» tal cual
                (deuda §12.122). */}
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
        const obert = esOberta(i)
        const Fase = FASES[i]
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
                        <span className="min-w-0 text-sm font-medium">{t(`canal.${clauPas(p)}_t`)}</span>
                        <Badge className={COLOR_ESTAT[p.estat]}>{t(`canalz.est_${p.estat}`)}</Badge>
                      </div>
                      {/* `_passa` está redactado como «todavía falta esto», así que en
                          cuanto el paso está `fet` se vuelve una afirmación FALSA (deuda
                          §12.119, medido en el navegador el 22-09-2026). El badge verde ya
                          dice que está hecho; el texto solo vale mientras describe lo que falta. */}
                      {p.estat !== 'fet' && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t(`canal.${clauPas(p)}_passa`)}
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
                              El del convenio del generador se arregla en la fase 1, así que
                              el aviso la abre y lleva hasta ella. */}
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
                          {t(`canal.${clauPas(p)}_toca`)}
                        </p>
                      )}
                    </div>
                  ))}

                  {/* ── Las acciones y los mensajes de la fase ── */}
                  <Fase c={c} />
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )
      })}
    </div>
  )
}
