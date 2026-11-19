// Aprovacions › «Recollides per registrar» (fase 3 de los puntos 4-6, 19-11-2026), la sexta cola.
//
// Desde esta fase una venta o una maquila no tiene albarán de Redestina: no nace ningún borrador
// al asignarla, así que la cola de albaranes por emitir ya no la contaba y nadie se acordaba de
// cerrarla. `pendents_equip()` la cuenta en `recollides_equip` —la venta o maquila cuya hora de
// recogida ya ha pasado y que nadie ha registrado— y aquí se lista para cerrarla con «Registrar
// la recollida» (el mismo diálogo que la ficha de la oferta: registrar y validar en un acto deja
// la canalización conciliada y la oferta, si era la última, cerrada).
//
// La lista la calcula `esRecollidaDelEquip()` con el mismo criterio que la base, para que el
// badge de Aprovacions y esta cola digan lo mismo. Registrar es de un admin (la base lo exige);
// el resto del equipo ve la cola con el botón en gris y el motivo, como las otras.

import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import { esRecollidaDelEquip } from '../../lib/albaransRecollida'
import type { AlbaraMinim, CanalPerRegistrar } from '../../lib/albaransRecollida'
import { dataHora, kg } from '../../lib/format'
import { filtraCerca } from '../../lib/cerca'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import DialegRegistraRecollida from './DialegRegistraRecollida'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** La fila: la canalización con la oferta y las dos partes embebidas por sus FK. */
interface RecollidaEquip extends CanalPerRegistrar {
  excedente_id: string | null
  kg_confirmados: number | null
  entidades: { nombre: string | null } | null
  excedentes: {
    id_excedente: string | null
    producto: string | null
    productores: { name: string | null; empresa: string | null } | null
  } | null
}

/**
 * `q`: la consulta del buscador de Aprovacions, ya normalizada; filtra por producto, código de
 * la oferta y las dos partes. Vacía, la cola entera.
 */
export default function CuaRecollidesEquip({ q = '' }: { q?: string }) {
  const { t } = useT()
  const location = useLocation()
  const { ctx } = useAppContext()
  const potAprovar = ctx?.potAprovar ?? false
  const [files, setFiles] = useState<RecollidaEquip[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState(false)
  const [obert, setObert] = useState<RecollidaEquip | null>(null)

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas en UN literal (§7, deuda 46). Se leen las ventas y maquilas
    // vivas sin registro; lo demás (hora pasada, sin salida viva) lo decide `esRecollidaDelEquip`.
    const { data, error: err } = await supabase
      .from('canalizaciones')
      .select('id, estado, valorizacion, excedente_id, kg_confirmados, data_hora_recollida, created_at, recollida_registrada_at, recollida_validada_at, recollida_retornada_at, entidades(nombre), excedentes(id_excedente, producto, productores(name, empresa))')
      .in('valorizacion', ['venda', 'maquila'])
      .not('estado', 'in', '(anulada,conciliada)')
      .is('recollida_registrada_at', null)
      .is('recollida_validada_at', null)
      .order('data_hora_recollida', { ascending: true, nullsFirst: false })
    if (err) {
      console.warn('recollides per registrar:', err.message)
      setError(true)
      setCarregant(false)
      return
    }
    const canals = (data as unknown as RecollidaEquip[] | null) ?? []
    let albarans: AlbaraMinim[] = []
    if (canals.length > 0) {
      const { data: alb, error: errAlb } = await supabase
        .from('albaranes')
        .select('id, tipo, estado, canalizacion_id')
        .in('canalizacion_id', canals.map((c) => c.id))
        .in('tipo', ['ENT', 'OPE'])
      if (errAlb) { setError(true); setCarregant(false); return }
      albarans = (alb as AlbaraMinim[] | null) ?? []
    }
    const ara = Date.now()
    setError(false)
    setFiles(canals.filter((c) => esRecollidaDelEquip(c, albarans, ara)))
    setCarregant(false)
  }, [])

  useEffect(() => { void carrega() }, [carrega])

  // El tablero enlaza aquí con `#recollides-equip`: se baja a la cola cuando ya está pintada.
  useEffect(() => {
    if (location.hash !== '#recollides-equip' || carregant) return
    document.getElementById('recollides-equip')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash, carregant])

  const visibles = filtraCerca(files, q, (r) => [
    r.excedentes?.producto, r.excedentes?.id_excedente,
    r.excedentes?.productores?.empresa, r.excedentes?.productores?.name, r.entidades?.nombre,
  ])

  return (
    <Card id="recollides-equip" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('requip.title')} ({files.length})</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('requip.subtitle')}</p>
        {!potAprovar && <p className="mt-1 text-sm text-aviso">{t('recol.need_admin')}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
        {!carregant && !error && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('requip.empty')}</p>
        )}
        {files.length > 0 && visibles.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('od.no_match_ent')}</p>
        )}
        {visibles.map((r) => {
          const productora = r.excedentes?.productores?.empresa || r.excedentes?.productores?.name || '—'
          return (
            <div key={r.id} className="rounded-lg border p-3" data-testid="recollida-equip">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.excedentes?.producto ?? '—'}</span>
                    {r.excedente_id && (
                      <Link to={`/equip/ofertes/${r.excedente_id}`} className="text-xs text-primary hover:underline">
                        <code>{r.excedentes?.id_excedente ?? t('vrec.oferta')}</code>
                      </Link>
                    )}
                    {r.valorizacion && <Badge variant="outline">{t(`od.mod_${r.valorizacion}`)}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('vrec.parts', { entrega: productora, rep: r.entidades?.nombre ?? '—' })}
                  </div>
                  <div className="text-sm tabular-nums">
                    {[
                      t('requip.kg', { kg: kg(r.kg_confirmados) }),
                      r.data_hora_recollida ? t('requip.prevista', { quan: dataHora(r.data_hora_recollida) }) : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <BotoAmbMotiu size="sm" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
                  disabled={!potAprovar} motiu={potAprovar ? undefined : t('recol.need_admin')}
                  onClick={() => setObert(r)}>
                  {t('od.b_registrar_recollida')}
                </BotoAmbMotiu>
              </div>
            </div>
          )
        })}
      </CardContent>

      <DialegRegistraRecollida
        canalitzacio={obert?.id ?? null}
        entitat={obert?.entidades?.nombre ?? null}
        onTancar={() => setObert(null)}
        onFet={() => { void carrega(); void refrescaComptadors() }}
      />
    </Card>
  )
}
