// La tarjeta «Certificat de donació» de la ficha de una oferta del equipo
// (`/equip/ofertes/:id`). Solo la ve el super_admin y solo en una oferta de donación
// (quien la monta lo comprueba): el certificado de una venta o una maquila no existe.
//
// Si la oferta ya tiene su certificado vigente, se ve, se descarga y se envía desde aquí; el
// botón abre el diálogo con el ámbito «Oferta» y esta oferta ya elegidos.

import { useEffect, useState } from 'react'
import { FileCheck } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { dadesFiscalsProvisionals } from '../../lib/canalitzacio'
import { textPeriodeUi } from '../../lib/certificatsDonacio'
import { dataCurta } from '../../lib/format'
import { useCertificatOferta } from '../../hooks/useCertificatOferta'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import AccionsCertificat from './AccionsCertificat'
import DialegCertificatDonacio from './DialegCertificatDonacio'
import { BadgeMode } from '../../routes/equip/Tancament'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function CertificatOferta({ excedenteId, productorId }: { excedenteId: string; productorId: string }) {
  const { t, lang } = useT()
  const { cert, error, recarrega } = useCertificatOferta(excedenteId)
  const descarregador = useDescarregaDocument(recarrega)
  const [obert, setObert] = useState(false)
  // El modo sale de `es_test` de la ficha (nunca se elige) y las dos guardas de la emisión
  // real, de la base; ante la duda, provisional y prueba (lo prudente).
  const [esTest, setEsTest] = useState(true)
  const [provisionals, setProvisionals] = useState(true)

  useEffect(() => {
    let viu = true
    void supabase.from('productores').select('es_test').eq('id', productorId).maybeSingle()
      .then(({ data }) => { if (viu && data) setEsTest(Boolean((data as { es_test: boolean }).es_test)) })
    void dadesFiscalsProvisionals().then((v) => { if (viu) setProvisionals(v) })
    return () => { viu = false }
  }, [productorId])

  return (
    <Card data-testid="certificat-oferta">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-60">
          <CardTitle className="text-base">{t('cdon.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('cdon.card_hint')}</p>
        </div>
        <Button className="h-11 w-full whitespace-normal sm:w-auto md:h-8" onClick={() => setObert(true)}>
          <FileCheck className="mr-1 size-4" aria-hidden />
          {t('cdon.title')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
        {cert
          ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium tabular-nums">{cert.periode.certificado_numero}</span>
                {cert.periode.modo === 'prueba' && <BadgeMode mode="prueba" />}
                <span className="text-muted-foreground">
                  {textPeriodeUi('oferta', cert.periode.periodo_desde, cert.periode.periodo_hasta, lang)}
                  {cert.periode.data_expedicio ? ` · ${t('cdon.expedit', { data: dataCurta(cert.periode.data_expedicio) })}` : ''}
                </span>
              </p>
              {cert.doc
                ? <AccionsCertificat doc={cert.doc} descarregador={descarregador} enviar />
                : <p className="text-xs text-muted-foreground">{t('doc.generating')}</p>}
            </div>
          )
          : !error && <p className="text-sm text-muted-foreground">{t('cdon.card_none')}</p>}
      </CardContent>

      <DialegCertificatDonacio
        obert={obert}
        onTancar={() => setObert(false)}
        productorId={productorId}
        modo={esTest ? 'prueba' : 'real'}
        provisionals={provisionals}
        onEmes={() => void recarrega()}
        abastInicial="oferta"
        excedenteInicial={excedenteId}
      />
      {descarregador.visor}
    </Card>
  )
}
