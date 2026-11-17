// Los precios de referencia de UN producto (punto 3, fase D1), en su ficha del catálogo:
//
//   · si es «preu manual» (sin fuente: cada mes vale el manual vigente, el de la tarjeta de
//     arriba) o tiene fuentes;
//   · sus equivalencias con Gencat y Mercabarna (añadir con el buscador de los nombres vistos en
//     las últimas cargas, con las coincidencias propuestas arriba; quitar);
//   · la rejilla año × mes con el precio VALIDADO y su fuente. Sin scroll horizontal: cada año
//     es un bloque de 12 celdas que se reparten en 3, 6 o 12 columnas según el ancho.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { eurKg } from '../../lib/tancament'
import { coincidencies } from '../../../supabase/functions/_shared/preusFonts.ts'
import {
  COLUMNES_EQUIVALENCIA, COLUMNES_PREU_VALIDAT, MESOS, afegeixEquivalencia, carregaNomsFonts, fixaPreuManual,
  treuEquivalencia, type EquivalenciaPreu, type FontDescarrega, type NomFontVist, type PreuValidat,
} from '../../lib/preus'
import Desplegable from '../Desplegable'
import CercadorOpcions from '../CercadorOpcions'
import BotoIcona from '../BotoIcona'
import { FilaCasella } from '../Casella'
import { BadgeFont } from './PestanyaPreus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

interface Props {
  producte: string
  nomEs: string | null
  preuManual: boolean
  potAprovar: boolean
  onCanviat: () => void
}

export default function PreusProducte({ producte, nomEs, preuManual, potAprovar, onCanviat }: Props) {
  const { t } = useT()
  const [equivs, setEquivs] = useState<EquivalenciaPreu[]>([])
  const [preus, setPreus] = useState<PreuValidat[]>([])
  const [noms, setNoms] = useState<NomFontVist[]>([])
  const [font, setFont] = useState<FontDescarrega>('mercabarna')
  const [ocupat, setOcupat] = useState(false)

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7).
    const [e, p, n] = await Promise.all([
      supabase.from('productes_fonts').select(COLUMNES_EQUIVALENCIA).eq('producto', producte).order('font').order('nom_font'),
      supabase.from('preus_referencia').select(COLUMNES_PREU_VALIDAT).eq('producto', producte)
        .order('exercici', { ascending: false }).order('mes'),
      carregaNomsFonts(),
    ])
    setEquivs((e.data as EquivalenciaPreu[] | null) ?? [])
    setPreus((p.data as PreuValidat[] | null) ?? [])
    setNoms(n.ok ? n.data ?? [] : [])
  }, [producte])

  useEffect(() => { void carrega() }, [carrega])

  const perAny = useMemo(() => {
    const m = new Map<number, Map<number, PreuValidat>>()
    for (const p of preus) {
      if (!m.has(p.exercici)) m.set(p.exercici, new Map())
      m.get(p.exercici)!.set(p.mes, p)
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [preus])

  const jaHi = useMemo(() => new Set(equivs.map((e) => `${e.font}|${e.nom_font.toUpperCase()}`)), [equivs])
  const suggerits = useMemo(
    () => coincidencies([producte, nomEs ?? ''], noms).filter((c) => !jaHi.has(`${c.font}|${c.nom_font.toUpperCase()}`)).slice(0, 6),
    [producte, nomEs, noms, jaHi],
  )
  const opcionsNom = useMemo(() => noms
    .filter((n) => n.font === font && !jaHi.has(`${n.font}|${n.nom_font.toUpperCase()}`))
    .map((n) => ({
      valor: `${n.codi_font ?? ''}|${n.nom_font}`,
      text: n.nom_font,
      detall: n.productes.length > 0 ? n.productes.join(', ') : undefined,
    })), [noms, font, jaHi])

  async function afegeix(f: FontDescarrega, nom: string, codi: string | null) {
    setOcupat(true)
    const r = await afegeixEquivalencia(producte, f, nom, codi)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('preu.equiv_added', { p: nom }))
    await carrega()
  }

  async function treu(e: EquivalenciaPreu) {
    setOcupat(true)
    const r = await treuEquivalencia(e.id)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('preu.equiv_removed', { p: e.nom_font }))
    await carrega()
  }

  async function manual(v: boolean) {
    setOcupat(true)
    const r = await fixaPreuManual(producte, v)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    onCanviat()
  }

  return (
    <Card data-testid="preus-producte">
      <CardHeader>
        <CardTitle className="text-base">{t('preu.product_title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('preu.product_hint')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {potAprovar
          ? (
            <FilaCasella checked={preuManual} onChange={(v) => void manual(v)} disabled={ocupat}>
              {t('preu.manual_label')}
            </FilaCasella>
          )
          : preuManual && <p className="text-sm">{t('preu.manual_product')}</p>}

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t('preu.equivs')}</p>
          {equivs.length === 0 && <p className="text-sm text-muted-foreground">{t('preu.no_equivs')}</p>}
          <ul className="space-y-1">
            {equivs.map((e) => (
              <li key={e.id} className="flex min-w-0 items-center gap-2 text-sm">
                <BadgeFont font={e.font} />
                <span className="min-w-0 flex-1 break-words">
                  {e.nom_font}
                  {e.codi_font && <span className="text-xs text-muted-foreground"> · {e.codi_font}</span>}
                  {e.origen === 'sembra' && <span className="text-xs text-muted-foreground"> · {t('preu.seeded')}</span>}
                </span>
                {potAprovar && (
                  <BotoIcona icona={X} etiqueta={t('preu.a_remove_equiv')} disabled={ocupat} onClick={() => void treu(e)} />
                )}
              </li>
            ))}
          </ul>
          {potAprovar && suggerits.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('preu.suggested')}</p>
              <div className="flex flex-wrap gap-2">
                {suggerits.map((s) => (
                  <Button key={`${s.font}|${s.nom_font}`} size="sm" variant="outline" className="h-auto min-h-11 whitespace-normal md:min-h-8"
                    disabled={ocupat} onClick={() => void afegeix(s.font, s.nom_font, s.codi_font)}>
                    <Plus className="size-4" aria-hidden /> {t(`preu.font_${s.font}`)} · {s.nom_font}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {potAprovar && (
            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <Label htmlFor="equiv-font">{t('preu.f_source')}</Label>
                <Desplegable id="equiv-font" value={font} onChange={(v) => setFont(v as FontDescarrega)}
                  opcions={[{ valor: 'gencat', text: t('preu.font_gencat') }, { valor: 'mercabarna', text: t('preu.font_mercabarna') }]} />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="equiv-nom">{t('preu.f_source_name')}</Label>
                <CercadorOpcions id="equiv-nom" opcions={opcionsNom} valor={null} minLletres={0} maxim={30}
                  placeholder={t('preu.pick_source_name')} disabled={ocupat}
                  onChange={(v) => {
                    const [codi, ...resta] = v.split('|')
                    void afegeix(font, resta.join('|'), codi || null)
                  }} />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">{t('preu.grid')}</p>
          {perAny.length === 0 && <p className="text-sm text-muted-foreground">{t('preu.no_validated')}</p>}
          {perAny.map(([any, mesos]) => (
            <div key={any} className="space-y-1" data-testid={`preus-any-${any}`}>
              <p className="text-sm font-medium">{any}</p>
              <div className="grid grid-cols-3 gap-1 sm:grid-cols-6 lg:grid-cols-12">
                {MESOS.map((m) => {
                  const p = mesos.get(m)
                  return (
                    <div key={m} className="min-w-0 rounded-md border p-1.5 text-center text-xs"
                      title={p ? `${p.font_nom ?? ''}${p.motiu ? ` · ${p.motiu}` : ''}` : undefined}>
                      <span className="block text-muted-foreground">{t(`preu.mes_curt_${m}`)}</span>
                      <span className="block tabular-nums font-medium">{p ? eurKg(p.eur_kg).replace(' €/kg', '') : '—'}</span>
                      {p && (
                        <Badge className="mt-0.5 bg-secondary px-1 text-[0.625rem] text-secondary-foreground">
                          {t(`preu.font_${p.font}_curt`)}
                        </Badge>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {perAny.length > 0 && <p className="text-xs text-muted-foreground">{t('preu.grid_unit')}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
