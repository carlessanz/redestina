// El tablero del equipo: qué hay que hacer hoy, cómo funciona el servicio y el volumen.
//
// EN ESE ORDEN, Y NO EN OTRO (14-09-2026). Antes la pantalla abría con cuatro tarjetas de
// texto sin enlaces, seguía con cinco cifras que no llevaban a ninguna parte y terminaba
// con **media pantalla dedicada a las dos whitelists del entorno de pruebas**, que son un
// ajuste que se toca dos veces al año. Lo que sí se mira cada mañana —lo que espera una
// acción— no estaba: había que abrir ocho listados para descubrir si tenían algo.
//
//   1. El aviso del modo de pruebas, **solo si está encendido**. Antes el subtítulo
//      afirmaba «Enviaments limitats als números de prova» SIEMPRE, también en producción,
//      que es justo cuando esa frase es falsa y peligrosa.
//   2. `PendentsEquip`: las once colas con trabajo, con su cifra y su botón.
//   3. `ComFunciona`: las seis fases, cada una enlazando a su sección del menú.
//   4. Los KPI de volumen, ahora clicables.
//
// Las whitelists se fueron a **Configuració**, junto al modo test y al interruptor de
// WhatsApp (§8): es donde están los otros interruptores que deciden a quién se envía.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { getTestMode } from '../lib/settings'
import { pendentsPerTelefon } from '../lib/contactes'
import PendentsEquip from './equip/PendentsEquip'
import ComFunciona from './equip/ComFunciona'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ExcRow { id: string; estado: string; kg_total: number | null }

const ACTIVOS = ['borrador', 'publicada', 'parcial', 'bloqueada']

const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '')

/**
 * Una cifra de volumen. Es un enlace entero, no una tarjeta con un enlace dentro: quien
 * mira «Ofertes: 12» quiere ir a las ofertas, y hasta hoy tenía que buscarlas en el menú.
 */
function Kpi({ titulo, valor, sub, detalle, to }: {
  titulo: string; valor: number | string; sub: string
  detalle: { texto: string }[]
  to: string
}) {
  return (
    <Link to={to} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold leading-none text-primary">{valor}</div>
          <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
          <ul className="mt-3 space-y-0.5 border-t pt-2 text-sm text-muted-foreground">
            {detalle.map((d, i) => <li key={i}>{d.texto}</li>)}
          </ul>
        </CardContent>
      </Card>
    </Link>
  )
}

export default function Dashboard() {
  const { t } = useT()
  const [prodPhones, setProdPhones] = useState<(string | null)[]>([])
  const [entidades, setEntidades] = useState<{ email: string | null; opt_in: boolean | null }[]>([])
  const [excedentes, setExcedentes] = useState<ExcRow[]>([])
  const [canalKg, setCanalKg] = useState<Record<string, number>>({})
  const [kgConfirmadosTotal, setKgConfirmadosTotal] = useState(0)
  const [missatgesRebuts, setMissatgesRebuts] = useState(0)
  const [missatgesPendents, setMissatgesPendents] = useState(0)
  const [intakeActivas, setIntakeActivas] = useState(0)
  const [modeProves, setModeProves] = useState(false)
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    // Qué se pide y qué NO (deuda §12.5). Lo que solo alimenta un número se cuenta en la
    // base con `head: true`: la fila no viaja. Lo que sigue pidiendo filas es porque una KPI
    // las necesita de verdad, y se dice cuál —una cifra rota para ahorrar una consulta sería
    // un mal cambio—. Las dos consultas a las whitelists se fueron con ellas a Configuració.
    const [prod, ent, exc, canal, rebuts, pendents, intake, test] = await Promise.all([
      // Filas: `conMovil` mira la forma del teléfono, no su existencia.
      supabase.from('productores').select('phone'),
      // Filas: `opt_in` y `email` son dos recuentos sobre la misma lista.
      supabase.from('entidades').select('email, opt_in'),
      // Filas: los kg pendientes son `kg_total − canalizado` **por oferta**, así que hace
      // falta la pareja (id, kg_total) y no un recuento por estado.
      supabase.from('excedentes').select('id, estado, kg_total'),
      supabase.from('canalizaciones').select('excedente_id, kg_confirmados'),
      supabase.from('wa_messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound'),
      // Los «sin contestar» los agrega `missatges_sense_contestar()`, la misma RPC que ya
      // usan `ProducersList`, `ContactList` y el badge del menú. La regla no se reimplementa.
      pendentsPerTelefon(),
      supabase.from('intake_sessions').select('id', { count: 'exact', head: true }),
      getTestMode(),
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
    setModeProves(test)
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
    const entConOptIn = entidades.filter((e) => e.opt_in).length
    const entConEmail = entidades.filter((e) => e.email).length
    return {
      ofertas, kg: { canalizados: kgConfirmadosTotal, pendientes },
      productores: { total: prodPhones.length, conMovil },
      entidades: { total: entidades.length, conOptIn: entConOptIn, conEmail: entConEmail },
      mensajes: { recibidos: missatgesRebuts, sinContestar: missatgesPendents, intakeActivas },
    }
  }, [excedentes, canalKg, kgConfirmadosTotal, prodPhones, entidades,
      missatgesRebuts, missatgesPendents, intakeActivas])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t('dash.title')}</h1>
      </div>

      {/* Solo cuando es verdad: en producción esta banda no existe. */}
      {modeProves && (
        <div className="flex flex-col gap-2 rounded-xl border border-aviso/30 bg-aviso-fondo p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-aviso" aria-hidden />
            <p className="text-sm font-medium text-aviso">{t('dash.test_banner')}</p>
          </div>
          <Link
            to="/equip/configuracio"
            className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-aviso underline md:min-h-0"
          >
            {t('dash.test_banner_cta')}
          </Link>
        </div>
      )}

      <PendentsEquip />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('dash.how')}</h2>
        <ComFunciona />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('dash.glance')}</h2>
        {loading ? <p className="text-sm text-muted-foreground">{t('c.loading')}</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi to="/equip/ofertes" titulo={t('dash.k_offers')} valor={kpis.ofertas.activas} sub={t('dash.active')} detalle={[
              { texto: `${kpis.ofertas.bloqueadas} ${t('dash.blocked')}` },
              { texto: `${kpis.ofertas.cerradas} ${t('dash.closed')}` },
              { texto: `${kpis.ofertas.noColocadas} ${t('dash.uncoll')}` },
              { texto: `${kpis.ofertas.canceladas} ${t('dash.cancelled')}` },
            ]} />
            <Kpi to="/equip/ofertes" titulo={t('dash.k_kg')} valor={kpis.kg.canalizados} sub={t('dash.channeled')} detalle={[
              { texto: t('dash.pending_kg', { n: kpis.kg.pendientes }) },
            ]} />
            <Kpi to="/equip/productors" titulo={t('dash.k_producers')} valor={kpis.productores.total} sub={t('dash.in_base')} detalle={[
              { texto: t('dash.with_mobile', { n: kpis.productores.conMovil }) },
            ]} />
            <Kpi to="/equip/entitats" titulo={t('dash.k_entities')} valor={kpis.entidades.total} sub={t('dash.receivers')} detalle={[
              { texto: t('dash.with_optin', { n: kpis.entidades.conOptIn }) },
              { texto: t('dash.with_email', { n: kpis.entidades.conEmail }) },
            ]} />
            <Kpi to="/equip/missatgeria" titulo={t('dash.k_messages')} valor={kpis.mensajes.recibidos} sub={t('dash.received')} detalle={[
              { texto: t('dash.unanswered', { n: kpis.mensajes.sinContestar }) },
              { texto: t('dash.sessions', { n: kpis.mensajes.intakeActivas }) },
            ]} />
          </div>
        )}
      </section>
    </div>
  )
}
