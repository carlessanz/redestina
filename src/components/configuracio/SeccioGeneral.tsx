// Configuració › General: el modo test, la validación previa de ofertas y el idioma.

import { useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import type { Lang } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { getTestMode, getValidacioOfertes, setTestMode, setValidacioOfertes } from '../../lib/settings'
import { useConfirma } from '../DialegConfirma'
import Interruptor from './Interruptor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SeccioGeneral({ potCanviar }: { potCanviar: boolean }) {
  const { t, lang, setLang } = useT()
  const { confirma, dialeg } = useConfirma()
  // Escribir en `app_settings` exige `es_super_admin()`. Al resto del equipo se le deja
  // el interruptor gris CON el motivo, en vez de dejarle pulsar y que no se guarde nada.
  const motiu = potCanviar ? undefined : t('set.only_super')
  const [testMode, setTest] = useState<boolean | null>(null)
  const [validacio, setValidacio] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getTestMode().then(setTest)
    void getValidacioOfertes().then(setValidacio)
  }, [])

  async function cambiarTestMode(activo: boolean) {
    if (activo === testMode || saving) return
    // Apagarlo es sensible: pasa a enviarse a TODOS. Confirmación explícita.
    if (!activo && !(await confirma({
      titol: t('set.confirm_off_t'),
      descripcio: t('set.confirm_off'),
      confirmar: t('set.turn_off'),
      destructiu: true,
    }))) return
    setSaving(true)
    const error = await setTestMode(activo)
    setSaving(false)
    if (error) { toast.error(t(error)); return }
    setTest(activo)
    toast.success(activo ? t('set.saved_on') : t('set.saved_off'))
  }

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
      {/* Modo test: la garantía de no enviar a usuarios que no sean de prueba. */}
      <Interruptor
        titol={t('set.test_mode')}
        actiu={testMode}
        estat={{
          on: t('set.test_on'), onDesc: t('set.test_on_desc'),
          off: t('set.test_off'), offDesc: t('set.test_off_desc'),
          iconaOn: ShieldCheck, iconaOff: ShieldAlert, toOff: 'error',
        }}
        onCanvia={(a) => void cambiarTestMode(a)}
        bloquejat={saving || !potCanviar}
        motiu={motiu}
        ajuda={t('set.test_help')}
      />

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

      {dialeg}
    </div>
  )
}
