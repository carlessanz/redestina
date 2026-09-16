// Cola global de aprobaciones. Son tres colas distintas en la misma pantalla:
//
// 1. REGISTRES PENDENTS — altas hechas desde el registro público
//    (`membresias.aprovacio = 'pendent'`). Hasta que alguien las valida la persona no
//    ve absolutamente nada de Redestina, así que esta cola es la puerta de entrada al
//    servicio y va primero. Aprobar y rechazar se hacen aquí mismo, con las RPC
//    `aprovar_registre` / `rebutjar_registre` (exigen `pot_aprovar()`). Lo que NO se
//    hace aquí es completar la ficha —una entidad nueva llega con `estat` y
//    `tipo_receptor` a null, y sin ellos queda fuera de la priorización y no ve ninguna
//    oferta—, por eso cada fila enlaza con su ficha para revisarla ANTES de aprobar.
//
// 2. CONVENIS PER CONTRASIGNAR — convenios que la organización ya ha firmado
//    (`convenios.estado = 'firmat'`) y esperan el punto de control humano: alguien con
//    `pot_aprovar()` revisa el NIF y el cargo y valida, o los devuelve con motivo
//    (§3.2.4, paso 6). Al validar se estampa la firma de la apoderada y el convenio pasa
//    a `vigent`, que es lo que habilita a esa organización a operar. Aquí se contrafirma
//    directamente —es un sí/no sobre dos datos— y se enlaza al detalle para revisar el
//    resto antes de decidir.
//
// 3. APROVACIONS D'OFERTES — aceptaciones de entidades pendientes de confirmar. Antes
//    solo se veían entrando en cada oferta; con receptores aceptando desde su panel
//    (canal 'panel') la cola crece sin que nadie la mire. **Y aquí solo había un botón
//    «Obrir l'oferta»**, sin decirlo: la decisión más frecuente del equipo era la única
//    que esta pantalla no dejaba tomar. Ahora se aprueba y se rechaza desde la fila,
//    con lo que falta por cubrir delante y con las dos confirmaciones de siempre
//    (canalizar de más, convenio que falta). El detalle de la oferta sigue a un clic
//    para lo que aquí no cabe: el resto de respuestas y el ranking de entidades.
//
//    ⚠️ La operación NO se reimplementa: es la misma `aprovarResposta()` de
//    `src/lib/aprovarResposta.ts` que usa `OfferDetail`. Dos copias de las mismas sesenta
//    líneas acabarían divergiendo justo en la comprobación de convenios (§12.19, §12.78).
//
// ⚠️ Las tres colas son independientes a propósito: si una migración todavía no está
//    aplicada, su consulta falla por tabla o columna inexistente y esa sección se queda
//    vacía, pero las otras dos siguen funcionando igual.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { contrafirmarConveni, nomOrganitzacio, retornarConveni } from '../../lib/convenis'
import { aprovarResposta, comprovaConvenis, rebutjarResposta } from '../../lib/aprovarResposta'
import { kgPerOferta } from '../../lib/ofertes'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import { enviarAcces } from '../../lib/acces'
import type { Convenio, Membresia } from '../../types'
import DialegMotiu from '../../components/DialegMotiu'
import { useConfirma } from '../../components/DialegConfirma'
import EnllacOrganitzacio from '../../components/EnllacOrganitzacio'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Fila {
  id: string
  excedente_id: string
  /** Nullable en la tabla; sin él no se puede comprobar el convenio ni canalizar. */
  entidad_id: string | null
  kg_solicitados: number | null
  preu_ofert: number | null
  canal: string
  respondido_at: string | null
  enviado_at: string
  entidades: { nombre: string; poblacion: string | null } | null
  excedentes: {
    id_excedente: string | null
    producto: string | null
    kg_total: number | null
    /** Decide si se pide preu y qué convenios exige la operación. */
    modalitat: string | null
    productor_id: string | null
    preu_minim: number | null
  } | null
}

/** Ficha embebida por la FK `membresias.productor_id → productores.id`. */
interface FitxaProductor {
  id: string
  name: string | null
  empresa: string | null
  email: string | null
  phone: string | null
  poblacion: string | null
}

/** Ficha embebida por la FK `membresias.entidad_id → entidades.id`. */
interface FitxaEntitat {
  id: string
  nombre: string | null
  email: string | null
  telefono: string | null
  poblacion: string | null
  tipo_receptor: string | null
}

type Registre = Pick<Membresia, 'id' | 'user_id' | 'tipo' | 'rol_org' | 'created_at'> & {
  productores: FitxaProductor | null
  entidades: FitxaEntitat | null
}

/**
 * Una organización que ya consta y que podría ser la misma que la de esta ficha.
 * La calcula `organitzacions_candidates()` al vuelo (correo o teléfono exactos, nunca el
 * nombre); `enllacable` es false cuando esa organización YA tiene ficha de este tipo, que
 * es un duplicado y no un papel nuevo.
 */
interface Candidat {
  organitzacio: string
  nom: string | null
  nif: string | null
  email: string | null
  telefon: string | null
  poblacio: string | null
  es_generadora: boolean
  es_receptora: boolean
  motiu: 'email' | 'telefon' | 'email_i_telefon'
  enllacable: boolean
}

/** La persona detrás de la membresía; se cruza a mano (ver `carregaRegistres`). */
interface Perfil {
  id: string
  nombre: string | null
  email: string | null
  telefono: string | null
}

/** Convenio firmado esperando contrafirma, con la ficha embebida por su FK. */
type ConveniPendent = Pick<
  Convenio,
  'id' | 'tipo' | 'tipo_org' | 'numero_completo' | 'firmado_at' | 'datos_org' | 'firmante'
> & {
  productores: { id: string; name: string | null; empresa: string | null; poblacion: string | null } | null
  entidades: { id: string; nombre: string | null; poblacion: string | null } | null
}

const TIPUS_RECEPTOR = ['social', 'animal', 'transformador', 'comercial']

/**
 * Las tres cosas que se rechazan con motivo comparten diálogo: lo que cambia es a quién se
 * lo cuenta, no lo que se pregunta. Con un tercer caso, los ternarios anidados dejaban de
 * leerse, así que las claves van en una tabla.
 */
const TEXTOS_MOTIU = {
  registre: {
    titol: 'appr.reg_reject', descripcio: 'appr.reg_reject_desc',
    etiqueta: 'appr.reg_reject_reason', confirmar: 'appr.reg_reject',
  },
  conveni: {
    titol: 'conv.return_title', descripcio: 'conv.return_desc',
    etiqueta: 'conv.return_label', confirmar: 'conv.return',
  },
  resposta: {
    titol: 'od.reject_appr', descripcio: 'appr.rej_desc',
    etiqueta: 'appr.rej_reason', confirmar: 'od.reject_appr',
  },
} as const

function quan(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ` +
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

export default function Aprovacions() {
  const { t } = useT()
  const navigate = useNavigate()
  const { ctx } = useAppContext()
  const { confirma, dialeg } = useConfirma()
  const [files, setFiles] = useState<Fila[]>([])
  const [carregant, setCarregant] = useState(true)
  /** Kg ya canalizados por oferta, para decir cuántos faltan antes de aprobar. */
  const [kgCanalitzats, setKgCanalitzats] = useState<Record<string, number>>({})
  /**
   * Lo que el equipo ha tecleado encima de lo que pidió la entidad, por fila. Es una capa
   * y no el valor: mientras no se toque el campo manda `kg_solicitados`, así que un
   * refresco de Realtime no pisa lo escrito ni lo escrito congela lo que llega.
   */
  const [edicions, setEdicions] = useState<Record<string, { kg?: string; preu?: string }>>({})
  const [registres, setRegistres] = useState<Registre[]>([])
  const [perfils, setPerfils] = useState<Record<string, Perfil>>({})
  const [candidats, setCandidats] = useState<Record<string, Candidat[]>>({})
  const [carregantReg, setCarregantReg] = useState(true)
  const [convenis, setConvenis] = useState<ConveniPendent[]>([])
  const [carregantConv, setCarregantConv] = useState(true)
  /** Id de la fila que se está resolviendo, para no dejar pulsar dos veces. */
  const [ocupat, setOcupat] = useState<string | null>(null)
  /** El motivo se pide con diálogo propio, nunca con `window.prompt` (deuda §12.35). */
  // El enlace se confirma en un diálogo propio y no con `window.confirm` (deuda §12.35):
  // fusiona dos organizaciones y desde esta pantalla no se deshace.
  const [enllacDe, setEnllacDe] = useState<{ registre: Registre; candidat: Candidat } | null>(null)

  const [motiuDe, setMotiuDe] = useState<
    | { tipus: 'registre'; registre: Registre }
    | { tipus: 'conveni'; conveni: ConveniPendent }
    | { tipus: 'resposta'; fila: Fila }
    | null
  >(null)

  // Con el contexto degradado (RPC de sesión no desplegada) se asume que sí: es como se
  // ha comportado la app siempre. La RPC revalida de todas formas y devuelve 42501.
  const potAprovar = ctx?.potAprovar ?? true

  const carrega = useCallback(async () => {
    // ⚠️ La lista de columnas, en UN literal (§7, deuda 46): estaba partida en dos cadenas
    // concatenadas, que es justo lo que hace que supabase-js se rinda con el tipo de la fila.
    const { data } = await supabase
      .from('oferta_respuestas')
      .select('id, excedente_id, entidad_id, kg_solicitados, preu_ofert, canal, respondido_at, enviado_at, entidades(nombre, poblacion), excedentes(id_excedente, producto, kg_total, modalitat, productor_id, preu_minim)')
      .eq('estado', 'acceptada')
      .eq('aprovacio', 'pendent')
      .order('respondido_at', { ascending: true, nullsFirst: false })
    const files = (data as unknown as Fila[]) ?? []
    setFiles(files)
    setCarregant(false)
    // Cuánto lleva cubierto cada oferta: sin eso, «aprovar 300 kg» aquí es un número sin
    // contexto, y la confirmación de canalizar de más no tendría contra qué comparar.
    // Una sola consulta para todas las filas, no una por fila.
    setKgCanalitzats(await kgPerOferta([...new Set(files.map((f) => f.excedente_id))]))
  }, [])

  const carregaRegistres = useCallback(async () => {
    // `productores` y `entidades` sí son embebibles (hay FK real); `perfiles` NO, porque
    // `membresias.user_id` referencia `auth.users`, no `perfiles`: la persona se cruza
    // en una segunda consulta con los user_id que hayan salido.
    // ⚠️ La lista de columnas, en UN literal (§7, deuda 46): estaba partida en tres cadenas
    // concatenadas, que es justo lo que hace que supabase-js se rinda con el tipo de la fila.
    const { data, error } = await supabase
      .from('membresias')
      .select('id, user_id, tipo, rol_org, created_at, productores(id, name, empresa, email, phone, poblacion), entidades(id, nombre, email, telefono, poblacion, tipo_receptor)')
      .eq('aprovacio', 'pendent')
      .order('created_at', { ascending: true })

    if (error) {
      // Migración del registro público sin aplicar (la columna `aprovacio` no existe):
      // la sección se queda vacía y la cola de ofertas sigue viva.
      console.warn('registres pendents:', error.message)
      setRegistres([])
      setPerfils({})
      setCandidats({})
      setCarregantReg(false)
      return
    }

    const pendents = (data as unknown as Registre[]) ?? []
    setRegistres(pendents)

    const ids = [...new Set(pendents.map((r) => r.user_id))]
    if (ids.length === 0) {
      setPerfils({})
    } else {
      const { data: dadesPerfils } = await supabase
        .from('perfiles').select('id, nombre, email, telefono').in('id', ids)
      const per: Record<string, Perfil> = {}
      for (const p of ((dadesPerfils as Perfil[] | null) ?? [])) per[p.id] = p
      setPerfils(per)
    }

    // ¿Alguna de estas organizaciones ya consta? Se pregunta por ficha —son pocas: el freno
    // durable del registro corta a 20 pendientes por hora (§9)— y en paralelo. Un fallo aquí
    // no puede dejar la cola sin pintar: la sección de enlace es un añadido, no la cola.
    const ambFitxa = pendents.filter((r) => (r.tipo === 'productor' ? r.productores : r.entidades))
    const parells = await Promise.all(ambFitxa.map(async (r) => {
      const fitxa = r.tipo === 'productor' ? r.productores : r.entidades
      const { data: cands, error: errCand } = await supabase.rpc('organitzacions_candidates',
        { p_tipo: r.tipo, p_ficha: fitxa!.id })
      if (errCand) { console.warn('candidates:', errCand.message); return [r.id, [] as Candidat[]] as const }
      return [r.id, ((cands as Candidat[] | null) ?? [])] as const
    }))
    setCandidats(Object.fromEntries(parells))
    setCarregantReg(false)
  }, [])

  const carregaConvenis = useCallback(async () => {
    // ⚠️ Lista de columnas en UN literal (§7, deuda 46). Las dos fichas SÍ se embeben:
    // `convenios` tiene FK real a `productores` y a `entidades`, al revés que `perfiles`.
    const { data, error } = await supabase
      .from('convenios')
      .select('id, tipo, tipo_org, numero_completo, firmado_at, datos_org, firmante, productores(id, name, empresa, poblacion), entidades(id, nombre, poblacion)')
      .eq('estado', 'firmat')
      .order('firmado_at', { ascending: true, nullsFirst: false })

    if (error) {
      // Migración de convenios sin aplicar: la sección se queda vacía y las otras dos
      // siguen vivas.
      console.warn('convenis per contrasignar:', error.message)
      setConvenis([])
      setCarregantConv(false)
      return
    }
    setConvenis((data as unknown as ConveniPendent[]) ?? [])
    setCarregantConv(false)
  }, [])

  useEffect(() => {
    void carrega()
    void carregaRegistres()
    void carregaConvenis()
    const canal = supabase
      .channel('aprovacions-pendents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oferta_respuestas' },
        () => void carrega())
      // La migración añade `membresias` a la publicación: un alta nueva aparece sin
      // recargar. Si no está aplicada, simplemente no llega ningún evento.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'membresias' },
        () => void carregaRegistres())
      // `convenios` NO está en la publicación de Realtime (decisión D del plan: en las
      // tablas documentales se consulta, no se suscribe), así que esa cola se refresca al
      // entrar y después de cada acción. Con un puñado de contrafirmas al día es de sobra.
      .subscribe()
    return () => { void supabase.removeChannel(canal) }
  }, [carrega, carregaRegistres, carregaConvenis])

  /** Los dos errores que las RPC lanzan a propósito tienen texto propio. */
  function textError(err: { code?: string; message: string }): string {
    if (err.code === '42501') return t('appr.reg_no_perm')
    if (err.code === '22023') return t('appr.reg_gone')
    return t('appr.reg_error', { msg: err.message })
  }

  // Aprobar y avisar son DOS cosas, y en ese orden. La aprobación es la que cuenta: si el
  // correo falla, el alta sigue aprobada y lo que hace falta es que el equipo lo sepa para
  // avisar por su cuenta — no que la pantalla dé por fallido lo que sí ha ocurrido.
  //
  // Hasta el 16-09-2026 no se avisaba de nada y la persona se enteraba entrando a probar
  // (deuda 27). El cliente lo pidió así: «al aceptar una organización, un correo con el
  // acceso directo a su panel».
  async function aprovarRegistre(r: Registre) {
    setOcupat(r.id)
    const { error } = await supabase.rpc('aprovar_registre', { p_membresia: r.id })
    if (error) { setOcupat(null); toast.error(textError(error)); return }

    const correu = perfils[r.user_id]?.email ?? null
    const enviat = correu ? await enviarAcces(correu) : null
    setOcupat(null)

    if (enviat?.ok) {
      toast.success(t('appr.reg_approved_mail', { email: correu ?? '' }))
    } else {
      // ⚠️ El motivo más probable NO es un error: con el modo test activo una organización
      //    recién aprobada nace `es_test = false` y el gate la descarta (`no_test_user`,
      //    §8). Decirlo es la diferencia entre que el equipo avise a mano y que crea que ya
      //    está avisado.
      toast.success(t('appr.reg_approved'))
      toast.warning(t(enviat?.codi === 'no_test_user' ? 'appr.mail_test' : 'appr.mail_ko'))
    }
    void carregaRegistres()
  }

  async function rebutjarRegistre(r: Registre, motiu: string) {
    setOcupat(r.id)
    const { error } = await supabase.rpc('rebutjar_registre',
      { p_membresia: r.id, p_motiu: motiu || null })
    setOcupat(null)
    setMotiuDe(null)
    if (error) { toast.error(textError(error)); return }
    toast.success(t('appr.reg_rejected'))
    void carregaRegistres()
  }

  async function enllacar(r: Registre, c: Candidat) {
    const fitxa = r.tipo === 'productor' ? r.productores : r.entidades
    if (!fitxa) return
    setOcupat(r.id)
    const { error } = await supabase.rpc('enllacar_organitzacio',
      { p_tipo: r.tipo, p_ficha: fitxa.id, p_organitzacio: c.organitzacio })
    setOcupat(null)
    setEnllacDe(null)
    // Los mensajes de la RPC ya vienen en catalán y explican el motivo (ficha del mismo tipo,
    // convenios que chocan): enseñarlos tal cual dice más que un texto genérico.
    if (error) {
      toast.error(error.code === '42501' ? t('appr.reg_no_perm') : error.message)
      return
    }
    toast.success(t('appr.link_ok'))
    void carregaRegistres()
  }

  /** Lo que falta por cubrir de esa oferta. Es contra lo que se avisa al canalizar de más. */
  function faltenDe(f: Fila): number {
    return Math.max(0, Number(f.excedentes?.kg_total ?? 0) - (kgCanalitzats[f.excedente_id] ?? 0))
  }

  /** Lo que hay hoy en los dos campos: lo tecleado si se ha tocado, y si no lo que pidió. */
  function valorKg(f: Fila): string {
    return edicions[f.id]?.kg ?? (f.kg_solicitados != null ? String(f.kg_solicitados) : '')
  }
  function valorPreu(f: Fila): string {
    const teclejat = edicions[f.id]?.preu
    if (teclejat !== undefined) return teclejat
    // Si la entidad no dijo precio, se parte del mínimo del productor, que es el suelo.
    const defecte = f.preu_ofert ?? f.excedentes?.preu_minim
    return defecte != null ? String(defecte) : ''
  }

  /**
   * Aprobar desde la cola. Es la misma operación del detalle de la oferta —las dos llaman a
   * `aprovarResposta()`— con los mismos dos avisos delante: canalizar más de lo que falta,
   * y aprobar sin convenio vigente. Lo que cambia es de dónde salen los kg.
   */
  async function aprovarFila(f: Fila) {
    const kg = Number(valorKg(f) || 0)
    if (!f.entidad_id || !kg) { toast.error(t('appr.need_kg')); return }
    if (kg > faltenDe(f) && !(await confirma({
      titol: t('od.over_alloc_t'),
      descripcio: t('od.over_alloc', { n: faltenDe(f) }),
    }))) return

    const falta = await comprovaConvenis(
      { modalitat: f.excedentes?.modalitat ?? null, productor_id: f.excedentes?.productor_id ?? null },
      f.entidad_id, t,
    )
    if (falta && !(await confirma({
      titol: t('od.conv_missing_t'),
      descripcio: t('od.conv_missing', { parts: falta }),
    }))) return

    const preuText = valorPreu(f)
    setOcupat(f.id)
    const res = await aprovarResposta({
      id: f.id, kg, preu: preuText !== '' ? Number(preuText) : null,
    })
    setOcupat(null)
    if (!res.ok) {
      toast.error(res.codi === 'sense_conveni' ? t('od.conv_blocked') : res.missatge)
      return
    }
    toast.success(t('od.approved'))
    // La fila se va de la cola al momento: esperar al refresco de Realtime deja el botón
    // pulsable un instante más, que es como se aprueba dos veces la misma cosa.
    setFiles((prev) => prev.filter((x) => x.id !== f.id))
    void carrega()
    void refrescaComptadors()
  }

  async function rebutjarFila(f: Fila, motiu: string) {
    setOcupat(f.id)
    const res = await rebutjarResposta({ id: f.id, motiu })
    setOcupat(null)
    setMotiuDe(null)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('od.rejected_ok'))
    setFiles((prev) => prev.filter((x) => x.id !== f.id))
    void refrescaComptadors()
  }

  async function contrafirmar(c: ConveniPendent) {
    setOcupat(c.id)
    const res = await contrafirmarConveni(c.id)
    setOcupat(null)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('conv.countersigned'))
    void carregaConvenis()
  }

  async function retornar(c: ConveniPendent, motiu: string) {
    setOcupat(c.id)
    const res = await retornarConveni(c.id, motiu)
    setOcupat(null)
    setMotiuDe(null)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('conv.returned'))
    void carregaConvenis()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('appr.reg_title')} ({registres.length})</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('appr.reg_subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {carregantReg && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
          {!carregantReg && registres.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('appr.reg_empty')}</p>
          )}
          {registres.map((r) => {
            const esProductor = r.tipo === 'productor'
            const fitxa = esProductor ? r.productores : r.entidades
            const perfil = perfils[r.user_id]
            const nom = esProductor
              ? (r.productores?.empresa || r.productores?.name || '—')
              : (r.entidades?.nombre || '—')
            const correu = perfil?.email || (esProductor ? r.productores?.email : r.entidades?.email)
            const tel = perfil?.telefono || (esProductor ? r.productores?.phone : r.entidades?.telefono)
            const tipusReceptor = r.entidades?.tipo_receptor
            const ruta = fitxa
              ? `/equip/${esProductor ? 'productors' : 'entitats'}/${fitxa.id}`
              : null
            const persona = [perfil?.nombre, correu, tel ? `+${tel}` : null]
              .filter(Boolean).join(' · ')
            const context = [
              fitxa?.poblacion,
              t('appr.reg_since', { date: quan(r.created_at) }),
              t(`appr.reg_role_${r.rol_org}`),
            ].filter(Boolean).join(' · ')

            return (
              <div key={r.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        {t(esProductor ? 'appr.reg_prod' : 'appr.reg_ent')}
                      </Badge>
                      {tipusReceptor && TIPUS_RECEPTOR.includes(tipusReceptor) && (
                        <Badge variant="outline">{t(`appr.reg_tr_${tipusReceptor}`)}</Badge>
                      )}
                      <span className="font-medium">{nom}</span>
                    </div>
                    {persona && <div className="text-xs text-muted-foreground">{persona}</div>}
                    <div className="text-xs text-muted-foreground">{context}</div>
                    {!esProductor && !tipusReceptor && (
                      <div className="text-xs text-destructive">{t('appr.reg_no_tr')}</div>
                    )}
                    {/* Si ya comparte organización, lo que toca ofrecer es el deshacer. Va
                        antes que las candidatas porque después de enlazar es lo único que
                        queda: la candidata desaparece de la lista en cuanto son la misma. */}
                    <div className="mt-2 empty:mt-0">
                      <EnllacOrganitzacio
                        tipus={r.tipo}
                        fitxa={fitxa?.id ?? null}
                        potAprovar={potAprovar}
                        onCanviat={() => void carregaRegistres()}
                      />
                    </div>
                    {(candidats[r.id] ?? []).length > 0 && (
                      <div className="mt-2 rounded-md bg-aviso-fondo p-2 text-xs text-aviso">
                        <div className="font-medium">{t('appr.link_found')}</div>
                        <p className="mt-0.5">{t('appr.link_hint')}</p>
                        <ul className="mt-1.5 space-y-1">
                          {(candidats[r.id] ?? []).map((c) => (
                            <li key={c.organitzacio} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-medium">{c.nom || '—'}</span>
                              <span>· {t(`appr.link_why_${c.motiu}`)}</span>
                              {c.enllacable ? (
                                <Button size="sm" variant="outline" className="h-8 whitespace-normal"
                                  disabled={!potAprovar || ocupat === r.id}
                                  onClick={() => setEnllacDe({ registre: r, candidat: c })}>
                                  {t('appr.link_do')}
                                </Button>
                              ) : (
                                <span className="text-muted-foreground">· {t('appr.link_blocked')}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={!ruta}
                      onClick={() => ruta && navigate(ruta)}>
                      {t('appr.reg_view')}
                    </Button>
                    <Button size="sm" disabled={!potAprovar || ocupat === r.id}
                      onClick={() => void aprovarRegistre(r)}>
                      {t('appr.reg_approve')}
                    </Button>
                    <Button size="sm" variant="outline" disabled={!potAprovar || ocupat === r.id}
                      onClick={() => setMotiuDe({ tipus: 'registre', registre: r })}>
                      {t('appr.reg_reject')}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* ── 2. Convenis per contrasignar ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t('appr.conv_title')} ({convenis.length})</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('appr.conv_subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {carregantConv && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
          {!carregantConv && convenis.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('appr.conv_empty')}</p>
          )}
          {convenis.map((c) => {
            const fitxa = c.tipo_org === 'productor'
              ? (c.productores?.empresa || c.productores?.name || null)
              : (c.entidades?.nombre || null)
            const nom = nomOrganitzacio(c.datos_org, fitxa)
            const poblacio = c.tipo_org === 'productor' ? c.productores?.poblacion : c.entidades?.poblacion
            const nif = typeof c.datos_org?.nif === 'string' ? c.datos_org.nif : null
            const firmant = c.firmante ?? {}

            return (
              <div key={c.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{t(`sig.model_${c.tipo}`)}</Badge>
                      <span className="font-medium">{nom}</span>
                    </div>
                    {/* NIF y cargo son EXACTAMENTE lo que hay que revisar antes de estampar
                        (§3.2.4, paso 6): salen aquí para no tener que abrir el detalle
                        cuando están bien, que es casi siempre. */}
                    <div className="text-xs text-muted-foreground">
                      {[c.numero_completo, nif ? `NIF ${nif}` : null, poblacio].filter(Boolean).join(' · ')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('appr.conv_signer', {
                        nom: firmant.nombre ?? '—',
                        carrec: firmant.cargo ?? '—',
                        date: c.firmado_at ? quan(c.firmado_at) : '—',
                      })}
                    </div>
                    {!nif && <div className="text-xs text-destructive">{t('appr.conv_no_nif')}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/equip/convenis/${c.id}`}>{t('c.detail')}</Link>
                    </Button>
                    <Button size="sm" className="whitespace-normal"
                      disabled={!potAprovar || ocupat === c.id}
                      onClick={() => void contrafirmar(c)}>
                      {t('appr.conv_countersign')}
                    </Button>
                    <Button size="sm" variant="outline" disabled={!potAprovar || ocupat === c.id}
                      onClick={() => setMotiuDe({ tipus: 'conveni', conveni: c })}>
                      {t('conv.return')}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* ── 3. Aprovacions d'ofertes ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t('appr.title')} ({files.length})</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('appr.subtitle')}</p>
          {!potAprovar && (
            <p className="mt-1 text-sm text-aviso">{t('appr.need_approver')}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
          {!carregant && files.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('appr.empty')}</p>
          )}
          {files.map((f) => {
            const esVenda = f.excedentes?.modalitat === 'venda' || f.excedentes?.modalitat === 'maquila'
            const total = Number(f.excedentes?.kg_total ?? 0)
            const bloquejat = !potAprovar || ocupat === f.id
            return (
              <div key={f.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {f.entidades?.nombre ?? '—'}
                      {f.entidades?.poblacion ? ` · ${f.entidades.poblacion}` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <code>{f.excedentes?.id_excedente ?? '—'}</code> · {f.excedentes?.producto ?? '—'}
                      {f.kg_solicitados != null ? ` · ${f.kg_solicitados} ${t('od.rs_kg')}` : ''}
                      {f.preu_ofert != null ? ` · ${f.preu_ofert} ${t('od.rs_preu')}` : ''}
                      {` · ${t(`od.ch_${f.canal}`)} · ${quan(f.respondido_at ?? f.enviado_at)}`}
                    </div>
                    {/* Contra qué se decide: aprobar 300 kg de una oferta que ya está
                        cubierta no es lo mismo que de una que empieza. */}
                    <div className="text-xs font-medium text-primary">
                      {t('appr.progres', { n: faltenDe(f), m: total })}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end justify-end gap-2">
                    {/* `text-base md:text-sm`: en iOS un control por debajo de 16px amplía
                        la página al enfocarlo y no lo deshace (§2, regla 1 de móvil). */}
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {t('od.rs_kg')}
                      <Input type="number" inputMode="numeric" min="0"
                        className="h-11 w-24 text-base md:h-9 md:text-sm"
                        value={valorKg(f)}
                        onChange={(e) => setEdicions((p) => ({ ...p, [f.id]: { ...p[f.id], kg: e.target.value } }))} />
                    </label>
                    {esVenda && (
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {t('od.rs_preu')}
                        <Input type="number" inputMode="decimal" step="0.01" min="0"
                          className="h-11 w-24 text-base md:h-9 md:text-sm"
                          value={valorPreu(f)}
                          onChange={(e) => setEdicions((p) => ({ ...p, [f.id]: { ...p[f.id], preu: e.target.value } }))} />
                      </label>
                    )}
                    <Button size="sm" className="h-11 whitespace-normal md:h-9"
                      disabled={bloquejat} title={potAprovar ? undefined : t('appr.need_approver')}
                      onClick={() => void aprovarFila(f)}>
                      {t('od.approve')}
                    </Button>
                    <Button size="sm" variant="outline" className="h-11 whitespace-normal md:h-9"
                      disabled={bloquejat} title={potAprovar ? undefined : t('appr.need_approver')}
                      onClick={() => setMotiuDe({ tipus: 'resposta', fila: f })}>
                      {t('od.reject_appr')}
                    </Button>
                    {/* El detalle sigue a un clic: aquí no caben el resto de respuestas ni
                        el ranking de entidades, y a veces son justo lo que hay que mirar. */}
                    <Button size="sm" variant="ghost" className="h-11 whitespace-normal md:h-9"
                      onClick={() => navigate(`/equip/ofertes/${f.excedente_id}`)}>
                      {t('appr.open')}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Enlazar fusiona dos organizaciones y desde aquí no se deshace, así que se dice lo
          que va a pasar antes de hacerlo — y con un diálogo propio, no `window.confirm`. */}
      <Dialog open={enllacDe !== null} onOpenChange={(v) => { if (!v) setEnllacDe(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('appr.link_title')}</DialogTitle>
            <DialogDescription>
              {t('appr.link_desc', {
                fitxa: enllacDe
                  ? (enllacDe.registre.tipo === 'productor'
                      ? (enllacDe.registre.productores?.empresa || enllacDe.registre.productores?.name || '—')
                      : (enllacDe.registre.entidades?.nombre || '—'))
                  : '',
                org: enllacDe?.candidat.nom ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('appr.link_warn')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnllacDe(null)}>{t('c.cancel')}</Button>
            <Button disabled={ocupat !== null}
              onClick={() => { if (enllacDe) void enllacar(enllacDe.registre, enllacDe.candidat) }}>
              {t('appr.link_do')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* El motivo de las dos acciones que lo exigen. Un único diálogo para las dos colas:
          lo que cambia es a quién se lo cuenta, no lo que se pregunta. */}
      <DialegMotiu
        obert={motiuDe !== null}
        onObert={(v) => { if (!v) setMotiuDe(null) }}
        titol={t(TEXTOS_MOTIU[motiuDe?.tipus ?? 'registre'].titol)}
        descripcio={t(TEXTOS_MOTIU[motiuDe?.tipus ?? 'registre'].descripcio)}
        etiqueta={t(TEXTOS_MOTIU[motiuDe?.tipus ?? 'registre'].etiqueta)}
        confirmar={t(TEXTOS_MOTIU[motiuDe?.tipus ?? 'registre'].confirmar)}
        destructiu={motiuDe?.tipus !== 'conveni'}
        ocupat={ocupat !== null}
        onConfirma={(m) => {
          if (!motiuDe) return
          if (motiuDe.tipus === 'conveni') void retornar(motiuDe.conveni, m)
          else if (motiuDe.tipus === 'resposta') void rebutjarFila(motiuDe.fila, m)
          else void rebutjarRegistre(motiuDe.registre, m)
        }}
      />

      {dialeg}
    </div>
  )
}
