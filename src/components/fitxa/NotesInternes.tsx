// El CRM en el bloque «Gestió interna» de la ficha del equipo (plan 1, 1F, D4; completado el
// 04-11-2026 con la Taula mestra 1.5): cada interacción con fecha, canal, tipo, responsable y
// comentario, y si hace falta la próxima acción con su fecha. Arriba, la última interacción y
// los seguimientos pendientes (con «Fet»); después el formulario y el hilo, lo último arriba.
// Sin edición: una nota se corrige escribiendo otra; lo único que cambia después es que su
// seguimiento se da por hecho (`tancar_seguiment()`). Borrar es del super_admin.
//
// Solo se monta en `EntitatDetall` (rutas del equipo). La tabla la protege la RLS
// (`es_intern()`), no esta pantalla: la ficha del actor no la pinta y, si la pidiera, le
// llegarían 0 filas. 🔴 Nada de aquí sale por ningún canal (AGENTS §8).
//
// Proceso 1.2 (25-11-2026): el formulario vive en `FormulariInteraccio` (lo comparte con la
// sección `/equip/interaccions`, que lee estas mismas filas); «Fet» pide el RESULTADO
// (`DialegSeguimentFet`) y el hilo enseña el resultado y la previsión de producto de cada nota.

import { useCallback, useEffect, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { avuiLocal, dataCurta, dataHora, kg } from '../../lib/format'
import { textDia } from '../../lib/sortides'
import { estatSeguiment, faTemps, type CanalNota, type TipusNotaLlegit } from '../../lib/notesInternes'
import { useMembresEquip } from '../../hooks/useMembresEquip'
import { useConfirma } from '../DialegConfirma'
import FormulariInteraccio from './FormulariInteraccio'
import DialegSeguimentFet, { type SeguimentPerTancar } from './DialegSeguimentFet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// ⚠️ Una sola lista de columnas, en un literal (§7). `ubicacio` es el lugar de la ficha de la
//    previsión (FK `previsio_ubicacio_id`, 20270616100000).
const COLS = 'id, data, canal, tipus, text, created_at, responsable, propera_accio, propera_data, seguiment_fet_at, resultat, previsio_producte, previsio_kg, previsio_data, previsio_ubicacio, autor:perfiles(id, nombre, email), ubicacio:productor_ubicaciones(alias, municipio)'

interface Nota {
  id: string
  data: string
  canal: CanalNota
  tipus: TipusNotaLlegit
  text: string
  created_at: string
  responsable: string | null
  propera_accio: string | null
  propera_data: string | null
  seguiment_fet_at: string | null
  resultat: string | null
  previsio_producte: string | null
  previsio_kg: number | string | null
  previsio_data: string | null
  previsio_ubicacio: string | null
  autor: { id: string; nombre: string | null; email: string | null } | null
  ubicacio: { alias: string | null; municipio: string | null } | null
}

/** El color de la fecha de un seguimiento, según cómo va. */
const COLOR_SEGUIMENT: Record<ReturnType<typeof estatSeguiment>, string> = {
  vencut: 'bg-error-fondo text-error',
  avui: 'bg-aviso-fondo text-aviso',
  previst: 'bg-muted text-muted-foreground',
  fet: 'bg-exito-fondo text-exito',
}

/** El lugar de una previsión: el de la ficha (alias o municipio) o el texto libre. */
function llocPrevisio(n: Nota): string | null {
  return n.ubicacio?.alias?.trim() || n.ubicacio?.municipio?.trim() || n.previsio_ubicacio?.trim() || null
}

export default function NotesInternes({ orgId, potEsborrar, onCanviat, onCompte }: {
  orgId: string
  /** Solo el super_admin borra (la RPC lo vuelve a comprobar). */
  potEsborrar: boolean
  onCanviat?: () => void
  /** Cuántas notas hay, para el contador de la pestaña de la ficha. */
  onCompte?: (n: number) => void
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const { nomDe } = useMembresEquip()
  const [notes, setNotes] = useState<Nota[] | null>(null)
  const [errCarrega, setErrCarrega] = useState(false)
  const [perTancar, setPerTancar] = useState<SeguimentPerTancar | null>(null)
  const avui = avuiLocal()

  const carrega = useCallback(async () => {
    const { data, error } = await supabase.from('notes_internes').select(COLS)
      .eq('organizacion_id', orgId)
      .order('data', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) { setErrCarrega(true); return }
    setErrCarrega(false)
    setNotes((data ?? []) as unknown as Nota[])
    onCompte?.((data ?? []).length)
  }, [orgId, onCompte])
  useEffect(() => { void carrega() }, [carrega])

  async function desada() {
    await carrega()
    onCanviat?.()
  }

  async function esborra(n: Nota) {
    if (!(await confirma({
      titol: t('ni.confirm_t'),
      descripcio: t('ni.confirm_d'),
      confirmar: t('ni.esborrar'),
      destructiu: true,
    }))) return
    const { error } = await supabase.rpc('esborrar_nota_interna', { p_id: n.id })
    if (error) { toast.error(textError(t, error.message)); return }
    toast.success(t('ni.ok_esborrada'))
    await carrega()
    onCanviat?.()
  }

  const pendents = (notes ?? [])
    .filter((n) => n.propera_accio && n.propera_data && !n.seguiment_fet_at)
    .sort((a, b) => (a.propera_data! < b.propera_data! ? -1 : a.propera_data! > b.propera_data! ? 1 : 0))
  const darrera = notes?.[0] ?? null

  /** «12/11/2026» con el color de cómo va. */
  function dataSeguiment(n: Nota) {
    const estat = estatSeguiment(n.propera_data!, avui, Boolean(n.seguiment_fet_at))
    return (
      <Badge className={COLOR_SEGUIMENT[estat]} data-testid="seguiment-estat" data-estat={estat}>
        {dataCurta(`${n.propera_data}T12:00:00`)}{estat === 'previst' ? '' : ` · ${t(`ni.seg_${estat}`)}`}
      </Badge>
    )
  }

  return (
    <div className="space-y-5" data-testid="notes-internes">
      <div>
        <h3 className="text-base font-semibold">{t('ni.titol')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('ni.ajuda')}</p>
      </div>

      {/* Lo que pide 1.5 a la vista: la última interacción y lo que queda por hacer. */}
      {notes && notes.length > 0 && (
        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3" data-testid="crm-resum">
          {darrera && (
            <p className="text-sm" data-testid="darrera-interaccio">
              <span className="font-medium">{t('ni.darrera')}: </span>
              {[t(faTemps(darrera.data).clau, { n: faTemps(darrera.data).n }), t(`ni.canal_${darrera.canal}`), t(`ni.tipus_${darrera.tipus}`)].join(' · ')}
            </p>
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t('ni.pendents')} <span className="tabular-nums text-muted-foreground">({pendents.length})</span>
            </p>
            {pendents.length === 0 && <p className="text-sm text-muted-foreground">{t('ni.cap_pendent')}</p>}
            {pendents.length > 0 && (
              <ul className="space-y-2" data-testid="seguiments-pendents">
                {pendents.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-2" data-testid="seguiment">
                    {dataSeguiment(n)}
                    <span className="min-w-0 flex-1 basis-48 text-sm wrap-anywhere">{n.propera_accio}</span>
                    {n.responsable && <span className="text-xs text-muted-foreground">{nomDe.get(n.responsable) ?? t('ni.autor_desconegut')}</span>}
                    <Button variant="outline" className="h-11 md:h-8" onClick={() => setPerTancar({ id: n.id, propera_accio: n.propera_accio })}>
                      <Check className="size-4" aria-hidden /> {t('ni.fet')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <FormulariInteraccio orgId={orgId} onDesat={() => void desada()} />

      {errCarrega && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
      {notes && notes.length === 0 && <p className="text-sm text-muted-foreground">{t('ni.buit')}</p>}
      {notes && notes.length > 0 && (
        <ul className="space-y-3" data-testid="notes-fil">
          {notes.map((n) => {
            const fa = faTemps(n.data)
            const autor = n.autor?.nombre?.trim() || n.autor?.email || t('ni.autor_desconegut')
            const resp = n.responsable ? nomDe.get(n.responsable) : undefined
            return (
              <li key={n.id} className="flex items-start gap-2 rounded-md border border-border p-3" data-testid="nota">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" data-testid="nota-tipus">{t(`ni.tipus_${n.tipus}`)}</Badge>
                    <p className="text-xs text-muted-foreground" title={dataHora(n.data)} data-testid="nota-cap">
                      {[t(fa.clau, { n: fa.n }), t(`ni.canal_${n.canal}`), autor].join(' · ')}
                    </p>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{n.text}</p>
                  {resp && n.responsable !== n.autor?.id && (
                    <p className="text-xs text-muted-foreground">{t('ni.responsable')}: {resp}</p>
                  )}
                  {n.propera_accio && n.propera_data && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-sm" data-testid="nota-seguiment">
                      <span className="font-medium">{t('ni.propera_accio')}:</span>
                      <span className="min-w-0 wrap-anywhere">{n.propera_accio}</span>
                      {dataSeguiment(n)}
                    </div>
                  )}
                  {n.resultat && (
                    <p className="text-sm" data-testid="nota-resultat">
                      <span className="font-medium">{t('ni.resultat')}:</span>{' '}
                      <span className="whitespace-pre-wrap break-words">{n.resultat}</span>
                    </p>
                  )}
                  {n.previsio_producte && (
                    <p className="text-sm" data-testid="nota-previsio">
                      <span className="font-medium">{t('ni.previsio')}:</span>{' '}
                      <span className="break-words">
                        {[n.previsio_producte, `${kg(n.previsio_kg)} kg`, textDia(n.previsio_data), llocPrevisio(n)].filter(Boolean).join(' · ')}
                      </span>
                    </p>
                  )}
                </div>
                {potEsborrar && (
                  <Button variant="ghost" size="icon" aria-label={t('ni.esborrar')} title={t('ni.esborrar')}
                    className="text-destructive" onClick={() => void esborra(n)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <DialegSeguimentFet seguiment={perTancar} onTanca={() => setPerTancar(null)} onFet={() => void desada()} />
      {dialeg}
    </div>
  )
}
