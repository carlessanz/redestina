// EL formulario de alta de una organización con su cuenta. Uno solo para dos sitios, con el
// patrón de `FirmaConveni` (27-10-2026):
//   · `public`   — `/registre`: la persona se da de alta sola y espera a que el equipo valide.
//   · `assistit` — el diálogo «Nova organització amb compte» del equipo: la cuenta nace
//                  APROBADA y las casillas RGPD dicen «la persona ha acceptat…», porque las
//                  declara el equipo en su nombre (modelo asistido, §1bis).
//
// Los dos llaman al MISMO alta en el servidor (`registro/alta.ts`), por dos puertas:
// `registro` (pública, con anti-abuso) y `alta-assistida` (con sesión y `pot_aprovar`).
//
// RGPD. La privacidad es obligatoria; las dos comunicaciones (plataforma y Espigoladors),
// opcionales y sin marcar. El texto de cada casilla es EXACTAMENTE el que el servidor
// recompone y hashea (`textosRgpd.ts`, copia comprobada por test): lo que se lee aquí es lo
// que queda como evidencia. NO condicionan ninguna notificación operativa (§8).

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { Check } from 'lucide-react'
import { supabase, supabaseUrl } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { cn } from '../lib/utils'
import type { TipusReceptor } from '../lib/rols'
import { textConsentiment, type TipusConsentiment } from '../lib/textosRgpd'
import { BotoUll } from './FormulariAcces'
import { FilaCasella } from './Casella'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export type RolRegistre = 'productor' | 'receptor'

const TIPUS: { valor: TipusReceptor; clau: string }[] = [
  { valor: 'social', clau: 'reg.tr_social' },
  { valor: 'animal', clau: 'reg.tr_animal' },
  { valor: 'transformador', clau: 'reg.tr_transformador' },
  { valor: 'comercial', clau: 'reg.tr_comercial' },
]

export interface AltaFeta {
  /** El alta coincide con una organización que ya consta: el equipo la revisará. */
  revisio: boolean
  email: string
  /** Solo en `assistit`: si hay que mandar el acceso ahora. */
  enviaAcces: boolean
  /**
   * Los convenios en borrador que el alta ha preparado (uno por papel). Con ellos el alta
   * asistida ofrece darlos por vigentes al momento (gestión autónoma, fase 1).
   */
  convenis: { id: string; tipo: string }[]
}

interface Props {
  mode: 'public' | 'assistit'
  rolsInicials: RolRegistre[]
  onFet: (r: AltaFeta) => void
  /** Prefijo de los `id` de los campos, para que dos formularios no compartan ids. */
  idPrefix?: string
}

export default function FormulariAlta({ mode, rolsInicials, onFet, idPrefix = 'reg' }: Props) {
  const { t, lang } = useT()
  const assistit = mode === 'assistit'
  const id = (s: string) => `${idPrefix}-${s}`

  const [rols, setRols] = useState<RolRegistre[]>(rolsInicials)
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
  const [consentiments, setConsentiments] = useState<Record<TipusConsentiment, boolean>>({
    privacitat: false, comunicacions_plataforma: false, comunicacions_espigoladors: false,
  })
  // Solo del alta asistida.
  const [esTest, setEsTest] = useState(false)
  const [enviaAcces, setEnviaAcces] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)

  const marca = (tipus: TipusConsentiment, v: boolean) => {
    setConsentiments((c) => ({ ...c, [tipus]: v }))
    setError(null)
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (ocupat) return
    if (rols.length === 0) { setError(t('reg.rol_required')); return }
    if (rols.includes('receptor') && !tipusReceptor) { setError(t('reg.tipus_required')); return }
    if (password.length < 6) { setError(t('login.pw_short')); return }
    if (password !== password2) { setError(t('reg.pw_mismatch')); return }
    // Mismo criterio que el servidor y que el resto de la app (§7: E.164 sin '+').
    // 🔴 OBLIGATORIO desde el 16-09-2026: sin teléfono, WhatsApp no alcanza a esa organización.
    const telNet = telefon.replace(/\D/g, '')
    if (!telNet) { setError(t('reg.err_telefon_cal')); return }
    if (!/^[1-9]\d{6,14}$/.test(telNet)) { setError(t('reg.err_telefon')); return }
    if (!consentiments.privacitat) { setError(t('rgpd.err_privacitat')); return }
    setOcupat(true)
    setError(null)

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (assistit) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { setOcupat(false); setError(t('c.error')); return }
        headers.Authorization = `Bearer ${session.access_token}`
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/${assistit ? 'alta-assistida' : 'registro'}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          rols,
          nom_organitzacio: organitzacio.trim(),
          nom_persona: persona.trim(),
          email: email.trim(),
          password,
          telefon: telNet,
          tipo_receptor: rols.includes('receptor') ? tipusReceptor : null,
          accepta_privacitat: consentiments.privacitat,
          comunicacions_plataforma: consentiments.comunicacions_plataforma,
          comunicacions_espigoladors: consentiments.comunicacions_espigoladors,
          // El idioma en que se han leído las declaraciones: el servidor las recompone en ese.
          idioma: lang,
          ...(assistit ? { es_test: esTest } : { web: parany }),
        }),
      })
      const dades = (await res.json().catch(() => null)) as
        { code?: string; error?: string; revisio_equip?: boolean; camp?: string; convenis?: { id: string; tipo: string }[] } | null
      setOcupat(false)
      if (res.ok) {
        onFet({
          revisio: dades?.revisio_equip === true, email: email.trim(), enviaAcces: assistit && enviaAcces,
          convenis: (Array.isArray(dades?.convenis) ? dades?.convenis ?? [] : []).filter((c) => c && typeof c.id === 'string'),
        })
        return
      }
      const claus: Record<string, string> = {
        email_ja_registrat: 'reg.err_exists',
        dades_en_us: 'reg.err_dades',
        massa_solicituds: 'reg.err_massa',
        nif_invalid: 'val.nif_control',
        forbidden: 'appr.need_approver',
      }
      const clau = dades?.camp === 'accepta_privacitat' ? 'rgpd.err_privacitat' : claus[dades?.code ?? '']
      // Si el servidor rechaza un campo que aquí no se ha validado, su mensaje dice cuál.
      setError(clau ? t(clau) : textError(t, dades?.error))
    } catch {
      setOcupat(false)
      setError(t('c.error'))
    }
  }

  return (
    <form className="grid grid-cols-1 gap-4" onSubmit={enviar}>
      <div className="grid gap-2">
        <Label>{t('reg.rol_label')}</Label>
        {/* DOS CONMUTADORES, NO UNAS PESTAÑAS: se pueden marcar los dos papeles (16-09-2026).
            Botones con `aria-pressed`; `min-w-0` y `min-h-11` medidos a 320 px. */}
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
                  setRols((prev) => prev.includes(valor) ? prev.filter((r) => r !== valor) : [...prev, valor])
                  setError(null)
                }}
                className={cn(
                  'flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-center text-sm leading-tight whitespace-normal transition-colors md:min-h-9',
                  actiu ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background hover:bg-accent',
                )}
              >
                {actiu && <Check className="size-4 shrink-0" aria-hidden />}
                {t(clau)}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t('reg.rol_help')}</p>
      </div>

      {rols.includes('receptor') && (
        <div className="grid gap-2">
          <Label htmlFor={id('tr')}>{t('reg.tipus_label')}</Label>
          <Select value={tipusReceptor} onValueChange={(v) => { setTipusReceptor(v as TipusReceptor); setError(null) }}>
            <SelectTrigger id={id('tr')} className="w-full text-base md:text-sm"><SelectValue placeholder={t('reg.tipus_ph')} /></SelectTrigger>
            <SelectContent>
              {TIPUS.map((tp) => (
                <SelectItem key={tp.valor} value={tp.valor}>{t(tp.clau)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor={id('org')}>{t('reg.org')}</Label>
        <Input id={id('org')} value={organitzacio} onChange={(e) => { setOrganitzacio(e.target.value); setError(null) }} required />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id('per')}>{t('reg.person')}</Label>
        <Input id={id('per')} value={persona} onChange={(e) => { setPersona(e.target.value); setError(null) }}
          autoComplete={assistit ? 'off' : 'name'} required />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id('tel')}>{t('reg.phone')}</Label>
        <Input id={id('tel')} type="tel" inputMode="tel" value={telefon}
          onChange={(e) => { setTelefon(e.target.value); setError(null) }}
          autoComplete={assistit ? 'off' : 'tel'} required />
        <p className="text-xs text-muted-foreground">{t('reg.phone_hint')}</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id('em')}>{t('login.email')}</Label>
        <Input id={id('em')} name={assistit ? undefined : 'email'} type="email" value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null) }}
          autoComplete={assistit ? 'off' : 'username'} required />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id('pw')}>{t(assistit ? 'alta.pw_inicial' : 'login.password')}</Label>
        <div className="relative">
          {/* En el alta asistida, `autoComplete="off"`: el gestor de contraseñas de quien está
              delante es el del equipo, y no debe guardar la de otra persona. */}
          <Input id={id('pw')} name={assistit ? undefined : 'new-password'} type={verPassword ? 'text' : 'password'} value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null) }}
            autoComplete={assistit ? 'off' : 'new-password'} required className="pr-9" />
          <BotoUll vist={verPassword} onToggle={() => setVerPassword((v) => !v)} />
        </div>
        {assistit && <p className="text-xs text-muted-foreground">{t('alta.pw_help')}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id('pw2')}>{t('reg.pw_confirm')}</Label>
        <Input id={id('pw2')} name={assistit ? undefined : 'confirm-password'} type={verPassword ? 'text' : 'password'} value={password2}
          onChange={(e) => { setPassword2(e.target.value); setError(null) }}
          autoComplete={assistit ? 'off' : 'new-password'} required
          aria-invalid={password2 !== '' && password !== password2} />
        {password2 !== '' && password !== password2 && (
          <p className="text-xs text-error">{t('reg.pw_mismatch')}</p>
        )}
      </div>

      {/* RGPD, junto a la contraseña. La privacidad es obligatoria; las comunicaciones, no. */}
      <fieldset className="grid gap-1 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t('rgpd.title')}</legend>
        <FilaCasella checked={consentiments.privacitat} onChange={(v) => marca('privacitat', v)}>
          {textConsentiment('privacitat', lang, assistit)}{' '}
          <Link to="/privacitat" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
            {t('rgpd.llegeix')}
          </Link>
        </FilaCasella>
        <FilaCasella checked={consentiments.comunicacions_plataforma} onChange={(v) => marca('comunicacions_plataforma', v)}>
          {textConsentiment('comunicacions_plataforma', lang, assistit)}
        </FilaCasella>
        <FilaCasella checked={consentiments.comunicacions_espigoladors} onChange={(v) => marca('comunicacions_espigoladors', v)}>
          {textConsentiment('comunicacions_espigoladors', lang, assistit)}
        </FilaCasella>
        {/* Que no se confunda con los avisos del servicio: esos llegan igual (§8). */}
        <p className="text-xs text-muted-foreground">{t('rgpd.no_operatives')}</p>
      </fieldset>

      {assistit && (
        <div className="grid gap-1">
          <FilaCasella checked={esTest} onChange={setEsTest}>{t('alta.es_test')}</FilaCasella>
          <FilaCasella checked={enviaAcces} onChange={setEnviaAcces}>{t('alta.envia_acces')}</FilaCasella>
        </div>
      )}

      {/* Trampa para robots: una persona no ve este campo y por tanto no lo rellena. */}
      {!assistit && (
        <input type="text" name="web" value={parany} onChange={(e) => setParany(e.target.value)}
          tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      )}

      <Button type="submit" disabled={ocupat} className="whitespace-normal">
        {ocupat ? t('reg.submitting') : t(assistit ? 'alta.submit' : 'reg.submit')}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  )
}
