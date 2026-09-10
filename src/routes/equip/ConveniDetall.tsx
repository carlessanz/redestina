// El detalle de un convenio: donde el equipo lo manda a firmar y donde lo contrafirma.
//
// TRES CAMINOS, Y LA PANTALLA NO DECIDE NINGUNO. Enviar (el enlace por correo), conducir
// la firma asistida (el mismo enlace, abierto aquí con la persona delante) y contrafirmar
// (validar y estampar). Cuál se puede hacer lo dice el estado del convenio y lo revalida
// la base: aquí solo se enseña el que toca, para que nadie pulse a ciegas.
//
// EL TOKEN EN CLARO SOLO EXISTE UNA VEZ, en la respuesta de la RPC. Se enseña como enlace
// copiable —el modelo de Redestina es asistido (§1bis): hay firmas que se conducen por
// teléfono— y se puede mandar por correo con la plantilla de marca. No se guarda: al
// recargar la pantalla ya no está, y hay que reenviar (lo que revoca el anterior).
//
// ⚠️ EL DOCUMENTO DE IDENTIDAD DEL FIRMANTE NO SALE AQUÍ, y no es un olvido: la columna
//    `evidencias.documento_identidad` está fuera del GRANT de SELECT de `authenticated`
//    (20260928100300), así que esta pantalla no puede leerlo aunque lo pidiera. Si algún
//    día aparece en un `.select()`, la consulta entera fallará con `permission denied for
//    column` — que es exactamente la protección funcionando.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { dataCurta } from '../../lib/albarans'
import {
  contrafirmarConveni, enviarConveni, enviarCorreuConveni, estilEstatConveni,
  iniciarFirmaAssistida, resoldreConveni, retornarConveni, urlSignatura,
} from '../../lib/convenis'
import type { EnllacFirma } from '../../lib/convenis'
import type { Convenio, Documento, EnlaceToken, Evidencia } from '../../types'
import DialegMotiu from '../../components/DialegMotiu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Fila = Pick<
  Convenio,
  | 'id' | 'tipo' | 'tipo_org' | 'productor_id' | 'entidad_id' | 'numero_completo' | 'estado'
  | 'idioma' | 'roles_com' | 'datos_org' | 'firmante' | 'enviado_at' | 'firmado_at'
  | 'contrafirmado_at' | 'devuelto_at' | 'motivo_devolucion' | 'resuelto_at'
  | 'fecha_efecto_resolucion' | 'motivo_resolucion' | 'created_at'
>

type DocFila = Pick<
  Documento,
  'id' | 'tipo' | 'subtipo' | 'numero_completo' | 'version' | 'estado' | 'vigente' | 'emitido_at'
>

// ⚠️ Sin `documento_identidad`: ver la nota de la cabecera.
type EvidenciaFila = Pick<
  Evidencia,
  'id' | 'enlace_id' | 'tipo' | 'nombre' | 'cargo' | 'declaracion_representacion'
  | 'ip' | 'sha256_texto' | 'asistido_por' | 'created_at'
>

type EnllacFila = Pick<
  EnlaceToken,
  'id' | 'destinatario_email' | 'destinatario_nombre' | 'canal' | 'estado'
  | 'caduca_at' | 'abierto_at' | 'usado_at' | 'recordatorios' | 'created_at'
>

/** Los campos de la copia congelada, en el orden en que se leen en el papel. */
const CAMPS_ORG: { clau: string; label: string }[] = [
  { clau: 'raso_social', label: 'sig.f_raso' },
  { clau: 'nom_comercial', label: 'sig.f_comercial' },
  { clau: 'nif', label: 'sig.f_nif' },
  { clau: 'domicili', label: 'sig.f_domicili' },
  { clau: 'codi_postal', label: 'sig.f_cp' },
  { clau: 'poblacio', label: 'sig.f_poblacio' },
  { clau: 'representant', label: 'sig.f_representant' },
  { clau: 'carrec', label: 'sig.f_carrec' },
  { clau: 'email', label: 'sig.f_email' },
]

function valor(o: Record<string, unknown> | null, clau: string): string {
  const v = o?.[clau]
  return typeof v === 'string' && v.trim() !== '' ? v : '—'
}

export default function ConveniDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const { ctx } = useAppContext()

  const [conv, setConv] = useState<Fila | null>(null)
  const [nomFitxa, setNomFitxa] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocFila[]>([])
  const [enllacos, setEnllacos] = useState<EnllacFila[]>([])
  const [evidencies, setEvidencies] = useState<EvidenciaFila[]>([])
  const [carregant, setCarregant] = useState(true)
  const [ocupat, setOcupat] = useState(false)

  /** El enlace recién creado. Solo vive en esta pantalla y una vez (ver cabecera). */
  const [enllacNou, setEnllacNou] = useState<EnllacFirma | null>(null)
  const [codiAssistit, setCodiAssistit] = useState<string | null>(null)
  const [correu, setCorreu] = useState('')

  const [dialegRetorn, setDialegRetorn] = useState(false)
  const [dialegResol, setDialegResol] = useState(false)
  const [dataEfecte, setDataEfecte] = useState('')

  // Con el contexto degradado (RPC de sesión no desplegada) se asume que sí, como se ha
  // comportado la app siempre. La RPC revalida y devuelve 42501.
  const potAprovar = ctx?.potAprovar ?? true

  const carrega = useCallback(async () => {
    if (!id) return
    // ⚠️ Lista de columnas en UN literal (§7, deuda 46).
    const { data } = await supabase
      .from('convenios')
      .select('id, tipo, tipo_org, productor_id, entidad_id, numero_completo, estado, idioma, roles_com, datos_org, firmante, enviado_at, firmado_at, contrafirmado_at, devuelto_at, motivo_devolucion, resuelto_at, fecha_efecto_resolucion, motivo_resolucion, created_at')
      .eq('id', id)
      .maybeSingle()

    const fila = (data as Fila | null) ?? null
    setConv(fila)
    setCarregant(false)
    if (!fila) return

    const [fitxa, docs, links] = await Promise.all([
      fila.tipo_org === 'productor' && fila.productor_id
        ? supabase.from('productores').select('id, name, empresa, email').eq('id', fila.productor_id).maybeSingle()
        : fila.entidad_id
          ? supabase.from('entidades').select('id, nombre, email').eq('id', fila.entidad_id).maybeSingle()
          : Promise.resolve({ data: null }),
      supabase.from('documentos')
        .select('id, tipo, subtipo, numero_completo, version, estado, vigente, emitido_at')
        .eq('objeto_tipo', 'convenio').eq('objeto_id', fila.id)
        .order('version', { ascending: false }),
      supabase.from('enlaces_token')
        .select('id, destinatario_email, destinatario_nombre, canal, estado, caduca_at, abierto_at, usado_at, recordatorios, created_at')
        .eq('objeto_tipo', 'convenio').eq('objeto_id', fila.id)
        .order('created_at', { ascending: false }),
    ])

    const f = fitxa.data as { name?: string | null; empresa?: string | null; nombre?: string | null; email?: string | null } | null
    setNomFitxa(f ? (f.empresa || f.name || f.nombre || null) : null)
    // El correo por defecto del envío: el de la ficha, que es donde el equipo lo corrige.
    setCorreu((f?.email as string | null) ?? valorSegur(fila.datos_org, 'email'))
    setDocuments((docs.data as DocFila[] | null) ?? [])

    const llista = (links.data as EnllacFila[] | null) ?? []
    setEnllacos(llista)
    if (llista.length === 0) { setEvidencies([]); return }
    const { data: evs } = await supabase
      .from('evidencias')
      .select('id, enlace_id, tipo, nombre, cargo, declaracion_representacion, ip, sha256_texto, asistido_por, created_at')
      .in('enlace_id', llista.map((l) => l.id))
      .order('created_at', { ascending: true })
    setEvidencies((evs as EvidenciaFila[] | null) ?? [])
  }, [id])

  useEffect(() => { void carrega() }, [carrega])

  const descarregador = useDescarregaDocument(() => carrega())

  async function envia() {
    if (!conv) return
    setOcupat(true)
    const res = await enviarConveni(conv.id, correu.trim() || null)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    setEnllacNou(res.data.enllac)
    setCodiAssistit(null)
    toast.success(t('conv.sent'))
    await carrega()
  }

  async function firmaAssistida() {
    if (!conv) return
    setOcupat(true)
    const res = await iniciarFirmaAssistida(conv.id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    setEnllacNou(res.data.enllac)
    // El código puede venir a `null`: sin correo en la ficha no hay segundo factor, y eso
    // se dice en pantalla en vez de dejar a quien conduce la firma esperando un SMS que
    // no existe (§3.2.5).
    setCodiAssistit(res.data.codi)
    toast.success(t('conv.assisted_ready'))
    await carrega()
  }

  async function mandaCorreu() {
    if (!conv || !enllacNou) return
    const desti = correu.trim() || enllacNou.destinatari || ''
    if (desti === '') { toast.error(t('conv.no_email')); return }
    setOcupat(true)
    const res = await enviarCorreuConveni({
      email: desti,
      nom: enllacNou.nom ?? null,
      token: enllacNou.token,
      assumpte: t('conv.mail_subject'),
      titol: t('conv.mail_title'),
      preheader: t('conv.mail_preheader'),
      cos: t('conv.mail_body'),
      boto: t('conv.mail_button'),
      nota: t('conv.mail_note'),
    })
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge ?? t('conv.mail_error')); return }
    toast.success(t('conv.mail_sent', { email: desti }))
  }

  async function contrafirma() {
    if (!conv) return
    setOcupat(true)
    const res = await contrafirmarConveni(conv.id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('conv.countersigned'))
    await carrega()
  }

  async function retorna(motiu: string) {
    if (!conv) return
    setOcupat(true)
    const res = await retornarConveni(conv.id, motiu)
    setOcupat(false)
    setDialegRetorn(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('conv.returned'))
    await carrega()
  }

  async function resol(motiu: string) {
    if (!conv) return
    setOcupat(true)
    const res = await resoldreConveni(conv.id, motiu, dataEfecte || null)
    setOcupat(false)
    setDialegResol(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('conv.resolved'))
    await carrega()
  }

  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  if (!conv) return <p className="text-sm text-muted-foreground">{t('conv.not_found')}</p>

  const potEnviar = conv.estado === 'esborrany' || conv.estado === 'pendent_firma' || conv.estado === 'retornat'
  const potContrafirmar = conv.estado === 'firmat'
  const potResoldre = conv.estado === 'vigent'
  const firmant = conv.firmante ?? {}

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
        <Link to="/equip/convenis"><ArrowLeft className="size-4" /> {t('nav.convenis')}</Link>
      </Button>

      {/* ── Cabecera y acciones ── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>{valor(conv.datos_org, 'raso_social') !== '—'
                ? valor(conv.datos_org, 'raso_social')
                : (nomFitxa ?? '—')}</CardTitle>
              <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                {conv.numero_completo ?? t('conv.no_number')} · {t(`sig.model_${conv.tipo}`)}
                {conv.roles_com.length > 0 ? ` · ${conv.roles_com.map((r) => t(`conv.role_${r}`)).join(', ')}` : ''}
              </p>
            </div>
            <Badge className={estilEstatConveni(conv.estado)}>{t(`conv.st_${conv.estado}`)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p className="text-muted-foreground">{t('conv.d_sent', { date: dataCurta(conv.enviado_at) })}</p>
            <p className="text-muted-foreground">{t('conv.d_signed', { date: dataCurta(conv.firmado_at) })}</p>
            <p className="text-muted-foreground">{t('conv.d_countersigned', { date: dataCurta(conv.contrafirmado_at) })}</p>
            <p className="text-muted-foreground">{t('conv.d_language', { lang: conv.idioma })}</p>
          </div>

          {conv.estado === 'retornat' && conv.motivo_devolucion && (
            <p className="rounded-md bg-error-fondo p-3 text-sm text-error">
              {t('conv.returned_reason', { motiu: conv.motivo_devolucion })}
            </p>
          )}
          {conv.estado === 'resolt' && (
            <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">
              {t('conv.resolved_note', {
                date: dataCurta(conv.fecha_efecto_resolucion),
                motiu: conv.motivo_resolucion ?? '—',
              })}
            </p>
          )}

          {potEnviar && (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="conv-correu">{t('conv.f_email')}</Label>
                <Input id="conv-correu" type="email" className="h-11 md:h-9"
                  value={correu} onChange={(e) => setCorreu(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className="h-11 whitespace-normal md:h-9" disabled={ocupat}
                  onClick={() => void envia()}>
                  {ocupat && <Loader2 className="size-4 animate-spin" />}{t('conv.send')}
                </Button>
                <Button variant="outline" className="h-11 whitespace-normal md:h-9" disabled={ocupat}
                  onClick={() => void firmaAssistida()}>
                  {t('conv.assisted')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('conv.send_hint')}</p>
            </div>
          )}

          {(potContrafirmar || potResoldre) && (
            <div className="flex flex-wrap gap-2">
              {potContrafirmar && (
                <>
                  <Button className="h-11 whitespace-normal md:h-9" disabled={ocupat || !potAprovar}
                    onClick={() => void contrafirma()}>
                    {ocupat && <Loader2 className="size-4 animate-spin" />}{t('conv.countersign')}
                  </Button>
                  <Button variant="outline" className="h-11 whitespace-normal md:h-9"
                    disabled={ocupat || !potAprovar} onClick={() => setDialegRetorn(true)}>
                    {t('conv.return')}
                  </Button>
                </>
              )}
              {potResoldre && (
                <Button variant="destructive" className="h-11 whitespace-normal md:h-9"
                  disabled={ocupat || !potAprovar} onClick={() => setDialegResol(true)}>
                  {t('conv.resolve')}
                </Button>
              )}
            </div>
          )}
          {!potAprovar && (potContrafirmar || potResoldre) && (
            <p className="text-xs text-muted-foreground">{t('conv.need_approver')}</p>
          )}
        </CardContent>
      </Card>

      {/* ── El enlace recién creado. Solo existe aquí y una vez. ── */}
      {enllacNou && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('conv.link_new')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('conv.link_new_hint')}</p>
            <Input readOnly value={urlSignatura(enllacNou.token)}
              onFocus={(e) => e.currentTarget.select()} />
            {codiAssistit && (
              <p className="rounded-md bg-secondary p-3 text-sm text-secondary-foreground">
                {t('conv.assisted_code', { codi: codiAssistit })}
              </p>
            )}
            {enllacNou.canal === 'asistido' && !codiAssistit && (
              <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('conv.assisted_no_code')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
                <a href={urlSignatura(enllacNou.token)} target="_blank" rel="noopener noreferrer">
                  {t('conv.link_open')}
                </a>
              </Button>
              <Button className="h-11 whitespace-normal md:h-9" disabled={ocupat}
                onClick={() => void mandaCorreu()}>
                {t('conv.link_mail')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── La copia congelada ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('conv.org_title')}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {CAMPS_ORG.map((c) => (
              <div key={c.clau}>
                <p className="text-xs text-muted-foreground">{t(c.label)}</p>
                <p className="text-sm">{valor(conv.datos_org, c.clau)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Quién firmó. NUNCA el documento de identidad (ver cabecera). ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('conv.signer_title')}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {conv.firmado_at ? (
            <>
              <p>{firmant.nombre ?? '—'}{firmant.cargo ? ` · ${firmant.cargo}` : ''}</p>
              <p className="text-muted-foreground">{firmant.email ?? '—'}</p>
              <p className="text-xs text-muted-foreground">{t('conv.signer_no_dni')}</p>
            </>
          ) : (
            <p className="text-muted-foreground">{t('conv.signer_none')}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Versiones del PDF ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('conv.versions')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {documents.length === 0 && <p className="text-sm text-muted-foreground">{t('conv.no_versions')}</p>}
          {documents.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm">
              <div>
                <span className="font-medium tabular-nums">{d.numero_completo} · v{d.version}</span>
                <span className="text-muted-foreground">
                  {' '}{d.subtipo ? t(`conv.sub_${d.subtipo}`) : ''} · {dataCurta(d.emitido_at)}
                </span>
                {!d.vigente && <Badge className="ml-2 bg-muted text-muted-foreground">{t('alb.superseded')}</Badge>}
              </div>
              <Button size="sm" className="h-11 whitespace-normal md:h-8"
                disabled={descarregador.ocupat === d.id}
                onClick={() => void descarregador.descarrega(d.id)}>
                {descarregador.ocupat === d.id
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Download className="size-4" />}
                {t('doc.download')}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Enlaces y evidencias ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('conv.evidence')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {enllacos.length === 0 && <p className="text-sm text-muted-foreground">{t('conv.no_links')}</p>}
          {enllacos.map((e) => (
            <div key={e.id} className="border-b pb-2 text-sm">
              <p className="font-medium">{e.destinatario_nombre || e.destinatario_email || '—'}</p>
              <p className="text-muted-foreground">
                {t(`conv.lk_${e.estado}`)} · {t(`conv.ch_${e.canal}`)} ·{' '}
                {t('alb.expires', { date: dataCurta(e.caduca_at) })}
                {e.recordatorios > 0 ? ` · ${t('conv.reminders', { n: e.recordatorios })}` : ''}
              </p>
              {evidencies.filter((v) => v.enlace_id === e.id).map((v) => (
                <p key={v.id} className="text-xs text-muted-foreground">
                  {t(`conv.ev_${v.tipo}`)} · {dataCurta(v.created_at)}
                  {v.nombre ? ` · ${v.nombre}` : ''}{v.cargo ? ` (${v.cargo})` : ''}
                  {v.ip ? ` · ${v.ip}` : ''}
                  {v.asistido_por ? ` · ${t('conv.ev_assisted')}` : ''}
                </p>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <DialegMotiu
        obert={dialegRetorn}
        onObert={setDialegRetorn}
        titol={t('conv.return_title')}
        descripcio={t('conv.return_desc')}
        etiqueta={t('conv.return_label')}
        confirmar={t('conv.return')}
        ocupat={ocupat}
        onConfirma={(m) => void retorna(m)}
      />

      <DialegMotiu
        obert={dialegResol}
        onObert={setDialegResol}
        titol={t('conv.resolve_title')}
        descripcio={t('conv.resolve_desc')}
        etiqueta={t('conv.resolve_label')}
        confirmar={t('conv.resolve')}
        destructiu
        ocupat={ocupat}
        extra={(
          <div className="space-y-1.5">
            <Label htmlFor="conv-efecte">{t('conv.f_effect_date')}</Label>
            <Input id="conv-efecte" type="date" value={dataEfecte}
              onChange={(e) => setDataEfecte(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('conv.effect_hint')}</p>
          </div>
        )}
        onConfirma={(m) => void resol(m)}
      />
    </div>
  )
}

/** `valor()` con cadena vacía en vez de `—`: sirve para rellenar un input, no para pintar. */
function valorSegur(o: Record<string, unknown> | null, clau: string): string {
  const v = o?.[clau]
  return typeof v === 'string' ? v : ''
}
