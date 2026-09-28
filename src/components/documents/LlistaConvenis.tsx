// Los convenios de una organización, en su panel.
//
// El convenio es el acuerdo marco: sin uno vigente no se puede operar (D7), así que la
// organización tiene que poder ver en qué estado está el suyo y descargarlo cuando esté
// firmado. Hasta ahora solo lo veía el equipo.
//
// NO SE AGRUPA POR EJERCICIO, al revés que los albaranes y los certificados. Un convenio
// firmado en 2026 sigue vigente en 2028: es estado actual, no un documento del año.
//
// Ni una columna de dinero: un convenio no lleva importes, y esto lo ven las dos partes.

import { useT } from '../../lib/i18n'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { estilEstatConveni } from '../../lib/convenis'
import { docVigent } from '../../lib/documentsPanell'
import { dataCurta } from '../../lib/albarans'
import type { Convenio, Documento } from '../../types'
import { Download, Eye, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

// `origen` y `referencia_paper` son opcionales en el tipo para no obligar a cada panel a
// cambiar su tipo de fila, pero los dos paneles los piden: sin ellos, un convenio firmado
// en papel salía «Vigent · — · Sense PDF», como si faltara algo.
export type ConveniFila = Pick<
  Convenio,
  'id' | 'tipo' | 'tipo_org' | 'estado' | 'numero_completo' | 'ejercicio'
  | 'enviado_at' | 'firmado_at' | 'contrafirmado_at' | 'created_at'
> & Partial<Pick<Convenio, 'origen' | 'referencia_paper'>>

type DocFila = Pick<
  Documento,
  'id' | 'objeto_id' | 'objeto_tipo' | 'tipo' | 'subtipo' | 'numero_completo' | 'estado' | 'vigente' | 'ejercicio'
>

export default function LlistaConvenis({
  files, docs, descarregador,
}: {
  files: ConveniFila[]
  docs: DocFila[]
  descarregador: ReturnType<typeof useDescarregaDocument>
}) {
  const { t } = useT()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('mydoc.conv_title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('mydoc.conv_hint')}</p>
      </CardHeader>
      <CardContent>
        {files.length === 0
          ? <p className="text-sm text-muted-foreground">{t('mydoc.conv_empty')}</p>
          : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('conv.c_model')}</TableHead>
                    <TableHead>{t('alb.c_number')}</TableHead>
                    <TableHead>{t('alb.c_status')}</TableHead>
                    <TableHead>{t('doc.c_date')}</TableHead>
                    <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((c) => {
                    const doc = docVigent(docs, 'convenio', c.id)
                    // Un convenio firmado pero sin contrafirmar tiene PDF, y conviene decir
                    // que todavía no es el definitivo: lo que falta es la firma de la
                    // Fundación, no nada suyo.
                    const provisional = doc?.subtipo === 'firmat'
                    // Firmado fuera de la plataforma: no tiene número de serie (lo lleva el
                    // papel) ni PDF de Redestina, a propósito (§4). Lo que acredita es el
                    // escaneado, que está en «Documentació aportada per l'equip».
                    const paper = c.origen === 'paper'
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{t(`sig.model_${c.tipo}`)}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {c.numero_completo ?? (paper ? c.referencia_paper : null) ?? '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge className={estilEstatConveni(c.estado)}>
                              {t(`conv.st_${c.estado}`)}
                            </Badge>
                            {provisional && (
                              <span className="text-xs text-muted-foreground">
                                {t('mydoc.conv_provisional')}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dataCurta(c.contrafirmado_at ?? c.firmado_at ?? c.enviado_at ?? c.created_at)}
                        </TableCell>
                        <TableCell>
                          {/* Leer el convenio es lo habitual —lo que hay que consultar es
                              qué se firmó—, así que «Veure» va delante. */}
                          <div className="flex justify-end gap-2">
                            {doc
                              ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-11 whitespace-normal md:h-8"
                                    disabled={descarregador.ocupat === doc.id}
                                    onClick={() => void descarregador.mostra(doc.id)}
                                  >
                                    <Eye className="mr-1 size-3.5" aria-hidden />
                                    {t('doc.view')}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-11 whitespace-normal md:h-8"
                                    disabled={descarregador.ocupat === doc.id}
                                    onClick={() => void descarregador.descarrega(doc.id)}
                                  >
                                    {descarregador.generant === doc.id
                                      ? <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                                      : <Download className="mr-1 size-3.5" aria-hidden />}
                                    {t('doc.download')}
                                  </Button>
                                </>
                              )
                              : (
                                // La celda hereda `whitespace-nowrap` (§2, regla 6): la
                                // frase del papel es larga y tiene que poder partirse.
                                <span className={paper
                                  ? 'block min-w-48 whitespace-normal text-right text-xs text-muted-foreground'
                                  : 'text-xs text-muted-foreground'}>
                                  {paper ? t('mydoc.conv_paper') : t('mydoc.no_pdf')}
                                </span>
                              )}
                          </div>
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
  )
}
