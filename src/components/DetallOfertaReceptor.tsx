// El detalle de una oferta tal como lo ve una entidad receptora: foto grande (y las demás
// debajo), producto, kilos, comarca, modalidad, precio si lo hay, disponibilidad, formato,
// transporte, causa y observaciones.
//
// UNO SOLO para el Mercat y para «Els meus interessos» (28-09-2026). Estaba escrito dentro
// del Mercat; en Interessos las tarjetas no se podían abrir, y copiarlo habría dado dos
// fichas de la misma oferta que acabarían diciendo cosas distintas.
//
// ⚠️ Sin el nombre del productor, a propósito (D3, §4): el receptor ve la comarca, no quién
//    ofrece. Si la Fundación decide lo contrario, se añade aquí y sale en los dos sitios.

import { ambPreu, modalitatsOferta, textModalitats } from '../lib/modalitats'
import { useT } from '../lib/i18n'
import { dataCurta } from '../lib/albarans'
import type { Excedente } from '../types'
import { FotoOferta, FotoOfertaResolta, useUrlsFotos } from './FotosOferta'
import type { FotoResolta } from './FotosOferta'

/**
 * La oferta tal como la puede recibir un receptor: SOLO estas columnas.
 *
 * 🔴 D3 TAMBIÉN EN LA API, no solo en la pantalla (28-09-2026). Con `select('*')` el
 *    navegador de la entidad recibía `texto_oferta` (lleva la línea «PRODUCTOR: …»),
 *    `id_excedente` (sus tres letras son las de la productora), `productor_id` y
 *    `ubicacion_id`: no se pintaban, pero cualquiera los leía en la pestaña de red. Las
 *    pantallas del receptor piden estas columnas y ninguna más, cada una en su literal (§7):
 *
 *    id, estado, familia, producto, variedad, kg_total, num_caixes, tipo_caixa,
 *    retorn_envasos, modalitat, modalitats, causa, disponible_hasta, horari_recollida,
 *    hora_recollida_inici, hora_recollida_fi, observacions,
 *    preu_minim, producte_al_camp, comarca, format_entrega, transport_propi, fotos,
 *    foto_producte
 *
 *    Si esta lista cambia, hay que cambiar los `select` de Mercat e Interessos a la vez.
 */
export type OfertaReceptor = Pick<
  Excedente,
  | 'id' | 'estado' | 'familia' | 'producto' | 'variedad' | 'kg_total' | 'num_caixes'
  | 'tipo_caixa' | 'retorn_envasos' | 'modalitat' | 'modalitats' | 'causa' | 'disponible_hasta'
  | 'horari_recollida' | 'hora_recollida_inici' | 'hora_recollida_fi' | 'observacions' | 'preu_minim' | 'producte_al_camp' | 'comarca'
  | 'format_entrega' | 'transport_propi' | 'fotos' | 'foto_producte'
>

export default function DetallOfertaReceptor({ oferta, foto }: {
  oferta: OfertaReceptor
  /** La foto principal ya resuelta (la de la oferta, la del producto o el icono), en grande. */
  foto: FotoResolta
}) {
  const { t } = useT()
  const urls = useUrlsFotos(oferta.fotos?.slice(1) ?? [])
  const preu = preuDe(oferta)

  return (
    <>
      {/* Foto grande y, si hay más, las otras debajo para abrirlas en su tamaño. Sin
          fotos propias, el icono del producto. */}
      <div className="space-y-2">
        <FotoOfertaResolta foto={foto} alt={oferta.producto ?? ''} className="aspect-[4/3] w-full" />
        {(oferta.fotos?.length ?? 0) > 1 && (
          <div className="flex gap-2">
            {oferta.fotos.slice(1).map((r) => (
              <a key={r} href={urls[r]} target="_blank" rel="noreferrer">
                <FotoOferta url={urls[r]} alt={oferta.producto ?? ''} className="size-16" />
              </a>
            ))}
          </div>
        )}
      </div>
      <p className="font-titulos text-lg font-semibold">
        {oferta.producto ?? '—'}{oferta.variedad ? ` · ${oferta.variedad}` : ''}
      </p>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Dada etiqueta={t('mk.d_kg')} valor={`${kgFmt(oferta.kg_total)} kg`} />
        <Dada etiqueta={t('mk.d_zone')} valor={oferta.comarca ?? '—'} />
        <Dada etiqueta={t('mk.d_mode')} valor={textModalitats(modalitatsOferta(oferta), t) || '—'} />
        {preu && <Dada etiqueta={t('mk.d_price')} valor={preu} />}
        <Dada etiqueta={t('mk.d_until')} valor={oferta.disponible_hasta ? dataCurta(oferta.disponible_hasta) : '—'} />
        {oferta.horari_recollida && <Dada etiqueta={t('mk.d_hours')} valor={oferta.horari_recollida} />}
        <Dada etiqueta={t('mk.d_field')} valor={oferta.producte_al_camp ? t('mk.d_field_yes') : t('mk.d_field_no')} />
        {/* El formato nuevo (desde el 27-09-2026) y, si no lo hay, el tipo de caja de las
            ofertas anteriores. */}
        {(oferta.format_entrega || oferta.tipo_caixa || oferta.num_caixes != null) && (
          <Dada
            etiqueta={t('mk.d_format')}
            valor={[
              oferta.format_entrega ? t(`mk.fmt_${oferta.format_entrega}`) : oferta.tipo_caixa,
              oferta.num_caixes != null ? `${oferta.num_caixes}` : null,
            ].filter(Boolean).join(' · ')}
          />
        )}
        {oferta.transport_propi != null && (
          <Dada
            etiqueta={t('mk.d_transport')}
            valor={oferta.transport_propi ? t('mk.d_transport_yes') : t('mk.d_transport_no')}
          />
        )}
        {oferta.retorn_envasos && <Dada etiqueta={t('mk.d_return')} valor={oferta.retorn_envasos} />}
        {oferta.causa && <Dada etiqueta={t('mk.d_cause')} valor={oferta.causa} />}
      </dl>
      {oferta.observacions && (
        <div className="text-sm">
          <p className="text-xs text-muted-foreground">{t('mk.d_notes')}</p>
          <p className="whitespace-pre-wrap">{oferta.observacions}</p>
        </div>
      )}
    </>
  )
}

function Dada({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  )
}

/** «1.320» i «0,45»: el format local, no el del punt decimal de la base. */
export function kgFmt(n: number | null | undefined): string {
  return n == null ? '—' : new Intl.NumberFormat('ca-ES', { maximumFractionDigits: 2 }).format(Number(n))
}

/** El precio, solo si la modalidad lo tiene: una donación no lleva precio. */
export function preuDe(o: Pick<Excedente, 'modalitat' | 'modalitats' | 'preu_minim'>): string | null {
  // Con varias modalidades (05-10-2026) el precio vale para la venta o la maquila, no para
  // la donación: basta con que la oferta incluya una con precio.
  if (!ambPreu(modalitatsOferta(o)) || o.preu_minim == null) return null
  return `${new Intl.NumberFormat('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(o.preu_minim))} €/kg`
}
