// Formulario de acceso: entrar y pedir el enlace de recuperación.
//
// Sale tal cual del antiguo AuthGate, con un solo cambio de fondo: no navega. Quien lo
// monta (/login o /admin) observa la sesión y decide adónde ir, de modo que el mismo
// componente sirve para «acabo de entrar» y para «ya venía con sesión».
//
// El copy es un parámetro a propósito: /admin conserva el de siempre («Consola Redestina ·
// accés restringit a l'equip») y /login estrena el suyo para productores y entidades.

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, supabaseUrl } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Botón de mostrar/ocultar contraseña. Lo comparten el login, el registro y el reset. */
export function BotoUll({ vist, onToggle }: { vist: boolean; onToggle: () => void }) {
  const { t } = useT()
  // El icono mide 16px: sin relleno, la zona pulsable eran 16×16 px y era el peor
  // objetivo táctil de la aplicación. El `p-2` la lleva a 32×32 sin mover el icono de
  // sitio (el `right-1` compensa el relleno nuevo).
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground hover:text-foreground"
      tabIndex={-1}
      aria-label={vist ? t('login.hide') : t('login.show')}
    >
      {vist ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  )
}

export default function FormulariAcces({ titol, subtitol }: { titol: string; subtitol: string }) {
  const { t } = useT()
  const [modo, setModo] = useState<'login' | 'recuperar'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setOcupado(false)
    if (authError) {
      setError(authError.message === 'Invalid login credentials' ? t('login.bad_creds') : authError.message)
      setPassword('')
    }
  }

  async function solicitarRecuperacion(e: FormEvent) {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true)
    setError(null)
    await fetch(`${supabaseUrl}/functions/v1/recuperar-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => null)
    setOcupado(false)
    toast.success(t('login.recover_sent'))
    setModo('login')
  }

  if (modo === 'recuperar') {
    return (
      <Card className="rounded-2xl">
        <CardHeader><CardTitle>{t('login.recover_title')}</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={solicitarRecuperacion}>
            <div className="grid gap-2">
              <Label htmlFor="re">{t('login.email')}</Label>
              <Input id="re" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
            </div>
            <Button type="submit" disabled={ocupado || !email.trim()}>
              {ocupado ? t('c.sending') : t('login.send_link')}
            </Button>
            <button type="button" className="text-sm text-muted-foreground underline"
              onClick={() => { setModo('login'); setError(null) }}>
              {t('login.back_login')}
            </button>
          </form>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{titol}</CardTitle>
        <p className="text-sm text-muted-foreground">{subtitol}</p>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={entrar}>
          <div className="grid gap-2">
            <Label htmlFor="em">{t('login.email')}</Label>
            <Input id="em" type="email" value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null) }}
              autoComplete="username" autoFocus required />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="pw">{t('login.password')}</Label>
              <button type="button" className="text-xs text-muted-foreground underline"
                onClick={() => { setModo('recuperar'); setError(null) }}>
                {t('login.forgot')}
              </button>
            </div>
            <div className="relative">
              <Input id="pw" type={verPassword ? 'text' : 'password'} value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null) }}
                autoComplete="current-password" required className="pr-9" />
              <BotoUll vist={verPassword} onToggle={() => setVerPassword((v) => !v)} />
            </div>
          </div>
          <Button type="submit" disabled={ocupado || !email.trim() || !password}>
            {ocupado ? t('login.entering') : t('login.enter')}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  )
}
