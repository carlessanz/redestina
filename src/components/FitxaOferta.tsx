// La FICHA de una oferta: todo lo que se contestó al publicarla, en lectura, y el mensaje para
// compartir (fase C del punto 3, 17-11-2026, filas 3.7.2 y 3.7.5 del Excel de la Fundació). La
// usan el detalle del equipo (`OfferDetail`) y el del productor (`productor/OfertaDetall`).
//
// Hasta entonces el detalle enseñaba el texto de la oferta y poco más: el formato de entrega, el
// retorno de envases, los días o el enlace del punto de recogida solo se veían dentro del texto.
//
// El texto que se comparte es `texto_oferta`, tal cual: lo compone el servidor desde la fila al
// publicar y al editar (`textoOfertaDeDades`), así que siempre dice lo que dice la oferta. No se
// recompone aquí.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ExternalLink, Pencil, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { dataCurta } from '../lib/format'
import { textFranja } from '../lib/franja'
import { ambPreu, modalitatsOferta, textModalitats } from '../lib/modalitats'
import { carregaCatalegCauses, textSubcausa, type CausaAmbSubcauses } from '../lib/causes'
import { urlsFotos } from '../lib/fotos'
import { comparteixOferta, esCompartible, nomFitxerFoto } from '../lib/compartirOferta'
import BotoCopiar from './BotoCopiar'
import type { Excedente } from '../types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Lloc { alias: string | null; municipio: string | null; gmaps_url: string | null }

interface Props {
  oferta: Excedente
  /** El coste por kilo declarado solo lo ven el equipo y el propio productor. */
  ambCost?: boolean
  /** «Edita l'oferta», si se puede editar (quien monta la ficha lo decide). */
  onEdita?: () => void
  /** Vencida con kilos sin cubrir (lo calcula quien monta la ficha). */
  vencida?: boolean
  /** La etiqueta del botón de copiar (el equipo dice «Copiar per al grup»). */
  etiquetaCopiar?: string
}

/** Una fila «etiqueta: valor». Sin valor no se pinta (como en el texto: nada de etiquetas vacías). */
function Dada({ etiqueta, children, ample }: { etiqueta: string; children: ReactNode; ample?: boolean }) {
  return (
    <div className={ample ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  )
}

export default function FitxaOferta({ oferta, ambCost = false, onEdita, vencida = false, etiquetaCopiar }: Props) {
  const { t, lang } = useT()
  const [lloc, setLloc] = useState<Lloc | null>(null)
  const [cataleg, setCataleg] = useState<CausaAmbSubcauses[]>([])
  const [compartint, setCompartint] = useState(false)

  useEffect(() => {
    if (!oferta.ubicacion_id) { setLloc(null); return }
    let viu = true
    void supabase.from('productor_ubicaciones').select('alias, municipio, gmaps_url')
      .eq('id', oferta.ubicacion_id).maybeSingle()
      .then(({ data }) => { if (viu) setLloc((data as Lloc | null) ?? null) })
    return () => { viu = false }
  }, [oferta.ubicacion_id])

  useEffect(() => {
    let viu = true
    void carregaCatalegCauses().then((r) => { if (viu && r.ok) setCataleg(r.data) })
    return () => { viu = false }
  }, [])

  const mods = modalitatsOferta(oferta)
  const maps = oferta.gmaps_url || lloc?.gmaps_url || null
  const causa = textSubcausa(cataleg, oferta.subcausa_codigo, lang) || oferta.causa || ''
  const franja = textFranja(oferta.hora_recollida_inici, oferta.hora_recollida_fi) || oferta.horari_recollida || ''
  const dies = (oferta.dies_recollida ?? []).map((d) => t(`org.dia_${d}`)).join(', ')
  const kgTotal = Number(oferta.kg_total ?? 0)
  const eur = (n: number) => `${n.toLocaleString('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/kg`
  const format = oferta.format_entrega
    ? `${t(`fo.fmt_${oferta.format_entrega}`)}${oferta.num_caixes ? ` · ${oferta.num_caixes}` : ''}`
    : ''
  const retorn = oferta.retorn_envasos === 'Sí'
    ? [t('c.yes'), oferta.retorn_envasos_quantitat ? String(oferta.retorn_envasos_quantitat) : '', oferta.retorn_envasos_detall ?? '']
      .filter(Boolean).join(' · ')
    : oferta.retorn_envasos === 'No' ? t('c.no') : ''
  const compartible = esCompartible(oferta.estado)

  async function comparteix() {
    if (!oferta.texto_oferta) return
    setCompartint(true)
    const ruta = oferta.fotos?.[0] ?? null
    const url = ruta ? (await urlsFotos([ruta]))[ruta] ?? null : null
    const r = await comparteixOferta(oferta.texto_oferta, url && ruta ? { url, nom: nomFitxerFoto(oferta.producto, ruta) } : null)
    setCompartint(false)
    if (r === 'copiat') toast.success(t(ruta ? 'fo.comparteix_copiat_foto' : 'fo.comparteix_copiat'))
    else if (r === 'error') toast.error(t('copia.err'))
  }

  return (
    <Card data-testid="fitxa-oferta">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t('fo.titol')}</CardTitle>
        {onEdita && (
          <Button variant="outline" className="h-11 whitespace-nowrap shrink-0 md:h-8" onClick={onEdita}>
            <Pencil className="size-4" aria-hidden /> {t('edit.cta')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Dada etiqueta={t('fo.producte')}>
            {oferta.producto ?? '—'}{oferta.variedad ? ` · ${oferta.variedad}` : ''}
            {oferta.producte_al_camp && <span className="ml-2 text-xs text-aviso">{t('fo.al_camp')}</span>}
          </Dada>
          {kgTotal > 0 && <Dada etiqueta={t('fo.quantitat')}>{kgTotal.toLocaleString('ca-ES')} kg</Dada>}
          {format && <Dada etiqueta={t('fo.format')}>{format}</Dada>}
          {retorn && <Dada etiqueta={t('fo.retorn')}>{retorn}</Dada>}
          {(lloc || maps) && (
            <Dada etiqueta={t('fo.lloc')} ample>
              {lloc && <span>{lloc.alias ?? t('po.place_unnamed')}{lloc.municipio ? ` · ${lloc.municipio}` : ''}</span>}
              {maps && (
                <a href={maps} target="_blank" rel="noreferrer" data-testid="fitxa-maps"
                  className={`${lloc ? 'ml-2 ' : ''}inline-flex items-center gap-1 text-primary underline`}>
                  {t('po.place_open_maps')} <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </Dada>
          )}
          {oferta.disponible_hasta && (
            <Dada etiqueta={t('od.available_until')}>
              {dataCurta(oferta.disponible_hasta)}
              {vencida && <span className="ml-2 text-error">{t('od.expired')}</span>}
            </Dada>
          )}
          {(dies || franja) && (
            <Dada etiqueta={t('fo.horari')}>{[dies, franja].filter(Boolean).join(' · ')}</Dada>
          )}
          {mods.length > 0 && <Dada etiqueta={t('fo.modalitats')}>{textModalitats(mods, t)}</Dada>}
          {ambPreu(mods) && oferta.preu_minim != null && (
            <Dada etiqueta={t('fo.preu')}>{eur(Number(oferta.preu_minim))}</Dada>
          )}
          {ambCost && mods.includes('donacio') && oferta.coste_kg != null && (
            <Dada etiqueta={t('fo.cost')}>{eur(Number(oferta.coste_kg))}</Dada>
          )}
          {causa && <Dada etiqueta={t('fo.causa')} ample>{causa}</Dada>}
          {oferta.observacions && <Dada etiqueta={t('fo.obs')} ample>{oferta.observacions}</Dada>}
        </dl>

        {oferta.texto_oferta && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('od.offer_text')}</p>
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-sans text-sm" data-testid="text-oferta">
              {oferta.texto_oferta}
            </pre>
            <div className="flex flex-wrap gap-2">
              <BotoCopiar text={oferta.texto_oferta} etiqueta={etiquetaCopiar} className="h-11 md:h-8" />
              {/* Solo lo que circula: un esborrany no tiene texto y una pendiente de validar
                  todavía no ha salido (filas 3.1.2 y 3.7.1). */}
              {compartible && (
                <Button variant="outline" className="h-11 whitespace-nowrap shrink-0 md:h-8" data-testid="comparteix"
                  disabled={compartint} onClick={() => void comparteix()}>
                  <Share2 className="size-4" aria-hidden /> {t('fo.comparteix')}
                </Button>
              )}
            </div>
            {!compartible && oferta.estado === 'pendent_validacio' && (
              <p className="text-xs text-muted-foreground">{t('fo.comparteix_pendent')}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
