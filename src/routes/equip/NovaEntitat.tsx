// «Nova entitat» en dos pasos (plan 1, rebanada 1B, D6). Ruta `/equip/entitats/nova[?rol=…]`;
// sustituye al alta de un papel que 1C dejó dentro de `EntitatDetall` (y a la de antes,
// `/equip/productors/nou`, que redirige aquí).
//
//   1. «Qui és?» — un campo «NIF o nom» que busca mientras se escribe (`cerca_entitats`, a
//      partir de 3 caracteres y con 250 ms de espera). Al elegir un resultado:
//        · inactiva (o con un papel inactivo) → «Activa-la»: pide NIF y razón social si
//          faltan y llama a `activar_fitxa` por cada papel elegido (el trigger de 1A exige
//          los dos datos: «Cal el NIF per activar-la»);
//        · activa → «Aquesta entitat ja és activa» y «Obre la fitxa»;
//        · sin el otro papel → «Afegeix el paper de…» (`afegir_paper_org_equip`).
//      Debajo, siempre, «És nova: dona-la d'alta», que lleva al paso 2 con el NIF (o el
//      nombre) ya puesto.
//   2. «Dades de l'entitat» — los campos del alta (`CLAUS_ALTA` de `campsFitxa`, pintados con
//      los mismos `BlocCamps` que la ficha) y uno o los dos papeles. `crear_entitat()` crea la
//      organización y sus fichas en UNA transacción (P2) y devuelve la organización, cuya
//      ficha se abre. Nace activa: NIF válido y razón social obligatorios.
//
// Activar y añadir un papel son de `pot_aprovar()` (1A): a un técnico se le enseñan grises con
// el motivo. Dar de alta, como antes de 1B, lo puede cualquiera del equipo. La casilla «Dona-li
// accés a la plataforma ara» (1D) solo la ve quien puede aprobar: tras el alta llama a
// `donar-acces` con el correo del contacto; si falla, el alta queda hecha y se dice.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { cn } from '../../lib/utils'
import { errorNif } from '../../lib/validacio'
import { useAppContext, useCanals } from '../../hooks/useAppContext'
import { motiuCanal } from '../../lib/canals'
import { donarAcces } from '../../lib/acces'
import { clauErrorAcces } from '../../lib/accesEntitat'
import { activitatsPerPaper, carregaTipusActivitat, type TipusActivitat } from '../../lib/organitzacio'
import { campsAlta } from '../../lib/campsFitxa'
import {
  DEBOUNCE_MS, accionsResultat, campDelError, dadesAlta, errorsAlta, potCercar, prellenaAlta,
  type Paper, type ResultatCerca, type ValorsAlta,
} from '../../lib/novaEntitat'
import BlocCamps from '../../components/fitxa/BlocCamps'
import BotoAmbMotiu from '../../components/proces/BotoAmbMotiu'
import { FilaCasella } from '../../components/Casella'
import { useConfirma } from '../../components/DialegConfirma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const LLISTA = '/equip/entitats'
const rolKey = (p: Paper) => (p === 'productor' ? 'ef.paper_ofertant' : 'ef.paper_receptor')
const nomDe = (r: ResultatCerca) => r.nom_comercial || r.razon_social || r.persona_contacte || '—'

type EstatCerca = 'buit' | 'cercant' | 'ok' | 'error'

export default function NovaEntitat() {
  const { t } = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const potAprovar = useAppContext().ctx?.potAprovar ?? false
  const motiuAprovar = potAprovar ? undefined : t('appr.need_approver')
  const { confirma, dialeg: dialegConfirma } = useConfirma()

  const [pas, setPas] = useState<1 | 2>(1)

  // ------------------------------------------------------------------ paso 1
  const [q, setQ] = useState('')
  const [resultats, setResultats] = useState<ResultatCerca[]>([])
  const [estatCerca, setEstatCerca] = useState<EstatCerca>('buit')
  const [actiu, setActiu] = useState(-1)
  const [triat, setTriat] = useState<ResultatCerca | null>(null)
  const [ocupat, setOcupat] = useState(false)
  const [activarObert, setActivarObert] = useState(false)
  const triadaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pas !== 1) return
    if (!potCercar(q)) { setResultats([]); setEstatCerca('buit'); setActiu(-1); return }
    let viu = true
    setEstatCerca('cercant')
    const h = setTimeout(() => {
      void supabase.rpc('cerca_entitats', { p_q: q, p_limit: 10 }).then(({ data, error }) => {
        if (!viu) return
        if (error) { setResultats([]); setEstatCerca('error'); return }
        setResultats((data ?? []) as ResultatCerca[])
        setEstatCerca('ok')
        setActiu(-1)
      })
    }, DEBOUNCE_MS)
    return () => { viu = false; clearTimeout(h) }
  }, [q, pas])

  function tria(r: ResultatCerca) {
    setTriat(r)
    // En móvil la tarjeta queda debajo de la lista: se lleva a la vista.
    setTimeout(() => triadaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0)
  }

  function teclaCerca(e: React.KeyboardEvent<HTMLInputElement>) {
    if (resultats.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiu((i) => Math.min(i + 1, resultats.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiu((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && actiu >= 0) { e.preventDefault(); tria(resultats[actiu]) }
  }

  const accions = triat ? accionsResultat(triat) : null
  const obreFitxa = (org: string) => navigate(`${LLISTA}/${org}`)

  async function afegeix(paper: Paper) {
    if (!triat) return
    if (!(await confirma({
      titol: t('ef.confirm_afegeix_t', { rol: t(rolKey(paper)).toLowerCase() }),
      descripcio: t('ef.confirm_afegeix_d'),
      confirmar: t(paper === 'productor' ? 'ef.afegeix_ofertant' : 'ef.afegeix_receptor'),
    }))) return
    setOcupat(true)
    const { error } = await supabase.rpc('afegir_paper_org_equip', { p_org: triat.organizacion_id, p_paper: paper })
    setOcupat(false)
    if (error) { toast.error(textError(t, error.message)); return }
    toast.success(t('ef.paper_afegit'))
    obreFitxa(triat.organizacion_id)
  }

  function esNova() {
    setValors((v) => ({ ...v, ...prellenaAlta(q) }))
    setErrors({})
    setPas(2)
  }

  // ------------------------------------------------------------------ paso 2
  const rolUrl = params.get('rol')
  const [papers, setPapers] = useState<Paper[]>(
    rolUrl === 'receptor' ? ['entidad'] : rolUrl === 'ofertant' ? ['productor'] : [],
  )
  const [valors, setValors] = useState<ValorsAlta>({})
  const [esTest, setEsTest] = useState(false)
  // «Dona-li accés a la plataforma ara» (1D): apagada por defecto (D5: el alta es sin acceso).
  const [ambAcces, setAmbAcces] = useState(false)
  const motiuCorreu = motiuCanal(useCanals(), 'email')
  const correuAlta = String(valors.email ?? '').trim()
  const motiuAcces = motiuCorreu ?? (correuAlta ? null : 'acc.m_sense_correu')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [desant, setDesant] = useState(false)
  const [cataleg, setCataleg] = useState<TipusActivitat[]>([])
  useEffect(() => { void carregaTipusActivitat().then(setCataleg) }, [])

  // Los campos comunes se enseñan siempre; los del receptor, si lo es.
  const rols = { ofertant: true, receptor: papers.includes('entidad') }
  // Las actividades de los papeles elegidos (sin ninguno, las de los dos): la RPC reparte
  // cada una a su ficha.
  const activitats = useMemo(() => {
    const per = new Map<string, TipusActivitat>()
    const quins: Paper[] = papers.length ? papers : ['productor', 'entidad']
    for (const p of quins) for (const a of activitatsPerPaper(cataleg, p)) per.set(a.codi, a)
    return [...per.values()].sort((a, b) => a.ordre - b.ordre)
  }, [cataleg, papers])

  function setCamp(clau: string, valor: unknown) {
    setValors((v) => ({ ...v, [clau]: valor }))
    if (errors[clau]) setErrors((e) => { const n = { ...e }; delete n[clau]; return n })
  }

  function commutaPaper(p: Paper) {
    setPapers((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p].sort()))
  }

  function marcaErrors(e: Record<string, string>) {
    setErrors(e)
    const primer = Object.keys(e)[0]
    if (primer) document.getElementById(`ne-${primer}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function crea() {
    // Las actividades que ya no aplican a los papeles elegidos se descartan aquí, no en
    // silencio en el servidor (que las rechazaría).
    const valides = new Set(activitats.map((a) => a.codi))
    const net = { ...valors, tipus_activitat: ((valors.tipus_activitat as string[] | undefined) ?? []).filter((c) => valides.has(c)) }
    const errs = errorsAlta(net, papers)
    if (papers.length === 0) { setErrors(errs); toast.error(t('ef.err_paper')); return }
    if (Object.keys(errs).length > 0) { marcaErrors(errs); toast.error(t('org.fix_errors')); return }
    setDesant(true)
    const { data, error } = await supabase.rpc('crear_entitat', { p_dades: dadesAlta(net, papers, esTest) })
    setDesant(false)
    if (error) {
      const c = campDelError(error.message)
      if (c) marcaErrors({ [c.camp]: c.clau })
      toast.error(c ? t(c.clau) : textError(t, error.message))
      return
    }
    const org = (data as { organizacion_id: string } | null)?.organizacion_id
    toast.success(t('rec.created'))
    if (org && ambAcces && !motiuAcces) {
      // El alta ya está hecha: un fallo aquí no la deshace, se dice y el acceso se da desde la ficha.
      const r = await donarAcces(org, correuAlta)
      if (r.ok) toast.success(t('acc.ok_donat', { email: correuAlta }))
      else toast.warning(`${t('acc.e_alta_feta')} ${t(clauErrorAcces(r.codi))}`)
    }
    navigate(org ? `${LLISTA}/${org}` : LLISTA, { replace: true })
  }

  const blocProps = { valors, onChange: setCamp, veu: 'equip' as const, potEditar: true, errors, idPrefix: 'ne' }
  const Seccio = ({ titol, children, testid }: { titol: string; children: React.ReactNode; testid?: string }) => (
    <section className="space-y-3 border-t border-border pt-6 first:border-t-0 first:pt-0" data-testid={testid}>
      <h3 className="text-base font-semibold">{titol}</h3>
      {children}
    </section>
  )

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(LLISTA)} className="text-muted-foreground">
        <ArrowLeft className="size-4" /> {t('ef.tornar')}
      </Button>

      <Card>
        <CardHeader>
          <p className="text-xs text-muted-foreground" data-testid="ne-pas">{t('ne.pas', { x: pas })}</p>
          <CardTitle>{t('ef.title_nova')} · {t(pas === 1 ? 'ne.pas1' : 'ne.pas2')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t(pas === 1 ? 'ne.pas1_h' : 'ne.pas2_h')}</p>
        </CardHeader>

        {pas === 1 && (
          <CardContent className="space-y-4" data-testid="ne-pas1">
            <div>
              <Label htmlFor="ne-cerca" className="mb-1.5 block text-xs text-muted-foreground">{t('ne.cerca_label')}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="ne-cerca"
                  name="cerca"
                  type="search"
                  role="combobox"
                  aria-expanded={resultats.length > 0}
                  aria-controls="ne-resultats"
                  aria-autocomplete="list"
                  aria-activedescendant={actiu >= 0 ? `ne-r-${actiu}` : undefined}
                  autoComplete="off"
                  autoFocus
                  className="pl-9 text-base md:text-sm"
                  placeholder={t('ne.cerca_ph')}
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setTriat(null) }}
                  onKeyDown={teclaCerca}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
                {estatCerca === 'buit' && t('ne.cerca_min')}
                {estatCerca === 'cercant' && <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" />{t('ne.cercant')}</span>}
                {estatCerca === 'ok' && resultats.length === 0 && t('ne.cap')}
                {estatCerca === 'error' && <span className="text-destructive">{t('c.load_error')}</span>}
              </p>
            </div>

            {resultats.length > 0 && (
              <ul id="ne-resultats" role="listbox" aria-label={t('ne.cerca_label')} className="divide-y divide-border overflow-hidden rounded-md border">
                {resultats.map((r, i) => {
                  const sel = triat?.organizacion_id === r.organizacion_id
                  return (
                    <li
                      key={r.organizacion_id}
                      id={`ne-r-${i}`}
                      role="option"
                      aria-selected={sel}
                      data-testid="ne-resultat"
                      className={cn('min-h-11 cursor-pointer px-3 py-2', (i === actiu || sel) && 'bg-muted')}
                      onClick={() => tria(r)}
                      onMouseEnter={() => setActiu(i)}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 font-medium break-words">{nomDe(r)}</span>
                        {r.coincidencia === 'nif_exacte' && <Badge variant="secondary">{t('ne.mateix_nif')}</Badge>}
                        {r.es_generadora && (
                          <Badge variant="outline" className={r.productor_activo ? undefined : 'text-muted-foreground line-through'}>
                            {t('ef.paper_ofertant')}
                          </Badge>
                        )}
                        {r.es_receptora && (
                          <Badge variant="outline" className={r.entidad_activo ? undefined : 'text-muted-foreground line-through'}>
                            {t('ef.paper_receptor')}
                          </Badge>
                        )}
                        <Badge className={r.activa ? 'bg-exito-fondo text-exito' : 'bg-muted text-muted-foreground'}>
                          {t(r.activa ? 'ef.estat_activa' : 'ef.estat_inactiva')}
                        </Badge>
                      </span>
                      <span className="block text-xs break-words text-muted-foreground">
                        {[r.razon_social, r.nif, r.poblacion].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}

            {triat && accions && (
              <div ref={triadaRef} className="space-y-3 rounded-md border border-border p-4" data-testid="ne-triada">
                <div>
                  <p className="font-medium">{nomDe(triat)}</p>
                  <p className="text-sm text-muted-foreground">{[triat.razon_social, triat.nif, triat.poblacion].filter(Boolean).join(' · ')}</p>
                </div>
                <p className={cn('text-sm', accions.activa ? 'text-exito' : 'text-aviso')} data-testid="ne-triada-estat">
                  {t(accions.activa ? 'ne.ja_activa' : 'ne.inactiva')}
                  {accions.activa && accions.inactius.map((p) => (
                    <span key={p} className="block text-muted-foreground">{t('ne.paper_inactiu', { rol: t(rolKey(p)).toLowerCase() })}</span>
                  ))}
                </p>
                <div className="flex flex-wrap gap-2">
                  {accions.inactius.length > 0 && (
                    <BotoAmbMotiu disabled={ocupat || !potAprovar} motiu={motiuAprovar} onClick={() => setActivarObert(true)}>
                      {t('ef.btn_activa')}
                    </BotoAmbMotiu>
                  )}
                  {accions.afegibles.map((p) => (
                    <BotoAmbMotiu key={p} variant="outline" disabled={ocupat || !potAprovar} motiu={motiuAprovar} onClick={() => void afegeix(p)}>
                      {t(p === 'productor' ? 'ef.afegeix_ofertant' : 'ef.afegeix_receptor')}
                    </BotoAmbMotiu>
                  ))}
                  <Button variant={accions.inactius.length > 0 ? 'outline' : 'default'} onClick={() => obreFitxa(triat.organizacion_id)}>
                    {t('ne.obre_fitxa')}
                  </Button>
                </div>
              </div>
            )}

            <div className="border-t border-border pt-4">
              <Button variant="outline" className="w-full sm:w-auto" onClick={esNova} data-testid="ne-es-nova">
                <Plus className="size-4" /> {t('ne.es_nova')}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">{t('ne.es_nova_h')}</p>
            </div>
          </CardContent>
        )}

        {pas === 2 && (
          <CardContent className="space-y-6" data-testid="ne-pas2">
            <Seccio titol={t('ne.rols')} testid="ne-rols">
              <p className="text-sm text-muted-foreground">{t('ne.rols_h')}</p>
              <div className="flex flex-wrap gap-2">
                {(['productor', 'entidad'] as const).map((p) => (
                  <Button key={p} type="button" variant={papers.includes(p) ? 'default' : 'outline'}
                    aria-pressed={papers.includes(p)} data-testid={`ne-rol-${p}`} onClick={() => commutaPaper(p)}>
                    {t(rolKey(p))}
                  </Button>
                ))}
              </div>
            </Seccio>

            <Seccio titol={t('org.sec_identitat')}>
              <BlocCamps {...blocProps} camps={campsAlta('identitat', rols)} activitats={activitats}
                placeholderNom={String(valors.persona_contacte ?? '') || undefined} />
            </Seccio>

            <Seccio titol={t('ef.sec_contacte')}>
              <p className="text-sm text-muted-foreground">{t('ef.h_contacte')}</p>
              <BlocCamps {...blocProps} camps={campsAlta('contacte', rols)} />
            </Seccio>

            <Seccio titol={t('org.sec_adreca')}>
              <BlocCamps {...blocProps} camps={campsAlta('adreca', rols).filter((c) => c.edita !== 'ningu')} />
            </Seccio>

            {papers.includes('entidad') && (
              <Seccio titol={t('ef.sec_receptor')}>
                <BlocCamps {...blocProps} camps={campsAlta('receptor', rols)} />
              </Seccio>
            )}

            <FilaCasella checked={esTest} onChange={setEsTest}>{t('ne.es_test')}</FilaCasella>
            {potAprovar && (
              <div data-testid="ne-acces">
                <FilaCasella checked={ambAcces && !motiuAcces} onChange={setAmbAcces} disabled={!!motiuAcces}>
                  {t('ne.dona_acces')}
                </FilaCasella>
                <p className="ml-8 text-xs text-muted-foreground">{t(motiuAcces ?? 'ne.h_dona_acces')}</p>
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => setPas(1)}>
                <ArrowLeft className="size-4" /> {t('ne.tornar_cerca')}
              </Button>
              <Button onClick={() => void crea()} disabled={desant} data-testid="ne-crea">
                {desant ? t('c.saving') : t('ne.crea')}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Se monta al abrirse: el estado del diálogo nace de lo elegido, sin efectos que lo reinicien. */}
      {triat && accions && activarObert && (
        <DialegActivar
          onTancar={() => setActivarObert(false)}
          resultat={triat}
          inactius={accions.inactius}
          onActivada={() => { setActivarObert(false); obreFitxa(triat.organizacion_id) }}
        />
      )}
      {dialegConfirma}
    </div>
  )
}

/**
 * «Activa-la»: NIF y razón social (editables si faltan) y los papeles inactivos que se
 * activan. Lo que falta se escribe primero en las fichas de la organización (las dos, si
 * tiene doble rol: comparten NIF) y después `activar_fitxa` por papel; el trigger de 1A
 * vuelve a comprobar las dos cosas.
 */
function DialegActivar({ onTancar, resultat, inactius, onActivada }: {
  onTancar: () => void
  resultat: ResultatCerca
  inactius: Paper[]
  onActivada: () => void
}) {
  const { t } = useT()
  const faltaNif = !resultat.nif
  const faltaRao = !resultat.razon_social
  const [nif, setNif] = useState('')
  const [rao, setRao] = useState('')
  const [quins, setQuins] = useState<Paper[]>(inactius)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)

  async function activa() {
    setError(null)
    const e: Record<string, string> = {}
    if (faltaNif) {
      if (!nif.trim()) e.nif = 'org.err_falta_nif'
      else { const n = errorNif(nif); if (n) e.nif = n }
    }
    if (faltaRao && !rao.trim()) e.rao = 'org.err_falta_rao_social'
    setErrors(e)
    if (quins.length === 0) { setError(t('ne.act_cap_paper')); return }
    if (Object.keys(e).length > 0) return

    setOcupat(true)
    // Lo que faltaba, en las fichas que tenga (con doble rol, en las dos).
    const dades: Record<string, string> = {}
    if (faltaNif) dades.nif = nif.trim()
    if (faltaRao) dades.razon_social = rao.trim()
    if (Object.keys(dades).length > 0) {
      for (const [taula, id] of [['productores', resultat.productor_id], ['entidades', resultat.entidad_id]] as const) {
        if (!id) continue
        const { data, error: err } = await supabase.from(taula).update(dades).eq('id', id).select('id')
        if (err || !data || data.length === 0) {
          setOcupat(false)
          setError(err ? textError(t, err.message) : t('c.error'))
          return
        }
      }
    }
    for (const p of quins) {
      const id = p === 'productor' ? resultat.productor_id : resultat.entidad_id
      const { error: err } = await supabase.rpc('activar_fitxa', { p_tipus: p, p_id: id })
      if (err) { setOcupat(false); setError(textError(t, err.message)); return }
    }
    setOcupat(false)
    toast.success(t('ef.estat_canviat'))
    onActivada()
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !ocupat) onTancar() }}>
      <DialogContent data-testid="ne-activar">
        <DialogHeader>
          <DialogTitle>{t('ne.act_t', { x: nomDe(resultat) })}</DialogTitle>
          <DialogDescription>{t('ne.act_d')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="ne-act-nif" className="mb-1.5 block text-xs text-muted-foreground">{t('f.nif')}</Label>
            {faltaNif
              ? <Input id="ne-act-nif" name="nif" value={nif} aria-invalid={Boolean(errors.nif)} className="text-base md:text-sm"
                  onChange={(e) => { setNif(e.target.value); setErrors((x) => ({ ...x, nif: '' })) }} />
              : <p id="ne-act-nif" className="text-sm font-medium">{resultat.nif}</p>}
            {errors.nif && <p className="mt-1 text-xs text-destructive">{t(errors.nif)}</p>}
          </div>
          <div>
            <Label htmlFor="ne-act-rao" className="mb-1.5 block text-xs text-muted-foreground">{t('org.f_rao_social')}</Label>
            {faltaRao
              ? <Input id="ne-act-rao" name="razon_social" value={rao} aria-invalid={Boolean(errors.rao)} className="text-base md:text-sm"
                  onChange={(e) => { setRao(e.target.value); setErrors((x) => ({ ...x, rao: '' })) }} />
              : <p id="ne-act-rao" className="text-sm font-medium">{resultat.razon_social}</p>}
            {errors.rao && <p className="mt-1 text-xs text-destructive">{t(errors.rao)}</p>}
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">{t('ne.act_papers')}</p>
            {inactius.map((p) => (
              <FilaCasella key={p} checked={quins.includes(p)}
                onChange={(v) => setQuins((qs) => (v ? [...qs, p] : qs.filter((x) => x !== p)))}>
                {t(rolKey(p))}
              </FilaCasella>
            ))}
          </div>
          {error && <p className="text-sm text-destructive" role="alert" data-testid="ne-activar-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onTancar} disabled={ocupat}>{t('c.cancel')}</Button>
          <Button onClick={() => void activa()} disabled={ocupat} data-testid="ne-activar-ok">
            {ocupat ? t('c.saving') : t('ef.btn_activa')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
