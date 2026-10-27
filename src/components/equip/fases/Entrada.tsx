// Fase 2 · la entrada. Validar la oferta del productor sin salir del ciclo
// (`ValidacioOferta`, la misma banda del detalle) y, si declara producto sin cosechar,
// convertirla en espigolada.
//
// ⚠️ «Publica» un borrador no tiene botón: el alta asistida (`crear-oferta`) nace
//    `publicada`, y la del productor, `pendent_validacio`. Un borrador del equipo no existe
//    hoy; si apareciera, su detalle sigue enlazado abajo.

import { useState } from 'react'
import { Link } from 'react-router'
import { useT } from '../../../lib/i18n'
import MissatgesDelPunt from '../../MissatgesDelPunt'
import BotoAmbMotiu from '../../proces/BotoAmbMotiu'
import DialegEspigolada from '../DialegEspigolada'
import ValidacioOferta from '../ValidacioOferta'
import { Button } from '@/components/ui/button'
import type { ContextFase } from './tipus'

export default function FaseEntrada({ c }: { c: ContextFase }) {
  const { t } = useT()
  const { fets, extra, oferta } = c
  const [dlgEspigolada, setDlgEspigolada] = useState(false)

  /**
   * Por qué NO se puede convertir en espigolada (F3). La oferta ya tiene una entrada, así que
   * la jornada crearía un segundo REC con los mismos kilos. **La autoridad sigue siendo la
   * RPC** (`ja_te_canalitzacions` / `ja_te_albarans`, 22023); esto solo evita el choque.
   */
  const motiuNoConvertible = fets.canalitzacions.length > 0
    ? t('conv_esp.no_canalitzacions')
    : fets.albarans.some((a) => a.estado !== 'anulado')
      ? t('conv_esp.no_albarans')
      : null

  return (
    <div className="space-y-3">
      {fets.oferta.estado === 'pendent_validacio' && (
        <ValidacioOferta excedenteId={extra.oferta.id} potAprovar={c.potAprovar} onFet={c.onCanvi} />
      )}

      {/* El «producte al camp» cambia lo que significa esta fase, así que se dice antes de
          enseñar el botón: la entrada la produce una jornada de campo, no un albarán. */}
      {oferta?.producte_al_camp && (
        <div className="rounded-md bg-secondary p-2 text-sm text-secondary-foreground">
          <p>{t(oferta.espigolada_id ? 'conv_esp.done_hint' : 'conv_esp.banner')}</p>
          {/* En táctil no hay hover: el motivo del botón gris va también escrito. */}
          {!oferta.espigolada_id && motiuNoConvertible && <p className="mt-1">{motiuNoConvertible}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
          <Link to={`/equip/ofertes/${extra.oferta.id}`}>{t('canalz.b_obre_oferta')}</Link>
        </Button>
        {oferta?.espigolada_id && (
          <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
            <Link to={`/equip/espigolades/${oferta.espigolada_id}`}>{t('conv_esp.open')}</Link>
          </Button>
        )}
        {oferta?.producte_al_camp && !oferta.espigolada_id && (
          <BotoAmbMotiu
            className="h-11 whitespace-normal md:h-9"
            disabled={Boolean(motiuNoConvertible)}
            motiu={motiuNoConvertible ?? undefined}
            onClick={() => setDlgEspigolada(true)}
          >
            {t('conv_esp.cta')}
          </BotoAmbMotiu>
        )}
      </div>

      <MissatgesDelPunt missatges={c.missatges} fase="entrada" />

      {oferta && (
        <DialegEspigolada
          obert={dlgEspigolada}
          oferta={oferta}
          productorNom={extra.productor?.nom ?? null}
          onTancar={() => setDlgEspigolada(false)}
          onCreada={() => { setDlgEspigolada(false); c.onCanvi() }}
        />
      )}
    </div>
  )
}
