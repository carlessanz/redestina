// El convenio de UN papel de la organización en la ficha del equipo (Documentació ›
// Convenis, 04-11-2026). Junta en un sitio las tres maneras de resolverlo SIN que la
// organización entre en Redestina:
//
//   1. «Envia’l per correu»: prepara el convenio si no lo hay, acuña el enlace y lo manda
//      al correo de la ficha; la persona firma desde el correo (`/signar/:token`) y el
//      equipo lo contrafirma después (`enviarConveniPerCorreu`). Con las notificaciones
//      apagadas (§8) es un envío MANUAL: sale si se acepta en la confirmación, y al lado está
//      «Copia l’enllaç de signatura», el mismo enlace para un correo propio.
//   2. «Registra un conveni signat en paper» (super_admin): sube el escaneado y lo da por
//      vigente (`DialegConveniPaper`, tres pasos en orden).
//   3. «Dona’l per vigent» (super_admin): declarado con los datos de la ficha, sin firma ni
//      papel (`DialegConveniDeclarat`).
//
// Los dos últimos vivían en el archivo de documentación de la misma pestaña; se movieron
// aquí para que todo lo del convenio esté junto al estado del convenio.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { copiarAlPortapapeles } from '../../lib/copiar'
import { crearEnllacConveni, enviarConveniPerCorreu, textCopiaConveni } from '../../lib/convenis'
import { tipusConveniDeclarat } from '../../lib/conveniDeclarat'
import { refrescaAvisos, useTicAvisos } from '../../lib/refrescAvisos'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import { useAppContext } from '../../hooks/useAppContext'
import BadgeConveni from '../BadgeConveni'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import { useConfirma } from '../DialegConfirma'
import DialegConveniPaper from '../equip/DialegConveniPaper'
import DialegConveniDeclarat from '../equip/DialegConveniDeclarat'
import { declarable } from '../equip/fases/AccionsConveni'
import EnllacPerCopiar from './EnllacPerCopiar'
import { acceptaEnviament } from '../../lib/enviamentManual'
import { useEstatsSignatura } from '../../hooks/useEstatsSignatura'
import AccionsSignatura from '../AccionsSignatura'

export default function ConveniFitxa({ tipusOrg, orgId, nom, correu, motiuCorreu, conveniPaper }: {
  tipusOrg: 'productor' | 'entidad'
  orgId: string
  nom: string | null
  /** El correo de la ficha: ahí va el enlace de firma. */
  correu: string
  /** Clave i18n del motivo por el que el correo no puede salir (interruptores, §8). */
  motiuCorreu: string | null
  /** El texto heredado del Excel (`productores.conveni` / `entidades.estat`). */
  conveniPaper: string | null
}) {
  const { t, lang } = useT()
  const { ctx } = useAppContext()
  const esSuperAdmin = ctx?.esSuperAdmin ?? false
  const tipus = tipusConveniDeclarat(tipusOrg)
  const tic = useTicAvisos()
  const [estat, setEstat] = useState<string | null | undefined>(undefined)
  // El PDF vigente del convenio firmado o vigente: sobre él se sube el firmado en papel
  // (circuito de firma, 05-11-2026). Solo el super_admin; los demás ven el estado.
  const [docConveni, setDocConveni] = useState<string | null>(null)
  const [recarregaDoc, setRecarregaDoc] = useState(0)
  const { perDoc, recarrega: recarregaSig } = useEstatsSignatura(docConveni ? [docConveni] : [])
  const sigConveni = docConveni ? perDoc[docConveni] ?? null : null
  const [enviant, setEnviant] = useState(false)
  const [copia, setCopia] = useState<{ text: string; correu: string } | null>(null)
  const [paper, setPaper] = useState(false)
  const [declarat, setDeclarat] = useState(false)
  const { confirma, dialeg } = useConfirma()

  // El estado del convenio de este modelo que cuenta: el más reciente que no está retirado.
  useEffect(() => {
    let viu = true
    void (async () => {
      const { data } = await supabase.from('convenios')
        .select('id, estado, created_at')
        .eq(tipusOrg === 'productor' ? 'productor_id' : 'entidad_id', orgId)
        .eq('tipo', tipus)
        .not('estado', 'in', '(substituit,resolt)')
        .order('created_at', { ascending: false }).limit(1)
      if (!viu) return
      const fila = ((data ?? []) as { id: string; estado: string }[])[0] ?? null
      setEstat(fila?.estado ?? null)
      // Solo un convenio firmado o vigente tiene un PDF que firmar en papel y subir.
      if (!fila || (fila.estado !== 'firmat' && fila.estado !== 'vigent')) { setDocConveni(null); return }
      const { data: docs } = await supabase.from('documentos')
        .select('id')
        .eq('objeto_tipo', 'convenio').eq('objeto_id', fila.id).eq('vigente', true)
        .limit(1)
      if (!viu) return
      setDocConveni(((docs ?? []) as { id: string }[])[0]?.id ?? null)
    })()
    return () => { viu = false }
  }, [tipusOrg, orgId, tipus, tic, recarregaDoc])

  function fet() {
    refrescaAvisos()
    void refrescaComptadors()
  }

  async function envia() {
    const desti = correu.trim()
    const acceptat = await acceptaEnviament(confirma, t, motiuCorreu, {
      titol: t('cfx.confirm_t'),
      descripcio: t('cfx.confirm', { correu: desti }),
      confirmar: t('cfx.b_correu'),
    })
    if (!acceptat) return
    setEnviant(true)
    const r = await enviarConveniPerCorreu({
      tipusOrg, orgId, tipus, email: desti, nom,
      textos: {
        assumpte: t('conv.mail_subject'), titol: t('conv.mail_title'), preheader: t('conv.mail_preheader'),
        cos: t('conv.mail_body'), boto: t('conv.mail_button'), nota: t('conv.mail_note'),
      },
      idioma: lang,
      manual: acceptat.manual,
    })
    setEnviant(false)
    if (r.ok) toast.success(t(r.simulat ? 'cfx.ok_simulat' : 'cfx.ok', { correu: r.destinatari }))
    else if (r.fase === 'correu') toast.error(t('camp.res_mail_ko'))
    else toast.error(textError(t, r.error))
    fet()
  }

  // Correo apagado: prepara y acuña igual, y da el texto para pegarlo en un correo propio.
  async function creaPerCopiar() {
    setEnviant(true)
    const r = await crearEnllacConveni({ tipusOrg, orgId, tipus, email: correu.trim(), nom })
    setEnviant(false)
    if (!r.ok) { toast.error(textError(t, r.error)); return }
    const text = textCopiaConveni({ cos: t('conv.mail_body'), boto: t('conv.mail_button'), nota: t('conv.mail_note') }, r.token)
    setCopia({ text, correu: r.destinatari })
    toast.success(t(await copiarAlPortapapeles(text) ? 'epc.ok_copiat' : 'epc.ok_creat'))
    fet()
  }

  if (estat === undefined) return null

  const resolt = estat === 'vigent' || estat === 'firmat'
  const senseCorreu = correu.trim() === ''
  const motiuEnvia = senseCorreu ? t('cfx.need_correu') : undefined
  const classe = 'h-11 w-full whitespace-normal sm:w-auto md:h-8'

  return (
    <div className="space-y-2" data-testid={`conveni-${tipusOrg}`}>
      <BadgeConveni tipusOrg={tipusOrg} orgId={orgId} conveniPaper={conveniPaper} />
      {estat === null && <p className="text-sm text-muted-foreground">{t('cfx.cap')}</p>}
      {!resolt && (
        <>
          <p className="text-sm text-muted-foreground">{t('cfx.h')}</p>
          {motiuCorreu && <p className="text-xs text-muted-foreground">{t(motiuCorreu)} {t('man.alternativa')}</p>}
          {copia && <EnllacPerCopiar text={copia.text} correu={copia.correu} testid="conveni-copia" />}
          <div className="flex flex-wrap gap-2">
            <BotoAmbMotiu size="sm" className={classe} disabled={enviant || !!motiuEnvia} motiu={motiuEnvia}
              onClick={() => void envia()}>
              {t(estat === 'pendent_firma' ? 'cfx.b_correu_de_nou' : 'cfx.b_correu')}
            </BotoAmbMotiu>
            {motiuCorreu && (
              <BotoAmbMotiu size="sm" variant="outline" className={classe} disabled={enviant || !!motiuEnvia}
                motiu={motiuEnvia} onClick={() => void creaPerCopiar()}>
                {t(estat === 'pendent_firma' ? 'cfx.b_copia_nou' : 'cfx.b_copia')}
              </BotoAmbMotiu>
            )}
            <BotoAmbMotiu size="sm" variant="outline" className={classe} disabled={!esSuperAdmin}
              motiu={t('conv.paper_err_permis')} onClick={() => setPaper(true)}>
              {t('conv.paper_open')}
            </BotoAmbMotiu>
            {declarable(estat) && (
              <BotoAmbMotiu size="sm" variant="outline" className={classe} disabled={!esSuperAdmin}
                motiu={t('cdecl.need_super')} onClick={() => setDeclarat(true)}>
                {t('cdecl.open')}
              </BotoAmbMotiu>
            )}
          </div>
        </>
      )}

      {/* El convenio firmado en papel y escaneado, subido encima del vigente: pasa a ser la
          versión definitiva de la biblioteca. No toca el estado del convenio. */}
      {resolt && sigConveni && (
        <div data-testid={`conveni-signatura-${tipusOrg}`}>
          <AccionsSignatura sig={sigConveni} clauPujaEquip="sgn.a_puja_conveni"
            onCanvi={() => { setRecarregaDoc((n) => n + 1); void recarregaSig(); fet() }} />
        </div>
      )}

      <DialegConveniPaper obert={paper} tipusOrg={tipusOrg} orgId={orgId} nom={nom}
        onTancar={() => setPaper(false)} onFet={fet} />
      <DialegConveniDeclarat obert={declarat} tipusOrg={tipusOrg} orgId={orgId} nom={nom}
        onTancar={() => setDeclarat(false)} onFet={fet} />
      {dialeg}
    </div>
  )
}
