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
// «Enllaços caducats» todavía no consulta nada: `enlaces_token` llega con la fase 2
// (firma de convenios). Preferimos una pestaña que diga honestamente que aún no hay
// enlaces a una consulta contra una tabla que no existe, que llenaría la pantalla de un
// error de PostgREST.
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { descarregarDocument, esperarGeneracio } from '../../lib/documents'
import { dataCurta, estilEstatAlbara, kg } from '../../lib/albarans'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { Documento, DocumentoEstado } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
  estado: 'pendent' | 'enviat' | 'simulat' | 'error'
  proposito: string
  funcion: string | null
  error: string | null
  enviado_at: string | null
  created_at: string
}

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
}

const CLAU_ENVIAMENT: Record<Enviament['estado'], string> = {
  enviat: 'doc.se_enviat',
  pendent: 'doc.se_pendent',
  simulat: 'doc.se_simulat',
  error: 'doc.se_error',
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

function data(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Con hora: de un correo importa el momento, no solo el día. */
function dataHora(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function casa(d: Fila, q: string): boolean {
  if (!q) return true
  const camps = [d.numero_completo, d.tipo, d.subtipo, d.serie, String(d.ejercicio)]
  return camps.some((c) => (c ?? '').toLowerCase().includes(q))
}

export default function Documents() {
  const { t } = useT()
  const [documents, setDocuments] = useState<Fila[]>([])
  const [albarans, setAlbarans] = useState<AlbaranBandeja[]>([])
  const [enviaments, setEnviaments] = useState<Enviament[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  /** Id de la fila cuya descarga está en curso, para no dejar pulsar dos veces. */
  const [ocupat, setOcupat] = useState<string | null>(null)
  /** Id de la fila cuyo PDF estamos esperando («Generant…»). */
  const [generant, setGenerant] = useState<string | null>(null)
  // La espera puede durar 30 s: si la pantalla se desmonta antes, hay que cortarla.
  const avortar = useRef<AbortController | null>(null)

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
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // ⚠️ Lista de columnas en UN literal (§7). No se pide el asunto porque la tabla
      // NO lo guarda, y es deliberado (§12.25).
      const { data: files } = await supabase
        .from('documento_envios')
        .select('id, documento_id, destinatario, estado, proposito, funcion, error, enviado_at, created_at')
        .order('created_at', { ascending: false })
        .limit(MAX_ENVIAMENTS)
      if (!cancelled) setEnviaments((files as Enviament[] | null) ?? [])
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => avortar.current?.abort(), [])

  /** Recarga silenciosa: tras generarse un PDF, la fila ya no dice «Generant…». */
  const refresca = useCallback(async () => {
    const { files, errCarrega } = await carrega()
    if (!errCarrega) setDocuments(files)
  }, [carrega])

  async function descarrega(fila: Fila) {
    setOcupat(fila.id)
    const res = await descarregarDocument(fila.id)

    if (res.ok) {
      toast.success(t('doc.downloaded', { name: res.data.nombre }))
      setOcupat(null)
      return
    }
    // Cualquier motivo que no sea «todavía no hay fichero» se cuenta y se acaba aquí.
    if (res.codi !== 'sense_fitxer') {
      toast.error(t(res.motiuKey))
      setOcupat(null)
      return
    }

    // El documento existe y se puede ver, pero el PDF aún se está generando: se espera
    // por polling (2 s / 30 s) y se reintenta una vez. Sin esto, el equipo solo vería un
    // error confuso en el segundo que separa la emisión de la generación.
    setGenerant(fila.id)
    toast.info(t('doc.generating_wait'))
    avortar.current?.abort()
    const control = new AbortController()
    avortar.current = control

    const espera = await esperarGeneracio(fila.id, control.signal)
    setGenerant(null)

    if (espera.resultat === 'cancellat') { setOcupat(null); return }
    if (espera.resultat !== 'emitido') {
      if (espera.motiuKey) toast.error(t(espera.motiuKey))
      await refresca()
      setOcupat(null)
      return
    }

    const segon = await descarregarDocument(fila.id)
    if (segon.ok) toast.success(t('doc.downloaded', { name: segon.data.nombre }))
    else toast.error(t(segon.motiuKey))
    await refresca()
    setOcupat(null)
  }

  const { tots, ambError } = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    const tots = documents.filter((d) => casa(d, q))
    return { tots, ambError: tots.filter((d) => d.estado === 'error') }
  }, [documents, cerca])

  const { perConciliar, ambDiscrepancia } = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    const casaAlb = (a: AlbaranBandeja) => !q
      || [a.numero_completo, a.tipo, a.id_excedente, a.producto].some((c) => (c ?? '').toLowerCase().includes(q))
    const filtrats = albarans.filter(casaAlb)
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
  }, [albarans, cerca])

  /** El número del documento asociado, si lo hay: ya está cargado, no hace falta un join. */
  const numeroPerDocument = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of documents) if (d.numero_completo) m.set(d.id, d.numero_completo)
    return m
  }, [documents])

  const enviamentsFiltrats = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    if (!q) return enviaments
    return enviaments.filter((e) => [
      e.destinatario, e.proposito, e.funcion,
      e.documento_id ? numeroPerDocument.get(e.documento_id) : null,
    ].some((c) => (c ?? '').toLowerCase().includes(q)))
  }, [enviaments, cerca, numeroPerDocument])

  const enviamentsAmbError = useMemo(
    () => enviamentsFiltrats.filter((e) => e.estado === 'error').length,
    [enviamentsFiltrats],
  )

  function taula(llista: Fila[], buitKey: string) {
    if (llista.length === 0) {
      return <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
    }
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('doc.c_number')}</TableHead>
              <TableHead>{t('doc.c_type')}</TableHead>
              <TableHead>{t('doc.c_subtype')}</TableHead>
              <TableHead>{t('doc.c_version')}</TableHead>
              <TableHead>{t('doc.c_mode')}</TableHead>
              <TableHead>{t('doc.c_status')}</TableHead>
              <TableHead>{t('doc.c_date')}</TableHead>
              <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {llista.map((d) => {
              const esperant = generant === d.id
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-medium whitespace-nowrap tabular-nums">
                    {d.numero_completo ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="tabular-nums">{d.tipo}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.subtipo ? t(`doc.sub_${d.subtipo}`) : '—'}
                  </TableCell>
                  <TableCell className="tabular-nums">v{d.version}</TableCell>
                  <TableCell>
                    {d.modo === 'prueba'
                      ? <Badge className="bg-coral-suave text-coral-texto">{t('doc.mode_test')}</Badge>
                      : <span className="text-muted-foreground">{t('doc.mode_real')}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={ESTIL_ESTAT[d.estado]}
                      title={d.estado === 'error' ? (d.ultimo_error ?? undefined) : undefined}
                    >
                      {t(esperant
                        ? 'doc.st_generating'
                        : senseResposta(d) ? 'doc.st_encallat' : CLAU_ESTAT[d.estado])}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {data(d.emitido_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      {/* `h-11` en móvil: es la acción principal de la fila y 32 px es
                          poco para un pulgar. En escritorio vuelve al alto del resto. */}
                      <Button
                        size="sm"
                        className="h-11 whitespace-normal md:h-8"
                        disabled={ocupat === d.id}
                        onClick={() => void descarrega(d)}
                      >
                        {ocupat === d.id
                          ? <Loader2 className="size-4 animate-spin" />
                          : <Download className="size-4" />}
                        {esperant ? t('doc.generating') : t('doc.download')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  /** Tabla mínima de albaranes: número, tipo, kilos, estado y el enlace a su ficha. */
  function taulaAlbarans(llista: AlbaranBandeja[], buitKey: string) {
    if (llista.length === 0) return <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('alb.c_number')}</TableHead>
              <TableHead>{t('alb.c_type')}</TableHead>
              <TableHead>{t('alb.c_product')}</TableHead>
              <TableHead className="text-right">{t('alb.c_kg')}</TableHead>
              <TableHead>{t('alb.c_status')}</TableHead>
              <TableHead>{t('alb.c_waiting')}</TableHead>
              <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {llista.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium whitespace-nowrap tabular-nums">
                  {a.numero_completo ?? t('alb.no_number')}
                </TableCell>
                <TableCell><Badge variant="outline">{a.tipo}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{a.producto ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  {kg(a.kg_confirmados ?? a.kg_neto ?? a.kg_previstos)}
                </TableCell>
                <TableCell>
                  <Badge className={estilEstatAlbara(a.estado)}>{t(`alb.st_${a.estado}`)}</Badge>
                  {a.rechazo !== 'cap' && (
                    <Badge className="ml-1 bg-error-fondo text-error">{t(`alb.rj_${a.rechazo}`)}</Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {a.dias_esperando != null ? t('alb.days', { n: a.dias_esperando }) : dataCurta(a.emitido_at)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button asChild size="sm" variant="outline" className="h-11 whitespace-normal md:h-8">
                      <Link to={`/equip/albarans/${a.id}`}>{t('c.detail')}</Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('doc.c_date')}</TableHead>
              <TableHead>{t('doc.c_to')}</TableHead>
              <TableHead>{t('doc.c_purpose')}</TableHead>
              <TableHead>{t('doc.c_function')}</TableHead>
              <TableHead>{t('doc.c_document')}</TableHead>
              <TableHead>{t('doc.c_status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {enviamentsFiltrats.map((e) => {
              const numero = e.documento_id ? numeroPerDocument.get(e.documento_id) : null
              return (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {dataHora(e.enviado_at ?? e.created_at)}
                  </TableCell>
                  <TableCell className="font-medium break-all">{e.destinatario}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {CLAU_PROPOSIT[e.proposito] ? t(CLAU_PROPOSIT[e.proposito]) : e.proposito}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.funcion ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {/* Sin número no se inventa nada: la mayoría de los correos no llevan
                        documento, y el `documento_id` de los que lo llevan puede apuntar a
                        uno que ya no está (la FK es `on delete cascade`, pero la fila del
                        envío se va con él). */}
                    {numero ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge className={ESTIL_ENVIAMENT[e.estado]}>{t(CLAU_ENVIAMENT[e.estado])}</Badge>
                    {e.estado === 'error' && e.error && (
                      <p className="mt-1 max-w-xs text-xs text-error">{e.error}</p>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  const buitKey = documents.length === 0 ? 'doc.empty' : 'doc.no_match'

  return (
    <Card>
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
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!carregant && !error && (
          <Tabs defaultValue="tots">
            {/* Las tres etiquetas no caben a 360 px: la lista scrollea ella sola en vez
                de empujar la página entera hacia la derecha. */}
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList>
                <TabsTrigger value="tots">{t('doc.tab_all', { n: tots.length })}</TabsTrigger>
                <TabsTrigger value="error">{t('doc.tab_error', { n: ambError.length })}</TabsTrigger>
                <TabsTrigger value="conciliar">{t('doc.tab_toreconcile', { n: perConciliar.length })}</TabsTrigger>
                <TabsTrigger value="discrepancia">{t('doc.tab_mismatch', { n: ambDiscrepancia.length })}</TabsTrigger>
                <TabsTrigger value="enviaments">{t('doc.tab_sends', { n: enviamentsFiltrats.length })}</TabsTrigger>
                <TabsTrigger value="enllacos">{t('doc.tab_links')}</TabsTrigger>
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

            <TabsContent value="enllacos" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('doc.empty_links')}</p>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}
