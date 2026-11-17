// «Nou producte» (punto 3, fase D1): el alta de un producto del catálogo en dos pasos.
//
//   1. Nombre (catalán), nombre en castellano (opcional, para casar con Mercabarna) y familia
//      (`crear_producte`). Icono: el genérico de su familia hasta que alguien dibuje el suyo.
//   2. Las COINCIDENCIAS con los nombres vistos en las últimas cargas (`noms_fonts_preus`),
//      normalizando acentos y mayúsculas (`coincidencies()` de `_shared/preusFonts.ts`, el mismo
//      módulo que lee las fuentes): las que puntúan alto vienen marcadas. Si no se marca
//      ninguna, el producto queda «preu manual» y se pide el precio (`fijar_coste_producto`).

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { fixarCostProducte } from '../../lib/tancament'
import { coincidencies } from '../../../supabase/functions/_shared/preusFonts.ts'
import {
  afegeixEquivalencia, carregaNomsFonts, creaProducte, fixaPreuManual, type NomFontVist,
} from '../../lib/preus'
import Desplegable from '../Desplegable'
import { FilaCasella } from '../Casella'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  obert: boolean
  onObert: (v: boolean) => void
  families: readonly string[]
  /** Al acabar: el nombre del producto creado. */
  onCreat: (nom: string) => void
}

const clau = (n: NomFontVist) => `${n.font}|${n.codi_font ?? ''}|${n.nom_font}`

export default function DialegNouProducte({ obert, onObert, families, onCreat }: Props) {
  const { t } = useT()
  const [pas, setPas] = useState<1 | 2>(1)
  const [nom, setNom] = useState('')
  const [nomEs, setNomEs] = useState('')
  const [familia, setFamilia] = useState('')
  const [creat, setCreat] = useState<string | null>(null)
  const [noms, setNoms] = useState<NomFontVist[]>([])
  const [triats, setTriats] = useState<Set<string>>(new Set())
  const [preu, setPreu] = useState('')
  const [ocupat, setOcupat] = useState(false)

  // Al cerrarse, todo vuelve a empezar.
  useEffect(() => {
    if (obert) return
    setPas(1); setNom(''); setNomEs(''); setFamilia(''); setCreat(null); setNoms([]); setTriats(new Set()); setPreu('')
  }, [obert])

  const candidats = useMemo(
    () => (creat ? coincidencies([creat, nomEs], noms).slice(0, 12) : []),
    [creat, nomEs, noms],
  )

  async function crea() {
    if (nom.trim().length < 2) { toast.error(t('preu.err_nom_invalid')); return }
    if (!familia) { toast.error(t('preu.err_familia_desconeguda')); return }
    setOcupat(true)
    const r = await creaProducte(nom.trim(), familia, nomEs.trim() || null)
    if (!r.ok) { setOcupat(false); toast.error(textError(t, r)); return }
    const n = await carregaNomsFonts()
    setOcupat(false)
    const vistos = n.ok ? n.data ?? [] : []
    setCreat(r.data)
    setNoms(vistos)
    // Las que puntúan 2 o más vienen marcadas.
    setTriats(new Set(coincidencies([r.data, nomEs], vistos).filter((c) => c.punts >= 2).map(clau)))
    setPas(2)
    toast.success(t('preu.product_created', { p: r.data }))
  }

  async function acaba() {
    if (!creat) return
    const seleccio = candidats.filter((c) => triats.has(clau(c)))
    setOcupat(true)
    if (seleccio.length > 0) {
      for (const c of seleccio) {
        const r = await afegeixEquivalencia(creat, c.font, c.nom_font, c.codi_font)
        if (!r.ok) { setOcupat(false); toast.error(textError(t, r)); return }
      }
    } else {
      const n = Number(preu.trim().replace(',', '.'))
      if (!preu.trim() || Number.isNaN(n) || n <= 0) { setOcupat(false); toast.error(t('cost.bad_value')); return }
      const m = await fixaPreuManual(creat, true)
      if (!m.ok) { setOcupat(false); toast.error(textError(t, m)); return }
      const c = await fixarCostProducte({ producte: creat, cost: n, motiu: t('preu.manual_reason_new') })
      if (!c.ok) { setOcupat(false); toast.error(textError(t, c)); return }
    }
    setOcupat(false)
    onObert(false)
    onCreat(creat)
  }

  function commuta(k: string, v: boolean) {
    setTriats((ant) => {
      const n = new Set(ant)
      if (v) n.add(k); else n.delete(k)
      return n
    })
  }

  const opcionsFamilia = families.map((f) => ({ valor: f, text: f }))
  const capTriat = candidats.every((c) => !triats.has(clau(c)))

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!ocupat) onObert(v) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pas === 1 ? t('preu.new_title') : t('preu.new_sources_title', { p: creat ?? '' })}</DialogTitle>
          <DialogDescription>{pas === 1 ? t('preu.new_desc') : t('preu.new_sources_desc')}</DialogDescription>
        </DialogHeader>

        {pas === 1 && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void crea() }}>
            <div className="space-y-1.5">
              <Label htmlFor="nou-nom">{t('preu.f_name')}</Label>
              <Input id="nou-nom" value={nom} onChange={(e) => setNom(e.target.value)} autoFocus maxLength={60} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nou-nom-es">{t('preu.f_name_es')}</Label>
              <Input id="nou-nom-es" value={nomEs} onChange={(e) => setNomEs(e.target.value)} maxLength={60} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nou-familia">{t('preu.f_family')}</Label>
              <Desplegable id="nou-familia" value={familia} onChange={setFamilia} opcions={opcionsFamilia}
                placeholder={t('preu.pick_family')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onObert(false)} disabled={ocupat}>{t('c.cancel')}</Button>
              <Button type="submit" disabled={ocupat} data-testid="nou-producte-crea">{t('preu.a_create')}</Button>
            </DialogFooter>
          </form>
        )}

        {pas === 2 && (
          <div className="space-y-3">
            {candidats.length === 0 && <p className="text-sm text-muted-foreground">{t('preu.no_matches')}</p>}
            {candidats.length > 0 && (
              <div className="space-y-1" data-testid="nou-producte-coincidencies">
                {candidats.map((c) => (
                  <FilaCasella key={clau(c)} checked={triats.has(clau(c))} onChange={(v) => commuta(clau(c), v)}>
                    <span className="min-w-0 break-words">
                      <Badge className="mr-2 bg-secondary text-secondary-foreground">{t(`preu.font_${c.font}`)}</Badge>
                      {c.nom_font}
                      {c.productes.length > 0 && (
                        <span className="block text-xs text-muted-foreground">{t('preu.also_used', { p: c.productes.join(', ') })}</span>
                      )}
                    </span>
                  </FilaCasella>
                ))}
              </div>
            )}
            {capTriat && (
              <div className="space-y-1.5">
                <Label htmlFor="nou-preu">{t('preu.f_manual_price')}</Label>
                <Input id="nou-preu" inputMode="decimal" value={preu} onChange={(e) => setPreu(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t('preu.manual_hint')}</p>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => void acaba()} disabled={ocupat} data-testid="nou-producte-acaba">
                {capTriat ? t('preu.a_finish_manual') : t('preu.a_finish_sources')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
