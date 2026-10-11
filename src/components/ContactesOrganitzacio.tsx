// Las personas de contacto de la organización (revisión del 08-10-2026, §5.3): además de la
// persona principal de la ficha, las que haga falta, cada una con su función, teléfono,
// correo y tipo (general, administratiu, recollides…). Registros reutilizables, como los
// lugares de recogida. Uno solo para la ficha propia y la del equipo.

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { errorCorreu, errorTelefon, normalitzaTelefon } from '../lib/validacio'
import { carregaContactes, desaContacte, esborraContacte, TIPUS_CONTACTE, type Contacte } from '../lib/organitzacio'
import { useConfirma } from './DialegConfirma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const BUIT: Partial<Contacte> = { nom: '', carrec: '', telefon: '', email: '', tipus: 'general' }
const SELECT = 'h-11 w-full rounded-md border border-input bg-transparent px-3 text-base md:h-9 md:text-sm'

export default function ContactesOrganitzacio({ orgId, potEditar, idPrefix = 'ct' }: { orgId: string | null; potEditar: boolean; idPrefix?: string }) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [llista, setLlista] = useState<Contacte[]>([])
  const [error, setError] = useState(false)
  const [editant, setEditant] = useState<{ id: string | null; dades: Partial<Contacte> } | null>(null)
  const [ocupat, setOcupat] = useState(false)

  const carrega = useCallback(async () => {
    if (!orgId) return
    const r = await carregaContactes(orgId)
    if (!r.ok) { setError(true); return }
    setError(false)
    setLlista(r.data)
  }, [orgId])
  useEffect(() => { void carrega() }, [carrega])

  const desa = async () => {
    if (!editant || !orgId) return
    const d = editant.dades
    if (!String(d.nom ?? '').trim()) { toast.error(t('org.err_cal_nom')); return }
    const errTel = d.telefon ? errorTelefon(d.telefon) : null
    const errMail = d.email ? errorCorreu(d.email) : null
    if (errTel || errMail) { toast.error(t(errTel ?? errMail!)); return }
    setOcupat(true)
    const r = await desaContacte(editant.id, orgId, { ...d, telefon: d.telefon ? normalitzaTelefon(d.telefon) : null })
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    setEditant(null)
    void carrega()
  }

  const esborra = async (c: Contacte) => {
    if (!(await confirma({ titol: t('ct.del_t', { nom: c.nom }), confirmar: t('c.delete'), destructiu: true }))) return
    const r = await esborraContacte(c.id)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    void carrega()
  }

  if (!orgId) return null
  const set = (k: keyof Contacte, v: string) => setEditant((e) => e && { ...e, dades: { ...e.dades, [k]: v } })

  return (
    <div className="space-y-3" data-testid="contactes-org">
      {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
      {!error && llista.length === 0 && !editant && <p className="text-sm text-muted-foreground">{t('ct.buit')}</p>}
      {llista.map((c) => (
        <div key={c.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{c.nom}{c.carrec ? ` · ${c.carrec}` : ''}</p>
            <p className="text-muted-foreground">
              {t(`ct.t_${c.tipus}`)}
              {c.telefon ? ` · +${c.telefon}` : ''}{c.email ? ` · ${c.email}` : ''}
            </p>
          </div>
          {potEditar && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-11 md:h-8" aria-label={t('ct.edit')}
                onClick={() => setEditant({ id: c.id, dades: { ...c } })}><Pencil className="size-4" /></Button>
              <Button size="sm" variant="ghost" className="h-11 md:h-8" aria-label={t('c.delete')}
                onClick={() => void esborra(c)}><Trash2 className="size-4" /></Button>
            </div>
          )}
        </div>
      ))}
      {editant && (
        <div className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-nom`} className="text-xs text-muted-foreground">{t('ct.f_nom')}</Label>
            <Input id={`${idPrefix}-nom`} value={editant.dades.nom ?? ''} onChange={(e) => set('nom', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-carrec`} className="text-xs text-muted-foreground">{t('ct.f_carrec')}</Label>
            <Input id={`${idPrefix}-carrec`} value={editant.dades.carrec ?? ''} onChange={(e) => set('carrec', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-tel`} className="text-xs text-muted-foreground">{t('org.f_telefon')}</Label>
            <Input id={`${idPrefix}-tel`} type="tel" inputMode="tel" value={editant.dades.telefon ?? ''} onChange={(e) => set('telefon', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-mail`} className="text-xs text-muted-foreground">{t('f.email')}</Label>
            <Input id={`${idPrefix}-mail`} type="email" value={editant.dades.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-tipus`} className="text-xs text-muted-foreground">{t('ct.f_tipus')}</Label>
            <select id={`${idPrefix}-tipus`} className={SELECT} value={editant.dades.tipus ?? 'general'}
              onChange={(e) => set('tipus', e.target.value)}>
              {TIPUS_CONTACTE.map((tp) => <option key={tp} value={tp}>{t(`ct.t_${tp}`)}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button className="h-11 md:h-9" disabled={ocupat} onClick={() => void desa()}>{t('c.save')}</Button>
            <Button variant="outline" className="h-11 md:h-9" disabled={ocupat} onClick={() => setEditant(null)}>{t('c.cancel')}</Button>
          </div>
        </div>
      )}
      {potEditar && !editant && (
        <Button variant="outline" className="h-11 md:h-9" onClick={() => setEditant({ id: null, dades: { ...BUIT } })}>
          <Plus className="size-4" /> {t('ct.add')}
        </Button>
      )}
      {dialeg}
    </div>
  )
}
