// Ficha de la propia organización, para productor y receptor.
//
// DESDE EL 27-09-2026 (revisión funcional del 23-09) va por secciones y con LISTAS CERRADAS
// donde el dato se cruza en el ERP: tipo de empresa en desplegable, municipio del
// nomenclátor oficial (de él salen solos población, comarca y área), NIF/correo/teléfono/CP
// validados antes de guardar, varios lugares de recogida para el productor, y los campos
// propios de cada tipo de receptor (`perfilReceptor.ts`). Guarda con
// `actualitzar_fitxa_productor` / `actualitzar_fitxa_entitat` (jsonb con lista blanca).
//
// No usa `RecordDetail` (que escribe directo en la tabla) porque un usuario externo no
// tiene permiso de UPDATE sobre `productores`/`entidades`: escribe por RPC con lista
// blanca de columnas, para que nadie pueda tocar `es_test`, `codigo` o `conveni`
// desde su panel (§4bis). Y solo el titular puede guardar.
//
// ⚠️ EL TIPO LLEGA POR PROP, NO SE DEDUCE. Esta misma pantalla es `/productor/perfil` y
// `/receptor/perfil`, y react-router no pone `key` a las rutas emparejadas: las dos
// cadenas de match tienen la misma forma, así que React reutiliza la instancia y CONSERVA
// EL ESTADO. Antes el tipo salía de la organización activa, de modo que al saltar de un
// panel al otro cambiaban la tabla y los campos pero `fila` seguía siendo la anterior;
// pulsar «Desar» en esa ventana escribía en la ficha correcta los datos de la otra y
// vaciaba todo lo que no coincidiera. El `key` del router y el `setFila(null)` de abajo
// cierran esa ventana; la prop, además, quita el ternario que caía en «entidad» por
// defecto.
//
// CANAL PREFERIDO (etapa 3 de la organización unificada, deuda §12.22). El canal se
// venía DEDUCIENDO de lo que hay en la ficha —móvil, opt-in, ventana de 24 h— en
// `_shared/canal.ts`, y la persona no tenía dónde decir el suyo. Ahora sí:
// `organizaciones.canal_preferido` ('whatsapp' | 'email' | null). Tres cosas que el
// diseño de esta parte da por sentadas:
//
//   1. **Es una preferencia, no una garantía.** WhatsApp exige ventana de 24 h abierta u
//      opt-in: son requisitos de Meta, no gustos nuestros (§8). Si no se cumplen, el
//      envío cae al correo igualmente. Eso se dice ARRIBA y en el mismo cuerpo de texto
//      que el resto, no en letra pequeña, porque la alternativa es que alguien elija
//      WhatsApp y crea que ya no se le escribirá por correo.
//   2. **`null` no es un hueco, es una opción con nombre**: «que lo decida Redestina»,
//      que es lo que más veces llega y por eso va primero y es el valor de fábrica.
//   3. **`organizaciones` no tiene GRANT de escritura para nadie** (§4): se guarda por la
//      RPC `actualizar_meu_canal`, con la misma guarda de titular que la autoedición de
//      la ficha.

import { useEffect, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { useWhatsappActiu } from '../hooks/useAppContext'
import { useOrganitzacio } from '../hooks/useAppContext'
import { errorCorreu, errorCp, errorNif, errorTelefon, normalitzaTelefon } from '../lib/validacio'
import { PERFIL_RECEPTOR, TIPUS_EMPRESA } from '../lib/perfilReceptor'
import type { CampPerfil } from '../lib/perfilReceptor'
import SelectorMunicipi from '../components/SelectorMunicipi'
import LlocsRecollida from '../components/LlocsRecollida'
import CampsPerfilReceptor from '../components/CampsPerfilReceptor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type Fila = Record<string, unknown>

/** `auto` es el sentinela de `canal_preferido = null`: Radix no admite `value=""`. */
type Tria = 'auto' | 'whatsapp' | 'email' | 'telefon'

const OPCIONS: { valor: Tria; labelKey: string; descKey: string }[] = [
  { valor: 'auto', labelKey: 'perf.channel_auto', descKey: 'perf.channel_auto_desc' },
  { valor: 'whatsapp', labelKey: 'perf.channel_whatsapp', descKey: 'perf.channel_whatsapp_desc' },
  { valor: 'email', labelKey: 'perf.channel_email', descKey: 'perf.channel_email_desc' },
  // Una preferencia para el EQUIPO: los avisos automáticos no pueden llamar, así que para
  // ellos vale como «auto» (20270402100000).
  { valor: 'telefon', labelKey: 'perf.channel_telefon', descKey: 'perf.channel_telefon_desc' },
]

type Tipus = 'text' | 'email' | 'tel' | 'nif' | 'cp' | 'tipus_empresa' | 'municipi'
interface Camp { clave: string; labelKey: string; tipus: Tipus; ajudaKey?: string }

/** Las secciones de cada ficha. Las claves son las columnas que acepta su RPC. */
const SECCIONS: Record<'productor' | 'entidad', { titolKey: string; camps: Camp[] }[]> = {
  productor: [
    {
      titolKey: 'org.sec_identitat',
      camps: [
        { clave: 'empresa', labelKey: 'org.f_nom_comercial', tipus: 'text' },
        { clave: 'razon_social', labelKey: 'org.f_rao_social', tipus: 'text', ajudaKey: 'org.h_rao_social' },
        { clave: 'nif', labelKey: 'f.nif', tipus: 'nif' },
        { clave: 'tipo_empresa', labelKey: 'org.f_tipus_empresa', tipus: 'tipus_empresa' },
      ],
    },
    {
      titolKey: 'org.sec_contacte',
      camps: [
        { clave: 'name', labelKey: 'org.f_persona_contacte', tipus: 'text' },
        { clave: 'email', labelKey: 'f.email', tipus: 'email' },
        { clave: 'phone', labelKey: 'org.f_telefon', tipus: 'tel' },
        { clave: 'telefono_alt', labelKey: 'org.f_telefon2', tipus: 'tel' },
      ],
    },
    {
      titolKey: 'org.sec_adreca',
      camps: [
        { clave: 'direccion', labelKey: 'f.direccion', tipus: 'text' },
        { clave: 'codigo_postal', labelKey: 'f.codigo_postal', tipus: 'cp' },
        { clave: 'municipio_ine', labelKey: 'org.f_municipi', tipus: 'municipi' },
      ],
    },
  ],
  entidad: [
    {
      titolKey: 'org.sec_identitat',
      camps: [
        { clave: 'nombre', labelKey: 'org.f_nom_comercial', tipus: 'text' },
        { clave: 'razon_social', labelKey: 'org.f_rao_social', tipus: 'text', ajudaKey: 'org.h_rao_social' },
        { clave: 'nif', labelKey: 'f.nif', tipus: 'nif' },
        { clave: 'tipo_entidad', labelKey: 'org.f_tipus_entitat', tipus: 'tipus_empresa' },
      ],
    },
    {
      titolKey: 'org.sec_contacte',
      camps: [
        { clave: 'contacto', labelKey: 'org.f_persona_contacte', tipus: 'text' },
        { clave: 'email', labelKey: 'f.email', tipus: 'email' },
        { clave: 'telefono', labelKey: 'org.f_telefon', tipus: 'tel' },
        { clave: 'horario', labelKey: 'org.f_horari', tipus: 'text' },
        { clave: 'calendari_repartiment', labelKey: 'f.calendari_repartiment', tipus: 'text' },
      ],
    },
    {
      titolKey: 'org.sec_adreca',
      camps: [
        { clave: 'direccion', labelKey: 'f.direccion', tipus: 'text' },
        { clave: 'codigo_postal', labelKey: 'f.codigo_postal', tipus: 'cp' },
        { clave: 'municipio_ine', labelKey: 'org.f_municipi', tipus: 'municipi' },
      ],
    },
  ],
}

/** El error de un campo, como clave i18n, o null. */
function errorDe(c: Camp, valor: string): string | null {
  if (c.tipus === 'nif') return errorNif(valor)
  if (c.tipus === 'email') return errorCorreu(valor)
  if (c.tipus === 'tel') return errorTelefon(valor)
  if (c.tipus === 'cp') return errorCp(valor)
  return null
}

export default function PerfilOrganitzacio({ tipus }: { tipus: 'productor' | 'entidad' }) {
  const { t } = useT()
  const waActiu = useWhatsappActiu()
  const organitzacio = useOrganitzacio(tipus)
  const [fila, setFila] = useState<Fila | null>(null)
  const [perfil, setPerfil] = useState<Record<string, unknown>>({})
  const [canal, setCanal] = useState<Tria>('auto')
  const [canalDesat, setCanalDesat] = useState<Tria>('auto')
  const [carregant, setCarregant] = useState(true)
  const [desant, setDesant] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const tabla = tipus === 'productor' ? 'productores' : 'entidades'
  const seccions = SECCIONS[tipus]
  const potEditar = organitzacio?.rol_org === 'titular'

  // El aviso se calcula sobre lo que hay EN EL FORMULARIO, no sobre lo guardado: quien
  // acaba de teclear su móvil ya no debería seguir leyendo que no tiene ninguno.
  const clauTelefon = tipus === 'productor' ? 'phone' : 'telefono'
  const telefon = String(fila?.[clauTelefon] ?? '').trim()
  const correu = String(fila?.email ?? '').trim()
  const descripcio = OPCIONS.find((o) => o.valor === canal)?.descKey ?? 'perf.channel_auto_desc'
  const tipusReceptor = tipus === 'entidad' ? String(fila?.tipo_receptor ?? '') : ''
  const campsPerfil: readonly CampPerfil[] = PERFIL_RECEPTOR[tipusReceptor] ?? []

  // ⚠️ La dependencia del efecto es el **id**, no el objeto, y no es cosmética.
  // `useOrganitzacio()` saca ese objeto de `ctx.organitzacions`, que `useAppContext` rehace
  // ENTERO cada vez que recarga. Con el objeto como dependencia, ese evento reejecuta este
  // efecto y devuelve el formulario a lo guardado: lo tecleado desaparece sin decir nada.
  const idOrganitzacio = organitzacio?.id ?? null

  useEffect(() => {
    // Volver a «cargando» y soltar la fila anterior es lo que impide enseñar —y guardar—
    // los datos de una organización con los campos de la otra.
    setCarregant(true)
    setFila(null)
    setPerfil({})
    setErrors({})
    setCanal('auto')
    setCanalDesat('auto')
    if (!idOrganitzacio) { setCarregant(false); return }
    let viu = true
    void (async () => {
      const { data } = await supabase.from(tabla).select('*').eq('id', idOrganitzacio).maybeSingle()
      if (!viu) return
      const f = (data as Fila) ?? null
      setFila(f)
      setPerfil(((f?.perfil_receptor as Record<string, unknown> | null) ?? {}))


      // La preferencia vive en la organización, no en la ficha (§4).
      const orgId = (f?.organizacion_id as string | null) ?? null
      if (orgId) {
        const { data: org } = await supabase
          .from('organizaciones')
          .select('id, canal_preferido')
          .eq('id', orgId)
          .maybeSingle()
        if (!viu) return
        const tria = ((org as { canal_preferido: Tria | null } | null)?.canal_preferido ?? 'auto') as Tria
        setCanal(tria)
        setCanalDesat(tria)
      }
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [idOrganitzacio, tabla, tipus])

  const campsTots = useMemo(() => seccions.flatMap((s) => s.camps), [seccions])

  // Del código postal sale el municipio cuando no hay duda: si el CP apunta a UNO solo
  // (el 82 % de los de Catalunya, `codis_postals`), se elige sin preguntar. Si apunta a
  // varios no se elige ninguno —sería escribir algo que nadie ha dicho—: se elige de la lista.
  // Sustituye a la sugerencia de población de antes, que rellenaba texto libre.
  const cp = String(fila?.codigo_postal ?? '')
  const teMunicipi = Boolean(fila?.municipio_ine)
  useEffect(() => {
    if (!potEditar || teMunicipi || !/^\d{5}$/.test(cp)) return
    let viu = true
    void supabase.from('codis_postals').select('codi_ine').eq('codi_postal', cp).then(({ data }) => {
      const files = (data ?? []) as { codi_ine: string }[]
      if (viu && files.length === 1) setFila((f) => ({ ...(f ?? {}), municipio_ine: files[0].codi_ine }))
    })
    return () => { viu = false }
  }, [cp, teMunicipi, potEditar])

  function setCamp(clave: string, valor: unknown) {
    setFila((f) => ({ ...(f ?? {}), [clave]: valor }))
    if (errors[clave]) setErrors((e) => { const n = { ...e }; delete n[clave]; return n })
  }

  async function desa() {
    if (!organitzacio || !fila) return
    // Antes de llamar a nadie: lo que está mal escrito, dicho campo por campo.
    const nous: Record<string, string> = {}
    for (const c of campsTots) {
      const e = errorDe(c, String(fila[c.clave] ?? ''))
      if (e) nous[c.clave] = e
    }
    setErrors(nous)
    if (Object.keys(nous).length > 0) {
      toast.error(t('org.fix_errors'))
      document.getElementById(`po-${tipus}-${Object.keys(nous)[0]}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setDesant(true)
    const dades: Record<string, unknown> = {}
    for (const c of campsTots) {
      const v = fila[c.clave]
      dades[c.clave] = c.tipus === 'tel' ? normalitzaTelefon(String(v ?? '')) || null : (v ?? null)
    }
    if (tipus === 'entidad') dades.perfil_receptor = perfil
    const { data, error } = await supabase.rpc(
      tipus === 'productor' ? 'actualitzar_fitxa_productor' : 'actualitzar_fitxa_entitat',
      { p_id: organitzacio.id, p_dades: dades },
    )
    if (error) { setDesant(false); toast.error(error.message); return }
    // Lo que devuelve la base ya trae población y área derivadas del municipio.
    if (data) setFila(data as Fila)

    // Dos escrituras porque son dos tablas y dos listas blancas; la del canal solo si ha
    // cambiado, para no tocar `organizaciones` en cada «Desar».
    if (canal !== canalDesat) {
      const { data: o, error: errCanal } = await supabase.rpc('actualizar_meu_canal', {
        p_tipo: tipus,
        p_ficha: organitzacio.id,
        p_canal: canal === 'auto' ? null : canal,
      })
      if (errCanal) { setDesant(false); toast.error(errCanal.message); return }
      const org = o as { canal_preferido: Tria | null } | null
      setCanalDesat((org?.canal_preferido ?? 'auto') as Tria)
    }

    setDesant(false)
    toast.success(t('rec.saved'))
  }

  if (!organitzacio) return <p className="text-sm text-muted-foreground">{t('po.no_org')}</p>
  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  const idDe = (clave: string) => `po-${tipus}-${clave}`
  const selectClasses = 'w-full text-base md:text-sm'

  function control(c: Camp) {
    const valor = String(fila?.[c.clave] ?? '')
    const invalid = Boolean(errors[c.clave])
    if (c.tipus === 'municipi') {
      return (
        <>
          <SelectorMunicipi id={idDe(c.clave)} valor={(fila?.municipio_ine as string | null) ?? null}
            onChange={(m) => setCamp('municipio_ine', m?.codi_ine ?? null)} />
          {/* Lo que había escrito a mano antes de que existiera la lista: se enseña para que
              se sepa qué municipio elegir, y desaparece al guardar uno oficial. */}
          {!fila?.municipio_ine && fila?.poblacion ? (
            <p className="mt-1 text-xs text-muted-foreground">{t('org.h_poblacio_antiga', { x: String(fila.poblacion) })}</p>
          ) : null}
        </>
      )
    }
    if (c.tipus === 'tipus_empresa') {
      // Un valor de antes de la lista (texto libre del import) se conserva como opción
      // propia: si no, el desplegable lo mostraría vacío y se perdería al guardar.
      const llegat = valor && !(TIPUS_EMPRESA as readonly string[]).includes(valor) ? valor : null
      return (
        <Select value={valor || undefined} disabled={!potEditar} onValueChange={(v) => setCamp(c.clave, v)}>
          <SelectTrigger id={idDe(c.clave)} className={selectClasses}><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {llegat && <SelectItem value={llegat} className="text-base md:text-sm">{llegat}</SelectItem>}
            {TIPUS_EMPRESA.map((te) => (
              <SelectItem key={te} value={te} className="text-base md:text-sm">{t(`org.te_${te}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    return (
      <Input
        id={idDe(c.clave)}
        name={c.clave}
        value={valor}
        disabled={!potEditar}
        aria-invalid={invalid}
        type={c.tipus === 'email' ? 'email' : c.tipus === 'tel' ? 'tel' : 'text'}
        // Hay fichas (las de prueba, algunas importadas) con el nombre de la organización en
        // `name` y `empresa` vacío: se sugiere, sin escribirlo, para que no parezca que no hay.
        placeholder={c.clave === 'empresa' && !valor ? String(fila?.name ?? '') : undefined}
        inputMode={c.tipus === 'cp' ? 'numeric' : c.tipus === 'tel' ? 'tel' : undefined}
        autoComplete={c.tipus === 'email' ? 'email' : c.tipus === 'tel' ? 'tel' : undefined}
        onChange={(e) => setCamp(c.clave, e.target.value)}
      />
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>
            {organitzacio.nombre ?? t(tipus === 'productor' ? 'nav.my_producer_org' : 'nav.my_entity')}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {potEditar ? t('perf.subtitle') : t('perf.read_only')}
          </p>
        </div>
        {potEditar && (
          <Button onClick={() => void desa()} disabled={desant} className="min-h-11 whitespace-normal">
            {desant ? t('c.saving') : t('c.save')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-8">
        {seccions.map((sec) => (
          <section key={sec.titolKey} className="space-y-3">
            <h3 className="text-base font-semibold">{t(sec.titolKey)}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {sec.camps.map((c) => (
                <div key={c.clave}>
                  <Label htmlFor={idDe(c.clave)} className="mb-1.5 block text-xs text-muted-foreground">{t(c.labelKey)}</Label>
                  {control(c)}
                  {errors[c.clave] && <p className="mt-1 text-xs text-destructive">{t(errors[c.clave])}</p>}
                  {c.ajudaKey && !errors[c.clave] && <p className="mt-1 text-xs text-muted-foreground">{t(c.ajudaKey)}</p>}
                </div>
              ))}
              {/* El área no se teclea: sale del municipio (la comarca), que es la
                  segmentación que compara la priorización. */}
              {sec.titolKey === 'org.sec_adreca' && (
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">{t('org.f_area')}</p>
                  <p className="text-sm font-medium">{String(fila?.area_geografica ?? '—')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('org.h_area')}</p>
                </div>
              )}
            </div>
            {/* El tipo de receptor decide qué ofertas ve: lo decide el equipo. */}
            {sec.titolKey === 'org.sec_identitat' && tipus === 'entidad' && (
              <p className="text-sm text-muted-foreground">
                {t('org.tipus_receptor', { x: tipusReceptor ? t(`org.tr_${tipusReceptor}`) : '—' })}
              </p>
            )}
          </section>
        ))}

        {tipus === 'productor' && (
          <section className="space-y-3 border-t border-border pt-6">
            <div>
              <h3 className="text-base font-semibold">{t('org.sec_llocs')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('org.h_llocs')}</p>
            </div>
            <LlocsRecollida productorId={organitzacio.id} potEditar={potEditar} idPrefix="org-lloc" />
          </section>
        )}

        {tipus === 'entidad' && campsPerfil.length > 0 && (
          <section className="space-y-3 border-t border-border pt-6">
            <div>
              <h3 className="text-base font-semibold">{t(`org.sec_perfil_${tipusReceptor}`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('org.h_perfil')}</p>
            </div>
            <CampsPerfilReceptor tipusReceptor={tipusReceptor} perfil={perfil}
              onChange={setPerfil} disabled={!potEditar} />
          </section>
        )}

        <section className="space-y-3 border-t border-border pt-6">
          <div>
            <h3 className="text-base font-semibold">{t('perf.channel_title')}</h3>
            {/* La frase que enmarca la elección: se elige por dónde se PRUEBA primero. */}
            <p className="mt-1 text-sm text-muted-foreground">{t('perf.channel_help')}</p>
          </div>

          <div className="max-w-sm">
            <Label htmlFor="canal-preferit" className="mb-1.5 block text-xs text-muted-foreground">
              {t('perf.channel_label')}
            </Label>
            <Select
              value={canal}
              disabled={!potEditar}
              onValueChange={(v) => setCanal(v as Tria)}
            >
              {/* text-base en móvil: por debajo de 16 px iOS amplía la página al enfocar y
                  no deshace el zoom al salir (§2, regla 1). */}
              <SelectTrigger id="canal-preferit" className="w-full text-base md:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPCIONS.map((o) => (
                  <SelectItem key={o.valor} value={o.valor} className="text-base md:text-sm">
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-2 text-sm text-muted-foreground">{t(descripcio)}</p>
          </div>

          {canal === 'whatsapp' && (
            <Alert className="border-aviso/30 bg-aviso-fondo text-aviso">
              <Info />
              <AlertTitle className="line-clamp-none whitespace-normal">{t('perf.channel_limits_title')}</AlertTitle>
              <AlertDescription className="text-aviso">
                <p>{t('perf.channel_limits')}</p>
                {!telefon && <p>{t('perf.channel_no_phone')}</p>}
                {/* La opción sigue ahí: la preferencia se guarda y vuelve a valer cuando
                    se reactive el canal. Lo que no se puede es callar que hoy no se
                    cumplirá (§8bis: una preferencia ignorada en silencio es peor). */}
                {!waActiu && <p>{t('perf.channel_wa_off')}</p>}
              </AlertDescription>
            </Alert>
          )}

          {!correu && (
            <Alert className="border-aviso/30 bg-aviso-fondo text-aviso">
              <Info />
              <AlertTitle className="line-clamp-none whitespace-normal">{t('perf.channel_no_email_title')}</AlertTitle>
              <AlertDescription className="text-aviso">
                <p>{t('perf.channel_no_email')}</p>
              </AlertDescription>
            </Alert>
          )}
        </section>
      </CardContent>
    </Card>
  )
}
