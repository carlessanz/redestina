// Ficha de la propia organización, para productor y receptor («La meva organització»).
//
// DESDE 1C (plan 1, 02-11-2026, D8) los campos salen de `campsFitxa.ts`, la MISMA definición
// que usa la ficha del equipo (`EntitatDetall`): el mismo campo, con la misma etiqueta, en
// las dos pantallas. Es lo que cierra la subtarea 1.6 (las dos fichas se habían separado).
// Aquí se pintan los bloques que el actor ve (`veu: 'tots'`) para el papel de esta pestaña
// —una pestaña por papel, `LaMevaOrganitzacio`— y edita lo que su RPC admite
// (`edita: 'tots'`; `tests/campsFitxa.test.ts` comprueba que la lista blanca coincide).
//
// No escribe directo en la tabla porque un usuario externo no tiene permiso de UPDATE sobre
// `productores`/`entidades`: escribe por `actualitzar_fitxa_productor` /
// `actualitzar_fitxa_entitat` (jsonb con lista blanca, §4bis), y solo el titular.
//
// ⚠️ EL TIPO LLEGA POR PROP, NO SE DEDUCE, y la pestaña lleva `key`: con doble rol React
// reutilizaría la instancia y conservaría el estado de la otra ficha (ver `LaMevaOrganitzacio`).
//
// PESTAÑAS (04-11-2026, como la ficha del equipo y la Taula mestra 1.3): Dades de l'entitat
// (identidad, dirección y rol) · Contacte (persona, teléfonos, canal preferido) · Operativa (lo
// del papel: explotación y lugares de recogida, o la recepción). Todas montadas y ocultas las que
// no tocan, así que «Desar» guarda lo de todas; un error salta a su pestaña; la activa va en
// `?pestanya=`.
//
// El canal preferido vive en `organizaciones` (`CanalPreferit`, RPC `actualizar_meu_canal`).
// Las preferencias de recepción (modalidades, perfil del tipo) se editan en «El meu perfil
// de recepció» (`PerfilRecepcio`): aquí solo el puntero, para que no haya dos formularios
// del mismo dato.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { refrescaAvisos } from '../lib/refrescAvisos'
import { useOrganitzacio } from '../hooks/useAppContext'
import { errorCorreu, errorCp, errorNif, errorTelefon } from '../lib/validacio'
import { activitatsPerPaper, carregaTipusActivitat, type TipusActivitat } from '../lib/organitzacio'
import { carregaMunicipis } from '../lib/municipis'
import {
  campsDeTaula, normalitzaValor, potEditar as potEditarCamp, type Bloc, type CampFitxa, type Taula,
} from '../lib/campsFitxa'
import BlocCamps from '../components/fitxa/BlocCamps'
import CanalPreferit, { type TriaCanal } from '../components/fitxa/CanalPreferit'
import LlocsRecollida from '../components/LlocsRecollida'
import RolRedestina from '../components/RolRedestina'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Fila = Record<string, unknown>

const PESTANYES = ['dades', 'contacte', 'operativa'] as const
type Pestanya = typeof PESTANYES[number]
const ETIQUETA_PESTANYA: Record<Pestanya, string> = {
  dades: 'ef.tab_dades', contacte: 'org.tab_contacte', operativa: 'ef.tab_operativa',
}

/** Los bloques que ve el actor, con su título y su pestaña. */
const BLOCS_ACTOR: { bloc: Bloc; titolKey: string; pestanya: Pestanya }[] = [
  { bloc: 'identitat', titolKey: 'org.sec_identitat', pestanya: 'dades' },
  { bloc: 'adreca', titolKey: 'org.sec_adreca', pestanya: 'dades' },
  { bloc: 'fiscal', titolKey: 'org.sec_fiscal', pestanya: 'dades' },
  { bloc: 'contacte', titolKey: 'org.sec_contacte', pestanya: 'contacte' },
  { bloc: 'ofertant', titolKey: 'ef.sec_ofertant', pestanya: 'operativa' },
  { bloc: 'receptor', titolKey: 'ef.sec_receptor', pestanya: 'operativa' },
]
const PESTANYA_DE_BLOC = new Map<Bloc, Pestanya>(BLOCS_ACTOR.map((b) => [b.bloc, b.pestanya]))

/** Una sección de una pestaña, con la raya de separación salvo la primera. */
function Seccio({ titol, ajuda, children, testid }: { titol?: string; ajuda?: string; children: ReactNode; testid?: string }) {
  return (
    <section className="space-y-3 border-t border-border pt-6 first:border-t-0 first:pt-0" data-testid={testid}>
      {titol && (
        <div>
          <h3 className="text-base font-semibold">{titol}</h3>
          {ajuda && <p className="mt-1 text-sm text-muted-foreground">{ajuda}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

/** Lo que se edita en «El meu perfil de recepció», no aquí. */
const A_PERFIL_RECEPCIO = new Set(['modalitats_interes'])

/** El error de un campo, como clave i18n, o null. */
function errorDe(c: CampFitxa, valor: string): string | null {
  if (c.tipus === 'nif') return errorNif(valor)
  if (c.tipus === 'email') return errorCorreu(valor)
  if (c.tipus === 'tel') return errorTelefon(valor)
  if (c.tipus === 'cp') return errorCp(valor)
  return null
}

export default function PerfilOrganitzacio({ tipus }: { tipus: 'productor' | 'entidad' }) {
  const { t } = useT()
  const organitzacio = useOrganitzacio(tipus)
  const [fila, setFila] = useState<Fila | null>(null)
  const [valors, setValors] = useState<Fila>({})
  const [canal, setCanal] = useState<TriaCanal>('auto')
  const [canalDesat, setCanalDesat] = useState<TriaCanal>('auto')
  const [carregant, setCarregant] = useState(true)
  const [desant, setDesant] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  /** La ficha no se pudo leer: sin esto salía el formulario vacío, como si no hubiera datos. */
  const [errorCarrega, setErrorCarrega] = useState(false)

  const tabla: Taula = tipus === 'productor' ? 'productores' : 'entidades'
  const potEditar = organitzacio?.rol_org === 'titular'
  const camps = useMemo(() => campsDeTaula(tabla, 'tots').filter((c) => !A_PERFIL_RECEPCIO.has(c.clau)), [tabla])
  const telefon = String(valors.telefon ?? '').trim()
  const correu = String(valors.email ?? '').trim()
  const tipusReceptor = tipus === 'entidad' ? String(valors.tipo_receptor ?? '') : ''

  // La pestaña activa, en la URL (como en la ficha del equipo).
  const [params, setParams] = useSearchParams()
  const enUrl = params.get('pestanya')
  const pestanya: Pestanya = (PESTANYES as readonly string[]).includes(enUrl ?? '') ? enUrl as Pestanya : 'dades'
  function triaPestanya(p: Pestanya) {
    setParams((prev) => {
      const n = new URLSearchParams(prev)
      if (p === 'dades') n.delete('pestanya'); else n.set('pestanya', p)
      return n
    }, { replace: true })
  }

  // El catálogo de actividades (fase 7): solo las que aplican a este papel.
  const [activitats, setActivitats] = useState<TipusActivitat[]>([])
  useEffect(() => { void carregaTipusActivitat().then((c) => setActivitats(activitatsPerPaper(c, tipus))) }, [tipus])

  // ⚠️ La dependencia del efecto es el **id**, no el objeto: `useOrganitzacio()` saca ese
  // objeto de `ctx.organitzacions`, que `useAppContext` rehace ENTERO cada vez que recarga;
  // con el objeto como dependencia lo tecleado desaparecía sin decir nada.
  const idOrganitzacio = organitzacio?.id ?? null

  useEffect(() => {
    // Volver a «cargando» y soltar la fila anterior es lo que impide enseñar —y guardar—
    // los datos de una organización con los campos de la otra.
    setCarregant(true)
    setFila(null)
    setValors({})
    setErrors({})
    setCanal('auto')
    setCanalDesat('auto')
    if (!idOrganitzacio) { setCarregant(false); return }
    let viu = true
    void (async () => {
      const { data, error } = await supabase.from(tabla).select('*').eq('id', idOrganitzacio).maybeSingle()
      if (!viu) return
      setErrorCarrega(Boolean(error))
      const f = (data as Fila) ?? null
      setFila(f)
      if (f) {
        const v: Fila = {}
        for (const c of campsDeTaula(tabla, 'tots')) v[c.clau] = f[c.columnes[tabla] as string]
        setValors(v)
      }
      // La preferencia vive en la organización, no en la ficha (§4).
      const orgId = (f?.organizacion_id as string | null) ?? null
      if (orgId) {
        const { data: org } = await supabase.from('organizaciones').select('id, canal_preferido').eq('id', orgId).maybeSingle()
        if (!viu) return
        const tria = ((org as { canal_preferido: TriaCanal | null } | null)?.canal_preferido ?? 'auto') as TriaCanal
        setCanal(tria)
        setCanalDesat(tria)
      }
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [idOrganitzacio, tabla])

  // Del código postal sale el municipio cuando no hay duda: si el CP apunta a UNO solo
  // (`codis_postals`), se elige sin preguntar; si apunta a varios, se elige de la lista.
  const cp = String(valors.codigo_postal ?? '')
  const teMunicipi = Boolean(valors.municipio_ine)
  useEffect(() => {
    if (!potEditar || teMunicipi || !/^\d{5}$/.test(cp)) return
    let viu = true
    void supabase.from('codis_postals').select('codi_ine').eq('codi_postal', cp).then(({ data }) => {
      const files = (data ?? []) as { codi_ine: string }[]
      if (!viu || files.length !== 1) return
      const codi = files[0].codi_ine
      // Y su comarca en «Àrea geogràfica», como al elegirla en el selector.
      void carregaMunicipis().then((ms) => {
        const comarca = ms.find((m) => m.codi_ine === codi)?.comarca
        if (viu) setValors((f) => ({ ...f, municipio_ine: codi, ...(comarca ? { area_geografica: comarca } : {}) }))
      })
    })
    return () => { viu = false }
  }, [cp, teMunicipi, potEditar])

  function setCamp(clau: string, valor: unknown) {
    setValors((f) => ({ ...f, [clau]: valor }))
    if (errors[clau]) setErrors((e) => { const n = { ...e }; delete n[clau]; return n })
  }

  async function desa() {
    if (!organitzacio || !fila) return
    // Antes de llamar a nadie: lo que está mal escrito, dicho campo por campo.
    const nous: Record<string, string> = {}
    for (const c of camps) {
      if (!potEditarCamp(c, 'tots')) continue
      const e = errorDe(c, String(valors[c.clau] ?? ''))
      if (e) nous[c.clau] = e
    }
    // La raó social es el nombre legal que imprimen convenios, albaranes y certificados
    // (revisión del 08-10-2026, §5.1): obligatoria, en rojo si falta.
    if (!String(valors.razon_social ?? '').trim()) nous.razon_social = 'org.err_rao_social'
    setErrors(nous)
    if (Object.keys(nous).length > 0) {
      toast.error(t('org.fix_errors'))
      // El primer error puede estar en otra pestaña: se salta a ella y, ya visible, se enseña.
      const primer = Object.keys(nous)[0]
      const bloc = camps.find((c) => c.clau === primer)?.bloc
      triaPestanya((bloc && PESTANYA_DE_BLOC.get(bloc)) ?? 'dades')
      let intents = 0
      const enfoca = () => {
        const el = document.getElementById(`po-${tipus}-${primer}`)
        if (el && el.offsetParent === null && intents++ < 30) { requestAnimationFrame(enfoca); return }
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el?.focus({ preventScroll: true })
      }
      requestAnimationFrame(enfoca)
      return
    }

    setDesant(true)
    // El payload va por COLUMNA de la tabla: las claves que acepta la RPC.
    const dades: Record<string, unknown> = {}
    for (const c of camps) {
      if (!potEditarCamp(c, 'tots')) continue
      dades[c.columnes[tabla] as string] = normalitzaValor(c, valors[c.clau])
    }
    const { data, error } = await supabase.rpc(
      tipus === 'productor' ? 'actualitzar_fitxa_productor' : 'actualitzar_fitxa_entitat',
      { p_id: organitzacio.id, p_dades: dades },
    )
    // El motivo de la RPC (un valor fuera de lista) y no un «Hi ha hagut un error».
    if (error) { setDesant(false); toast.error(textError(t, error.message)); return }
    // Lo que devuelve la base ya trae población y área derivadas del municipio.
    if (data) {
      const f = data as Fila
      setFila(f)
      const v: Fila = {}
      for (const c of campsDeTaula(tabla, 'tots')) v[c.clau] = f[c.columnes[tabla] as string]
      setValors(v)
    }

    // Dos escrituras porque son dos tablas y dos listas blancas; la del canal solo si ha
    // cambiado, para no tocar `organizaciones` en cada «Desar».
    if (canal !== canalDesat) {
      const { data: o, error: errCanal } = await supabase.rpc('actualizar_meu_canal', {
        p_tipo: tipus, p_ficha: organitzacio.id, p_canal: canal === 'auto' ? null : canal,
      })
      if (errCanal) { setDesant(false); toast.error(textError(t, errCanal.message)); return }
      const org = o as { canal_preferido: TriaCanal | null } | null
      setCanalDesat((org?.canal_preferido ?? 'auto') as TriaCanal)
    }

    setDesant(false)
    toast.success(t('rec.saved'))
    // La banda de «ficha incompleta» y su marca en el menú viven en AppShell.
    refrescaAvisos()
  }

  if (!organitzacio) return <p className="text-sm text-muted-foreground">{t('po.no_org')}</p>
  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  if (errorCarrega || !fila) return <p className="text-sm text-destructive">{t('org.err_load')}</p>

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>
            {organitzacio.nombre ?? t(tipus === 'productor' ? 'nav.my_producer_org' : 'nav.my_entity')}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {potEditar ? t('perf.subtitle') : t('perf.read_only')}
          </p>
        </div>
        {potEditar && (
          <Button onClick={() => void desa()} disabled={desant} className="min-h-11 whitespace-normal">
            {desant ? t('c.saving') : t('c.save')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Tabs value={pestanya} onValueChange={(v) => triaPestanya(v as Pestanya)}>
          <div className="min-w-0 overflow-x-auto pb-1">
            <TabsList variant="line" className="w-max">
              {PESTANYES.map((p) => <TabsTrigger key={p} value={p}>{t(ETIQUETA_PESTANYA[p])}</TabsTrigger>)}
            </TabsList>
          </div>
          {PESTANYES.map((p) => (
            // Montadas todas: lo escrito en una pestaña sigue ahí al volver, y «Desar» lo guarda.
            <TabsContent key={p} value={p} forceMount className="space-y-6 pt-4 data-[state=inactive]:hidden">
              {BLOCS_ACTOR.filter((b) => b.pestanya === p).map((b) => {
                const del = camps.filter((c) => c.bloc === b.bloc)
                if (del.length === 0) return null
                return (
                  <Seccio key={b.bloc} titol={t(b.titolKey)} testid={`po-${tipus}-${b.bloc}`}>
                    <BlocCamps camps={del} valors={valors} onChange={setCamp} veu="tots" potEditar={potEditar}
                      errors={errors} idPrefix={`po-${tipus}`} activitats={activitats}
                      // Hay fichas con el nombre de la organización en `name` y `empresa` vacío: se
                      // sugiere, sin escribirlo, para que no parezca que no hay.
                      placeholderNom={String(valors.persona_contacte ?? '') || undefined} />
                    {/* El tipo de receptor decide qué ofertas ve: lo fija el equipo, y se dice. */}
                    {b.bloc === 'identitat' && tipus === 'entidad' && (
                      <p className="text-sm text-muted-foreground">
                        {t('org.tipus_receptor', { x: tipusReceptor ? t(`org.tr_${tipusReceptor}`) : '—' })}
                      </p>
                    )}
                  </Seccio>
                )
              })}

              {p === 'dades' && (
                <Seccio titol={t('org.sec_rol')} ajuda={t('org.h_rol')}>
                  <RolRedestina tipus={tipus} fitxaId={organitzacio.id} potEditar={potEditar} />
                </Seccio>
              )}

              {p === 'contacte' && (
                <Seccio>
                  <CanalPreferit canal={canal} onChange={setCanal} potEditar={potEditar} telefon={telefon} correu={correu} />
                </Seccio>
              )}

              {p === 'operativa' && tipus === 'productor' && (
                <Seccio titol={t('org.sec_llocs')} ajuda={t('org.h_llocs')}>
                  <LlocsRecollida productorId={organitzacio.id} potEditar={potEditar} idPrefix="org-lloc" />
                </Seccio>
              )}

              {/* Las preferencias de recepción y las condiciones del tipo se editan en «El meu
                  perfil de recepció»: aquí solo el puntero, para que no haya dos formularios. */}
              {p === 'operativa' && tipus === 'entidad' && (
                <Seccio>
                  <p className="text-sm text-muted-foreground">
                    {t('precep.a_la_fitxa')}{' '}
                    <Link to="/organitzacio/perfil-recepcio" className="font-medium text-primary underline-offset-4 hover:underline">
                      {t('precep.card_go')}
                    </Link>
                  </p>
                </Seccio>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}
