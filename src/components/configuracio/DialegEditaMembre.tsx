// Editar una cuenta del equipo (09-11-2026): nombre y teléfono. El correo NO se cambia desde aquí:
// es el de acceso y se toca por la Admin API, no por una RPC (`editar_membre_equip()`).
//
// El formulario es un componente aparte con `key` por cuenta: así se reinicia solo al abrir otra,
// sin un efecto que copie props a estado (y sin definir un componente dentro de otro, §7).

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { clauErrorEquip, normalitzaTelefon, telefonValid, type MembreEquip } from '../../lib/equip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

function Formulari({ membre, onTanca, onFet }: { membre: MembreEquip; onTanca: () => void; onFet: () => void }) {
  const { t } = useT()
  const [nom, setNom] = useState(membre.nom ?? '')
  const [telefon, setTelefon] = useState(membre.telefon ?? '')
  const [ocupat, setOcupat] = useState(false)
  const telOk = telefonValid(telefon)
  const qui = membre.nom || membre.email || ''

  async function desa() {
    if (!telOk || ocupat) return
    setOcupat(true)
    const { error } = await supabase.rpc('editar_membre_equip', {
      p_user: membre.user_id,
      p_nom: nom,
      p_telefon: normalitzaTelefon(telefon),
    })
    setOcupat(false)
    if (error) { toast.error(t(clauErrorEquip(error.message))); return }
    toast.success(t('eq.ok_edita', { email: membre.email ?? qui }))
    onFet()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="[overflow-wrap:anywhere]">{t('eq.ed_t', { qui })}</DialogTitle>
        <DialogDescription>{t('eq.ed_correu_nota')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="eq-ed-nom">{t('eq.ed_nom')}</Label>
          <Input id="eq-ed-nom" value={nom} maxLength={120} autoComplete="off" onChange={(e) => setNom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eq-ed-tel">{t('eq.ed_telefon')}</Label>
          <Input
            id="eq-ed-tel" value={telefon} inputMode="tel" autoComplete="off" aria-invalid={!telOk}
            onChange={(e) => setTelefon(e.target.value)}
          />
          {!telOk && <p className="text-xs text-error" role="alert">{t('eq.e_telefon_invalid')}</p>}
        </div>
      </div>
      <DialogFooter className="flex-col gap-2 sm:flex-row">
        <Button variant="outline" className="h-11 md:h-8" onClick={onTanca}>{t('c.cancel')}</Button>
        <Button className="h-11 md:h-8" disabled={!telOk || ocupat} onClick={() => void desa()} data-testid="eq-ed-desa">
          {t('eq.ed_desa')}
        </Button>
      </DialogFooter>
    </>
  )
}

export default function DialegEditaMembre({ membre, onTanca, onFet }: {
  membre: MembreEquip | null
  onTanca: () => void
  onFet: () => void
}) {
  return (
    <Dialog open={membre !== null} onOpenChange={(o) => { if (!o) onTanca() }}>
      <DialogContent className="grid-cols-[minmax(0,1fr)]" data-testid="eq-ed-dialeg">
        {membre && <Formulari key={membre.user_id} membre={membre} onTanca={onTanca} onFet={onFet} />}
      </DialogContent>
    </Dialog>
  )
}
