// Fase 4 · el interés y su aprobación. La entidad dice por teléfono cuántos kilos quiere,
// cómo y cuándo los recoge, y el equipo lo registra **como lo haría ella desde el Mercat**
// (`manifestar_interes_assistit` pasa por la misma `comprova_interes()`, 20270430100100).
// Debajo, los intereses que esperan decisión, aprobables aquí con el mismo formulario que
// Aprovacions y el detalle de la oferta, y CON EL CONVENIO DE CADA RECEPTORA al lado:
// `aprovar_resposta()` lo exige desde la fecha de corte (42501 `sense_conveni`), así que los
// botones que lo resuelven viven en la misma fila.
//
// Puntos 4-6, fase 2: quien puede aprobar asigna en un acto desde el mismo formulario
// («Registrar i confirmar recollida», `assignar_directe`), y debajo están las asignaciones
// vivas con «Modifica», «Anul·la l'assignació» y el precio acordado de las ventas: los mismos
// componentes que la ficha de la oferta (`AccionsAssignacio`).

import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useT } from '../../../lib/i18n'
import { kg as fmtKg } from '../../../lib/format'
import { cn } from '../../../lib/utils'
import type { ConvenioTipo } from '../../../types'
import MissatgesDelPunt from '../../MissatgesDelPunt'
import FormulariAprovacio from '../FormulariAprovacio'
import FormulariInteresAssistit from '../FormulariInteresAssistit'
import AccionsAssignacio, { PreuAcordat } from '../AccionsAssignacio'
import { PropostaEsperant } from '../PropostaCanvis'
import type { AssignacioFila } from '../AccionsAssignacio'
import { Badge } from '@/components/ui/badge'
import AccionsConveni from './AccionsConveni'
import type { ContextFase } from './tipus'

/**
 * Qué convenio le exige a la RECEPTORA la modalidad de esta oferta. Desde el Conveni de
 * col·laboració único (fase 5), uno para todas las modalidades.
 *
 * ⚠️ Si algún día la matriz deja de ser una función de la modalidad —dos convenios para una
 *    misma—, esto deja de poder derivarse y hay que pedirlo a la base.
 */
export function conveniQueCalRebre(modalitat: string | null): ConvenioTipo | null {
  return modalitat ? 'col_receptor' : null
}

export default function FaseAprovacio({ c }: { c: ContextFase }) {
  const { t } = useT()
  const { fets, extra, oferta } = c
  // Lo que falta por cubrir: contra lo que se avisa al aprobar de más (las anuladas no cuentan).
  const kgCanalitzats = extra.canalitzacions
    .filter((x) => x.estado !== 'anulada')
    .reduce((s, x) => s + Number(x.kg_confirmados ?? 0), 0)
  const faltan = Math.max(0, Number(fets.oferta.kg_total ?? 0) - kgCanalitzats)
  const pendents = extra.respostes.filter((r) => r.estado === 'acceptada' && r.aprovacio === 'pendent')
  // Fase 5 de los puntos 4-6: los intereses con una propuesta de cambios esperando a la entidad.
  const proposades = extra.respostes.filter((r) => r.estado === 'acceptada' && r.aprovacio === 'proposada')

  return (
    <div className="space-y-3">
      {oferta && (
        <FormulariInteresAssistit oferta={oferta} idPrefix="cd-interes"
          potAprovar={c.potAprovar} faltan={faltan} onFet={c.onCanvi} />
      )}

      <AssignacionsVives c={c} />

      {pendents.map((r) => {
        const cv = r.conveni_rec
        const vigent = cv?.estado === 'vigent'
        return (
          <div key={r.id} className="space-y-2 rounded-md border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm">
                {r.entitat}
                {r.kg_solicitados != null && (
                  <span className="tabular-nums"> · {Number(r.kg_solicitados).toLocaleString('ca-ES', { maximumFractionDigits: 2 })} kg</span>
                )}
                {r.modalitat ? ` · ${t(`od.mod_${r.modalitat}`)}` : ''}
                {r.canal ? ` · ${t(`od.ch_${r.canal}`)}` : ''}
              </span>
              <Badge className={cn(
                'max-w-full whitespace-normal text-left',
                vigent ? 'bg-exito-fondo text-exito' : 'bg-aviso-fondo text-aviso',
              )}>
                {cv ? t(`conv.st_${cv.estado}`) : t('canalz.rec_sense_conveni')}
                {vigent && cv?.origen === 'declarat' ? ` · ${t('conv.origen_declarat')}` : ''}
              </Badge>
            </div>

            <FormulariAprovacio
              resposta={r}
              oferta={{
                modalitat: extra.oferta.modalitat,
                modalitats: extra.oferta.modalitats ?? null,
                productor_id: extra.productor?.id ?? null,
                preu_minim: oferta?.preu_minim ?? null,
                hora_recollida_inici: oferta?.hora_recollida_inici ?? null,
                hora_recollida_fi: oferta?.hora_recollida_fi ?? null,
              }}
              faltan={faltan}
              potAprovar={c.potAprovar}
              bloqueig={vigent ? undefined : t('canalz.rec_sense_conveni')}
              idPrefix={`cd-apr-${r.id}`}
              entitat={r.entitat}
              onFet={c.onCanvi}
            />

            {/* Sin convenio vigente: qué falta y los botones que lo resuelven. */}
            {!vigent && r.entidad_id && (
              <div className="space-y-2 rounded-md bg-aviso-fondo p-2">
                <p className="text-sm text-aviso">{t('canalz.rec_conveni_cal')}</p>
                <AccionsConveni
                  tipusOrg="entidad"
                  orgId={r.entidad_id}
                  nom={r.entitat}
                  conveni={cv}
                  tipusCal={conveniQueCalRebre(extra.oferta.modalitat)}
                  esSuperAdmin={c.esSuperAdmin}
                  onCanvi={c.onCanvi}
                  petit
                />
              </div>
            )}
          </div>
        )
      })}

      {proposades.map((r) => (
        <div key={r.id} className="space-y-2 rounded-md border p-2">
          <span className="min-w-0 text-sm">{r.entitat}</span>
          <PropostaEsperant resposta={r} potAprovar={c.potAprovar} onFet={c.onCanvi} />
        </div>
      ))}

      <MissatgesDelPunt missatges={c.missatges} fase="aprovacio" />
    </div>
  )
}

/** Una asignación viva con lo que hace falta para sus acciones (fila de `canalizaciones`). */
type FilaAssignacio = AssignacioFila & { entidad_id: string | null }

/**
 * Las asignaciones vivas del lote con «Modifica», «Anul·la l'assignació» y el precio acordado.
 * `canalitzacio_assistida()` no trae el precio acordado: se leen aquí, de la tabla, cada vez que
 * el orquestador relee el lote (`extra.canalitzacions` cambia de identidad).
 */
function AssignacionsVives({ c }: { c: ContextFase }) {
  const { t } = useT()
  const { extra, oferta } = c
  const ofertaId = extra.oferta.id
  const [files, setFiles] = useState<FilaAssignacio[]>([])

  useEffect(() => {
    let viu = true
    void (async () => {
      // ⚠️ La lista de columnas en UN literal (§7).
      const { data, error } = await supabase.from('canalizaciones')
        .select('id, estado, entidad_id, kg_confirmados, data_hora_recollida, valorizacion, recollida_registrada_at, recollida_validada_at, preu_acordat_kg, preu_acceptat_at')
        .eq('excedente_id', ofertaId).neq('estado', 'anulada').order('created_at', { ascending: true })
      if (!viu) return
      if (error) { console.warn('AssignacionsVives:', error.message); return }
      setFiles((data ?? []) as FilaAssignacio[])
    })()
    return () => { viu = false }
  }, [ofertaId, extra.canalitzacions])

  if (files.length === 0) return null
  const nomDe = (id: string | null) => extra.canalitzacions.find((x) => x.entidad_id === id)?.entitat
    ?? extra.respostes.find((r) => r.entidad_id === id)?.entitat ?? '—'

  return (
    <div className="space-y-2 rounded-md border p-2" data-testid="cd-assignacions">
      <p className="text-sm font-medium">{t('od.channelings')}</p>
      {files.map((f) => (
        <div key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-2 text-sm last:border-b-0 last:pb-0">
          <span className="min-w-0 font-medium">{nomDe(f.entidad_id)}</span>
          <span className="tabular-nums">{fmtKg(f.kg_confirmados)} kg</span>
          {f.valorizacion && <span className="text-xs text-muted-foreground">{t(`od.mod_${f.valorizacion}`)}</span>}
          <PreuAcordat c={f} />
          <div className="ml-auto flex items-center gap-1">
            <AccionsAssignacio
              c={f}
              estatsAlbarans={extra.albarans.filter((a) => a.canalizacion_id === f.id).map((a) => a.estado)}
              kgMaxim={oferta?.kg_total ?? null}
              potAprovar={c.potAprovar}
              idPrefix={`cd-asg-${f.id}`}
              onFet={c.onCanvi}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
