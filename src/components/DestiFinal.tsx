// Qué ha pasado con el producto: el destino final de los kilos de una oferta.
//
// Fase 1 de la revisión del cliente del 08-10-2026: «una oferta no debería poder terminar
// simplemente como Cancel·lada». Cuando pasa la fecha, el productor (o el equipo en su
// nombre) dice qué pasó con los kilos que no salieron por Redestina —venta externa,
// compostaje, alimentación animal…—, en varias filas con sus kilos. Lo que sí salió por
// Redestina se pinta arriba como filas fijas: no se teclea dos veces.
//
// Una pieza para los dos paneles (productor y equipo), como `FirmaConveni`: la regla vive en
// `registrar_desti_final()` y la pantalla solo anticipa lo que la base rechazaría.

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { avuiMadrid, dataCurta, nombre } from '../lib/format'
import {
  carregaCatalegDestins, carregaDestins, registraDestiFinal,
} from '../lib/ofertes'
import type { DestiCataleg, DestiRegistrat } from '../lib/ofertes'
import {
  calDemanarDesti, errorDesti, ESTATS_AMB_DESTI, FILA_BUIDA, payloadDesti, resumDesti,
} from '../lib/destiFinal'
import type { FilaDesti } from '../lib/destiFinal'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '../lib/utils'

export interface SortidaRedestina { entitat: string | null; kg: number }

export default function DestiFinal({
  excedenteId, estado, kgTotal, destiReclamat, sortides, onDesat,
}: {
  excedenteId: string
  estado: string
  kgTotal: number
  /** `excedentes.desti_reclamat_at` no nulo: el job ya le pidió el destino. */
  destiReclamat: boolean
  /** Las canalizaciones no anuladas: lo que salió (o sale) por Redestina. */
  sortides: SortidaRedestina[]
  onDesat?: (estado: string) => void
}) {
  const { t, lang } = useT()
  const [cataleg, setCataleg] = useState<DestiCataleg[]>([])
  const [desats, setDesats] = useState<DestiRegistrat[] | null>(null)
  const [files, setFiles] = useState<FilaDesti[]>([])
  const [obert, setObert] = useState(false)
  const [desant, setDesant] = useState(false)
  const [errorCarrega, setErrorCarrega] = useState(false)

  const kgRedestina = useMemo(() => sortides.reduce((a, s) => a + s.kg, 0), [sortides])

  useEffect(() => {
    let viu = true
    void (async () => {
      try {
        const [c, d] = await Promise.all([carregaCatalegDestins(), carregaDestins([excedenteId])])
        if (!viu) return
        setCataleg(c)
        if (!d.ok || !d.data) { setErrorCarrega(true); return }
        setDesats(d.data)
        // Siempre al menos una fila: es la que se rellena. Las vacías no se envían.
        const fs = d.data.map((x) => ({
          desti: x.desti_codi, kg: String(x.kg), receptor: x.receptor ?? '', data: x.data ?? '',
        }))
        setFiles(fs.length > 0 ? fs : [{ ...FILA_BUIDA }])
      } catch {
        if (viu) setErrorCarrega(true)
      }
    })()
    return () => { viu = false }
  }, [excedenteId])

  const editable = (ESTATS_AMB_DESTI as readonly string[]).includes(estado)
  const resumDesat = resumDesti(kgTotal, kgRedestina, files)
  const demanar = calDemanarDesti(estado, destiReclamat, resumDesti(kgTotal, kgRedestina,
    (desats ?? []).map((x) => ({ desti: x.desti_codi, kg: String(x.kg), receptor: '', data: '' }))).kgSenseDesti)
  const formulariObert = obert || demanar
  const nom = (codi: string) => {
    const c = cataleg.find((x) => x.codi === codi)
    return c ? (lang === 'es' ? c.nom_es : c.nom_ca) : codi
  }

  // Ni cerrada con destinos, ni editable: no hay nada que decir aquí.
  if (!editable && (desats?.length ?? 0) === 0) return null
  if (errorCarrega) {
    return <p className="text-sm text-error">{t('desti.err_carrega')}</p>
  }
  if (desats === null) return null

  const error = errorDesti(kgTotal, kgRedestina, files, avuiMadrid())

  async function desa() {
    setDesant(true)
    const r = await registraDestiFinal(excedenteId, payloadDesti(files))
    setDesant(false)
    if (!r.ok || !r.data) {
      toast.error(t(r.code ? `desti.err_${r.code}` : 'desti.err_generic'))
      return
    }
    const estat = r.data.estado
    toast.success(t(estat === 'cerrada' ? 'desti.ok_tancada' : 'desti.ok'))
    setObert(false)
    onDesat?.(estat)
  }

  const canvia = (i: number, camp: keyof FilaDesti, v: string) =>
    setFiles((p) => p.map((f, j) => (j === i ? { ...f, [camp]: v } : f)))

  return (
    <Card id="desti" className={cn('scroll-mt-20', demanar && 'border-error/40')}>
      <CardHeader>
        <CardTitle className="text-base">{t('desti.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {demanar && (
          <div className="flex items-start gap-2 rounded-md bg-error-fondo p-3 text-sm text-error">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0">
              <strong>{t('desti.banda_t')}</strong> {t('desti.banda_d')}
            </p>
          </div>
        )}

        {/* Lo que salió por Redestina: no se edita aquí, se ve. */}
        {sortides.length > 0 && (
          <ul className="space-y-1 text-sm">
            {sortides.map((s, i) => (
              <li key={i} className="text-muted-foreground">
                {t('desti.via_redestina', { kg: nombre(s.kg, 0), entitat: s.entitat ?? '—' })}
              </li>
            ))}
          </ul>
        )}

        {!formulariObert && (
          <>
            {desats.length > 0 && (
              <ul className="space-y-1 text-sm">
                {desats.map((d) => (
                  <li key={d.id}>
                    {nombre(d.kg, 0)} kg · {nom(d.desti_codi)}
                    {d.receptor ? ` · ${d.receptor}` : ''}
                    {d.data ? ` · ${dataCurta(d.data)}` : ''}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-9"
                onClick={() => setObert(true)}>
                {desats.length > 0 ? t('desti.edita') : t('desti.afegeix_externa')}
              </Button>
            )}
          </>
        )}

        {formulariObert && editable && (
          <div className="space-y-3">
            {files.map((f, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[2fr_1fr_2fr_1.3fr_auto] sm:items-end">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t('desti.f_desti')}
                  <select
                    value={f.desti}
                    onChange={(e) => canvia(i, 'desti', e.target.value)}
                    className="h-11 w-full rounded-md border border-input bg-background px-2 text-base text-foreground md:h-9 md:text-sm"
                  >
                    <option value="">{t('desti.tria')}</option>
                    {cataleg.map((c) => <option key={c.codi} value={c.codi}>{lang === 'es' ? c.nom_es : c.nom_ca}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t('desti.f_kg')}
                  <Input inputMode="decimal" value={f.kg} className="h-11 md:h-9"
                    onChange={(e) => canvia(i, 'kg', e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t('desti.f_receptor')}
                  <Input value={f.receptor} maxLength={200} className="h-11 md:h-9"
                    placeholder={t('desti.f_receptor_ph')}
                    onChange={(e) => canvia(i, 'receptor', e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t('desti.f_data')}
                  <Input type="date" value={f.data} max={avuiMadrid()} className="h-11 md:h-9"
                    onChange={(e) => canvia(i, 'data', e.target.value)} />
                </label>
                <Button variant="ghost" size="icon" className="size-11 md:size-9" type="button"
                  aria-label={t('desti.treu')}
                  onClick={() => setFiles((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : [{ ...FILA_BUIDA }]))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}

            <Button variant="outline" type="button" className="h-11 w-full whitespace-normal sm:w-auto md:h-9"
              onClick={() => setFiles((p) => [...p, { ...FILA_BUIDA }])}>
              <Plus className="size-4" /> {t('desti.afegeix')}
            </Button>

            <p className={cn('text-sm', resumDesat.sobren > 0 ? 'text-error' : 'text-muted-foreground')}>
              {resumDesat.sobren > 0
                ? t('desti.sobren', { n: nombre(resumDesat.sobren, 0) })
                : t('desti.resum', {
                  amb: nombre(kgTotal - resumDesat.kgSenseDesti, 0),
                  total: nombre(kgTotal, 0),
                  falten: nombre(resumDesat.kgSenseDesti, 0),
                })}
            </p>
            {error && error !== 'desti.err_massa' && <p className="text-sm text-error">{t(error)}</p>}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 w-full whitespace-normal sm:w-auto md:h-9" disabled={!!error || desant}
                onClick={() => void desa()}>
                {t('desti.desa')}
              </Button>
              {!demanar && (
                <Button variant="ghost" className="h-11 w-full sm:w-auto md:h-9" type="button"
                  onClick={() => setObert(false)}>
                  {t('c.cancel')}
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
