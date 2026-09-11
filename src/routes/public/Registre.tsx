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
import { CheckCircle2 } from 'lucide-react'
import { supabaseUrl } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useSessio } from '../../hooks/useSessio'
import type { TipusReceptor } from '../../lib/rols'
import LayoutAcces, { ComprovantSessio } from '../../components/LayoutAcces'
import { BotoUll } from '../../components/FormulariAcces'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

/** Los CTA de la landing dicen «entitat»; dentro se llama «receptor». */
function rolDeLaUrl(valor: string | null): RolRegistre {
  return valor === 'entitat' || valor === 'receptor' ? 'receptor' : 'productor'
}

export default function Registre() {
  const { t } = useT()
  const { session, carregant } = useSessio()
  const [params] = useSearchParams()

  const [rol, setRol] = useState<RolRegistre>(() => rolDeLaUrl(params.get('rol')))
  const [tipusReceptor, setTipusReceptor] = useState<TipusReceptor | ''>('')
  const [organitzacio, setOrganitzacio] = useState('')
  const [persona, setPersona] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [telefon, setTelefon] = useState('')
  const [poblacio, setPoblacio] = useState('')
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
    if (rol === 'receptor' && !tipusReceptor) {
      setError(t('reg.tipus_required'))
      return
    }
    if (password.length < 6) {
      setError(t('login.pw_short'))
      return
    }
    // Mismo criterio que el servidor y que el resto de la app (§7: E.164 sin '+').
    // Se comprueba aquí para que el error salga en el idioma de la interfaz.
    const telNet = telefon.replace(/\D/g, '')
    if (telNet && !/^[1-9]\d{6,14}$/.test(telNet)) {
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
          rol,
          nom_organitzacio: organitzacio.trim(),
          nom_persona: persona.trim(),
          email: email.trim(),
          password,
          telefon: telNet || null,
          poblacio: poblacio.trim() || null,
          tipo_receptor: rol === 'receptor' ? tipusReceptor : null,
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
              <Tabs value={rol} onValueChange={(v) => { setRol(v as RolRegistre); setError(null) }}>
                {/* Las dos pastillas NO pueden depender de lo larga que sea su etiqueta.
                    Medido a 320 px: la pastilla da 114 px de hueco y «Entitat receptora»
                    ocupa 111,14 px, o sea que el `px-2` de la pestaña ya está consumido
                    entero y quedan 2,9 px hasta el borde. No desborda la página —el
                    `grid-cols-2` de Tailwind es `minmax(0,1fr)` y la columna no crece— pero
                    cualquier traducción más larga se sale del botón.
                    El arreglo no es acortar el texto: se le quita el `whitespace-nowrap`
                    que trae `TabsTrigger` de serie y se deja que la lista crezca a lo alto
                    (`h-auto`), así una etiqueta larga rompe a dos líneas en vez de
                    desbordar. `min-w-0` es lo que permite al botón encoger por debajo de su
                    contenido; `min-h-11` mantiene los 44 px de área táctil en móvil. */}
                <TabsList className="grid w-full grid-cols-2 group-data-[orientation=horizontal]/tabs:h-auto">
                  <TabsTrigger
                    value="productor"
                    className="h-auto min-h-11 min-w-0 py-2 text-center leading-tight whitespace-normal md:min-h-9"
                  >
                    {t('reg.rol_prod')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="receptor"
                    className="h-auto min-h-11 min-w-0 py-2 text-center leading-tight whitespace-normal md:min-h-9"
                  >
                    {t('reg.rol_ent')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {rol === 'receptor' && (
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

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="tel">{t('reg.phone')}</Label>
                <Input id="tel" type="tel" value={telefon} onChange={(e) => setTelefon(e.target.value)} autoComplete="tel" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pob">{t('reg.town')}</Label>
                <Input id="pob" value={poblacio} onChange={(e) => setPoblacio(e.target.value)} />
              </div>
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
