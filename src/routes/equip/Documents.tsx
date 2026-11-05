// Bandeja de documentos del equipo.
//
// Es la única ventana a `documentos` que tiene una persona: la tabla no se escribe desde
// aquí (nadie tiene INSERT ni UPDATE sobre ella; los documentos los emiten las RPC y los
// genera la Edge Function) y el PDF solo se baja por `descargar-documento`. O sea que
// esta pantalla lista y descarga, y no hace nada más a propósito.
//
// Las PESTAÑAS crecen con cada fase. La fase 3 llena dos de las que estaban reservadas,
// leyendo `v_albaranes_bandeja` —una vista con `security_invoker`, así que no es un agujero
// en la RLS: evalúa las políticas de quien consulta—:
//
//   · «Per conciliar»: los albaranes entregados o confirmados, ordenados por días de espera.
//   · «Amb discrepància»: los que no cuadran. Y aquí hay una decisión que conviene leer: la
//     discrepancia REAL de un registro la calcula `propuesta_conciliacion()` cruzando el REC
//     con todos sus ENT, y eso es una llamada por fila —inviable en un listado—. Lo que se
//     usa aquí es lo que la vista sí sabe por sí sola: que hubo un rechazo, o que los kilos
//     confirmados no coinciden con los entregados. Es un filtro de «mira esto», no un
//     veredicto; el veredicto lo da la ficha del albarán al abrir la conciliación.
//
// «Signatures» (05-11-2026) sustituye a la vacía «Enllaços caducats»: la firma de la
// contraparte de cada documento firmable (`v_signatures_bandeja`), con un filtro —pendents,
// rebudes (por defecto: lo que espera al super_admin), tancades—. Fail-soft: si la vista no
// responde, la pestaña sale vacía y el resto de la bandeja sigue.
//
// «Enviaments» (deuda §12.25) lee `documento_envios`, que `sendEmail()` escribe con
// `service_role` desde julio y que **no leía ninguna pantalla**: un correo rechazado por
// Resend era, desde aquí, indistinguible de uno que llegó. Dos avisos que conviene tener
// delante antes de tocarla:
//
//   · **No es la pestaña «Amb error».** Aquella son los PDF que no se han podido GENERAR
//     (`documentos.estado`); esta son los correos que no han podido SALIR
//     (`documento_envios.estado`). Un documento puede estar perfectamente emitido y su
//     correo haber fallado, y al revés. Los textos de las dos lo dicen.
//   · **`documento_envios` NO guarda el asunto, y es deliberado** (§12.25): el correo del
//     código de firma asistida lleva las seis cifras dentro del `subject`, y esta tabla la
//     lee todo el equipo. Con destinatario, propósito, estado y error se contesta la única
//     pregunta que hay que contestar —«¿este correo salió?»— sin publicar una credencial.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, Eye, FileText, Loader2, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { useCanals } from '../../hooks/useAppContext'
import { motiuCanal } from '../../lib/canals'
import BotoIcona from '../../components/BotoIcona'
import { filtraCerca } from '../../lib/cerca'
import { useCerca } from '../../hooks/useCerca'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { carregaBandejaSignatures, reenviarDocument } from '../../lib/documents'
import { useConfirmaEnviament } from '../../components/DialegEnviament'
import AccionsSignatura from '../../components/AccionsSignatura'
import BadgeSignatura from '../../components/BadgeSignatura'
import Desplegable from '../../components/Desplegable'
import { rutaSignatura } from '../../components/equip/CuaSignatures'
import { clauVia } from '../../lib/signatures'
import { estilEstatAlbara } from '../../lib/albarans'
import { dataCurta, dataHora, kg } from '../../lib/format'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { Documento, DocumentoEstado, EstatSignatura, SignaturaBandeja } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/** Lo que se pinta. `Pick` sobre `Documento` para que el tipo lo siga mandando types.ts. */
type Fila = Pick<
  Documento,
  | 'id' | 'tipo' | 'subtipo' | 'numero_completo' | 'version' | 'serie' | 'ejercicio'
  | 'modo' | 'idioma' | 'estado' | 'intentos' | 'ultimo_error' | 'paginas' | 'emitido_at' | 'vigente'
>

/** Cada estado con su color de token. El error es rojo; el coral no significa fallo. */
const ESTIL_ESTAT: Record<DocumentoEstado, string> = {
  emitido: 'bg-exito-fondo text-exito',
  pendiente_fichero: 'bg-aviso-fondo text-aviso',
  error: 'bg-error-fondo text-error',
}

const CLAU_ESTAT: Record<DocumentoEstado, string> = {
  emitido: 'doc.st_emitido',
  pendiente_fichero: 'doc.st_pendent',
  error: 'doc.st_error',
}

/**
 * Un correo registrado en `documento_envios`.
 *
 * No sale de `types.ts` porque el tipo `DocumentoEnvio` que hay allí es anterior a la
 * migración `20270307100000`, que generalizó la tabla: le faltan `objeto_tipo`,
 * `objeto_id`, `proposito` y `funcion`, `documento_id` ya no es obligatorio y `estado`
 * admite `simulat`. Se declara aquí lo que esta pantalla necesita, y el bloque para
 * `types.ts` va en el informe — ese fichero lo toca la sesión que orquesta.
 */
interface Enviament {
  id: string
  documento_id: string | null
  destinatario: string
  estado: 'pendent' | 'enviat' | 'simulat' | 'error' | 'desactivat'
  proposito: string
  funcion: string | null
  error: string | null
  enviado_at: string | null
  created_at: string
}

/**
 * Los tipos que salen por correo con el PDF adjunto (`_shared/correu-document.ts`). Es una
 * pista para no enseñar un botón que no hace nada; la autoridad es el servidor, que
 * contesta `no_s_envia` si ese documento no lleva destinatario.
 */
const TIPUS_ENVIABLES = new Set(['CONV', 'RES', 'CD', 'CT', 'CR'])
/** Los firmables que salen por `reenviar-documento` (los albaranes, por su ficha: `enviar-albara`). */
const TIPUS_ENVIABLES_SIG = new Set(['CD', 'CR'])

/** Solo se traen los últimos: la tabla crece con cada correo y no se pagina (§12.5). */
const MAX_ENVIAMENTS = 200

/**
 * Estado del ENVÍO, que no es el del documento.
 *
 * `simulat` va en neutro y no en rojo a propósito: con `RESEND_ENVIO_REAL` apagado el
 * correo no sale, pero eso no es un fallo — es el interruptor haciendo su trabajo (§10).
 */
const ESTIL_ENVIAMENT: Record<Enviament['estado'], string> = {
  enviat: 'bg-exito-fondo text-exito',
  pendent: 'bg-aviso-fondo text-aviso',
  simulat: 'bg-secondary text-secondary-foreground',
  error: 'bg-error-fondo text-error',
  desactivat: 'bg-aviso-fondo text-aviso',
}

const CLAU_ENVIAMENT: Record<Enviament['estado'], string> = {
  enviat: 'doc.se_enviat',
  pendent: 'doc.se_pendent',
  simulat: 'doc.se_simulat',
  error: 'doc.se_error',
  // Cortado por un interruptor de Configuració (§8): no ha fallado, se puede reenviar.
  desactivat: 'doc.se_desactivat',
}

/**
 * Para qué se escribió cada correo. Es un `text` libre en la base —cada Edge Function pone
 * el suyo—, así que lo que no esté aquí se enseña **en crudo** en vez de traducirse a una
 * clave inventada: un propósito nuevo aparecerá tal cual y se añade cuando se vea.
 */
const CLAU_PROPOSIT: Record<string, string> = {
  oferta: 'doc.pr_oferta',
  oferta_confirmacio: 'doc.pr_oferta_confirmacio',
  missatge: 'doc.pr_missatge',
  acces: 'doc.pr_acces',
  recuperacio: 'doc.pr_recuperacio',
  document: 'doc.pr_document',
  avis_rebuig: 'doc.pr_avis_rebuig',
  avis_firma: 'doc.pr_avis_firma',
  codi_firma: 'doc.pr_codi_firma',
  recordatori_equip: 'doc.pr_recordatori_equip',
  recordatori_factura: 'doc.pr_recordatori_factura',
  // Los dos que manda el propio panel (`albarans.ts`, `convenis.ts`): antes salían en crudo.
  confirmacio_albara: 'doc.pr_confirmacio_albara',
  firma_conveni: 'doc.pr_firma_conveni',
}

/**
 * ¿Este error lo reportó la función, o murió sin decir nada?
 *
 * `marcar_documento_error()` SIEMPRE sube `intentos`, así que un error con `intentos = 0`
 * solo puede venir del job dándolo por perdido tras cinco silencios — y el silencio
 * típico es que el runtime cortara la generación por pasarse de CPU. No hace falta
 * ningún marcador en la fila: la firma se deduce (§12.89).
 *
 * Importa distinguirlos porque la acción es distinta: un error reportado se lee en
 * `ultimo_error` y suele ser un dato que falta; un silencio hay que ir a buscarlo a los
 * logs de la función.
 */
function senseResposta(d: Fila): boolean {
  return d.estado === 'error' && d.intentos === 0
}

/**
 * Lo que una columna escondida por ancho deja de enseñar, en una línea bajo el dato
 * principal de la fila (criterio de las tablas, 03-11-2026, AGENTS.md §2). Cada pieza dice
 * desde qué punto de corte tiene ya su columna y deja de salir aquí.
 *
 * Las piezas se ordenan de la que se esconde MÁS TARDE a la que antes: así cada una lleva su
 * «·» delante y, al esconderse las últimas, nunca queda un separador colgando. La línea
 * entera desaparece con la primera, que es la última en tener columna.
 */
type Peca = { text: ReactNode; fins: 'md' | 'lg' | 'xl' }
const AMAGA: Record<Peca['fins'], string> = { md: 'md:hidden', lg: 'lg:hidden', xl: 'xl:hidden' }
const RANG: Record<Peca['fins'], number> = { xl: 0, lg: 1, md: 2 }

function Secundari({ peces }: { peces: Peca[] }) {
  const visibles = peces
    .filter((p) => p.text !== null && p.text !== undefined && p.text !== '')
    .sort((a, b) => RANG[a.fins] - RANG[b.fins])
  if (visibles.length === 0) return null
  return (
    <span className={cn('block text-xs text-muted-foreground', AMAGA[visibles[0].fins])}>
      {visibles.map((p, i) => (
        <span key={i} className={AMAGA[p.fins]}>{i > 0 && ' · '}{p.text}</span>
      ))}
    </span>
  )
}

export default function Documents() {
  const { t } = useT()
  const navigate = useNavigate()
  // «Reenvia» manda un correo. Con las notificaciones apagadas (§8) es un envío manual: el
  // botón sigue y la confirmación lo dice (`acceptaEnviament`).
  const motiuEmail = motiuCanal(useCanals(), 'email')
  // `?tab=` como en Albarans: el tablero manda aquí la cola «PDF amb error», y aterrizar en
  // «Tots» dejaba los fallidos mezclados con el resto.
  const [params] = useSearchParams()
  const PESTANYES = ['tots', 'error', 'conciliar', 'discrepancia', 'enviaments', 'signatures']
  const pestanyaInicial = PESTANYES.includes(params.get('tab') ?? '') ? (params.get('tab') as string) : 'tots'
  const [documents, setDocuments] = useState<Fila[]>([])
  const [albarans, setAlbarans] = useState<AlbaranBandeja[]>([])
  const [enviaments, setEnviaments] = useState<Enviament[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { cerca, setCerca, q } = useCerca()
  const [reenviant, setReenviant] = useState<string | null>(null)
  const { pregunta, dialeg } = useConfirmaEnviament()
  // La firma de la contraparte de cada documento firmable (circuito de firma, 05-11-2026).
  const [signatures, setSignatures] = useState<SignaturaBandeja[]>([])
  const [filtreSig, setFiltreSig] = useState<EstatSignatura>('signat')

  const carrega = useCallback(async () => {
    // ⚠️ La lista de columnas va en UN literal: partida, supabase-js pierde el tipo de
    // la fila y deja de compilar (§7, deuda 46).
    const { data: files, error: errCarrega } = await supabase
      .from('documentos')
      .select('id, tipo, subtipo, numero_completo, version, serie, ejercicio, modo, idioma, estado, intentos, ultimo_error, paginas, emitido_at, vigente')
      .order('emitido_at', { ascending: false })
    return { files: (files as Fila[] | null) ?? [], errCarrega }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { files, errCarrega } = await carrega()
      if (cancelled) return
      if (errCarrega) setError(errCarrega.message)
      else setDocuments(files)
      setCarregant(false)
    })()
    return () => { cancelled = true }
  }, [carrega])

  // La bandeja de albaranes va aparte y su fallo no tumba la pantalla: si la migración de
  // la fase 3 todavía no está aplicada, esas dos pestañas salen vacías y la lista de
  // documentos —que es lo que esta pantalla es— sigue funcionando igual.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('v_albaranes_bandeja')
        .select('id, tipo, numero_completo, estado, ejercicio, excedente_id, espigolada_id, canalizacion_id, id_excedente, producto, productor_id, entidad_id, codigo_lote, emitido_at, entregado_at, confirmado_at, conciliado_at, rechazo, kg_previstos, kg_neto, kg_confirmados, kg_validados, dias_esperando')
        .in('estado', ['emitido', 'entregado', 'confirmado'])
      if (!cancelled) setAlbarans((data as AlbaranBandeja[] | null) ?? [])
    })()
    return () => { cancelled = true }
  }, [])

  // Los correos, también aparte y también fail-soft: si la migración que generalizó
  // `documento_envios` no está aplicada, PostgREST responde `42703` por las columnas
  // nuevas y lo único que pasa es que esta pestaña sale vacía.
  const carregaEnviaments = useCallback(async () => {
    // ⚠️ Lista de columnas en UN literal (§7). No se pide el asunto porque la tabla
    // NO lo guarda, y es deliberado (§12.25).
    const { data: files } = await supabase
      .from('documento_envios')
      .select('id, documento_id, destinatario, estado, proposito, funcion, error, enviado_at, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_ENVIAMENTS)
    return (files as Enviament[] | null) ?? []
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const files = await carregaEnviaments()
      if (!cancelled) setEnviaments(files)
    })()
    return () => { cancelled = true }
  }, [carregaEnviaments])

  const carregaSignatures = useCallback(async () => {
    const r = await carregaBandejaSignatures()
    if (r.ok) setSignatures(r.data)
    else console.warn('v_signatures_bandeja:', r.missatge)
  }, [])

  useEffect(() => { void carregaSignatures() }, [carregaSignatures])

  const sigPerDoc = useMemo(() => new Map(signatures.map((x) => [x.documento_id, x])), [signatures])

  /**
   * Vuelve a mandar el documento por correo, al destinatario que ya tenía. Pregunta antes:
   * es un correo que sale a una organización. El destinatario solo se conoce cuando se
   * reenvía desde la pestaña de envíos (`documentos.envio` no lo lee el panel).
   */
  async function reenvia(documentoId: string, numero: string | null, destinatari: string | null) {
    // Pendiente de firma con trazo: el correo puede llevar el enlace para firmar en línea.
    const sig = sigPerDoc.get(documentoId)
    const acceptat = await pregunta(motiuEmail, {
      titol: t('doc.resend_title', { num: numero ?? '—' }),
      descripcio: destinatari
        ? t('doc.resend_desc_to', { email: destinatari })
        : t('doc.resend_desc'),
      confirmar: t('doc.resend'),
      ambCasellaSignatura: sig?.estat === 'pendent' && sig.admet_canvas,
    })
    if (!acceptat) return
    setReenviant(documentoId)
    const r = await reenviarDocument(documentoId, acceptat)
    setReenviant(null)
    if (!r.ok) {
      toast.error(t(r.motiuKey))
    } else if (r.simulat) {
      toast.info(t('doc.resend_simulat'))
    } else {
      toast.success(r.destinatari
        ? t('doc.resend_ok_to', { email: r.destinatari })
        : t('doc.resend_ok'))
    }
    setEnviaments(await carregaEnviaments())
  }

  /** Recarga silenciosa: tras generarse un PDF, la fila ya no dice «Generant…». */
  const refresca = useCallback(async () => {
    const { files, errCarrega } = await carrega()
    if (!errCarrega) setDocuments(files)
  }, [carrega])

  // La espera de «Generant…» y la descarga las lleva el hook: eran las mismas veinte
  // líneas que `AlbaraDetall` y los paneles externos, y `ocupat`/`generant` significan aquí
  // exactamente lo mismo que significaban en el estado local.
  const descarregador = useDescarregaDocument(refresca)

  const { tots, ambError } = useMemo(() => {
    const tots = filtraCerca(documents, q, (d) => [d.numero_completo, d.tipo, d.subtipo, d.serie, String(d.ejercicio)])
    return { tots, ambError: tots.filter((d) => d.estado === 'error') }
  }, [documents, q])

  const { perConciliar, ambDiscrepancia } = useMemo(() => {
    const filtrats = filtraCerca(albarans, q, (a) => [a.numero_completo, a.tipo, a.id_excedente, a.producto])
    return {
      // Quien más lleva esperando, primero: es quien bloquea el cierre anual de su donante.
      perConciliar: filtrats
        .filter((a) => a.estado === 'entregado' || a.estado === 'confirmado')
        .sort((x, y) => (y.dias_esperando ?? 0) - (x.dias_esperando ?? 0)),
      ambDiscrepancia: filtrats.filter((a) =>
        a.rechazo !== 'cap'
        || (a.kg_confirmados != null && a.kg_neto != null
            && Number(a.kg_confirmados) !== Number(a.kg_neto))),
    }
  }, [albarans, q])

  /** El número del documento asociado, si lo hay: ya está cargado, no hace falta un join. */
  const numeroPerDocument = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of documents) if (d.numero_completo) m.set(d.id, d.numero_completo)
    return m
  }, [documents])

  const enviamentsFiltrats = useMemo(() => {
    return filtraCerca(enviaments, q, (e) => [
      e.destinatario, e.proposito, e.funcion,
      e.documento_id ? numeroPerDocument.get(e.documento_id) : null,
    ])
  }, [enviaments, q, numeroPerDocument])

  const enviamentsAmbError = useMemo(
    () => enviamentsFiltrats.filter((e) => e.estado === 'error').length,
    [enviamentsFiltrats],
  )

  // Las tres tablas siguen el criterio de las tablas (03-11-2026, AGENTS.md §2): caben a
  // 360 px sin scroll horizontal —en móvil quedan lo que identifica la fila, su estado y las
  // acciones; lo demás va bajo el dato principal (`Secundari`) hasta que su columna cabe—,
  // títulos centrados y acciones en iconos con tooltip, apiladas en móvil.

  function taula(llista: Fila[], buitKey: string) {
    if (llista.length === 0) {
      return <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
    }
    // Móvil: número, estado y acciones. `md`: + tipo y fecha. `lg`: + modo. `xl`: todo.
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('doc.c_number')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('doc.c_type')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('doc.c_subtype')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('doc.c_version')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('doc.c_mode')}</TableHead>
            <TableHead>{t('doc.c_status')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('doc.c_date')}</TableHead>
            <TableHead className="w-15 md:w-30">
              <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {llista.map((d) => {
            const esperant = descarregador.generant === d.id
            const ocupat = descarregador.ocupat === d.id
            const fase = d.subtipo ? t(`doc.sub_${d.subtipo}`) : null
            return (
              <TableRow key={d.id}>
                <TableCell>
                  {/* Sin `whitespace-nowrap`: un número de convenio («P-CONV-COL-PROD-…») no
                      cabe entero a 360 px y parte por los guiones. */}
                  <span className="font-medium tabular-nums">{d.numero_completo ?? '—'}</span>
                  <Secundari peces={[
                    { text: fase, fins: 'xl' },
                    { text: `v${d.version}`, fins: 'xl' },
                    { text: d.tipo, fins: 'md' },
                    { text: dataCurta(d.emitido_at), fins: 'md' },
                  ]} />
                  {d.modo === 'prueba' && (
                    <Badge className="mt-1 bg-coral-suave text-coral-texto lg:hidden">{t('doc.mode_test')}</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden text-center md:table-cell">
                  <Badge variant="outline" className="tabular-nums">{d.tipo}</Badge>
                </TableCell>
                <TableCell className="hidden text-center text-muted-foreground xl:table-cell">
                  {fase ?? '—'}
                </TableCell>
                <TableCell className="hidden text-center tabular-nums xl:table-cell">v{d.version}</TableCell>
                <TableCell className="hidden text-center lg:table-cell">
                  {d.modo === 'prueba'
                    ? <Badge className="bg-coral-suave text-coral-texto">{t('doc.mode_test')}</Badge>
                    : <span className="text-muted-foreground">{t('doc.mode_real')}</span>}
                </TableCell>
                <TableCell className="text-center">
                  <Badge
                    className={cn('whitespace-normal', ESTIL_ESTAT[d.estado])}
                    title={d.estado === 'error' ? (d.ultimo_error ?? undefined) : undefined}
                  >
                    {t(esperant
                      ? 'doc.st_generating'
                      : senseResposta(d) ? 'doc.st_encallat' : CLAU_ESTAT[d.estado])}
                  </Badge>
                </TableCell>
                <TableCell className="hidden text-center whitespace-nowrap text-muted-foreground tabular-nums md:table-cell">
                  {dataCurta(d.emitido_at)}
                </TableCell>
                <TableCell>
                  {/* «Veure el PDF» va delante: en esta bandeja se abre un PDF para
                      comprobarlo, y la descarga es lo excepcional. */}
                  <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                    <BotoIcona
                      icona={esperant ? Loader2 : FileText}
                      etiqueta={t(esperant ? 'doc.generating' : 'doc.a_view_pdf')}
                      className={esperant ? '[&_svg]:animate-spin' : undefined}
                      disabled={ocupat}
                      onClick={() => void descarregador.mostra(d.id)}
                    />
                    <BotoIcona
                      icona={ocupat ? Loader2 : Download}
                      etiqueta={t(esperant ? 'doc.generating' : 'doc.download')}
                      className={ocupat ? '[&_svg]:animate-spin' : undefined}
                      disabled={ocupat}
                      onClick={() => void descarregador.descarrega(d.id)}
                    />
                    {TIPUS_ENVIABLES.has(d.tipo) && d.estado === 'emitido' && (
                      <BotoIcona
                        icona={reenviant === d.id ? Loader2 : Mail}
                        etiqueta={t('doc.a_resend_mail')}
                        className={reenviant === d.id ? '[&_svg]:animate-spin' : undefined}
                        disabled={reenviant === d.id}
                        onClick={() => void reenvia(d.id, d.numero_completo, null)}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  /** Tabla mínima de albaranes: número, tipo, kilos, estado y el enlace a su ficha. */
  function taulaAlbarans(llista: AlbaranBandeja[], buitKey: string) {
    if (llista.length === 0) return <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
    // Móvil: número, estado y acción. `md`: + tipo y kilos. `lg`: + espera. `xl`: + producto.
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('alb.c_number')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('alb.c_type')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('alb.c_product')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('alb.c_kg')}</TableHead>
            <TableHead>{t('alb.c_status')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('alb.c_waiting')}</TableHead>
            <TableHead className="w-15 md:w-22">
              <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {llista.map((a) => {
            const ruta = `/equip/albarans/${a.id}`
            const kilos = kg(a.kg_confirmados ?? a.kg_neto ?? a.kg_previstos)
            const espera = a.dias_esperando != null ? t('alb.days', { n: a.dias_esperando }) : dataCurta(a.emitido_at)
            return (
              <TableRow key={a.id}>
                <TableCell>
                  <Link to={ruta} className="font-medium whitespace-nowrap text-primary tabular-nums hover:underline">
                    {a.numero_completo ?? t('alb.no_number')}
                  </Link>
                  <Secundari peces={[
                    { text: a.producto, fins: 'xl' },
                    { text: espera, fins: 'lg' },
                    { text: a.tipo, fins: 'md' },
                    { text: kilos, fins: 'md' },
                  ]} />
                </TableCell>
                <TableCell className="hidden text-center md:table-cell"><Badge variant="outline">{a.tipo}</Badge></TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">{a.producto ?? '—'}</TableCell>
                <TableCell className="hidden text-center tabular-nums whitespace-nowrap md:table-cell">{kilos}</TableCell>
                <TableCell className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Badge className={cn('whitespace-normal', estilEstatAlbara(a.estado))}>{t(`alb.st_${a.estado}`)}</Badge>
                    {a.rechazo !== 'cap' && (
                      <Badge className="whitespace-normal bg-error-fondo text-error">{t(`alb.rj_${a.rechazo}`)}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden text-center whitespace-nowrap tabular-nums text-muted-foreground lg:table-cell">
                  {espera}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                    <BotoIcona icona={Eye} etiqueta={t('alb.a_open')} onClick={() => navigate(ruta)} />
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  /** Los correos: quién, para qué, por dónde salió y si salió. */
  function taulaEnviaments() {
    if (enviamentsFiltrats.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          {t(enviaments.length === 0 ? 'doc.empty_sends' : 'doc.no_match_sends')}
        </p>
      )
    }
    // Móvil: destinatario, estado y acción. `md`: + fecha. `lg`: + propósito y documento.
    // `xl`: + función.
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden md:table-cell">{t('doc.c_date')}</TableHead>
            <TableHead>{t('doc.c_to')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('doc.c_purpose')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('doc.c_function')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('doc.c_document')}</TableHead>
            <TableHead>{t('doc.c_status')}</TableHead>
            <TableHead className="w-15 md:w-22">
              <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {enviamentsFiltrats.map((e) => {
            const numero = e.documento_id ? numeroPerDocument.get(e.documento_id) : null
            const proposit = CLAU_PROPOSIT[e.proposito] ? t(CLAU_PROPOSIT[e.proposito]) : e.proposito
            const quan = dataHora(e.enviado_at ?? e.created_at)
            return (
              <TableRow key={e.id}>
                <TableCell className="hidden text-center text-muted-foreground tabular-nums md:table-cell">
                  {quan}
                </TableCell>
                {/* `wrap-anywhere`: un correo es una sola palabra larga, y en una tabla de
                    ancho automático solo así deja de imponer su ancho a la columna. */}
                <TableCell>
                  <span className="block font-medium wrap-anywhere">{e.destinatario}</span>
                  <Secundari peces={[
                    { text: e.funcion, fins: 'xl' },
                    { text: proposit, fins: 'lg' },
                    { text: numero, fins: 'lg' },
                    { text: quan, fins: 'md' },
                  ]} />
                </TableCell>
                <TableCell className="hidden text-center lg:table-cell">
                  <Badge variant="outline" className="whitespace-normal">{proposit}</Badge>
                </TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">{e.funcion ?? '—'}</TableCell>
                <TableCell className="hidden text-center whitespace-nowrap tabular-nums text-muted-foreground lg:table-cell">
                  {/* Sin número no se inventa nada: la mayoría de los correos no llevan
                      documento, y el `documento_id` de los que lo llevan puede apuntar a
                      uno que ya no está (la FK es `on delete cascade`, pero la fila del
                      envío se va con él). */}
                  {numero ?? '—'}
                </TableCell>
                <TableCell className="text-center">
                  <Badge className={cn('whitespace-normal', ESTIL_ENVIAMENT[e.estado])}>{t(CLAU_ENVIAMENT[e.estado])}</Badge>
                  {e.estado === 'error' && e.error && (
                    <p className="mt-1 text-left text-xs wrap-anywhere text-error">{e.error}</p>
                  )}
                </TableCell>
                <TableCell>
                  {/* Solo los correos de un documento: el resto (accesos, avisos) no se
                      reenvían desde aquí, cada uno tiene su propia pantalla. */}
                  {e.proposito === 'document' && e.documento_id && (
                    <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                      <BotoIcona
                        icona={reenviant === e.documento_id ? Loader2 : Mail}
                        etiqueta={t('doc.a_resend_mail')}
                        className={reenviant === e.documento_id ? '[&_svg]:animate-spin' : undefined}
                        disabled={reenviant === e.documento_id}
                        onClick={() => void reenvia(e.documento_id!, numero ?? null, e.destinatario)}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  // Un CONV «pendent» no espera nada de nadie (se firma por su circuito): no es un pendiente.
  const signaturesFiltrades = useMemo(() => filtraCerca(
    signatures.filter((x) => x.estat === filtreSig && (x.estat !== 'pendent' || x.admet_canvas)),
    q, (x) => [x.numero_completo, x.tipo, x.org_nom, x.signant_nom],
  ), [signatures, filtreSig, q])

  /** La firma de cada documento: quién, por dónde, cuándo y qué se puede hacer. */
  function taulaSignatures() {
    if (signaturesFiltrades.length === 0) {
      return <p className="text-sm text-muted-foreground">{t(`doc.empty_sig_${filtreSig}`)}</p>
    }
    // Móvil: número (con la organización debajo), estado y acciones. `md`: + vía y fecha.
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('doc.c_number')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('doc.c_org')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('doc.c_via')}</TableHead>
            <TableHead>{t('doc.c_status')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('doc.c_date')}</TableHead>
            <TableHead className="w-15 md:w-36">
              <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signaturesFiltrades.map((x) => {
            const ruta = rutaSignatura(x)
            const quan = dataCurta(x.tancat_at ?? x.signat_at ?? x.emitido_at)
            const via = x.via ? t(clauVia(x.via)) : null
            return (
              <TableRow key={x.documento_id} data-testid="fila-signatura">
                <TableCell>
                  {ruta
                    ? <Link to={ruta} className="font-medium text-primary tabular-nums hover:underline">{x.numero_completo}</Link>
                    : <span className="font-medium tabular-nums">{x.numero_completo}</span>}
                  <Secundari peces={[
                    { text: x.org_nom, fins: 'lg' },
                    { text: via, fins: 'md' },
                    { text: quan, fins: 'md' },
                  ]} />
                  {x.modo === 'prueba' && (
                    <Badge className="mt-1 bg-coral-suave text-coral-texto">{t('doc.mode_test')}</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">{x.org_nom ?? '—'}</TableCell>
                <TableCell className="hidden text-center text-muted-foreground md:table-cell">{via ?? '—'}</TableCell>
                <TableCell className="text-center">
                  <BadgeSignatura estat={x.estat} perspectiva="equip" />
                </TableCell>
                <TableCell className="hidden text-center whitespace-nowrap tabular-nums text-muted-foreground md:table-cell">
                  {quan}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                    <BotoIcona
                      icona={FileText}
                      etiqueta={t('doc.a_view_pdf')}
                      disabled={descarregador.ocupat === x.documento_id}
                      onClick={() => void descarregador.mostra(x.documento_id)}
                    />
                    {TIPUS_ENVIABLES_SIG.has(x.tipo) && x.estat === 'pendent' && (
                      <BotoIcona
                        icona={reenviant === x.documento_id ? Loader2 : Mail}
                        etiqueta={t('doc.a_resend_mail')}
                        className={reenviant === x.documento_id ? '[&_svg]:animate-spin' : undefined}
                        disabled={reenviant === x.documento_id}
                        onClick={() => void reenvia(x.documento_id, x.numero_completo, null)}
                      />
                    )}
                    <AccionsSignatura sig={x} variant="icones" ambBadge={false}
                      onCanvi={() => { void carregaSignatures(); void refresca() }} />
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  const buitKey = documents.length === 0 ? 'doc.empty' : 'doc.no_match'

  return (
    <Card>
      {dialeg}
      <CardHeader>
        <CardTitle>{t('doc.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('doc.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          type="search"
          placeholder={t('doc.search')}
          value={cerca}
          onChange={(e) => setCerca(e.target.value)}
        />
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}

        {!carregant && !error && (
          <Tabs defaultValue={pestanyaInicial}>
            {/* Las tres etiquetas no caben a 360 px: la lista scrollea ella sola en vez
                de empujar la página entera hacia la derecha. */}
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList>
                <TabsTrigger value="tots">{t('doc.tab_all', { n: tots.length })}</TabsTrigger>
                <TabsTrigger value="error">{t('doc.tab_error', { n: ambError.length })}</TabsTrigger>
                <TabsTrigger value="conciliar">{t('doc.tab_toreconcile', { n: perConciliar.length })}</TabsTrigger>
                <TabsTrigger value="discrepancia">{t('doc.tab_mismatch', { n: ambDiscrepancia.length })}</TabsTrigger>
                <TabsTrigger value="enviaments">{t('doc.tab_sends', { n: enviamentsFiltrats.length })}</TabsTrigger>
                <TabsTrigger value="signatures">{t('doc.tab_signatures', { n: signatures.filter((x) => x.estat === 'signat').length })}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="tots" className="space-y-2">
              {taula(tots, buitKey)}
            </TabsContent>

            <TabsContent value="error" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('doc.error_hint')}</p>
              {taula(ambError, 'doc.empty_error')}
            </TabsContent>

            <TabsContent value="conciliar" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('doc.hint_toreconcile')}</p>
              {taulaAlbarans(perConciliar, 'doc.empty_toreconcile')}
            </TabsContent>

            <TabsContent value="discrepancia" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('doc.hint_mismatch')}</p>
              {taulaAlbarans(ambDiscrepancia, 'doc.empty_mismatch')}
            </TabsContent>

            <TabsContent value="enviaments" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('doc.hint_sends')}</p>
              {enviamentsAmbError > 0 && (
                <p className="text-sm text-error">{t('doc.sends_failed', { n: enviamentsAmbError })}</p>
              )}
              {enviaments.length >= MAX_ENVIAMENTS && (
                <p className="text-xs text-muted-foreground">
                  {t('doc.limit_sends', { n: MAX_ENVIAMENTS })}
                </p>
              )}
              {taulaEnviaments()}
            </TabsContent>

            <TabsContent value="signatures" className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('doc.hint_signatures')}</p>
              <div className="space-y-1.5 sm:max-w-xs">
                <Label htmlFor="doc-filtre-sig">{t('doc.f_sig')}</Label>
                <Desplegable
                  id="doc-filtre-sig"
                  value={filtreSig}
                  onChange={(v) => setFiltreSig(v as EstatSignatura)}
                  opcions={(['signat', 'pendent', 'tancat'] as const).map((e) => ({ valor: e, text: t(`doc.f_sig_${e}`) }))}
                />
              </div>
              {taulaSignatures()}
            </TabsContent>
          </Tabs>
        )}

        {/* El visor de PDF. Una sola vez por pantalla: el modal se pinta en un portal,
            así que da igual dentro de qué pestaña esté la fila que lo abrió. */}
        {descarregador.visor}
      </CardContent>
    </Card>
  )
}
