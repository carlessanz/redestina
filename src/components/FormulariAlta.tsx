// EL formulario de alta de una organización con su cuenta: `/registre`, donde la persona se da
// de alta sola y espera a que el equipo valide. Llama a la función pública `registro` (con
// anti-abuso), que ejecuta el alta de `registro/alta.ts`.
//
// Hasta el 02-11-2026 tenía además un modo para el diálogo «Nova organització amb compte» del
// equipo (`alta-assistida`). Se retiró con la rebanada 1D del plan 1 (P1): el equipo da de alta
// en «Nova entitat», sin cuenta, y el acceso después con «Dona-li accés».
//
// RGPD. La privacidad es obligatoria; las dos comunicaciones (plataforma y Espigoladors),
// opcionales y sin marcar. El texto de cada casilla es EXACTAMENTE el que el servidor
// recompone y hashea (`textosRgpd.ts`, copia comprobada por test): lo que se lee aquí es lo
// que queda como evidencia. NO condicionan ninguna notificación operativa (§8).

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { Check } from 'lucide-react'
import { supabaseUrl } from '../lib/supabase'
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
}

interface Props {
  rolsInicials: RolRegistre[]
  onFet: (r: AltaFeta) => void
  /** Prefijo de los `id` de los campos, para que dos formularios no compartan ids. */
  idPrefix?: string
}

export default function FormulariAlta({ rolsInicials, onFet, idPrefix = 'reg' }: Props) {
  const { t, lang } = useT()
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
          accepta_privacitat: consentiments.privacitat,
          comunicacions_plataforma: consentiments.comunicacions_plataforma,
          comunicacions_espigoladors: consentiments.comunicacions_espigoladors,
          // El idioma en que se han leído las declaraciones: el servidor las recompone en ese.
          idioma: lang,
          web: parany,
        }),
      })
      const dades = (await res.json().catch(() => null)) as
        { code?: string; error?: string; revisio_equip?: boolean; camp?: string } | null
      setOcupat(false)
      if (res.ok) {
        onFet({ revisio: dades?.revisio_equip === true, email: email.trim() })
        return
      }
      const claus: Record<string, string> = {
        email_ja_registrat: 'reg.err_exists',
        dades_en_us: 'reg.err_dades',
        massa_solicituds: 'reg.err_massa',
        nif_invalid: 'val.nif_control',
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
          autoComplete="name" required />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id('tel')}>{t('reg.phone')}</Label>
        <Input id={id('tel')} type="tel" inputMode="tel" value={telefon}
          onChange={(e) => { setTelefon(e.target.value); setError(null) }}
          autoComplete="tel" required />
        <p className="text-xs text-muted-foreground">{t('reg.phone_hint')}</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id('em')}>{t('login.email')}</Label>
        <Input id={id('em')} name="email" type="email" value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null) }}
          autoComplete="username" required />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id('pw')}>{t('login.password')}</Label>
        <div className="relative">
          <Input id={id('pw')} name="new-password" type={verPassword ? 'text' : 'password'} value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null) }}
            autoComplete="new-password" required className="pr-9" />
          <BotoUll vist={verPassword} onToggle={() => setVerPassword((v) => !v)} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id('pw2')}>{t('reg.pw_confirm')}</Label>
        <Input id={id('pw2')} name="confirm-password" type={verPassword ? 'text' : 'password'} value={password2}
          onChange={(e) => { setPassword2(e.target.value); setError(null) }}
          autoComplete="new-password" required
          aria-invalid={password2 !== '' && password !== password2} />
        {password2 !== '' && password !== password2 && (
          <p className="text-xs text-error">{t('reg.pw_mismatch')}</p>
        )}
      </div>

      {/* RGPD, junto a la contraseña. La privacidad es obligatoria; las comunicaciones, no. */}
      <fieldset className="grid gap-1 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t('rgpd.title')}</legend>
        <FilaCasella checked={consentiments.privacitat} onChange={(v) => marca('privacitat', v)}>
          {textConsentiment('privacitat', lang)}{' '}
          <Link to="/privacitat" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
            {t('rgpd.llegeix')}
          </Link>
        </FilaCasella>
        <FilaCasella checked={consentiments.comunicacions_plataforma} onChange={(v) => marca('comunicacions_plataforma', v)}>
          {textConsentiment('comunicacions_plataforma', lang)}
        </FilaCasella>
        <FilaCasella checked={consentiments.comunicacions_espigoladors} onChange={(v) => marca('comunicacions_espigoladors', v)}>
          {textConsentiment('comunicacions_espigoladors', lang)}
        </FilaCasella>
        {/* Que no se confunda con los avisos del servicio: esos llegan igual (§8). */}
        <p className="text-xs text-muted-foreground">{t('rgpd.no_operatives')}</p>
      </fieldset>

      {/* Trampa para robots: una persona no ve este campo y por tanto no lo rellena. */}
      <input type="text" name="web" value={parany} onChange={(e) => setParany(e.target.value)}
        tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <Button type="submit" disabled={ocupat} className="whitespace-normal">
        {ocupat ? t('reg.submitting') : t('reg.submit')}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  )
}
