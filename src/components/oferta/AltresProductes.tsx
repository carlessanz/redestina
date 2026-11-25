// «Afegir un altre producte» en el alta de una oferta (plan DIC 26, fase 6a, proceso 3.3).
//
// El primer producto se contesta en los campos de siempre del formulario; aquí van los demás,
// uno por fila: producto (el mismo buscador predictivo), variedad, kilos y, si el formulario los
// pide para el primero, cajas y precio mínimo. Lo común (lugar, fechas, modalidades, causa…) no
// se repite: vale para todos. La lógica —qué se manda, qué está mal, cómo se recupera— está en
// `lib/altaMultiproducte.ts`; este componente solo pinta y avisa de los cambios.
//
// Va DENTRO del bloque de la cantidad (es donde ya se han dicho producto y kilos del primero) y
// solo en el alta y en el esborrany: editar una oferta publicada es editar UNA oferta.

import { Plus, Trash2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { caben, filaBuida, MAX_PRODUCTES, type ErrorFila, type FilaProducte } from '../../lib/altaMultiproducte'
import CercadorOpcions, { type OpcioCercador } from '../CercadorOpcions'
import BotoIcona from '../BotoIcona'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ETIQUETA = 'mb-1.5 block leading-snug'
const OPCIONAL = 'ml-1 font-normal text-muted-foreground'

interface Props {
  files: FilaProducte[]
  onChange: (files: FilaProducte[]) => void
  opcionsProducte: readonly OpcioCercador[]
  /** El primer producto (el de los campos de dalt), para nombrarlo en la cabecera. */
  principal: string | null
  /** El formulario pregunta cajas o palets (`format_entrega`): cada fila puede decir las suyas. */
  ambCaixes: boolean
  /** El formulario pregunta precio mínimo (venta): vacío en una fila = el del primer producto. */
  ambPreu: boolean
  /** El precio mínimo del primer producto, para la pista de la fila. */
  preuPrincipal: unknown
  /** Lo que está mal en cada fila, por su `clau`. */
  errors: Record<string, ErrorFila | string>
}

export default function AltresProductes({
  files, onChange, opcionsProducte, principal, ambCaixes, ambPreu, preuPrincipal, errors,
}: Props) {
  const { t } = useT()
  const canvia = (clau: string, camp: keyof Omit<FilaProducte, 'clau'>, valor: string) =>
    onChange(files.map((f) => (f.clau === clau ? { ...f, [camp]: valor } : f)))
  const treu = (clau: string) => onChange(files.filter((f) => f.clau !== clau))
  const preu = preuPrincipal == null || preuPrincipal === '' ? null : String(preuPrincipal)

  return (
    <div className="min-w-0 space-y-3 sm:col-span-2" data-testid="altres-productes">
      {files.length > 0 && (
        <div className="space-y-1">
          <p className="font-titulos text-sm font-semibold">{t('mp.titol_files')}</p>
          <p className="text-xs text-muted-foreground">
            {principal ? t('mp.primer_producte', { producte: principal }) : t('mp.primer_producte_buit')}
            {' '}{t('mp.comuns')}
          </p>
        </div>
      )}
      {files.map((f, i) => {
        const id = `of-mp-${i}`
        const error = errors[f.clau]
        return (
          <div key={f.clau} data-testid="fila-producte" data-index={i}
            className={cn('rounded-lg border bg-muted/30 p-3', error && 'border-error')}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('mp.producte_n', { num: i + 2 })}</p>
              <BotoIcona icona={Trash2} etiqueta={t('mp.treu')} onClick={() => treu(f.clau)}
                data-testid="treu-producte" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <Label htmlFor={`${id}-producte`} className={ETIQUETA}>{t('mp.c_producte')}</Label>
                <CercadorOpcions id={`${id}-producte`} name={`productes[${i}].producte`}
                  invalid={error === 'mp.err_falta_producte' || error === 'mp.err_repetit' || error === 'mp.err_producte_invalid'}
                  opcions={opcionsProducte} valor={f.producte || null}
                  placeholder={t('po.product_search')} detallSota={false}
                  onChange={(v) => canvia(f.clau, 'producte', v)} />
              </div>
              <div className="min-w-0">
                <Label htmlFor={`${id}-varietat`} className={ETIQUETA}>
                  {t('mp.c_varietat')} <span className={OPCIONAL}>{t('po.optional')}</span>
                </Label>
                <Input id={`${id}-varietat`} name={`productes[${i}].varietat`} type="text" maxLength={200}
                  value={f.varietat} onChange={(e) => canvia(f.clau, 'varietat', e.target.value)} />
              </div>
              <div className="min-w-0">
                <Label htmlFor={`${id}-kg`} className={ETIQUETA}>{t('mp.c_kg')}</Label>
                <Input id={`${id}-kg`} name={`productes[${i}].kg`} type="number" step="0.01" min="0" inputMode="decimal"
                  aria-invalid={error === 'mp.err_kg'}
                  value={f.kg} onChange={(e) => canvia(f.clau, 'kg', e.target.value)} />
              </div>
              {ambCaixes && (
                <div className="min-w-0">
                  <Label htmlFor={`${id}-caixes`} className={ETIQUETA}>
                    {t('mp.c_caixes')} <span className={OPCIONAL}>{t('po.optional')}</span>
                  </Label>
                  <Input id={`${id}-caixes`} name={`productes[${i}].caixes`} type="number" step="1" min="1" inputMode="numeric"
                    aria-invalid={error === 'mp.err_caixes'}
                    value={f.caixes} onChange={(e) => canvia(f.clau, 'caixes', e.target.value)} />
                </div>
              )}
              {ambPreu && (
                <div className="min-w-0">
                  <Label htmlFor={`${id}-preu`} className={ETIQUETA}>
                    {t('mp.c_preu')} <span className={OPCIONAL}>{t('po.optional')}</span>
                  </Label>
                  <Input id={`${id}-preu`} name={`productes[${i}].preu_minim`} type="number" step="0.01" min="0"
                    inputMode="decimal" aria-invalid={error === 'mp.err_preu'} placeholder={preu ?? undefined}
                    value={f.preu_minim} onChange={(e) => canvia(f.clau, 'preu_minim', e.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">{t('mp.preu_hereta')}</p>
                </div>
              )}
            </div>
            {error && <p role="alert" className="mt-2 text-sm text-error" data-testid="error-fila-producte">{t(error)}</p>}
          </div>
        )
      })}
      {caben(files) ? (
        <Button type="button" variant="outline" className="h-11 whitespace-normal md:h-8" data-testid="afegeix-producte"
          onClick={() => onChange([...files, filaBuida()])}>
          <Plus className="size-4" aria-hidden /> {t('mp.afegeix')}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{t('mp.maxim', { n: MAX_PRODUCTES })}</p>
      )}
    </div>
  )
}
