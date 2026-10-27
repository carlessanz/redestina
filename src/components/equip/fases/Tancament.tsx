// Fase 6 · el cierre. Dos cosas que antes mandaban a otra pantalla y ahora se resuelven aquí:
//
// - el COSTE POR KILO de referencia del producto, si falta (`fijar_coste_producto`, el mismo
//   formulario que `ProducteDetall`; `pot_aprovar()`). Sin coste no hay valor fiscal y el
//   cierre se bloquea (`sense_cost`);
// - el DESTINO FINAL de los kilos que no salieron por Redestina (`DestiFinal`, el mismo
//   componente del detalle de la oferta y del panel del productor).
//
// El cierre anual y los certificados sí siguen en su pantalla: son de todo el ejercicio, no
// de este lote, y su ciclo (calcular, resumen, revisión, firma) no cabe en una fase.

import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useT } from '../../../lib/i18n'
import { textError } from '../../../lib/textError'
import { fixarCostProducte } from '../../../lib/tancament'
import { refrescaComptadors } from '../../../lib/pendentsEquip'
import { canalitzacionsVives } from '../../../lib/passosCanalitzacio'
import { ESTATS_AMB_DESTI } from '../../../lib/destiFinal'
import MissatgesDelPunt from '../../MissatgesDelPunt'
import DestiFinal from '../../DestiFinal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ContextFase } from './tipus'

export default function FaseTancament({ c }: { c: ContextFase }) {
  const { t } = useT()
  const { fets, extra, oferta } = c
  const producte = extra.oferta.producto
  const [valor, setValor] = useState('')
  const [motiu, setMotiu] = useState('')
  const [ocupat, setOcupat] = useState(false)

  async function desaCost() {
    if (!producte) return
    const n = Number(valor.trim().replace(',', '.'))
    if (!valor.trim() || Number.isNaN(n) || n <= 0) { toast.error(t('cost.bad_value')); return }
    if (!motiu.trim()) { toast.error(t('cost.reason_required')); return }
    setOcupat(true)
    const r = await fixarCostProducte({ producte, cost: n, motiu: motiu.trim() })
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('cost.saved', { p: producte }))
    setValor('')
    setMotiu('')
    void refrescaComptadors()
    c.onCanvi()
  }

  // Lo que salió (o sale) por Redestina; el resto pide destino.
  const vives = canalitzacionsVives(fets)
  const kgRedestina = vives.reduce((s, x) => s + Number(x.kg_confirmados ?? 0), 0)
  const kgTotal = Number(fets.oferta.kg_total ?? 0)
  const ambDesti = oferta != null && kgTotal - kgRedestina > 0.001
    && (ESTATS_AMB_DESTI as readonly string[]).includes(fets.oferta.estado)

  return (
    <div className="space-y-3">
      {fets.cost_falten > 0 && producte && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">{t('cfase.cost_t', { p: producte })}</p>
          <p className="text-xs text-muted-foreground">{t('cfase.cost_hint')}</p>
          {/* Sin el formulario, un técnico no sabría por qué no puede cambiarlo. */}
          {!c.potAprovar
            ? <p className="text-sm text-muted-foreground">{t('cost.readonly')}</p>
            : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="cd-cost" className="mb-1.5 block text-xs text-muted-foreground">{t('cost.f_cost')}</Label>
                  <Input id="cd-cost" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="cd-cost-motiu" className="mb-1.5 block text-xs text-muted-foreground">{t('cost.f_reason')}</Label>
                  <Input id="cd-cost-motiu" value={motiu} onChange={(e) => setMotiu(e.target.value)} />
                </div>
                <div className="sm:col-span-3">
                  <Button className="h-11 w-full whitespace-normal sm:w-auto md:h-9" disabled={ocupat}
                    onClick={() => void desaCost()}>
                    {t('cost.a_set')}
                  </Button>
                </div>
              </div>
            )}
        </div>
      )}

      {ambDesti && oferta && (
        <DestiFinal
          excedenteId={oferta.id}
          estado={oferta.estado}
          kgTotal={kgTotal}
          destiReclamat={Boolean(oferta.desti_reclamat_at)}
          sortides={vives.map((x) => ({ entitat: x.entitat ?? null, kg: Number(x.kg_confirmados ?? 0) }))}
          onDesat={c.onCanvi}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {/* Al cierre CONCRETO de este ejercicio, si ya existe: ahí viven los certificados de
            donación y de transacción de este generador. */}
        <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
          <Link to={extra.exercici?.id ? `/equip/tancament/${extra.exercici.id}` : '/equip/tancament'}>
            {t('canalz.b_tancament')}
          </Link>
        </Button>
      </div>

      <MissatgesDelPunt missatges={c.missatges} fase="tancament" />
    </div>
  )
}
