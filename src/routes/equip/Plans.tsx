// `/equip/plans` — los expedientes de prevención (fase 11 de la revisión del 08-10-2026).
// La lista y, para quien puede aprobar, abrir uno nuevo para una entidad productora.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { dataCurta } from '../../lib/format'
import { useAppContext } from '../../hooks/useAppContext'
import { llistaExpedients, obrirExpedient, type Expedient } from '../../lib/expedientApi'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const SELECT = 'h-11 w-full rounded-md border border-input bg-transparent px-3 text-base md:h-9 md:text-sm'

export default function Plans() {
  const { t } = useT()
  const { ctx } = useAppContext()
  const navigate = useNavigate()
  const potAprovar = ctx?.potAprovar ?? false
  const [files, setFiles] = useState<Expedient[]>([])
  const [error, setError] = useState<string | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [productors, setProductors] = useState<{ id: string; nom: string }[]>([])
  const [tria, setTria] = useState('')
  const [nivell, setNivell] = useState<'basic' | 'personalitzat'>('basic')
  const [obrint, setObrint] = useState(false)

  useEffect(() => {
    let viu = true
    void llistaExpedients().then((r) => {
      if (!viu) return
      if (!r.ok) setError(r.missatge)
      else setFiles(r.data)
      setCarregant(false)
    })
    void supabase.from('productores').select('id, name, empresa').order('empresa').then(({ data }) => {
      if (!viu) return
      setProductors(((data ?? []) as { id: string; name: string | null; empresa: string | null }[])
        .map((p) => ({ id: p.id, nom: p.empresa || p.name || '—' })))
    })
    return () => { viu = false }
  }, [])

  // Solo se ofrecen las que no tienen ya un expediente abierto (la base lo impide igual).
  const disponibles = useMemo(() => {
    const amb = new Set(files.filter((f) => f.estat !== 'tancat').map((f) => f.productor_id))
    return productors.filter((p) => !amb.has(p.id))
  }, [files, productors])

  async function obre() {
    if (!tria) return
    setObrint(true)
    const r = await obrirExpedient(tria, nivell)
    setObrint(false)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    navigate(`/equip/plans/${r.data}`)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('nav.plans')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('exp.h_llista')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {potAprovar && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="plans-org" className="text-xs text-muted-foreground">{t('exp.f_organitzacio')}</Label>
                <select id="plans-org" className={SELECT} value={tria} onChange={(e) => setTria(e.target.value)}>
                  <option value="">—</option>
                  {disponibles.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="plans-nivell" className="text-xs text-muted-foreground">{t('exp.f_nivell')}</Label>
                <select id="plans-nivell" className={SELECT} value={nivell} onChange={(e) => setNivell(e.target.value as 'basic' | 'personalitzat')}>
                  <option value="basic">{t('exp.nivell_basic')}</option>
                  <option value="personalitzat">{t('exp.nivell_personalitzat')}</option>
                </select>
              </div>
              <Button className="h-11 md:h-9" disabled={!tria || obrint} onClick={() => void obre()}>{t('exp.obre')}</Button>
            </div>
          )}

          {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
          {error && <p className="text-sm text-destructive">{textError(t, error)}</p>}
          {!carregant && !error && (files.length === 0 ? <p className="text-sm text-muted-foreground">{t('exp.cap_expedient')}</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('exp.f_organitzacio')}</TableHead>
                    <TableHead>{t('exp.f_nivell')}</TableHead>
                    <TableHead>{t('exp.f_estat_exp')}</TableHead>
                    <TableHead>{t('exp.f_numero')}</TableHead>
                    <TableHead>{t('diagl.c_updated')}</TableHead>
                    <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="min-w-44 whitespace-normal font-medium">{f.productores?.empresa || f.productores?.name || '—'}</TableCell>
                      <TableCell>{t(f.nivell === 'personalitzat' ? 'exp.nivell_personalitzat' : 'exp.nivell_basic')}</TableCell>
                      <TableCell><Badge variant="outline">{t(`exp.estat_${f.estat}`)}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{f.numero_completo ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{dataCurta(f.updated_at)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button asChild size="sm" variant="outline" className="h-11 md:h-8">
                            <Link to={`/equip/plans/${f.id}`}>{t('c.detail')}</Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
