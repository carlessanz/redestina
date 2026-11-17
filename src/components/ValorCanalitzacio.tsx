// El valor por kilo de una canalización con su FUENTE (punto 3, fase D2, 17-11-2026), para las
// vistas del equipo: detalle de la oferta, ficha de la operación y albarán/conciliación.
//
// La frase es la MISMA que imprime el REC de donación (`_shared/fontValor.ts`), para que el
// papel y la pantalla no se contradigan. «Provisional» = el mes del albarán aún no está
// validado en Productes › Preus: el valor es el último publicado y se ajustará solo; el enlace
// lleva a ese mes.

import { Link } from 'react-router'
import { useT } from '../lib/i18n'
import { eurKg } from '../lib/tancament'
import { rutaPreusMes } from '../lib/preus'
import { textFontValor, textMes } from '../lib/valoracio'
import { Badge } from '@/components/ui/badge'

export interface DadesValor {
  coste_kg: number | string | null
  preu_font?: string | null
  preu_mes_albara?: string | null
  preu_mes_font?: string | null
  preu_font_dies?: number | null
  preu_provisional?: boolean | null
  preu_certificat?: string | null
}

export default function ValorCanalitzacio({ c, compacte = false }: { c: DadesValor; compacte?: boolean }) {
  const { t, lang } = useT()
  const idioma = lang === 'es' ? 'es' : 'ca'
  const cost = c.coste_kg === null || c.coste_kg === undefined || c.coste_kg === '' ? null : Number(c.coste_kg)
  const font = textFontValor({
    font: c.preu_font, mes_font: c.preu_mes_font, mes_albara: c.preu_mes_albara,
    dies: c.preu_font_dies, provisional: c.preu_provisional,
  }, idioma)
  const mesAlbara = c.preu_mes_albara ? c.preu_mes_albara.slice(0, 7) : null
  return (
    <span className="inline-flex flex-col gap-0.5 text-left" data-testid="valor-canalitzacio">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="tabular-nums font-medium">{cost === null ? '—' : eurKg(cost)}</span>
        {c.preu_provisional && (
          <Badge className="bg-aviso-fondo text-aviso" data-testid="valor-provisional">{t('vcan.provisional')}</Badge>
        )}
        {c.preu_certificat && (
          <Badge className="bg-secondary text-secondary-foreground">{t('vcan.certified', { n: c.preu_certificat })}</Badge>
        )}
      </span>
      {!compacte && font && <span className="text-xs text-muted-foreground">{font}</span>}
      {!compacte && mesAlbara && (
        <span className="text-xs text-muted-foreground">
          {t('vcan.month_albara', { m: textMes(mesAlbara, idioma) ?? mesAlbara })}
          {c.preu_provisional && (
            <>
              {' · '}
              <Link to={rutaPreusMes(mesAlbara)} className="font-medium text-primary hover:underline">
                {t('vcan.validate_month')}
              </Link>
            </>
          )}
        </span>
      )}
    </span>
  )
}
