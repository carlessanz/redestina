// El bloque «Disponibilitat multiproducte» del detalle de una oferta (plan DIC 26, fase 6a).
//
// Una oferta que se publicó junto con otras del mismo productor (`disponibilitat_id`) enseña aquí
// sus HERMANAS (cada una con su enlace: siguen siendo ofertas independientes, con su detalle,
// sus intereses y su recogida) y el MENSAJE ÚNICO del grupo (`textDisponibilitat()`), con un solo
// enlace al Mercat (`/receptor/mercat?disponibilitat=<id>`) donde la entidad elige productos y kg.
//
// Lo montan el detalle del equipo (`OfferDetail`, con el código `D-…`, los `E-…` y el envío a
// entidades por `children`) y el del productor (`productor/OfertaDetall`, sin códigos internos).

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Layers, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { kg as fmtKg } from '../../lib/format'
import { etiquetaEstatOferta } from '../../lib/procesOferta'
import { comparteixOferta } from '../../lib/compartirOferta'
import type { DadesDisponibilitat } from '../../hooks/useDisponibilitat'
import BotoCopiar from '../BotoCopiar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  grup: DadesDisponibilitat
  /** La oferta que se está mirando (se marca, sin enlace). */
  actual: string
  panell: 'equip' | 'productor'
  /**
   * Las acciones sobre el grupo entero, justo debajo de las hermanas. Hueco reservado para la
   * fase 6b (asignación conjunta del equipo, `assignar_directe_multiple`): lo pasa `OfferDetail`.
   */
  accions?: ReactNode
  /** Lo que el panel añade al final (el equipo: el envío a entidades). */
  children?: ReactNode
}

export default function DisponibilitatMultiproducte({ grup, actual, panell, accions, children }: Props) {
  const { t } = useT()
  const [compartint, setCompartint] = useState(false)
  const equip = panell === 'equip'
  const ruta = (id: string) => (equip ? `/equip/ofertes/${id}` : `/productor/ofertes/${id}`)

  async function comparteix() {
    if (!grup.text) return
    setCompartint(true)
    const r = await comparteixOferta(grup.text, null)
    setCompartint(false)
    if (r === 'copiat') toast.success(t('fo.comparteix_copiat'))
    else if (r === 'error') toast.error(t('copia.err'))
  }

  return (
    <Card id="disponibilitat" className="scroll-mt-20" data-testid="bloc-disponibilitat">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Layers className="size-4 shrink-0" aria-hidden />
          {t('mp.bloc_titol')}
          {/* El `D-…` es de gestión interna: solo el equipo (como el `E-…`). */}
          {equip && grup.codi && <code className="text-sm font-normal text-muted-foreground" data-testid="codi-disponibilitat">{grup.codi}</code>}
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('mp.bloc_hint', { n: grup.ofertes.length })}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-lg border" data-testid="germanes">
          {grup.ofertes.map((o) => {
            const est = etiquetaEstatOferta(o.estado)
            const nom = `${o.producto ?? '—'}${o.variedad ? ` · ${o.variedad}` : ''}`
            const kgTotal = Number(o.kg_total ?? 0)
            return (
              <li key={o.id} data-testid="germana" data-actual={o.id === actual || undefined}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-3">
                <div className="min-w-0">
                  {o.id === actual ? (
                    <span className="font-medium break-words">{nom} <span className="text-xs font-normal text-muted-foreground">({t('mp.aquesta')})</span></span>
                  ) : (
                    <Link to={ruta(o.id)} className="font-medium break-words text-primary hover:underline" data-testid="enllac-germana">
                      {nom}
                    </Link>
                  )}
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {kgTotal > 0 ? `${fmtKg(kgTotal)} kg` : '—'}
                    {equip && o.id_excedente ? <> · <code>{o.id_excedente}</code></> : null}
                  </span>
                </div>
                {/* El estado detallado, solo al equipo: los paneles externos ven estados simples
                    en el detalle de cada oferta (§6ter). */}
                {equip && <Badge className={`${est.clase} max-w-full whitespace-normal`}>{t(est.key)}</Badge>}
              </li>
            )
          })}
        </ul>

        {/* 6b: assignació multiproducte — las acciones del grupo entero (las pasa quien monta). */}
        {accions && <div data-testid="accions-disponibilitat">{accions}</div>}

        <div className="space-y-2">
          <p className="text-sm font-medium">{t('mp.text_titol')}</p>
          {grup.text ? (
            <>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-sans text-sm" data-testid="text-disponibilitat">
                {grup.text}
              </pre>
              <div className="flex flex-wrap gap-2">
                <BotoCopiar text={grup.text} etiqueta={t('mp.copia_text')} className="h-11 whitespace-normal md:h-8" />
                <Button variant="outline" className="h-11 whitespace-nowrap shrink-0 md:h-8" data-testid="comparteix-disponibilitat"
                  disabled={compartint} onClick={() => void comparteix()}>
                  <Share2 className="size-4" aria-hidden /> {t('fo.comparteix')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('mp.text_hint')}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-disponibilitat-no">{t('mp.text_no_circula')}</p>
          )}
        </div>

        {children}
      </CardContent>
    </Card>
  )
}
