// Aprovacions › «Signatures per tancar» (05-11-2026), la quinta cola.
//
// Lo que una organización ha firmado FUERA y ha SUBIDO desde su panel (vía `pujat`): un
// certificado o un albarán firmado en papel, escaneado o fotografiado. No se da por bueno
// solo: el super_admin abre el fichero, lo compara con el documento y lo cierra —esa versión
// pasa a ser la definitiva— o lo rechaza con motivo, y el documento vuelve a «pendent».
// Las firmas con trazo y las que sube el propio super_admin nacen cerradas y no pasan por aquí.
//
// Lee `v_signatures_bandeja` (solo equipo, `security_invoker`). Solo el super_admin actúa
// (`tancar_/rebutjar_signatura` lo exigen); el resto del equipo ve la cola con los botones
// en gris y el motivo, como las otras cuatro.

import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { CheckCheck, FileSearch, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { carregaBandejaSignatures, rebutjarSignatura, tancarSignatura } from '../../lib/documents'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import { clauVia, megues } from '../../lib/signatures'
import { dataCurta } from '../../lib/format'
import type { SignaturaBandeja } from '../../types'
import { obreFitxerFirma, textErrorSignatura } from '../AccionsSignatura'
import DialegMotiu from '../DialegMotiu'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Dónde se mira el documento: su albarán o la ficha de la organización (Documentació). */
export function rutaSignatura(f: Pick<SignaturaBandeja, 'objeto_tipo' | 'objeto_id' | 'organizacion_id'>): string | null {
  if (f.objeto_tipo === 'albaran') return `/equip/albarans/${f.objeto_id}`
  return f.organizacion_id ? `/equip/entitats/${f.organizacion_id}?pestanya=documentacio` : null
}

export default function CuaSignatures() {
  const { t } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { ctx } = useAppContext()
  const esSuperAdmin = ctx?.esSuperAdmin ?? false
  const [files, setFiles] = useState<SignaturaBandeja[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState(false)
  const [ocupat, setOcupat] = useState<string | null>(null)
  const [motiuDe, setMotiuDe] = useState<{ accio: 'tanca' | 'rebutja'; fila: SignaturaBandeja } | null>(null)

  const carrega = useCallback(async () => {
    const r = await carregaBandejaSignatures('signat')
    // Migración sin aplicar o un corte: la cola sale con su error y las otras cuatro siguen.
    if (!r.ok) { console.warn('signatures per tancar:', r.missatge); setError(true); setCarregant(false); return }
    setError(false)
    setFiles(r.data)
    setCarregant(false)
  }, [])

  useEffect(() => { void carrega() }, [carrega])

  // El tablero enlaza aquí con `#signatures`: se baja a la cola cuando ya está pintada.
  useEffect(() => {
    if (location.hash !== '#signatures' || carregant) return
    document.getElementById('signatures')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash, carregant])

  async function confirma(text: string) {
    if (!motiuDe?.fila.firma_id) return
    const { accio, fila } = motiuDe
    setOcupat(fila.documento_id)
    const r = accio === 'tanca'
      ? await tancarSignatura(fila.firma_id!, text)
      : await rebutjarSignatura(fila.firma_id!, text)
    setOcupat(null)
    if (!r.ok) { toast.error(textErrorSignatura(t, r)); return }
    toast.success(t(accio === 'tanca' ? 'sgn.ok_tancada' : 'sgn.ok_rebutjada'))
    setMotiuDe(null)
    void refrescaComptadors()
    await carrega()
  }

  const motiu = esSuperAdmin ? undefined : t('sgn.need_super')
  const classe = 'h-11 w-full whitespace-normal sm:w-auto md:h-8'

  return (
    <Card id="signatures" className="scroll-mt-20" data-testid="cua-signatures">
      <CardHeader>
        <CardTitle>{t('appr.sgn_title')} ({files.length})</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('appr.sgn_subtitle')}</p>
        {!esSuperAdmin && <p className="mt-1 text-sm text-aviso">{t('sgn.need_super')}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
        {!carregant && !error && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('appr.sgn_empty')}</p>
        )}
        {files.map((f) => {
          const ruta = rutaSignatura(f)
          const bloquejat = !esSuperAdmin || ocupat === f.documento_id
          return (
            <div key={f.documento_id} className="rounded-lg border p-3" data-testid="signatura-per-tancar">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-60 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{t(`doc.tipus_${f.tipo}`)}</Badge>
                    <span className="font-medium tabular-nums">{f.numero_completo}</span>
                    {f.modo === 'prueba' && (
                      <Badge className="bg-coral-suave text-coral-texto">{t('doc.mode_test')}</Badge>
                    )}
                  </div>
                  <div className="text-sm">{f.org_nom ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      f.via ? t(clauVia(f.via)) : null,
                      f.signat_at ? t('appr.sgn_rebut', { data: dataCurta(f.signat_at) }) : null,
                      f.fitxer_bytes ? megues(f.fitxer_bytes) : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                  {(f.signant_nom || f.signant_carrec || f.data_signatura) && (
                    <div className="text-xs text-muted-foreground">
                      {/* Solo lo que se escribió: los tres datos son opcionales al subir. */}
                      {t('appr.sgn_signant', {
                        qui: [f.signant_nom, f.signant_carrec, f.data_signatura ? dataCurta(f.data_signatura) : null]
                          .filter(Boolean).join(' · '),
                      })}
                    </div>
                  )}
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  {f.firma_id && f.fitxer_mime && (
                    <Button size="sm" variant="outline" className={classe}
                      onClick={() => void obreFitxerFirma(f.firma_id!, t)}>
                      <FileSearch className="mr-1 size-4" aria-hidden />{t('sgn.a_veure_fitxer')}
                    </Button>
                  )}
                  {ruta && (
                    <Button size="sm" variant="ghost" className={classe} onClick={() => navigate(ruta)}>
                      {t(f.objeto_tipo === 'albaran' ? 'appr.sgn_obre_albara' : 'appr.sgn_obre_fitxa')}
                    </Button>
                  )}
                  <BotoAmbMotiu size="sm" className={classe} disabled={bloquejat} motiu={motiu}
                    data-testid="sgn-tanca" onClick={() => setMotiuDe({ accio: 'tanca', fila: f })}>
                    <CheckCheck className="mr-1 size-4" aria-hidden />{t('sgn.a_tanca')}
                  </BotoAmbMotiu>
                  <BotoAmbMotiu size="sm" variant="outline" className={classe} disabled={bloquejat} motiu={motiu}
                    data-testid="sgn-rebutja" onClick={() => setMotiuDe({ accio: 'rebutja', fila: f })}>
                    <Undo2 className="mr-1 size-4" aria-hidden />{t('sgn.a_rebutja')}
                  </BotoAmbMotiu>
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>

      <DialegMotiu
        obert={motiuDe !== null}
        onObert={(v) => { if (!v) setMotiuDe(null) }}
        titol={t(motiuDe?.accio === 'rebutja' ? 'sgn.rebutja_t' : 'sgn.tanca_t', { num: motiuDe?.fila.numero_completo ?? '' })}
        descripcio={t(motiuDe?.accio === 'rebutja' ? 'sgn.rebutja_desc' : 'sgn.tanca_desc')}
        etiqueta={t(motiuDe?.accio === 'rebutja' ? 'sgn.rebutja_motiu' : 'sgn.tanca_nota')}
        confirmar={t(motiuDe?.accio === 'rebutja' ? 'sgn.a_rebutja' : 'sgn.a_tanca')}
        destructiu={motiuDe?.accio === 'rebutja'}
        opcional={motiuDe?.accio === 'tanca'}
        ocupat={ocupat !== null}
        onConfirma={(m) => void confirma(m)}
      />
    </Card>
  )
}
