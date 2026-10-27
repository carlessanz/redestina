import { useEffect, useMemo, useState } from 'react'
import { Plus, UserPlus } from 'lucide-react'
import DialegAltaAssistida from './equip/DialegAltaAssistida'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { useAppContext, useCanals, useWhatsappActiu } from '../hooks/useAppContext'
import { motiuCanal } from '../lib/canals'
import BotoAmbMotiu from './proces/BotoAmbMotiu'
import { useCerca } from '../hooks/useCerca'
import { filtraCerca } from '../lib/cerca'
import BarraFiltres from './BarraFiltres'
import { useFiltresLlistat } from '../hooks/useFiltresLlistat'
import { filtraLlistat, opcionsDisponibles, type Dimensio } from '../lib/filtres'
import DialegCorreu from './DialegCorreu'
import type { DestinatariCorreu } from './DialegCorreu'
import type { Entidad, EntidadLlistat } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Props {
  onSendMessage: (phone: string, name: string | null) => void
  onOpenDetail: (entidad: Entidad) => void
  onNew: () => void
}

const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '')

export default function EntitiesList({ onSendMessage, onOpenDetail, onNew }: Props) {
  const { t } = useT()
  const waActiu = useWhatsappActiu()
  // El alta asistida crea una cuenta ya aprobada: solo quien puede aprobar (§4bis).
  const potAprovar = useAppContext().ctx?.potAprovar ?? false
  const [altaObert, setAltaObert] = useState(false)
  // Con el correo apagado (§8) «Correu» se queda gris con el motivo: envía, no lleva a ningún apartado.
  const motiuEmail = motiuCanal(useCanals(), 'email')
  // Un solo diálogo para toda la tabla: la fila solo dice a quién se escribe.
  const [correuA, setCorreuA] = useState<DestinatariCorreu | null>(null)
  const [entidades, setEntidades] = useState<EntidadLlistat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { cerca, setCerca, q } = useCerca()

  useEffect(() => {
    let cancelled = false
    supabase.from('v_entidades_llistat').select('*').order('nombre', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(loadError.message)
        else setEntidades(data ?? [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // Primero las entidades de prueba (pueden recibir), luego el resto — igual que productores.
  // Zona y tipo de entidad (fases 6 y 7 de la revisión del 08-10-2026), además del buscador.
  const fl = useFiltresLlistat('equip-entitats')
  const dims = useMemo<Dimensio<EntidadLlistat>[]>(() => [
    { clau: 'comarca', etiquetaKey: 'fl.d_comarca', valor: (e) => e.area_geografica },
    { clau: 'tipus', etiquetaKey: 'fl.d_tipus', valor: (e) => e.tipo_receptor },
  ], [])
  const { test, resto } = useMemo(() => {
    const filtradas = filtraLlistat(filtraCerca(entidades, q,
      (e) => [e.nombre, e.poblacion, e.area_geografica, e.telefono, e.email, e.contacto, e.modalitat]), dims, fl.valors)
    const test: EntidadLlistat[] = []
    const resto: EntidadLlistat[] = []
    for (const e of filtradas) {
      if (e.es_test) test.push(e)
      else resto.push(e)
    }
    return { test, resto }
  }, [entidades, q, dims, fl.valors])

  function tabla(lista: EntidadLlistat[], marcarTest: boolean) {
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('ent.c_name')}</TableHead>
              <TableHead>{t('ent.c_town')}</TableHead>
              <TableHead>{t('ent.c_modality')}</TableHead>
              <TableHead>{t('ent.c_phone')}</TableHead>
              <TableHead>{t('ent.c_email')}</TableHead>
              <TableHead>{t('ent.c_prio')}</TableHead>
              <TableHead className="text-right">{t('ent.c_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((e) => {
              const tel = soloDigitos(e.telefono)
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {e.nombre}
                      {marcarTest && <Badge variant="secondary">{t('badge.test')}</Badge>}
                      {/* Un alta rechazada se MARCA, no se esconde: el super_admin
                          llega a la ficha desde aquí y es quien la borra (§12.29). */}
                      {e.rebutjada && <Badge className="bg-error-fondo text-error">{t('badge.rejected')}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.poblacion ?? '—'}</TableCell>
                  <TableCell>
                    {/* «Modalitats» (fase 7): las que le interesan, que declara en su ficha;
                        sin ellas, el texto antiguo del import. */}
                    {(e.modalitats_interes ?? []).length > 0
                      ? (e.modalitats_interes ?? []).map((m) => <Badge key={m} variant="outline" className="mr-1">{t(`org.mi_${m === 'venda' ? 'compra' : m}`)}</Badge>)
                      : e.modalitat ? <Badge variant="outline">{e.modalitat}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{tel ? `+${tel}` : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="max-w-[170px] break-all whitespace-normal leading-tight">{e.email ?? '—'}</div>
                  </TableCell>
                  <TableCell>{e.prioritat ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => onOpenDetail(e)}>{t('c.detail')}</Button>
                      {/* Con WhatsApp apagado (§8) se quita, no se deshabilita. */}
                      {waActiu && (
                        <Button size="sm" disabled={!tel} title={tel ? undefined : t('ent.no_phone')}
                          onClick={() => tel && onSendMessage(tel, e.nombre)}>{t('c.message')}</Button>
                      )}
                      <BotoAmbMotiu variant="outline" size="sm" disabled={!e.email || !!motiuEmail}
                        motiu={motiuEmail ? t(motiuEmail) : e.email ? undefined : t('correu.no_email')}
                        onClick={() => setCorreuA({ email: e.email, nom: e.nombre, tipus: 'entidad', id: e.id })}>
                        {t('c.email_action')}
                      </BotoAmbMotiu>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  const vacio = !loading && !error && test.length === 0 && resto.length === 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t('ent.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('ent.subtitle')}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {/* Una organización CON cuenta (alta asistida, 27-10-2026). «Nova» crea solo la ficha. */}
          <BotoAmbMotiu variant="outline" onClick={() => setAltaObert(true)} disabled={!potAprovar}
            motiu={potAprovar ? undefined : t('appr.need_approver')}>
            <UserPlus className="size-4" /> {t('alta.open')}
          </BotoAmbMotiu>
          <Button onClick={onNew}><Plus className="size-4" /> {t('c.new_f')}</Button>
        </div>
        <DialegAltaAssistida obert={altaObert} onTancar={() => setAltaObert(false)} rolInicial="receptor" />
      </CardHeader>
      <CardContent className="space-y-6">
        <Input type="search" placeholder={t('ent.search')} value={cerca} onChange={(e) => setCerca(e.target.value)} />
        <BarraFiltres
          id="ent"
          desplegables={dims.map((d) => ({
            clau: d.clau, etiquetaKey: d.etiquetaKey, opcions: opcionsDisponibles(entidades, dims, d.clau, fl.valors),
            text: d.clau === 'tipus' ? (v: string) => t(`org.tr_${v}`) : undefined,
          }))}
          valors={fl.valors}
          onValors={fl.setValors}
          mostrant={test.length + resto.length}
          total={entidades.length}
        />
        {loading && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
        {vacio && <p className="text-sm text-muted-foreground">{entidades.length === 0 ? t('ent.empty') : t('ent.no_match')}</p>}
        {test.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('grp.test', { n: test.length })}</h3>
            {tabla(test, true)}
          </section>
        )}
        {resto.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{t('grp.rest', { n: resto.length })}</h3>
            {tabla(resto, false)}
          </section>
        )}
      </CardContent>
      <DialegCorreu obert={correuA !== null} onObert={(v) => { if (!v) setCorreuA(null) }} destinatari={correuA} />
    </Card>
  )
}
