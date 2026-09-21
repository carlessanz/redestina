// Los datos de la Fundación, editables desde Configuració.
//
// POR QUÉ EXISTE. `emitir_certificado()` y sus hermanas se niegan mientras
// `parametros_documentales.datos_provisionales` sea `true`, y el motivo que devuelven dice
// «Omple Configuració i desmarca datos_provisionales». Esa pantalla **no existía**: la
// aplicación solo LEÍA esa fila (`canalitzacio.ts`, `CampanyaConvenis.tsx`) y rellenarla
// era SQL a mano. Esto la cierra.
//
// ⚠️ EL DNI DE LA APODERADA NO SE PUEDE PRECARGAR. Tiene UPDATE pero no SELECT (GRANT por
//    columnas), así que el campo sale **vacío siempre** y eso no significa que no haya
//    ninguno guardado: significa que desde aquí no se puede leer. Se dice en la propia
//    pantalla, porque un campo vacío que no se puede leer se parece demasiado a un campo
//    sin rellenar.
//
// ⚠️ LA FIRMA Y EL SELLO SON DE SOLO LECTURA. Son PNG del bucket privado `activos`, que no
//    tiene ni una política en `storage.objects` (§4): no hay forma de subirlos desde el
//    navegador y no se finge una. Se enseña si están puestos y se dice que se cargan
//    aparte. **No bloquean nada**: sin ellos el certificado se emite igual y sale con el
//    hueco para firmar a mano (`_shared/pdf/render/cierre.ts`, `pintarFirma`).
//
// ⚠️ UN `tecnic` VE LA SECCIÓN EN GRIS, no se le esconde. Es el criterio del proyecto
//    (§6ter, mismo patrón que «Només admin» en Aprovacions): un control apagado con su
//    motivo informa; un control ausente hace pensar que la función no existe.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { useConfirma } from '../DialegConfirma'
import { FilaCasella } from '../Casella'
import {
  CAMPS_FUNDACIO, campsPendents,
  type CampFundacio, type CanvisFundacio, type DadesFundacio as Dades,
} from '../../lib/campsFundacio'
import { desarParametres, llegirParametres } from '../../lib/parametresFundacio'
import { cn } from '../../lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

/** Los campos que ocupan la fila entera: son largos y partirlos en dos columnas estorba. */
const AMPLES = new Set<CampFundacio>(['domicilio', 'inscripcion'])

type Formulari = Record<CampFundacio, string>

function aFormulari(d: Dades | null): Formulari {
  const f = {} as Formulari
  for (const camp of CAMPS_FUNDACIO) f[camp] = d?.[camp] ?? ''
  return f
}

export default function DadesFundacio() {
  const { t } = useT()
  const { ctx } = useAppContext()
  const { confirma, dialeg } = useConfirma()
  const potEditar = ctx?.esSuperAdmin === true

  const [dades, setDades] = useState<Dades | null>(null)
  const [form, setForm] = useState<Formulari>(() => aFormulari(null))
  const [dni, setDni] = useState('')
  const [carregant, setCarregant] = useState(true)
  const [desant, setDesant] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const carrega = useCallback(async () => {
    const { dades: d, error: err } = await llegirParametres()
    setError(err)
    setDades(d)
    setForm(aFormulari(d))
    setDni('')
    setCarregant(false)
  }, [])

  useEffect(() => { void carrega() }, [carrega])

  // Lo que falta se mide sobre lo GUARDADO, no sobre el formulario: el interruptor de
  // abajo desbloquea la emisión real, y lo que la base leerá al emitir es la fila.
  const pendents = campsPendents(dades)
  const hiHaCanvis = dades !== null
    && (CAMPS_FUNDACIO.some((c) => form[c].trim() !== (dades[c] ?? '').trim()) || dni.trim() !== '')

  function mostraResultat(r: { ok: boolean; denegat: boolean; error: string | null }, exit: string) {
    if (r.ok) { toast.success(exit); return true }
    toast.error(r.denegat ? t('cfgf.denied') : (r.error ?? t('c.error')))
    return false
  }

  async function desa() {
    if (!potEditar || desant) return
    setDesant(true)
    const textos = Object.fromEntries(
      CAMPS_FUNDACIO.map((c) => [c, form[c].trim() === '' ? null : form[c].trim()]),
    ) as Record<CampFundacio, string | null>
    const canvis: CanvisFundacio = { ...textos }
    // El DNI en blanco NO borra el que haya: no se puede leer, así que dejarlo vacío es lo
    // normal cuando no se quiere tocar.
    if (dni.trim() !== '') canvis.apoderada_dni = dni.trim()
    const r = await desarParametres(canvis, ctx?.userId ?? null)
    setDesant(false)
    if (mostraResultat(r, t('cfgf.saved'))) await carrega()
  }

  async function canviaProvisionals(provisional: boolean) {
    if (!potEditar || desant || !dades) return
    // Volver a marcarlo es regresar a la posición segura: no se pregunta nada.
    if (!provisional) {
      if (pendents.length > 0 || hiHaCanvis) return
      if (!(await confirma({
        titol: t('cfgf.prov_confirm_t'),
        descripcio: t('cfgf.prov_confirm'),
        confirmar: t('cfgf.prov_confirm_btn'),
      }))) return
    }
    setDesant(true)
    const r = await desarParametres({ datos_provisionales: provisional }, ctx?.userId ?? null)
    setDesant(false)
    if (mostraResultat(r, provisional ? t('cfgf.prov_saved_on') : t('cfgf.prov_saved_off'))) {
      await carrega()
    }
  }

  // El caso «no eres super admin» ya lo dice la banda de arriba: repetirlo aquí solo
  // añadiría ruido. Este motivo explica lo que SÍ depende de los datos.
  const motiuBloqueig = hiHaCanvis
    ? t('cfgf.prov_unsaved')
    : pendents.length > 0
      ? t('cfgf.prov_blocked', { camps: pendents.map((c) => t(`cfgf.f_${c}`)).join(', ') })
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('cfgf.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('cfgf.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {carregant ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t('c.loading')}
          </p>
        ) : error ? (
          <p className="rounded-md border border-error/30 bg-error-fondo p-3 text-sm text-error">
            {t('cfgf.load_error', { error })}
          </p>
        ) : (
          <>
            {/* Dónde estamos: provisional (no se puede certificar en real) o no. */}
            <div className={cn('flex items-start gap-3 rounded-lg border p-3',
              dades?.datos_provisionales
                ? 'border-aviso/30 bg-aviso-fondo'
                : 'border-exito/30 bg-exito-fondo')}>
              {dades?.datos_provisionales
                ? <ShieldAlert className="mt-0.5 size-5 shrink-0 text-aviso" />
                : <ShieldCheck className="mt-0.5 size-5 shrink-0 text-exito" />}
              <div className="text-sm">
                <div className={cn('font-semibold',
                  dades?.datos_provisionales ? 'text-aviso' : 'text-exito')}>
                  {dades?.datos_provisionales ? t('cfgf.state_prov') : t('cfgf.state_real')}
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {dades?.datos_provisionales ? t('cfgf.state_prov_desc') : t('cfgf.state_real_desc')}
                </p>
              </div>
            </div>

            {!potEditar && (
              <p className="rounded-md border border-aviso/30 bg-aviso-fondo p-3 text-sm text-aviso">
                {t('cfgf.only_super')}
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {CAMPS_FUNDACIO.map((camp) => (
                <div key={camp} className={cn('space-y-1', AMPLES.has(camp) && 'sm:col-span-2')}>
                  <label htmlFor={`fund-${camp}`} className="text-sm font-medium">
                    {t(`cfgf.f_${camp}`)}
                  </label>
                  <Input
                    id={`fund-${camp}`}
                    className="h-11 md:h-9"
                    value={form[camp]}
                    disabled={!potEditar || desant}
                    onChange={(e) => setForm((f) => ({ ...f, [camp]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('cfgf.email_help')}</p>

            {/* El DNI: se escribe, no se lee. */}
            <div className="space-y-1">
              <label htmlFor="fund-dni" className="text-sm font-medium">
                {t('cfgf.f_apoderada_dni')}
              </label>
              <Input
                id="fund-dni"
                className="h-11 md:h-9 sm:max-w-xs"
                value={dni}
                placeholder={t('cfgf.dni_ph')}
                disabled={!potEditar || desant}
                onChange={(e) => setDni(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('cfgf.dni_help')}</p>
            </div>

            {/* Firma y sello: estado, y nada más. */}
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">{t('cfgf.assets_title')}</div>
              <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  {t('cfgf.f_firma')}:{' '}
                  <span className={dades?.firma_ruta ? 'text-exito' : 'text-muted-foreground'}>
                    {dades?.firma_ruta ? t('cfgf.asset_set') : t('cfgf.asset_pending')}
                  </span>
                </span>
                <span>
                  {t('cfgf.f_sello')}:{' '}
                  <span className={dades?.sello_ruta ? 'text-exito' : 'text-muted-foreground'}>
                    {dades?.sello_ruta ? t('cfgf.asset_set') : t('cfgf.asset_pending')}
                  </span>
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{t('cfgf.assets_help')}</p>
            </div>

            <Button
              className="h-11 whitespace-normal md:h-9"
              disabled={!potEditar || desant || !hiHaCanvis}
              onClick={() => void desa()}
            >
              {desant ? t('c.saving') : t('cfgf.save')}
            </Button>

            {/* ------------------------------------------------------------------
                El interruptor. Va al final y separado porque no es un campo más:
                es lo que abre la emisión de documentos con efecto fiscal.
               ------------------------------------------------------------------ */}
            <div className="space-y-2 border-t pt-4">
              <div className="text-sm font-semibold">{t('cfgf.prov_title')}</div>
              <FilaCasella
                checked={dades?.datos_provisionales !== false}
                disabled={!potEditar || desant
                  || (dades?.datos_provisionales !== false && (pendents.length > 0 || hiHaCanvis))}
                onChange={(v) => void canviaProvisionals(v)}
              >
                {t('cfgf.prov_label')}
              </FilaCasella>
              {/* El motivo va VISIBLE, no en un tooltip: en táctil no hay hover, y esta es
                  la única explicación de por qué la casilla está apagada. */}
              {dades?.datos_provisionales !== false && motiuBloqueig && (
                <p className="rounded-md border border-aviso/30 bg-aviso-fondo p-3 text-sm text-aviso">
                  {motiuBloqueig}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{t('cfgf.prov_help')}</p>
            </div>
          </>
        )}
        {dialeg}
      </CardContent>
    </Card>
  )
}
