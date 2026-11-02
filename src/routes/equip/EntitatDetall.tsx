// La ficha ÚNICA de una organización para el equipo (plan 1, rebanada 1C, D1): una por
// organización, con el papel o el doble papel visible, pintada desde `campsFitxa.ts` (D8).
// Sustituye a `FitxaRegistre` + `RecordDetail` (una ficha por tabla, formulario plano).
//
//   · `/equip/entitats/:id` — `id` es el de la ORGANIZACIÓN. Si llega el id de una ficha
//     (`productores.id` o `entidades.id`: los enlaces y marcadores de antes de 1C), se
//     resuelve su organización y se redirige con `replace`.
//   · El alta (`/equip/entitats/nova`) ya no vive aquí: es `NovaEntitat` (rebanada 1B), con
//     el buscador previo por NIF y nombre y uno o los dos papeles por `crear_entitat()`.
//
// ESCRITURA. El equipo escribe directo en las tablas (RLS `gestio intern`, §4bis), y SOLO LAS
// COLUMNAS QUE HAN CAMBIADO: así un dato heredado que hoy no pasaría una validación (un NIF
// mal escrito del import) no impide guardar otro campo. Un campo COMÚN (nombre, NIF,
// contacto, dirección…) se enseña una vez y, si cambia, se escribe en las dos fichas del
// doble rol; si hoy difieren, se dice junto al campo (`valorComu()`). `activo` no es un
// campo: se cambia en «Rols» por RPC (deuda §12.147: el alta ya no lo manda).

import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Mail, MessageCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { useAppContext, useCanals, useWhatsappActiu } from '../../hooks/useAppContext'
import { motiuCanal } from '../../lib/canals'
import { assegurarContacte } from '../../lib/contactes'
import { errorCorreu, errorCp, errorNif, errorTelefon } from '../../lib/validacio'
import { activitatsPerPaper, carregaTipusActivitat, type TipusActivitat } from '../../lib/organitzacio'
import {
  CAMPS_FITXA, campsDelBloc, mateixValor, normalitzaValor, potEditar, valorComu, type CampFitxa, type Taula,
} from '../../lib/campsFitxa'
import { useEsborrarFitxa } from '../../hooks/useEsborrarFitxa'
import type { OrganizacioVista } from '../../types'
import BlocCamps from '../../components/fitxa/BlocCamps'
import BlocRols from '../../components/fitxa/BlocRols'
import CanalPreferit, { type TriaCanal } from '../../components/fitxa/CanalPreferit'
import Consentiments from '../../components/fitxa/Consentiments'
import AccesEntitat from '../../components/fitxa/AccesEntitat'
import NotesInternes from '../../components/fitxa/NotesInternes'
import CampsPerfilReceptor from '../../components/CampsPerfilReceptor'
import BadgeConveni from '../../components/BadgeConveni'
import CertificatsFitxa from '../../components/equip/CertificatsFitxa'
import TargetaDiagnostic from '../../components/TargetaDiagnostic'
import EnllacOrganitzacio from '../../components/EnllacOrganitzacio'
import DocumentacioOrganitzacio from '../../components/equip/DocumentacioOrganitzacio'
import LlocsRecollida from '../../components/LlocsRecollida'
import DialegCorreu from '../../components/DialegCorreu'
import BotoAmbMotiu from '../../components/proces/BotoAmbMotiu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Fila = Record<string, unknown>

const LLISTA = '/equip/entitats'
const COLS_ORG = 'id, nombre, nif, email, telefono, poblacion, productor_id, entidad_id, es_generadora, es_receptora, tipo_receptor, canal_preferido, created_at, activa, productor_activo, entidad_activo, razon_social, nom_comercial, persona_contacte, municipio_ine, comarca, tipus_activitat, te_compte, compte_estat'

/** El error de un campo, como clave i18n, o null. */
function errorDe(c: CampFitxa, valor: string): string | null {
  if (c.tipus === 'nif') return errorNif(valor)
  if (c.tipus === 'email') return errorCorreu(valor)
  if (c.tipus === 'tel') return errorTelefon(valor)
  if (c.tipus === 'cp') return errorCp(valor)
  return null
}

/** `/equip/productors/:id` (antes de 1C) → la ficha única, que resuelve el id de ficha. */
export function RedireccioFitxa() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={id ? `${LLISTA}/${id}` : LLISTA} replace />
}

export default function EntitatDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { ctx } = useAppContext()
  const waActiu = useWhatsappActiu()
  const motiuEmail = motiuCanal(useCanals(), 'email')
  const potAprovar = ctx?.potAprovar ?? false
  const potEsborrar = ctx?.esSuperAdmin ?? false

  const [org, setOrg] = useState<OrganizacioVista | null>(null)
  const [prod, setProd] = useState<Fila | null>(null)
  const [ent, setEnt] = useState<Fila | null>(null)
  const [valors, setValors] = useState<Fila>({})
  const [inicial, setInicial] = useState<Fila>({})
  const [discrepancies, setDiscrepancies] = useState<Record<string, { rol: 'ofertant' | 'receptor'; valor: unknown }>>({})
  const [perfil, setPerfil] = useState<Record<string, unknown>>({})
  const [perfilInicial, setPerfilInicial] = useState<Record<string, unknown>>({})
  const [canal, setCanal] = useState<TriaCanal>('auto')
  const [canalDesat, setCanalDesat] = useState<TriaCanal>('auto')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [carregant, setCarregant] = useState(true)
  const [errCarrega, setErrCarrega] = useState(false)
  const [noTrobada, setNoTrobada] = useState(false)
  const [desant, setDesant] = useState(false)
  const [correuObert, setCorreuObert] = useState(false)
  // Sube cuando algo cambia fuera del formulario (estado de un papel, papel nuevo): se recarga.
  const [versio, setVersio] = useState(0)
  const recarrega = () => setVersio((v) => v + 1)
  const [cataleg, setCataleg] = useState<TipusActivitat[]>([])
  useEffect(() => { void carregaTipusActivitat().then(setCataleg) }, [])

  const { esborra, ocupat: esborrant, error: errorEsborrat, dialegs } = useEsborrarFitxa(() => navigate(LLISTA))

  // Qué papeles tiene.
  const rols = useMemo(() => ({ ofertant: prod !== null, receptor: ent !== null }), [prod, ent])
  const taules = useMemo<Taula[]>(() => [
    ...(rols.ofertant ? ['productores' as const] : []),
    ...(rols.receptor ? ['entidades' as const] : []),
  ], [rols])
  // El catálogo de actividades que aplica: con doble rol, la unión; cada ficha guarda las de
  // su papel al desar (`activitatsDe()`).
  const activitats = useMemo(() => {
    const per = new Map<string, TipusActivitat>()
    if (rols.ofertant) for (const a of activitatsPerPaper(cataleg, 'productor')) per.set(a.codi, a)
    if (rols.receptor) for (const a of activitatsPerPaper(cataleg, 'entidad')) per.set(a.codi, a)
    return [...per.values()].sort((a, b) => a.ordre - b.ordre)
  }, [cataleg, rols])
  const activitatsDe = (taula: Taula, triades: string[]) => {
    const valides = new Set(activitatsPerPaper(cataleg, taula === 'productores' ? 'productor' : 'entidad').map((a) => a.codi))
    return triades.filter((c) => valides.has(c))
  }

  useEffect(() => {
    if (!id) return
    let viu = true
    setCarregant(true)
    setErrors({})
    void (async () => {
      const { data: o, error } = await supabase.from('v_organizaciones').select(COLS_ORG).eq('id', id).maybeSingle()
      if (!viu) return
      if (error) { setErrCarrega(true); setCarregant(false); return }
      if (!o) {
        // Un id de FICHA (enlaces de antes de 1C): se resuelve la organización y se redirige.
        for (const taula of ['productores', 'entidades'] as const) {
          const { data: f } = await supabase.from(taula).select('organizacion_id').eq('id', id).maybeSingle()
          if (!viu) return
          const orgId = (f as { organizacion_id: string | null } | null)?.organizacion_id
          if (orgId) { navigate(`${LLISTA}/${orgId}`, { replace: true }); return }
        }
        setNoTrobada(true)
        setCarregant(false)
        return
      }
      const vista = o as OrganizacioVista
      const [p, e] = await Promise.all([
        vista.productor_id ? supabase.from('productores').select('*').eq('id', vista.productor_id).maybeSingle() : Promise.resolve({ data: null }),
        vista.entidad_id ? supabase.from('entidades').select('*').eq('id', vista.entidad_id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      if (!viu) return
      const fp = (p.data as Fila | null) ?? null
      const fe = (e.data as Fila | null) ?? null
      const v: Fila = {}
      const d: Record<string, { rol: 'ofertant' | 'receptor'; valor: unknown }> = {}
      for (const c of CAMPS_FITXA) {
        if (c.tipus === 'xips_activitat') {
          // Unión de las dos fichas: cada una guarda las de su papel.
          const a = (fp?.tipus_activitat as string[] | null) ?? []
          const b = (fe?.tipus_activitat as string[] | null) ?? []
          v[c.clau] = [...new Set([...a, ...b])]
          continue
        }
        const r = valorComu(c, fp, fe)
        v[c.clau] = r.valor
        if (r.altre) d[c.clau] = r.altre
      }
      setOrg(vista)
      setProd(fp)
      setEnt(fe)
      setValors(v)
      setInicial(v)
      setDiscrepancies(d)
      const pr = ((fe?.perfil_receptor as Record<string, unknown> | null) ?? {})
      setPerfil(pr)
      setPerfilInicial(pr)
      const tria = (vista.canal_preferido ?? 'auto') as TriaCanal
      setCanal(tria)
      setCanalDesat(tria)
      setErrCarrega(false)
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [id, versio, navigate])

  function setCamp(clau: string, valor: unknown) {
    setValors((f) => ({ ...f, [clau]: valor }))
    if (errors[clau]) setErrors((e) => { const n = { ...e }; delete n[clau]; return n })
  }

  const telefon = String(valors.telefon ?? '').replace(/\D/g, '')
  const correu = String(valors.email ?? '').trim()
  const nom = String(valors.nom_comercial || valors.persona_contacte || org?.nombre || '')

  /** Lo que se escribe en una tabla: solo lo que ha cambiado (y solo lo que el equipo edita). */
  function canvisDe(taula: Taula): Fila {
    const out: Fila = {}
    for (const c of CAMPS_FITXA) {
      const col = c.columnes[taula]
      if (!col || !potEditar(c, 'equip')) continue
      let nou = normalitzaValor(c, valors[c.clau])
      const abans = normalitzaValor(c, inicial[c.clau])
      if (c.tipus === 'xips_activitat') nou = activitatsDe(taula, nou as string[])
      if (mateixValor(nou, abans)) continue
      // `productores.name` es `not null`: vacío no se escribe (la RPC del actor hace lo mismo).
      if (taula === 'productores' && col === 'name' && nou == null) continue
      out[col] = nou
    }
    if (taula === 'entidades' && JSON.stringify(perfil) !== JSON.stringify(perfilInicial)) out.perfil_receptor = perfil
    return out
  }

  async function desa() {
    // Lo mal escrito, campo por campo, antes de llamar a nadie.
    const nous: Record<string, string> = {}
    for (const c of CAMPS_FITXA) {
      if (!taules.some((tb) => c.columnes[tb]) || !potEditar(c, 'equip')) continue
      // Solo lo que ha cambiado: un dato heredado que hoy no pasaría (un NIF del import con la
      // letra mal) no puede impedir guardar otro campo. Si se toca, sí se valida.
      if (mateixValor(normalitzaValor(c, valors[c.clau]), normalitzaValor(c, inicial[c.clau]))) continue
      const e = errorDe(c, String(valors[c.clau] ?? ''))
      if (e) nous[c.clau] = e
    }
    if (!String(valors.nom_comercial ?? '').trim()) nous.nom_comercial = 'ef.nom_obligatori'
    setErrors(nous)
    if (Object.keys(nous).length > 0) {
      toast.error(t('org.fix_errors'))
      document.getElementById(`ed-${Object.keys(nous)[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setDesant(true)
    let canvis = 0
    for (const taula of taules) {
      const dades = canvisDe(taula)
      if (Object.keys(dades).length === 0) continue
      const fid = taula === 'productores' ? org?.productor_id : org?.entidad_id
      // `.select('id')`: un UPDATE que la RLS no deja pasar no da error, devuelve cero filas.
      const { data, error } = await supabase.from(taula).update(dades).eq('id', fid as string).select('id')
      if (error) { setDesant(false); toast.error(error.code === '23505' ? t('rec.err_unique') : textError(t, error.message)); return }
      if (!data || data.length === 0) { setDesant(false); toast.error(t('c.error')); return }
      canvis += 1
    }
    if (canal !== canalDesat && org) {
      const { error } = await supabase.rpc('actualizar_meu_canal', {
        p_tipo: org.productor_id ? 'productor' : 'entidad',
        p_ficha: org.productor_id ?? org.entidad_id,
        p_canal: canal === 'auto' ? null : canal,
      })
      if (error) { setDesant(false); toast.error(textError(t, error.message)); return }
      canvis += 1
    }
    setDesant(false)
    if (canvis === 0) { toast.info(t('ef.cap_canvi')); return }
    toast.success(t('rec.saved'))
    recarrega()
  }

  function enviaMissatge() {
    if (!telefon) return
    void assegurarContacte(telefon, nom || null).then(() => navigate(`/equip/missatgeria/${telefon}`))
  }

  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  if (errCarrega || noTrobada || !org) {
    return <p className="text-sm text-destructive">{t(errCarrega ? 'c.load_error' : 'rec.not_found')}</p>
  }

  const camps = (bloc: Parameters<typeof campsDelBloc>[0]) => campsDelBloc(bloc, 'equip', rols)
  const blocProps = { valors, onChange: setCamp, veu: 'equip' as const, potEditar: true, errors, idPrefix: 'ed', discrepancies }
  const tipusReceptor = (valors.tipo_receptor as string | null) ?? null
  const Seccio = ({ titol, ajuda, children, testid }: { titol: string; ajuda?: string; children: React.ReactNode; testid?: string }) => (
    <section className="space-y-3 border-t border-border pt-6 first:border-t-0 first:pt-0" data-testid={testid}>
      <div>
        <h3 className="text-base font-semibold">{titol}</h3>
        {ajuda && <p className="mt-1 text-sm text-muted-foreground">{ajuda}</p>}
      </div>
      {children}
    </section>
  )

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(LLISTA)} className="text-muted-foreground">
        <ArrowLeft className="size-4" /> {t('ef.tornar')}
      </Button>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span>{nom || '—'}</span>
              {org?.es_generadora && (
                <Badge className={org.productor_activo ? 'bg-exito-fondo text-exito' : 'bg-muted text-muted-foreground'}>
                  {t('ef.paper_ofertant')}{org.productor_activo ? '' : ` · ${t('ef.estat_inactiva').toLowerCase()}`}
                </Badge>
              )}
              {org?.es_receptora && (
                <Badge className={org.entidad_activo ? 'bg-exito-fondo text-exito' : 'bg-muted text-muted-foreground'}>
                  {t('ef.paper_receptor')}{org.entidad_activo ? '' : ` · ${t('ef.estat_inactiva').toLowerCase()}`}
                </Badge>
              )}
              {Boolean(valors.es_test) && <Badge variant="secondary">{t('badge.test')}</Badge>}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {[org?.razon_social, org?.nif].filter(Boolean).join(' · ') || t('rec.editing', { x: t('ef.tornar').toLowerCase() })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Con WhatsApp apagado (§8) desaparece; el correo ocupa su sitio. */}
            {waActiu && telefon && (
              <Button variant="outline" onClick={enviaMissatge}><MessageCircle className="size-4" /> {t('c.message')}</Button>
            )}
            {correu && (
              <BotoAmbMotiu variant="outline" onClick={() => setCorreuObert(true)} disabled={!!motiuEmail}
                motiu={motiuEmail ? t(motiuEmail) : undefined}>
                <Mail className="size-4" /> {t('c.email_action')}
              </BotoAmbMotiu>
            )}
            <Button onClick={() => void desa()} disabled={desant}>{desant ? t('c.saving') : t('c.save')}</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Seccio titol={t('org.sec_identitat')} testid="bloc-identitat">
            <BlocCamps {...blocProps} camps={camps('identitat')} activitats={activitats}
              placeholderNom={String(valors.persona_contacte ?? '') || undefined} />
          </Seccio>

          {org && (
            <Seccio titol={t('org.sec_rol')} testid="bloc-rols">
              <BlocRols org={org} potAprovar={potAprovar} onCanviat={recarrega} />
            </Seccio>
          )}

          <Seccio titol={t('ef.sec_contacte')} ajuda={t('ef.h_contacte')} testid="bloc-contacte">
            <BlocCamps {...blocProps} camps={camps('contacte')} />
            {org && (
              <>
                <AccesEntitat orgId={org.id} correu={correu}
                  correuCanviat={correu.toLowerCase() !== String(inicial.email ?? '').trim().toLowerCase()}
                  entitatActiva={Boolean(org.activa)} potAprovar={potAprovar} motiuCorreu={motiuEmail}
                  onCanviat={recarrega} />
                <CanalPreferit canal={canal} onChange={setCanal} potEditar telefon={telefon} correu={correu} id="ed-canal" />
              </>
            )}
          </Seccio>

          <Seccio titol={t('org.sec_adreca')} testid="bloc-adreca">
            <BlocCamps {...blocProps} camps={camps('adreca')} />
          </Seccio>

          {rols.ofertant && (
            <Seccio titol={t('ef.sec_ofertant')} testid="bloc-ofertant">
              <BlocCamps {...blocProps} camps={camps('ofertant')} />
              {org?.productor_id && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('org.sec_llocs')}</p>
                  <p className="text-sm text-muted-foreground">{t('rec.h_llocs')}</p>
                  <LlocsRecollida productorId={org.productor_id} idPrefix="fitxa-lloc" />
                </div>
              )}
            </Seccio>
          )}

          {rols.receptor && (
            <Seccio titol={t('ef.sec_receptor')} testid="bloc-receptor">
              <BlocCamps {...blocProps} camps={camps('receptor')} />
              {/* Los campos propios del tipo de receptor (`perfil_receptor`): dependen del
                  tipo que haya ahora en el formulario; los del tipo anterior se quedan en el
                  objeto, sin pintarse. */}
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">{t('f.perfil_receptor')}</p>
                {tipusReceptor
                  ? <CampsPerfilReceptor tipusReceptor={tipusReceptor} idPrefix="ed-pr" perfil={perfil} onChange={setPerfil} />
                  : <p className="text-sm text-muted-foreground">{t('f.perfil_sense_tipus')}</p>}
              </div>
            </Seccio>
          )}

          {org?.productor_id && (
            <Seccio titol={t('ef.sec_diagnostic')} testid="bloc-diagnostic">
              <TargetaDiagnostic tipusOrg="productor" orgId={org.productor_id} mode="equip" />
            </Seccio>
          )}

          {org && (
            <Seccio titol={t('ef.sec_documentacio')} testid="bloc-documentacio">
              {org.productor_id && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">{t('ef.conveni_ofertant')}</p>
                  <BadgeConveni tipusOrg="productor" orgId={org.productor_id} conveniPaper={(prod?.conveni as string | null) ?? null} />
                  <CertificatsFitxa tipus="productor" orgId={org.productor_id} esTest={Boolean(prod?.es_test)} />
                </div>
              )}
              {org.entidad_id && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">{t('ef.conveni_receptor')}</p>
                  <BadgeConveni tipusOrg="entidad" orgId={org.entidad_id} conveniPaper={(ent?.estat as string | null) ?? null} />
                  <CertificatsFitxa tipus="entidad" orgId={org.entidad_id} esTest={Boolean(ent?.es_test)} />
                </div>
              )}
            </Seccio>
          )}

          <Seccio titol={t('ef.sec_intern')} ajuda={t('ef.h_intern')} testid="bloc-intern">
            <BlocCamps {...blocProps} camps={camps('intern')} />
            {org && (
              <>
                <Consentiments organitzacioId={org.id} />
                {/* El CRM mínimo (1F, D4): el hilo de contactos del equipo con la entidad. */}
                <NotesInternes orgId={org.id} potEsborrar={potEsborrar} />
                {/* Con quién comparte organización, que es donde se deshace un enlace equivocado. */}
                <EnllacOrganitzacio tipus={org.productor_id ? 'productor' : 'entidad'}
                  fitxa={org.productor_id ?? org.entidad_id} potAprovar={potAprovar} onCanviat={recarrega} />
                <div className="border-t pt-4">
                  {errorEsborrat && <p className="mb-2 text-sm text-destructive">{errorEsborrat}</p>}
                  <BotoAmbMotiu variant="destructive" disabled={esborrant || !potEsborrar}
                    motiu={potEsborrar ? undefined : t('rec.no_permission_delete')}
                    onClick={() => void esborra({ productorId: org.productor_id, entidadId: org.entidad_id, nom })}>
                    <Trash2 className="size-4" /> {t('ef.esborra')}
                  </BotoAmbMotiu>
                </div>
              </>
            )}
          </Seccio>
        </CardContent>
      </Card>

      {/* El archivo documental de cada papel (convenios en papel, certificados anteriores):
          con doble rol son dos tarjetas, y el rótulo dice de qué papel es cada una. */}
      {org?.productor_id && (
        <div className="space-y-2" data-testid="doc-productor">
          {org.entidad_id && <p className="text-sm font-medium">{t('ef.sec_ofertant')}</p>}
          <DocumentacioOrganitzacio tipusOrg="productor" orgId={org.productor_id} nom={nom} />
        </div>
      )}
      {org?.entidad_id && (
        <div className="space-y-2" data-testid="doc-entidad">
          {org.productor_id && <p className="text-sm font-medium">{t('ef.sec_receptor')}</p>}
          <DocumentacioOrganitzacio tipusOrg="entidad" orgId={org.entidad_id} nom={nom} />
        </div>
      )}

      {org && (
        <DialegCorreu obert={correuObert} onObert={setCorreuObert}
          destinatari={{
            email: correu || null, nom: nom || null,
            tipus: org.productor_id ? 'productor' : 'entidad',
            id: (org.productor_id ?? org.entidad_id) as string,
          }} />
      )}
      {dialegs}
    </div>
  )
}
