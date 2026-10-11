// Detalle de una oferta desde el panel del productor: qué publicó, en qué punto del
// proceso está y qué le toca hacer (casi siempre, nada). Puede cancelarla y, desde el
// 05-10-2026, EDITARLA (`DialegEditaOferta`): kilos, modalidades, precio, fechas, franja y
// observaciones. El texto de la oferta se recompone en el servidor; si cambian los kilos o
// las modalidades vuelve a validación (D4).
//
// ES TAMBIÉN LA PANTALLA DE «PUBLICADA». Publicar ya no termina en un toast: `NovaOferta`
// navega aquí con `state.publicada`, y lo primero que se ve es la referencia, qué pasa
// ahora y por dónde seguir. Un toast dice eso mismo durante cuatro segundos y se lo lleva;
// esto se puede volver a mirar, y se llega por una URL que se puede compartir.
//
// ⚠️ QUÉ NO SE ENSEÑA, Y NO ES UN OLVIDO: quién ha MOSTRADO INTERÉS. `progres_meves_ofertes()`
//    devuelve cuántas, nunca cuáles (20270323100000). Lo que sí se enseña desde el
//    05-10-2026 (D1) es a qué entidad va cada entrega ya APROBADA.

import DialegEditaOferta from '../../components/DialegEditaOferta'
import { carregaContraparts, marcaLlegits, useAvisos } from '../../lib/avisos'
import type { Contrapart } from '../../lib/avisos'
import LiniesSortida from '../../components/LiniesSortida'
import FitxaOperacio from '../../components/FitxaOperacio'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import DialegMotiu from '../../components/DialegMotiu'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { dataCurta } from '../../lib/format'
import { cancelaOferta, carregaDestins } from '../../lib/ofertes'
import DestiFinal from '../../components/DestiFinal'
import { carregaPendents } from '../../lib/pendents'
import { carregaProgresOfertes } from '../../lib/progresOfertes'
import type { ProgresOferta } from '../../lib/progresOfertes'
import {
  PASSOS_OFERTA_CLAUS, estatSimpleOferta, puntOferta,
} from '../../lib/procesOferta'
import PasosProces from '../../components/proces/PasosProces'
import QueTocaAra from '../../components/proces/QueTocaAra'
import BlocPublicada from '../../components/proces/BlocPublicada'
import BadgeEstat from '../../components/proces/BadgeEstat'
import { SelectorFotos } from '../../components/FotosOferta'
import { fixaFotos } from '../../lib/fotos'
import type { Canalizacion, EstadoAlbaran, Excedente } from '../../types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Lo único que esta pantalla usa de cada canalización y de su REC. Van estrechas a propósito:
 * `canalizaciones` lleva `entidad_id` y `v_albaranes_bandeja` también, y al productor no le
 * toca saber a qué entidad va su producto (§4bis, «cuántas, sin nombres»).
 */
type CanalitzacioMeva = Pick<Canalizacion, 'id' | 'kg_confirmados' | 'kg_reales' | 'estado'>
interface RecMeu { id: string; estado: string; numero_completo: string | null; dias_esperando: number | null }

/** Lo que `NovaOferta` deja al navegar aquí. Nada de esto sobrevive a una recarga. */
interface EstatArribada { publicada?: boolean; correuEnviat?: boolean }

export default function ProductorOfertaDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const arribada = (location.state ?? {}) as EstatArribada

  const [oferta, setOferta] = useState<Excedente | null>(null)
  const [canalitzacions, setCanalitzacions] = useState<CanalitzacioMeva[]>([])
  const [rec, setRec] = useState<RecMeu | null>(null)
  const [pendentDeMi, setPendentDeMi] = useState(false)
  const [progres, setProgres] = useState<ProgresOferta | null>(null)
  /** Kilos con destino EXTERNO registrado (`excedente_destins`): entran en «falta destí». */
  const [kgExterns, setKgExterns] = useState(0)
  const [carregant, setCarregant] = useState(true)
  /** Fallo al leer la oferta: no es lo mismo que «no existe o no es tuya». */
  const [errorCarrega, setErrorCarrega] = useState(false)

  const carrega = useCallback(async () => {
    if (!id) return
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    // Sin `.eq()` de organización en el albarán: la RLS ya devuelve solo lo suyo, igual
    // que en `productor/Documents.tsx`.
    const [e, c, dx] = await Promise.all([
      supabase.from('excedentes').select('*').eq('id', id).maybeSingle(),
      supabase.from('canalizaciones').select('id, kg_confirmados, kg_reales, estado').eq('excedente_id', id)
        .order('created_at', { ascending: true }),
      carregaDestins([id]),
    ])
    setKgExterns((dx.data ?? []).reduce((s, d) => s + Number(d.kg), 0))
    // El REC de una ESPIGOLADA cuelga de la jornada, no de la oferta: sin buscarlo por
    // `espigolada_id`, una oferta convertida y ya conciliada decía «Espera el contacte de
    // l'equip» (28-09-2026). Por eso va después de leer la oferta.
    const espId = (e.data as Excedente | null)?.espigolada_id ?? null
    const a = await supabase.from('v_albaranes_bandeja')
      .select('id, estado, numero_completo, dias_esperando, emitido_at')
      .eq('tipo', 'REC')
      .or(`excedente_id.eq.${id}${espId ? `,espigolada_id.eq.${espId}` : ''}`)
      .order('emitido_at', { ascending: false, nullsFirst: true })
    setErrorCarrega(Boolean(e.error))
    setOferta((e.data as Excedente) ?? null)
    setCanalitzacions((c.data ?? []) as CanalitzacioMeva[])
    const albarans = (a.data as RecMeu[] | null) ?? []
    const recVigent = albarans[0] ?? null
    setRec(recVigent)

    // Lo pendiente y el embudo son dos RPC que pueden no estar aplicadas todavía (se
    // publican antes que esta pantalla, pero el orden real lo decide quien publique). Las
    // dos «nunca lanzan», así que un fallo deja la pantalla sin ese matiz y no sin datos.
    const [pend, prog] = await Promise.all([carregaPendents(), carregaProgresOfertes()])
    setPendentDeMi(
      pend.ok && recVigent != null && pend.data.some(
        (p) => p.proposito === 'confirmacion_albaran' && p.objeto_id === recVigent.id,
      ),
    )
    setProgres(prog.ok ? prog.data.find((p) => p.excedente_id === id) ?? null : null)
    setCarregant(false)
  }, [id])

  useEffect(() => { void carrega() }, [carrega])

  // Los avisos de esta oferta se dan por leídos al abrirla (05-10-2026).
  const avisos = useAvisos()
  useEffect(() => {
    const ids = avisos.filter((a) => !a.llegit_at && a.objecte_id === id).map((a) => a.id)
    if (ids.length > 0) void marcaLlegits({ ids })
  }, [avisos, id])
  // D1: una vez aprobada, a quién va cada entrega.
  const [destins, setDestins] = useState<Record<string, string>>({})
  /** Las salidas de ESTA oferta, con la recogida (fase 2 de la revisión del 08-10-2026). */
  const [sortides, setSortides] = useState<Contrapart[]>([])
  const [fitxa, setFitxa] = useState<string | null>(null)
  useEffect(() => {
    void carregaContraparts().then((cs) => {
      const m: Record<string, string> = {}
      for (const c of cs) if (c.rol === 'productor' && c.contrapart) m[c.canalizacion_id] = c.contrapart
      setDestins(m)
      setSortides(cs.filter((c) => c.rol === 'productor' && c.excedente_id === id))
    })
  }, [canalitzacions, id])
  const [editant, setEditant] = useState(false)

  // El motivo se pide con diálogo propio, nunca con `window.prompt` (deuda §12.35): este es
  // el panel del productor, o sea el público con más probabilidad de abrirlo desde el
  // navegador integrado de WhatsApp, donde `prompt()` devuelve `null` sin decir nada y la
  // cancelación no ocurriría.
  const [cancelant, setCancelant] = useState(false)
  const [ocupatCancel, setOcupatCancel] = useState(false)

  async function cancelar(motiu: string) {
    if (!oferta) return
    setOcupatCancel(true)
    const r = await cancelaOferta(oferta.id, motiu)
    setOcupatCancel(false)
    if (!r.ok) { toast.error(textError(t, r.error)); return }
    setCancelant(false)
    toast.success(t('po.cancelled'))
    await carrega()
  }

  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  if (!oferta) return <p className="text-sm text-destructive">{t(errorCarrega ? 'po.err_load_one' : 'od.not_found')}</p>

  // Las anuladas no cuentan: es la misma regla que `desti_excedent()` en la base.
  const vives = canalitzacions.filter((c) => c.estado !== 'anulada')
  const canalitzats = vives.reduce((s, c) => s + Number(c.kg_confirmados ?? 0), 0)
  const total = Number(oferta.kg_total ?? 0)
  // Cancelar es para un error o una incidencia (revisión del 08-10-2026): con kilos ya
  // asignados lo que toca es registrar el destino del resto, y la base lo rechaza igual.
  const cancelable = ['borrador', 'pendent_validacio', 'publicada'].includes(oferta.estado) && vives.length === 0
  const kgSenseDesti = Math.max(0, total - canalitzats - kgExterns)

  // La fecha se compara en día, no en instante: una oferta disponible «hasta el 23» sigue
  // valiendo el 23 entero.
  const avui = new Date().toISOString().slice(0, 10)
  const vencuda = Boolean(
    oferta.disponible_hasta && oferta.disponible_hasta.slice(0, 10) < avui && canalitzats < total,
  )

  const punt = puntOferta({
    estado: oferta.estado,
    kgTotal: total,
    kgCanalitzats: canalitzats,
    nInteressades: progres?.n_interessades,
    nPerAprovar: progres?.n_per_aprovar,
    albaraRec: rec
      ? {
        estado: rec.estado as EstadoAlbaran,
        numero: rec.numero_completo,
        diesEsperant: rec.dias_esperando,
      }
      : null,
    motiu: oferta.motivo_no_colocada ?? null,
    vencuda,
    pendentDeMi,
    // F3. Aquí NO hay ningún botón, y no es un olvido: quien avisa de que tiene un campo
    // sin cosechar no decide qué se hace con él —el destino lo elige el equipo (§6ter)—,
    // así que lo único que le toca es saberlo. `puntOferta` lo dice con una nota.
    producteAlCamp: oferta.producte_al_camp,
    espigoladaId: oferta.espigolada_id,
    id: oferta.id,
    kgSenseDesti,
    destiReclamat: Boolean(oferta.desti_reclamat_at),
  }, 'productor')

  return (
    <div className="space-y-4">
      {/* Sin `size="sm"`: es el control de navegación de la pantalla y en móvil se toca
          con el pulgar. */}
      <Button variant="ghost" onClick={() => navigate('/productor/ofertes')}
        className="text-muted-foreground">
        <ArrowLeft className="size-4" /> {t('po.list_title')}
      </Button>

      {/* Solo al llegar de publicar: `location.state` no sobrevive a una recarga, y eso es
          lo correcto — la enhorabuena es del momento, el resto de la pantalla es permanente. */}
      {arribada.publicada && (
        <BlocPublicada
          referencia={`${oferta.producto ?? '—'} · ${total.toLocaleString('ca-ES')} kg`}
          punt={punt}
          correuEnviat={arribada.correuEnviat === true}
          onInici={() => navigate('/productor/inici')}
          onAltra={() => navigate('/productor/ofertes/nova')}
        />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* El producto primero y la disponibilidad debajo: es lo que el productor reconoce.
              El código `E-…` ya no se le enseña (revisión del 08-10-2026, §3.5): es de gestión
              interna del equipo, que lo sigue viendo en su panel. */}
          <h1 className="text-xl font-bold">
            {oferta.producto}{oferta.variedad ? ` · ${oferta.variedad}` : ''}
          </h1>
          {oferta.disponible_hasta && (
            <p className="text-xs text-muted-foreground">{t('edit.fins')} {dataCurta(oferta.disponible_hasta)}</p>
          )}
          <div className="mt-1.5">
            <BadgeEstat clase={estatSimpleOferta(punt).clase} gran>{t(estatSimpleOferta(punt).key)}</BadgeEstat>
          </div>
        </div>
        <div className="text-right">
          {/* `ca-ES` agrupa también los de cuatro cifras («1.000»); sin formato salía «1000». */}
          <div className="text-lg font-bold">{canalitzats.toLocaleString('ca-ES')}/{total.toLocaleString('ca-ES')} kg</div>
          <span className="text-sm text-muted-foreground">
            {total - canalitzats > 0 ? t('off.falten', { n: (total - canalitzats).toLocaleString('ca-ES') }) : t('off.complet')}
          </span>
        </div>
      </div>

      {/* --- Dónde está y qué toca. Las dos piezas salen del mismo `punt`, así que el
              indicador y la explicación no pueden discrepar. --- */}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <PasosProces
          etapes={PASSOS_OFERTA_CLAUS}
          actual={punt.index}
          sortida={punt.index < 0 ? punt.claus.titol : undefined}
          destructiva={punt.etapa === 'cancellada'}
        />
      </div>
      <QueTocaAra punt={punt} />

      {/* --- Qué ha pasado con el producto (fase 1 de la revisión del 08-10-2026). Va
              justo debajo de «què toca» porque, cuando falta, es justo eso lo que toca. --- */}
      <DestiFinal
        excedenteId={oferta.id}
        estado={oferta.estado}
        kgTotal={total}
        destiReclamat={Boolean(oferta.desti_reclamat_at)}
        sortides={vives.map((c) => ({ entitat: destins[c.id] ?? null, kg: Number(c.kg_confirmados ?? 0) }))}
        onDesat={() => void carrega()}
      />

      {/* --- Las fotos: se pueden añadir o cambiar mientras la oferta sigue viva, que es
              cuando un receptor todavía las va a mirar. Van por RPC (`fixar_fotos_oferta`):
              el productor no tiene UPDATE sobre `excedentes`. --- */}
      {oferta.productor_id && (cancelable || oferta.estado === 'bloqueada' || (oferta.fotos?.length ?? 0) > 0) && (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="text-base font-semibold">{t('foto.title')}</h2>
          <SelectorFotos
            productorId={oferta.productor_id}
            rutes={oferta.fotos ?? []}
            disabled={!(cancelable || oferta.estado === 'bloqueada')}
            onChange={async (rutes) => {
              const r = await fixaFotos(oferta.id, rutes)
              // `false` le dice al selector que NO borre el fichero: la oferta sigue
              // apuntándolo, y borrarlo dejaría la foto rota.
              if (!r.ok) { toast.error(textError(t, r.error)); return false }
              setOferta((o) => (o ? { ...o, fotos: rutes } : o))
              return true
            }}
          />
        </div>
      )}

      {oferta.texto_oferta && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('od.offer_text')}</CardTitle></CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm">
              {oferta.texto_oferta}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('po.kg_with_dest')}</CardTitle>
          {/* D1 (05-10-2026): una vez APROBADA, cada entrega dice a qué entidad va
              (`contraparts_canalitzacions()`). Antes de aprobar sigue sin nombrarse nadie:
              el embudo de `progres_meves_ofertes()` solo cuenta. */}
          <p className="mt-1 text-sm text-muted-foreground">{t('po.dest_hint')}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {canalitzacions.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('po.no_channelings')}</p>
          )}
          {/* Receptor, kg, día y hora y estado de la recogida, sin tener que buscarlo (§4 y
              §3.3 de la revisión del 08-10-2026). Cada línea abre la ficha de la operación:
              con quién, dónde y el teléfono. Se actualiza sola al cambiar una canalización
              (Realtime) y con el aviso `recollida_confirmada`. */}
          <LiniesSortida sortides={sortides} onObre={setFitxa} />
          {canalitzacions.filter((c) => c.kg_reales != null).map((c) => (
            <p key={c.id} className="text-sm text-muted-foreground">
              {destins[c.id] ? `${destins[c.id]}: ` : ''}
              {t('po.real_kg', { n: Number(c.kg_reales).toLocaleString('ca-ES') })}
            </p>
          ))}
        </CardContent>
      </Card>

      {['pendent_validacio', 'publicada', 'parcial', 'bloqueada'].includes(oferta.estado) && (
        <Button variant="outline" className="h-11 whitespace-normal md:h-9" onClick={() => setEditant(true)}>
          {t('edit.cta')}
        </Button>
      )}
      <DialegEditaOferta obert={editant} onObert={setEditant} oferta={oferta}
        kgCanalitzats={canalitzats} esEquip={false} onFet={carrega} />

      {cancelable && (
        <Button
          variant="destructive"
          className="h-11 whitespace-normal md:h-9"
          onClick={() => setCancelant(true)}
        >
          {t('po.cancel_offer')}
        </Button>
      )}

      <Dialog open={fitxa != null} onOpenChange={(v) => !v && setFitxa(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('op.title')}</DialogTitle></DialogHeader>
          {fitxa && <FitxaOperacio canalizacionId={fitxa} />}
        </DialogContent>
      </Dialog>

      {/* ⚠️ El botón de confirmar no repite «Cancel·lar oferta»: el de descartar de
          `DialegMotiu` ya dice «Cancel·lar» (`c.cancel`), y los dos se leían casi igual
          (deuda §12.124). `po.cancel_offer_confirm` es solo para este botón; el título del
          diálogo y el botón que lo abre siguen diciendo «Cancel·lar oferta». */}
      <DialegMotiu
        obert={cancelant}
        onObert={setCancelant}
        titol={t('po.cancel_offer')}
        // Con kilos ya asignados, cancelar deja a esas entidades sin su entrega y nada las
        // avisa solo: se dice antes de confirmar.
        descripcio={canalitzats > 0
          ? `${t('po.cancel_desc')} ${t('po.cancel_desc_assigned', { n: canalitzats.toLocaleString('ca-ES') })}`
          : t('po.cancel_desc')}
        etiqueta={t('po.cancel_reason')}
        confirmar={t('po.cancel_offer_confirm')}
        destructiu
        ocupat={ocupatCancel}
        onConfirma={(m) => void cancelar(m)}
      />
    </div>
  )
}
