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
import { Eye, Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { filtraCerca } from '../../lib/cerca'
import { useCerca } from '../../hooks/useCerca'
import { textError } from '../../lib/textError'
import { avisosSenseEnviarPerOferta, lotsActius } from '../../lib/canalitzacio'
import type { LotActiu } from '../../lib/canalitzacio'
import { clauPas, escalaCanal, PASSOS_FASE_CLAUS } from '../../lib/passosCanalitzacio'
import type { FetsCanal } from '../../lib/passosCanalitzacio'
import type { ConvenioEstado, EstadoAlbaran, EstadoExcedente } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import BotoIcona from '../../components/BotoIcona'
import { FilaClicable } from '../../components/FilaClicable'
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
  // Los intereses que esperan aprobación (28-09-2026): sin ellos, un lote con uno pendiente
  // salía «Envia l'oferta a les entitats». Los de una receptora sin su convenio van sin él,
  // que es lo que hace que la escalera diga «conveni de la receptora», como la ficha.
  const senseConveni = l.n_per_aprovar_sense_conveni ?? 0
  const perAprovar = Array.from({ length: l.n_per_aprovar ?? 0 }, (_, i) => ({
    id: 'p', entidad_id: null, entitat: '', estado: 'acceptada' as const,
    aprovacio: 'pendent' as const, canalizacion_id: null,
    conveni_rec: i < senseConveni ? null : { id: 'p', estado: 'vigent' as ConvenioEstado },
  }))
  // Enviada y sin respuesta: la distribución está hecha aunque nadie haya contestado.
  const nConegudes = (canalitzats > 0 ? 1 : 0) + perAprovar.length
  const enviades = (l.n_respostes ?? 0) > nConegudes
    ? [{
        id: 'e', entidad_id: null, entitat: '', estado: 'pendent' as const,
        aprovacio: 'pendent' as const, canalizacion_id: null, conveni_rec: null,
      }]
    : []
  return {
    // La modalidad hace falta: en venta y maquila no hay REC, y sin ella la escalera daría
    // por hecho que es una donación (`certificatsDelLot`).
    oferta: {
      estado: l.estado as EstadoExcedente, kg_total: l.kg_total, origen: l.origen ?? null,
      modalitat: l.modalitat,
    },
    conveni_gen: l.conveni_gen
      ? { id: 'x', estado: l.conveni_gen as ConvenioEstado }
      : null,
    // Una canalización ya creada implica que hubo interés aprobado: es lo único que el
    // resumen permite afirmar, y se afirma solo eso.
    respostes: [
      ...(canalitzats > 0
        ? [{
            id: 'x', entidad_id: null, entitat: '', estado: 'acceptada' as const,
            aprovacio: 'aprovada' as const, canalizacion_id: 'x',
            conveni_rec: { id: 'x', estado: 'vigent' as ConvenioEstado },
          }]
        : []),
      ...perAprovar,
      ...enviades,
    ],
    // `kg_conciliados` no nulo = conciliada: es lo que mira `escalaCanal` para el cierre.
    canalitzacions: canalitzats > 0
      ? [{ id: 'x', kg_conciliados: l.tot_conciliat ? 1 : null, coste_kg: null }]
      : [],
    albarans: [
      ...(l.rec_estado
        ? [{ id: 'x', tipo: 'REC' as const, estado: l.rec_estado as EstadoAlbaran, numero: null, canalizacion_id: null }]
        : []),
      // El de salida menos avanzado, que es a cuyo ritmo va la escalera (`avancSortides`).
      ...(l.sortida_estado
        ? [{
            id: 's', tipo: (l.modalitat === 'donacio' ? 'ENT' : 'OPE') as 'ENT' | 'OPE',
            estado: l.sortida_estado as EstadoAlbaran, numero: null, canalizacion_id: 'x',
          }]
        : []),
    ],
    cost_falten: 0,
    exercici: null,
  }
}

export default function Canalitzacio() {
  const { t } = useT()
  const [files, setFiles] = useState<LotActiu[]>([])
  // Los avisos que no salieron, por oferta: a quién hay que avisar a mano. `null` = no se sabe.
  const [perEnviar, setPerEnviar] = useState<Record<string, number> | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { cerca, setCerca, q } = useCerca()
  const [dlgNova, setDlgNova] = useState(false)
  const navega = useNavigate()

  const carrega = useCallback(async () => {
    setCarregant(true)
    const [r, avisos] = await Promise.all([lotsActius(), avisosSenseEnviarPerOferta()])
    if (!r.ok) { setError(textError(t, r)) }
    else { setFiles(r.data ?? []); setError(null) }
    setPerEnviar(avisos)
    setCarregant(false)
  }, [t])

  useEffect(() => { void carrega() }, [carrega])

  const visibles = useMemo(() => {
    return filtraCerca(files, q, (f) => [f.id_excedente, f.productor])
  }, [files, q])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t('canalz.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('canalz.intro')}</p>
        </div>
        {/* Empezar un lote, que es lo que faltaba: hasta ahora solo se podían continuar los
            que ya existían, porque el alta asistida vivía DENTRO del ciclo. */}
        <Button className="h-11 whitespace-normal md:h-8" onClick={() => setDlgNova(true)}>
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
            // Con error no se dice «cap lot en curs»: no se sabe, y el error ya está arriba.
            !error && <p className="py-6 text-sm text-muted-foreground">{t('canalz.empty')}</p>
          ) : (
            // El criterio de las tablas (03-11-2026, AGENTS.md §2): cabe sin scroll horizontal.
            // En móvil quedan el lote (referencia, enlazada al ciclo, con la productora debajo),
            // la fase con lo que toca y la acción; los kilos salen desde `md`, la acción pendiente
            // en su columna desde `lg` y la productora y los dos contadores desde `xl`. Hasta
            // entonces, los contadores van como badge bajo la referencia: lo que se esconde por
            // ancho no se pierde. El orden de las columnas no cambia (`tauler.e2e.ts` lee la
            // cuarta celda, la acción pendiente, a 1280 px).
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('canalz.c_ref')}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t('canalz.c_productor')}</TableHead>
                  <TableHead className="w-32 lg:w-36">{t('canalz.c_fase')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('canalz.c_accio')}</TableHead>
                  <TableHead className="hidden w-28 md:table-cell">{t('canalz.c_kg')}</TableHead>
                  <TableHead className="hidden w-24 xl:table-cell">{t('canalz.c_pendents')}</TableHead>
                  <TableHead className="hidden w-24 xl:table-cell">{t('cfase.c_missatges')}</TableHead>
                  <TableHead className="w-15 md:w-16"><span className="sr-only">{t('doc.c_actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map((l) => {
                  const escala = escalaCanal(fetsDeLaFila(l))
                  const ara = escala.find((e) => e.estat === 'ara')
                    ?? escala.find((e) => e.estat === 'bloquejat')
                  const nEnviar = perEnviar === null ? null : (perEnviar[l.excedente_id] ?? 0)
                  const ruta = `/equip/canalitzacio/${l.excedente_id}`
                  // «Acció pendent» (fase 8 de la revisión del 08-10-2026): qué toca ahora; si
                  // está bloqueado, por qué. Sale en su columna desde `lg` y bajo la fase antes.
                  const accio = ara ? (
                    <>
                      <p className="text-sm">{t(`canal.${clauPas(ara)}_t`)}</p>
                      {ara.estat === 'bloquejat' && ara.motiuKey && (
                        <p className="mt-1 text-xs text-aviso">{t(ara.motiuKey)}</p>
                      )}
                    </>
                  ) : <span className="text-sm text-muted-foreground">{t('canalz.res_pendent')}</span>
                  return (
                    <FilaClicable key={l.excedente_id} to={ruta}>
                      <TableCell>
                        <Link to={ruta} className="font-medium text-primary tabular-nums hover:underline">
                          {l.id_excedente ?? '—'}
                        </Link>
                        <span className="block text-xs text-muted-foreground xl:hidden">{l.productor ?? '—'}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums md:hidden">
                          {Number(l.kg_canalitzats ?? 0).toLocaleString('ca-ES')} / {Number(l.kg_total ?? 0).toLocaleString('ca-ES')} kg
                        </span>
                        {(l.n_per_aprovar > 0 || (nEnviar ?? 0) > 0) && (
                          <span className="mt-1 flex flex-wrap gap-1 xl:hidden">
                            {l.n_per_aprovar > 0 && (
                              <Badge className="bg-aviso-fondo whitespace-normal text-aviso">
                                {t('canalz.c_pendents')}: {l.n_per_aprovar}
                              </Badge>
                            )}
                            {(nEnviar ?? 0) > 0 && (
                              <Badge className="bg-aviso-fondo whitespace-normal text-aviso">
                                {t('cfase.c_missatges')}: {nEnviar}
                              </Badge>
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">{l.productor ?? '—'}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={ara?.estat === 'bloquejat' ? 'outline' : 'secondary'}
                          className="max-w-full whitespace-normal"
                        >
                          {t(PASSOS_FASE_CLAUS[ara?.fase ?? 5])}
                        </Badge>
                        <div className="mt-1 text-left lg:hidden">{accio}</div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{accio}</TableCell>
                      <TableCell className="hidden text-center tabular-nums md:table-cell">
                        {Number(l.kg_canalitzats ?? 0).toLocaleString('ca-ES')} / {Number(l.kg_total ?? 0).toLocaleString('ca-ES')}
                      </TableCell>
                      <TableCell className="hidden text-center tabular-nums xl:table-cell">
                        {l.n_per_aprovar > 0 && (
                          <Badge className="bg-aviso-fondo text-aviso">{l.n_per_aprovar}</Badge>
                        )}
                      </TableCell>
                      {/* Lo que la plataforma no pudo mandar (interruptores o gates): se
                          copia desde «Missatges d'aquest pas» de cada fase. */}
                      <TableCell className="hidden text-center tabular-nums xl:table-cell">
                        {nEnviar === null
                          ? <span className="text-muted-foreground">—</span>
                          : nEnviar > 0 && (
                            <Badge className="bg-aviso-fondo text-aviso">{nEnviar}</Badge>
                          )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                          <BotoIcona icona={Eye} etiqueta={t('canalz.a_open')} onClick={() => navega(ruta)} />
                        </div>
                      </TableCell>
                    </FilaClicable>
                  )
                })}
              </TableBody>
            </Table>
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
