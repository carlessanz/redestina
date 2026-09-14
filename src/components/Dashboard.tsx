import { useCallback, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { useWhatsappActiu } from '../hooks/useAppContext'
import { cn } from '../lib/utils'
import {
  anadirNumeroTest, borrarNumeroTest, listarNumerosTest, type MetaTestRecipient,
} from '../lib/metaTest'
import {
  anadirEmailTest, borrarEmailTest, listarEmailsTest, type EmailTestRecipient,
} from '../lib/emailTest'
import { pendentsPerTelefon } from '../lib/contactes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ExcRow { id: string; estado: string; kg_total: number | null }

const ACTIVOS = ['borrador', 'publicada', 'parcial', 'bloqueada']

const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '')

function Kpi({ titulo, valor, sub, detalle }: {
  titulo: string; valor: number | string; sub: string; detalle: { texto: string; destacado?: boolean }[]
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold leading-none text-primary">{valor}</div>
        <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
        <ul className="mt-3 space-y-0.5 border-t pt-2 text-sm">
          {detalle.map((d, i) => (
            <li key={i} className={d.destacado ? 'font-medium text-primary' : 'text-muted-foreground'}>{d.texto}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function GestorWhitelist({ titulo, ayuda, items, placeholderClave, placeholderEtiqueta, max, onAdd, onDelete, addLabel, noneLabel }: {
  titulo: string; ayuda: string; items: { clave: string; etiqueta: string | null }[]
  placeholderClave: string; placeholderEtiqueta: string; max: number
  addLabel: string; noneLabel: string
  onAdd: (clave: string, etiqueta: string) => Promise<string | null>
  onDelete: (clave: string) => Promise<void>
}) {
  const [clave, setClave] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {items.length === 0 && <p className="text-sm text-muted-foreground">{noneLabel}</p>}
          {items.map((r) => (
            <div key={r.clave} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium tabular-nums">{r.clave}</span>
              <span className="flex-1 text-muted-foreground">{r.etiqueta ?? '—'}</span>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => void onDelete(r.clave)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        {items.length < max && (
          <div className="flex flex-wrap gap-2">
            <Input className="flex-1" placeholder={placeholderClave} value={clave}
              onChange={(e) => { setClave(e.target.value); setError(null) }} />
            <Input className="flex-1" placeholder={placeholderEtiqueta} value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)} />
            <Button onClick={async () => {
              const err = await onAdd(clave, etiqueta)
              if (err) { setError(err); return }
              setClave(''); setEtiqueta('')
            }}>{addLabel}</Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const { t } = useT()
  const waActiu = useWhatsappActiu()
  const [prodPhones, setProdPhones] = useState<(string | null)[]>([])
  const [entidades, setEntidades] = useState<{ telefono: string | null; email: string | null; opt_in: boolean | null }[]>([])
  const [excedentes, setExcedentes] = useState<ExcRow[]>([])
  const [canalKg, setCanalKg] = useState<Record<string, number>>({})
  const [kgConfirmadosTotal, setKgConfirmadosTotal] = useState(0)
  const [missatgesRebuts, setMissatgesRebuts] = useState(0)
  const [missatgesPendents, setMissatgesPendents] = useState(0)
  const [intakeActivas, setIntakeActivas] = useState(0)
  const [lista, setLista] = useState<MetaTestRecipient[]>([])
  const [listaEmail, setListaEmail] = useState<EmailTestRecipient[]>([])
  const [loading, setLoading] = useState(true)

  const numerosSet = useMemo(() => new Set(lista.map((r) => r.phone)), [lista])

  const cargar = useCallback(async () => {
    setLoading(true)
    // Qué se pide y qué NO (deuda §12.5). Lo que solo alimenta un número se cuenta en la
    // base con `head: true`: la fila no viaja. Lo que sigue pidiendo filas es porque una KPI
    // las necesita de verdad, y se dice cuál —una cifra rota para ahorrar una consulta sería
    // un mal cambio—.
    const [prod, ent, exc, canal, rebuts, pendents, intake, meta, mails] = await Promise.all([
      // Filas: `enMeta` cruza cada teléfono con la whitelist de Meta, que vive en otra tabla
      // y no se puede cruzar desde aquí con un `count`.
      supabase.from('productores').select('phone'),
      // Filas: igual que arriba, y además `opt_in`/`email` son tres recuentos sobre la misma
      // lista — tres `head` en vez de una lectura de tres columnas no compensa.
      supabase.from('entidades').select('telefono, email, opt_in'),
      // Filas: los kg pendientes son `kg_total − canalizado` **por oferta**, así que hace
      // falta la pareja (id, kg_total) y no un recuento por estado.
      supabase.from('excedentes').select('id, estado, kg_total'),
      supabase.from('canalizaciones').select('excedente_id, kg_confirmados'),
      // Antes: `wa_messages` ENTERA (las tres columnas, sin filtro ni límite) para sacar de
      // ella dos números. Ahora los recibidos los cuenta la base…
      supabase.from('wa_messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound'),
      // …y los «sin contestar» los agrega `missatges_sense_contestar()`, la misma RPC que ya
      // usan `ProducersList`, `ContactList` y el badge del menú. La regla no se reimplementa.
      pendentsPerTelefon(),
      supabase.from('intake_sessions').select('id', { count: 'exact', head: true }),
      listarNumerosTest(),
      listarEmailsTest(),
    ])
    setProdPhones((prod.data ?? []).map((p) => p.phone))
    setEntidades(ent.data ?? [])
    setExcedentes((exc.data ?? []) as ExcRow[])
    const porExc: Record<string, number> = {}
    let totalKg = 0
    for (const c of canal.data ?? []) {
      const kg = Number(c.kg_confirmados ?? 0)
      totalKg += kg
      if (c.excedente_id) porExc[c.excedente_id] = (porExc[c.excedente_id] ?? 0) + kg
    }
    setCanalKg(porExc)
    setKgConfirmadosTotal(totalKg)
    setMissatgesRebuts(rebuts.count ?? 0)
    setMissatgesPendents(Object.values(pendents).reduce((suma, n) => suma + n, 0))
    setIntakeActivas(intake.count ?? 0)
    setLista(meta)
    setListaEmail(mails)
    setLoading(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const kpis = useMemo(() => {
    const ofertas = { activas: 0, bloqueadas: 0, cerradas: 0, noColocadas: 0, canceladas: 0 }
    let pendientes = 0
    for (const e of excedentes) {
      if (e.estado === 'bloqueada') ofertas.bloqueadas += 1
      else if (e.estado === 'cerrada') ofertas.cerradas += 1
      else if (e.estado === 'no_colocada') ofertas.noColocadas += 1
      else if (e.estado === 'cancelada') ofertas.canceladas += 1
      if (['borrador', 'publicada', 'parcial'].includes(e.estado)) ofertas.activas += 1
      if (ACTIVOS.includes(e.estado)) pendientes += Math.max(0, Number(e.kg_total ?? 0) - (canalKg[e.id] ?? 0))
    }
    const conMovil = prodPhones.filter((p) => p && soloDigitos(p).length >= 9).length
    const prodEnMeta = prodPhones.filter((p) => p && numerosSet.has(p)).length
    const entConOptIn = entidades.filter((e) => e.opt_in).length
    const entEnMeta = entidades.filter((e) => numerosSet.has(soloDigitos(e.telefono))).length
    const entConEmail = entidades.filter((e) => e.email).length
    return {
      ofertas, kg: { canalizados: kgConfirmadosTotal, pendientes },
      productores: { total: prodPhones.length, conMovil, enMeta: prodEnMeta },
      entidades: { total: entidades.length, conOptIn: entConOptIn, enMeta: entEnMeta, conEmail: entConEmail },
      mensajes: { recibidos: missatgesRebuts, sinContestar: missatgesPendents, intakeActivas },
    }
  }, [excedentes, canalKg, kgConfirmadosTotal, prodPhones, entidades,
      missatgesRebuts, missatgesPendents, intakeActivas, numerosSet])

  const PROCESO = [
    { n: 1, tk: 'dash.p1t', dk: 'dash.p1d' },
    { n: 2, tk: 'dash.p2t', dk: 'dash.p2d' },
    { n: 3, tk: 'dash.p3t', dk: 'dash.p3d' },
    { n: 4, tk: 'dash.p4t', dk: 'dash.p4d' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t('dash.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('dash.subtitle')}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('dash.how')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PROCESO.map((p) => (
            <Card key={p.n}>
              <CardContent className="pt-6">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{p.n}</span>
                <h3 className="mt-2 text-sm font-semibold">{t(p.tk)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(p.dk)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('dash.glance')}</h2>
        {loading ? <p className="text-sm text-muted-foreground">{t('c.loading')}</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi titulo={t('dash.k_offers')} valor={kpis.ofertas.activas} sub={t('dash.active')} detalle={[
              { texto: `${kpis.ofertas.bloqueadas} ${t('dash.blocked')}` },
              { texto: `${kpis.ofertas.cerradas} ${t('dash.closed')}` },
              { texto: `${kpis.ofertas.noColocadas} ${t('dash.uncoll')}` },
              { texto: `${kpis.ofertas.canceladas} ${t('dash.cancelled')}` },
            ]} />
            <Kpi titulo={t('dash.k_kg')} valor={kpis.kg.canalizados} sub={t('dash.channeled')} detalle={[
              { texto: t('dash.pending_kg', { n: kpis.kg.pendientes }) },
            ]} />
            <Kpi titulo={t('dash.k_producers')} valor={kpis.productores.total} sub={t('dash.in_base')} detalle={[
              { texto: t('dash.with_mobile', { n: kpis.productores.conMovil }) },
              { texto: t('dash.in_meta', { n: kpis.productores.enMeta }), destacado: true },
            ]} />
            <Kpi titulo={t('dash.k_entities')} valor={kpis.entidades.total} sub={t('dash.receivers')} detalle={[
              { texto: t('dash.with_optin', { n: kpis.entidades.conOptIn }) },
              { texto: t('dash.with_email', { n: kpis.entidades.conEmail }) },
              { texto: t('dash.in_meta', { n: kpis.entidades.enMeta }), destacado: true },
            ]} />
            <Kpi titulo={t('dash.k_messages')} valor={kpis.mensajes.recibidos} sub={t('dash.received')} detalle={[
              { texto: t('dash.unanswered', { n: kpis.mensajes.sinContestar }) },
              { texto: t('dash.sessions', { n: kpis.mensajes.intakeActivas }) },
            ]} />
          </div>
        )}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {/* Con WhatsApp apagado (§8) la lista de Meta no decide nada: se atenúa y se dice,
            en vez de esconderla —sigue siendo el estado que hay que dejar bien antes de
            volver a encender el canal—. */}
        <div className={cn('space-y-2', !waActiu && 'opacity-60')}>
        {!waActiu && <p className="text-xs text-aviso">{t('dash.wa_off')}</p>}
        <GestorWhitelist
          titulo={t('dash.meta_title')} ayuda={t('dash.meta_help')}
          items={lista.map((r) => ({ clave: r.phone, etiqueta: r.etiqueta }))}
          placeholderClave={t('dash.ph_phone')} placeholderEtiqueta={t('dash.ph_label')} max={5}
          addLabel={t('c.add')} noneLabel={t('dash.none_yet')}
          onAdd={async (c, e) => { const err = await anadirNumeroTest(c, e); if (!err) setLista(await listarNumerosTest()); return err }}
          onDelete={async (c) => { await borrarNumeroTest(c); setLista(await listarNumerosTest()) }}
        />
        </div>
        <GestorWhitelist
          titulo={t('dash.email_title')} ayuda={t('dash.email_help')}
          items={listaEmail.map((r) => ({ clave: r.email, etiqueta: r.etiqueta }))}
          placeholderClave={t('dash.ph_email')} placeholderEtiqueta={t('dash.ph_label')} max={20}
          addLabel={t('c.add')} noneLabel={t('dash.none_yet')}
          onAdd={async (c, e) => { const err = await anadirEmailTest(c, e); if (!err) setListaEmail(await listarEmailsTest()); return err }}
          onDelete={async (c) => { await borrarEmailTest(c); setListaEmail(await listarEmailsTest()) }}
        />
      </section>
    </div>
  )
}
