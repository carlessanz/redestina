// «Certificat de donació» en la ficha de una oferta del panel del ofertante
// (`/productor/ofertes/:id`): si esa oferta tiene un certificado de donación vigente, se ve y
// se descarga desde aquí, además de desde «Els meus documents». Se calla si no hay ninguno.
//
// La lectura es por RLS (`cierres_periodo_meus()`: solo lo suyo, y lo de prueba solo si su
// ficha es `es_test`), y la descarga, solo por `descargar-documento`. El ofertante no ve el
// código `E-…` (§6ter): la tarjeta dice el periodo, el número y la fecha de expedición.

import { Award } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { textPeriodeUi } from '../../lib/certificatsDonacio'
import { dataCurta } from '../../lib/format'
import { useCertificatOferta } from '../../hooks/useCertificatOferta'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import AccionsCertificat from '../equip/AccionsCertificat'
import TitolSeccio from './TitolSeccio'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export default function CertificatOfertaPropi({ excedenteId }: { excedenteId: string }) {
  const { t, lang } = useT()
  const { cert, recarrega } = useCertificatOferta(excedenteId)
  const descarregador = useDescarregaDocument(recarrega)
  if (!cert || !cert.doc) return null
  return (
    <Card data-testid="certificat-oferta-propi">
      <CardHeader>
        <TitolSeccio icona={Award}>{t('cdon.title')}</TitolSeccio>
        <p className="mt-1 text-sm text-muted-foreground">{t('cdon.own_hint')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium tabular-nums">{cert.periode.certificado_numero}</span>
          {cert.periode.modo === 'prueba' && (
            <Badge className="bg-aviso-fondo text-aviso whitespace-normal">{t('tan.mode_test')}</Badge>
          )}
          <span className="text-muted-foreground">
            {textPeriodeUi('oferta', cert.periode.periodo_desde, cert.periode.periodo_hasta, lang)}
            {cert.periode.data_expedicio ? ` · ${t('cdon.expedit', { data: dataCurta(cert.periode.data_expedicio) })}` : ''}
          </span>
        </p>
        <AccionsCertificat doc={cert.doc} descarregador={descarregador} />
      </CardContent>
      {descarregador.visor}
    </Card>
  )
}
