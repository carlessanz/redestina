// Nueva contraseña, tras seguir un enlace de recuperación.
//
// El enlace aterriza en la raíz (redirectTo = APP_URL) y supabase-js consume los tokens
// del hash; ArrelApp ve el evento PASSWORD_RECOVERY y trae aquí. Mientras esa marca esté
// puesta no se puede navegar a otro sitio: es una sesión abierta con una contraseña que
// alguien pidió cambiar. La salida sin cambiarla es cerrar sesión, que también la limpia.

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useSessio } from '../../hooks/useSessio'
import LayoutAcces, { ComprovantSessio } from '../../components/LayoutAcces'
import { BotoUll } from '../../components/FormulariAcces'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function RestablirClau() {
  const { t } = useT()
  const { session, carregant, netejaRecovery } = useSessio()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Sin sesión aquí significa enlace caducado o ya usado: el token no ha abierto nada.
  const caducat = !carregant && !session
  useEffect(() => {
    if (caducat) toast.error(t('login.recovery_expired'))
  }, [caducat, t])

  if (carregant) return <ComprovantSessio />
  if (!session) return <Navigate to="/login" replace />

  async function canviar(e: FormEvent) {
    e.preventDefault()
    if (ocupado) return
    if (password.length < 6) {
      setError(t('login.pw_short'))
      return
    }
    setOcupado(true)
    setError(null)
    const { error: updError } = await supabase.auth.updateUser({ password })
    setOcupado(false)
    if (updError) {
      // El mensaje de Supabase va en inglés y no se traduce: el genérico.
      setError(t('c.error'))
      return
    }
    toast.success(t('login.pw_updated'))
    netejaRecovery()
    void navigate('/panell', { replace: true })
  }

  return (
    <LayoutAcces>
      <Card className="rounded-2xl">
        <CardHeader><CardTitle>{t('login.new_password')}</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={canviar}>
            {/* El usuario, oculto: sin él, el gestor de contraseñas no sabe de qué cuenta es la
                contraseña nueva y no ofrece actualizarla. */}
            <input type="email" name="email" autoComplete="username" value={session.user.email ?? ''}
              readOnly hidden />
            <div className="grid gap-2">
              <Label htmlFor="np">{t('login.new_password')}</Label>
              <div className="relative">
                <Input id="np" name="new-password" type={verPassword ? 'text' : 'password'} value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null) }}
                  autoComplete="new-password" autoFocus required className="pr-9" />
                <BotoUll vist={verPassword} onToggle={() => setVerPassword((v) => !v)} />
              </div>
            </div>
            <Button type="submit" disabled={ocupado || !password}>
              {ocupado ? t('c.saving') : t('login.save_password')}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button type="button" className="text-sm text-muted-foreground underline"
              onClick={() => { netejaRecovery(); void supabase.auth.signOut() }}>
              {t('nav.logout')}
            </button>
          </form>
        </CardContent>
      </Card>
    </LayoutAcces>
  )
}
