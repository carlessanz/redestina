// `/registre` — alta self-service de una organización.
//
// No crea acceso: crea una solicitud. La Edge Function deja la cuenta, la ficha y una
// membresía PENDIENTE, y el equipo la valida desde Aprovacions. Por eso al terminar no se
// inicia sesión automáticamente: no habría nada que enseñar.
//
// El alta la hace el servidor con la clave de servicio porque `anon` no tiene ningún
// privilegio sobre las tablas (§9) y `enable_signup` sigue apagado a propósito.

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { Check, CheckCircle2 } from 'lucide-react'
import { supabaseUrl } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { useSessio } from '../../hooks/useSessio'
import type { TipusReceptor } from '../../lib/rols'
import LayoutAcces, { ComprovantSessio } from '../../components/LayoutAcces'
import { BotoUll } from '../../components/FormulariAcces'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type RolRegistre = 'productor' | 'receptor'

const TIPUS: { valor: TipusReceptor; clau: string }[] = [
  { valor: 'social', clau: 'reg.tr_social' },
  { valor: 'animal', clau: 'reg.tr_animal' },
  { valor: 'transformador', clau: 'reg.tr_transformador' },
  { valor: 'comercial', clau: 'reg.tr_comercial' },
]

/**
 * Los CTA de la landing dicen «entitat»; dentro se llama «receptor».
 *
 * ⚠️ DEVUELVE UNA LISTA, y desde el 16-09-2026 se pueden marcar LOS DOS. El selector era
 * un `Tabs`, que por definición deja elegir uno: una organización que genera excedente y
 * además recibe —seis de las que hay -- tenía que registrarse dos veces con dos correos
 * distintos y acababa con dos organizaciones que el equipo fusionaba a mano. Con dos
 * casillas, las dos fichas nacen bajo la misma `organizaciones`, que es justo lo que su
 * índice único parcial permite. La URL sigue preseleccionando una sola, que es lo que el
 * enlace de la landing significa.
 */
function rolsDeLaUrl(valor: string | null): RolRegistre[] {
  return valor === 'entitat' || valor === 'receptor' ? ['receptor'] : ['productor']
}

export default function Registre() {
  const { t } = useT()
  const { session, carregant } = useSessio()
  const [params] = useSearchParams()

  const [rols, setRols] = useState<RolRegistre[]>(() => rolsDeLaUrl(params.get('rol')))
  const [tipusReceptor, setTipusReceptor] = useState<TipusReceptor | ''>('')
  const [organitzacio, setOrganitzacio] = useState('')
  const [persona, setPersona] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [telefon, setTelefon] = useState('')
  // La confirmación NO viaja al servidor: es una guarda contra la errata, y comprobarla
  // allí no añadiría nada — quien manda el POST a mano puede mandar las dos iguales.
  const [password2, setPassword2] = useState('')
  const [parany, setParany] = useState('') // honeypot: si se rellena, no es una persona
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)
  const [fet, setFet] = useState(false)
  // La función distingue «alta normal» de «esta organización ya nos consta y estrena papel»
  // (§9). Las dos acaban en la misma pantalla porque las dos esperan al equipo, pero la
  // segunda le debe a la persona el motivo: si no, la espera parece la de todo el mundo.
  const [revisio, setRevisio] = useState(false)

  if (carregant) return <ComprovantSessio />
  if (session && !fet) return <Navigate to="/panell" replace />

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (ocupat) return
    if (rols.length === 0) {
      setError(t('reg.rol_required'))
      return
    }
    if (rols.includes('receptor') && !tipusReceptor) {
      setError(t('reg.tipus_required'))
      return
    }
    if (password.length < 6) {
      setError(t('login.pw_short'))
      return
    }
    if (password !== password2) {
      setError(t('reg.pw_mismatch'))
      return
    }
    // Mismo criterio que el servidor y que el resto de la app (§7: E.164 sin '+').
    // Se comprueba aquí para que el error salga en el idioma de la interfaz.
    //
    // 🔴 OBLIGATORIO desde el 16-09-2026: sin teléfono, WhatsApp —que es el canal principal
    //    del producto— no alcanza a esa organización, y la ficha nace muda sin que nada lo
    //    diga.
    const telNet = telefon.replace(/\D/g, '')
    if (!telNet) {
      setError(t('reg.err_telefon_cal'))
      return
    }
    if (!/^[1-9]\d{6,14}$/.test(telNet)) {
      setError(t('reg.err_telefon'))
      return
    }
    setOcupat(true)
    setError(null)

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/registro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rols,
          nom_organitzacio: organitzacio.trim(),
          nom_persona: persona.trim(),
          email: email.trim(),
          password,
          telefon: telNet,
          tipo_receptor: rols.includes('receptor') ? tipusReceptor : null,
          web: parany,
        }),
      })
      const dades = (await res.json().catch(() => null)) as
        { code?: string; error?: string; revisio_equip?: boolean } | null
      setOcupat(false)
      if (res.ok) {
        setRevisio(dades?.revisio_equip === true)
        setFet(true)
        return
      }
      const claus: Record<string, string> = {
        email_ja_registrat: 'reg.err_exists',
        dades_en_us: 'reg.err_dades',
        massa_solicituds: 'reg.err_massa',
      }
      const clau = claus[dades?.code ?? '']
      // Si el servidor rechaza un campo que aquí no se ha validado, su mensaje dice cuál:
      // es más útil que un «ha habido un error» que no deja arreglar nada.
      setError(clau ? t(clau) : (dades?.error ?? t('c.error')))
    } catch {
      setOcupat(false)
      setError(t('c.error'))
    }
  }

  if (fet) {
    return (
      <LayoutAcces ample>
        <Card className="rounded-2xl">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="mx-auto size-8 text-primary" />
            <h1 className="mt-3 text-lg font-semibold">{t('reg.ok_title')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('reg.ok_desc')}</p>
            {revisio && (
              <p className="mt-3 rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('reg.ok_revisio')}</p>
            )}
            <Button asChild className="mt-5 w-full">
              <Link to="/login">{t('reg.go_login')}</Link>
            </Button>
          </CardContent>
        </Card>
      </LayoutAcces>
    )
  }

  return (
    <LayoutAcces ample>
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>{t('reg.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('reg.subtitle')}</p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={enviar}>
            <div className="grid gap-2">
              <Label>{t('reg.rol_label')}</Label>
              {/* DOS CONMUTADORES, NO UNAS PESTAÑAS. Era un `Tabs`, que por definición deja
                  elegir uno solo; el requisito nuevo es poder ser las dos cosas. Se hace
                  con botones y `aria-pressed` en vez de traer `@radix-ui/react-checkbox`:
                  son dos opciones, el estado es una lista de dos valores y añadir una
                  dependencia para eso no se paga.

                  Se conservan las medidas del `Tabs` que había, que estaban tomadas y no
                  estimadas: a 320 px cada celda da 114 px de hueco y «Entitat receptora»
                  ocupa 111,14, o sea 2,9 px hasta el borde. Por eso NO hay
                  `whitespace-nowrap` y sí `min-w-0` —lo que permite encoger por debajo del
                  contenido— y `min-h-11`, los 44 px de área táctil en móvil (§12.34). */}
              <div className="grid w-full grid-cols-2 gap-2">
                {([
                  { valor: 'productor' as const, clau: 'reg.rol_prod' },
                  { valor: 'receptor' as const, clau: 'reg.rol_ent' },
                ]).map(({ valor, clau }) => {
                  const actiu = rols.includes(valor)
                  return (
                    <button
                      key={valor}
                      type="button"
                      aria-pressed={actiu}
                      onClick={() => {
                        setRols((prev) => prev.includes(valor)
                          ? prev.filter((r) => r !== valor)
                          : [...prev, valor])
                        setError(null)
                      }}
                      className={cn(
                        'flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-center text-sm leading-tight whitespace-normal transition-colors md:min-h-9',
                        actiu
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background hover:bg-accent',
                      )}
                    >
                      {actiu && <Check className="size-4 shrink-0" aria-hidden />}
                      {t(clau)}
                    </button>
                  )
                })}
              </div>
              {/* Que se puedan marcar las dos no es evidente mirando dos botones: se dice. */}
              <p className="text-xs text-muted-foreground">{t('reg.rol_help')}</p>
            </div>

            {rols.includes('receptor') && (
              <div className="grid gap-2">
                <Label htmlFor="tr">{t('reg.tipus_label')}</Label>
                <Select value={tipusReceptor} onValueChange={(v) => { setTipusReceptor(v as TipusReceptor); setError(null) }}>
                  <SelectTrigger id="tr"><SelectValue placeholder={t('reg.tipus_ph')} /></SelectTrigger>
                  <SelectContent>
                    {TIPUS.map((tp) => (
                      <SelectItem key={tp.valor} value={tp.valor}>{t(tp.clau)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="org">{t('reg.org')}</Label>
              <Input id="org" value={organitzacio} onChange={(e) => { setOrganitzacio(e.target.value); setError(null) }} required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="per">{t('reg.person')}</Label>
              <Input id="per" value={persona} onChange={(e) => { setPersona(e.target.value); setError(null) }}
                autoComplete="name" required />
            </div>

            {/* La POBLACIÓN ya no se pide aquí: se rellena después en la ficha, donde se
                elige de la lista real de municipios junto al domicilio y el código postal.
                En la puerta había que teclearla a mano, sin validar, y corregirla igual. */}
            <div className="grid gap-2">
              <Label htmlFor="tel">{t('reg.phone')} *</Label>
              <Input id="tel" type="tel" inputMode="tel" value={telefon}
                onChange={(e) => { setTelefon(e.target.value); setError(null) }}
                autoComplete="tel" required />
              {/* El prefijo es la trampa de este campo: a nueve dígitos la ficha queda
                  correcta y WhatsApp no llega nunca, sin ningún error que lo diga. */}
              <p className="text-xs text-muted-foreground">{t('reg.phone_hint')}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="rem">{t('login.email')}</Label>
              <Input id="rem" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }}
                autoComplete="username" required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="rpw">{t('login.password')}</Label>
              <div className="relative">
                <Input id="rpw" type={verPassword ? 'text' : 'password'} value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null) }}
                  autoComplete="new-password" required className="pr-9" />
                <BotoUll vist={verPassword} onToggle={() => setVerPassword((v) => !v)} />
              </div>
            </div>

            {/* Una contraseña mal tecleada en un alta no se descubre al momento —no hay
                «entrar» detrás— sino al intentar volver, y para entonces ya hay cuenta,
                ficha y membresía creadas. Por eso se confirma. */}
            <div className="grid gap-2">
              <Label htmlFor="rpw2">{t('reg.pw_confirm')}</Label>
              <Input id="rpw2" type={verPassword ? 'text' : 'password'} value={password2}
                onChange={(e) => { setPassword2(e.target.value); setError(null) }}
                autoComplete="new-password" required
                aria-invalid={password2 !== '' && password !== password2} />
              {password2 !== '' && password !== password2 && (
                <p className="text-xs text-error">{t('reg.pw_mismatch')}</p>
              )}
            </div>

            {/* Trampa para robots: una persona no ve este campo y por tanto no lo rellena. */}
            <input type="text" name="web" value={parany} onChange={(e) => setParany(e.target.value)}
              tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

            <Button type="submit" disabled={ocupat}>
              {ocupat ? t('reg.submitting') : t('reg.submit')}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-sm text-secondary/80">
        {t('reg.have_account')}{' '}
        <Link to="/login" className="font-medium text-secondary underline">{t('login.enter')}</Link>
      </p>
    </LayoutAcces>
  )
}
