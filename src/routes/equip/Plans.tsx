// `/equip/plans` — los expedientes de prevención (fase 11 de la revisión del 08-10-2026).
// La lista y, para quien puede aprobar, abrir uno nuevo para una entidad productora.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { dataCurta } from '../../lib/format'
import { useAppContext } from '../../hooks/useAppContext'
import BotoIcona from '../../components/BotoIcona'
import Desplegable from '../../components/Desplegable'
import { llistaExpedients, obrirExpedient, type Expedient } from '../../lib/expedientApi'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
                <Desplegable id="plans-org" value={tria} onChange={setTria} buit="—"
                  opcions={disponibles.map((p) => ({ valor: p.id, text: p.nom }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plans-nivell" className="text-xs text-muted-foreground">{t('exp.f_nivell')}</Label>
                <Desplegable id="plans-nivell" value={nivell} onChange={(v) => setNivell(v as 'basic' | 'personalitzat')}
                  opcions={[
                    { valor: 'basic', text: t('exp.nivell_basic') },
                    { valor: 'personalitzat', text: t('exp.nivell_personalitzat') },
                  ]} />
              </div>
              <Button className="h-11 md:h-8" disabled={!tria || obrint} onClick={() => void obre()}>{t('exp.obre')}</Button>
            </div>
          )}

          {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
          {error && <p className="text-sm text-destructive">{textError(t, error)}</p>}
          {!carregant && !error && (files.length === 0 ? <p className="text-sm text-muted-foreground">{t('exp.cap_expedient')}</p> : (
            // El criterio de las tablas (03-11-2026, AGENTS.md §2): sin scroll horizontal a 360 px.
            // En móvil, organización (enlazada, con nivel, número y fecha debajo mientras no tienen
            // columna), estado y la acción; el nivel desde `md`, número y fecha desde `lg`.
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('exp.f_organitzacio')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('exp.f_nivell')}</TableHead>
                  <TableHead>{t('exp.f_estat_exp')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('exp.f_numero')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('diagl.c_updated')}</TableHead>
                  <TableHead className="w-15">
                    <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => {
                  const nivell = t(f.nivell === 'personalitzat' ? 'exp.nivell_personalitzat' : 'exp.nivell_basic')
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">
                        <Link to={`/equip/plans/${f.id}`} className="text-primary hover:underline">
                          {f.productores?.empresa || f.productores?.name || '—'}
                        </Link>
                        <span className="block text-xs font-normal text-muted-foreground md:hidden">{nivell}</span>
                        <span className="block text-xs font-normal tabular-nums text-muted-foreground lg:hidden">
                          {[f.numero_completo, dataCurta(f.updated_at)].filter(Boolean).join(' · ')}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-center md:table-cell">{nivell}</TableCell>
                      <TableCell className="text-center"><Badge variant="outline" className="whitespace-normal">{t(`exp.estat_${f.estat}`)}</Badge></TableCell>
                      <TableCell className="hidden text-center whitespace-nowrap tabular-nums text-muted-foreground lg:table-cell">{f.numero_completo ?? '—'}</TableCell>
                      <TableCell className="hidden text-center whitespace-nowrap text-muted-foreground lg:table-cell">{dataCurta(f.updated_at)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                          <BotoIcona icona={Eye} etiqueta={t('exp.a_veure')} onClick={() => navigate(`/equip/plans/${f.id}`)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
