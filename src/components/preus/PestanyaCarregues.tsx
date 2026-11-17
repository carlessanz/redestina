// «Càrregues» (punto 3, fase D1): lo que se ha descargado de cada fuente de precios.
//
// Arriba, una tarjeta por fuente: la dirección, si el job diario está encendido (solo el
// super_admin lo cambia, y la URL de Gencat también —el nombre del fichero cambiará en 2027—),
// la última comprobación con su resultado y «Actualitza ara» (admin o super_admin). Debajo,
// la lista de cargas con el fichero ORIGINAL para descargar; filtrando por Mercabarna, los días
// capturados. Una carga `pendent` se puede descartar (con motivo): sus precios dejan de proponerse.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, RefreshCw, RotateCcw, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { dataCurta, dataHora } from '../../lib/format'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import {
  COLUMNES_CARREGA, COLUMNES_ESTAT_FONT, actualitzaFont, descarregaFitxerCarrega, fixaFont, marcaCarrega,
  mesActual, mesDeData, type CarregaPreus, type EstatFont, type FontDescarrega,
} from '../../lib/preus'
import Desplegable from '../Desplegable'
import BotoIcona from '../BotoIcona'
import DialegMotiu from '../DialegMotiu'
import { FilaCasella } from '../Casella'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const ESTIL_ESTAT: Record<CarregaPreus['estat'], string> = {
  pendent: 'bg-aviso-fondo text-aviso',
  validada: 'bg-exito-fondo text-exito',
  descartada: 'bg-muted text-muted-foreground',
}

interface PropsFont {
  estat: EstatFont
  potAprovar: boolean
  esSuperAdmin: boolean
  ocupat: boolean
  diesMes: number
  onActualitza: () => void
  onAutomatic: (v: boolean) => void
  onUrl: (url: string) => void
}

function TargetaFont({ estat, potAprovar, esSuperAdmin, ocupat, diesMes, onActualitza, onAutomatic, onUrl }: PropsFont) {
  const { t } = useT()
  const [url, setUrl] = useState(estat.url)
  useEffect(() => { setUrl(estat.url) }, [estat.url])
  return (
    <Card data-testid={`font-${estat.font}`}>
      <CardHeader>
        <CardTitle className="text-base">{t(`preu.font_${estat.font}_long`)}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t(`preu.font_${estat.font}_desc`)}</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="min-w-0 break-all text-xs text-muted-foreground">{estat.url}</p>
        <div className="flex flex-wrap items-center gap-2">
          {estat.darrer_resultat && (
            <Badge className={estat.darrer_resultat === 'error' ? 'bg-error-fondo text-error'
              : estat.darrer_resultat === 'nou' ? 'bg-exito-fondo text-exito' : 'bg-secondary text-secondary-foreground'}>
              {t(`preu.res_${estat.darrer_resultat}`)}
            </Badge>
          )}
          <span className="text-muted-foreground">
            {t('preu.last_check', { d: estat.darrera_comprovacio_at ? dataHora(estat.darrera_comprovacio_at) : '—' })}
          </span>
        </div>
        {estat.darrer_error && <p className="break-words text-error">{estat.darrer_error}</p>}
        {estat.font === 'mercabarna' && <p className="text-muted-foreground">{t('preu.days_month', { n: diesMes })}</p>}
        <p className="text-muted-foreground">{t(estat.automatic ? 'preu.auto_on' : 'preu.auto_off')}</p>
        {esSuperAdmin && (
          <FilaCasella checked={estat.automatic} onChange={onAutomatic} disabled={ocupat}>
            {t('preu.auto_label')}
          </FilaCasella>
        )}
        {esSuperAdmin && estat.font === 'gencat' && (
          <form className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(e) => { e.preventDefault(); onUrl(url) }}>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="preu-url-gencat">{t('preu.f_url')}</Label>
              <Input id="preu-url-gencat" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <Button type="submit" variant="outline" className="h-11 md:h-8" disabled={ocupat || url.trim() === estat.url}>
              {t('c.save')}
            </Button>
          </form>
        )}
        {potAprovar && (
          <Button className="h-11 md:h-8" disabled={ocupat} onClick={onActualitza} data-testid={`actualitza-${estat.font}`}>
            <RefreshCw className="size-4" aria-hidden /> {t('preu.a_update')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default function PestanyaCarregues({ potAprovar, esSuperAdmin }: { potAprovar: boolean; esSuperAdmin: boolean }) {
  const { t } = useT()
  const [carregues, setCarregues] = useState<CarregaPreus[]>([])
  const [fonts, setFonts] = useState<EstatFont[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState(false)
  const [ocupat, setOcupat] = useState(false)
  const [filtre, setFiltre] = useState('')
  const [descartant, setDescartant] = useState<string | null>(null)

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7).
    const [c, f] = await Promise.all([
      supabase.from('preus_carregues').select(COLUMNES_CARREGA).order('created_at', { ascending: false }).limit(400),
      supabase.from('preus_fonts_estat').select(COLUMNES_ESTAT_FONT).order('font'),
    ])
    setError(Boolean(c.error || f.error))
    setCarregues((c.data as CarregaPreus[] | null) ?? [])
    setFonts((f.data as EstatFont[] | null) ?? [])
  }, [])

  useEffect(() => {
    let viu = true
    void carrega().finally(() => { if (viu) setCarregant(false) })
    return () => { viu = false }
  }, [carrega])

  const visibles = useMemo(() => carregues.filter((c) => !filtre || c.font === filtre), [carregues, filtre])
  const diesMes = useMemo(() => {
    const ara = mesActual()
    return carregues.filter((c) => {
      const m = mesDeData(c.data_font)
      return c.font === 'mercabarna' && c.estat !== 'descartada' && m?.exercici === ara.exercici && m.mes === ara.mes
    }).length
  }, [carregues])

  async function actualitza(font: FontDescarrega) {
    setOcupat(true)
    const r = await actualitzaFont(font)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); await carrega(); return }
    if (!r.data.ok) toast.error(t('preu.update_error', { e: r.data.error ?? '' }))
    else toast.success(t(`preu.update_${r.data.resultat ?? 'nou'}`, { n: r.data.files ?? 0 }))
    void refrescaComptadors()
    await carrega()
  }

  async function canviaFont(font: FontDescarrega, automatic: boolean | null, url: string | null) {
    setOcupat(true)
    const r = await fixaFont(font, automatic, url)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('preu.font_saved'))
    await carrega()
  }

  async function descarrega(id: string) {
    const r = await descarregaFitxerCarrega(id)
    if (!r.ok) toast.error(textError(t, r))
  }

  async function marca(id: string, estat: 'pendent' | 'descartada', motiu: string | null) {
    setOcupat(true)
    const r = await marcaCarrega(id, estat, motiu)
    setOcupat(false)
    setDescartant(null)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t(estat === 'descartada' ? 'preu.discarded' : 'preu.restored'))
    void refrescaComptadors()
    await carrega()
  }

  const opcionsFiltre = [
    { valor: 'gencat', text: t('preu.font_gencat') },
    { valor: 'mercabarna', text: t('preu.font_mercabarna') },
  ]

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('preu.loads_subtitle')}</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {fonts.map((f) => (
          <TargetaFont key={f.font} estat={f} potAprovar={potAprovar} esSuperAdmin={esSuperAdmin} ocupat={ocupat}
            diesMes={diesMes}
            onActualitza={() => void actualitza(f.font)}
            onAutomatic={(v) => void canviaFont(f.font, v, null)}
            onUrl={(u) => void canviaFont(f.font, null, u)} />
        ))}
      </div>

      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="carrega-font">{t('preu.c_source')}</Label>
        <Desplegable id="carrega-font" value={filtre} onChange={setFiltre} opcions={opcionsFiltre} buit={t('preu.all_sources')} />
      </div>

      {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
      {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
      {!carregant && visibles.length === 0 && <p className="text-sm text-muted-foreground">{t('preu.no_loads')}</p>}

      {visibles.length > 0 && (
        <Table data-testid="carregues-taula">
          <TableHeader>
            <TableRow>
              <TableHead className="text-center whitespace-normal">{t('preu.c_source')}</TableHead>
              <TableHead className="text-center whitespace-normal">{t('preu.c_source_date')}</TableHead>
              <TableHead className="hidden text-center whitespace-normal md:table-cell">{t('preu.c_downloaded')}</TableHead>
              <TableHead className="hidden text-center whitespace-normal sm:table-cell">{t('preu.c_rows')}</TableHead>
              <TableHead className="text-center whitespace-normal">{t('preu.c_state')}</TableHead>
              <TableHead className="w-15 text-center whitespace-normal md:w-22">
                <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map((c) => (
              <TableRow key={c.id} data-carrega={c.id}>
                <TableCell className="text-center whitespace-normal">
                  {t(`preu.font_${c.font}`)}
                  <span className="block text-xs text-muted-foreground">{t(`preu.origen_${c.origen}`)}</span>
                </TableCell>
                <TableCell className="text-center tabular-nums whitespace-normal">
                  {dataCurta(c.data_font)}
                  {c.font === 'gencat' && c.periode_fins && (
                    <span className="block text-xs text-muted-foreground">
                      {t('preu.until', { m: `${t(`preu.mes_${mesDeData(c.periode_fins)?.mes ?? 1}`)} ${mesDeData(c.periode_fins)?.exercici ?? ''}` })}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden text-center tabular-nums text-muted-foreground md:table-cell">{dataHora(c.created_at)}</TableCell>
                <TableCell className="hidden text-center tabular-nums sm:table-cell">
                  {c.files}
                  <span className="block text-xs text-muted-foreground">{t('preu.n_products', { n: c.productes })}</span>
                </TableCell>
                <TableCell className="text-center whitespace-normal">
                  <Badge className={ESTIL_ESTAT[c.estat]}>{t(`preu.estat_${c.estat}`)}</Badge>
                  {c.motiu && <span className="block text-xs break-words text-muted-foreground">{c.motiu}</span>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                    <BotoIcona icona={Download} etiqueta={t('preu.a_download')} onClick={() => void descarrega(c.id)}
                      data-testid="carrega-descarrega" />
                    {potAprovar && c.estat === 'pendent' && (
                      <BotoIcona icona={XCircle} etiqueta={t('preu.a_discard')} className="text-destructive hover:text-destructive"
                        disabled={ocupat} onClick={() => setDescartant(c.id)} />
                    )}
                    {potAprovar && c.estat === 'descartada' && (
                      <BotoIcona icona={RotateCcw} etiqueta={t('preu.a_restore')} disabled={ocupat}
                        onClick={() => void marca(c.id, 'pendent', null)} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <DialegMotiu
        obert={descartant !== null}
        onObert={(v) => { if (!v) setDescartant(null) }}
        titol={t('preu.discard_title')}
        descripcio={t('preu.discard_desc')}
        etiqueta={t('preu.f_discard_reason')}
        confirmar={t('preu.a_discard')}
        destructiu
        ocupat={ocupat}
        onConfirma={(m) => { if (descartant) void marca(descartant, 'descartada', m) }}
      />
    </div>
  )
}
