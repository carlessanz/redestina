// La firma de un documento en una fila: su estado y lo que se puede hacer con ella
// (05-11-2026). Lo usan las listas de los paneles (certificados, albaranes), las fichas del
// equipo (`AccionsCertificat`, `AlbaraDetall`) y lo monta cada uno con su propio diálogo.
//
// ⚠️ QUÉ BOTÓN SALE LO DECIDE `accionsSignatura()` (`lib/signatures.ts`), no este fichero.
//    Aquí solo se averigua QUIÉN mira (`rolSignatura`: super_admin, resto del equipo, titular
//    u operador de la organización que firma) y se pinta lo que diga.
//
// Dos formas de pintarse: `botons` (con texto, en una ficha) e `icones` (`BotoIcona`, en la
// columna de acciones de una tabla, donde no cabe texto a 360 px).

import { useState } from 'react'
import { CheckCheck, FileSearch, FileUp, PenLine, Undo2, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import { textError } from '../lib/textError'
import { refrescaAvisos } from '../lib/refrescAvisos'
import { refrescaComptadors } from '../lib/pendentsEquip'
import { rebutjarSignatura, tancarSignatura, urlFitxerFirma } from '../lib/documents'
import { accionsSignatura, mostraEstatSignatura, rolSignatura, type AccioSignatura } from '../lib/signatures'
import type { SignaturaDocument } from '../types'
import BadgeSignatura from './BadgeSignatura'
import BotoIcona from './BotoIcona'
import DialegMotiu from './DialegMotiu'
import DialegSignaDocument, { type PestanyaSignatura } from './DialegSignaDocument'
import { Button } from '@/components/ui/button'

/** Lo que hace falta de la fila de `v_signatura_document` (o de la bandeja del equipo). */
export type SignaturaFila = Pick<
  SignaturaDocument,
  | 'documento_id' | 'tipo' | 'numero_completo' | 'estat' | 'firma_id' | 'fitxer_mime'
  | 'tipo_org' | 'org_id' | 'admet_canvas' | 'ultim_motiu_rebuig'
>

const ICONA: Record<AccioSignatura, LucideIcon> = {
  signa: PenLine,
  puja: Upload,
  puja_equip: FileUp,
  veure_fitxer: FileSearch,
  tanca: CheckCheck,
  rebutja: Undo2,
}

const ETIQUETA: Record<AccioSignatura, string> = {
  signa: 'sgn.a_signa',
  puja: 'sgn.a_puja',
  puja_equip: 'sgn.a_puja_equip',
  veure_fitxer: 'sgn.a_veure_fitxer',
  tanca: 'sgn.a_tanca',
  rebutja: 'sgn.a_rebutja',
}

/** ¿Quién mira esta firma? Del contexto de sesión y de la organización que firma. */
export function useRolSignatura(sig: Pick<SignaturaFila, 'tipo_org' | 'org_id'> | null | undefined) {
  const { ctx } = useAppContext()
  const titular = !!sig && (ctx?.organitzacions ?? []).some((o) =>
    o.tipo === sig.tipo_org && o.id === sig.org_id && o.rol_org === 'titular')
  return rolSignatura({
    esIntern: ctx?.esIntern ?? false,
    esSuperAdmin: ctx?.esSuperAdmin ?? false,
    titular,
  })
}

/**
 * Abre el fichero firmado que se subió, para revisarlo. La pestaña se abre ANTES de esperar
 * a la red (abrirla después la convierte en un popup bloqueado).
 */
export async function obreFitxerFirma(firmaId: string, t: (k: string) => string): Promise<void> {
  const finestra = window.open('', '_blank')
  if (finestra) finestra.opener = null
  const r = await urlFitxerFirma(firmaId)
  if (!r.ok) { finestra?.close(); toast.error(t(r.motiuKey)); return }
  if (finestra) finestra.location.href = r.data.url
  else toast.error(t('doc.err_popup'))
}

/** El texto del rechazo de `tancar_`/`rebutjar_signatura`. `cal_motiu` es de aquí, no de las ofertas. */
export function textErrorSignatura(
  t: (k: string, p?: Record<string, string | number>) => string,
  r: { missatge: string; codi: string | null },
): string {
  if (r.codi === 'cal_motiu' || r.missatge.startsWith('cal_motiu')) return t('sgn.err_cal_motiu')
  return textError(t, r)
}

export default function AccionsSignatura({
  sig, variant = 'botons', ambBadge = true, onCanvi, clauPujaEquip,
}: {
  sig: SignaturaFila | null | undefined
  variant?: 'botons' | 'icones'
  /** La etiqueta del estado delante de los botones (las tablas la pintan en su columna). */
  ambBadge?: boolean
  /** Tras firmar, subir, cerrar o rechazar: la pantalla relee. */
  onCanvi?: () => void
  /** Otra etiqueta para «Puja el signat» (la ficha del convenio dice «Puja el conveni signat»). */
  clauPujaEquip?: string
}) {
  const { t } = useT()
  const rol = useRolSignatura(sig)
  const [dialeg, setDialeg] = useState<{ mode: 'titular' | 'equip'; pestanya: PestanyaSignatura } | null>(null)
  const [motiu, setMotiu] = useState<'tanca' | 'rebutja' | null>(null)
  const [ocupat, setOcupat] = useState(false)

  if (!sig) return null

  const accions = accionsSignatura({
    estat: sig.estat,
    rol,
    tipo: sig.tipo,
    admetCanvas: sig.admet_canvas,
    ambPdf: sig.fitxer_mime != null,
  })
  const perspectiva = rol === 'titular' || rol === 'operador' ? 'usuari' : 'equip'
  const ambEstat = ambBadge && mostraEstatSignatura(sig.estat, sig.admet_canvas)

  function fet() {
    onCanvi?.()
    refrescaAvisos()
    void refrescaComptadors()
  }

  function executa(a: AccioSignatura) {
    if (a === 'signa') setDialeg({ mode: 'titular', pestanya: 'signa' })
    else if (a === 'puja') setDialeg({ mode: 'titular', pestanya: 'puja' })
    else if (a === 'puja_equip') setDialeg({ mode: 'equip', pestanya: 'puja' })
    else if (a === 'veure_fitxer' && sig?.firma_id) void obreFitxerFirma(sig.firma_id, t)
    else if (a === 'tanca' || a === 'rebutja') setMotiu(a)
  }

  async function confirmaMotiu(text: string) {
    if (!sig?.firma_id || !motiu) return
    setOcupat(true)
    const r = motiu === 'tanca'
      ? await tancarSignatura(sig.firma_id, text)
      : await rebutjarSignatura(sig.firma_id, text)
    setOcupat(false)
    if (!r.ok) { toast.error(textErrorSignatura(t, r)); return }
    toast.success(t(motiu === 'tanca' ? 'sgn.ok_tancada' : 'sgn.ok_rebutjada'))
    setMotiu(null)
    fet()
  }

  // Nada que decir ni que hacer (un CONV pendiente visto por quien no puede subirlo).
  if (!ambEstat && accions.length === 0 && variant === 'icones') return null

  // El rechazo anterior se le cuenta a quien tiene que volver a firmar.
  const motiuRebuig = sig.estat === 'pendent' && perspectiva === 'usuari' ? sig.ultim_motiu_rebuig : null
  const nomesTitular = rol === 'operador' && sig.estat === 'pendent' && sig.admet_canvas

  return (
    <>
      {variant === 'icones' ? (
        <span className="contents" data-testid={`accions-signatura-${sig.documento_id}`}>
          {ambEstat && <BadgeSignatura estat={sig.estat} perspectiva={perspectiva} />}
          {accions.map((a) => (
            <BotoIcona
              key={a}
              icona={ICONA[a]}
              etiqueta={t(a === 'puja_equip' && clauPujaEquip ? clauPujaEquip : ETIQUETA[a])}
              variant={a === 'signa' ? 'default' : 'ghost'}
              disabled={ocupat}
              data-testid={`sgn-accio-${a}`}
              onClick={() => executa(a)}
            />
          ))}
        </span>
      ) : (
        <div className="space-y-1" data-testid={`accions-signatura-${sig.documento_id}`}>
          <div className="flex flex-wrap items-center gap-2">
            {ambEstat && <BadgeSignatura estat={sig.estat} perspectiva={perspectiva} />}
            {accions.map((a) => {
              const Icona = ICONA[a]
              return (
                <Button
                  key={a}
                  size="sm"
                  variant={a === 'signa' || a === 'tanca' ? 'default' : 'outline'}
                  className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
                  disabled={ocupat}
                  data-testid={`sgn-accio-${a}`}
                  onClick={() => executa(a)}
                >
                  <Icona className="mr-1 size-4" aria-hidden />
                  {t(a === 'puja_equip' && clauPujaEquip ? clauPujaEquip : ETIQUETA[a])}
                </Button>
              )
            })}
          </div>
          {motiuRebuig && (
            <p className="text-sm text-aviso">{t('sgn.rebutjat_motiu', { motiu: motiuRebuig })}</p>
          )}
          {nomesTitular && <p className="text-xs text-muted-foreground">{t('pend.only_titular')}</p>}
        </div>
      )}

      {dialeg && (
        <DialegSignaDocument
          obert
          doc={{ id: sig.documento_id, tipus: sig.tipo, numero: sig.numero_completo }}
          mode={dialeg.mode}
          pestanya={dialeg.pestanya}
          onTancar={() => setDialeg(null)}
          onFet={fet}
        />
      )}

      <DialegMotiu
        obert={motiu !== null}
        onObert={(v) => { if (!v) setMotiu(null) }}
        titol={t(motiu === 'rebutja' ? 'sgn.rebutja_t' : 'sgn.tanca_t', { num: sig.numero_completo })}
        descripcio={t(motiu === 'rebutja' ? 'sgn.rebutja_desc' : 'sgn.tanca_desc')}
        etiqueta={t(motiu === 'rebutja' ? 'sgn.rebutja_motiu' : 'sgn.tanca_nota')}
        confirmar={t(motiu === 'rebutja' ? 'sgn.a_rebutja' : 'sgn.a_tanca')}
        destructiu={motiu === 'rebutja'}
        opcional={motiu === 'tanca'}
        ocupat={ocupat}
        onConfirma={(m) => void confirmaMotiu(m)}
      />
    </>
  )
}
