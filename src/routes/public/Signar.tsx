// `/signar/:token` — la página pública de firma del convenio.
//
// LA ABRE QUIEN REPRESENTA A LA ORGANIZACIÓN, casi siempre desde el móvil, y a veces con
// el dinamizador al lado y una furgoneta detrás (firma asistida, §3.2.5). Es la hermana de
// `/confirmar/:token` y comparte con ella todo lo que la hace utilizable ahí:
//
//   · NO monta `AppContextProvider` ni nada que exija sesión. Va fuera de `RequireSessio`.
//     El único permiso es el token del correo.
//   · Una sola columna, controles de 44 px, `text-base` en lo que se enfoca (por debajo de
//     16 px iOS amplía la página al enfocar y no lo deshace, §2 regla 1).
//   · Los finales del enlace —no existe (404), ya usado (409), caducado (410)— tienen cada
//     uno su mensaje, porque lo que hay que hacer después es distinto en cada caso.
//
// LO QUE HACE QUE ESTA FIRMA VALGA ALGO son tres cosas, y las exige el servidor
// (`firmar_convenio_por_enlace`), no esta pantalla:
//
//   1. **La declaración de representación.** Sin ella no hay firma: quien firma declara
//      que puede obligar a la organización.
//   2. **La huella del texto exacto** (`sha256_texto`). Se pinta el convenio entero y se
//      devuelve su huella: sin eso queda un «va firmar» que no dice QUÉ firmó, que es
//      justo lo que no sirve ante nadie.
//   3. **El segundo factor**, si el enlace lo lleva. Se pide **al final**, justo antes de
//      firmar, y no al abrir: el código dura 10 minutos y rellenar los datos y leer el
//      convenio se come más que eso. Pedirlo primero es garantizar que caduque.
//
// ⚠️ EL DOCUMENTO DE IDENTIDAD se recoge aquí y muere en `evidencias`, que está fuera del
//    GRANT de SELECT de `authenticated`: ninguna pantalla del equipo lo lee ni lo puede
//    leer. Se pide porque el convenio lo necesita, no porque nadie vaya a consultarlo.

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import {
  carregaConveni, enviaCodiFirma, signaConveni, validaCodiFirma,
} from '../../lib/enllacPublic'
import type { DadesConveni, DadesOrganitzacio } from '../../lib/enllacPublic'
import LayoutAcces from '../../components/LayoutAcces'
import SignaturePad from '../../components/SignaturePad'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Los campos de la organización, en el orden en que una persona los lee de su escritura. */
const CAMPS: { clau: keyof DadesOrganitzacio; label: string; auto?: string }[] = [
  { clau: 'raso_social', label: 'sig.f_raso', auto: 'organization' },
  { clau: 'nom_comercial', label: 'sig.f_comercial' },
  { clau: 'nif', label: 'sig.f_nif' },
  { clau: 'domicili', label: 'sig.f_domicili', auto: 'street-address' },
  { clau: 'codi_postal', label: 'sig.f_cp', auto: 'postal-code' },
  { clau: 'poblacio', label: 'sig.f_poblacio', auto: 'address-level2' },
  { clau: 'representant', label: 'sig.f_representant', auto: 'name' },
  { clau: 'carrec', label: 'sig.f_carrec' },
  { clau: 'email', label: 'sig.f_email', auto: 'email' },
]

/**
 * Cuáles son obligatorios lo dice el SERVIDOR (`formulari.obligatoris`), que es quien va a
 * rechazar el envío. Esta lista es solo el respaldo para cuando no lo diga: escribirla
 * como verdad haría que, el día que cambie la regla, el formulario dejara firmar y el 400
 * llegara después de todo el trabajo.
 */
const OBLIGATORIS_PER_DEFECTE = ['nif', 'domicili', 'representant', 'carrec']

const BUIDA: DadesOrganitzacio = {
  raso_social: '', nom_comercial: '', nif: '', domicili: '', codi_postal: '',
  poblacio: '', representant: '', carrec: '', email: '',
}

export default function Signar() {
  const { t } = useT()
  const { token } = useParams<{ token: string }>()

  const [dades, setDades] = useState<DadesConveni | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [fet, setFet] = useState<{ numero: string | null } | null>(null)
  const [enviant, setEnviant] = useState(false)

  const [org, setOrg] = useState<DadesOrganitzacio>(BUIDA)
  const [nom, setNom] = useState('')
  const [carrec, setCarrec] = useState('')
  const [dni, setDni] = useState('')
  const [declaracio, setDeclaracio] = useState(false)
  const [acceptacio, setAcceptacio] = useState(false)
  const [firma, setFirma] = useState<string | null>(null)
  // Honeypot. Una persona nunca lo ve ni lo rellena; un robot que rellena el formulario
  // entero, sí. Mismo mecanismo que el registro público y que `/confirmar` (§9).
  const [web, setWeb] = useState('')

  // Segundo factor
  const [codi, setCodi] = useState('')
  const [codiValidat, setCodiValidat] = useState(false)
  const [codiEnviat, setCodiEnviat] = useState(false)
  const [ocupatCodi, setOcupatCodi] = useState(false)
  const [errorCodi, setErrorCodi] = useState<string | null>(null)

  const carrega = useCallback(async () => {
    if (!token) { setErrorKey('conf.err_no_existeix'); setCarregant(false); return }
    const res = await carregaConveni(token)
    if (!res.ok) { setErrorKey(res.motiuKey); setCarregant(false); return }

    setDades(res.data)
    // El formulario arranca con lo que ya sabemos. Revisar cinco campos escritos es otra
    // cosa que teclearlos de cero de pie en un camino, y es la diferencia entre que se
    // firme y que no.
    setOrg({
      raso_social: res.data.organitzacio.raso_social,
      nom_comercial: res.data.organitzacio.nom_comercial,
      nif: res.data.organitzacio.nif,
      domicili: res.data.organitzacio.domicili,
      codi_postal: res.data.organitzacio.codi_postal,
      poblacio: res.data.organitzacio.poblacio,
      representant: res.data.organitzacio.representant,
      carrec: res.data.organitzacio.carrec,
      email: res.data.organitzacio.email,
    })
    setNom(res.data.organitzacio.representant)
    setCarrec(res.data.organitzacio.carrec)
    setCarregant(false)
  }, [token])

  useEffect(() => { void carrega() }, [carrega])

  async function demanaCodi() {
    if (!token) return
    setOcupatCodi(true)
    setErrorCodi(null)
    const res = await enviaCodiFirma(token)
    setOcupatCodi(false)
    if (!res.ok) { setErrorCodi(res.motiuKey); return }
    setCodiEnviat(true)
  }

  async function validaCodi() {
    if (!token) return
    setOcupatCodi(true)
    setErrorCodi(null)
    const res = await validaCodiFirma(token, codi.trim())
    setOcupatCodi(false)
    if (!res.ok) { setErrorCodi(res.motiuKey); return }
    setCodiValidat(true)
  }

  async function signa() {
    if (!token || !firma) return
    setEnviant(true)
    const res = await signaConveni(token, {
      dades: {
        raso_social: org.raso_social.trim(),
        nom_comercial: org.nom_comercial.trim(),
        nif: org.nif.trim(),
        domicili: org.domicili.trim(),
        codi_postal: org.codi_postal.trim(),
        poblacio: org.poblacio.trim(),
        representant: org.representant.trim(),
        carrec: org.carrec.trim(),
        email: org.email.trim(),
      },
      nom: nom.trim() || org.representant.trim(),
      carrec: carrec.trim() || org.carrec.trim(),
      documentIdentitat: dni.trim(),
      declaracioRepresentacio: declaracio,
      acceptacio,
      firmaPng: firma,
      sha256Texto: dades?.sha256Texto ?? null,
      web,
    })
    setEnviant(false)
    if (!res.ok) { setErrorKey(res.motiuKey); return }
    setFet({ numero: res.data.numero })
  }

  // ── Estados terminales ──
  if (carregant) {
    return (
      <LayoutAcces ample>
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />{t('c.loading')}
          </CardContent>
        </Card>
      </LayoutAcces>
    )
  }

  if (!dades || errorKey) {
    return (
      <LayoutAcces ample>
        <Card>
          <CardHeader><CardTitle>{t('sig.problem')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{t(errorKey ?? 'conf.err_generic')}</p>
            <p className="text-sm text-muted-foreground">{t('sig.problem_help')}</p>
            {dades && (
              <Button variant="outline" className="h-11 w-full whitespace-normal"
                onClick={() => setErrorKey(null)}>
                {t('conf.retry')}
              </Button>
            )}
          </CardContent>
        </Card>
      </LayoutAcces>
    )
  }

  if (fet) {
    return (
      <LayoutAcces ample>
        <Card>
          <CardHeader><CardTitle>{t('sig.done_title')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{t('sig.done_body')}</p>
            {fet.numero && (
              <p className="text-sm tabular-nums text-muted-foreground">{fet.numero}</p>
            )}
            <p className="text-sm text-muted-foreground">{t('sig.done_next')}</p>
          </CardContent>
        </Card>
      </LayoutAcces>
    )
  }

  const exigits = dades.obligatoris.length > 0 ? dades.obligatoris : OBLIGATORIS_PER_DEFECTE
  const falten = CAMPS.filter((c) => exigits.includes(c.clau) && org[c.clau].trim() === '')
  const calCodi = dades.calCodi && !codiValidat
  const potSignar =
    falten.length === 0 && dni.trim() !== '' && nom.trim() !== '' && carrec.trim() !== ''
    && declaracio && acceptacio && firma !== null && !calCodi && !enviant

  return (
    <LayoutAcces ample>
      <Card>
        <CardHeader>
          <CardTitle>{t('sig.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {/* El nombre del modelo lo da el servidor ya traducido al idioma DEL CONVENIO,
                que no tiene por qué ser el de la interfaz: es el documento el que manda. */}
            {dades.conveni.model ?? t(`sig.model_${dades.conveni.tipus}`)}
            {dades.organitzacio.nom ? ` · ${dades.organitzacio.nom}` : ''}
          </p>
        </CardHeader>

        {/* Una sola columna, siempre: a 360 px dos columnas obligan a hacer zoom, y esto
            se rellena de pie. */}
        <CardContent className="space-y-6">
          <p className="text-sm">{t('sig.intro')}</p>

          {dades.assistida && (
            <p className="rounded-md bg-secondary p-3 text-sm text-secondary-foreground">
              {t('sig.assisted_note')}
            </p>
          )}

          {/* ── 1. Los datos de la organización ── */}
          <section className="space-y-3">
            <h2 className="text-base">{t('sig.org_title')}</h2>
            <p className="text-sm text-muted-foreground">{t('sig.org_hint')}</p>
            {CAMPS.map((c) => (
              <div key={c.clau} className="space-y-1.5">
                <Label htmlFor={`sig-${c.clau}`}>
                  {t(c.label)}{exigits.includes(c.clau) ? ' *' : ''}
                </Label>
                <Input
                  id={`sig-${c.clau}`}
                  className="h-11"
                  autoComplete={c.auto}
                  inputMode={c.clau === 'codi_postal' ? 'numeric' : undefined}
                  type={c.clau === 'email' ? 'email' : 'text'}
                  value={org[c.clau]}
                  onChange={(e) => setOrg((p) => ({ ...p, [c.clau]: e.target.value }))}
                />
              </div>
            ))}
          </section>

          {/* ── 2. EL CONVENIO, LITERAL ──
              Se pinta con `whitespace-pre-wrap` porque el servidor lo manda ya maquetado
              en líneas; ni una palabra se reescribe aquí. Su huella (`sha256_texto`) viaja
              de vuelta al firmar y es lo que convierte un «firmó» en un «firmó ESTO». */}
          <section className="space-y-3">
            <h2 className="text-base">{t('sig.text_title')}</h2>
            {dades.textConveni ? (
              <div className="max-h-96 overflow-y-auto rounded-md border bg-secondary p-3">
                <p className="whitespace-pre-wrap text-sm text-secondary-foreground">
                  {dades.textConveni}
                </p>
              </div>
            ) : (
              <p className="text-sm text-error">{t('sig.no_text')}</p>
            )}
          </section>

          {/* ── 3. Quién firma ── */}
          <section className="space-y-3">
            <h2 className="text-base">{t('sig.signer_title')}</h2>
            <div className="space-y-1.5">
              <Label htmlFor="sig-nom">{t('sig.f_signer_name')} *</Label>
              <Input id="sig-nom" className="h-11" autoComplete="name"
                value={nom} onChange={(e) => setNom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sig-carrec">{t('sig.f_signer_role')} *</Label>
              <Input id="sig-carrec" className="h-11"
                value={carrec} onChange={(e) => setCarrec(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sig-dni">{t('sig.f_dni')} *</Label>
              <Input id="sig-dni" className="h-11"
                value={dni} onChange={(e) => setDni(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('sig.dni_hint')}</p>
            </div>
          </section>

          {/* ── 4. Las dos casillas ──
              44 px de alto en toda la fila, no solo en el cuadradito: a 16 px de lado esto
              es imposible de acertar con un dedo. */}
          <section className="space-y-2">
            <h2 className="text-base">{t('sig.declare_title')}</h2>
            <label className="flex min-h-11 items-start gap-3 rounded-md border p-3 text-base">
              <input type="checkbox" className="mt-1 size-5 accent-primary"
                checked={declaracio} onChange={(e) => setDeclaracio(e.target.checked)} />
              {/* El texto de las dos declaraciones viene del convenio, no de la interfaz:
                  es parte de lo que se firma. La clave i18n es solo el respaldo. */}
              <span className="text-sm">{dades.declaracioRepresentacio ?? t('sig.declare_rep')}</span>
            </label>
            <label className="flex min-h-11 items-start gap-3 rounded-md border p-3 text-base">
              <input type="checkbox" className="mt-1 size-5 accent-primary"
                checked={acceptacio} onChange={(e) => setAcceptacio(e.target.checked)} />
              <span className="text-sm">{dades.declaracioAcceptacio ?? t('sig.declare_accept')}</span>
            </label>
          </section>

          {/* ── 5. El trazo ── */}
          <section className="space-y-2">
            <h2 id="sig-firma-label" className="text-base">{t('sig.sign_title')}</h2>
            <SignaturePad etiquetaId="sig-firma-label" onCanvi={setFirma} deshabilitat={enviant} />
          </section>

          {/* ── 6. El segundo factor, al final a propósito (ver cabecera) ── */}
          {dades.calCodi && (
            <section className="space-y-3 rounded-md border p-3">
              <h2 className="text-base">{t('sig.code_title')}</h2>
              {codiValidat ? (
                <p className="text-sm text-exito">{t('sig.code_ok')}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t(codiEnviat ? 'sig.code_sent' : 'sig.code_hint', {
                      email: dades.destinatari ?? '',
                    })}
                  </p>
                  {/* Sin correo en la ficha no hay a dónde mandarlo, y el botón lo dice
                      en vez de fallar con un 400 después de pulsarlo. */}
                  <Button variant="outline" className="h-11 w-full whitespace-normal"
                    disabled={ocupatCodi || !dades.potDemanarCodi}
                    onClick={() => void demanaCodi()}>
                    {t(codiEnviat ? 'sig.code_resend' : 'sig.code_send')}
                  </Button>
                  <div className="space-y-1.5">
                    <Label htmlFor="sig-codi">{t('sig.f_code')}</Label>
                    <Input id="sig-codi" className="h-11 tabular-nums" inputMode="numeric"
                      autoComplete="one-time-code" maxLength={6}
                      value={codi} onChange={(e) => setCodi(e.target.value.replace(/\D/g, ''))} />
                  </div>
                  <Button className="h-11 w-full whitespace-normal"
                    disabled={ocupatCodi || codi.trim().length < 6}
                    onClick={() => void validaCodi()}>
                    {ocupatCodi && <Loader2 className="size-4 animate-spin" />}
                    {t('sig.code_validate')}
                  </Button>
                </>
              )}
              {errorCodi && <p className="text-sm text-error">{t(errorCodi)}</p>}
            </section>
          )}

          {/* Trampa para robots: una persona no ve este campo y por tanto no lo rellena. */}
          <input
            type="text" name="web" value={web} onChange={(e) => setWeb(e.target.value)}
            tabIndex={-1} autoComplete="off" aria-hidden="true"
            className="hidden"
          />

          <div className="space-y-2">
            <Button className="h-11 w-full whitespace-normal" disabled={!potSignar}
              onClick={() => void signa()}>
              {enviant && <Loader2 className="size-4 animate-spin" />}
              {enviant ? t('c.sending') : t('sig.submit')}
            </Button>
            {/* Por qué el botón está gris. Un botón desactivado sin explicación es un
                callejón: la persona no tiene forma de saber qué le falta. */}
            {!potSignar && !enviant && (
              <p className="text-xs text-muted-foreground">
                {falten.length > 0
                  ? t('sig.missing_fields', { camps: falten.map((c) => t(c.label)).join(', ') })
                  : dni.trim() === '' || nom.trim() === '' || carrec.trim() === ''
                    ? t('sig.missing_signer')
                    : !declaracio || !acceptacio
                      ? t('sig.missing_checks')
                      : firma === null
                        ? t('sig.missing_sign')
                        : t('sig.missing_code')}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('sig.legal')}</p>
          </div>
        </CardContent>
      </Card>
    </LayoutAcces>
  )
}
