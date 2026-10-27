// «Dona'l per vigent»: el convenio DECLARADO (gestión autónoma, fase 1; 20270430100000).
//
// POR QUÉ EXISTE. Con las notificaciones apagadas y una importación masiva por delante, el
// equipo tiene que poder llevar el ciclo entero en nombre de las organizaciones. Hasta aquí
// un convenio solo llegaba a `vigent` con alguien delante (firma por enlace, firma asistida
// con DNI y trazo) o con un papel escaneado. Esto lo da por vigente con los datos de la
// ficha, sin firma ni escaneado — y lo DICE: el PDF sale numerado en su serie, igual que uno
// firmado, con una página de evidencias que afirma que fue declarado, por quién y cuándo.
//
// ⚠️ Solo el super_admin: decide si una organización opera sin haber firmado nada. La base
//    lo impone (`42501 no_autoritzat`); aquí el botón se deja gris con el motivo.
// ⚠️ Consume número de serie (al revés que el papel) y, si el correo está encendido, el PDF
//    sale por correo a la organización: no se deshace. Por eso el aviso fijo.
// ⚠️ Se puede sustituir después por uno firmado: la organización lo firma desde su panel y la
//    contrafirma deja el declarado `substituit` (`conveni_cobreix_tot` no lo cuenta).
//
// Molde de `DialegConveniPaper`: 80 vw × 88 vh y no se cierra al pinchar fuera.

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { avuiLocal } from '../../lib/format'
import { declararConveni } from '../../lib/convenis'
import { refrescaAvisos } from '../../lib/refrescAvisos'
import {
  clauCampFitxa, LIMITS_DECLARAT, textSignantValid, tipusConveniDeclarat,
} from '../../lib/conveniDeclarat'
import type { ErrorDeclarat } from '../../lib/conveniDeclarat'
import { useAppContext } from '../../hooks/useAppContext'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  obert: boolean
  tipusOrg: 'productor' | 'entidad'
  orgId: string
  nom?: string | null
  onTancar: () => void
  /** Solo cuando el convenio ha quedado vigente de verdad. */
  onFet?: () => void
}

/** Lo que se precarga de la ficha: quién firmaría y si le faltan datos que la RPC exige. */
interface Precarrega { signant: string; carrec: string; falten: string[] }

/**
 * Quién firma y con qué cargo. La ficha no guarda el cargo, así que se toma del último
 * convenio de esa organización que tenga firmante (lo que ya dijo una vez); si no hay, la
 * persona de contacto de la ficha (`productores.name` / `entidades.contacto`) y el cargo vacío.
 * Y de paso, si faltan el NIF o el domicilio: se avisa ANTES de enviar.
 */
async function precarrega(tipusOrg: 'productor' | 'entidad', orgId: string): Promise<Precarrega> {
  const columna = tipusOrg === 'productor' ? 'productor_id' : 'entidad_id'
  const [fitxa, conv] = await Promise.all([
    tipusOrg === 'productor'
      ? supabase.from('productores').select('name, nif, direccion').eq('id', orgId).maybeSingle()
      : supabase.from('entidades').select('contacto, nif, direccion').eq('id', orgId).maybeSingle(),
    supabase.from('convenios').select('firmante, created_at').eq(columna, orgId)
      .not('firmante', 'is', null).order('created_at', { ascending: false }).limit(1),
  ])
  const f = fitxa.data as { name?: string | null; contacto?: string | null; nif: string | null; direccion: string | null } | null
  const firmant = (conv.data?.[0] as { firmante?: { nombre?: string; cargo?: string } | null } | undefined)?.firmante ?? null
  const falten: string[] = []
  // Solo si la ficha se ha podido leer: sin ella no se afirma que falte nada (decide la base).
  if (f) {
    if (!f.nif?.trim()) falten.push('nif')
    if (!f.direccion?.trim()) falten.push('domicili')
  }
  return {
    signant: firmant?.nombre ?? (tipusOrg === 'productor' ? f?.name : f?.contacto) ?? '',
    carrec: firmant?.cargo ?? '',
    falten,
  }
}

export default function DialegConveniDeclarat({ obert, tipusOrg, orgId, nom, onTancar, onFet }: Props) {
  const { t } = useT()
  const { ctx } = useAppContext()
  // Fail-cerrado mientras el contexto no llega: la base decide igual.
  const esSuperAdmin = ctx?.esSuperAdmin ?? false
  const [signant, setSignant] = useState('')
  const [carrec, setCarrec] = useState('')
  const [dataFirma, setDataFirma] = useState(avuiLocal())
  const [referencia, setReferencia] = useState('')
  const [notes, setNotes] = useState('')
  const [faltenFitxa, setFaltenFitxa] = useState<string[]>([])
  const [ocupat, setOcupat] = useState(false)
  const [error, setError] = useState<ErrorDeclarat | null>(null)

  // Cada apertura empieza con lo de la ficha, no con lo tecleado la vez anterior.
  useEffect(() => {
    if (!obert) return
    let viu = true
    setError(null); setOcupat(false); setReferencia(''); setNotes(''); setDataFirma(avuiLocal())
    setSignant(''); setCarrec(''); setFaltenFitxa([])
    void precarrega(tipusOrg, orgId).then((p) => {
      if (!viu) return
      setSignant(p.signant); setCarrec(p.carrec); setFaltenFitxa(p.falten)
    })
    return () => { viu = false }
  }, [obert, tipusOrg, orgId])

  const rutaFitxa = tipusOrg === 'productor' ? `/equip/productors/${orgId}` : `/equip/entitats/${orgId}`
  const falten = error?.codi === 'falta_dades_fitxa' ? error.camps : faltenFitxa
  const complet = textSignantValid(signant) && textSignantValid(carrec) && dataFirma !== ''
    && referencia.length <= LIMITS_DECLARAT.referenciaMax && notes.length <= LIMITS_DECLARAT.notesMax
  const motiu = !esSuperAdmin ? t('cdecl.need_super')
    : falten.length > 0 ? t('cdecl.err_falta_dades_fitxa')
      : !complet ? t('cdecl.need_fields') : undefined

  async function declara() {
    if (ocupat) return
    setError(null)
    setOcupat(true)
    const r = await declararConveni({
      tipusOrg, org: orgId, signantNom: signant, signantCarrec: carrec,
      dataFirma, referencia, notes,
    })
    setOcupat(false)
    if (!r.ok) { setError(r.error); return }
    toast.success(t('cdecl.done', { num: r.conveni.numero_completo ?? '—' }))
    refrescaAvisos()
    onFet?.()
    onTancar()
  }

  /** Un campo de la ficha que falta, con su nombre traducido (o tal cual si no se conoce). */
  const nomCamp = (c: string) => { const k = clauCampFitxa(c); return k ? t(k) : c }

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v && !ocupat) onTancar() }}>
      <DialogContent
        className="flex h-[88dvh] w-[80vw] max-w-none flex-col gap-4 p-6 sm:max-w-none"
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('cdecl.title')}{nom ? ` · ${nom}` : ''}</DialogTitle>
          <DialogDescription>{t('cdecl.desc')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {/* El aviso fijo: lo que este acto es y lo que no. En tono aviso, no rojo: no es
              un error, es una decisión que se toma sabiendo lo que cuesta. */}
          <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('cdecl.avis')}</p>

          {falten.length > 0 && (
            <div className="rounded-md bg-error-fondo p-3 text-sm text-error">
              <p>{t('cdecl.falten', { camps: falten.map(nomCamp).join(', ') })}</p>
              <Link to={rutaFitxa} className="mt-1 inline-block font-medium underline" onClick={onTancar}>
                {t('cdecl.completa_fitxa')}
              </Link>
            </div>
          )}
          {error && error.codi !== 'falta_dades_fitxa' && (
            <p className="rounded-md bg-error-fondo p-3 text-sm text-error">{t(error.clau)}</p>
          )}

          {/* `grid-cols-1` explícito (§2, regla 5). */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-xs text-muted-foreground">{t('conv.paper_model')}</p>
              {/* El tipo no se elige: el de col·laboració de su papel es el único que la base
                  declara (`tipus_desconegut` para cualquier otro). */}
              <p className="text-sm font-medium">{t(`sig.model_${tipusConveniDeclarat(tipusOrg)}`)}</p>
            </div>

            <div>
              <Label htmlFor="cdecl-signant" className="mb-1.5 block text-xs text-muted-foreground">
                {t('cdecl.signant')}
              </Label>
              <Input id="cdecl-signant" name="signant_nom" type="text" maxLength={LIMITS_DECLARAT.signantMax}
                value={signant} onChange={(e) => setSignant(e.target.value)} />
            </div>

            <div>
              <Label htmlFor="cdecl-carrec" className="mb-1.5 block text-xs text-muted-foreground">
                {t('cdecl.carrec')}
              </Label>
              <Input id="cdecl-carrec" name="signant_carrec" type="text" maxLength={LIMITS_DECLARAT.signantMax}
                value={carrec} onChange={(e) => setCarrec(e.target.value)} />
            </div>

            <div>
              <Label htmlFor="cdecl-data" className="mb-1.5 block text-xs text-muted-foreground">
                {t('cdecl.data')}
              </Label>
              {/* `max` = hoy: la base rechaza una fecha futura (`data_futura`). */}
              <Input id="cdecl-data" name="data_firma" type="date" max={avuiLocal()}
                value={dataFirma} onChange={(e) => setDataFirma(e.target.value)} />
            </div>

            <div>
              <Label htmlFor="cdecl-ref" className="mb-1.5 block text-xs text-muted-foreground">
                {t('cdecl.referencia')}
              </Label>
              <Input id="cdecl-ref" name="referencia" type="text" maxLength={LIMITS_DECLARAT.referenciaMax}
                value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="cdecl-notes" className="mb-1.5 block text-xs text-muted-foreground">
                {t('conv.paper_notes')}
              </Label>
              <Textarea id="cdecl-notes" name="notes" rows={3} maxLength={LIMITS_DECLARAT.notesMax}
                value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
            disabled={ocupat} onClick={onTancar}>
            {t('c.cancel')}
          </Button>
          <BotoAmbMotiu
            className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
            disabled={ocupat || motiu !== undefined}
            motiu={motiu}
            onClick={() => void declara()}
          >
            {ocupat && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />}
            {t('cdecl.submit')}
          </BotoAmbMotiu>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
