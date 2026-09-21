// `/equip/diagnostics` — en qué punto está el diagnóstico de cada organización.
//
// Una sola llamada (`diagnostics_equip()`) trae las fichas con su estado ya calculado, igual
// que `pendents_equip()` trae la cola de trabajo: el cálculo de «qué falta» vive en SQL y no
// se rehace aquí, así que esta pantalla y la ficha de una organización no pueden discrepar.
//
// ⚠️ EL CONTADOR VIVE AQUÍ Y NO EN EL MENÚ. No se ha añadido una cola a `pendents_equip()`
//    a propósito: sería «N diagnòstics pendents» de forma permanente —lo están casi todas
//    las organizaciones y lo seguirán estando— y ahogaría las colas que sí bloquean el
//    circuito. Aquí la cifra significa algo porque va junto al filtro que la explica.
//
// Los filtros son los tres con los que se reparte este trabajo: el **estado** dice qué hay
// que hacer hoy, el **papel** separa a quien genera de quien recibe (son dos cuestionarios
// distintos, no dos vistas del mismo) y el buscador encuentra una organización concreta.
// Se filtra en cliente sobre lo ya cargado, como `Convenis` y `Albarans` (deuda §12.5).

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useT } from '../../lib/i18n'
import { ESTATS_DIAGNOSTIC, estilEstatDiagnostic } from '../../lib/diagnostic'
import { diagnosticsEquip } from '../../lib/diagnosticApi'
import type { DiagnosticEquip } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const TOTS = '__tots'

export default function Diagnostics() {
  const { t } = useT()
  const [files, setFiles] = useState<DiagnosticEquip[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  const [estat, setEstat] = useState<string>(TOTS)
  const [paper, setPaper] = useState<string>(TOTS)

  useEffect(() => {
    let viu = true
    void diagnosticsEquip().then((r) => {
      if (!viu) return
      if (!r.ok) { setError(r.missatge); setCarregant(false); return }
      setFiles(r.data ?? [])
      setCarregant(false)
    })
    return () => { viu = false }
  }, [])

  const visibles = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    return files.filter((f) => {
      if (estat !== TOTS && f.estat !== estat) return false
      if (paper !== TOTS && f.tipo_org !== paper) return false
      if (!q) return true
      return (f.nom ?? '').toLowerCase().includes(q)
        || (f.numero ?? '').toLowerCase().includes(q)
    })
  }, [files, cerca, estat, paper])

  // Lo que de verdad queda por hacer. `sense_questionari` no entra: eso no es trabajo de
  // esta pantalla sino de la configuración, y contarlo aquí lo convertiría en una cifra que
  // nadie puede bajar desde aquí.
  const pendents = files.filter(
    (f) => f.estat === 'sense_comencar' || f.estat === 'incomplet' || f.estat === 'a_punt',
  ).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('diagl.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('diagl.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="diagl-cerca">{t('c.search')}</Label>
            <Input
              id="diagl-cerca" type="search" placeholder={t('diagl.search')}
              value={cerca} onChange={(e) => setCerca(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="diagl-estat">{t('diagl.f_status')}</Label>
            <Select value={estat} onValueChange={setEstat}>
              <SelectTrigger id="diagl-estat"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TOTS}>{t('diagl.all')}</SelectItem>
                {ESTATS_DIAGNOSTIC.map((e) => (
                  <SelectItem key={e} value={e}>{t(`diag.st_${e}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="diagl-paper">{t('diagl.f_role')}</Label>
            <Select value={paper} onValueChange={setPaper}>
              <SelectTrigger id="diagl-paper"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TOTS}>{t('diagl.all')}</SelectItem>
                <SelectItem value="productor">{t('org.paper_productor')}</SelectItem>
                <SelectItem value="entidad">{t('org.paper_receptor')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {t('diagl.count', { n: visibles.length, total: files.length, p: pendents })}
        </p>

        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!carregant && !error && (
          visibles.length === 0
            ? <p className="text-sm text-muted-foreground">
                {t(files.length === 0 ? 'diagl.empty' : 'diagl.no_match')}
              </p>
            : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('diagl.c_org')}</TableHead>
                      <TableHead>{t('diagl.c_role')}</TableHead>
                      <TableHead>{t('diagl.c_status')}</TableHead>
                      <TableHead className="text-right">{t('diagl.c_missing')}</TableHead>
                      <TableHead className="text-right">{t('diagl.c_measures')}</TableHead>
                      <TableHead>{t('diagl.c_number')}</TableHead>
                      <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibles.map((f) => (
                      <TableRow key={`${f.tipo_org}-${f.org_id}`}>
                        <TableCell className="max-w-56 truncate font-medium">
                          {f.nom ?? '—'}
                          {f.es_test && (
                            <Badge variant="outline" className="ml-2">{t('diagl.test')}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {t(f.tipo_org === 'productor' ? 'org.paper_productor' : 'org.paper_receptor')}
                        </TableCell>
                        <TableCell>
                          <Badge className={estilEstatDiagnostic(f.estat)}>
                            {t(`diag.st_${f.estat}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {f.falten_n > 0 ? f.falten_n : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {f.mesures_n > 0 ? f.mesures_n : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {f.numero ?? '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button asChild size="sm" variant="outline" className="h-11 whitespace-normal md:h-8">
                              <Link to={`/equip/diagnostics/${f.tipo_org}/${f.org_id}`}>
                                {t('c.detail')}
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
        )}
      </CardContent>
    </Card>
  )
}
