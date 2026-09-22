import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { sendWhatsApp } from '../lib/whatsapp'
import { enviarEmail } from '../lib/email'
import { priorizarEntidades } from '../lib/redestina'
import type { EntidadPuntuada } from '../lib/redestina'
import { useT } from '../lib/i18n'
import { useConfirma } from './DialegConfirma'
import { textoRecollidaConfirmada } from '../lib/textos'
import { PLANTILLA_OFERTA, PLANTILLA_OFERTA_APROVADA } from '../lib/plantillas'
import { construirComponentsOferta } from '../lib/ofertaTemplate'
import { aprovarResposta, comprovaConvenis, rebutjarResposta } from '../lib/aprovarResposta'
import { etiquetaEstatOferta, PASSOS_OFERTA_CLAUS, puntOferta } from '../lib/procesOferta'
import { refrescaComptadors } from '../lib/pendentsEquip'
import PasosProces from './proces/PasosProces'
import QueTocaAra from './proces/QueTocaAra'
import DialegMotiu from './DialegMotiu'
import DialegEspigolada from './equip/DialegEspigolada'
import BotoAmbMotiu from './proces/BotoAmbMotiu'
import type { Canalizacion, EstadoAlbaran, Excedente, OfertaRespuesta } from '../types'
import { Casella } from './Casella'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  excedente: Excedente
  onBack: () => void
}

// HTML para el portapapeles: cada línea en su propio <div> (el formato nativo de
// los editores rich-text, incluido WhatsApp Web). Es más fiable que un único <div>
// con <br>, que WhatsApp aplana al pegar perdiendo los saltos. Las líneas vacías
// llevan <br> para no colapsarse.
function textoAHtmlPortapapeles(texto: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return texto.split('\n').map((l) => `<div>${l === '' ? '<br>' : esc(l)}</div>`).join('')
}

/** Lo justo para enlazar: número para enseñar, canalización para casar la fila. */
interface AlbaraDelRegistre {
  id: string
  tipo: 'REC' | 'ENT' | 'OPE'
  numero_completo: string | null
  estado: string
  canalizacion_id: string | null
  /** Para contar los días que lleva esperando la confirmación del productor. */
  entregado_at: string | null
}

// Fila de oferta_respuestas con el nombre de la entidad (embed de PostgREST).
type RespuestaConEntidad = OfertaRespuesta & {
  entidades: { nombre: string; poblacion: string | null } | null
}

function fechaCorta(iso: string): string {
  const d = new Date(iso)
  const dia = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return `${dia} ${hora}`
}

// Color del canal recomendado: verde WhatsApp, navy correo, gris si no hay ninguno.
function canalClases(canal: string): string {
  switch (canal) {
    case 'whatsapp': return 'text-exito'
    case 'email': return 'text-primary'
    default: return 'text-muted-foreground'
  }
}

function estadoRespuestaClases(estado: string): string {
  switch (estado) {
    case 'acceptada': return 'bg-exito-fondo text-exito'
    case 'rebutjada': return 'bg-error-fondo text-error'
    default: return 'bg-muted text-muted-foreground'
  }
}

function aprovacioClases(a: string): string {
  switch (a) {
    case 'aprovada': return 'bg-primary/15 text-primary'
    case 'rebutjada': return 'bg-error-fondo text-error'
    default: return 'bg-aviso-fondo text-aviso'
  }
}

export default function OfferDetail({ excedente, onBack }: Props) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [exc, setExc] = useState<Excedente>(excedente)
  const [canalizaciones, setCanalizaciones] = useState<Canalizacion[]>([])
  // Los albaranes de este registro: el REC de la entrada y un ENT/OPE por canalización.
  // Los crea el TRIGGER `canalizaciones_crea_albaranes` al insertar la canalización, así
  // que aquí nunca se insertan: solo se enlazan. Si una canalización no tiene el suyo, el
  // botón lo dice en vez de fingir que existe.
  const [albarans, setAlbarans] = useState<AlbaraDelRegistre[]>([])
  const [respuestas, setRespuestas] = useState<RespuestaConEntidad[]>([])
  const [ranking, setRanking] = useState<EntidadPuntuada[]>([])
  const [rankingError, setRankingError] = useState<string | null>(null)
  const [cargandoRanking, setCargandoRanking] = useState(true)
  const [copiado, setCopiado] = useState<string | null>(null)
  // Input de fecha controlado: se re-sincroniza cuando `exc` cambia tras recargar
  // (p. ej. si el intake dejó una fecha parseada o el usuario la edita).
  const [fecha, setFecha] = useState<string>(excedente.disponible_hasta ?? '')
  const [testMode, setTestMode] = useState(true)
  // Interruptor global de WhatsApp (§8). Sale del sobre de `priorizar-entidades`, igual
  // que `modoTest`: lo decide el servidor y el panel solo obedece.
  const [whatsappActiu, setWhatsappActiu] = useState(true)
  // Qué entidad tiene un envío EN CURSO. Sin esto, los tres botones de una fila se podían
  // pulsar otra vez mientras la petición viajaba —y el envío tarda lo bastante como para que
  // pase—: el 16-09-2026 una oferta salió DOS VECES al mismo número por un doble clic. La
  // fila de `oferta_respuestas` no se duplica (la protege su índice único), pero el WhatsApp
  // sí, y eso lo ve la persona. El bloqueo es por fila, no global: mandar la misma oferta a
  // dos entidades a la vez es legítimo.
  const [enviant, setEnviant] = useState<string | null>(null)
  // Los dos motivos que antes se pedían con `window.prompt` (deuda §12.35). Van con estado
  // porque el de rechazo lo abre la fila de una respuesta concreta, no un botón suelto.
  const [rebutjant, setRebutjant] = useState<RespuestaConEntidad | null>(null)
  const [noColocada, setNoColocada] = useState(false)
  // F3: el diálogo que convierte esta oferta en jornada de espigueo.
  const [convertint, setConvertint] = useState(false)
  // Productor y municipi para las variables de la plantilla oferta_excedent.
  const [datosOferta, setDatosOferta] = useState<{ productor: string | null; municipi: string | null }>(
    { productor: null, municipi: null },
  )

  const canalizados = canalizaciones.reduce((s, c) => s + Number(c.kg_confirmados ?? 0), 0)
  const total = Number(exc.kg_total ?? 0)
  const faltan = Math.max(0, total - canalizados)

  const copiar = useCallback((texto: string, id: string) => {
    const marcar = () => {
      setCopiado(id)
      toast.success(t('od.copied'))
      setTimeout(() => setCopiado(null), 1500)
    }
    // Se copia text/plain (con los saltos de línea reales) y, además, text/html
    // con <br>: algunos destinos (WhatsApp Web, correo, documentos) colapsan el
    // salto de línea suelto al pegar solo texto plano, y con la versión HTML lo
    // conservan. Si el navegador no soporta ClipboardItem, se cae a writeText.
    const html = textoAHtmlPortapapeles(texto)
    try {
      if ('write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
          'text/plain': new Blob([texto], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })
        void navigator.clipboard.write([item]).then(marcar, () => {
          void navigator.clipboard.writeText(texto).then(marcar)
        })
        return
      }
    } catch {
      // Navegador sin ClipboardItem: se usa el fallback de abajo.
    }
    void navigator.clipboard.writeText(texto).then(marcar)
  }, [t])

  // Devuelve el excedente recargado: quien acaba de aprobar necesita saber si con eso el
  // estado ha pasado a `bloqueada`, y leer `exc` justo después daría el valor anterior.
  const recargar = useCallback(async (): Promise<Excedente | null> => {
    const [e, c, a] = await Promise.all([
      supabase.from('excedentes').select('*').eq('id', excedente.id).single(),
      supabase.from('canalizaciones').select('*').eq('excedente_id', excedente.id).order('created_at', { ascending: true }),
      // ⚠️ La lista de columnas en UN literal (§7, deuda 46).
      supabase.from('albaranes')
        .select('id, tipo, numero_completo, estado, canalizacion_id, entregado_at')
        .eq('excedente_id', excedente.id),
    ])
    if (e.data) setExc(e.data)
    setCanalizaciones(c.data ?? [])
    setAlbarans((a.data as AlbaraDelRegistre[] | null) ?? [])
    return e.data ?? null
  }, [excedente.id])

  useEffect(() => { void recargar() }, [recargar])

  /** El albarán de salida (ENT u OPE) de una canalización concreta. */
  const albaraDe = useCallback(
    (canalitzacioId: string) => albarans.find((a) => a.canalizacion_id === canalitzacioId) ?? null,
    [albarans],
  )
  /** El de recepción del registro: es el que se concilia. */
  const albaraRec = useMemo(() => albarans.find((a) => a.tipo === 'REC') ?? null, [albarans])

  const recargarRespuestas = useCallback(async () => {
    const { data } = await supabase
      .from('oferta_respuestas')
      .select('*, entidades(nombre, poblacion)')
      .eq('excedente_id', excedente.id)
      .order('enviado_at', { ascending: false })
    setRespuestas((data as RespuestaConEntidad[]) ?? [])
  }, [excedente.id])

  useEffect(() => {
    void recargarRespuestas()
    // La entidad responde por WhatsApp → el webhook actualiza la fila → aquí se
    // refleja en vivo, sin recargar la página.
    const channel = supabase
      .channel(`oferta-respuestas-${excedente.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'oferta_respuestas', filter: `excedente_id=eq.${excedente.id}` },
        () => { void recargarRespuestas() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [excedente.id, recargarRespuestas])

  // El ranking trae ya el correo, el `es_test`, el canal recomendado y el modo test:
  // lo decide todo `priorizar-entidades` con la misma política que aplicará al
  // enviar (§8bis). El panel no lo recalcula, para que no puedan discrepar.
  useEffect(() => {
    setCargandoRanking(true)
    void priorizarEntidades(excedente.id).then((r) => {
      setRanking(r.ranking)
      setTestMode(r.modoTest)
      setWhatsappActiu(r.whatsappActiu)
      setRankingError(r.error)
      setCargandoRanking(false)
    })
  }, [excedente.id])

  useEffect(() => { setFecha(exc.disponible_hasta ?? '') }, [exc.disponible_hasta])

  useEffect(() => {
    // Productor + municipi para rellenar la plantilla oferta_excedent (fuera de ventana).
    void (async () => {
      const [prod, ubi] = await Promise.all([
        excedente.productor_id
          ? supabase.from('productores').select('name, empresa, poblacion').eq('id', excedente.productor_id).maybeSingle()
          : Promise.resolve({ data: null }),
        excedente.ubicacion_id
          ? supabase.from('productor_ubicaciones').select('municipio').eq('id', excedente.ubicacion_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      const p = prod.data as { name?: string; empresa?: string; poblacion?: string } | null
      const u = ubi.data as { municipio?: string } | null
      setDatosOferta({ productor: p?.empresa || p?.name || null, municipi: u?.municipio || p?.poblacion || null })
    })()
  }, [excedente.productor_id, excedente.ubicacion_id])

  // Matching ordenado para mostrar primero a quién SÍ se puede contactar: tiene
  // permiso (es_test con el modo test activo) y tiene algún canal. El sort es
  // estable: dentro de cada grupo se conserva la puntuación del servidor.
  const rankingOrdenado = useMemo(() => {
    const contactable = (e: EntidadPuntuada) => (!testMode || e.es_test) && e.canal !== 'cap'
    return [...ranking].sort((a, b) => Number(contactable(b)) - Number(contactable(a)))
  }, [ranking, testMode])

  async function guardarFecha(valor: string) {
    setFecha(valor)
    await supabase.from('excedentes').update({ disponible_hasta: valor || null }).eq('id', excedente.id)
    await recargar()
  }

  async function toggleOptIn(entidadId: string, actual: boolean) {
    await supabase.from('entidades').update({ opt_in: !actual }).eq('id', entidadId)
    const r = await priorizarEntidades(excedente.id)
    setRanking(r.ranking)
  }

  // Deja constancia de que la oferta se envió a la entidad, en estado 'pendent'.
  // La respuesta por WhatsApp la actualizará el webhook; onConflict hace que
  // reenviar a la misma entidad reinicie la fila en vez de duplicarla.
  //
  // ⚠️ REINICIAR ES TAMBIÉN BORRAR EL DIÁLOGO A MEDIAS, y eso faltaba (16-09-2026).
  // El upsert devolvía `estado` a 'pendent' pero dejaba `dialeg_pas` donde estuviera, así
  // que una entidad que hubiera contestado «sí» a un envío anterior se quedaba en el paso
  // `kg`: al reenviarle la oferta y pulsar «M'interessa», el botón llegaba al paso de los
  // kilos, no se parseaba como número y el bot le contestaba «escriu només el número» sin
  // que nada explicara de dónde salía esa pregunta. Visto en producción, con la oferta de
  // prueba de venda. Reenviar es volver a preguntar desde el principio.
  async function registrarEnvio(ent: EntidadPuntuada, canal: 'whatsapp' | 'email') {
    const { error } = await supabase.from('oferta_respuestas').upsert({
      excedente_id: excedente.id,
      entidad_id: ent.id,
      telefono: ent.telefono,
      canal,
      estado: 'pendent',
      enviado_at: new Date().toISOString(),
      respondido_at: null,
      mensaje_respuesta: null,
      dialeg_pas: null,
      dialeg_dades: {},
      kg_solicitados: null,
      caixes_solicitades: null,
      preu_ofert: null,
    }, { onConflict: 'excedente_id,entidad_id' })
    if (error) console.error('oferta_respuestas upsert:', error.message)
    await recargarRespuestas()
  }

  // Marcado manual (imprescindible para el email, que no tiene respuesta automática).
  async function marcarRespuesta(id: string, estado: 'pendent' | 'acceptada' | 'rebutjada') {
    await supabase.from('oferta_respuestas').update({
      estado,
      respondido_at: estado === 'pendent' ? null : new Date().toISOString(),
    }).eq('id', id)
    await recargarRespuestas()
  }

  /**
   * Aprobar una aceptación y convertirla en canalización.
   *
   * La operación entera —la comprobación previa de convenios y la RPC transaccional— vive
   * en `src/lib/aprovarResposta.ts`, porque el equipo también aprueba desde la cola de
   * Aprovacions y dos copias de esto acabarían divergiendo justo en la comprobación
   * (§12.19, §12.78). Aquí queda lo que es de esta pantalla: los dos diálogos y el refresco.
   */
  async function aprovarRespuesta(e: FormEvent<HTMLFormElement>, r: RespuestaConEntidad) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const kg = Number(fd.get('kg') || 0)
    if (!r.entidad_id || !kg) { toast.error(t('od.no_text')); return }
    // Aviso no bloqueante si se canaliza más de lo que falta por cubrir.
    if (kg > faltan && !(await confirma({
      titol: t('od.over_alloc_t'),
      descripcio: t('od.over_alloc', { n: faltan }),
    }))) return

    const falta = await comprovaConvenis(exc, r.entidad_id, t)
    if (falta && !(await confirma({
      titol: t('od.conv_missing_t'),
      descripcio: t('od.conv_missing', { parts: falta }),
    }))) return

    const preuRaw = String(fd.get('preu') ?? '')
    const preu = preuRaw !== '' ? Number(preuRaw) : null
    const res = await aprovarResposta({ id: r.id, kg, preu })
    if (!res.ok) {
      toast.error(res.codi === 'sense_conveni' ? t('od.conv_blocked') : res.missatge)
      return
    }
    toast.success(t('od.approved'))
    const nou = await recargar()
    await recargarRespuestas()
    avisaSiCoberta(nou)
    // Aprobar vacía una fila de la cola de Aprovacions: el badge del menú tiene que bajar
    // sin esperar a la próxima navegación.
    void refrescaComptadors()
  }

  async function rebutjarAprovacio(r: RespuestaConEntidad, motiu: string) {
    const res = await rebutjarResposta({ id: r.id, motiu })
    if (!res.ok) { toast.error(res.missatge); return }
    await recargarRespuestas()
    toast.success(t('od.rejected_ok'))
    void refrescaComptadors()
  }

  /**
   * Envía la oferta por WhatsApp. Devuelve si salió, para que el envío automático
   * (`enviarOferta`) pueda caer al correo cuando no.
   *
   * `silencioso` calla los avisos de fallo: los da el llamante, que sabe si aún
   * queda un canal por intentar. Un toast rojo seguido de uno verde confunde.
   */
  async function enviarOfertaWhatsApp(ent: EntidadPuntuada, silencioso = false): Promise<boolean> {
    const avisar = (fn: typeof toast.error, msg: string) => { if (!silencioso) fn(msg) }
    // Interruptor global (§8). Se comprueba aquí además de esconder el botón porque el
    // estado puede haber cambiado desde que se cargó la pantalla, y el servidor
    // respondería un 503 que no dice nada útil al equipo.
    if (!whatsappActiu) { avisar(toast.error, t('od.wa_off')); return false }
    // Botón siempre clicable: cada motivo se avisa con un toast, no con un return mudo.
    if (!ent.telefono) { avisar(toast.error, t('od.need_phone', { name: ent.nombre })); return false }
    if (testMode && !ent.es_test) { avisar(toast.error, t('od.not_test_toast', { name: ent.nombre })); return false }
    if (!exc.texto_oferta) { toast.error(t('od.no_text')); return false }
    // Con botones, no en texto plano: la entidad tiene que poder DECIDIR sin adivinar la
    // palabra exacta. Los ids son los que consume `_shared/respuestas.ts` (§5). El texto va
    // entero —el más largo en producción mide 429 caracteres y el tope de un interactivo es
    // 1024—, así que no se recorta nada de la oferta.
    const r = await sendWhatsApp({
      to: ent.telefono,
      type: 'botones',
      body: exc.texto_oferta,
      botones: [
        { id: 'accept:si', titulo: "M'interessa" },
        { id: 'accept:no', titulo: 'Ara no' },
      ],
    })
    if (r.ok) { await registrarEnvio(ent, 'whatsapp'); toast.success(t('od.sent_wa', { name: ent.nombre })); return true }
    const data = r.data as { code?: string } | null
    if (data?.code === 'window_closed') {
      // Fuera de la ventana de 24 h solo cabe una plantilla aprobada por Meta.
      if (!PLANTILLA_OFERTA_APROVADA) { avisar(toast.warning, t('od.tpl_not_approved', { name: ent.nombre })); return false }
      if (!ent.opt_in) { avisar(toast.error, t('od.no_optin_toast', { name: ent.nombre })); return false }
      if (!silencioso) {
        toast.warning(t('od.closed_offer_tpl', { name: ent.nombre }), {
          action: { label: t('od.send_as_tpl'), onClick: () => void enviarOfertaPlantilla(ent) },
        })
      }
      return false
    }
    if (data?.code === 'whatsapp_desactivat') avisar(toast.error, t('od.wa_off'))
    else if (data?.code === 'no_test_user') avisar(toast.error, t('od.not_test_toast', { name: ent.nombre }))
    else if (data?.code === 'no_test_recipient') avisar(toast.error, t('od.no_test_meta', { name: ent.nombre }))
    else if (data?.code === 'unknown_contact') avisar(toast.error, t('od.must_write', { name: ent.nombre }))
    else {
      // Sin código propio = no es una regla nuestra, es Meta rechazando. Se avisa
      // AUNQUE haya fallback: el 31-07-2026 el token caducó y todos los envíos
      // fallaban, y callarlo porque «ya se manda por correo» dejaría el canal
      // caído sin que nadie se entere. Los motivos esperables (ventana, opt-in)
      // sí se callan; una avería de plataforma, no.
      const meta = (r.data as { error?: { code?: number; message?: string } } | null)?.error
      toast.error(t('od.wa_broken', { detail: meta?.message?.slice(0, 90) ?? `HTTP ${r.status}` }),
        { duration: 10000 })
    }
    return false
  }

  /**
   * Envío por el canal recomendado (§8bis): WhatsApp solo si de verdad se puede
   * —móvil con opt-in o ventana abierta—, y si no, correo. Lo decide el servidor en
   * `priorizar-entidades`; aquí solo se obedece. Si WhatsApp falla y hay correo, se
   * cae al correo: quedarse sin avisar a nadie es peor que cambiar de canal.
   */
  /**
   * Marca la fila como «enviando» mientras dura la petición. El `finally` es lo que importa:
   * si el envío falla, la fila tiene que volver a poder pulsarse — un botón que se queda
   * bloqueado tras un error es peor que uno que se puede pulsar dos veces.
   */
  async function ambBloqueig(id: string, fn: () => Promise<unknown>) {
    if (enviant === id) return
    setEnviant(id)
    try { await fn() } finally { setEnviant(null) }
  }

  async function enviarOferta(ent: EntidadPuntuada) {
    if (testMode && !ent.es_test) { toast.error(t('od.not_test_toast', { name: ent.nombre })); return }
    if (ent.canal === 'cap') { toast.error(t('od.no_channel', { name: ent.nombre })); return }
    if (ent.canal === 'whatsapp') {
      if (await enviarOfertaWhatsApp(ent, ent.email_possible)) return
      if (!ent.email_possible) return // el motivo ya se avisó
      toast.info(t('od.fallback_email', { name: ent.nombre }))
    }
    await enviarOfertaEmail(ent)
  }

  // Envía la oferta como plantilla `oferta_excedent` (fuera de ventana). Asegura el
  // wa_contact antes, para pasar los gates unknown_contact/opt_in del servidor.
  async function enviarOfertaPlantilla(ent: EntidadPuntuada) {
    if (!ent.telefono) { toast.error(t('od.need_phone', { name: ent.nombre })); return }
    await supabase.from('wa_contacts').upsert(
      { phone: ent.telefono, name: ent.nombre, opt_in: true, opt_in_at: new Date().toISOString() },
      { onConflict: 'phone', ignoreDuplicates: true },
    )
    const components = construirComponentsOferta({
      producto: exc.producto, variedad: exc.variedad,
      productor: datosOferta.productor, municipi: datosOferta.municipi,
      kg: exc.kg_total, caixes: exc.num_caixes,
      disponible: exc.disponible_hasta, horari: exc.horari_recollida,
    })
    const r = await sendWhatsApp({
      to: ent.telefono, type: 'template',
      template: PLANTILLA_OFERTA.name, language: PLANTILLA_OFERTA.language, components,
    })
    if (r.ok) { await registrarEnvio(ent, 'whatsapp'); toast.success(t('od.sent_tpl', { name: ent.nombre })); return }
    const data = r.data as { code?: string } | null
    if (data?.code === 'no_opt_in') toast.error(t('od.no_optin_toast', { name: ent.nombre }))
    else if (data?.code === 'unknown_contact') toast.error(t('od.must_write', { name: ent.nombre }))
    else if (data?.code === 'no_test_user') toast.error(t('od.not_test_toast', { name: ent.nombre }))
    else toast.error(t('od.no_send_wa'))
  }

  async function enviarOfertaEmail(ent: EntidadPuntuada) {
    const email = ent.email
    if (!email) { toast.error(t('od.no_email_toast', { name: ent.nombre })); return }
    if (testMode && !ent.es_test) { toast.error(t('od.not_test_toast', { name: ent.nombre })); return }
    if (!exc.texto_oferta) { toast.error(t('od.no_text')); return }
    // El HTML lo maqueta el servidor (cabecera, logo, pie): aquí solo va el
    // contenido. Ver `plantilla` en supabase/functions/enviar-email.
    const r = await enviarEmail({
      to: email, subject: `Oferta d'excedent: ${exc.producto ?? ''}`,
      text: exc.texto_oferta,
      plantilla: {
        titulo: t('od.email_title'),
        preheader: t('od.email_preheader', { producto: exc.producto ?? '' }),
        nota: t('od.email_note'),
        // El equivalente del diálogo sí/no de WhatsApp (§5): quien recibe la oferta por
        // correo tiene un sitio donde decir que la quiere, en vez de tener que contestar
        // un correo que nadie captura de forma estructurada.
        boton: { texto: t('od.email_button'), url: `${window.location.origin}/receptor/mercat` },
      },
    })
    if (r.ok) { await registrarEnvio(ent, 'email'); toast.success(t('od.sent_email', { name: ent.nombre })); return }
    const data = r.data as { code?: string } | null
    if (data?.code === 'no_test_user') toast.error(t('od.not_test_toast', { name: ent.nombre }))
    else if (data?.code === 'no_test_recipient') toast.error(t('od.email_no_test', { email }))
    else toast.error(t('od.no_send_email'))
  }

  async function altaCanalizacion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const entidad_id = String(fd.get('entidad') || '')
    const kg_confirmados = Number(fd.get('kg') || 0)
    if (!entidad_id || !kg_confirmados) return
    if (kg_confirmados > faltan && !(await confirma({
      titol: t('od.over_alloc_t'),
      descripcio: t('od.over_alloc', { n: faltan }),
    }))) return
    await supabase.from('canalizaciones').insert({
      excedente_id: excedente.id, entidad_id, kg_confirmados,
      caixes_entregades: Number(fd.get('caixes') || 0) || null,
      comentarios: String(fd.get('comentarios') || '') || null,
    })
    const nuevoCanalizado = canalizados + kg_confirmados
    if (total > 0 && nuevoCanalizado >= total) {
      await supabase.from('excedentes').update({ estado: 'bloqueada' }).eq('id', excedente.id)
    } else if (exc.estado === 'publicada') {
      await supabase.from('excedentes').update({ estado: 'parcial' }).eq('id', excedente.id)
    }
    form.reset()
    const nou = await recargar()
    avisaSiCoberta(nou)
    void refrescaComptadors()
  }

  async function guardarKgReales(canalId: string, kgReales: number) {
    await supabase.from('canalizaciones').update({ kg_reales: kgReales }).eq('id', canalId)
    await recargar()
  }

  async function marcarNoColocada(motivo: string) {
    await supabase.from('excedentes').update({ estado: 'no_colocada', motivo_no_colocada: motivo }).eq('id', excedente.id)
    setNoColocada(false)
    await recargar()
    // La oferta desaparece del listado de actives: sin este aviso, el único indicio de que
    // ha pasado algo era que la pantalla cambiaba de estado.
    toast.success(t('od.uncoll_ok'))
    void refrescaComptadors()
  }

  async function cancelarOferta() {
    if (!(await confirma({
      titol: t('od.confirm_cancel_t'),
      descripcio: t('od.confirm_cancel'),
      confirmar: t('od.cancel_offer'),
      destructiu: true,
    }))) return
    await supabase.from('excedentes').update({ estado: 'cancelada' }).eq('id', excedente.id)
    await recargar()
    toast.success(t('od.cancel_ok'))
    void refrescaComptadors()
  }

  const nombrePorId = (id: string | null) => ranking.find((e) => e.id === id)?.nombre ?? id ?? '—'
  const vencida = exc.disponible_hasta != null && new Date(exc.disponible_hasta) < new Date() && faltan > 0

  /**
   * Cubrir los kg hace aparecer de golpe el bloque «Recollida confirmada», que hasta ese
   * momento no estaba en la pantalla. Sin decirlo, parece que la interfaz se ha movido sola.
   */
  function avisaSiCoberta(nou: Excedente | null) {
    if (exc.estado !== 'bloqueada' && nou?.estado === 'bloqueada') toast.success(t('od.now_blocked'))
  }

  const interessades = respuestas.filter((r) => r.estado === 'acceptada').length
  const perAprovar = respuestas.filter(
    (r) => r.estado === 'acceptada' && r.aprovacio === 'pendent',
  ).length
  const diesEsperant = albaraRec?.entregado_at
    ? Math.floor((Date.now() - new Date(albaraRec.entregado_at).getTime()) / 86_400_000)
    : null

  // Dónde está la oferta y qué toca. Lo decide `procesOferta.ts`, el mismo módulo que lo
  // cuenta en el panel del productor: las dos pantallas no pueden discrepar sobre el punto
  // en que está el mismo lote.
  const punt = puntOferta({
    estado: exc.estado,
    kgTotal: total,
    kgCanalitzats: canalizados,
    nEnviades: respuestas.length,
    nInteressades: interessades,
    nPerAprovar: perAprovar,
    albaraRec: albaraRec
      ? {
        estado: albaraRec.estado as EstadoAlbaran,
        numero: albaraRec.numero_completo,
        diesEsperant,
      }
      : null,
    motiu: exc.motivo_no_colocada,
    vencuda: vencida,
    producteAlCamp: exc.producte_al_camp,
    espigoladaId: exc.espigolada_id,
  }, 'equip')
  const foraDelCami = punt.index < 0
  const estat = etiquetaEstatOferta(exc.estado)

  /**
   * Por qué NO se puede convertir en espigolada, si no se puede (F3).
   *
   * Las dos razones las impone `crear_espigolada()` con `22023` —`ja_te_canalitzacions` y
   * `ja_te_albarans`— y el motivo es el mismo en las dos: la oferta ya tiene una entrada,
   * y la jornada crearía un segundo REC con los mismos kilos, que la conciliación contaría
   * dos veces. Se anticipa aquí para no mandar a nadie a chocar contra la base, pero **la
   * autoridad sigue siendo la RPC**: esto es un aviso, no la regla.
   */
  const motiuNoConvertible = canalizaciones.length > 0
    ? t('conv_esp.no_canalitzacions')
    : albarans.some((a) => a.estado !== 'anulado')
      ? t('conv_esp.no_albarans')
      : null

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
        <ArrowLeft className="size-4" /> {t('od.back')}
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold"><code>{exc.id_excedente}</code></h1>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {exc.producto}{exc.variedad ? ` · ${exc.variedad}` : ''}
            </p>
            {/* Antes aquí salía `exc.estado` en crudo: el listado decía «No col·locada» y
                la ficha de la misma oferta, «no_colocada». */}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${estat.clase}`}>
              {t(estat.key)}
            </span>
          </div>
          {exc.modalitat && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-xs font-semibold text-primary">
                {t(`od.mod_${exc.modalitat}`)}
              </span>
              {(exc.modalitat === 'venda' || exc.modalitat === 'maquila') && exc.preu_minim != null && (
                <span className="text-sm font-medium text-primary">{exc.preu_minim} €/kg</span>
              )}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{canalizados}/{total} kg</div>
          <span className="text-sm text-muted-foreground">{faltan > 0 ? t('off.falten', { n: faltan }) : t('off.complet')}</span>
        </div>
      </div>

      {/* Dónde está y qué toca. Va aquí arriba a propósito: es la pregunta con la que se
          abre esta pantalla, y hasta hoy había que deducirla del estado y de los kg. */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <PasosProces
            etapes={PASSOS_OFERTA_CLAUS}
            actual={punt.index}
            sortida={foraDelCami ? punt.claus.titol : undefined}
            destructiva={punt.etapa === 'cancellada'}
          />
          <QueTocaAra punt={punt} />

          {/* ── F3: convertir en espigolada ──
              Solo cuando la oferta declara producto SIN COSECHAR y todavía no es una
              jornada. Si ya lo es, lo dice la nota de `QueTocaAra` con su enlace, que sale
              del mismo `punt`: dos sitios contando lo mismo acabarían discrepando. */}
          {exc.producte_al_camp && !exc.espigolada_id && (
            <div className="rounded-lg border border-aviso/30 bg-aviso-fondo p-3">
              <p className="text-sm font-medium text-aviso">{t('conv_esp.banner')}</p>
              {/* El motivo del gris va TAMBIÉN visible: en táctil no hay hover, así que el
                  tooltip de `BotoAmbMotiu` no existe para media aplicación (§6ter). */}
              {motiuNoConvertible && (
                <p className="mt-1 text-sm text-aviso">{motiuNoConvertible}</p>
              )}
              <BotoAmbMotiu
                className="mt-2 h-11 whitespace-normal md:h-9"
                disabled={Boolean(motiuNoConvertible)}
                motiu={motiuNoConvertible ?? undefined}
                onClick={() => setConvertint(true)}
              >
                {t('conv_esp.cta')}
              </BotoAmbMotiu>
            </div>
          )}
        </CardContent>
      </Card>

      {exc.texto_oferta && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('od.offer_text')}</CardTitle>
            <Button variant="outline" size="sm" onClick={() => copiar(exc.texto_oferta ?? '', 'oferta')}>
              {copiado === 'oferta' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {t('od.copy_group')}
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm">{exc.texto_oferta}</pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t('od.available_until')}</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3">
          <Input type="date" className="w-auto" value={fecha}
            onChange={(ev) => void guardarFecha(ev.target.value)} />
          {vencida && <span className="text-sm text-destructive">{t('od.expired')}</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('od.prioritized')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {cargandoRanking && <p className="text-sm text-muted-foreground">{t('od.calculating')}</p>}
          {rankingError && <p className="text-sm text-destructive">{rankingError}</p>}
          {!cargandoRanking && !rankingError && rankingOrdenado.slice(0, 15).map((ent) => {
            const puedeTest = !testMode || ent.es_test
            // Si no es usuari de prova, se muestra el motivo visible (antes solo en el title).
            const motivos = puedeTest ? ent.motivos : [...ent.motivos, t('od.not_test')]
            return (
              <div key={ent.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5 ${ent.pendiente ? 'bg-aviso-fondo opacity-80' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center text-lg font-bold text-primary">{ent.puntuacion}</span>
                  <div>
                    <div className="font-medium">{ent.nombre}{ent.poblacion ? ` · ${ent.poblacion}` : ''}</div>
                    <div className="text-xs text-muted-foreground">{motivos.join(' · ') || t('od.no_match_ent')}</div>
                    {/* Canal recomendado y por qué: que se vea antes de pulsar, no después. */}
                    <div className="text-xs">
                      <span className={`font-medium ${canalClases(ent.canal)}`}>{t(`od.canal_${ent.canal}`)}</span>
                      <span className="text-muted-foreground"> · {t(`od.canal_why_${ent.motiu_canal}`)}</span>
                      {/* Una preferencia que se ignora en silencio es peor que no tenerla. */}
                      {ent.preferencia_respectada === false && (
                        <span className="text-aviso"> · {t('od.canal_pref_no', { canal: t(`od.canal_${ent.canal_preferit}`) })}</span>
                      )}
                    </div>
                    {/* El servidor ya dice a quién le falta el papel para poder recibir
                        ESTA oferta, y hasta hoy la pantalla lo tiraba: se enviaba igual y
                        el rechazo (`42501 sense_conveni`) aparecía al aprobar, cuando ya
                        se había gastado el envío y la respuesta de la entidad.
                        Va en `aviso` y no en rojo: enviar no está prohibido —el convenio
                        puede firmarse entremedias— lo que falla es aprobar. */}
                    {ent.sense_conveni && (
                      <div className="mt-1 text-xs text-aviso">{t('od.sense_conveni')}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Casella checked={ent.opt_in} onChange={() => void toggleOptIn(ent.id, ent.opt_in)} />
                    {t('od.optin')}
                  </label>
                  {/* Envío por el canal recomendado. Los otros dos fuerzan uno concreto.
                      Los tres se bloquean mientras esa fila tiene un envío en curso, y el
                      pulsado lo dice: el toast llega cuando contesta el servidor, y hasta
                      entonces la única señal de que se ha pulsado es esta. */}
                  <Button size="sm" disabled={enviant === ent.id}
                    onClick={() => void ambBloqueig(ent.id, () => enviarOferta(ent))}>
                    {enviant === ent.id ? t('od.sending') : t('od.send')}
                  </Button>
                  {whatsappActiu && (
                    <Button size="sm" variant="outline" title={t('od.force_wa')} disabled={enviant === ent.id}
                      onClick={() => void ambBloqueig(ent.id, () => enviarOfertaWhatsApp(ent))}>{t('od.whatsapp')}</Button>
                  )}
                  <Button size="sm" variant="outline" title={t('od.force_email')} disabled={enviant === ent.id}
                    onClick={() => void ambBloqueig(ent.id, () => enviarOfertaEmail(ent))}>{t('od.email')}</Button>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('od.responses')}</CardTitle>
          {/* Dos badges en la misma fila, uno de la entidad y otro del equipo: sin esta
              frase, «acceptada» se lee como «ya está hecho» y no cuenta ningún kilo. */}
          <p className="mt-1 text-sm text-muted-foreground">{t('od.acc_vs_apr')}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {respuestas.length === 0 && <p className="text-sm text-muted-foreground">{t('od.resp_none')}</p>}
          {respuestas.map((r) => {
            const nombre = r.entidades?.nombre ?? r.telefono ?? '—'
            const cuando = r.respondido_at ?? r.enviado_at
            const esVenda = exc.modalitat === 'venda' || exc.modalitat === 'maquila'
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5 text-sm">
                <div className="flex items-center gap-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${estadoRespuestaClases(r.estado)}`}>
                    {t(`od.rs_${r.estado}`)}
                  </span>
                  {r.estado === 'acceptada' && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${aprovacioClases(r.aprovacio)}`}>
                      {t(`od.ap_${r.aprovacio}`)}
                    </span>
                  )}
                  <div>
                    <div className="font-medium">{nombre}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(`od.ch_${r.canal}`)} · {fechaCorta(cuando)}
                      {r.kg_solicitados != null ? ` · ${r.kg_solicitados} ${t('od.rs_kg')}` : ''}
                      {r.preu_ofert != null ? ` · ${r.preu_ofert} ${t('od.rs_preu')}` : ''}
                      {r.mensaje_respuesta ? ` · «${r.mensaje_respuesta}»` : ''}
                    </div>
                  </div>
                </div>
                {r.estado === 'pendent' && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline"
                      onClick={() => void marcarRespuesta(r.id, 'acceptada')}>{t('od.rs_accept')}</Button>
                    <Button size="sm" variant="outline"
                      onClick={() => void marcarRespuesta(r.id, 'rebutjada')}>{t('od.rs_reject')}</Button>
                  </div>
                )}
                {r.estado === 'acceptada' && r.aprovacio === 'pendent' && (
                  <form className="flex flex-wrap items-center gap-1" onSubmit={(ev) => void aprovarRespuesta(ev, r)}>
                    <Input name="kg" type="number" required defaultValue={r.kg_solicitados ?? ''}
                      placeholder={t('od.kg_ph')} className="h-8 w-20" />
                    {esVenda && (
                      <Input name="preu" type="number" step="0.01" defaultValue={r.preu_ofert ?? exc.preu_minim ?? ''}
                        placeholder={t('od.rs_preu')} className="h-8 w-20" />
                    )}
                    <Button size="sm" type="submit">{t('od.approve')}</Button>
                    <Button size="sm" variant="outline" type="button"
                      onClick={() => setRebutjant(r)}>{t('od.reject_appr')}</Button>
                  </form>
                )}
                {r.estado === 'acceptada' && r.aprovacio === 'aprovada' && (
                  <span className="text-xs font-medium text-primary">{t('od.approved_kg', { n: r.kg_solicitados ?? 0 })}</span>
                )}
                {r.estado === 'acceptada' && r.aprovacio === 'rebutjada' && (
                  <span className="text-xs text-error">
                    {t('od.rejected_appr')}{r.motiu_aprovacio ? `: ${r.motiu_aprovacio}` : ''}
                  </span>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('od.channelings')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {canalizaciones.length === 0 && <p className="text-sm text-muted-foreground">{t('od.none_yet')}</p>}
          {canalizaciones.map((c) => {
            const difiere = c.kg_reales != null && Number(c.kg_reales) !== Number(c.kg_confirmados)
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 border-b pb-2 text-sm">
                <span className="font-medium">{nombrePorId(c.entidad_id)}</span>
                <span>{c.kg_confirmados} kg</span>
                <label className="flex items-center gap-1">
                  {t('od.reals')}
                  <Input type="number" defaultValue={c.kg_reales ?? ''} className={`h-8 w-20 ${difiere ? 'border-accent' : ''}`}
                    onBlur={(ev) => ev.target.value && void guardarKgReales(c.id, Number(ev.target.value))} />
                </label>
                {difiere && <span className="text-xs text-accent">{t('od.differs')}</span>}
                {/* El albarán ya no es un texto que compone el panel con marcadores y sin
                    número: es una fila numerada de `albaranes` con su PDF. Aquí solo se
                    enlaza (checkpoint §12.4 y deuda 40, cerradas). */}
                {albaraDe(c.id)
                  ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/equip/albarans/${albaraDe(c.id)?.id}`}>
                        {albaraDe(c.id)?.numero_completo ?? t('od.albara')}
                      </Link>
                    </Button>
                  )
                  : <span className="text-xs text-muted-foreground">{t('od.albara_pending')}</span>}
              </div>
            )
          })}
          <form className="flex flex-wrap items-center gap-2 pt-2" onSubmit={altaCanalizacion}>
            {/* `text-base md:text-sm`: iOS Safari amplía la página al enfocar un control
                con menos de 16px y no deshace el zoom (§2, regla 1 de móvil). Los
                `<select>` nativos no lo heredan de shadcn: hay que repetirlo a mano. */}
            <select name="entidad" required defaultValue=""
              className="h-9 rounded-md border border-input bg-transparent px-3 text-base md:text-sm">
              <option value="" disabled>{t('od.entity_ph')}</option>
              {ranking.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
            <Input name="kg" type="number" placeholder={t('od.kg_ph')} required className="w-24" />
            <Input name="caixes" type="number" placeholder={t('od.boxes_ph')} className="w-24" />
            <Input name="comentarios" type="text" placeholder={t('od.comments_ph')} className="w-40" />
            <Button type="submit">{t('c.add')}</Button>
          </form>
        </CardContent>
      </Card>

      {exc.estado === 'bloqueada' && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{t('od.recollida')}</CardTitle>
            {/* El albarán de recepción del registro: es el que se emite, se confirma y se
                concilia. Desde aquí se llega a su ficha sin pasar por el listado. */}
            {albaraRec && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/equip/albarans/${albaraRec.id}`}>
                  {albaraRec.numero_completo ?? t('od.albara_rec')}
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm"
              onClick={() => copiar(textoRecollidaConfirmada({
                entitat: canalizaciones.map((c) => nombrePorId(c.entidad_id)).join(', '),
                dataHora: '', kgRecollits: String(canalizados), kgFalten: String(faltan), comentaris: '',
              }), 'recollida')}>
              {copiado === 'recollida' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {t('od.copy_recollida')}
            </Button>
          </CardHeader>
        </Card>
      )}

      {/* Las dos salidas del camino. Eran dos botones rojos sueltos al final de la página,
          sin nada que dijera en qué se diferencian: las dos sacan la oferta del listado,
          pero una cuenta en las estadísticas como intento fallido y la otra no. */}
      {exc.estado !== 'no_colocada' && exc.estado !== 'cerrada' && exc.estado !== 'cancelada' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('od.close_title')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t('od.close_help')}</p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="destructive" className="h-11 whitespace-normal md:h-9"
              onClick={() => setNoColocada(true)}>{t('od.mark_uncoll')}</Button>
            <Button variant="destructive" className="h-11 whitespace-normal md:h-9"
              onClick={() => void cancelarOferta()}>{t('od.cancel_offer')}</Button>
          </CardContent>
        </Card>
      )}

      {/* Al crear la jornada se recarga: `exc.espigolada_id` pasa a tener valor, el bloque
          de arriba desaparece y la nota de `QueTocaAra` enseña el enlace a la jornada. */}
      <DialegEspigolada
        obert={convertint}
        oferta={exc}
        productorNom={datosOferta.productor}
        onTancar={() => setConvertint(false)}
        onCreada={() => { setConvertint(false); void recargar(); void refrescaComptadors() }}
      />

      <DialegMotiu
        obert={rebutjant !== null}
        onObert={(v) => { if (!v) setRebutjant(null) }}
        titol={t('od.reject_appr')}
        etiqueta={t('od.reject_reason')}
        confirmar={t('od.reject_appr')}
        destructiu
        onConfirma={(m) => {
          const r = rebutjant
          setRebutjant(null)
          if (r) void rebutjarAprovacio(r, m)
        }}
      />

      <DialegMotiu
        obert={noColocada}
        onObert={setNoColocada}
        titol={t('od.mark_uncoll')}
        descripcio={t('od.uncoll_desc')}
        etiqueta={t('od.prompt_uncoll')}
        confirmar={t('od.mark_uncoll')}
        destructiu
        onConfirma={(m) => void marcarNoColocada(m)}
      />

      {dialeg}
    </div>
  )
}
