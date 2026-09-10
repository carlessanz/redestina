// La campaña de firma (§3.2.6): las dos mitades que el equipo mira cada semana.
//
// ARRIBA, EL SEGUIMIENTO (`v_campanya_convenis`): qué porcentaje está firmado por modelo y
// por comarca. Una organización cuenta **una vez por modelo** y con su estado más avanzado,
// porque una campaña se mide por lo conseguido y no por los borradores que se generaron
// por el camino. Es la vista la que lo decide, no esta pantalla.
//
// ABAJO, EL TRABAJO (`v_fitxes_incompletes_conveni`): a quién se le puede mandar hoy y qué
// le falta a quien no. La diferencia que importa es **el correo**: sin correo no hay a
// dónde mandarlo y esa organización va a la lista de firma presencial (§3.2.5). Lo demás
// —NIF, domicilio, población— son avisos: se piden en la propia página de firma, que es
// donde la persona los sabe mejor que nuestro CSV.
//
// EL ENVÍO VA POR TANDAS DE 25 y en serie, no en paralelo. Son tres pasos por organización
// (preparar el borrador, crear el enlace, mandar el correo) y cada uno puede fallar por su
// cuenta; en serie se sabe exactamente cuál falló y en quién, y una tanda a medias se puede
// repetir sin duplicar nada —`preparar_convenio` es idempotente y reenviar revoca el
// enlace anterior—. Veinticinco correos de golpe tampoco es algo que convenga acelerar.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { dataCurta } from '../../lib/albarans'
import { enviarConveni, enviarCorreuConveni, prepararConveni } from '../../lib/convenis'
import type { CampanyaFila, FitxaIncompleta } from '../../lib/convenis'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const TOTS = '__tots'
const TANDA = 25

type Vista = 'llestes' | 'incompletes' | 'sense_correu' | 'totes'

interface Resultat {
  clau: string
  nom: string
  ok: boolean
  missatge: string | null
}

/** `tipo_org:org_id` — las dos tablas pueden repetir id, así que la clave lleva las dos. */
function clauDe(f: FitxaIncompleta): string {
  return `${f.tipo_org}:${f.org_id}`
}

export default function CampanyaConvenis() {
  const { t } = useT()
  const [fitxes, setFitxes] = useState<FitxaIncompleta[]>([])
  const [resum, setResum] = useState<CampanyaFila[]>([])
  const [dataCorte, setDataCorte] = useState<string | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [vista, setVista] = useState<Vista>('llestes')
  const [comarca, setComarca] = useState<string>(TOTS)
  const [cerca, setCerca] = useState('')
  const [triades, setTriades] = useState<Set<string>>(new Set())

  const [enviant, setEnviant] = useState(false)
  const [progres, setProgres] = useState<{ fetes: number; total: number } | null>(null)
  const [resultats, setResultats] = useState<Resultat[]>([])

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    const [inc, camp, par] = await Promise.all([
      supabase.from('v_fitxes_incompletes_conveni')
        .select('tipo_org, org_id, nom, email, comarca, es_test, tipo, te_conveni_vigent, falta, nomes_firma_assistida')
        .order('nom', { ascending: true }),
      supabase.from('v_campanya_convenis')
        .select('tipo_org, tipo, comarca, organitzacions, vigents, per_contrasignar, pendents_firma, retornats, esborranys, resolts, sense_conveni, pct_vigent')
        .order('comarca', { ascending: true }),
      supabase.from('parametros_documentales')
        .select('fecha_corte_convenios')
        .eq('id', 1)
        .maybeSingle(),
    ])
    if (inc.error) { setError(inc.error.message); setCarregant(false); return }
    setFitxes((inc.data as FitxaIncompleta[] | null) ?? [])
    setResum((camp.data as CampanyaFila[] | null) ?? [])
    setDataCorte((par.data as { fecha_corte_convenios: string | null } | null)?.fecha_corte_convenios ?? null)
    setCarregant(false)
  }, [])

  useEffect(() => { void carrega() }, [carrega])

  const comarques = useMemo(() => {
    const set = new Set<string>()
    for (const f of fitxes) if (f.comarca) set.add(f.comarca)
    return [...set].sort((a, b) => a.localeCompare(b, 'ca'))
  }, [fitxes])

  const visibles = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    return fitxes.filter((f) => {
      // Quien ya tiene convenio vigente no es trabajo de la campaña, en ninguna vista
      // salvo la de «totes»: si sale ahí es para poder comprobarlo, no para reenviarle.
      if (f.te_conveni_vigent && vista !== 'totes') return false
      const falta = f.falta ?? []
      if (vista === 'llestes' && (f.nomes_firma_assistida || falta.length > 0)) return false
      if (vista === 'incompletes' && (f.nomes_firma_assistida || falta.length === 0)) return false
      if (vista === 'sense_correu' && !f.nomes_firma_assistida) return false
      if (comarca !== TOTS && (f.comarca ?? '') !== comarca) return false
      if (!q) return true
      return [f.nom, f.email, f.comarca].some((c) => (c ?? '').toLowerCase().includes(q))
    })
  }, [fitxes, vista, comarca, cerca])

  /** Solo se puede mandar a quien tiene correo: sin él, la vía es la firma presencial. */
  const enviables = useMemo(
    () => visibles.filter((f) => !f.nomes_firma_assistida && !f.te_conveni_vigent),
    [visibles],
  )

  function commuta(clau: string) {
    setTriades((p) => {
      const nou = new Set(p)
      if (nou.has(clau)) nou.delete(clau)
      else nou.add(clau)
      return nou
    })
  }

  function triaTanda() {
    setTriades(new Set(enviables.slice(0, TANDA).map(clauDe)))
  }

  async function enviaTanda() {
    const llista = enviables.filter((f) => triades.has(clauDe(f)))
    if (llista.length === 0) return
    setEnviant(true)
    setResultats([])
    setProgres({ fetes: 0, total: llista.length })
    const sortida: Resultat[] = []

    for (const f of llista) {
      const nom = f.nom ?? '—'
      const prep = await prepararConveni(f.tipo_org, f.org_id, f.tipo)
      if (!prep.ok) {
        sortida.push({ clau: clauDe(f), nom, ok: false, missatge: prep.missatge })
        setProgres((p) => (p ? { ...p, fetes: p.fetes + 1 } : p))
        continue
      }
      const env = await enviarConveni(prep.data.id, f.email)
      if (!env.ok) {
        sortida.push({ clau: clauDe(f), nom, ok: false, missatge: env.missatge })
        setProgres((p) => (p ? { ...p, fetes: p.fetes + 1 } : p))
        continue
      }
      const correu = await enviarCorreuConveni({
        email: env.data.enllac.destinatari ?? f.email ?? '',
        nom: env.data.enllac.nom ?? nom,
        token: env.data.enllac.token,
        assumpte: t('conv.mail_subject'),
        titol: t('conv.mail_title'),
        preheader: t('conv.mail_preheader'),
        cos: t('conv.mail_body'),
        boto: t('conv.mail_button'),
        nota: t('conv.mail_note'),
      })
      // El enlace ya existe aunque el correo no salga (modo test, dirección mala): eso no
      // es un fallo del convenio, es un fallo del envío, y se dice como tal para que el
      // dinamizador sepa que puede copiar el enlace desde el detalle en vez de repetirlo.
      sortida.push({
        clau: clauDe(f),
        nom,
        ok: correu.ok,
        missatge: correu.ok ? null : (correu.missatge ?? t('conv.mail_error')),
      })
      setProgres((p) => (p ? { ...p, fetes: p.fetes + 1 } : p))
      setResultats([...sortida])
    }

    setResultats(sortida)
    setEnviant(false)
    setProgres(null)
    setTriades(new Set())
    const be = sortida.filter((r) => r.ok).length
    toast.success(t('camp.batch_done', { ok: be, total: sortida.length }))
    await carrega()
  }

  const totals = useMemo(() => {
    const t0 = { organitzacions: 0, vigents: 0, per_contrasignar: 0, pendents_firma: 0, sense_conveni: 0 }
    for (const r of resum) {
      t0.organitzacions += r.organitzacions
      t0.vigents += r.vigents
      t0.per_contrasignar += r.per_contrasignar
      t0.pendents_firma += r.pendents_firma
      t0.sense_conveni += r.sense_conveni
    }
    return t0
  }, [resum])

  const pctTotal = totals.organitzacions > 0
    ? Math.round((1000 * totals.vigents) / totals.organitzacions) / 10
    : 0

  return (
    <div className="space-y-4">
      {/* ── Seguimiento ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t('camp.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('camp.subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-md bg-secondary p-3 text-sm text-secondary-foreground">
            {dataCorte
              ? t('camp.cutoff', { date: dataCurta(dataCorte) })
              : t('camp.cutoff_none')}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Xifra etiqueta={t('camp.k_orgs')} valor={String(totals.organitzacions)} />
            <Xifra etiqueta={t('camp.k_signed')} valor={`${pctTotal}%`} />
            <Xifra etiqueta={t('camp.k_tocounter')} valor={String(totals.per_contrasignar)} />
            <Xifra etiqueta={t('camp.k_none')} valor={String(totals.sense_conveni)} />
          </div>

          {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {resum.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('conv.c_model')}</TableHead>
                    <TableHead>{t('conv.c_region')}</TableHead>
                    <TableHead className="text-right">{t('camp.c_orgs')}</TableHead>
                    <TableHead className="text-right">{t('camp.c_current')}</TableHead>
                    <TableHead className="text-right">{t('camp.c_pending')}</TableHead>
                    <TableHead className="text-right">{t('camp.c_none')}</TableHead>
                    <TableHead className="text-right">{t('camp.c_pct')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resum.map((r) => (
                    <TableRow key={`${r.tipo}-${r.comarca}`}>
                      <TableCell><Badge variant="outline">{t(`sig.model_${r.tipo}`)}</Badge></TableCell>
                      <TableCell className="max-w-48 truncate">{r.comarca}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.organitzacions}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.vigents}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.pendents_firma + r.per_contrasignar + r.retornats}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.sense_conveni}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.pct_vigent ?? 0}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Fichas y envío por tandas ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('camp.list_title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('camp.list_subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="camp-vista">{t('camp.f_view')}</Label>
              <Select value={vista} onValueChange={(v) => setVista(v as Vista)}>
                <SelectTrigger id="camp-vista"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="llestes">{t('camp.v_ready')}</SelectItem>
                  <SelectItem value="incompletes">{t('camp.v_incomplete')}</SelectItem>
                  <SelectItem value="sense_correu">{t('camp.v_nomail')}</SelectItem>
                  <SelectItem value="totes">{t('camp.v_all')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="camp-comarca">{t('conv.f_region')}</Label>
              <Select value={comarca} onValueChange={setComarca}>
                <SelectTrigger id="camp-comarca"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TOTS}>{t('conv.all')}</SelectItem>
                  {comarques.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="camp-cerca">{t('c.search')}</Label>
              <Input id="camp-cerca" type="search" value={cerca}
                onChange={(e) => setCerca(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="h-11 whitespace-normal md:h-9"
              disabled={enviant || enviables.length === 0} onClick={triaTanda}>
              {t('camp.pick_batch', { n: TANDA })}
            </Button>
            <Button className="h-11 whitespace-normal md:h-9"
              disabled={enviant || triades.size === 0} onClick={() => void enviaTanda()}>
              {enviant && <Loader2 className="size-4 animate-spin" />}
              {t('camp.send_batch', { n: triades.size })}
            </Button>
            {progres && (
              <span className="text-sm tabular-nums text-muted-foreground">
                {t('camp.progress', { done: progres.fetes, total: progres.total })}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('camp.test_note')}</p>

          {resultats.length > 0 && (
            <div className="space-y-1 rounded-md border p-3">
              <p className="text-sm font-medium">{t('camp.results')}</p>
              {resultats.map((r) => (
                <p key={r.clau} className={`text-xs ${r.ok ? 'text-exito' : 'text-error'}`}>
                  {r.nom} · {r.ok ? t('camp.res_ok') : (r.missatge ?? t('camp.res_ko'))}
                </p>
              ))}
            </div>
          )}

          {visibles.length === 0
            ? <p className="text-sm text-muted-foreground">{t('camp.list_empty')}</p>
            : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"><span className="sr-only">{t('camp.c_pick')}</span></TableHead>
                      <TableHead>{t('conv.c_org')}</TableHead>
                      <TableHead>{t('conv.c_model')}</TableHead>
                      <TableHead>{t('conv.c_region')}</TableHead>
                      <TableHead>{t('camp.c_missing')}</TableHead>
                      <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibles.map((f) => {
                      const clau = clauDe(f)
                      const falta = f.falta ?? []
                      return (
                        <TableRow key={clau}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="size-5 accent-primary"
                              aria-label={f.nom ?? clau}
                              disabled={f.nomes_firma_assistida || f.te_conveni_vigent || enviant}
                              checked={triades.has(clau)}
                              onChange={() => commuta(clau)}
                            />
                          </TableCell>
                          <TableCell className="max-w-56 truncate">
                            <span className="font-medium">{f.nom ?? '—'}</span>
                            {f.es_test && <Badge className="ml-2 bg-secondary text-secondary-foreground">{t('camp.badge_test')}</Badge>}
                            <span className="block text-xs text-muted-foreground">{f.email ?? t('camp.no_mail')}</span>
                          </TableCell>
                          <TableCell><Badge variant="outline">{t(`sig.model_${f.tipo}`)}</Badge></TableCell>
                          <TableCell className="text-muted-foreground">{f.comarca ?? '—'}</TableCell>
                          <TableCell>
                            {f.te_conveni_vigent && (
                              <Badge className="bg-exito-fondo text-exito">{t('camp.has_current')}</Badge>
                            )}
                            {f.nomes_firma_assistida && (
                              <Badge className="bg-aviso-fondo text-aviso">{t('camp.only_assisted')}</Badge>
                            )}
                            {falta.filter((x) => x !== 'correu').map((x) => (
                              <Badge key={x} variant="outline" className="ml-1">{t(`camp.miss_${x}`)}</Badge>
                            ))}
                            {!f.te_conveni_vigent && !f.nomes_firma_assistida && falta.length === 0 && (
                              <span className="text-xs text-muted-foreground">{t('camp.ready')}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <Button asChild size="sm" variant="outline" className="h-11 whitespace-normal md:h-8">
                                <Link to={`/equip/${f.tipo_org === 'productor' ? 'productors' : 'entitats'}/${f.org_id}`}>
                                  {t('camp.open_record')}
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  )
}

/** Una cifra del seguimiento. Mismo patrón que los KPI del Dashboard. */
function Xifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="text-xl tabular-nums font-titulos">{valor}</p>
    </div>
  )
}
