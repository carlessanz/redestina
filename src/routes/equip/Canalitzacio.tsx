// `/equip/canalitzacio` — los lotes en curso, con la fase en la que está cada uno.
//
// POR QUÉ EXISTE ESTA PANTALLA. El panel del equipo ya tenía todas las piezas del circuito
// —ofertas, aprobaciones, albaranes, convenios, cierre— pero repartidas en siete pantallas,
// y ninguna decía en qué punto está un lote ni qué toca después. Esto es el índice de ese
// camino: una fila por lote, la fase en la que está y qué falta.
//
// ⚠️ **LA FASE LA CALCULA EL CLIENTE**, con `escalaCanal`. La RPC devuelve HECHOS y no el
//    paso, a propósito: tener el cálculo en dos sitios garantiza que diverjan.
//
// ⚠️ Los hechos del índice son un RESUMEN, no el estado completo: `canalitzacions_actives`
//    no trae las respuestas ni los albaranes uno a uno. La fase que sale aquí es por tanto
//    una aproximación honesta —lo que se puede decir con lo que hay— y el detalle es quien
//    manda. Se escribe porque la alternativa era traerse el ciclo entero de cada lote para
//    pintar una tabla.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { lotsActius } from '../../lib/canalitzacio'
import type { LotActiu } from '../../lib/canalitzacio'
import { escalaCanal, PASSOS_FASE_CLAUS } from '../../lib/passosCanalitzacio'
import type { FetsCanal } from '../../lib/passosCanalitzacio'
import type { ConvenioEstado, EstadoAlbaran, EstadoExcedente } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import DialegNovaOfertaAssistida from '../../components/equip/DialegNovaOfertaAssistida'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/**
 * Los hechos del índice, traducidos a lo que `escalaCanal` sabe leer.
 *
 * Lo que no viene se deja VACÍO, nunca inventado: una lista de respuestas fabricada haría
 * que la escalera dijera que hay interés cuando solo sabemos que hay kilos canalizados.
 */
function fetsDeLaFila(l: LotActiu): FetsCanal {
  const canalitzats = Number(l.kg_canalitzats ?? 0)
  return {
    oferta: { estado: l.estado as EstadoExcedente, kg_total: l.kg_total, origen: null },
    conveni_gen: l.conveni_gen
      ? { id: 'x', estado: l.conveni_gen as ConvenioEstado }
      : null,
    // Una canalización ya creada implica que hubo interés aprobado: es lo único que el
    // resumen permite afirmar, y se afirma solo eso.
    respostes: canalitzats > 0
      ? [{
          id: 'x', entidad_id: null, entitat: '', estado: 'acceptada',
          aprovacio: 'aprovada', canalizacion_id: 'x',
          conveni_rec: { id: 'x', estado: 'vigent' },
        }]
      : [],
    canalitzacions: canalitzats > 0 ? [{ id: 'x', kg_conciliados: null, coste_kg: null }] : [],
    albarans: l.rec_estado
      ? [{ id: 'x', tipo: 'REC', estado: l.rec_estado as EstadoAlbaran, numero: null, canalizacion_id: null }]
      : [],
    cost_falten: 0,
    exercici: null,
  }
}

export default function Canalitzacio() {
  const { t } = useT()
  const [files, setFiles] = useState<LotActiu[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  const [dlgNova, setDlgNova] = useState(false)
  const navega = useNavigate()

  const carrega = useCallback(async () => {
    setCarregant(true)
    const r = await lotsActius()
    if (!r.ok) { setError(r.missatge === 'canalz.err_generic' ? t('c.error') : r.missatge) }
    else { setFiles(r.data ?? []); setError(null) }
    setCarregant(false)
  }, [t])

  useEffect(() => { void carrega() }, [carrega])

  const visibles = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    if (!q) return files
    return files.filter((f) =>
      (f.id_excedente ?? '').toLowerCase().includes(q)
      || (f.productor ?? '').toLowerCase().includes(q))
  }, [files, cerca])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t('canalz.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('canalz.intro')}</p>
        </div>
        {/* Empezar un lote, que es lo que faltaba: hasta ahora solo se podían continuar los
            que ya existían, porque el alta asistida vivía DENTRO del ciclo. */}
        <Button className="h-11 whitespace-normal md:h-9" onClick={() => setDlgNova(true)}>
          {t('canalz.nova_oferta')}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">
            {t('canalz.list_title', { n: visibles.length })}
          </CardTitle>
          <Input
            className="sm:max-w-xs"
            placeholder={t('canalz.search')}
            value={cerca}
            onChange={(e) => setCerca(e.target.value)}
          />
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-error">{error}</p>}
          {carregant ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />{t('c.loading')}
            </p>
          ) : visibles.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{t('canalz.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('canalz.c_ref')}</TableHead>
                    <TableHead>{t('canalz.c_productor')}</TableHead>
                    <TableHead>{t('canalz.c_fase')}</TableHead>
                    <TableHead className="text-right">{t('canalz.c_kg')}</TableHead>
                    <TableHead className="text-right">{t('canalz.c_pendents')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((l) => {
                    const escala = escalaCanal(fetsDeLaFila(l))
                    const ara = escala.find((e) => e.estat === 'ara')
                      ?? escala.find((e) => e.estat === 'bloquejat')
                    return (
                      <TableRow key={l.excedente_id}>
                        <TableCell className="font-medium tabular-nums">
                          {l.id_excedente ?? '—'}
                        </TableCell>
                        <TableCell>{l.productor ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={ara?.estat === 'bloquejat' ? 'outline' : 'secondary'}>
                            {t(PASSOS_FASE_CLAUS[ara?.fase ?? 5])}
                          </Badge>
                          {ara && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t(`canal.${ara.pas}_t`)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(l.kg_canalitzats ?? 0)} / {Number(l.kg_total ?? 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.n_per_aprovar > 0 && (
                            <Badge className="bg-white text-coral-texto">{l.n_per_aprovar}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="outline" size="sm" className="h-11 whitespace-normal md:h-8">
                            <Link to={`/equip/canalitzacio/${l.excedente_id}`}>
                              {t('canalz.open')}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DialegNovaOfertaAssistida
        obert={dlgNova}
        onTancar={() => setDlgNova(false)}
        onCreada={(r) => { setDlgNova(false); navega(`/equip/canalitzacio/${r.id}`) }}
      />
    </div>
  )
}
