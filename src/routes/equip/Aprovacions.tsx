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
//    (canal 'panel') la cola crece sin que nadie la mire. Aprobar sigue haciéndose en el
//    detalle de la oferta, donde está el contexto (kg que faltan, preu, resto de
//    respuestas).
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
import type { Convenio, Membresia } from '../../types'
import DialegMotiu from '../../components/DialegMotiu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Fila {
  id: string
  excedente_id: string
  kg_solicitados: number | null
  preu_ofert: number | null
  canal: string
  respondido_at: string | null
  enviado_at: string
  entidades: { nombre: string; poblacion: string | null } | null
  excedentes: { id_excedente: string | null; producto: string | null; kg_total: number | null } | null
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

function quan(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ` +
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

export default function Aprovacions() {
  const { t } = useT()
  const navigate = useNavigate()
  const { ctx } = useAppContext()
  const [files, setFiles] = useState<Fila[]>([])
  const [carregant, setCarregant] = useState(true)
  const [registres, setRegistres] = useState<Registre[]>([])
  const [perfils, setPerfils] = useState<Record<string, Perfil>>({})
  const [carregantReg, setCarregantReg] = useState(true)
  const [convenis, setConvenis] = useState<ConveniPendent[]>([])
  const [carregantConv, setCarregantConv] = useState(true)
  /** Id de la fila que se está resolviendo, para no dejar pulsar dos veces. */
  const [ocupat, setOcupat] = useState<string | null>(null)
  /** El motivo se pide con diálogo propio, nunca con `window.prompt` (deuda §12.35). */
  const [motiuDe, setMotiuDe] = useState<
    { tipus: 'registre'; registre: Registre } | { tipus: 'conveni'; conveni: ConveniPendent } | null
  >(null)

  // Con el contexto degradado (RPC de sesión no desplegada) se asume que sí: es como se
  // ha comportado la app siempre. La RPC revalida de todas formas y devuelve 42501.
  const potAprovar = ctx?.potAprovar ?? true

  const carrega = useCallback(async () => {
    const { data } = await supabase
      .from('oferta_respuestas')
      .select('id, excedente_id, kg_solicitados, preu_ofert, canal, respondido_at, enviado_at, ' +
        'entidades(nombre, poblacion), excedentes(id_excedente, producto, kg_total)')
      .eq('estado', 'acceptada')
      .eq('aprovacio', 'pendent')
      .order('respondido_at', { ascending: true, nullsFirst: false })
    setFiles((data as unknown as Fila[]) ?? [])
    setCarregant(false)
  }, [])

  const carregaRegistres = useCallback(async () => {
    // `productores` y `entidades` sí son embebibles (hay FK real); `perfiles` NO, porque
    // `membresias.user_id` referencia `auth.users`, no `perfiles`: la persona se cruza
    // en una segunda consulta con los user_id que hayan salido.
    const { data, error } = await supabase
      .from('membresias')
      .select('id, user_id, tipo, rol_org, created_at, ' +
        'productores(id, name, empresa, email, phone, poblacion), ' +
        'entidades(id, nombre, email, telefono, poblacion, tipo_receptor)')
      .eq('aprovacio', 'pendent')
      .order('created_at', { ascending: true })

    if (error) {
      // Migración del registro público sin aplicar (la columna `aprovacio` no existe):
      // la sección se queda vacía y la cola de ofertas sigue viva.
      console.warn('registres pendents:', error.message)
      setRegistres([])
      setPerfils({})
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

  async function aprovarRegistre(r: Registre) {
    setOcupat(r.id)
    const { error } = await supabase.rpc('aprovar_registre', { p_membresia: r.id })
    setOcupat(null)
    if (error) { toast.error(textError(error)); return }
    toast.success(t('appr.reg_approved'))
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
          <CardTitle>{t('appr.reg_title')}</CardTitle>
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
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
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
          <CardTitle>{t('appr.conv_title')}</CardTitle>
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
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
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
          <CardTitle>{t('appr.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('appr.subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
          {!carregant && files.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('appr.empty')}</p>
          )}
          {files.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
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
              </div>
              <Button size="sm" onClick={() => navigate(`/equip/ofertes/${f.excedente_id}`)}>
                {t('appr.open')}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* El motivo de las dos acciones que lo exigen. Un único diálogo para las dos colas:
          lo que cambia es a quién se lo cuenta, no lo que se pregunta. */}
      <DialegMotiu
        obert={motiuDe !== null}
        onObert={(v) => { if (!v) setMotiuDe(null) }}
        titol={t(motiuDe?.tipus === 'conveni' ? 'conv.return_title' : 'appr.reg_reject')}
        descripcio={t(motiuDe?.tipus === 'conveni' ? 'conv.return_desc' : 'appr.reg_reject_desc')}
        etiqueta={t(motiuDe?.tipus === 'conveni' ? 'conv.return_label' : 'appr.reg_reject_reason')}
        confirmar={t(motiuDe?.tipus === 'conveni' ? 'conv.return' : 'appr.reg_reject')}
        destructiu={motiuDe?.tipus === 'registre'}
        ocupat={ocupat !== null}
        onConfirma={(m) => {
          if (!motiuDe) return
          if (motiuDe.tipus === 'conveni') void retornar(motiuDe.conveni, m)
          else void rebutjarRegistre(motiuDe.registre, m)
        }}
      />
    </div>
  )
}
