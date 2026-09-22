// Detalle de una oferta desde el panel del productor: qué publicó, en qué punto del
// proceso está y qué le toca hacer (casi siempre, nada). Puede cancelarla; editarla no,
// porque el texto de la oferta ya ha circulado por WhatsApp y cambiarlo dejaría a las
// entidades mirando algo que no existe.
//
// ES TAMBIÉN LA PANTALLA DE «PUBLICADA». Publicar ya no termina en un toast: `NovaOferta`
// navega aquí con `state.publicada`, y lo primero que se ve es la referencia, qué pasa
// ahora y por dónde seguir. Un toast dice eso mismo durante cuatro segundos y se lo lleva;
// esto se puede volver a mirar, y se llega por una URL que se puede compartir.
//
// ⚠️ QUÉ NO SE ENSEÑA, Y NO ES UN OLVIDO: el nombre de la entidad que se queda el producto.
//    `progres_meves_ofertes()` devuelve cuántas, nunca cuáles (20270323100000): quién
//    quiere el producto es información de la otra parte y de la coordinación. Antes esa
//    ausencia no se explicaba y parecía un dato que faltaba; ahora se dice en una línea.

import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import DialegMotiu from '../../components/DialegMotiu'
import { useT } from '../../lib/i18n'
import { cancelaOferta } from '../../lib/ofertes'
import { carregaPendents } from '../../lib/pendents'
import { carregaProgresOfertes } from '../../lib/progresOfertes'
import type { ProgresOferta } from '../../lib/progresOfertes'
import type { AlbaranBandeja } from '../../lib/albarans'
import {
  PASSOS_OFERTA_CLAUS, etiquetaEstatOferta, puntOferta,
} from '../../lib/procesOferta'
import PasosProces from '../../components/proces/PasosProces'
import QueTocaAra from '../../components/proces/QueTocaAra'
import BlocPublicada from '../../components/proces/BlocPublicada'
import type { Canalizacion, EstadoAlbaran, Excedente } from '../../types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Lo que `NovaOferta` deja al navegar aquí. Nada de esto sobrevive a una recarga. */
interface EstatArribada { publicada?: boolean; correuEnviat?: boolean }

export default function ProductorOfertaDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const arribada = (location.state ?? {}) as EstatArribada

  const [oferta, setOferta] = useState<Excedente | null>(null)
  const [canalitzacions, setCanalitzacions] = useState<Canalizacion[]>([])
  const [rec, setRec] = useState<AlbaranBandeja | null>(null)
  const [pendentDeMi, setPendentDeMi] = useState(false)
  const [progres, setProgres] = useState<ProgresOferta | null>(null)
  const [carregant, setCarregant] = useState(true)

  const carrega = useCallback(async () => {
    if (!id) return
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    // Sin `.eq()` de organización en el albarán: la RLS ya devuelve solo lo suyo, igual
    // que en `productor/Documents.tsx`.
    const [e, c, a] = await Promise.all([
      supabase.from('excedentes').select('*').eq('id', id).maybeSingle(),
      supabase.from('canalizaciones').select('*').eq('excedente_id', id)
        .order('created_at', { ascending: true }),
      supabase.from('v_albaranes_bandeja')
        .select('id, tipo, numero_completo, estado, ejercicio, excedente_id, espigolada_id, canalizacion_id, id_excedente, producto, productor_id, entidad_id, codigo_lote, emitido_at, entregado_at, confirmado_at, conciliado_at, rechazo, kg_previstos, kg_neto, kg_confirmados, kg_validados, dias_esperando')
        .eq('excedente_id', id)
        .eq('tipo', 'REC')
        .order('emitido_at', { ascending: false, nullsFirst: true }),
    ])
    setOferta((e.data as Excedente) ?? null)
    setCanalitzacions((c.data ?? []) as Canalizacion[])
    const albarans = (a.data as AlbaranBandeja[] | null) ?? []
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
    if (!r.ok) { toast.error(r.error ?? t('c.error')); return }
    setCancelant(false)
    toast.success(t('po.cancelled'))
    await carrega()
  }

  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  if (!oferta) return <p className="text-sm text-destructive">{t('od.not_found')}</p>

  const canalitzats = canalitzacions.reduce((s, c) => s + Number(c.kg_confirmados ?? 0), 0)
  const total = Number(oferta.kg_total ?? 0)
  const est = etiquetaEstatOferta(oferta.estado)
  const cancelable = ['borrador', 'publicada', 'parcial'].includes(oferta.estado)

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
          referencia={oferta.id_excedente ?? '—'}
          punt={punt}
          correuEnviat={arribada.correuEnviat === true}
          onInici={() => navigate('/productor/inici')}
          onAltra={() => navigate('/productor/ofertes/nova')}
        />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold"><code>{oferta.id_excedente}</code></h1>
          <p className="text-sm text-muted-foreground">
            {oferta.producto}{oferta.variedad ? ` · ${oferta.variedad}` : ''}
          </p>
          <span className={cn('mt-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium', est.clase)}>
            {t(est.key)}
          </span>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{canalitzats}/{total} kg</div>
          <span className="text-sm text-muted-foreground">
            {total - canalitzats > 0 ? t('off.falten', { n: total - canalitzats }) : t('off.complet')}
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
          {/* El nombre de la entidad no se muestra: ni la RPC del embudo ni esta pantalla
              lo piden (§4bis, y la cabecera de 20270323100000). Decirlo aquí evita que
              parezca un dato que falta. */}
          <p className="mt-1 text-sm text-muted-foreground">{t('po.dest_hint')}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {canalitzacions.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('po.no_channelings')}</p>
          )}
          {canalitzacions.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5 text-sm">
              <span>{t('po.channeled_kg', { n: Number(c.kg_confirmados ?? 0) })}</span>
              {c.kg_reales != null && (
                <span className="text-muted-foreground">{t('po.real_kg', { n: Number(c.kg_reales) })}</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {cancelable && (
        <Button
          variant="destructive"
          className="h-11 whitespace-normal md:h-9"
          onClick={() => setCancelant(true)}
        >
          {t('po.cancel_offer')}
        </Button>
      )}

      {/* ⚠️ El botón de confirmar no repite «Cancel·lar oferta»: el de descartar de
          `DialegMotiu` ya dice «Cancel·lar» (`c.cancel`), y los dos se leían casi igual
          (deuda §12.124). `po.cancel_offer_confirm` es solo para este botón; el título del
          diálogo y el botón que lo abre siguen diciendo «Cancel·lar oferta». */}
      <DialegMotiu
        obert={cancelant}
        onObert={setCancelant}
        titol={t('po.cancel_offer')}
        descripcio={t('po.cancel_desc')}
        etiqueta={t('po.cancel_reason')}
        confirmar={t('po.cancel_offer_confirm')}
        destructiu
        ocupat={ocupatCancel}
        onConfirma={(m) => void cancelar(m)}
      />
    </div>
  )
}
