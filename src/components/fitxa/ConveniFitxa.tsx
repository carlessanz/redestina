// El convenio de UN papel de la organización en la ficha del equipo (Documentació ›
// Convenis, 04-11-2026). Junta en un sitio las tres maneras de resolverlo SIN que la
// organización entre en Redestina:
//
//   1. «Envia’l per correu»: prepara el convenio si no lo hay, acuña el enlace y lo manda
//      al correo de la ficha; la persona firma desde el correo (`/signar/:token`) y el
//      equipo lo contrafirma después (`enviarConveniPerCorreu`).
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
import { enviarConveniPerCorreu } from '../../lib/convenis'
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
  const [enviant, setEnviant] = useState(false)
  const [paper, setPaper] = useState(false)
  const [declarat, setDeclarat] = useState(false)
  const { confirma, dialeg } = useConfirma()

  // El estado del convenio de este modelo que cuenta: el más reciente que no está retirado.
  useEffect(() => {
    let viu = true
    void supabase.from('convenios')
      .select('estado, created_at')
      .eq(tipusOrg === 'productor' ? 'productor_id' : 'entidad_id', orgId)
      .eq('tipo', tipus)
      .not('estado', 'in', '(substituit,resolt)')
      .order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (!viu) return
        setEstat(((data ?? []) as { estado: string }[])[0]?.estado ?? null)
      })
    return () => { viu = false }
  }, [tipusOrg, orgId, tipus, tic])

  function fet() {
    refrescaAvisos()
    void refrescaComptadors()
  }

  async function envia() {
    const desti = correu.trim()
    if (!(await confirma({
      titol: t('cfx.confirm_t'),
      descripcio: t('cfx.confirm', { correu: desti }),
      confirmar: t('cfx.b_correu'),
    }))) return
    setEnviant(true)
    const r = await enviarConveniPerCorreu({
      tipusOrg, orgId, tipus, email: desti, nom,
      textos: {
        assumpte: t('conv.mail_subject'), titol: t('conv.mail_title'), preheader: t('conv.mail_preheader'),
        cos: t('conv.mail_body'), boto: t('conv.mail_button'), nota: t('conv.mail_note'),
      },
      idioma: lang,
    })
    setEnviant(false)
    if (r.ok) toast.success(t(r.simulat ? 'cfx.ok_simulat' : 'cfx.ok', { correu: r.destinatari }))
    else if (r.fase === 'correu') toast.error(t('camp.res_mail_ko'))
    else toast.error(textError(t, r.error))
    fet()
  }

  if (estat === undefined) return null

  const resolt = estat === 'vigent' || estat === 'firmat'
  const senseCorreu = correu.trim() === ''
  const motiuEnvia = motiuCorreu ? t(motiuCorreu) : senseCorreu ? t('cfx.need_correu') : undefined
  const classe = 'h-11 w-full whitespace-normal sm:w-auto md:h-8'

  return (
    <div className="space-y-2" data-testid={`conveni-${tipusOrg}`}>
      <BadgeConveni tipusOrg={tipusOrg} orgId={orgId} conveniPaper={conveniPaper} />
      {estat === null && <p className="text-sm text-muted-foreground">{t('cfx.cap')}</p>}
      {!resolt && (
        <>
          <p className="text-sm text-muted-foreground">{t('cfx.h')}</p>
          <div className="flex flex-wrap gap-2">
            <BotoAmbMotiu size="sm" className={classe} disabled={enviant || !!motiuEnvia} motiu={motiuEnvia}
              onClick={() => void envia()}>
              {t(estat === 'pendent_firma' ? 'cfx.b_correu_de_nou' : 'cfx.b_correu')}
            </BotoAmbMotiu>
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

      <DialegConveniPaper obert={paper} tipusOrg={tipusOrg} orgId={orgId} nom={nom}
        onTancar={() => setPaper(false)} onFet={fet} />
      <DialegConveniDeclarat obert={declarat} tipusOrg={tipusOrg} orgId={orgId} nom={nom}
        onTancar={() => setDeclarat(false)} onFet={fet} />
      {dialeg}
    </div>
  )
}
