// Ficha de la propia organización, para productor y receptor.
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

import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { useOrganitzacio } from '../hooks/useAppContext'
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
type Tria = 'auto' | 'whatsapp' | 'email'

const OPCIONS: { valor: Tria; labelKey: string; descKey: string }[] = [
  { valor: 'auto', labelKey: 'perf.channel_auto', descKey: 'perf.channel_auto_desc' },
  { valor: 'whatsapp', labelKey: 'perf.channel_whatsapp', descKey: 'perf.channel_whatsapp_desc' },
  { valor: 'email', labelKey: 'perf.channel_email', descKey: 'perf.channel_email_desc' },
]

/** Campos editables por tipo: los mismos que acepta la RPC correspondiente. */
const CAMPS = {
  productor: [
    { clave: 'name', labelKey: 'f.name', arg: 'p_name' },
    { clave: 'empresa', labelKey: 'f.empresa', arg: 'p_empresa' },
    { clave: 'email', labelKey: 'f.email', arg: 'p_email' },
    { clave: 'phone', labelKey: 'f.phone', arg: 'p_phone' },
    { clave: 'telefono_alt', labelKey: 'f.telefono_alt', arg: 'p_telefono_alt' },
    { clave: 'nif', labelKey: 'f.nif', arg: 'p_nif' },
    { clave: 'direccion', labelKey: 'f.direccion', arg: 'p_direccion' },
    { clave: 'codigo_postal', labelKey: 'f.codigo_postal', arg: 'p_codigo_postal' },
    { clave: 'poblacion', labelKey: 'f.poblacion', arg: 'p_poblacion' },
    { clave: 'area_geografica', labelKey: 'f.area_geografica', arg: 'p_area' },
  ],
  entidad: [
    { clave: 'nombre', labelKey: 'f.nombre', arg: 'p_nombre' },
    { clave: 'contacto', labelKey: 'f.contacto', arg: 'p_contacto' },
    { clave: 'telefono', labelKey: 'f.phone', arg: 'p_telefono' },
    { clave: 'email', labelKey: 'f.email', arg: 'p_email' },
    { clave: 'direccion', labelKey: 'f.direccion', arg: 'p_direccion' },
    { clave: 'codigo_postal', labelKey: 'f.codigo_postal', arg: 'p_codigo_postal' },
    { clave: 'poblacion', labelKey: 'f.poblacion', arg: 'p_poblacion' },
    { clave: 'horario', labelKey: 'f.horario', arg: 'p_horario' },
    { clave: 'calendari_repartiment', labelKey: 'f.calendari_repartiment', arg: 'p_calendari' },
  ],
} as const

export default function PerfilOrganitzacio({ tipus }: { tipus: 'productor' | 'entidad' }) {
  const { t } = useT()
  const organitzacio = useOrganitzacio(tipus)
  const [fila, setFila] = useState<Fila | null>(null)
  const [canal, setCanal] = useState<Tria>('auto')
  const [canalDesat, setCanalDesat] = useState<Tria>('auto')
  const [carregant, setCarregant] = useState(true)
  const [desant, setDesant] = useState(false)

  const tabla = tipus === 'productor' ? 'productores' : 'entidades'
  const camps = CAMPS[tipus]
  const potEditar = organitzacio?.rol_org === 'titular'

  // El aviso se calcula sobre lo que hay EN EL FORMULARIO, no sobre lo guardado: quien
  // acaba de teclear su móvil ya no debería seguir leyendo que no tiene ninguno.
  const clauTelefon = tipus === 'productor' ? 'phone' : 'telefono'
  const telefon = String(fila?.[clauTelefon] ?? '').trim()
  const correu = String(fila?.email ?? '').trim()
  const descripcio = OPCIONS.find((o) => o.valor === canal)?.descKey ?? 'perf.channel_auto_desc'

  // ⚠️ La dependencia del efecto es el **id**, no el objeto, y no es cosmética.
  // `useOrganitzacio()` saca ese objeto de `ctx.organitzacions`, que `useAppContext` rehace
  // ENTERO cada vez que recarga —y recarga con cada `SIGNED_IN`, que supabase-js reemite más
  // de una vez; §6ter ya documenta un fallo anterior por lo mismo—. Con el objeto como
  // dependencia, ese evento reejecuta este efecto y devuelve el formulario a lo guardado: lo
  // tecleado y el canal elegido desaparecen **sin decir nada**. Con el id, un contexto nuevo
  // que apunta a la misma organización no toca nada.
  // Observado una vez en producción (el canal volvió solo a «auto») y NO reproducible a
  // voluntad: esto no cierra esa observación, quita la fragilidad que la explicaría.
  const idOrganitzacio = organitzacio?.id ?? null

  useEffect(() => {
    // Volver a «cargando» y soltar la fila anterior es lo que impide enseñar —y guardar—
    // los datos de una organización con los campos de la otra.
    setCarregant(true)
    setFila(null)
    setCanal('auto')
    setCanalDesat('auto')
    if (!idOrganitzacio) { setCarregant(false); return }
    let viu = true
    void (async () => {
      const { data } = await supabase.from(tabla).select('*').eq('id', idOrganitzacio).maybeSingle()
      if (!viu) return
      const f = (data as Fila) ?? null
      setFila(f)

      // La preferencia vive en la organización, no en la ficha. Desde `20270313100000`
      // toda ficha tiene la suya —trigger + `not null`—, así que este `if` no protege de un
      // caso alcanzable: protege del día en que alguien desactive el trigger. Si faltara,
      // la pantalla se queda en «auto» y la RPC responde `22023` al guardar.
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
  }, [idOrganitzacio, tabla])

  async function desa() {
    if (!organitzacio || !fila) return
    setDesant(true)
    const args: Record<string, unknown> = { p_id: organitzacio.id }
    for (const c of camps) args[c.arg] = (fila[c.clave] as string) || null
    const { error } = await supabase.rpc(
      tipus === 'productor' ? 'actualizar_mi_productor' : 'actualizar_mi_entidad', args)
    if (error) { setDesant(false); toast.error(error.message); return }

    // Dos escrituras porque son dos tablas y dos listas blancas; la del canal solo si ha
    // cambiado, para no tocar `organizaciones` en cada «Desar».
    if (canal !== canalDesat) {
      const { data, error: errCanal } = await supabase.rpc('actualizar_meu_canal', {
        p_tipo: tipus,
        p_ficha: organitzacio.id,
        p_canal: canal === 'auto' ? null : canal,
      })
      if (errCanal) { setDesant(false); toast.error(errCanal.message); return }
      const org = data as { canal_preferido: Tria | null } | null
      setCanalDesat((org?.canal_preferido ?? 'auto') as Tria)
    }

    setDesant(false)
    toast.success(t('rec.saved'))
  }

  if (!organitzacio) return <p className="text-sm text-muted-foreground">{t('po.no_org')}</p>
  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

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
        <div className="grid gap-4 sm:grid-cols-2">
          {camps.map((c) => (
            <div key={c.clave}>
              <Label className="mb-1.5 block text-xs text-muted-foreground">{t(c.labelKey)}</Label>
              <Input
                value={String(fila?.[c.clave] ?? '')}
                disabled={!potEditar}
                onChange={(e) => setFila((f) => ({ ...(f ?? {}), [c.clave]: e.target.value }))}
              />
            </div>
          ))}
        </div>

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
                  no deshace el zoom al salir (§2, regla 1). El `SelectTrigger` de shadcn
                  trae `text-sm` fijo, pero `cn()` es tailwind-merge y se queda con el
                  último del mismo grupo, así que esto lo sustituye de verdad. La ALTURA no
                  se toca: `data-[size=default]:h-9` es un selector de atributo y ganaría
                  por especificidad a un `h-11` suelto — quedaría un override escrito que
                  no hace nada. El trigger se queda en los 36 px del resto (deuda §12.34). */}
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
