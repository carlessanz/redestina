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
import { Download, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

export type ConveniFila = Pick<
  Convenio,
  'id' | 'tipo' | 'tipo_org' | 'estado' | 'numero_completo' | 'ejercicio'
  | 'enviado_at' | 'firmado_at' | 'contrafirmado_at' | 'created_at'
>

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
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{t(`sig.model_${c.tipo}`)}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {c.numero_completo ?? '—'}
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
                          <div className="flex justify-end">
                            {doc
                              ? (
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
                              )
                              : <span className="text-xs text-muted-foreground">{t('mydoc.no_pdf')}</span>}
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
