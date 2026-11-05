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

import { useState } from 'react'
import { useT } from '../../lib/i18n'
import DialegFirmaConveni from '../DialegFirmaConveni'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { estilEstatConveni } from '../../lib/convenis'
import { docVigent } from '../../lib/documentsPanell'
import { dataCurta } from '../../lib/albarans'
import type { Convenio, Documento } from '../../types'
import { Download, FileText, Loader2, PenLine } from 'lucide-react'
import BotoIcona from '../BotoIcona'
import { Badge } from '@/components/ui/badge'
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

/**
 * Firmar de verdad un convenio que el equipo dio por vigente sin firma (gestión autónoma,
 * fase 1). Solo el titular, como cualquier firma desde el panel (`soc_titular()`).
 */
export interface SignarDeclarat {
  tipusOrg: 'productor' | 'entidad'
  orgId: string
  titular: boolean
  /** Tras firmar: la pantalla relee sus convenios. */
  onFirmat?: () => void
}

export default function LlistaConvenis({
  files, docs, descarregador, signar,
}: {
  files: ConveniFila[]
  docs: DocFila[]
  descarregador: ReturnType<typeof useDescarregaDocument>
  signar?: SignarDeclarat
}) {
  const { t } = useT()
  const [dlgFirma, setDlgFirma] = useState(false)

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
            // Criterio de las tablas (03-11-2026, AGENTS.md §2): a 360 px quedan modelo,
            // estado y acciones; el número y la fecha van bajo el modelo hasta que tienen
            // columna —el número desde `md`, la fecha desde `lg`—.
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('conv.c_model')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('alb.c_number')}</TableHead>
                  <TableHead>{t('alb.c_status')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('doc.c_date')}</TableHead>
                  <TableHead className="w-15 md:w-30">
                    <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((c) => {
                  const doc = docVigent(docs, 'convenio', c.id)
                  // Un convenio firmado pero sin contrafirmar tiene PDF, y conviene decir
                  // que todavía no es el definitivo: lo que falta es la firma de la
                  // Fundación, no nada suyo.
                  const provisional = doc?.subtipo === 'firmat'
                  // El PDF firmado que se subió (circuito de firma, 05-11-2026): esa versión es
                  // la definitiva de la biblioteca, y lo dice.
                  const signat = doc?.subtipo === 'signat'
                  // Firmado fuera de la plataforma: no tiene número de serie (lo lleva el
                  // papel) ni PDF de Redestina, a propósito (§4). Lo que acredita es el
                  // escaneado, que está en «Documentació aportada per l'equip».
                  const paper = c.origen === 'paper'
                  // Declarado por el equipo, sin firma: es vigente (verde) y lo dice. El
                  // titular lo puede firmar de verdad; la contrafirma lo sustituirá.
                  const declarat = c.origen === 'declarat' && c.estado === 'vigent'
                  const numero = c.numero_completo ?? (paper ? c.referencia_paper : null) ?? null
                  const data = dataCurta(c.contrafirmado_at ?? c.firmado_at ?? c.enviado_at ?? c.created_at)
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className="font-medium">{t(`sig.model_${c.tipo}`)}</span>
                        {/* El número se esconde en `md` y la fecha en `lg`: el «·» va delante
                            del número para que nunca quede colgando. */}
                        <span className="block text-xs text-muted-foreground lg:hidden">
                          {data}
                          {numero && <span className="tabular-nums md:hidden"> · {numero}</span>}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-center tabular-nums md:table-cell">
                        {numero ?? '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Badge className={`whitespace-normal ${estilEstatConveni(c.estado)}`}>
                            {t(`conv.st_${c.estado}`)}
                          </Badge>
                          {provisional && (
                            <span className="text-xs text-muted-foreground">
                              {t('mydoc.conv_provisional')}
                            </span>
                          )}
                          {declarat && !signat && (
                            <span className="text-xs text-muted-foreground">
                              {t('conv.origen_declarat')}
                            </span>
                          )}
                          {signat && (
                            <span className="text-xs text-exito" data-testid="conveni-signat-tancat">
                              {t('mydoc.conv_signat')}
                            </span>
                          )}
                          {/* La frase del papel vivía en la columna de acciones, donde la
                              ensanchaba; ahora va bajo el estado, que es lo que explica. */}
                          {paper && !doc && (
                            <span className="text-xs text-muted-foreground">{t('mydoc.conv_paper')}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-center whitespace-nowrap text-muted-foreground lg:table-cell">
                        {data}
                      </TableCell>
                      <TableCell>
                        {/* Leer el convenio es lo habitual —lo que hay que consultar es
                            qué se firmó—, así que «Veure el PDF» va delante de la descarga.
                            Firmar un declarado va primero y relleno: es lo que le toca. */}
                        <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                          {declarat && signar?.titular && (
                            <BotoIcona
                              icona={PenLine}
                              variant="default"
                              etiqueta={t('mydoc.conv_signa_declarat')}
                              onClick={() => setDlgFirma(true)}
                            />
                          )}
                          {doc && (
                            <>
                              <BotoIcona
                                icona={FileText}
                                etiqueta={t('doc.a_view_pdf')}
                                disabled={descarregador.ocupat === doc.id}
                                onClick={() => void descarregador.mostra(doc.id)}
                              />
                              <BotoIcona
                                icona={descarregador.generant === doc.id ? Loader2 : Download}
                                etiqueta={t('doc.download')}
                                className={descarregador.generant === doc.id ? '[&_svg]:animate-spin' : undefined}
                                disabled={descarregador.ocupat === doc.id}
                                onClick={() => void descarregador.descarrega(doc.id)}
                              />
                            </>
                          )}
                          {!doc && !paper && (
                            <span className="text-center text-xs text-muted-foreground">{t('mydoc.no_pdf')}</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
      </CardContent>
      {/* SIN `conveniId`: va por `signar_conveni_propi()`, que prepara el de col·laboració de
          su papel y deja firmar encima de un declarado (no cuenta en `conveni_cobreix_tot`). */}
      {signar && (
        <DialegFirmaConveni
          obert={dlgFirma}
          tipusOrg={signar.tipusOrg}
          orgId={signar.orgId}
          onTancar={() => setDlgFirma(false)}
          onFirmat={() => { setDlgFirma(false); signar.onFirmat?.() }}
        />
      )}
    </Card>
  )
}
