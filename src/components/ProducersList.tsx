import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { pendentsPerTelefon } from '../lib/contactes'
import type { Productor, ProductorLlistat } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Props {
  onSendMessage: (phone: string, name: string | null) => void
  onOpenDetail: (productor: Productor) => void
  onNew: () => void
}

function casa(p: Productor, q: string): boolean {
  if (!q) return true
  const campos = [p.name, p.empresa, p.phone, p.poblacion, p.email]
  return campos.some((c) => (c ?? '').toLowerCase().includes(q))
}

export default function ProducersList({ onSendMessage, onOpenDetail, onNew }: Props) {
  const { t } = useT()
  const [producers, setProducers] = useState<ProductorLlistat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState<Record<string, number>>({})
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase.from('v_productores_llistat').select('*').order('name', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(loadError.message)
        else setProducers(data ?? [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    // Los pendientes los cuenta la BASE (§12.5). Antes esto se traía `wa_messages` entera
    // —sin filtro ni paginación— para calcular un número por teléfono, y volvía a hacerlo
    // ante cualquier evento de Realtime.
    const recompta = () => {
      void pendentsPerTelefon().then((c) => { if (!cancelled) setUnanswered(c) })
    }
    recompta()
    const channel = supabase
      .channel('wa-messages-productores')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_messages' },
        // Un mensaje nuevo **invalida** la cuenta; no se acumula en memoria. La diferencia
        // importa: acumulando, la pestaña abierta desde ayer llevaba encima todo el día.
        () => recompta())
      .subscribe()
    return () => { cancelled = true; void supabase.removeChannel(channel) }
  }, [])

  const { test, resto } = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const filtrados = producers.filter((p) => casa(p, q))
    const test: ProductorLlistat[] = []
    const resto: ProductorLlistat[] = []
    for (const p of filtrados) {
      if (p.es_test) test.push(p)
      else resto.push(p)
    }
    return { test, resto }
  }, [producers, busqueda])

  function tabla(lista: ProductorLlistat[], marcarTest: boolean) {
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('prod.c_name')}</TableHead>
              <TableHead>{t('prod.c_email')}</TableHead>
              <TableHead>{t('prod.c_phone')}</TableHead>
              <TableHead className="text-right">{t('prod.c_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((p) => {
              const sinContestar = p.phone ? (unanswered[p.phone] ?? 0) : 0
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {p.name}
                      {marcarTest && <Badge variant="secondary">{t('badge.test')}</Badge>}
                      {/* Un alta rechazada se MARCA, no se esconde: el super_admin
                          llega a la ficha desde aquí y es quien la borra (§12.29). */}
                      {p.rebutjada && <Badge className="bg-error-fondo text-error">{t('badge.rejected')}</Badge>}
                      {sinContestar > 0 && <Badge variant="destructive">{t('prod.unanswered', { n: sinContestar })}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="max-w-[180px] break-all leading-tight">{p.email ?? '—'}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{p.phone ? `+${p.phone}` : '—'}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => onOpenDetail(p)}>{t('c.detail')}</Button>
                      <Button size="sm" disabled={!p.phone} title={p.phone ? undefined : t('prod.no_phone')}
                        onClick={() => p.phone && onSendMessage(p.phone, p.name)}>{t('c.message')}</Button>
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
          <CardTitle>{t('prod.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('prod.subtitle')}</p>
        </div>
        <Button onClick={onNew}><Plus className="size-4" /> {t('c.new_m')}</Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <Input type="search" placeholder={t('prod.search')} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        {loading && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {vacio && <p className="text-sm text-muted-foreground">{producers.length === 0 ? t('prod.empty') : t('prod.no_match')}</p>}
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
    </Card>
  )
}
