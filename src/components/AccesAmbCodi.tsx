// Entrar con el código de 6 cifras, sin contraseña.
//
// 🔴 POR QUÉ EXISTE (16-09-2026). `enviar-acceso` lleva desde julio prometiendo este código
//    —«entra a redestina.carlessanz.com, escriu el teu correu i fes servir aquest codi»— y
//    **no había ninguna pantalla donde escribirlo**: cero referencias a `verifyOtp` en toda
//    la aplicación. Lo vio el cliente al recibir el correo y preguntar dónde se usaba.
//
// 🔴 Y NO ERA SOLO EL CORREO, que al menos trae el enlace al lado. **Por WhatsApp se manda
//    EL CÓDIGO Y NADA MÁS**, a propósito: un enlace mágico es una credencial al portador y
//    `sendText()` guarda el cuerpo en `wa_messages`, que el equipo lee desde Mensajería
//    (§9). O sea que esa vía de acceso entera estaba rota — se mandaba un código que no
//    tenía dónde usarse.
//
// ⚠️ NO ES UN SEGUNDO SISTEMA DE LOGIN. El código lo emite Supabase Auth
//    (`admin.generateLink` devuelve `email_otp` junto al enlace) y aquí se canjea con
//    `verifyOtp`, que es la pareja de esa misma llamada. La sesión que sale es idéntica a
//    la del enlace: no hay nada que mantener aparte.
//
// ⚠️ EL CORREO ES PARTE DE LA CREDENCIAL, no un campo de más. Un código de seis cifras solo
//    vale contra la dirección a la que se envió; pedirlo es lo que impide probar seis cifras
//    contra cualquier cuenta.

import { useState } from 'react'
import type { FormEvent } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function AccesAmbCodi() {
  const { t } = useT()
  const [obert, setObert] = useState(false)
  const [email, setEmail] = useState('')
  const [codi, setCodi] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)

  async function entra(e: FormEvent) {
    e.preventDefault()
    if (ocupat) return
    setOcupat(true)
    setError(null)
    // `type: 'email'` es el que corresponde a un `magiclink` generado con la Admin API.
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: codi.replace(/\D/g, ''),
      type: 'email',
    })
    setOcupat(false)
    // Un mensaje único para «código malo», «caducado» y «correo que no cuadra»: decir cuál
    // de los tres es le diría a quien prueba a ciegas si ese correo existe.
    if (err) { setError(t('codi.err')); return }
    // Con sesión, `ArrelApp` se encarga del resto: no hace falta navegar desde aquí.
  }

  // ⚠️ ESTO VIVE SOBRE EL VERDE DE `LayoutAcces`, y esa es toda la razón de lo que sigue.
  //    La primera versión pintaba el formulario suelto, con `border-input` y
  //    `text-muted-foreground`: tokens pensados para fondo claro, que sobre el verde
  //    quedaban gris oscuro sobre verde oscuro — ilegible. Va DENTRO de una `Card` igual
  //    que el formulario de contraseña de arriba, y el enlace plegado en claro.
  if (!obert) {
    return (
      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => setObert(true)}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary-foreground/90 underline underline-offset-4 hover:text-primary-foreground"
        >
          <KeyRound className="size-4" aria-hidden />
          {t('codi.obrir')}
        </button>
      </div>
    )
  }

  return (
    <Card className="mt-4 rounded-2xl">
      <CardContent className="pt-6">
        <form className="grid gap-3" onSubmit={entra}>
          <p className="text-sm text-muted-foreground">{t('codi.ajuda')}</p>
          <div className="grid gap-1.5">
            <Label htmlFor="codi-email">{t('login.email')}</Label>
            <Input id="codi-email" type="email" autoComplete="username" required
              value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="codi-codi">{t('codi.camp')}</Label>
            {/* `one-time-code` es lo que hace que iOS lo ofrezca desde el teclado al copiarlo. */}
            <Input id="codi-codi" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              required className="tabular-nums tracking-[0.3em]"
              value={codi} onChange={(e) => { setCodi(e.target.value.replace(/\D/g, '')); setError(null) }} />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <Button type="submit" className="h-11 w-full whitespace-normal"
            disabled={ocupat || codi.length < 6 || email.trim() === ''}>
            {ocupat && <Loader2 className="size-4 animate-spin" />}
            {ocupat ? t('c.sending') : t('codi.entra')}
          </Button>
          {/* Poder cerrarlo: quien lo abre por curiosidad se queda con dos formularios de
              correo a la vista, y eso confunde más que ayuda. */}
          <button type="button" onClick={() => setObert(false)}
            className="min-h-11 text-sm text-muted-foreground underline underline-offset-4 md:min-h-0">
            {t('c.cancel')}
          </button>
        </form>
      </CardContent>
    </Card>
  )
}
