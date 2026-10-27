// Configuració › General: la validación previa de ofertas y el idioma. (El modo test pasó a
// Notificacions el 27-10-2026: decide a quién se envía, que es parte de las notificaciones.)

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import type { Lang } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { getValidacioOfertes, setValidacioOfertes } from '../../lib/settings'
import Interruptor from './Interruptor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SeccioGeneral({ potCanviar }: { potCanviar: boolean }) {
  const { t, lang, setLang } = useT()
  // Escribir en `app_settings` exige `es_super_admin()`. Al resto del equipo se le deja
  // el interruptor gris CON el motivo, en vez de dejarle pulsar y que no se guarde nada.
  const motiu = potCanviar ? undefined : t('set.only_super')
  const [validacio, setValidacio] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getValidacioOfertes().then(setValidacio)
  }, [])

  /** El interruptor de validación previa de ofertas (05-10-2026). Sin confirmación: es reversible. */
  async function cambiarValidacio(activa: boolean) {
    if (activa === validacio || saving) return
    setSaving(true)
    const error = await setValidacioOfertes(activa)
    setSaving(false)
    if (error) { toast.error(t(error)); return }
    setValidacio(activa)
    toast.success(activa ? t('set.val_saved_on') : t('set.val_saved_off'))
  }

  return (
    <div className="space-y-6">
      {/* El modo test vive en la pestaña Notificacions desde el 27-10-2026: decide A QUIÉN se
          envía, y es el tercer paso de «notificaciones → canal → destinatarios». */}
      {/* Validación previa de las ofertas que publica el productor (05-10-2026). */}
      <Interruptor
        titol={t('set.val_title')}
        actiu={validacio}
        descripcio={validacio ? t('set.val_on_desc') : t('set.val_off_desc')}
        onCanvia={(a) => void cambiarValidacio(a)}
        bloquejat={saving || !potCanviar}
        motiu={motiu}
      />

      {/* Idioma */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('set.language')}</CardTitle></CardHeader>
        <CardContent>
          <div className="inline-flex rounded-md border p-0.5">
            {(['ca', 'es'] as Lang[]).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)}
                className={cn('rounded px-4 py-1.5 text-sm font-semibold transition-colors',
                  lang === l ? 'bg-secondary text-primary' : 'text-muted-foreground hover:bg-muted')}>
                {l === 'ca' ? 'Català' : 'Castellano'}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
