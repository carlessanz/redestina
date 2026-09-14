// Alta de oferta desde el panel del productor.
//
// Hace exactamente las mismas preguntas que el bot de WhatsApp porque no las lleva
// escritas: las pide a la Edge Function `crear-oferta`, que las sirve desde el mismo
// descriptor (`_shared/camposOferta.ts`). Si mañana el intake gana un paso, este
// formulario lo gana solo.
//
// Se presenta como una sola página con secciones, NO como un asistente paso a paso: en
// WhatsApp la conversación impone el ritmo, pero en pantalla ver el conjunto y poder
// corregir es mejor. Lo que sí se agrupa es la lectura —producto, cantidad, recogida,
// modalidad, causa— porque catorce campos seguidos en dos columnas no se leen como un
// cuestionario, se leen como un formulario administrativo.
//
// ⚠️ LAS SECCIONES SON OPCIONALES A PROPÓSITO. El descriptor las sirve desde el servidor
//    y este fichero se despliega antes que la función (§11: base → funciones → frontend),
//    así que durante un rato la respuesta puede no traer `secciones` ni `seccion`. Sin
//    ellas se pinta un solo bloque sin título, que es exactamente lo que había antes; con
//    ellas, los cinco bloques. Nada falla por el camino.
//
// Y publicar ya no termina en un toast que se va solo: la referencia, qué pasa a
// continuación y por dónde seguir viven en el detalle de la oferta (`BlocPublicada`), que
// es una pantalla que se puede volver a mirar.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { useConveni } from '../../hooks/useConveni'
import { carregaCamps, creaOferta } from '../../lib/ofertes'
import type { BlocOferta, CampoOferta, CatalogosOferta } from '../../lib/ofertes'
import { PASSOS_OFERTA_CLAUS, puntOferta } from '../../lib/procesOferta'
import PasosProces from '../../components/proces/PasosProces'
import QueTocaAra from '../../components/proces/QueTocaAra'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

type Datos = Record<string, unknown>

/** Quien ya ha publicado alguna vez no necesita releer el proceso cada vez. */
const CLAU_PROCES_VIST = 'redestina-proces-vist'

function procesJaVist(): boolean {
  try { return localStorage.getItem(CLAU_PROCES_VIST) === 'si' } catch { return false }
}

function marcaProcesVist() {
  // Safari en navegación privada lanza al tocar `localStorage`: que no se pueda recordar
  // la preferencia no puede impedir publicar.
  try { localStorage.setItem(CLAU_PROCES_VIST, 'si') } catch { /* ver arriba */ }
}

function aplica(campo: CampoOferta, datos: Datos): boolean {
  if (!campo.condicion) return true
  return campo.condicion.en.includes(String(datos[campo.condicion.campo] ?? ''))
}

/**
 * Los campos repartidos en bloques, respetando el orden en que llegan.
 *
 * Si ningún campo trae `seccion`, sale un único bloque sin título: el formulario de antes.
 */
function agrupa(
  campos: CampoOferta[],
  seccions: BlocOferta[],
): { clau: string; titol?: string; descripcio?: string; camps: CampoOferta[] }[] {
  const index = new Map<string, BlocOferta>(seccions.map((s) => [s.clau, s]))
  const ordre: string[] = []
  const per = new Map<string, CampoOferta[]>()
  for (const c of campos) {
    const clau = c.seccion ?? ''
    if (!per.has(clau)) { per.set(clau, []); ordre.push(clau) }
    per.get(clau)!.push(c)
  }
  return ordre.map((clau) => ({
    clau,
    titol: index.get(clau)?.titol,
    descripcio: index.get(clau)?.descripcio,
    camps: per.get(clau) ?? [],
  }))
}

export default function NovaOferta() {
  const { t } = useT()
  const { bloqueja } = useConveni()
  const navigate = useNavigate()
  const organitzacio = useOrganitzacio('productor')
  const [campos, setCampos] = useState<CampoOferta[]>([])
  const [seccions, setSeccions] = useState<BlocOferta[]>([])
  const [catalogos, setCatalogos] = useState<CatalogosOferta | null>(null)
  const [datos, setDatos] = useState<Datos>({})
  const [carregant, setCarregant] = useState(true)
  const [enviant, setEnviant] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [procesObert, setProcesObert] = useState(() => !procesJaVist())

  const productorId = organitzacio?.id ?? null

  useEffect(() => {
    if (!productorId) { setCarregant(false); return }
    let viu = true
    void carregaCamps(productorId).then((r) => {
      if (!viu) return
      if (!r.ok || !r.data) setError(r.error ?? t('c.error'))
      else {
        setCampos(r.data.campos)
        // Puede no venir: la función se despliega después que esta pantalla.
        setSeccions(r.data.secciones ?? [])
        setCatalogos(r.data.catalogos)
      }
      setCarregant(false)
    })
    return () => { viu = false }
  }, [productorId, t])

  const productesDeFamilia = useMemo(() => {
    const familia = String(datos.familia ?? '')
    return (catalogos?.productos ?? []).filter((p) => !familia || p.familia === familia)
  }, [catalogos, datos.familia])

  function set(clave: string, valor: unknown) {
    setDatos((d) => {
      const nou = { ...d, [clave]: valor }
      // Cambiar de familia invalida el producto elegido.
      if (clave === 'familia') delete nou.producte
      return nou
    })
  }

  async function enviar() {
    if (!productorId) return
    setEnviant(true)
    setError(null)
    const r = await creaOferta(productorId, datos)
    setEnviant(false)
    if (!r.ok || !r.data) {
      setError(r.error ?? t('c.error'))
      toast.error(r.error ?? t('c.error'))
      return
    }
    marcaProcesVist()
    // Sin toast: lo que hay que decir —la referencia, qué pasa ahora y por dónde seguir—
    // no cabe en un aviso que se va solo. Lo cuenta `BlocPublicada` en el detalle, que
    // además se puede volver a mirar. La confirmación por correo solo se promete si ha
    // salido de verdad (sin correo en la ficha, o modo test, no sale).
    navigate(`/productor/ofertes/${r.data.id}`, {
      state: { publicada: true, correuEnviat: r.data.confirmacio_email === 'enviat' },
    })
  }

  if (!productorId) {
    return <p className="text-sm text-muted-foreground">{t('po.no_org')}</p>
  }
  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  function control(campo: CampoOferta) {
    const valor = datos[campo.clave]
    // ⚠️ `text-base md:text-sm` NO es cosmético: iOS Safari amplía la página al enfocar
    // cualquier control por debajo de 16px, y como el viewport renuncia a propósito a
    // `maximum-scale` (accesibilidad), NO deshace el zoom al salir del campo. Con
    // `text-sm` a secas, tocar el primer desplegable dejaba el resto del formulario —13
    // campos— ampliado y desplazándose en horizontal. Es el mismo patrón que ya usa
    // `components/ui/input.tsx`, y por eso los <input> nunca tuvieron el problema.
    // La altura pasa de h-10 a h-9 para que dejen de alternar con los Input.
    const comuns = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm'

    switch (campo.tipo) {
      case 'familia':
        return (
          <select className={comuns}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
            <option value="">—</option>
            {(catalogos?.familias ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )
      case 'producte':
        return (
          <select className={comuns}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}
            disabled={!datos.familia}>
            <option value="">—</option>
            {productesDeFamilia.map((p) => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
          </select>
        )
      case 'causa':
        return (
          <select className={comuns}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
            <option value="">—</option>
            {(catalogos?.causas ?? []).map((c) => (
              <option key={c.codigo} value={c.codigo}>{c.nombre ?? c.codigo}</option>
            ))}
          </select>
        )
      case 'ubicacio':
        return (catalogos?.ubicaciones ?? []).length > 0 ? (
          <select className={comuns}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
            <option value="">—</option>
            {(catalogos?.ubicaciones ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.alias ?? u.municipio ?? 'Ubicació'}</option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-muted-foreground">{t('po.no_locations')}</p>
        )
      case 'opcions': {
        // La explicación de la opción ELEGIDA va debajo del control, no en el <option>:
        // un `<option>` no admite más que texto plano, y las tres modalidades deciden qué
        // entidades pueden recibir la oferta y qué documento se genera.
        const triada = (campo.opciones ?? []).find((o) => o.id === String(valor ?? ''))
        return (
          <>
            <select className={comuns}
              value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
              <option value="">—</option>
              {(campo.opciones ?? []).map((o) => <option key={o.id} value={o.id}>{o.titulo}</option>)}
            </select>
            {triada?.descripcion && (
              <p className="mt-1 text-xs text-muted-foreground">{triada.descripcion}</p>
            )}
          </>
        )
      }
      case 'numero':
        return (
          <Input type="number" step="0.01" min="0" value={valor == null ? '' : String(valor)}
            onChange={(e) => set(campo.clave, e.target.value === '' ? null : Number(e.target.value))} />
        )
      default:
        return campo.clave === 'observacions'
          ? <Textarea rows={3} value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)} />
          : <Input type="text" value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)} />
    }
  }

  const visibles = campos.filter((c) => aplica(c, datos))
  const blocs = agrupa(visibles, seccions)
  // El punto de partida: una oferta recién publicada, sin nadie interesado todavía. Sale
  // del mismo módulo que lo cuenta después en el detalle, así que lo que se promete aquí
  // y lo que se ve luego son la misma frase.
  const puntInicial = puntOferta(
    { estado: 'publicada', kgTotal: 0, kgCanalitzats: 0 }, 'productor',
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('po.new_title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('po.new_intro')}</p>
      </div>

      {/* --- Qué pasa cuando publicas. Abierto la primera vez; después, plegado: quien ya
              conoce el circuito no necesita releerlo cada vez que trae producto. --- */}
      <Collapsible open={procesObert} onOpenChange={setProcesObert}>
        {/* Tarjeta a mano y no `Card`: el disparador tiene que llevar ÉL el relleno para
            que el área táctil sea la fila entera; con el `py-6` de `Card` el padding es
            del contenedor y solo se podría pulsar el texto. */}
        <div className="rounded-xl border bg-card shadow-sm">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-4 text-left">
            <span className="font-titulos text-base font-semibold">{t('po.what_happens')}</span>
            <ChevronDown
              className={cn('size-4 shrink-0 transition-transform', procesObert && 'rotate-180')}
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 px-4 pb-4">
              <PasosProces etapes={PASSOS_OFERTA_CLAUS} actual={0} />
              <QueTocaAra punt={puntInicial} compacte />
              <p className="text-sm text-muted-foreground">{t('po.what_happens_end')}</p>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* --- El cuestionario, por bloques --- */}
      {blocs.map((bloc) => (
        <Card key={bloc.clau || 'tot'}>
          {bloc.titol && (
            <CardHeader>
              <CardTitle className="text-base">{bloc.titol}</CardTitle>
              {bloc.descripcio && (
                <p className="mt-1 text-xs text-muted-foreground">{bloc.descripcio}</p>
              )}
            </CardHeader>
          )}
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {bloc.camps.map((campo) => (
              <div
                key={campo.clave}
                className={campo.clave === 'observacions' ? 'sm:col-span-2' : undefined}
              >
                {/* Sin asterisco: el formulario es mínimo y todo lo que aparece hace
                    falta, así que lo que se marca es lo que se puede dejar en blanco
                    (design/DESIGN.md §6). */}
                <Label className="mb-1.5 block text-xs text-muted-foreground">
                  {campo.etiqueta}
                  {!campo.obligatorio && <span className="ml-1">{t('po.optional')}</span>}
                </Label>
                {control(campo)}
                {campo.ayuda && <p className="mt-1 text-xs text-muted-foreground">{campo.ayuda}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* --- El pie se queda a la vista: con cinco bloques, el botón de publicar cae muy
              por debajo del pliegue en un móvil. `env(safe-area-inset-bottom)` porque el
              viewport va a `viewport-fit=cover` (§2). --- */}
      <div
        className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {/* Desde la fecha de corte, sin convenio vigente la RPC devuelve 42501: el
            botón se apaga para no dejar al productor delante de un error. */}
        <Button
          className="h-11 whitespace-normal md:h-9"
          onClick={() => void enviar()}
          disabled={enviant || bloqueja}
          title={bloqueja ? t('avis_conv.bloquejat') : undefined}
        >
          {enviant ? t('c.saving') : t('po.publish')}
        </Button>
        <Button
          variant="outline"
          className="h-11 whitespace-normal md:h-9"
          onClick={() => navigate('/productor/ofertes')}
        >
          {t('c.cancel')}
        </Button>
      </div>
    </div>
  )
}
