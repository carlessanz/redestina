// El listado «Entitats» del equipo (plan 1, rebanada 1C, D1): una fila por ORGANIZACIÓN, con
// su papel o doble papel, sobre `v_entitats_llistat`. Sustituye a los dos listados de antes
// («Entitats productores» / «Entitats receptores», uno por tabla).
//
// Filtros con `BarraFiltres` (fase 6): papel, estado, zona, tipo de entidad y cuenta.
// **Por defecto solo las activas** (P10): el filtro «Estat» viene puesto y el contador
// «Mostrant N de M» lo dice; quitarlo enseña las inactivas (las importadas de 1E entrarán así).
// `?rol=ofertant|receptor` en la URL fija el papel (es a donde redirigen `/equip/productors` y
// las tarjetas del tablero). Como los listados de siempre: arriba las de prueba, buscador en
// cliente (son cientos de filas, deuda §12.5), «Missatge» y «Correu» por fila. «Darrer
// contacte» es la nota interna más reciente (1F, `notes_internes`).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useCanals, useWhatsappActiu } from '../../hooks/useAppContext'
import { motiuCanal } from '../../lib/canals'
import { assegurarContacte, pendentsPerTelefon } from '../../lib/contactes'
import { filtraCerca } from '../../lib/cerca'
import { useCerca } from '../../hooks/useCerca'
import { useFiltresLlistat } from '../../hooks/useFiltresLlistat'
import { filtraLlistat, opcionsDisponibles, type Dimensio } from '../../lib/filtres'
import { dataCurta } from '../../lib/format'
import { faTemps } from '../../lib/notesInternes'
import BarraFiltres from '../../components/BarraFiltres'
import BotoAmbMotiu from '../../components/proces/BotoAmbMotiu'
import DialegCorreu, { type DestinatariCorreu } from '../../components/DialegCorreu'
import type { EntitatLlistat } from '../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const COLS = 'id, nom_comercial, razon_social, nif, persona_contacte, email, telefono, poblacion, comarca, municipio_ine, productor_id, entidad_id, es_generadora, es_receptora, productor_activo, entidad_activo, activa, tipo_receptor, tipus_activitat, te_compte, compte_estat, canal_preferido, created_at, es_test, rebutjada, modalitats_interes, prioritat, conveni_productor, conveni_entitat, darrera_activitat, darrer_contacte_at, darrer_contacte_canal'

const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '')
const PER_DEFECTE = { estat: 'activa' }

export default function Entitats() {
  const { t } = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const waActiu = useWhatsappActiu()
  // Con el correo apagado (§8) «Correu» se queda gris con el motivo.
  const motiuEmail = motiuCanal(useCanals(), 'email')
  const [correuA, setCorreuA] = useState<DestinatariCorreu | null>(null)
  const [files, setFiles] = useState<EntitatLlistat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState<Record<string, number>>({})
  const { cerca, setCerca, q } = useCerca()

  useEffect(() => {
    let cancelled = false
    supabase.from('v_entitats_llistat').select(COLS).order('nom_comercial', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(loadError.message)
        else setFiles([...((data ?? []) as EntitatLlistat[])].sort((x, y) =>
          String(x.nom_comercial ?? '').localeCompare(String(y.nom_comercial ?? ''), 'ca')))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    // Los pendientes los cuenta la BASE (§12.5); un mensaje nuevo invalida la cuenta.
    const recompta = () => { void pendentsPerTelefon().then((c) => { if (!cancelled) setUnanswered(c) }) }
    recompta()
    const channel = supabase
      .channel('wa-messages-entitats')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_messages' }, () => recompta())
      .subscribe()
    return () => { cancelled = true; void supabase.removeChannel(channel) }
  }, [])

  const fl = useFiltresLlistat('equip-entitats', PER_DEFECTE)
  // `?rol=` fija el papel al llegar (del tablero o de la ruta antigua de productores).
  const rolUrl = params.get('rol')
  useEffect(() => {
    if (rolUrl === 'ofertant' || rolUrl === 'receptor') fl.setValors({ ...fl.valors, rol: rolUrl })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al llegar con `?rol=`
  }, [rolUrl])

  // El papel NO es una dimensión de `filtraLlistat` (una organización con doble rol cuenta en
  // los dos, y una dimensión solo admite un valor por fila): se filtra aparte, `perRol`.
  const dims = useMemo<Dimensio<EntitatLlistat>[]>(() => [
    { clau: 'estat', etiquetaKey: 'fl.d_estat', valor: (e) => (e.activa ? 'activa' : 'inactiva') },
    { clau: 'comarca', etiquetaKey: 'fl.d_comarca', valor: (e) => e.comarca },
    { clau: 'tipus', etiquetaKey: 'fl.d_tipus', valor: (e) => e.tipo_receptor },
    { clau: 'compte', etiquetaKey: 'fl.d_compte', valor: (e) => e.compte_estat },
  ], [])
  const perRol = (e: EntitatLlistat) => !fl.valors.rol
    || (fl.valors.rol === 'ofertant' && e.es_generadora) || (fl.valors.rol === 'receptor' && e.es_receptora)

  const { test, resto } = useMemo(() => {
    const filtrades = filtraLlistat(filtraCerca(files, q,
      (e) => [e.nom_comercial, e.razon_social, e.nif, e.persona_contacte, e.poblacion, e.comarca, e.telefono, e.email]), dims, fl.valors)
      .filter(perRol)
    const test: EntitatLlistat[] = []
    const resto: EntitatLlistat[] = []
    for (const e of filtrades) (e.es_test ? test : resto).push(e)
    return { test, resto }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `perRol` solo depende de `fl.valors`
  }, [files, q, dims, fl.valors])

  const textDim = (clau: string) => (v: string) => {
    if (clau === 'rol') return t(`fl.v_${v}`)
    if (clau === 'estat') return t(`fl.v_${v}`)
    if (clau === 'tipus') return t(`org.tr_${v}`)
    if (clau === 'compte') return t(`ef.compte_${v}`)
    return v
  }

  function conveni(e: EntitatLlistat): { text: string; ok: boolean } {
    const falta: string[] = []
    if (e.es_generadora && !e.conveni_productor) falta.push(t('ef.paper_ofertant').toLowerCase())
    if (e.es_receptora && !e.conveni_entitat) falta.push(t('ef.paper_receptor').toLowerCase())
    const papers = Number(e.es_generadora) + Number(e.es_receptora)
    if (falta.length === 0) return { text: t('c.yes'), ok: true }
    if (falta.length === papers) return { text: t('el.conveni_cap'), ok: false }
    const te = e.conveni_productor ? t('ef.paper_ofertant') : t('ef.paper_receptor')
    return { text: t('el.conveni_part', { rol: te.toLowerCase() }), ok: false }
  }

  function tabla(lista: EntitatLlistat[], marcarTest: boolean) {
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('el.c_name')}</TableHead>
              <TableHead>{t('el.c_rols')}</TableHead>
              <TableHead>{t('el.c_nif')}</TableHead>
              <TableHead>{t('el.c_town')}</TableHead>
              <TableHead>{t('el.c_compte')}</TableHead>
              <TableHead>{t('el.c_conveni')}</TableHead>
              <TableHead>{t('el.c_activitat')}</TableHead>
              <TableHead>{t('el.c_contacte')}</TableHead>
              <TableHead className="text-right">{t('el.c_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((e) => {
              const tel = soloDigitos(e.telefono)
              const sense = tel ? (unanswered[tel] ?? 0) : 0
              const conv = conveni(e)
              const nom = e.nom_comercial || e.razon_social || e.persona_contacte || '—'
              const contacte = e.darrer_contacte_at ? faTemps(e.darrer_contacte_at) : null
              return (
                <TableRow key={e.id} data-testid="entitat-fila">
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {nom}
                      {marcarTest && <Badge variant="secondary">{t('badge.test')}</Badge>}
                      {!e.activa && <Badge className="bg-muted text-muted-foreground">{t('ef.estat_inactiva')}</Badge>}
                      {/* Un alta rechazada se MARCA, no se esconde (§12.29). */}
                      {e.rebutjada && <Badge className="bg-error-fondo text-error">{t('badge.rejected')}</Badge>}
                      {sense > 0 && <Badge variant="destructive">{t('el.unanswered', { n: sense })}</Badge>}
                      {e.persona_contacte && e.persona_contacte !== nom && (
                        <span className="w-full text-xs font-normal text-muted-foreground">{e.persona_contacte}</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {/* Un papel inactivo, en gris: la organización puede seguir activa por el otro. */}
                      {e.es_generadora && (
                        <Badge variant="outline" className={e.productor_activo ? undefined : 'text-muted-foreground line-through'}>
                          {t('ef.paper_ofertant')}
                        </Badge>
                      )}
                      {e.es_receptora && (
                        <Badge variant="outline" className={e.entidad_activo ? undefined : 'text-muted-foreground line-through'}>
                          {t('ef.paper_receptor')}
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{e.nif ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.poblacion ?? '—'}
                    {e.comarca && <span className="block text-xs">{e.comarca}</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t(`ef.compte_${e.compte_estat}`)}</TableCell>
                  <TableCell className={conv.ok ? 'text-exito' : 'text-aviso'}>{conv.text}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {e.darrera_activitat ? dataCurta(e.darrera_activitat) : t('el.activitat_mai')}
                  </TableCell>
                  {/* La nota interna más reciente (1F): «fa 3 dies · WhatsApp». */}
                  <TableCell className="whitespace-nowrap text-muted-foreground" data-testid="darrer-contacte"
                    title={e.darrer_contacte_at ? dataCurta(e.darrer_contacte_at) : undefined}>
                    {contacte
                      ? [t(contacte.clau, { n: contacte.n }),
                        e.darrer_contacte_canal && t(`ni.canal_${e.darrer_contacte_canal}`)].filter(Boolean).join(' · ')
                      : t('el.contacte_mai')}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => navigate(`/equip/entitats/${e.id}`)}>{t('c.detail')}</Button>
                      {/* Con WhatsApp apagado (§8) se quita, no se deshabilita. */}
                      {waActiu && (
                        <Button size="sm" disabled={!tel} title={tel ? undefined : t('el.no_phone')}
                          onClick={() => tel && void assegurarContacte(tel, nom).then(() => navigate(`/equip/missatgeria/${tel}`))}>
                          {t('c.message')}
                        </Button>
                      )}
                      <BotoAmbMotiu variant="outline" size="sm" disabled={!e.email || !!motiuEmail}
                        motiu={motiuEmail ? t(motiuEmail) : e.email ? undefined : t('correu.no_email')}
                        onClick={() => setCorreuA({
                          email: e.email, nom,
                          tipus: e.productor_id ? 'productor' : 'entidad',
                          id: (e.productor_id ?? e.entidad_id) as string,
                        })}>
                        {t('c.email_action')}
                      </BotoAmbMotiu>
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

  const vacio = !loading && !error && test.length === 0 && resto.length === 0

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div>
          <CardTitle>{t('el.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('el.subtitle')}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {/* Sin cuenta (D5): el acceso se da después desde la ficha, «Dona-li accés» (1D). */}
          <Button onClick={() => navigate(`/equip/entitats/nova${fl.valors.rol ? `?rol=${fl.valors.rol}` : ''}`)}>
            <Plus className="size-4" /> {t('el.nova')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Input type="search" placeholder={t('el.search')} value={cerca} onChange={(e) => setCerca(e.target.value)} />
        <BarraFiltres
          id="ent"
          desplegables={[
            { clau: 'rol', etiquetaKey: 'fl.d_rol', opcions: ['ofertant', 'receptor'], text: textDim('rol') },
            ...dims.map((d) => ({
              clau: d.clau, etiquetaKey: d.etiquetaKey,
              opcions: opcionsDisponibles(files, dims, d.clau, fl.valors),
              text: textDim(d.clau),
            })),
          ]}
          valors={fl.valors}
          onValors={fl.setValors}
          mostrant={test.length + resto.length}
          total={files.length}
        />
        {loading && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
        {vacio && <p className="text-sm text-muted-foreground">{files.length === 0 ? t('el.empty') : t('el.no_match')}</p>}
        {test.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('grp.test', { n: test.length })}</h3>
            {tabla(test, true)}
          </section>
        )}
        {resto.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{t('grp.rest', { n: resto.length })}</h3>
            {tabla(resto, false)}
          </section>
        )}
      </CardContent>
      <DialegCorreu obert={correuA !== null} onObert={(v) => { if (!v) setCorreuA(null) }} destinatari={correuA} />
    </Card>
  )
}
