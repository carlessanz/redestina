// Los factores con los que se calcula el impacto (fase 10): CO₂e, agua y raciones por kilo.
// En Configuració, junto a los datos de la Fundación: son configuración del servicio. Los
// edita solo el super_admin (`fixar_factor_impacte`); el resto del equipo los ve.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { useAppContext } from '../../hooks/useAppContext'
import { FilaCasella } from '../Casella'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Factor {
  codi: string; valor: number; unitat: string; nom_ca: string; nom_es: string
  font: string | null; provisional: boolean
}

export default function FactorsImpacte() {
  const { t, lang } = useT()
  const { ctx } = useAppContext()
  const potEditar = ctx?.esSuperAdmin ?? false
  const [factors, setFactors] = useState<Factor[]>([])
  const [error, setError] = useState(false)
  const [desant, setDesant] = useState<string | null>(null)

  useEffect(() => {
    let viu = true
    void supabase.from('factors_impacte').select('codi, valor, unitat, nom_ca, nom_es, font, provisional')
      .order('codi').then(({ data, error: e }) => {
        if (!viu) return
        setError(Boolean(e))
        setFactors(((data ?? []) as Factor[]).map((f) => ({ ...f, valor: Number(f.valor) })))
      })
    return () => { viu = false }
  }, [])

  function canvia(codi: string, canvi: Partial<Factor>) {
    setFactors((fs) => fs.map((f) => (f.codi === codi ? { ...f, ...canvi } : f)))
  }

  async function desa(f: Factor) {
    setDesant(f.codi)
    const { error: e } = await supabase.rpc('fixar_factor_impacte', {
      p_codi: f.codi, p_valor: f.valor, p_font: f.font, p_provisional: f.provisional,
    })
    setDesant(null)
    if (e) { toast.error(textError(t, e.message)); return }
    toast.success(t('rec.saved'))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('fimp.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('fimp.desc')}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
        {factors.map((f) => (
          <div key={f.codi} className="grid grid-cols-1 gap-3 border-b border-border pb-4 last:border-0 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`fimp-${f.codi}`} className="text-xs text-muted-foreground">
                {lang === 'es' ? f.nom_es : f.nom_ca} ({f.unitat})
              </Label>
              <Input id={`fimp-${f.codi}`} type="number" inputMode="decimal" min={0} step="any"
                disabled={!potEditar} value={String(f.valor)}
                onChange={(e) => canvia(f.codi, { valor: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`fimp-${f.codi}-font`} className="text-xs text-muted-foreground">{t('fimp.font')}</Label>
              <Input id={`fimp-${f.codi}-font`} disabled={!potEditar} value={f.font ?? ''}
                onChange={(e) => canvia(f.codi, { font: e.target.value })} />
            </div>
            <FilaCasella checked={f.provisional} disabled={!potEditar}
              onChange={() => canvia(f.codi, { provisional: !f.provisional })}>
              {t('fimp.provisional')}
            </FilaCasella>
            {potEditar && (
              <div className="flex sm:justify-end">
                <Button variant="outline" className="h-11 w-full sm:w-auto md:h-9" disabled={desant !== null}
                  onClick={() => void desa(f)}>
                  {desant === f.codi ? t('c.saving') : t('c.save')}
                </Button>
              </div>
            )}
          </div>
        ))}
        {!potEditar && <p className="text-xs text-aviso">{t('set.only_super')}</p>}
      </CardContent>
    </Card>
  )
}
