// «Signa aquí»: firmar un documento (CD, CR, REC, ENT) con el dedo o el ratón.
//
// Se usa en DOS sitios y es el mismo código —la condición que ya cumple `FirmaConveni`—:
//
//   · `/signar-document/:token`, la página pública: la abre quien recibe el enlace por
//     correo («Envia per correu» con la casilla del enlace), sin sesión y casi siempre desde
//     el móvil.
//   · La pestaña «Signa aquí» de `DialegSignaDocument`, desde el panel, con un enlace propio
//     de una hora (`acunar_enllac_propi('firma_document', …)`).
//
// Un solo POST (`enlace-publico`, `accion: 'firmar_document'`), una sola evidencia: lo que se
// firma, la huella que vuelve (`sha256_texto`, la del snapshot del documento: el código
// impreso sigue valiendo) y el trazo son los mismos pasen por donde pasen. La firma con
// trazo se cierra sola (`tancat`): el servidor emite la versión firmada (`subtipo='signat'`)
// y la genera en segundo plano.
//
// EL ORDEN es el de quien firma de pie: el documento → quién firma → la conformidad (el acta,
// literal, del servidor) → el trazo → el botón. Cada paso que falta se dice bajo el botón.
//
// ⚠️ EN MÓVIL NO SE INCRUSTA EL PDF (ver `PdfIncrustat`): iOS no lo pinta en un iframe. Sale
//    una tarjeta con «Obre el PDF» y «Descarrega». La URL dura 60 s: pasado ese rato, el
//    botón pide una nueva antes de abrir.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Download, ExternalLink, FileText, Loader2 } from 'lucide-react'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { carregaDocumentSignatura, signaDocument } from '../lib/enllacPublic'
import type { DadesDocumentSignatura } from '../lib/enllacPublic'
import { signantValid } from '../lib/signatures'
import { useSessio } from '../hooks/useSessio'
import { useIsMobile } from '../hooks/use-mobile'
import SignaturePad from './SignaturePad'
import BlocSignant from './BlocSignant'
import PdfIncrustat from './PdfIncrustat'
import { FilaCasella } from './Casella'
import { Button } from '@/components/ui/button'

/** Del campo que señala el 400 del servidor a la frase que dice qué corregir. */
const ERROR_CAMP: Record<string, string> = {
  nombre: 'sig.err_nom_curt',
  cargo: 'sig.err_carrec_curt',
  carrec: 'sig.err_carrec_curt',
  documento_identidad: 'sig.err_dni_curt',
  declaracio_representacio: 'sgn.err_declaracio',
  signatura_base64: 'sig.err_signatura',
}

/** La URL firmada del PDF caduca a los 60 s; se renueva con un margen. */
const VIDA_URL_MS = 50_000

export interface PropsFormulariSignaDocument {
  token: string | undefined
  /** A dónde vuelve quien tiene sesión al acabar (solo la página pública). */
  tornar?: string
  /** `true` = dentro del diálogo: dos columnas desde `lg` y sin «torna al panell». */
  ample?: boolean
  /** Tras firmar con éxito: el diálogo refresca el panel de detrás. */
  onSignat?: () => void
}

export default function FormulariSignaDocument(
  { token, tornar = '/panell', ample = false, onSignat }: PropsFormulariSignaDocument,
) {
  const { t } = useT()
  const { session } = useSessio()
  const esMobil = useIsMobile()

  const [dades, setDades] = useState<DadesDocumentSignatura | null>(null)
  const [carregatAt, setCarregatAt] = useState(0)
  const [carregant, setCarregant] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [errorEnviament, setErrorEnviament] = useState<string | null>(null)
  const [enviant, setEnviant] = useState(false)
  const [fet, setFet] = useState<{ numero: string | null; pdfPendent: boolean } | null>(null)

  const [nom, setNom] = useState('')
  const [carrec, setCarrec] = useState('')
  const [dni, setDni] = useState('')
  const [declaracio, setDeclaracio] = useState(false)
  const [firma, setFirma] = useState<string | null>(null)
  // Honeypot, como en el convenio y la confirmación (§9).
  const [web, setWeb] = useState('')

  const carrega = useCallback(async (primera: boolean) => {
    if (!token) { setErrorKey('conf.err_no_existeix'); setCarregant(false); return null }
    const res = await carregaDocumentSignatura(token)
    if (!res.ok) { setErrorKey(res.motiuKey); setCarregant(false); return null }
    setDades(res.data)
    setCarregatAt(Date.now())
    // Lo que ya se sabe de quien firma, para revisarlo en vez de teclearlo de cero.
    if (primera) {
      setNom(res.data.signant.nom)
      setCarrec(res.data.signant.carrec)
    }
    setCarregant(false)
    return res.data
  }, [token])

  useEffect(() => { void carrega(true) }, [carrega])

  /** La URL del PDF, renovada si ya ha caducado (la tarjeta del móvil). */
  async function urlVigent(): Promise<string | null> {
    if (dades?.pdfUrl && Date.now() - carregatAt < VIDA_URL_MS) return dades.pdfUrl
    const nou = await carrega(false)
    return nou?.pdfUrl ?? null
  }

  async function obrePdf(descarrega: boolean) {
    // La ventana se abre ANTES de esperar a la red: abrirla después del `await` la convierte
    // en un popup que el navegador bloquea (sobre todo en iOS).
    // ⚠️ Sin `noopener` en las opciones: con él `window.open` devuelve `null` y no habría
    //    ventana a la que mandar la URL. Se corta el `opener` a mano.
    const finestra = window.open('', '_blank')
    if (finestra) finestra.opener = null
    const url = await urlVigent()
    if (!url) { finestra?.close(); return }
    const separador = url.includes('?') ? '&' : '?'
    const desti = descarrega
      ? `${url}${separador}download=${encodeURIComponent(`${dades?.numero ?? 'document'}.pdf`)}`
      : url
    if (finestra) finestra.location.href = desti
  }

  async function signa() {
    if (!token || !firma || !dades) return
    setEnviant(true)
    setErrorEnviament(null)
    const res = await signaDocument(token, {
      nom: nom.trim(),
      carrec: carrec.trim(),
      documentIdentitat: dni.trim(),
      declaracioRepresentacio: declaracio,
      firmaPng: firma,
      sha256Texto: dades.sha256Texto,
      web,
    })
    setEnviant(false)
    if (!res.ok) {
      if (res.codi === 'dades_invalides' || res.codi.startsWith('falta_')) {
        setErrorEnviament((res.camp && ERROR_CAMP[res.camp]) ?? res.motiuKey)
        return
      }
      setErrorKey(res.motiuKey)
      return
    }
    setFet({ numero: res.data.numero ?? dades.numero, pdfPendent: res.data.pdfPendent })
    onSignat?.()
  }

  if (carregant) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />{t('c.loading')}
      </div>
    )
  }

  const mostraTornar = session && !ample

  if (!dades || errorKey) {
    return (
      <div className="space-y-3" data-testid="sgn-problema">
        <h2 className="text-lg font-semibold">{t('sgn.problem')}</h2>
        <p className="text-sm">{t(errorKey ?? 'conf.err_generic')}</p>
        <p className="text-sm text-muted-foreground">{t('sgn.problem_help')}</p>
        {dades && errorKey === 'conf.err_canviat' && (
          <Button variant="outline" className="h-11 w-full whitespace-normal"
            onClick={() => { setErrorKey(null); setFirma(null); void carrega(false) }}>
            {t('conf.retry')}
          </Button>
        )}
        {mostraTornar && (
          <Button asChild variant="outline" className="h-11 w-full whitespace-normal">
            <Link to={tornar}>{t('pub.back_panel')}</Link>
          </Button>
        )}
      </div>
    )
  }

  if (fet) {
    return (
      <div className="space-y-2" data-testid="sgn-fet">
        <h2 className="text-lg font-semibold">{t('sgn.done_title')}</h2>
        <p className="text-sm">{t('sgn.done_body')}</p>
        {fet.numero && <p className="text-sm tabular-nums text-muted-foreground">{fet.numero}</p>}
        {fet.pdfPendent && <p className="text-sm text-muted-foreground">{t('sgn.done_pdf')}</p>}
        {mostraTornar && (
          <Button asChild variant="outline" className="h-11 w-full whitespace-normal">
            <Link to={tornar}>{t('pub.back_panel')}</Link>
          </Button>
        )}
      </div>
    )
  }

  const nomDoc = t(`doc.tipus_${dades.tipus}`)
  const { nomCurt, carrecCurt, dniCurt } = signantValid({ nom, carrec, dni })
  const potSignar = !nomCurt && !carrecCurt && !dniCurt && declaracio && firma !== null && !enviant

  const seccioDocument = (
    <section className={cn('space-y-3', ample && 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col')}>
      <h2 className="text-base">{t('sgn.doc_title')}</h2>
      {dades.codiVerificacio && (
        <p className="text-xs text-muted-foreground">
          {t('sgn.codi', { codi: dades.codiVerificacio })}
        </p>
      )}
      {dades.pdfUrl && !esMobil ? (
        <PdfIncrustat url={dades.pdfUrl} titol={`${nomDoc} ${dades.numero ?? ''}`}
          className={cn('h-96', ample && 'lg:h-auto lg:min-h-96 lg:flex-1')} />
      ) : (
        // La tarjeta del móvil: el PDF se abre fuera (pestaña o descarga).
        <div className="flex flex-col gap-3 rounded-md border bg-secondary p-3 text-secondary-foreground">
          <p className="flex items-start gap-2 text-sm">
            <FileText className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0">{t('sgn.doc_mobile', { doc: nomDoc, num: dades.numero ?? '' })}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto"
              onClick={() => void obrePdf(false)}>
              <ExternalLink className="mr-1 size-4" aria-hidden />{t('sgn.open_pdf')}
            </Button>
            <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto"
              onClick={() => void obrePdf(true)}>
              <Download className="mr-1 size-4" aria-hidden />{t('doc.download')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )

  const seccioSignant = (
    <section className="space-y-3">
      <h2 className="text-base">{t('sig.signer_title')}</h2>
      <BlocSignant prefix="sgn-signant" nom={nom} carrec={carrec} dni={dni}
        onNom={setNom} onCarrec={setCarrec} onDni={setDni} ample={ample} />
    </section>
  )

  const seccioConformitat = (
    <section className="space-y-2">
      <h2 className="text-base">{t('sgn.declare_title')}</h2>
      {/* El acta la compone el servidor y es parte de lo que se firma: se pinta literal. La
          clave i18n es solo el respaldo. */}
      <FilaCasella caixa checked={declaracio} onChange={setDeclaracio}>
        <span className="whitespace-pre-wrap">{dades.textActa ?? t('sgn.declare_rep')}</span>
      </FilaCasella>
    </section>
  )

  const seccioTrac = (
    <section className="space-y-2">
      <h2 id="sgn-firma-label" className="text-base">{t('sig.sign_title')}</h2>
      <SignaturePad etiquetaId="sgn-firma-label" onCanvi={setFirma} deshabilitat={enviant} />
    </section>
  )

  const seccioEnviar = (
    <div className="space-y-2">
      <input
        type="text" name="web" value={web} onChange={(e) => setWeb(e.target.value)}
        tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden"
      />
      <Button className="h-11 w-full whitespace-normal" disabled={!potSignar}
        data-testid="sgn-submit" onClick={() => void signa()}>
        {enviant && <Loader2 className="size-4 animate-spin" />}
        {enviant ? t('c.sending') : t('sgn.submit')}
      </Button>
      {errorEnviament && !enviant && (
        <p className="text-sm text-error" role="alert">{t(errorEnviament)}</p>
      )}
      {!potSignar && !enviant && (
        <p className="text-xs text-muted-foreground">
          {nomCurt || carrecCurt || dniCurt
            ? t('sig.missing_signer')
            : !declaracio ? t('sgn.missing_check') : t('sig.missing_sign')}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t('sgn.legal')}</p>
    </div>
  )

  return (
    <div className={cn('space-y-6', ample && 'lg:flex lg:h-full lg:flex-col')} data-testid="sgn-formulari">
      <header className={cn(ample && 'lg:shrink-0')}>
        <h1 className="text-lg font-semibold">{t('sgn.title', { doc: nomDoc })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[dades.numero, dades.organitzacio.nom].filter(Boolean).join(' · ')}
        </p>
        {dades.part && (
          <p className="mt-1 text-sm">{t(`sgn.qui_${dades.part}`)}</p>
        )}
      </header>

      {dades.assistida && (
        <p className="rounded-md bg-secondary p-3 text-sm text-secondary-foreground">
          {t('sig.assisted_note')}
        </p>
      )}

      {ample ? (
        // Dos columnas desde `lg`: a la izquierda lo que se lee, a la derecha lo que se firma.
        <div className="grid grid-cols-1 gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:items-stretch">
          <div className="lg:flex lg:min-h-0 lg:flex-col">{seccioDocument}</div>
          <div className="space-y-6 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
            {seccioSignant}{seccioConformitat}{seccioTrac}{seccioEnviar}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {seccioDocument}{seccioSignant}{seccioConformitat}{seccioTrac}{seccioEnviar}
        </div>
      )}
    </div>
  )
}
