// La ficha de una operación ya asignada (fase 2 de la revisión del cliente del 08-10-2026).
//
// «Cuando el receptor vea una oferta como Assignada, debe tener toda la información necesaria
// para saber qué recibe, cuánto recibe, de quién, dónde y cuándo lo recoge.» Y el productor,
// a quién va, cuánto y cuándo. UNA ficha para los dos paneles: la base decide qué ve cada uno
// (`operacio_detall()`), y aquí solo cambia de quién se habla —la contraparte—.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, MapPin, Phone, User } from 'lucide-react'
import { useT } from '../lib/i18n'
import { kg } from '../lib/format'
import { quanAvis } from '../lib/avisos'
import { carregaOperacio } from '../lib/operacio'
import type { Operacio } from '../lib/operacio'
import CarregantSeccio from './CarregantSeccio'
import RegistraRecollida from './RegistraRecollida'

/** Las clases del estado de la recogida, sin colores fuera de los tokens (§2bis). */
const CLASSE: Record<string, string> = {
  pendent: 'bg-aviso-fondo text-aviso',
  programada: 'bg-aviso-fondo text-aviso',
  entregada: 'bg-muted text-foreground',
  confirmada: 'bg-exito-fondo text-exito',
  conciliada: 'border border-input bg-background text-muted-foreground',
}

export default function FitxaOperacio(
  { canalizacionId, onCanvi }: { canalizacionId: string; onCanvi?: () => void },
) {
  const { t } = useT()
  const [op, setOp] = useState<Operacio | null | undefined>(undefined)

  useEffect(() => {
    let viu = true
    void carregaOperacio(canalizacionId).then((o) => { if (viu) setOp(o) })
    return () => { viu = false }
  }, [canalizacionId])

  // Tras registrar la recogida: la ficha se relee (estado, kilos, albaranes) y quien la
  // contiene refresca su lista.
  const recarrega = useCallback(() => {
    void carregaOperacio(canalizacionId).then((o) => setOp(o))
    onCanvi?.()
  }, [canalizacionId, onCanvi])

  if (op === undefined) return <CarregantSeccio files={2} ambCapcalera={false} />
  if (op === null) return <p className="text-sm text-muted-foreground">{t('op.err')}</p>

  // De quién se habla: al receptor, de quien ofrece; al productor, de quien recibe.
  const ofertant = op.rol !== 'productor'
  const contrapart = ofertant
    ? { titol: t('op.ofertant'), nom: op.productor_nom, contacte: op.productor_contacte, telefon: op.productor_telefon }
    : { titol: t('op.receptor'), nom: op.entitat_nom, contacte: op.entitat_contacte, telefon: op.entitat_telefon }

  const fila = (etiqueta: string, valor: React.ReactNode) => (valor == null || valor === '' ? null : (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[10rem_1fr]">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="text-sm">{valor}</dd>
    </div>
  ))

  return (
    <div className="space-y-4" data-testid="fitxa-operacio">
      {/* Lo que más importa, primero y en grande: cuánto y cuándo. */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-muted/50 p-3">
        <div>
          <p className="text-xs text-muted-foreground">{t('op.kg_assignats')}</p>
          <p className="font-titulos text-2xl font-semibold">{kg(op.kg_assignats)} kg</p>
          {op.kg_sollicitats != null && op.kg_sollicitats !== op.kg_assignats && (
            <p className="text-xs text-muted-foreground">{t('op.kg_sollicitats', { n: kg(op.kg_sollicitats) })}</p>
          )}
          {op.kg_rebuts != null && (
            <p className="text-xs text-muted-foreground">{t('op.kg_rebuts', { n: kg(op.kg_rebuts) })}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{t('op.recollida')}</p>
          <p className="font-medium">{op.data_hora_recollida ? quanAvis(op.data_hora_recollida) : t('op.sense_data')}</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CLASSE[op.estat_recollida] ?? ''}`}>
            {t(`op.estat_${op.estat_recollida}`)}
          </span>
        </div>
      </div>

      {/* 17-10-2026: el receptor cierra la recogida. Lo que se ha registrado, y si hay una
          diferencia que el equipo tiene que revisar. */}
      {op.pot_registrar && <RegistraRecollida op={op} onFet={recarrega} />}
      {op.recollida_registrada_at && (
        <p className="text-sm text-muted-foreground" data-testid="recollida-registrada">
          {t(op.rol === 'entidad' ? 'op.registrada_tu' : 'op.registrada', {
            quan: quanAvis(op.recollida_real_at ?? op.recollida_registrada_at),
            kg: kg(op.kg_rebuts),
            entitat: op.entitat_nom ?? '',
          })}
        </p>
      )}
      {op.incidencia_recollida && op.estat_recollida !== 'conciliada' && (
        <div className="space-y-1 rounded-lg bg-aviso-fondo p-3 text-sm" data-testid="incidencia-recollida">
          <p className="flex items-center gap-1.5 font-medium text-aviso">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />{t('op.incidencia_t')}
          </p>
          <p>
            {t(op.incidencia_recollida.resultat === 'mes' ? 'op.incidencia_mes' : 'op.incidencia_menys', {
              kg: kg(op.incidencia_recollida.kg_reals),
              assignats: kg(op.incidencia_recollida.kg_assignats),
            })}
          </p>
          {op.incidencia_recollida.descripcion && (
            <p className="text-muted-foreground">«{op.incidencia_recollida.descripcion}»</p>
          )}
          <p className="text-muted-foreground">
            {t(op.rol === 'productor' ? 'op.incidencia_productor' : 'op.incidencia_revisio')}
          </p>
        </div>
      )}

      <dl className="space-y-2">
        {fila(t('op.producte'), [op.producte, op.varietat].filter(Boolean).join(' · '))}
        {fila(t('op.modalitat'), op.modalitat ? t(`od.mod_${op.modalitat}`) : null)}
        {fila(contrapart.titol, contrapart.nom)}
        {fila(t('op.persona'), contrapart.contacte ? (
          <span className="inline-flex items-center gap-1"><User className="size-3.5" aria-hidden />{contrapart.contacte}</span>
        ) : null)}
        {fila(t('op.telefon'), contrapart.telefon ? (
          <a href={`tel:+${contrapart.telefon.replace(/\D/g, '')}`} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Phone className="size-3.5" aria-hidden />+{contrapart.telefon.replace(/\D/g, '')}
          </a>
        ) : null)}
      </dl>

      {/* El punto de recogida, completo: sale de la ubicación que registró el ofertante. */}
      <div className="space-y-2 rounded-lg border p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <MapPin className="size-4" aria-hidden />{t('op.lloc')}
        </p>
        <dl className="space-y-2">
          {fila(t('op.lloc_nom'), op.lloc_alias)}
          {fila(t('op.lloc_adreca'), [op.lloc_adreca, op.lloc_municipi].filter(Boolean).join(', '))}
          {fila(t('op.persona'), op.lloc_contacte)}
          {fila(t('op.telefon'), op.lloc_telefon ? (
            <a href={`tel:+${op.lloc_telefon.replace(/\D/g, '')}`} className="text-primary hover:underline">+{op.lloc_telefon.replace(/\D/g, '')}</a>
          ) : null)}
          {fila(t('op.horari'), op.lloc_horari)}
          {fila(t('op.observacions'), op.lloc_observacions)}
        </dl>
        {op.lloc_maps && (
          <a href={op.lloc_maps} target="_blank" rel="noreferrer" className="inline-block text-sm text-primary hover:underline">
            {t('int.d_maps')}
          </a>
        )}
      </div>

      <dl className="space-y-2">
        {fila(t('op.condicions'), op.condicions)}
        {fila(t('op.albara'), op.albara_numero)}
        {/* El de recepción (ofertant → Espigoladors) es del ofertante y del equipo. */}
        {op.rol !== 'entidad' && fila(t('op.albara_rec'), op.rec_numero)}
      </dl>
    </div>
  )
}
