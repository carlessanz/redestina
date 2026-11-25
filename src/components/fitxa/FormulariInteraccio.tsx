// El formulario de una INTERACCIÓN del CRM (proceso 1.2, «Interaccions i seguiment», 25-11-2026).
//
// Extraído de `NotesInternes` (1F + 1.5), que lo tenía en su estado local, para usarlo en dos
// sitios con las mismas reglas:
//   · la ficha de la entidad (pestaña «Gestió interna»): la entidad es FIJA (`orgId`);
//   · la sección `/equip/interaccions`, dentro del diálogo «Afegir interacció»: la entidad se
//     ELIGE con el buscador predictivo (`SelectorEntitat`).
//
// Campos: tipo, canal, fecha del contacto, responsable, comentario, próximo paso con su fecha de
// seguimiento (los dos o ninguno: lo exige la base) y un bloque plegable «Previsió de producte»
// (producto del catálogo con buscador, kg aproximados, fecha prevista y lugar: uno de los lugares
// de recogida de la entidad o texto libre). 🔴 Una previsión NO crea oferta: es una nota del
// equipo y, como toda nota interna, no sale por ningún canal (AGENTS §8).
//
// Escribe por `afegir_nota_interna()` (20270616100000); la RPC vuelve a validar todo.

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { avuiLocal } from '../../lib/format'
import { carregaCataleg, type ProducteCataleg } from '../../lib/fotosProducte'
import { opcioFitxa, type OpcioSelector } from '../../lib/opcionsSelector'
import {
  CANALS_NOTA, MAX_ACCIO, MAX_PREVISIO_UBICACIO, MAX_TEXT_NOTA, TIPUS_NOTA, TIPUS_PER_DEFECTE,
  dataPerEnviar, previsioPerEnviar, seguimentPerEnviar, textValid,
  type CanalNota, type ErrorPrevisio, type TipusNota,
} from '../../lib/notesInternes'
import { useSessio } from '../../hooks/useSessio'
import { useMembresEquip } from '../../hooks/useMembresEquip'
import Desplegable from '../Desplegable'
import SelectorEntitat from '../SelectorEntitat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/** El valor del desplegable de lugar que pide el texto libre. */
const ALTRE_LLOC = '__altre__'

const CLAU_ERROR_PREVISIO: Record<ErrorPrevisio, string> = {
  incompleta: 'ni.err_previsio_incompleta',
  kg: 'ni.err_kg',
  ubicacio_llarga: 'ni.err_lloc_llarg',
}

interface Lloc { id: string; alias: string | null; municipio: string | null }

interface Props {
  /** La entidad fija (la ficha). Sin ella, se elige con el buscador (la sección). */
  orgId?: string
  /** El prefijo de los `id` de los campos (`nota-tipus`, `nota-text`…). Por defecto, `nota`. */
  idPrefix?: string
  /** Tras guardar (la interacción ya está en la base). */
  onDesat: (orgId: string) => void
  /** Con él, un botón «Cancel·la» al lado del de guardar (el diálogo). */
  onCancel?: () => void
  /** Dos columnas como mucho (el diálogo); sin él, cuatro desde `lg` (la ficha). */
  estret?: boolean
}

export default function FormulariInteraccio({ orgId, idPrefix = 'nota', onDesat, onCancel, estret }: Props) {
  const { t } = useT()
  const { session } = useSessio()
  const jo = session?.user.id ?? ''
  const { membres } = useMembresEquip()
  const avui = avuiLocal()
  const id = (s: string) => `${idPrefix}-${s}`

  // --- La entidad: fija o elegida -----------------------------------------------------------
  const [orgTriada, setOrgTriada] = useState('')
  const org = orgId ?? orgTriada
  const [opcionsOrg, setOpcionsOrg] = useState<OpcioSelector[]>([])
  useEffect(() => {
    if (orgId) return
    let viu = true
    void supabase.from('v_organizaciones').select('id, nombre, nif, razon_social, poblacion').order('nombre')
      .then(({ data }) => {
        if (!viu) return
        setOpcionsOrg(((data ?? []) as { id: string; nombre: string | null; nif: string | null; razon_social: string | null; poblacion: string | null }[])
          .map((o) => opcioFitxa({ id: o.id, nom: o.nombre, poblacio: o.poblacion, nif: o.nif, rao: o.razon_social })))
      })
    return () => { viu = false }
  }, [orgId])

  // --- La interacción ----------------------------------------------------------------------
  const [tipus, setTipus] = useState<TipusNota>(TIPUS_PER_DEFECTE)
  const [canal, setCanal] = useState<CanalNota>('telefon')
  const [dia, setDia] = useState(avui)
  const [responsable, setResponsable] = useState('')
  const [text, setText] = useState('')
  const [accio, setAccio] = useState('')
  const [diaAccio, setDiaAccio] = useState('')
  const respTriat = responsable || jo

  // --- La previsión (plegable) -------------------------------------------------------------
  const [ambPrevisio, setAmbPrevisio] = useState(false)
  const [producte, setProducte] = useState('')
  const [kgText, setKgText] = useState('')
  const [diaPrevist, setDiaPrevist] = useState('')
  const [lloc, setLloc] = useState('')
  const [llocText, setLlocText] = useState('')
  const [cataleg, setCataleg] = useState<ProducteCataleg[]>([])
  const [llocs, setLlocs] = useState<Lloc[]>([])

  // El catálogo, solo al abrir la previsión (una vez por sesión, `carregaCataleg`).
  useEffect(() => {
    if (!ambPrevisio) return
    let viu = true
    void carregaCataleg().then((m) => { if (viu) setCataleg([...m.values()]) })
    return () => { viu = false }
  }, [ambPrevisio])
  const opcionsProducte = useMemo(
    () => cataleg.map((p) => ({ valor: p.nombre, text: p.nombre, ...(p.familia ? { detall: p.familia } : {}) })),
    [cataleg],
  )

  // Los lugares de recogida de la entidad: los de sus fichas de productor (una por organización).
  useEffect(() => {
    if (!ambPrevisio || !org) return
    let viu = true
    void (async () => {
      const { data: prods } = await supabase.from('productores').select('id').eq('organizacion_id', org)
      const ids = ((prods ?? []) as { id: string }[]).map((p) => p.id)
      if (ids.length === 0) { if (viu) setLlocs([]); return }
      const { data } = await supabase.from('productor_ubicaciones').select('id, alias, municipio')
        .in('productor_id', ids).order('es_principal', { ascending: false })
      if (viu) setLlocs((data ?? []) as Lloc[])
    })()
    return () => { viu = false }
  }, [ambPrevisio, org])
  // Otra entidad: el lugar elegido ya no es suyo.
  const [orgDelLloc, setOrgDelLloc] = useState(org)
  if (orgDelLloc !== org) {
    setOrgDelLloc(org)
    setLloc('')
    setLlocs([])
  }
  const opcionsLloc = useMemo(() => [
    ...llocs.map((l) => ({ valor: l.id, text: [l.alias, l.municipio].filter(Boolean).join(' · ') || '—' })),
    { valor: ALTRE_LLOC, text: t('ni.previsio_altre_lloc') },
  ], [llocs, t])
  // Sin lugares en la ficha, directamente el texto libre.
  const ambText = lloc === ALTRE_LLOC || llocs.length === 0

  const [ocupat, setOcupat] = useState(false)
  const [errorOrg, setErrorOrg] = useState(false)

  function buida() {
    setText('')
    setAccio('')
    setDiaAccio('')
    setDia(avuiLocal())
    setProducte('')
    setKgText('')
    setDiaPrevist('')
    setLloc('')
    setLlocText('')
    setAmbPrevisio(false)
  }

  async function desa(e: React.FormEvent) {
    e.preventDefault()
    if (!org) { setErrorOrg(true); toast.error(t('ni.err_cal_entitat')); return }
    if (!textValid(text)) return
    const seg = seguimentPerEnviar(accio, diaAccio)
    if (seg === 'incompleta') { toast.error(t('ni.err_seguiment_incomplet')); return }
    const prev = ambPrevisio
      ? previsioPerEnviar({
        producte, kg: kgText, data: diaPrevist,
        ubicacioId: lloc && lloc !== ALTRE_LLOC ? lloc : '',
        ubicacioText: ambText ? llocText : '',
      })
      : null
    if (typeof prev === 'string') { toast.error(t(CLAU_ERROR_PREVISIO[prev], { n: MAX_PREVISIO_UBICACIO })); return }
    setOcupat(true)
    // Hoy no se manda `p_data`: la RPC pone `now()` y el orden del día es el de escritura.
    const pData = dataPerEnviar(dia, avuiLocal())
    try {
      const { error } = await supabase.rpc('afegir_nota_interna', {
        p_org: org,
        p_canal: canal,
        p_text: text.trim(),
        p_tipus: tipus,
        ...(respTriat ? { p_responsable: respTriat } : {}),
        ...(pData ? { p_data: pData } : {}),
        ...(seg ? { p_propera_accio: seg.accio, p_propera_data: seg.data } : {}),
        ...(prev ?? {}),
      })
      if (error) { toast.error(textError(t, error.message)); return }
    } catch (err) {
      toast.error(textError(t, err instanceof Error ? err.message : String(err)))
      return
    } finally {
      setOcupat(false)
    }
    buida()
    toast.success(t('ni.ok_afegida'))
    onDesat(org)
  }

  const massaLlarg = text.trim().length > MAX_TEXT_NOTA
  const llocMassaLlarg = llocText.trim().length > MAX_PREVISIO_UBICACIO
  // Columnas: dos en el diálogo; cuatro desde `lg` en la ficha.
  const tota = estret ? 'sm:col-span-2' : 'sm:col-span-2 lg:col-span-4'

  return (
    <form onSubmit={(e) => void desa(e)} noValidate
      className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', !estret && 'lg:grid-cols-4')} data-testid="nota-form">
      {!orgId && (
        <div className={cn('space-y-1.5', tota)}>
          <Label htmlFor={id('org')}>{t('ni.entitat')}</Label>
          <SelectorEntitat id={id('org')} opcions={opcionsOrg} valor={orgTriada} invalid={errorOrg}
            onChange={(v) => { setOrgTriada(v); setErrorOrg(false) }} data-testid="nota-org" />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={id('tipus')}>{t('ni.tipus')}</Label>
        <Desplegable id={id('tipus')} value={tipus} onChange={(v) => setTipus(v as TipusNota)}
          opcions={TIPUS_NOTA.map((c) => ({ valor: c, text: t(`ni.tipus_${c}`) }))} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('canal')}>{t('ni.canal')}</Label>
        <Desplegable id={id('canal')} value={canal} onChange={(v) => setCanal(v as CanalNota)}
          opcions={CANALS_NOTA.map((c) => ({ valor: c, text: t(`ni.canal_${c}`) }))} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('data')}>{t('ni.data')}</Label>
        <Input id={id('data')} type="date" value={dia} max={avui} onChange={(e) => setDia(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('responsable')}>{t('ni.responsable')}</Label>
        <Desplegable id={id('responsable')} value={respTriat} onChange={setResponsable} disabled={membres.length === 0}
          placeholder="—" opcions={membres.map((m) => ({ valor: m.id, text: m.nom }))} />
      </div>
      <div className={cn('space-y-1.5', tota)}>
        <Label htmlFor={id('text')}>{t('ni.text')}</Label>
        <Textarea id={id('text')} rows={2} placeholder={t('ni.placeholder')} value={text}
          onChange={(e) => setText(e.target.value)} aria-invalid={massaLlarg} />
        {massaLlarg && <p className="text-xs text-error">{t('ni.err_llarg', { n: MAX_TEXT_NOTA })}</p>}
      </div>
      <div className={cn('space-y-1.5', estret ? '' : 'sm:col-span-2 lg:col-span-3')}>
        <Label htmlFor={id('accio')}>{t('ni.propera_accio')}</Label>
        <Input id={id('accio')} placeholder={t('ni.propera_placeholder')} value={accio} maxLength={MAX_ACCIO}
          onChange={(e) => setAccio(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('accio-data')}>{t('ni.propera_data')}</Label>
        <Input id={id('accio-data')} type="date" value={diaAccio} min={avui} onChange={(e) => setDiaAccio(e.target.value)} />
      </div>

      {/* La previsión de producto, plegada: la mayoría de interacciones no la llevan. */}
      <div className={cn('space-y-3 rounded-md border border-border bg-background p-3', tota)} data-testid="nota-previsio">
        <Button type="button" variant="ghost" className="h-11 w-full justify-between px-1 whitespace-normal md:h-8"
          aria-expanded={ambPrevisio} aria-controls={id('previsio-camps')} onClick={() => setAmbPrevisio((v) => !v)}>
          <span className="text-left font-medium">{t('ni.previsio_titol')}</span>
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', ambPrevisio && 'rotate-180')} aria-hidden />
        </Button>
        {ambPrevisio && (
          <div id={id('previsio-camps')} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <p className="text-xs text-muted-foreground sm:col-span-2">{t('ni.previsio_ajuda')}</p>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={id('producte')}>{t('ni.previsio_producte')}</Label>
              <SelectorEntitat id={id('producte')} opcions={opcionsProducte} valor={producte} onChange={setProducte}
                buit={t('c.none')} data-testid="nota-producte" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id('kg')}>{t('ni.previsio_kg')}</Label>
              <Input id={id('kg')} inputMode="decimal" value={kgText} onChange={(e) => setKgText(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id('previsio-data')}>{t('ni.previsio_data')}</Label>
              <Input id={id('previsio-data')} type="date" value={diaPrevist} onChange={(e) => setDiaPrevist(e.target.value)} />
            </div>
            {llocs.length > 0 && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={id('lloc')}>{t('ni.previsio_ubicacio')}</Label>
                <Desplegable id={id('lloc')} value={lloc} onChange={setLloc} buit={t('c.none')} opcions={opcionsLloc} />
              </div>
            )}
            {ambText && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={id('lloc-text')}>{llocs.length > 0 ? t('ni.previsio_altre_lloc') : t('ni.previsio_ubicacio')}</Label>
                <Input id={id('lloc-text')} placeholder={t('ni.previsio_lloc_ph')} value={llocText}
                  onChange={(e) => setLlocText(e.target.value)} aria-invalid={llocMassaLlarg} />
                {llocMassaLlarg && <p className="text-xs text-error">{t('ni.err_llarg', { n: MAX_PREVISIO_UBICACIO })}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={cn('flex flex-wrap gap-2', estret ? 'justify-end' : '', tota)}>
        {onCancel && (
          <Button type="button" variant="outline" className="h-11 md:h-8" onClick={onCancel} disabled={ocupat}>
            {t('c.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={ocupat || !textValid(text)} className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
          data-testid="nota-desa">
          {ocupat ? t('c.saving') : t('ni.afegir')}
        </Button>
      </div>
    </form>
  )
}
