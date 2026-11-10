// Los lugares de recogida de una entidad productora (`productor_ubicaciones`): la lista, el
// alta y la baja.
//
// UN SOLO COMPONENTE para la ficha propia (`PerfilOrganitzacio`) y la del equipo
// (`EntitatDetall` desde 1C; antes `FitxaRegistre`, 28-09-2026), con el mismo criterio que `CampsPerfilReceptor`. Carga y
// guarda por su cuenta: cada lugar es una fila propia, no un campo de la ficha, así que no
// espera al «Desar» de nadie.
//
// El alta va por `creaUbicacio()` —la misma del alta de oferta—, con el municipio de la lista
// oficial: es lo que hace que la comarca de una oferta salga exacta (§4, `municipi_ine`).
//
// A4 (`20270521100000`, fila 2.5): cada lugar lleva DÍAS de la semana y FRANJAS horarias, y
// uno es el PRINCIPAL (`fixar_lloc_principal`; el primero nace principal y, si se borra, lo
// pasa a ser otro: trigger). El principal y su primera franja son lo que la oferta nueva
// propone (`predeterminats` de `crear-oferta`). Se monta igual en la ficha del equipo, en «La
// meva organització» y en la sección Operativa del diagnóstico (T4).

import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { refrescaAvisos } from '../lib/refrescAvisos'
import { creaUbicacio } from '../lib/ofertes'
import type { DadesLloc } from '../lib/ofertes'
import { Textarea } from '@/components/ui/textarea'
import type { Municipi } from '../lib/municipis'
import { esFranjaValida, type Franja } from '../lib/franja'
import SelectorMunicipi from './SelectorMunicipi'
import SelectorFranja from './SelectorFranja'
import XipsTria from './XipsTria'
import { Badge } from '@/components/ui/badge'
import { useConfirma } from './DialegConfirma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Ubicacio extends Partial<DadesLloc> {
  id: string; alias: string | null; municipio: string | null; gmaps_url: string | null
  es_principal: boolean | null
}

/** El formulario: alta (`id` nulo) o edición de uno que ya existe. */
interface FormLloc {
  id: string | null
  alias: string; maps: string; municipi: Municipi | null
  direccion: string; contacto_nombre: string; contacto_telefono: string; horario: string; observaciones: string
  /** A4: días (1–7) y franjas; una franja a medias se queda en el formulario y no se guarda. */
  dies: number[]
  franges: (Partial<Franja> | null)[]
}

const BUIT: Omit<FormLloc, 'id'> = {
  alias: '', maps: '', municipi: null,
  direccion: '', contacto_nombre: '', contacto_telefono: '', horario: '', observaciones: '',
  dies: [], franges: [],
}

/** Como mucho cuatro franjas por lugar (CHECK `franges_valides`). */
const MAX_FRANGES = 4
const DIES = [1, 2, 3, 4, 5, 6, 7] as const

/** Vacío → `null`: una columna en blanco no es lo mismo que un texto vacío. */
const net = (v: string) => (v.trim() === '' ? null : v.trim())
const extraDe = (f: FormLloc): DadesLloc => {
  const franges = f.franges.filter((x): x is Franja => esFranjaValida(x))
  return {
    direccion: net(f.direccion), contacto_nombre: net(f.contacto_nombre),
    contacto_telefono: net(f.contacto_telefono), horario: net(f.horario), observaciones: net(f.observaciones),
    dies_setmana: f.dies.length ? [...f.dies].sort((a, b) => a - b) : null,
    franges: franges.length ? franges : null,
  }
}

/** El principal primero; el resto, por nombre (como los sirve `crear-oferta`). */
const ordena = (u: Ubicacio[]) => [...u].sort((a, b) =>
  Number(Boolean(b.es_principal)) - Number(Boolean(a.es_principal)) || (a.alias ?? '').localeCompare(b.alias ?? '', 'ca'))

export default function LlocsRecollida({
  productorId, potEditar = true, idPrefix = 'lloc',
}: {
  productorId: string
  potEditar?: boolean
  /** Prefijo de los `id` del formulario de alta. */
  idPrefix?: string
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [ubicacions, setUbicacions] = useState<Ubicacio[]>([])
  const [llocNou, setLlocNou] = useState<FormLloc | null>(null)
  /** Un fallo de lectura no es «no tens cap lloc»: se decía eso mismo. */
  const [errorCarrega, setErrorCarrega] = useState(false)
  /** Se vuelve a leer tras cambiar el principal o borrar (el trigger puede haber movido la marca). */
  const [versio, setVersio] = useState(0)

  useEffect(() => {
    let viu = true
    void supabase.from('productor_ubicaciones')
      .select('id, alias, municipio, gmaps_url, direccion, contacto_nombre, contacto_telefono, horario, observaciones, es_principal, dies_setmana, franges').eq('productor_id', productorId).order('alias')
      .then(({ data, error }) => {
        if (!viu) return
        setErrorCarrega(Boolean(error))
        setUbicacions(ordena((data ?? []) as Ubicacio[]))
      })
    return () => { viu = false }
  }, [productorId, versio])


  async function fesPrincipal(u: Ubicacio) {
    const { error } = await supabase.rpc('fixar_lloc_principal', { p_lloc: u.id })
    if (error) { toast.error(textError(t, error.message)); return }
    toast.success(t('org.place_principal_saved', { x: u.alias ?? '—' }))
    setVersio((v) => v + 1)
    refrescaAvisos()
  }

  /** «dl, dc · 08:00–12:00, 15:00–18:00»: lo que se lee del lugar en la lista. */
  function textDiesFranges(u: Ubicacio): string | null {
    const dies = (u.dies_setmana ?? []).map((d) => t(`org.dia_${d}`)).join(', ')
    const franges = (u.franges ?? []).map((f) => `${f.inici}–${f.fi}`).join(', ')
    return [dies, franges].filter(Boolean).join(' · ') || null
  }

  async function afegeix() {
    if (!llocNou) return
    if (!llocNou.alias.trim()) { toast.error(t('po.place_need_name')); return }
    // Editar uno que ya existe: sus datos de contacto y condiciones (el municipio y el mapa
    // no se tocan aquí: cambiarlos movería la comarca de las ofertas que ya lo usan).
    if (llocNou.id) {
      const canvis = { alias: llocNou.alias.trim(), ...extraDe(llocNou) }
      const { data, error } = await supabase.from('productor_ubicaciones')
        .update(canvis).eq('id', llocNou.id).select('id')
      if (error || !data || data.length === 0) { toast.error(textError(t, error?.message)); return }
      setUbicacions((u) => ordena(u.map((x) => (x.id === llocNou.id ? { ...x, ...canvis } : x))))
      setLlocNou(null)
      toast.success(t('org.place_saved'))
      return
    }
    const r = await creaUbicacio({
      productorId,
      alias: llocNou.alias.trim(),
      gmapsUrl: llocNou.maps.trim() || null,
      municipi: llocNou.municipi ? { codi_ine: llocNou.municipi.codi_ine, nom: llocNou.municipi.nom } : null,
      extra: extraDe(llocNou),
    })
    if (!r.ok || !r.data) { toast.error(textError(t, r.error)); return }
    setUbicacions((u) => ordena([...u, { ...r.data!, gmaps_url: llocNou.maps.trim() || null, ...extraDe(llocNou) }]))
    setLlocNou(null)
    toast.success(t('org.place_added'))
    // La marca «Completa la teva Operativa» del menú vive en AppShell (`useOperativaPendent`).
    refrescaAvisos()
  }

  async function esborra(u: Ubicacio) {
    if (!(await confirma({
      titol: t('org.place_delete_t', { x: u.alias ?? '—' }),
      descripcio: t('org.place_delete_d'),
      confirmar: t('c.delete'),
      destructiu: true,
    }))) return
    // `.select('id')`: un DELETE que la RLS no deja pasar no da error, borra cero filas, y
    // la pantalla quitaba el lugar de la lista aunque seguía existiendo.
    const { data, error } = await supabase.from('productor_ubicaciones').delete().eq('id', u.id).select('id')
    // 23503: alguna oferta apunta a este lugar. No se borra: se diría que la oferta ya no
    // tiene dónde recogerse.
    if (error) { toast.error(error.code === '23503' ? t('org.place_in_use') : textError(t, error.message)); return }
    if (!data || data.length === 0) { toast.error(t('c.error')); return }
    setUbicacions((l) => l.filter((x) => x.id !== u.id))
    // Si era el principal, el trigger ha marcado otro: se relee.
    if (u.es_principal) setVersio((v) => v + 1)
    refrescaAvisos()
  }

  return (
    <>
      {dialeg}
      {errorCarrega && <p className="text-sm text-destructive">{t('c.error')}</p>}
      {!errorCarrega && ubicacions.length === 0 && <p className="text-sm text-muted-foreground">{t('org.no_places')}</p>}
      <ul className="space-y-2">
        {ubicacions.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {u.alias ?? '—'}
                {u.es_principal && <Badge variant="secondary" data-testid="lloc-principal">{t('org.place_principal')}</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                {[u.direccion, u.municipio ?? '—'].filter(Boolean).join(', ')}
                {u.gmaps_url && <> · <a href={u.gmaps_url} target="_blank" rel="noreferrer" className="text-primary underline">{t('org.see_map')}</a></>}
              </p>
              {(u.contacto_nombre || u.contacto_telefono || u.horario) && (
                <p className="text-xs text-muted-foreground">
                  {[u.contacto_nombre, u.contacto_telefono, u.horario].filter(Boolean).join(' · ')}
                </p>
              )}
              {textDiesFranges(u) && <p className="text-xs text-muted-foreground">{textDiesFranges(u)}</p>}
              {u.observaciones && <p className="text-xs text-muted-foreground">{u.observaciones}</p>}
            </div>
            {potEditar && (
              <div className="flex flex-wrap gap-1">
                {!u.es_principal && (
                  <Button variant="outline" size="sm" className="h-11 whitespace-nowrap md:h-8"
                    onClick={() => void fesPrincipal(u)}>
                    {t('org.place_make_principal')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-11 md:h-8"
                  aria-label={t('org.place_edit', { x: u.alias ?? '' })}
                  onClick={() => setLlocNou({
                    ...BUIT, id: u.id, alias: u.alias ?? '', maps: u.gmaps_url ?? '',
                    direccion: u.direccion ?? '', contacto_nombre: u.contacto_nombre ?? '',
                    contacto_telefono: u.contacto_telefono ?? '', horario: u.horario ?? '',
                    observaciones: u.observaciones ?? '',
                    dies: u.dies_setmana ?? [], franges: u.franges ?? [],
                  })}>
                  <Pencil className="size-4" aria-hidden />
                </Button>
                <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={() => void esborra(u)}
                  aria-label={t('org.place_delete', { x: u.alias ?? '' })}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {potEditar && !llocNou && (
        <Button variant="outline" className="h-11 whitespace-normal md:h-8"
          onClick={() => setLlocNou({ ...BUIT, id: null })}>
          <Plus className="size-4" aria-hidden /> {t('po.place_add')}
        </Button>
      )}
      {llocNou && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${idPrefix}-nom`} className="mb-1.5 block text-xs text-muted-foreground">{t('po.place_name')}</Label>
            <Input id={`${idPrefix}-nom`} value={llocNou.alias} placeholder={t('po.place_name_ph')}
              onChange={(e) => setLlocNou((l) => (l ? { ...l, alias: e.target.value } : l))} />
          </div>
          {/* Municipio y mapa solo al dar de alta: cambiarlos después movería la comarca de
              las ofertas que ya lo usan. */}
          {!llocNou.id && (
            <>
              <div>
                <Label htmlFor={`${idPrefix}-municipi`} className="mb-1.5 block text-xs text-muted-foreground">{t('po.place_town')}</Label>
                <SelectorMunicipi id={`${idPrefix}-municipi`} valor={llocNou.municipi?.codi_ine ?? null}
                  onChange={(m) => setLlocNou((l) => (l ? { ...l, municipi: m } : l))} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor={`${idPrefix}-maps`} className="mb-1.5 block text-xs text-muted-foreground">
                  {t('po.place_maps')} <span className="ml-1">{t('po.optional')}</span>
                </Label>
                <Input id={`${idPrefix}-maps`} type="url" inputMode="url" value={llocNou.maps} placeholder="https://maps.app.goo.gl/…"
                  onChange={(e) => setLlocNou((l) => (l ? { ...l, maps: e.target.value } : l))} />
              </div>
            </>
          )}
          {([
            ['direccion', 'org.place_address', 300],
            ['contacto_nombre', 'org.place_contact', 120],
            ['contacto_telefono', 'org.place_phone', 40],
            ['horario', 'org.place_hours', 200],
          ] as const).map(([camp, clau, max]) => (
            <div key={camp}>
              <Label htmlFor={`${idPrefix}-${camp}`} className="mb-1.5 block text-xs text-muted-foreground">
                {t(clau)} <span className="ml-1">{t('po.optional')}</span>
              </Label>
              <Input id={`${idPrefix}-${camp}`} value={llocNou[camp]} maxLength={max}
                inputMode={camp === 'contacto_telefono' ? 'tel' : undefined}
                onChange={(e) => setLlocNou((l) => (l ? { ...l, [camp]: e.target.value } : l))} />
            </div>
          ))}
          {/* A4 (fila 2.5): días de la semana y franjas horarias del lugar. */}
          <div className="sm:col-span-2">
            <p id={`${idPrefix}-dies-l`} className="mb-1.5 text-xs text-muted-foreground">{t('org.place_days')}</p>
            <XipsTria etiquetaId={`${idPrefix}-dies-l`}
              opcions={DIES.map((d) => ({ valor: String(d), text: t(`org.dia_${d}`) }))}
              triats={llocNou.dies.map(String)}
              onChange={(v) => setLlocNou((l) => (l ? { ...l, dies: v.map(Number) } : l))} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <p className="text-xs text-muted-foreground">{t('org.place_slots')}</p>
            {llocNou.franges.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <SelectorFranja id={`${idPrefix}-franja-${i}`} valor={f}
                  invalid={f !== null && !esFranjaValida(f) && Boolean(f.inici && f.fi)}
                  onChange={(nf) => setLlocNou((l) => (l ? { ...l, franges: l.franges.map((x, j) => (j === i ? nf : x)) } : l))} />
                <Button variant="ghost" size="sm" className="h-11 md:h-8" aria-label={t('org.place_slot_delete')}
                  onClick={() => setLlocNou((l) => (l ? { ...l, franges: l.franges.filter((_, j) => j !== i) } : l))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            {llocNou.franges.length < MAX_FRANGES && (
              <Button variant="outline" size="sm" className="h-11 whitespace-nowrap md:h-8"
                onClick={() => setLlocNou((l) => (l ? { ...l, franges: [...l.franges, null] } : l))}>
                <Plus className="size-4" aria-hidden /> {t('org.place_slot_add')}
              </Button>
            )}
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`${idPrefix}-observaciones`} className="mb-1.5 block text-xs text-muted-foreground">
              {t('org.place_notes')} <span className="ml-1">{t('po.optional')}</span>
            </Label>
            <Textarea id={`${idPrefix}-observaciones`} value={llocNou.observaciones} maxLength={600}
              placeholder={t('org.place_notes_ph')}
              onChange={(e) => setLlocNou((l) => (l ? { ...l, observaciones: e.target.value } : l))} />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button className="h-11 whitespace-normal md:h-8" onClick={() => void afegeix()}>{t('po.place_save')}</Button>
            <Button variant="ghost" className="h-11 md:h-8" onClick={() => setLlocNou(null)}>{t('c.cancel')}</Button>
          </div>
        </div>
      )}
    </>
  )
}
