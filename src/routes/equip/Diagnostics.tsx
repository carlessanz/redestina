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
import { Link, useNavigate } from 'react-router'
import { Eye } from 'lucide-react'
import { dataCurta } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { casaCerca } from '../../lib/cerca'
import { useCerca } from '../../hooks/useCerca'
import { textError } from '../../lib/textError'
import { ESTATS_DIAGNOSTIC, estilEstatDiagnostic } from '../../lib/diagnostic'
import { diagnosticsEquip } from '../../lib/diagnosticApi'
import type { DiagnosticEquip } from '../../types'
import BotoIcona from '../../components/BotoIcona'
import { Badge } from '@/components/ui/badge'
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
  const navigate = useNavigate()
  const [files, setFiles] = useState<DiagnosticEquip[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { cerca, setCerca, q } = useCerca()
  const [estat, setEstat] = useState<string>(TOTS)

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
    return files.filter((f) => {
      if (estat !== TOTS && f.estat !== estat) return false
      return casaCerca([f.nom, f.numero], q)
    })
  }, [files, q, estat])

  // Lo que de verdad queda por hacer. `sense_questionari` no entra: eso no es trabajo de
  // esta pantalla sino de la configuración, y contarlo aquí lo convertiría en una cifra que
  // nadie puede bajar desde aquí.
  // Desde la fase 9 el diagnóstico es del productor y el plan, un servicio: lo pendiente para
  // el equipo es lo que no se ha empezado, lo que está a medias y el plan preparado sin emitir.
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <SelectTrigger id="diagl-estat" className="w-full text-base md:text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TOTS}>{t('diagl.all')}</SelectItem>
                {ESTATS_DIAGNOSTIC.map((e) => (
                  <SelectItem key={e} value={e}>{t(`diag.st_${e}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {t('diagl.count', { n: visibles.length, total: files.length, p: pendents })}
        </p>

        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {/* Se traduce al pintar: el mensaje puede ser una clave i18n. */}
        {error && <p className="text-sm text-destructive">{textError(t, error)}</p>}

        {!carregant && !error && (
          visibles.length === 0
            ? <p className="text-sm text-muted-foreground">
                {t(files.length === 0 ? 'diagl.empty' : 'diagl.no_match')}
              </p>
            : (
              // El criterio de las tablas (03-11-2026, AGENTS.md §2): sin scroll horizontal a
              // 360 px. En móvil, organización (enlazada, con la fecha y el número debajo mientras
              // no tienen columna), estado y la acción; «Falten» desde `md`, la fecha y las
              // medidas desde `lg`, el número desde `xl`.
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('diagl.c_org')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('diagl.c_updated')}</TableHead>
                    <TableHead>{t('diagl.c_status')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('diagl.c_missing')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('diagl.c_measures')}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t('diagl.c_number')}</TableHead>
                    <TableHead className="w-15">
                      <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((f) => {
                    const ruta = `/equip/diagnostics/${f.tipo_org}/${f.org_id}`
                    return (
                      <TableRow key={`${f.tipo_org}-${f.org_id}`}>
                        {/* Parte en líneas en vez de cortar: con `truncate` el nombre salía
                            «Comercial de Prova SL…» y la marca «Prova» desaparecía justo en
                            los nombres largos. */}
                        <TableCell className="font-medium">
                          <Link to={ruta} className="text-primary hover:underline">{f.nom ?? '—'}</Link>
                          {f.es_test && (
                            <Badge variant="outline" className="ml-2">{t('diagl.test')}</Badge>
                          )}
                          <span className="block text-xs font-normal text-muted-foreground lg:hidden">
                            {dataCurta(f.darrera_actualitzacio)}
                          </span>
                          {f.numero && (
                            <span className="block text-xs font-normal tabular-nums text-muted-foreground xl:hidden">{f.numero}</span>
                          )}
                        </TableCell>
                        {/* La ficha viva (fase 9): cuándo se actualizó por última vez. */}
                        <TableCell className="hidden text-center whitespace-nowrap text-muted-foreground lg:table-cell">
                          {dataCurta(f.darrera_actualitzacio)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={`whitespace-normal ${estilEstatDiagnostic(f.estat)}`}>
                            {t(`diag.st_${f.estat}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-center tabular-nums md:table-cell">
                          {f.falten_n > 0 ? f.falten_n : '—'}
                        </TableCell>
                        <TableCell className="hidden text-center tabular-nums lg:table-cell">
                          {f.mesures_n > 0 ? f.mesures_n : '—'}
                        </TableCell>
                        <TableCell className="hidden text-center whitespace-nowrap tabular-nums text-muted-foreground xl:table-cell">
                          {f.numero ?? '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                            <BotoIcona icona={Eye} etiqueta={t('diagl.a_obre')} onClick={() => navigate(ruta)} />
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )
        )}
      </CardContent>
    </Card>
  )
}
