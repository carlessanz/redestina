// El cuestionario de alta de una oferta. Se usa en DOS sitios y es el mismo código:
//
//   · `/productor/ofertes/nova`, el panel del productor.
//   · Desde el panel del equipo, en el alta **asistida**: el dinamizador la publica en
//     nombre de la organización, con ella al teléfono (modelo asistido, §1bis).
//
// SE PARTIÓ POR UNA RAZÓN CONCRETA: `productorId` salía de `useOrganitzacio('productor')`,
// que un interno NO TIENE —el equipo no es una organización—, así que esta pantalla era
// literalmente inalcanzable para quien opera en nombre de otros. Ahora entra por prop y el
// resto es idéntico: la Edge Function `crear-oferta` ya aceptaba al equipo y ya sellaba
// `canal = 'asistido'`; lo único que faltaba era la interfaz.
//
// Hace exactamente las mismas preguntas que el bot de WhatsApp porque no las lleva
// escritas: las pide a `crear-oferta`, que las sirve desde el mismo descriptor
// (`_shared/camposOferta.ts`). Si mañana el intake gana un paso, este formulario lo gana
// solo.
//
// SE PRESENTA POR PASOS, una sección cada vez (revisión funcional del 23-09-2026: «el
// formulario es bastante largo y puede resultar overwhelming, especialmente en móvil»).
// Antes era una sola página con las cinco secciones: se veía el conjunto, pero en un móvil
// eran metros de scroll. Ahora cada sección se valida al pulsar «Continuar» y los títulos de
// arriba dejan volver a una ya vista para corregir. El orden es el de `PASOS`, el mismo que
// recorre el bot.
//
// ⚠️ LAS SECCIONES SON OPCIONALES A PROPÓSITO. El descriptor las sirve desde el servidor
//    y este fichero se despliega antes que la función (§11: base → funciones → frontend),
//    así que durante un rato la respuesta puede no traer `secciones` ni `seccion`. Sin
//    ellas se pinta un solo bloque sin título, que es exactamente lo que había antes; con
//    ellas, los cinco bloques. Nada falla por el camino.
//
// ⚠️ EL BLOQUEO POR CONVENIO ENTRA POR PROP, no se lee aquí. `useConveni` mira las
//    organizaciones DE LA CUENTA, y la del equipo no tiene ninguna: leerlo dentro daría
//    `false` siempre para el alta asistida y dejaría al dinamizador delante de un `42501`
//    que la pantalla podía haber anticipado.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { varietatSemblaQuantitat } from '../lib/validacio'
import { cn } from '../lib/utils'
import {
  aplicaCamp as aplica, carregaCamps, creaOferta, creaUbicacio, etiquetaFamilia, localitzaDescriptor,
} from '../lib/ofertes'
import type { Municipi } from '../lib/municipis'
import SelectorMunicipi from './SelectorMunicipi'
import { IconaProducte, SelectorFotos } from './FotosOferta'
import { eurKg } from '../lib/tancament'
import type { BlocOferta, CampoOferta, CatalogosOferta } from '../lib/ofertes'
import { PASSOS_OFERTA_CLAUS, puntOferta } from '../lib/procesOferta'
import PasosProces from './proces/PasosProces'
import QueTocaAra from './proces/QueTocaAra'
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

/**
 * El BORRADOR del alta, en `sessionStorage` (29-09-2026). En un iPhone, abrir la cámara o la
 * galería para la foto puede hacer que Safari descarte la pestaña por memoria y la recargue
 * al volver: el formulario volvía al paso 1 vacío, y al pulsar «Continuar» parecía un bucle.
 * Con el borrador, la recarga devuelve lo escrito y el paso. Por productor (el alta asistida
 * del equipo puede abrir varios) y solo 24 h. `sessionStorage` y no `localStorage`: sobrevive
 * a la recarga de la pestaña, no se queda en un móvil compartido.
 */
const PREFIX_ESBORRANY = 'redestina-oferta-esborrany:'
const VIDA_ESBORRANY_MS = 24 * 3600 * 1000

interface Esborrany { datos: Datos; pas: number; pasMaxim: number; costTocat: boolean; desat: number }

function llegeixEsborrany(productorId: string): Esborrany | null {
  try {
    const cru = sessionStorage.getItem(PREFIX_ESBORRANY + productorId)
    if (!cru) return null
    const e = JSON.parse(cru) as Esborrany
    if (!e || typeof e !== 'object' || !e.datos || Date.now() - e.desat > VIDA_ESBORRANY_MS) return null
    return e
  } catch { return null }
}

function desaEsborrany(productorId: string, e: Omit<Esborrany, 'desat'>) {
  try {
    if (Object.keys(e.datos).length === 0) sessionStorage.removeItem(PREFIX_ESBORRANY + productorId)
    else sessionStorage.setItem(PREFIX_ESBORRANY + productorId, JSON.stringify({ ...e, desat: Date.now() }))
  } catch { /* Safari privado: sin borrador, pero se puede publicar igual */ }
}

function esborraEsborrany(productorId: string) {
  try { sessionStorage.removeItem(PREFIX_ESBORRANY + productorId) } catch { /* ídem */ }
}

function marcaProcesVist() {
  // Safari en navegación privada lanza al tocar `localStorage`: que no se pueda recordar
  // la preferencia no puede impedir publicar.
  try { localStorage.setItem(CLAU_PROCES_VIST, 'si') } catch { /* ver arriba */ }
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

export interface ResultatNovaOferta {
  id: string
  /** `enviat` cuando la confirmación por correo salió de verdad. */
  confirmacio_email?: string | null
}

export interface PropsFormulariNovaOferta {
  /** De quién es la oferta. En el panel sale de la organización; en el alta asistida, del
   *  productor que el equipo ha elegido. */
  productorId: string | null
  /**
   * Desde la fecha de corte, sin ningún convenio vigente no se publica. ⚠️ Lo impone ESTA
   * pantalla, no `crear-oferta`, que hoy no lo comprueba: la base solo corta más tarde, al
   * aprobar un interés (`aprovar_resposta` → `exigir_convenio`, `42501 sense_conveni`).
   */
  bloqueja?: boolean
  /**
   * Por qué no se puede publicar CON ESTA MODALIDAD (clave i18n), o null. La venta y la
   * maquila exigen el convenio `com` a quien entrega (`convenios_exigidos`): con solo el de
   * donación vigente la oferta circularía y el interés chocaría con `sense_conveni` al
   * aprobarlo. Lo pasa quien sabe los convenios de la organización (el panel del productor).
   */
  motiuModalitat?: (modalitat: string) => string | null
  /** Qué hacer con la oferta recién creada. Quien monta el formulario decide a dónde va. */
  onCreada: (r: ResultatNovaOferta) => void
  /** Si no se pasa, no se pinta el botón de cancelar. */
  onCancel?: () => void
}

export default function FormulariNovaOferta(
  { productorId, bloqueja = false, motiuModalitat, onCreada, onCancel }: PropsFormulariNovaOferta,
) {
  const { t, lang } = useT()
  // El descriptor tal como llega (catalán + castellano), y debajo, en el idioma de la pantalla.
  const [campsCrus, setCampos] = useState<CampoOferta[]>([])
  const [seccionsCrues, setSeccions] = useState<BlocOferta[]>([])
  const [catalogosCrus, setCatalogos] = useState<CatalogosOferta | null>(null)
  const { campos, seccions, catalogos } = useMemo(
    () => localitzaDescriptor(campsCrus, seccionsCrues, catalogosCrus, lang),
    [campsCrus, seccionsCrues, catalogosCrus, lang],
  )
  const [datos, setDatos] = useState<Datos>({})
  const [carregant, setCarregant] = useState(true)
  /** Hasta leer el borrador no se escribe: si no, el primer render lo pisaría con `{}`. */
  const recuperat = useRef(false)
  const [enviant, setEnviant] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [procesObert, setProcesObert] = useState(() => !procesJaVist())
  // Qué claves faltan por rellenar, para marcarlas en rojo y decir cuáles son. Vacío = no
  // se ha intentado publicar todavía, o ya está todo (§12.123).
  const [campsFaltants, setCampsFaltants] = useState<Set<string>>(new Set())
  /** La sección que se está rellenando, y la más avanzada a la que se ha llegado. */
  const [pas, setPas] = useState(0)
  const [pasMaxim, setPasMaxim] = useState(0)
  const dalt = useRef<HTMLDivElement>(null)
  /** El mini-formulario de «un lloc nou», dentro del paso de recogida. */
  const [llocNou, setLlocNou] = useState<{ alias: string; maps: string; municipi: Municipi | null } | null>(null)
  const [desantLloc, setDesantLloc] = useState(false)

  useEffect(() => {
    if (!productorId) { setCarregant(false); return }
    let viu = true
    void carregaCamps(productorId).then((r) => {
      if (!viu) return
      if (!r.ok || !r.data) setError(textError(t, r.error))
      else {
        setCampos(r.data.campos)
        // Puede no venir: la función se despliega después que esta pantalla.
        setSeccions(r.data.secciones ?? [])
        setCatalogos(r.data.catalogos)
        // Lo que había a medias antes de una recarga (ver `PREFIX_ESBORRANY`).
        // Solo la primera carga: si el efecto se repite (cambio de idioma), no se pisa lo escrito.
        const e = recuperat.current ? null : llegeixEsborrany(productorId)
        if (e) {
          setDatos(e.datos)
          setPas(e.pas)
          setPasMaxim(e.pasMaxim)
          setCostTocat(e.costTocat)
          toast.info(t('po.draft_restored'))
        }
      }
      recuperat.current = true
      setCarregant(false)
    })
    return () => { viu = false }
  }, [productorId, t])

  /**
   * El coste por kilo lo decide el productor (27-09-2026), partiendo de la REFERENCIA del
   * producto: al elegir producto se prellena con ella, y en cuanto el productor lo toca ya no
   * se vuelve a pisar aunque cambie de producto.
   */
  const [costTocat, setCostTocat] = useState(false)
  const producteTriat = useMemo(
    () => (catalogos?.productos ?? []).find((p) => p.nombre === String(datos.producte ?? '')),
    [catalogos, datos.producte],
  )
  const referencia = producteTriat?.cost_referencia ?? null

  useEffect(() => {
    if (!productorId || !recuperat.current) return
    desaEsborrany(productorId, { datos, pas, pasMaxim, costTocat })
  }, [productorId, datos, pas, pasMaxim, costTocat])

  const productesDeFamilia = useMemo(() => {
    const familia = String(datos.familia ?? '')
    return (catalogos?.productos ?? []).filter((p) => !familia || p.familia === familia)
  }, [catalogos, datos.familia])

  function set(clave: string, valor: unknown) {
    setDatos((d) => {
      const nou = { ...d, [clave]: valor }
      // Cambiar de familia invalida el producto elegido, pero SOLO si no es de la nueva: en
      // el iPhone, abrir el desplegable de familia y cerrarlo sobre otra (o la rueda que
      // pasa por varias) borraba en silencio el producto, y «Continuar» no dejaba pasar.
      if (clave === 'familia') {
        const actual = (catalogos?.productos ?? []).find((p) => p.nombre === d.producte)
        if (!actual || actual.familia !== valor) delete nou.producte
      }
      // Elegir producto propone su coste de referencia, salvo que el productor ya haya
      // escrito el suyo.
      if (clave === 'producte' && !costTocat) {
        const ref = (catalogos?.productos ?? []).find((p) => p.nombre === valor)?.cost_referencia
        if (ref != null) nou.cost_kg = ref
        else delete nou.cost_kg
      }
      return nou
    })
    // En cuanto se toca un campo marcado, deja de estarlo: el rojo es «esto faltaba», no
    // «esto está mal», así que no tiene sentido que sobreviva a la primera letra escrita.
    if (campsFaltants.has(clave)) {
      setCampsFaltants((s) => {
        const n = new Set(s)
        n.delete(clave)
        return n
      })
    }
  }

  // Mismo criterio que `faltantes()` en `_shared/camposOferta.ts` (obligatorio, aplica
  // según la condición, y vacío tras quitar espacios): DUPLICADO A PROPÓSITO, no importado,
  // porque aquel fichero es Deno y este es el bundle del navegador. Divergir no fallaría
  // —el servidor sigue siendo la autoridad, y su rechazo real lo recoge `r.faltan` más
  // abajo—, pero dejaría que el aviso en pantalla diga «todo bien» cuando no lo está.
  function faltantsObligatoris(): CampoOferta[] {
    return campos
      .filter((c) => c.obligatorio && aplica(c, datos))
      .filter((c) => {
        const v = datos[c.clave]
        return v === undefined || v === null || String(v).trim() === ''
      })
  }

  function marcaIVeAlPrimer(claus: string[]) {
    setCampsFaltants(new Set(claus))
    if (!claus[0]) return
    // Si el primero que falta está en otra sección, se va a esa sección primero.
    const i = blocs.findIndex((b) => b.camps.some((c) => c.clave === claus[0]))
    if (i >= 0 && i !== pas) setPas(i)
    window.setTimeout(() => {
      document.getElementById(idDe(claus[0]))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }

  /** Lo obligatorio que falta en UNA sección. */
  function faltantsDe(camps: CampoOferta[]): CampoOferta[] {
    const claus = new Set(camps.map((c) => c.clave))
    return faltantsObligatoris().filter((c) => claus.has(c.clave))
  }

  function vesAlPas(i: number) {
    setPas(i)
    setPasMaxim((m) => Math.max(m, i))
    setError(null)
    dalt.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** «Continuar»: solo si lo obligatorio de esta sección está completo. */
  function continua(camps: CampoOferta[], seguent: number) {
    const f = faltantsDe(camps)
    if (f.length > 0) {
      marcaIVeAlPrimer(f.map((c) => c.clave))
      setError(t('po.missing_fields', { camps: f.map((c) => c.etiqueta).join(', ') }))
      return
    }
    setCampsFaltants(new Set())
    vesAlPas(seguent)
  }

  async function desaLlocNou() {
    if (!productorId || !llocNou) return
    if (!llocNou.alias.trim()) { toast.error(t('po.place_need_name')); return }
    setDesantLloc(true)
    const r = await creaUbicacio({
      productorId,
      alias: llocNou.alias.trim(),
      gmapsUrl: llocNou.maps.trim() || null,
      municipi: llocNou.municipi ? { codi_ine: llocNou.municipi.codi_ine, nom: llocNou.municipi.nom } : null,
    })
    setDesantLloc(false)
    if (!r.ok || !r.data) { toast.error(textError(t, r.error)); return }
    const nou = r.data
    setCatalogos((c) => (c ? { ...c, ubicaciones: [...c.ubicaciones, nou] } : c))
    set('ubicacio', nou.id)
    setLlocNou(null)
    toast.success(t('po.place_saved'))
  }

  async function enviar() {
    if (!productorId) return
    // Antes de llamar al servidor: decir QUÉ falta, no esperar a que conteste con un
    // «Falten camps obligatoris» genérico que obliga a repasar los 14 campos uno a uno.
    const faltants = faltantsObligatoris()
    if (faltants.length > 0) {
      marcaIVeAlPrimer(faltants.map((c) => c.clave))
      setError(t('po.missing_fields', { camps: faltants.map((c) => c.etiqueta).join(', ') }))
      return
    }
    setCampsFaltants(new Set())
    setEnviant(true)
    setError(null)
    const r = await creaOferta(productorId, datos)
    setEnviant(false)
    if (!r.ok || !r.data) {
      // El servidor puede saber de un campo que el cliente no vio a tiempo —el descriptor
      // cambia entre que se cargó el formulario y que se envió, porque la función se
      // despliega antes que este fichero (§11)—. Si trae `faltan`, se trata igual que la
      // validación de arriba: se marca y se dice cuál es, no el genérico crudo.
      if (r.faltan && r.faltan.length > 0) {
        const porClave = new Map(campos.map((c) => [c.clave, c]))
        const etiquetas = r.faltan.map((clave) => porClave.get(clave)?.etiqueta ?? clave)
        marcaIVeAlPrimer(r.faltan)
        setError(t('po.missing_fields', { camps: etiquetas.join(', ') }))
        return
      }
      // Solo la banda: un toast con el mismo texto a la vez repetía el aviso.
      setError(textError(t, r.error))
      return
    }
    marcaProcesVist()
    esborraEsborrany(productorId)
    // Sin toast: lo que hay que decir —la referencia, qué pasa ahora y por dónde seguir—
    // no cabe en un aviso que se va solo. Lo cuenta `BlocPublicada` en el detalle, que
    // además se puede volver a mirar. La confirmación por correo solo se promete si ha
    // salido de verdad (sin correo en la ficha, o modo test, no sale). A dónde se va
    // después lo decide quien monta el formulario: el productor a SU detalle, el equipo a
    // la pantalla de la canalización.
    onCreada(r.data)
  }

  // Sin productor no hay descriptor que pedir ni oferta que crear. Quién falta —«no tienes
  // organización» en el panel, «elige un productor» en el alta asistida— lo dice quien
  // monta el formulario: aquí no se puede saber, y decirlo mal es peor que no decirlo.
  if (!productorId) return null
  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  // El id de cada control: `campo.clave` ya es único dentro del formulario (es la clave
  // que el servidor usa para guardar la respuesta), así que basta prefijarlo para que no
  // choque con nada más de la página. Es lo que permite que la `<Label>` de arriba lleve
  // `htmlFor` de verdad: hasta hoy ningún control de este formulario tenía `id` ni `name`,
  // así que un lector de pantalla no anunciaba qué campo era y pulsar la etiqueta no
  // enfocaba nada (deuda §12.121, medido en el navegador el 22-09-2026).
  function idDe(clave: string): string {
    return `of-${clave}`
  }

  function control(campo: CampoOferta) {
    const valor = datos[campo.clave]
    const id = idDe(campo.clave)
    const invalid = campsFaltants.has(campo.clave)
    // ⚠️ `text-base md:text-sm` NO es cosmético: iOS Safari amplía la página al enfocar
    // cualquier control por debajo de 16px, y como el viewport renuncia a propósito a
    // `maximum-scale` (accesibilidad), NO deshace el zoom al salir del campo. Con
    // `text-sm` a secas, tocar el primer desplegable dejaba el resto del formulario —13
    // campos— ampliado y desplazándose en horizontal. Es el mismo patrón que ya usa
    // `components/ui/input.tsx`, y por eso los <input> nunca tuvieron el problema.
    // La altura pasa de h-10 a h-9 para que dejen de alternar con los Input.
    // El `<select>` nativo no trae de serie la variante `aria-invalid:` que sí llevan
    // `Input`/`Textarea` de shadcn (`ui/input.tsx`): hay que repetirla aquí, igual que ya
    // hay que repetir `text-base md:text-sm` (§2bis).
    const comuns = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm aria-invalid:border-destructive aria-invalid:ring-destructive/20'

    switch (campo.tipo) {
      case 'familia':
        return (
          <select id={id} name={campo.clave} className={comuns} aria-invalid={invalid}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
            <option value="">—</option>
            {(catalogos?.familias ?? []).map((f) => (
              <option key={f} value={f}>{etiquetaFamilia(f, catalogos, lang)}</option>
            ))}
          </select>
        )
      case 'producte':
        return (
          <select id={id} name={campo.clave} className={comuns} aria-invalid={invalid}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}
            disabled={!datos.familia}>
            <option value="">—</option>
            {productesDeFamilia.map((p) => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
          </select>
        )
      case 'causa':
        return (
          <select id={id} name={campo.clave} className={comuns} aria-invalid={invalid}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
            <option value="">—</option>
            {(catalogos?.causas ?? []).map((c) => (
              <option key={c.codigo} value={c.codigo}>{c.nombre ?? c.codigo}</option>
            ))}
          </select>
        )
      case 'ubicacio': {
        const ubis = catalogos?.ubicaciones ?? []
        return (
          <div className="space-y-2">
            {ubis.length > 0 && (
              <select id={id} name={campo.clave} className={comuns} aria-invalid={invalid}
                value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
                <option value="">—</option>
                {ubis.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.alias ?? u.municipio ?? t('po.place_unnamed')}{u.alias && u.municipio ? ` · ${u.municipio}` : ''}
                  </option>
                ))}
              </select>
            )}
            {ubis.length === 0 && !llocNou && (
              <p className="text-sm text-muted-foreground">{t('po.no_locations')}</p>
            )}
            {/* Un lloc nou sense sortir del formulari: un productor pot tenir diversos
                camps i magatzems, i obligar-lo a anar a la fitxa a mig alta és perdre'l. */}
            {!llocNou ? (
              <Button type="button" variant="outline" className="h-11 whitespace-normal md:h-9"
                onClick={() => setLlocNou({ alias: '', maps: '', municipi: null })}>
                <Plus className="size-4" aria-hidden /> {t('po.place_add')}
              </Button>
            ) : (
              <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="of-lloc-nom" className="mb-1.5 block text-xs text-muted-foreground">{t('po.place_name')}</Label>
                  <Input id="of-lloc-nom" name="lloc-nom" value={llocNou.alias}
                    placeholder={t('po.place_name_ph')}
                    onChange={(e) => setLlocNou((l) => (l ? { ...l, alias: e.target.value } : l))} />
                </div>
                <div>
                  <Label htmlFor="of-lloc-municipi" className="mb-1.5 block text-xs text-muted-foreground">{t('po.place_town')}</Label>
                  <SelectorMunicipi id="of-lloc-municipi" valor={llocNou.municipi?.codi_ine ?? null}
                    onChange={(m) => setLlocNou((l) => (l ? { ...l, municipi: m } : l))} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="of-lloc-maps" className="mb-1.5 block text-xs text-muted-foreground">
                    {t('po.place_maps')} <span className="ml-1">{t('po.optional')}</span>
                  </Label>
                  <Input id="of-lloc-maps" name="lloc-maps" type="url" inputMode="url" value={llocNou.maps}
                    placeholder="https://maps.app.goo.gl/…"
                    onChange={(e) => setLlocNou((l) => (l ? { ...l, maps: e.target.value } : l))} />
                </div>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <Button type="button" className="h-11 whitespace-normal md:h-9" disabled={desantLloc}
                    onClick={() => void desaLlocNou()}>
                    {desantLloc ? t('c.saving') : t('po.place_save')}
                  </Button>
                  <Button type="button" variant="ghost" className="h-11 md:h-9" onClick={() => setLlocNou(null)}>
                    {t('c.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      }
      case 'opcions': {
        // La explicación de la opción ELEGIDA va debajo del control, no en el <option>:
        // un `<option>` no admite más que texto plano, y las tres modalidades deciden qué
        // entidades pueden recibir la oferta y qué documento se genera.
        const triada = (campo.opciones ?? []).find((o) => o.id === String(valor ?? ''))
        return (
          <>
            <select id={id} name={campo.clave} className={comuns} aria-invalid={invalid}
              value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
              <option value="">—</option>
              {(campo.opciones ?? []).map((o) => <option key={o.id} value={o.id}>{o.titulo}</option>)}
            </select>
            {triada?.descripcion && (
              <p className="mt-1 text-xs text-muted-foreground">{triada.descripcion}</p>
            )}
            {/* Dicho aquí, al elegir, y no solo al final: si no, se descubre en el último
                paso con el botón de publicar apagado. */}
            {campo.clave === 'modalitat' && motiuConveni && (
              <p className="mt-1 text-xs text-error">{t(motiuConveni)}</p>
            )}
          </>
        )
      }
      case 'numero':
        if (campo.clave === 'cost_kg') {
          return (
            <>
              <Input id={id} name={campo.clave} type="number" step="0.01" min="0" aria-invalid={invalid}
                value={valor == null ? '' : String(valor)}
                onChange={(e) => {
                  setCostTocat(true)
                  set(campo.clave, e.target.value === '' ? null : Number(e.target.value))
                }} />
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {referencia != null ? t('po.cost_ref', { v: eurKg(referencia) }) : t('po.cost_no_ref')}
                {referencia != null && Number(valor) !== referencia && (
                  <button type="button" className="font-medium text-primary hover:underline"
                    onClick={() => { setCostTocat(false); set(campo.clave, referencia) }}>
                    {t('po.cost_use_ref')}
                  </button>
                )}
              </p>
            </>
          )
        }
        return (
          <Input id={id} name={campo.clave} type="number" step="0.01" min="0" aria-invalid={invalid}
            value={valor == null ? '' : String(valor)}
            onChange={(e) => set(campo.clave, e.target.value === '' ? null : Number(e.target.value))} />
        )
      default:
        // «Fins quin dia està disponible» con CALENDARIO (revisión del 23-09-2026): en el
        // móvil teclear «23/07» es incómodo y deja margen a erratas. El control da ISO
        // (aaaa-mm-dd) y lo que se guarda y viaja es «dd/mm/aaaa»: es lo que entiende
        // `parseDisponibleFins()` en el servidor —el mismo que lee lo que escribe el
        // productor por WhatsApp— y lo que sale impreso en el texto de la oferta. Así no
        // hay que tocar ni la Edge Function ni el descriptor del campo.
        if (campo.clave === 'disponible_fins') {
          return (
            <Input id={id} name={campo.clave} type="date" aria-invalid={invalid}
              min={avuiIso()}
              value={ddmmaaaaAIso(String(valor ?? ''))}
              onChange={(e) => set(campo.clave, isoADdmmaaaa(e.target.value))} />
          )
        }
        if (campo.clave === 'varietat') {
          return (
            <>
              <Input id={id} name={campo.clave} type="text" aria-invalid={invalid}
                value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)} />
              {varietatSemblaQuantitat(valor) && (
                <p className="mt-1 text-xs text-aviso">{t('po.variety_looks_kg')}</p>
              )}
            </>
          )
        }
        return campo.clave === 'observacions'
          ? <Textarea id={id} name={campo.clave} rows={3} aria-invalid={invalid} value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)} />
          : <Input id={id} name={campo.clave} type="text" aria-invalid={invalid} value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)} />
    }
  }

  const visibles = campos.filter((c) => aplica(c, datos))
  const blocs = agrupa(visibles, seccions)
  // Si una respuesta hace desaparecer secciones enteras (o el descriptor cambia), el paso
  // se queda dentro del rango en vez de apuntar a un bloque que ya no existe.
  const pasSegur = Math.min(pas, Math.max(0, blocs.length - 1))
  const bloc = blocs[pasSegur]
  const ultim = pasSegur >= blocs.length - 1
  // El punto de partida: una oferta recién publicada, sin nadie interesado todavía. Sale
  // del mismo módulo que lo cuenta después en el detalle, así que lo que se promete aquí
  // y lo que se ve luego son la misma frase.
  // Por qué no se puede publicar ahora mismo, si no se puede: se DICE, no solo se apaga el
  // botón (en táctil no hay tooltip, §6ter).
  const motiuConveni = bloqueja
    ? 'avis_conv.bloquejat'
    : (motiuModalitat && datos.modalitat ? motiuModalitat(String(datos.modalitat)) : null)
  const puntInicial = puntOferta(
    { estado: 'publicada', kgTotal: 0, kgCanalitzats: 0 }, 'productor',
  )

  return (
    <div className="space-y-4">
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

      {/* --- Los pasos: dónde estás y a dónde puedes volver --- */}
      <div ref={dalt} className="scroll-mt-20">
        {blocs.length > 1 && (
          <ol className="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label={t('po.steps')}>
            {blocs.map((b, i) => {
              const visitat = i <= pasMaxim
              return (
                <li key={b.clau || i}>
                  <button
                    type="button"
                    disabled={!visitat}
                    onClick={() => vesAlPas(i)}
                    aria-current={i === pasSegur ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-1 py-1',
                      i === pasSegur ? 'font-semibold text-foreground' : visitat ? 'text-primary hover:underline' : 'text-muted-foreground',
                    )}
                  >
                    <span className={cn(
                      'flex size-5 items-center justify-center rounded-full text-xs',
                      i < pasSegur ? 'bg-primary text-primary-foreground'
                        : i === pasSegur ? 'border-2 border-primary text-primary' : 'border border-input',
                    )}>
                      {i < pasSegur ? <Check className="size-3" aria-hidden /> : i + 1}
                    </span>
                    {b.titol ?? ''}
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {bloc && (
        <Card key={bloc.clau || 'tot'}>
          {bloc.titol && (
            <CardHeader>
              {blocs.length > 1 && (
                <p className="text-xs text-muted-foreground">{t('po.step_of', { n: pasSegur + 1, m: blocs.length })}</p>
              )}
              <CardTitle className="text-base">{bloc.titol}</CardTitle>
              {bloc.descripcio && (
                <p className="mt-1 text-xs text-muted-foreground">{bloc.descripcio}</p>
              )}
            </CardHeader>
          )}
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {bloc.camps.map((campo) => (
              <div
                key={campo.clave}
                className={campo.clave === 'observacions' || campo.tipo === 'ubicacio' ? 'sm:col-span-2' : undefined}
              >
                {/* Sin asterisco: el formulario es mínimo y todo lo que aparece hace
                    falta, así que lo que se marca es lo que se puede dejar en blanco
                    (design/DESIGN.md §6). */}
                <Label htmlFor={idDe(campo.clave)} className="mb-1.5 block text-xs text-muted-foreground">
                  {campo.etiqueta}
                  {!campo.obligatorio && <span className="ml-1">{t('po.optional')}</span>}
                </Label>
                {control(campo)}
                {campo.ayuda && <p className="mt-1 text-xs text-muted-foreground">{campo.ayuda}</p>}
              </div>
            ))}
            {/* La FOTO va en el paso del producto, que es donde se piensa en qué se ofrece
                (revisión del 23-09-2026: es lo primero que mira un receptor). No es un campo
                del descriptor porque el bot de WhatsApp todavía no recibe imágenes (brecha 8):
                viaja en `datos.fotos` y `crear-oferta` la valida aparte. */}
            {(bloc.clau === 'producte' || (blocs.length === 1)) && productorId && (
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-xs text-muted-foreground">
                  {t('foto.label')} <span className="ml-1">{t('foto.recommended')}</span>
                </p>
                <SelectorFotos
                  productorId={productorId}
                  rutes={Array.isArray(datos.fotos) ? (datos.fotos as string[]) : []}
                  onChange={(r) => set('fotos', r)}
                />
                {/* Sin fotos propias, la oferta se ve con el icono de su producto (29-09-2026). */}
                {producteTriat && !(Array.isArray(datos.fotos) && datos.fotos.length > 0) && (
                  <div className="mt-3 flex items-center gap-3">
                    <IconaProducte producto={producteTriat.nombre} familia={producteTriat.familia} className="size-11" />
                    <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t('foto.icon_hint')}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* --- El pie se queda a la vista: en un móvil el botón caería bajo el pliegue.
              `env(safe-area-inset-bottom)` porque el viewport va a `viewport-fit=cover` (§2). --- */}
      <div
        className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {/* El error va DENTRO del pie fijo (29-09-2026): debajo de la tarjeta quedaba tapado
            por este mismo pie en el móvil, y al pulsar «Continuar» solo se veía un salto de
            scroll —parecía un bucle—. Aquí está siempre a la vista, junto al botón. */}
        {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
        {pasSegur > 0 && (
          <Button variant="outline" className="h-11 whitespace-normal md:h-9" onClick={() => vesAlPas(pasSegur - 1)}>
            <ArrowLeft className="size-4" aria-hidden /> {t('po.back')}
          </Button>
        )}
        {ultim ? (
          // Sin el convenio que toca, el botón se apaga y el motivo va escrito debajo.
          <Button
            className="h-11 whitespace-normal md:h-9"
            onClick={() => void enviar()}
            disabled={enviant || motiuConveni !== null}
          >
            {enviant ? t('c.saving') : t('po.publish')}
          </Button>
        ) : (
          <Button className="h-11 whitespace-normal md:h-9" onClick={() => bloc && continua(bloc.camps, pasSegur + 1)}>
            {t('po.continue')} <ArrowRight className="size-4" aria-hidden />
          </Button>
        )}
        {onCancel && (
          <Button
            variant="ghost"
            className="h-11 whitespace-normal md:h-9"
            onClick={() => { if (productorId) esborraEsborrany(productorId); onCancel() }}
          >
            {t('c.cancel')}
          </Button>
        )}
        {ultim && motiuConveni && (
          <p className="w-full text-sm text-error">{t(motiuConveni)}</p>
        )}
      </div>
    </div>
  )
}

/** Hoy en hora de Madrid, en ISO: el mínimo del calendario (no se ofrece un día pasado). */
function avuiIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
}

/** «2026-09-30» → «30/09/2026». Vacío si no es una fecha ISO. */
export function isoADdmmaaaa(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** «30/09/2026» → «2026-09-30». Vacío si no se reconoce (el control lo pinta en blanco). */
export function ddmmaaaaAIso(txt: string): string {
  const m = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}
