// «Registrar operació realitzada» (proceso 3.7 del cliente; fase 5 del plan de noviembre de 2026).
//
// POR QUÉ EXISTE. Parte de lo que canaliza la Fundació pasa fuera de la plataforma (una llamada,
// una entrega que ya se hizo): hasta ahora no había forma de que constara sin recorrer el ciclo
// entero —publicar, interés, asignación, recogida, validación— con fechas que no eran las reales.
// Aquí el equipo (Superadmin y Dinamitzador, `pot_aprovar()`) la registra de una vez, con la
// FECHA EN QUE OCURRIÓ, y la base hace el ciclo en una transacción sin avisar a nadie
// (`registrar_operacio_realitzada()`, 20270619100200): oferta `origen = 'registre'` → asignación →
// recogida validada con esa fecha → ENT + REC (donación) o conciliada sin albarán → destinos del
// sobrante → `cerrada`.
//
// ⚠️ NO es un segundo formulario de alta: no pregunta lo que solo sirve para publicar (franja,
//    disponibilidad, envases, fotos). Reutiliza las piezas del alta asistida: la lista de
//    productoras (`useProductorsActius`), el descriptor de `crear-oferta/campos` para productos,
//    lugares y subcausas, las entidades con su compatibilidad (`useEntitatsAssignables`) y el
//    catálogo de destinos de `DestiFinal`. Lo que la base rechazaría lo anticipa
//    `errorOperacio()` (`lib/operacioRealitzada.ts`, puro y con pruebas).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { avuiMadrid, nombre } from '../../lib/format'
import { textError } from '../../lib/textError'
import { carregaCamps, carregaCatalegDestins, etiquetaFamilia } from '../../lib/ofertes'
import type { CatalogosOferta, DestiCataleg } from '../../lib/ofertes'
import { catalegDelDescriptor, opcionsSubcausa } from '../../lib/causes'
import { opcioFitxa } from '../../lib/opcionsSelector'
import { comprovaConvenis } from '../../lib/aprovarResposta'
import {
  FILA_DESTI_BUIDA, FILA_DESTINATARI_BUIDA, MAX_OBSERVACIONS, argumentsOperacio, entitatAdmet,
  errorOperacio, formInicial, horaMadrid, limitsData, resumKg, textOfertaOperacio,
} from '../../lib/operacioRealitzada'
import type { FilaDestiOperacio, FilaDestinatari, FormOperacio } from '../../lib/operacioRealitzada'
import { registraOperacioRealitzada } from '../../lib/operacioRealitzadaApi'
import { useProductorsActius } from '../../hooks/useProductorsActius'
import { useEntitatsAssignables } from '../../hooks/useEntitatsAssignables'
import type { Modalitat, ResultatOperacioRealitzada } from '../../types'
import { cn } from '../../lib/utils'
import CercadorOpcions from '../CercadorOpcions'
import type { OpcioCercador } from '../CercadorOpcions'
import SelectorEntitat from '../SelectorEntitat'
import SelectorModalitat from '../SelectorModalitat'
import Desplegable from '../Desplegable'
import TriaSiNo from '../TriaSiNo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  obert: boolean
  onTancar: () => void
  /** Tras registrar: quien monta el diálogo decide si relee algo. El diálogo ya se ha cerrado. */
  onFet?: (r: ResultatOperacioRealitzada) => void
}

/** La etiqueta de un campo (DESIGN.md «Formulario»), y «(opcional)» al lado, en gris. */
const ETIQUETA = 'mb-1.5 block leading-snug'
const OPCIONAL = 'ml-1 font-normal text-muted-foreground'
const MODALITATS: readonly Modalitat[] = ['donacio', 'venda', 'maquila']
/** Un solo aviso de error a la vez: el siguiente intento sustituye al anterior. */
const TOAST_ERROR = 'operacio-realitzada-error'

/** Un título de bloque del formulario. */
function TitolBloc({ children }: { children: string }) {
  return <h3 className="text-base font-semibold">{children}</h3>
}

/** Una fila de entidad destinataria: entidad, kg, precio (venta) y cajas. */
function FilaEntitat({
  i, fila, opcions, venda, onCanvia, onTreu,
}: {
  i: number
  fila: FilaDestinatari
  opcions: readonly OpcioCercador[]
  venda: boolean
  onCanvia: (camp: keyof FilaDestinatari, v: string) => void
  onTreu: () => void
}) {
  const { t } = useT()
  return (
    <div data-testid="opr-destinatari"
      className={cn('grid grid-cols-1 gap-2 rounded-md border p-3 sm:items-end',
        venda ? 'sm:grid-cols-[3fr_1fr_1fr_1fr_auto]' : 'sm:grid-cols-[3fr_1fr_1fr_auto]')}>
      <div className="min-w-0">
        <Label htmlFor={`opr-ent-${i}`} className={ETIQUETA}>{t('opr.f_entitat')}</Label>
        {/* Sin el municipio debajo: descuadraba la fila (el buscador ya lo enseña al elegir). */}
        <SelectorEntitat id={`opr-ent-${i}`} valor={fila.entitat} opcions={opcions} detallSota={false}
          placeholder={t('sel.entitat')} onChange={(v) => onCanvia('entitat', v)} />
      </div>
      <div>
        <Label htmlFor={`opr-ent-kg-${i}`} className={ETIQUETA}>{t('desti.f_kg')}</Label>
        <Input id={`opr-ent-kg-${i}`} inputMode="decimal" value={fila.kg} className="h-11 md:h-8"
          onChange={(e) => onCanvia('kg', e.target.value)} />
      </div>
      {venda && (
        <div>
          <Label htmlFor={`opr-ent-preu-${i}`} className={ETIQUETA}>{t('asg.preu_acordat')}</Label>
          <Input id={`opr-ent-preu-${i}`} inputMode="decimal" value={fila.preu} className="h-11 md:h-8"
            onChange={(e) => onCanvia('preu', e.target.value)} />
        </div>
      )}
      <div>
        <Label htmlFor={`opr-ent-caixes-${i}`} className={ETIQUETA}>{t('canalz.interes_caixes')}</Label>
        <Input id={`opr-ent-caixes-${i}`} inputMode="numeric" value={fila.caixes} className="h-11 md:h-8"
          onChange={(e) => onCanvia('caixes', e.target.value)} />
      </div>
      <Button variant="ghost" size="icon" type="button" className="size-11 justify-self-end md:size-8"
        aria-label={t('opr.treu_entitat')} onClick={onTreu}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}

/** Una fila de destino final del sobrante: destino, kg y a quién. */
function FilaDesti({
  i, fila, cataleg, onCanvia, onTreu,
}: {
  i: number
  fila: FilaDestiOperacio
  cataleg: readonly DestiCataleg[]
  onCanvia: (camp: keyof FilaDestiOperacio, v: string) => void
  onTreu: () => void
}) {
  const { t, lang } = useT()
  return (
    <div data-testid="opr-desti"
      className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
      <div className="min-w-0">
        <Label htmlFor={`opr-desti-${i}`} className={ETIQUETA}>{t('desti.f_desti')}</Label>
        <Desplegable id={`opr-desti-${i}`} value={fila.desti} buit={t('desti.tria')}
          opcions={cataleg.map((c) => ({ valor: c.codi, text: lang === 'es' ? c.nom_es : c.nom_ca }))}
          onChange={(v) => onCanvia('desti', v)} />
      </div>
      <div>
        <Label htmlFor={`opr-desti-kg-${i}`} className={ETIQUETA}>{t('desti.f_kg')}</Label>
        <Input id={`opr-desti-kg-${i}`} inputMode="decimal" value={fila.kg} className="h-11 md:h-8"
          onChange={(e) => onCanvia('kg', e.target.value)} />
      </div>
      <div className="min-w-0">
        <Label htmlFor={`opr-desti-rec-${i}`} className={ETIQUETA}>{t('desti.f_receptor')}</Label>
        <Input id={`opr-desti-rec-${i}`} value={fila.receptor} maxLength={200} className="h-11 md:h-8"
          placeholder={t('desti.f_receptor_ph')} onChange={(e) => onCanvia('receptor', e.target.value)} />
      </div>
      <Button variant="ghost" size="icon" type="button" className="size-11 justify-self-end md:size-8"
        aria-label={t('desti.treu')} onClick={onTreu}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}

export default function DialegOperacioRealitzada({ obert, onTancar, onFet }: Props) {
  const { t, lang } = useT()
  const navega = useNavigate()
  const avui = avuiMadrid()
  const limits = limitsData(avui)
  const [form, setForm] = useState<FormOperacio>(() => formInicial(avui))
  const { productors, carregant } = useProductorsActius(obert)
  const { entitats, matriu, reglaNat } = useEntitatsAssignables(obert)
  /** El descriptor de la productora elegida: productos, lugares y subcausas. */
  const [cat, setCat] = useState<CatalogosOferta | null>(null)
  const [carregantCat, setCarregantCat] = useState(false)
  const [destinsCat, setDestinsCat] = useState<DestiCataleg[]>([])
  /** Tras el primer intento se enseña qué falta (antes, el formulario no riñe a medio rellenar). */
  const [intentat, setIntentat] = useState(false)
  const [enviant, setEnviant] = useState(false)
  const [errorServidor, setErrorServidor] = useState<string | null>(null)

  // Al cerrar, todo de cero: el siguiente registro no hereda nada del anterior.
  useEffect(() => {
    if (obert) return
    setForm(formInicial(avuiMadrid()))
    setCat(null)
    setIntentat(false)
    setErrorServidor(null)
  }, [obert])

  useEffect(() => {
    if (!obert) return
    let viu = true
    carregaCatalegDestins().then((c) => { if (viu) setDestinsCat(c) }).catch(() => { /* sin catálogo, sin destinos */ })
    return () => { viu = false }
  }, [obert])

  // El descriptor de la productora: el mismo que el alta (`crear-oferta/campos`).
  useEffect(() => {
    if (!obert || !form.productor) { setCat(null); return }
    let viu = true
    setCarregantCat(true)
    void carregaCamps(form.productor).then((r) => {
      if (!viu) return
      setCarregantCat(false)
      if (!r.ok || !r.data) { setCat(null); toast.error(textError(t, r.error)); return }
      const c = r.data.catalogos
      setCat(c)
      // El lugar: el principal (o el que propone la Operativa); si no hay, el que diga la base.
      const principal = c.ubicaciones.find((u) => u.es_principal)?.id
        ?? r.data.predeterminats?.ubicacio ?? c.ubicaciones[0]?.id ?? ''
      setForm((f) => ({ ...f, ubicacio: c.ubicaciones.some((u) => u.id === f.ubicacio) ? f.ubicacio : principal }))
    })
    return () => { viu = false }
  }, [obert, form.productor, t])

  const opcionsProductor = useMemo(
    () => productors.map((p) => ({ valor: p.id, text: p.nom, detall: p.poblacio ?? undefined })),
    [productors],
  )
  const opcionsProducte = useMemo(
    () => (cat?.productos ?? []).map((p) => ({
      valor: p.nombre, text: p.nombre, detall: p.familia ? etiquetaFamilia(p.familia, cat, lang) : undefined,
    })),
    [cat, lang],
  )
  const catalegCauses = useMemo(() => catalegDelDescriptor(cat?.causas), [cat])
  const opcionsCausa = useMemo(() => opcionsSubcausa(catalegCauses, lang), [catalegCauses, lang])
  const opcionsLloc = useMemo(
    () => (cat?.ubicaciones ?? []).map((u) => ({
      valor: u.id, text: [u.alias, u.municipio].filter(Boolean).join(' · ') || '—',
    })),
    [cat],
  )
  // Solo las entidades que pueden recibir la modalidad elegida (tipo y P8): las demás, la base las
  // rechazaría.
  const opcionsEntitat = useMemo(() => {
    const m = form.modalitat
    return entitats
      .filter((e) => !m || entitatAdmet(e, m, matriu, reglaNat))
      .map((e) => opcioFitxa({ id: e.id, nom: e.nombre, poblacio: e.poblacion, nif: e.nif, rao: e.razon_social }))
  }, [entitats, form.modalitat, matriu, reglaNat])

  const resum = resumKg(form)
  const error = errorOperacio(form, avui, horaMadrid())
  const venda = form.modalitat === 'venda'
  const espigolada = form.tipus === 'espigolada'

  const set = <K extends keyof FormOperacio>(camp: K, v: FormOperacio[K]) => {
    setErrorServidor(null)
    setForm((f) => ({ ...f, [camp]: v }))
  }
  function canviaProductor(id: string) {
    setErrorServidor(null)
    // Otra productora: otros lugares; el producto y la causa del catálogo siguen valiendo.
    setForm((f) => ({ ...f, productor: id, ubicacio: '' }))
  }
  function canviaModalitat(m: Modalitat | '') {
    setErrorServidor(null)
    setForm((f) => ({
      ...f,
      modalitat: m,
      // Una entidad que no puede recibir la nueva modalidad se vacía (la base la rechazaría).
      destinataris: f.destinataris.map((d) => {
        const e = entitats.find((x) => x.id === d.entitat)
        return e && m && !entitatAdmet(e, m, matriu, reglaNat) ? { ...d, entitat: '' } : d
      }),
    }))
  }
  function canviaTipus(v: string) {
    // La espigolada solo es donación (`espigolada_nomes_donacio`).
    if (v === 'espigolada') canviaModalitat('donacio')
    set('tipus', v === 'espigolada' ? 'espigolada' : 'excedent')
  }
  const canviaDestinatari = (i: number, camp: keyof FilaDestinatari, v: string) => {
    setErrorServidor(null)
    setForm((f) => ({ ...f, destinataris: f.destinataris.map((d, j) => (j === i ? { ...d, [camp]: v } : d)) }))
  }
  const canviaDesti = (i: number, camp: keyof FilaDestiOperacio, v: string) => {
    setErrorServidor(null)
    setForm((f) => ({ ...f, destins: f.destins.map((d, j) => (j === i ? { ...d, [camp]: v } : d)) }))
  }

  async function registra() {
    setIntentat(true)
    const err = errorOperacio(form, avuiMadrid(), horaMadrid())
    if (err) { toast.error(t(err), { id: TOAST_ERROR }); return }
    const prod = productors.find((p) => p.id === form.productor)
    const lloc = cat?.ubicaciones.find((u) => u.id === form.ubicacio)
    // El texto de «Comparteix»: el mismo compositor que el alta (`_shared/textOferta.ts`).
    const text = textOfertaOperacio(form, {
      productor: prod?.nom ?? '',
      municipi: lloc?.municipio ?? prod?.poblacio ?? '',
      mapsLloc: lloc?.gmaps_url ?? null,
      cataleg: catalegCauses,
    })
    setEnviant(true)
    const r = await registraOperacioRealitzada(argumentsOperacio(form, text))
    if (!r.ok) {
      let msg = textError(t, r)
      // A quién le falta el convenio: el genérico no dice de qué parte.
      if (r.missatge.includes('sense_conveni') && form.modalitat) {
        const parts: string[] = []
        for (const d of form.destinataris.filter((x) => x.entitat)) {
          const falta = await comprovaConvenis({ modalitat: form.modalitat, productor_id: form.productor }, d.entitat, t)
          const nom = entitats.find((e) => e.id === d.entitat)?.nombre
          if (falta && !parts.includes(falta)) parts.push(nom && falta.includes(t('od.conv_entity')) ? `${falta} (${nom})` : falta)
        }
        if (parts.length) msg = t('od.conv_missing', { parts: parts.join(' · ') })
      }
      setEnviant(false)
      setErrorServidor(msg)
      toast.error(msg, { id: TOAST_ERROR })
      return
    }
    setEnviant(false)
    const id = r.data.excedente_id
    toast.dismiss(TOAST_ERROR)
    toast.success(t('opr.ok', { id: r.data.id_excedente }), {
      duration: 10_000,
      action: { label: t('opr.obre'), onClick: () => navega(`/equip/ofertes/${id}`) },
    })
    onTancar()
    onFet?.(r.data)
  }

  const textQueden = resum.queden > 0
    ? t('opr.queden', { kg: nombre(resum.queden, 2) })
    : resum.queden < 0
      ? t('opr.sobren', { kg: nombre(-resum.queden, 2) })
      : t('opr.quadra')

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v && !enviant) onTancar() }}>
      {/* Sin cerrar al pinchar fuera, como el alta asistida: un clic despistado a media
          operación sería caro. */}
      <DialogContent
        className="flex max-h-[88dvh] flex-col gap-4 p-4 sm:p-6"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="dialeg-operacio-realitzada"
      >
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle className="text-left">{t('opr.titol')}</DialogTitle>
          <DialogDescription className="max-sm:sr-only">{t('opr.hint')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto pr-1">
          {/* 1. Quién y qué */}
          <section className="space-y-3">
            <TitolBloc>{t('opr.s_qui')}</TitolBloc>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <Label htmlFor="opr-productor" className={ETIQUETA}>{t('canalz.c_productor')}</Label>
                <CercadorOpcions id="opr-productor" name="productor" opcions={opcionsProductor}
                  valor={form.productor || null} onChange={canviaProductor}
                  placeholder={t('canalz.nova_cerca')} disabled={carregant}
                  invalid={intentat && !form.productor} />
              </div>
              <div className="min-w-0">
                <Label htmlFor="opr-producte" className={ETIQUETA}>{t('opr.f_producte')}</Label>
                <CercadorOpcions id="opr-producte" name="producte" opcions={opcionsProducte}
                  valor={form.producte || null} onChange={(v) => set('producte', v)}
                  placeholder={t(form.productor ? 'opr.f_producte_ph' : 'opr.tria_productor')}
                  disabled={!cat} invalid={intentat && !!form.productor && !form.producte} />
              </div>
              <div className="min-w-0">
                <Label htmlFor="opr-varietat" className={ETIQUETA}>
                  {t('opr.f_varietat')}<span className={OPCIONAL}>{t('po.optional')}</span>
                </Label>
                <Input id="opr-varietat" value={form.varietat} maxLength={120} className="h-11 md:h-8"
                  onChange={(e) => set('varietat', e.target.value)} />
              </div>
              <div className="min-w-0">
                <Label htmlFor="opr-lloc" className={ETIQUETA}>{t('opr.f_lloc')}</Label>
                {cat && opcionsLloc.length === 0
                  ? <p className="text-sm text-muted-foreground">{t('opr.lloc_cap')}</p>
                  : (
                    <Desplegable id="opr-lloc" value={form.ubicacio} opcions={opcionsLloc}
                      placeholder={t('desti.tria')} disabled={!cat} onChange={(v) => set('ubicacio', v)} />
                  )}
              </div>
              <div className="min-w-0 sm:col-span-2">
                <Label htmlFor="opr-subcausa" className={ETIQUETA}>
                  {t('opr.f_subcausa')}<span className={OPCIONAL}>{t('po.optional')}</span>
                </Label>
                <Desplegable id="opr-subcausa" value={form.subcausa} opcions={opcionsCausa}
                  buit={t('c.none')} disabled={!cat} onChange={(v) => set('subcausa', v)} />
              </div>
            </div>
            {carregantCat && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />{t('c.loading')}
              </p>
            )}
          </section>

          {/* 2. Cuándo y cuánto */}
          <section className="space-y-3">
            <TitolBloc>{t('opr.s_quan')}</TitolBloc>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="opr-kg" className={ETIQUETA}>{t('opr.f_kg')}</Label>
                <Input id="opr-kg" inputMode="decimal" value={form.kg} className="h-11 md:h-8"
                  aria-invalid={intentat && error === 'opr.err_kg'}
                  onChange={(e) => set('kg', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="opr-data" className={ETIQUETA}>{t('opr.f_data')}</Label>
                <Input id="opr-data" type="date" value={form.data} min={limits.min} max={limits.max}
                  className="h-11 md:h-8" onChange={(e) => set('data', e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">{t('opr.data_hint')}</p>
              </div>
              <div>
                <Label htmlFor="opr-hora" className={ETIQUETA}>
                  {t('opr.f_hora')}<span className={OPCIONAL}>{t('po.optional')}</span>
                </Label>
                <Input id="opr-hora" type="time" value={form.hora} className="h-11 md:h-8"
                  onChange={(e) => set('hora', e.target.value)} />
              </div>
            </div>
          </section>

          {/* 3. Qué operación */}
          <section className="space-y-3">
            <TitolBloc>{t('opr.s_operacio')}</TitolBloc>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p id="opr-tipus-l" className={cn(ETIQUETA, 'text-sm font-medium')}>{t('fl.d_tipus_operacio')}</p>
                <TriaSiNo id="opr-tipus" aria-labelledby="opr-tipus-l" valor={form.tipus} onChange={canviaTipus}
                  opcions={[
                    { valor: 'excedent', text: t('tipop.excedent') },
                    { valor: 'espigolada', text: t('tipop.espigolada') },
                  ]} />
              </div>
              <div className="min-w-0">
                <Label htmlFor="opr-modalitat" className={ETIQUETA}>{t('opr.f_modalitat')}</Label>
                {espigolada
                  ? <p className="text-sm">{t('od.mod_donacio')} <span className="text-muted-foreground">· {t('opr.espigolada_donacio')}</span></p>
                  : (
                    <SelectorModalitat id="opr-modalitat" name="modalitat" modalitats={MODALITATS}
                      valor={form.modalitat} onCanvi={canviaModalitat} className="w-full" />
                  )}
              </div>
            </div>
          </section>

          {/* 4. A qué entidades fue */}
          <section className="space-y-3">
            <TitolBloc>{t('opr.s_destinataris')}</TitolBloc>
            {form.modalitat && opcionsEntitat.length === 0 && entitats.length > 0 && (
              <p className="rounded-md bg-aviso-fondo p-2 text-sm text-aviso">{t('opr.sense_compat')}</p>
            )}
            {form.destinataris.map((d, i) => (
              <FilaEntitat key={i} i={i} fila={d} opcions={opcionsEntitat} venda={venda}
                onCanvia={(camp, v) => canviaDestinatari(i, camp, v)}
                onTreu={() => setForm((f) => ({
                  ...f,
                  destinataris: f.destinataris.length > 1
                    ? f.destinataris.filter((_, j) => j !== i) : [{ ...FILA_DESTINATARI_BUIDA }],
                }))} />
            ))}
            <Button variant="outline" type="button" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
              onClick={() => setForm((f) => ({ ...f, destinataris: [...f.destinataris, { ...FILA_DESTINATARI_BUIDA }] }))}>
              <Plus className="size-4" /> {t('opr.afegeix_entitat')}
            </Button>
          </section>

          {/* 5. Lo que sobró: destino final */}
          <section className="space-y-3">
            <TitolBloc>{t('opr.s_destins')}</TitolBloc>
            <p className="text-sm text-muted-foreground">{t('opr.destins_hint')}</p>
            {form.destins.map((d, i) => (
              <FilaDesti key={i} i={i} fila={d} cataleg={destinsCat}
                onCanvia={(camp, v) => canviaDesti(i, camp, v)}
                onTreu={() => setForm((f) => ({ ...f, destins: f.destins.filter((_, j) => j !== i) }))} />
            ))}
            <Button variant="outline" type="button" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
              onClick={() => setForm((f) => ({
                ...f,
                // Se propone lo que queda, que es lo que suele ir a un destino.
                destins: [...f.destins, { ...FILA_DESTI_BUIDA, kg: resum.queden > 0 ? String(resum.queden).replace('.', ',') : '' }],
              }))}>
              <Plus className="size-4" /> {t('opr.afegeix_desti')}
            </Button>
          </section>

          {/* 6. Observaciones */}
          <section className="space-y-1.5">
            <Label htmlFor="opr-obs" className={ETIQUETA}>
              {t('opr.f_observacions')}<span className={OPCIONAL}>{t('po.optional')}</span>
            </Label>
            <Textarea id="opr-obs" value={form.observacions} maxLength={MAX_OBSERVACIONS} rows={3}
              className="text-base md:text-sm" onChange={(e) => set('observacions', e.target.value)} />
          </section>
        </div>

        {/* El contador y lo que falta, siempre a la vista. */}
        <div className="shrink-0 space-y-1 border-t pt-3">
          {/* Sin kg recogidos todavía no hay nada que contar. */}
          {resum.total > 0 && (
            <p data-testid="opr-queden" className={cn('text-sm font-medium',
              resum.queden === 0 ? 'text-exito' : resum.queden < 0 ? 'text-error' : 'text-aviso')}>
              {textQueden}
            </p>
          )}
          {(errorServidor || (intentat && error)) && (
            <p role="alert" data-testid="opr-error" className="text-sm text-error">{errorServidor ?? t(error!)}</p>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="ghost" type="button" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
            disabled={enviant} onClick={onTancar}>
            {t('c.cancel')}
          </Button>
          <Button type="button" className="h-11 w-full whitespace-normal sm:w-auto md:h-8" disabled={enviant}
            data-testid="opr-registra" onClick={() => void registra()}>
            {enviant && <Loader2 className="size-4 animate-spin" />}
            {t('opr.registra')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
