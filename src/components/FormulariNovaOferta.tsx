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
// Hace las mismas preguntas que el bot de WhatsApp porque no las lleva escritas: las pide a
// `crear-oferta`, que las sirve desde el mismo descriptor (`_shared/camposOferta.ts`). Si
// mañana el intake gana un paso, este formulario lo gana solo. Las dos excepciones, a propósito
// (17-11-2026): la FAMILIA no se pregunta aquí —el producto se busca escribiendo y la familia se
// rellena sola; se sigue mandando, porque el servidor la exige— y los DÍAS de recogida son solo
// del panel (`soloPanel`).
//
// BLOQUES PROGRESIVOS (17-11-2026, filas 3.1.3 y 3.2.6 del Excel de la Fundació). Hasta entonces
// era un formulario por pasos con «Continuar» y «Enrere» (23-09-2026): se validaba cada sección
// al pasar, pero no se veía el conjunto ni se podía corregir sin ir y volver. Ahora se pintan
// todas las secciones en orden; la siguiente SE ABRE SOLA cuando lo obligatorio (que aplique) de
// las anteriores está completo y bien, y una vez abierta SIGUE ABIERTA aunque luego se vacíe
// algo de antes. Las cerradas se ven con su título y un aviso. El pie solo tiene «Publicar»
// —valida todo y lleva al primer fallo— y «Cancel·lar».
//
// ⚠️ LAS SECCIONES SON OPCIONALES A PROPÓSITO. El descriptor las sirve desde el servidor
//    y este fichero se despliega antes que la función (§11: base → funciones → frontend),
//    así que durante un rato la respuesta puede no traer `secciones` ni `seccion`. Sin
//    ellas se pinta un solo bloque sin título; con ellas, los cinco bloques.
//
// TRES MODOS, UN SOLO FORMULARIO (fase C del punto 3, 17-11-2026, filas 3.1.2 y 3.7 del Excel):
//   · `crear`: el alta. «Publicar» y, desde la fase C, «Desa com a esborrany» (basta el producto).
//   · `esborrany`: reabre un esborrany guardado en el servidor; se sigue rellenando, se vuelve a
//     guardar, se publica (mismas comprobaciones que el alta) o se borra.
//   · `editar`: una oferta ya publicada. Producto y entidad fijos; todo lo demás, editable y con
//     todos los bloques abiertos. Sustituye a `DialegEditaOferta` (que solo editaba ocho campos).
//   El `localStorage` queda solo en `crear`, como red ante una recarga (la cámara del iPhone): el
//   esborrany de verdad ya vive en el servidor.
//
// ⚠️ EL BLOQUEO POR CONVENIO ENTRA POR PROP, no se lee aquí. `useConveni` mira las
//    organizaciones DE LA CUENTA, y la del equipo no tiene ninguna: leerlo dentro daría
//    `false` siempre para el alta asistida y dejaría al dinamizador delante de un `42501`
//    que la pantalla podía haber anticipado.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Lock, MapPin, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { avuiMadrid } from '../lib/format'
import { textError } from '../lib/textError'
import { varietatSemblaQuantitat } from '../lib/validacio'
import { cn } from '../lib/utils'
import { FilaCasella } from './Casella'
import {
  CODIS_EDICIO, aplicaCamp, carregaCamps, creaOferta, creaUbicacio, desaEsborranyOferta, editaOferta,
  esBuit, esborraEsborranyOferta, etiquetaFamilia, localitzaDescriptor, publicaEsborrany,
} from '../lib/ofertes'
import { canvisDeDatos, datosDeFila } from '../lib/edicioOferta'
import { esborraFoto } from '../lib/fotos'
import { useConfirma } from './DialegConfirma'
import type { Excedente } from '../types'
import { modalitatsDe } from '../lib/modalitats'
import {
  ambReglaEspigolada, espigoladaMarcada, ofereixEspigolada, triaEspigolada, triaModalitat,
} from '../lib/modalitatsOferta'
import { esFranjaValida } from '../lib/franja'
import type { Franja } from '../lib/franja'
import type { Municipi } from '../lib/municipis'
import SelectorMunicipi from './SelectorMunicipi'
import SelectorFranja from './SelectorFranja'
import EditorDiesFranges from './EditorDiesFranges'
import { franjaDinsDelLloc, frangesDelLloc, normalitzaDies } from '../lib/diesRecollida'
import Desplegable from './Desplegable'
import CercadorOpcions from './CercadorOpcions'
import TriaSiNo from './TriaSiNo'
import XipsTria from './XipsTria'
import { IconaProducte, SelectorFotos } from './FotosOferta'
import { eurKg } from '../lib/tancament'
import { costADeclarar, rotulReferenciaOferta } from '../lib/valoracio'
import { mesActual } from '../lib/preus'
import type { BlocOferta, CampoOferta, CatalogosOferta } from '../lib/ofertes'
import { PASSOS_OFERTA_CLAUS, puntOferta } from '../lib/procesOferta'
import { catalegDelDescriptor, esSubcausaTriable, opcionsSubcausa, teSubcauses, textSubcausa } from '../lib/causes'
import PasosProces from './proces/PasosProces'
import QueTocaAra from './proces/QueTocaAra'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  ddmmaaaaAIso, disponiblePerDefecte, interpretaEsborrany, isoADdmmaaaa, mapsOfertaValid, type Esborrany,
} from '../lib/esborranyOferta'
import {
  aplicaPredeterminats, estatLlocHabitual, recalculaDelLloc, treuProposatsQueNoApliquen, ubicacioPerConfirmar,
} from '../lib/predeterminatsOferta'
import {
  clauErrorProductes, cosAmbProductes, desDeCos, errorsFiles, filaDelIndex, filesUtils, type FilaProducte,
} from '../lib/altaMultiproducte'
import AltresProductes from './oferta/AltresProductes'

type Datos = Record<string, unknown>

/** Quien ya ha publicado alguna vez no necesita releer el proceso cada vez. */
const CLAU_PROCES_VIST = 'redestina-proces-vist'

/** Las dos preguntas de sí o no que se contestan con dos botones (`TriaSiNo`, fila 3.1.3). */
const SI_NO = new Set(['producte_al_camp', 'retorn'])

/** Los días de la semana, 1 = dilluns … 7 = diumenge (los de `productor_ubicaciones`). */
const DIES = [1, 2, 3, 4, 5, 6, 7] as const

/** La etiqueta de un campo: Inter 500 `sm`, color del texto (DESIGN.md «Formulario», 18-11-2026). */
const ETIQUETA = 'mb-1.5 block leading-snug'
/** «(opcional)» al lado de la etiqueta, sin peso y en gris. */
const OPCIONAL = 'ml-1 font-normal text-muted-foreground'

function procesJaVist(): boolean {
  try { return localStorage.getItem(CLAU_PROCES_VIST) === 'si' } catch { return false }
}

/**
 * El BORRADOR del alta (29-09-2026; desde el 05-10-2026 en `localStorage` y durante 7 días).
 *
 * Nació en `sessionStorage` y 24 h para el caso del iPhone —abrir la cámara puede hacer que
 * Safari recargue la pestaña y el formulario volvía vacío—. En la reunión del 05-10-2026 se le
 * dijo a la Fundació que el borrador «se guarda una semana y se borra solo», y ahora cumple lo
 * dicho: sobrevive a cerrar el navegador, caduca a los 7 días y se borra al publicar o cancelar.
 * (El borrador en el servidor es otra fase del punto 3.)
 *
 * ⚠️ El precio es que en un MÓVIL COMPARTIDO lo escrito se queda a la vista del siguiente que
 *    abra el alta con esa misma organización. Es aceptable porque la clave es POR PRODUCTOR
 *    (otra organización no lo ve) y no contiene nada que esa organización no sepa ya. El
 *    aviso «Hem recuperat l'oferta…» lo hace visible.
 */
const PREFIX_ESBORRANY = 'redestina-oferta-esborrany:'

// La decisión de si un borrador leído vale (forma y caducidad) está en
// `lib/esborranyOferta.ts`, pura y con pruebas; aquí solo se lee y se escribe.
function llegeixEsborrany(productorId: string): Esborrany<Datos> | null {
  try {
    // El de antes del 05-10-2026 vivía en `sessionStorage`: se recoge una vez y se migra.
    const cru = localStorage.getItem(PREFIX_ESBORRANY + productorId)
      ?? sessionStorage.getItem(PREFIX_ESBORRANY + productorId)
    const { esborrany, treu } = interpretaEsborrany(cru, Date.now())
    if (treu) localStorage.removeItem(PREFIX_ESBORRANY + productorId)
    return esborrany
  } catch { return null }
}

function desaEsborrany(productorId: string, e: Omit<Esborrany<Datos>, 'desat'>) {
  try {
    sessionStorage.removeItem(PREFIX_ESBORRANY + productorId)
    if (Object.keys(e.datos).length === 0) localStorage.removeItem(PREFIX_ESBORRANY + productorId)
    else localStorage.setItem(PREFIX_ESBORRANY + productorId, JSON.stringify({ ...e, desat: Date.now() }))
  } catch { /* Safari privado: sin borrador, pero se puede publicar igual */ }
}

function esborraEsborrany(productorId: string) {
  try {
    localStorage.removeItem(PREFIX_ESBORRANY + productorId)
    sessionStorage.removeItem(PREFIX_ESBORRANY + productorId)
  } catch { /* ídem */ }
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

/** ¿Un valor numérico es un entero positivo? (cuántos envases devolver). */
function enterPositiu(v: unknown): boolean {
  const n = Number(v)
  return Number.isInteger(n) && n > 0
}

/** El id de cada control: `campo.clave` ya es único dentro del formulario. */
function idDe(clave: string): string {
  return `of-${clave}`
}

export interface ResultatNovaOferta {
  /** Con varios productos (fase 6a), la PRIMERA oferta del grupo. */
  id: string
  /** `enviat` cuando la confirmación por correo salió de verdad. */
  confirmacio_email?: string | null
  /** Multiproducto (fase 6a): la disponibilidad creada, su `D-…` y sus ofertas. */
  disponibilitat_id?: string
  codi?: string
  ofertes?: { id: string; id_excedente: string; estado: string; producto: string }[]
}

/** `crear` (alta), `esborrany` (reabrir uno guardado) o `editar` (una oferta publicada). */
export type ModeFormulariOferta = 'crear' | 'esborrany' | 'editar'

export interface PropsFormulariNovaOferta {
  /** Por defecto, `crear`. Con `esborrany` o `editar` hace falta `oferta`. */
  mode?: ModeFormulariOferta
  /** La fila de la oferta (esborrany o publicada). */
  oferta?: Excedente | null
  /** En `editar`: el equipo no revalida (es quien valida). */
  esEquip?: boolean
  /** En `editar`: lo ya canalizado; los kilos no pueden bajar de aquí. */
  kgCanalitzats?: number
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
  onCreada?: (r: ResultatNovaOferta) => void
  /** Tras guardar el esborrany (fase C): a dónde se va lo decide quien monta el formulario. */
  onEsborranyDesat?: (id: string) => void
  /** Tras borrar el esborrany. */
  onEsborrat?: () => void
  /** En `editar`, tras guardar (`estado` dice si ha vuelto a validación). */
  onEditada?: (estado: string | null) => void | Promise<unknown>
  /** Si no se pasa, no se pinta el botón de cancelar. */
  onCancel?: () => void
}

export default function FormulariNovaOferta({
  productorId, bloqueja = false, motiuModalitat, onCreada, onCancel,
  mode = 'crear', oferta = null, esEquip = false, kgCanalitzats = 0, onEsborranyDesat, onEsborrat, onEditada,
}: PropsFormulariNovaOferta) {
  const { t, lang } = useT()
  const { confirma, dialeg: dialegConfirma } = useConfirma()
  const editar = mode === 'editar'
  /** Lo que la oferta decía al abrirla (editar): para no exigir lo que ya faltaba antes. */
  const original = useMemo<Datos>(() => (oferta ? datosDeFila(oferta) : {}), [oferta])
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
  const [desantEsb, setDesantEsb] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [procesObert, setProcesObert] = useState(() => !procesJaVist())
  // Qué claves faltan o están mal, para marcarlas en rojo y decir cuáles son (§12.123).
  const [campsFaltants, setCampsFaltants] = useState<Set<string>>(new Set())
  /**
   * Hasta qué bloque se ha abierto (índice). Un bloque abierto no se vuelve a cerrar aunque se
   * vacíe algo anterior. Viaja en el borrador como `pasMaxim` (el nombre de cuando era por pasos).
   */
  const [obertsFins, setObertsFins] = useState(0)
  /**
   * El mini-formulario de «un lloc nou», dentro de la sección de recogida. Fase 4 (25-11-2026):
   * también sus días y franjas (`EditorDiesFranges`), que se guardan en la ficha del lugar.
   */
  const [llocNou, setLlocNou] = useState<{
    alias: string; maps: string; municipi: Municipi | null; dies: number[]; franges: (Partial<Franja> | null)[]
  } | null>(null)
  const [desantLloc, setDesantLloc] = useState(false)
  /**
   * Lo que la Operativa ha propuesto y nadie ha tocado todavía (A4): se marca «proposat des
   * de la fitxa» y deja de estarlo en cuanto se cambia (`set`).
   */
  const [proposats, setProposats] = useState<Set<string>>(new Set())
  /**
   * P5 (11-11-2026), como en WhatsApp: con un lugar principal se pide «confirma el lloc
   * habitual o canvia’l». «Canvia el lloc» pasa a la lista de siempre.
   */
  const [canviaLloc, setCanviaLloc] = useState(false)
  const estatLloc = estatLlocHabitual(datos.ubicacio, proposats.has('ubicacio'), catalogos?.ubicaciones ?? [], canviaLloc)
  /** Fase 4: el lugar elegido (sus días y franjas limitan los de la oferta). */
  const llocTriat = (catalogos?.ubicaciones ?? []).find((u) => u.id === String(datos.ubicacio ?? ''))
  /**
   * El coste por kilo lo decide el productor (27-09-2026), partiendo de la REFERENCIA del
   * producto: al elegir producto se prellena con ella, y en cuanto el productor lo toca ya no
   * se vuelve a pisar aunque cambie de producto.
   */
  const [costTocat, setCostTocat] = useState(false)
  /**
   * MULTIPRODUCTO (fase 6a): los productos que se añaden al primero, uno por fila. El primero
   * sigue en los campos de siempre; sin filas, el alta es exactamente la de un producto.
   */
  const [extres, setExtres] = useState<FilaProducte[]>([])
  /** Lo que está mal en cada fila (clave i18n), por su `clau`. */
  const [errorsExtres, setErrorsExtres] = useState<Record<string, string>>({})
  /** Cambiar las filas quita sus marcas: igual que tocar un campo marcado (`set`). */
  const canviaExtres = (files: FilaProducte[]) => { setExtres(files); setErrorsExtres({}) }

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
        // «Disponible fins»: hoy (Madrid) + 2 días naturales, si no hay nada (fila 3.4).
        // Y un borrador de antes de la fase B del punto 3 traía una causa vieja (`CE`) o una
        // categoría: no es una subcausa que se pueda elegir, así que se vacía.
        const cataleg = catalegDelDescriptor(r.data.catalogos?.causas)
        const ambData = (d0: Datos): Datos => {
          const d = teSubcauses(cataleg) && !esBuit(d0.causa) && !esSubcausaTriable(cataleg, d0.causa)
            ? { ...d0, causa: '' } : d0
          // Editando no se inventa una fecha: si la oferta no la tenía, no la tiene.
          return esBuit(d.disponible_fins) && !editar ? { ...d, disponible_fins: disponiblePerDefecte(avuiMadrid()) } : d
        }
        // Un esborrany o una oferta publicada: se abre con lo suyo y todos los bloques abiertos;
        // ni la red del `localStorage` ni lo que propone la ficha (ya se contestó).
        if (mode !== 'crear' && oferta) {
          if (!recuperat.current) {
            const guardat = mode === 'esborrany' && oferta.dades_esborrany && typeof oferta.dades_esborrany === 'object'
              ? oferta.dades_esborrany : datosDeFila(oferta)
            // Un esborrany multiproducto guarda `productes[]`: el primero vuelve a los campos de
            // siempre y el resto a sus filas (fase 6a).
            const { datos: d0, extres: e0 } = mode === 'esborrany' ? desDeCos(guardat) : { datos: guardat, extres: [] }
            setDatos(ambData(d0))
            setExtres(e0)
            setObertsFins(99)
            setCostTocat(true)
          }
          recuperat.current = true
          setCarregant(false)
          return
        }
        // Lo que había a medias antes de una recarga (ver `PREFIX_ESBORRANY`).
        // Solo la primera carga: si el efecto se repite (cambio de idioma), no se pisa lo escrito.
        const e = recuperat.current ? null : llegeixEsborrany(productorId)
        if (e) {
          const { datos: d0, extres: e0 } = desDeCos(e.datos)
          setDatos(ambData(d0))
          setExtres(e0)
          setObertsFins(e.pasMaxim)
          setCostTocat(e.costTocat)
          // P5: lo propuesto sigue siendo propuesto (hay que confirmarlo) y «Canvia» se recuerda.
          setProposats(new Set(e.proposats ?? []))
          setCanviaLloc(e.canviaLloc ?? false)
          toast.info(t('po.draft_restored'))
        } else if (!recuperat.current) {
          // Sin borrador, la Operativa propone el lugar principal, su franja, sus días y el
          // formato (A4). Solo los huecos, y marcados.
          const p = aplicaPredeterminats({}, r.data.predeterminats)
          setDatos((d) => ambData(aplicaPredeterminats(d, r.data!.predeterminats).datos))
          if (p.proposats.length > 0) setProposats(new Set(p.proposats))
        }
      }
      recuperat.current = true
      setCarregant(false)
    })
    return () => { viu = false }
  }, [productorId, t, mode, oferta, editar])

  const producteTriat = useMemo(
    () => (catalogos?.productos ?? []).find((p) => p.nombre === String(datos.producte ?? '')),
    [catalogos, datos.producte],
  )
  const referencia = producteTriat?.cost_referencia ?? null
  // El valor propuesto es el del MES DE HOY (Madrid); el rótulo dice ese mes, la fuente y, si
  // sale de otro mes (el último Gencat publicado, o provisional), cuál (17-11-2026).
  const rotulRef = producteTriat && referencia != null
    ? rotulReferenciaOferta({
        font: producteTriat.cost_referencia_font, mes: producteTriat.cost_referencia_mes,
        provisional: producteTriat.cost_referencia_provisional, dia: producteTriat.cost_referencia_dia,
        origen: producteTriat.cost_referencia_origen,
      }, mesActual(), lang)
    : null

  /** La familia de un producto del catálogo (cada producto de un grupo lleva la suya). */
  const familiaDe = (producte: string): string | null =>
    (catalogos?.productos ?? []).find((p) => p.nombre === producte)?.familia ?? null

  useEffect(() => {
    // La red local, solo en el alta: un esborrany o una edición ya están en el servidor. Con
    // varios productos se guarda con la forma del cuerpo (`productes[]`) y `desDeCos` la deshace.
    if (!productorId || !recuperat.current || mode !== 'crear') return
    const familia = (producte: string) => (catalogos?.productos ?? []).find((p) => p.nombre === producte)?.familia ?? null
    desaEsborrany(productorId, {
      datos: cosAmbProductes(datos, extres, familia), pas: 0, pasMaxim: obertsFins, costTocat,
      proposats: [...proposats], canviaLloc,
    })
  }, [productorId, datos, extres, catalogos, obertsFins, costTocat, proposats, canviaLloc, mode])

  /** El producto con un buscador; la familia va de detalle (y se rellena sola al elegir). */
  const opcionsProducte = useMemo(
    () => (catalogos?.productos ?? []).map((p) => ({
      valor: p.nombre, text: p.nombre, detall: p.familia ? etiquetaFamilia(p.familia, catalogos, lang) : undefined,
    })),
    [catalogos, lang],
  )

  /** ¿Este campo se pregunta? Con la condición encadenada, como el servidor. */
  function aplica(c: CampoOferta, d: Datos = datos): boolean {
    return aplicaCamp(c, d, campos)
  }

  function set(clave: string, valor: unknown) {
    // Tocado deja de ser propuesto: a partir de aquí es una respuesta.
    setProposats((p) => {
      if (!p.has(clave)) return p
      const n = new Set(p)
      n.delete(clave)
      return n
    })
    setDatos((d) => {
      const nou = { ...d, [clave]: valor }
      if (clave === 'producte') {
        // La familia no se pregunta en el panel (17-11-2026): sale del producto. El servidor la
        // sigue exigiendo y el bot la sigue preguntando.
        const prod = (catalogos?.productos ?? []).find((p) => p.nombre === valor)
        if (prod?.familia) nou.familia = prod.familia
        // Elegir producto propone su coste de referencia, salvo que el productor ya haya
        // escrito el suyo.
        if (!costTocat) {
          if (prod?.cost_referencia != null) nou.cost_kg = prod.cost_referencia
          else delete nou.cost_kg
        }
      }
      // Sin producto en el campo no hay espigolada (`lib/modalitatsOferta.ts`).
      return ambReglaEspigolada(nou)
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

  /**
   * Elegir el lugar (fila 3.4, 17-11-2026): si CAMBIA, los días y la franja se recalculan desde
   * el lugar nuevo (marcados como propuestos) y el enlace de Maps escrito para el anterior se
   * quita. Confirmar el mismo lugar no toca nada; vaciarlo («Canvia el lloc») tampoco.
   */
  function triaLloc(id: string, llocNouCreat?: CatalogosOferta['ubicaciones'][number]) {
    const abans = String(datos.ubicacio ?? '')
    set('ubicacio', id)
    if (!id || id === abans) return
    // El lugar recién creado todavía no está en `catalogos` (el `setCatalogos` no ha pintado):
    // se pasa entero para que sus días y franjas lleguen a la oferta.
    const lloc = llocNouCreat ?? (catalogos?.ubicaciones ?? []).find((u) => u.id === id)
    const r = recalculaDelLloc(datos, lloc)
    setDatos((d) => {
      const nou: Datos = { ...d, ubicacio: id }
      delete nou.gmaps_url
      for (const k of r.buidats) delete nou[k]
      for (const k of r.proposats) nou[k] = r.datos[k]
      return nou
    })
    setProposats((p) => {
      const n = new Set(p)
      for (const k of r.buidats) n.delete(k)
      for (const k of r.proposats) n.add(k)
      return n
    })
  }

  // Mismo criterio que `faltantes()` en `_shared/camposOferta.ts` (obligatorio, aplica
  // según la condición, y vacío tras quitar espacios): DUPLICADO A PROPÓSITO, no importado,
  // porque aquel fichero es Deno y este es el bundle del navegador. Divergir no fallaría
  // —el servidor sigue siendo la autoridad, y su rechazo real lo recoge `r.faltan` más
  // abajo—, pero dejaría que el aviso en pantalla diga «todo bien» cuando no lo está.
  // La familia no cuenta: no se pregunta aquí y sale del producto.
  function faltantsObligatoris(camps: readonly CampoOferta[] = campos): CampoOferta[] {
    const f = camps
      .filter((c) => c.tipo !== 'familia' && c.obligatorio && aplica(c))
      .filter((c) => esBuit(datos[c.clave]))
    // P5: el lugar habitual propuesto desde la ficha no es una respuesta hasta que se confirma.
    const cu = camps.find((c) => c.tipo === 'ubicacio')
    if (cu && !f.includes(cu) && ubicacioPerConfirmar(estatLloc, aplica(cu))) f.push(cu)
    // Editando, solo se exige lo que la oferta ya tenía (no se puede vaciar): una oferta de
    // WhatsApp sin subcausa o sin días se corrige sin obligar a completarla entera. Lo que una
    // respuesta nueva hace aplicar (p. ej. el retorno al pasar a cajas) sí se exige.
    if (editar) {
      return f.filter((c) => !esBuit(original[c.clave]) || !aplicaCamp(c, original, campos))
    }
    return f
  }

  /**
   * Lo que está escrito pero NO VALE (17-11-2026): kilos que no son positivos, envases a
   * devolver que no son un entero positivo, una franja a medias —solo «de», o el final antes
   * del principio— y un enlace de Maps propio que no es un enlace. Claves, en el orden del
   * formulario.
   */
  function invalidsDe(camps: readonly CampoOferta[] = campos): string[] {
    const out: string[] = []
    for (const c of camps) {
      if (!aplica(c)) continue
      const v = datos[c.clave]
      if (c.clave === 'kg' && !esBuit(v) && !(Number(v) > 0)) out.push(c.clave)
      // Editando, los kilos no bajan de lo ya canalizado (la base lo impone igual).
      else if (editar && c.clave === 'kg' && !esBuit(v) && Number(v) < kgCanalitzats) out.push(c.clave)
      if (c.clave === 'retorn_quantitat' && !esBuit(v) && !enterPositiu(v)) out.push(c.clave)
      // Hectáreas (19-11-2026): opcionales, pero si se escriben, > 0.
      if (c.clave === 'hectarees' && !esBuit(v) && !(Number(v) > 0)) out.push(c.clave)
      if (c.format === 'franja' && v && typeof v === 'object' && !esBuit(v) && !esFranjaValida(v as Partial<Franja>)) {
        out.push(c.clave)
      }
      if (c.tipo === 'ubicacio' && !mapsOfertaValid(datos.gmaps_url)) out.push('gmaps_url')
    }
    return out
  }

  // Los bloques y hasta dónde están abiertos. Se calcula ANTES de los `return` tempranos: el
  // efecto que recuerda el bloque abierto más avanzado es un hook.
  const visibles = campos.filter((c) => c.tipo !== 'familia' && aplica(c))
  const blocs = agrupa(visibles, seccions)
  const primerIncomplet = blocs.findIndex((b) => faltantsObligatoris(b.camps).length > 0 || invalidsDe(b.camps).length > 0)
  const obertsAra = Math.max(obertsFins, primerIncomplet === -1 ? blocs.length - 1 : primerIncomplet)
  useEffect(() => {
    if (!carregant && blocs.length > 0 && obertsAra > obertsFins) setObertsFins(obertsAra)
  }, [carregant, blocs.length, obertsAra, obertsFins])

  /** Marca las claves y lleva la vista a la primera. Todas están en bloques abiertos. */
  function marcaIVeAlPrimer(claus: string[]) {
    setCampsFaltants(new Set(claus))
    if (!claus[0]) return
    window.setTimeout(() => {
      document.getElementById(idDe(claus[0]))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }

  async function desaLlocNou() {
    if (!productorId || !llocNou) return
    if (!llocNou.alias.trim()) { toast.error(t('po.place_need_name')); return }
    setDesantLloc(true)
    const gmaps = llocNou.maps.trim() || null
    // Fase 4: los días y las franjas del lugar nuevo van a su ficha (una franja a medias no).
    const franges = llocNou.franges.filter((x): x is Franja => esFranjaValida(x))
    const dies_setmana = llocNou.dies.length ? [...llocNou.dies].sort((a, b) => a - b) : null
    const r = await creaUbicacio({
      productorId,
      alias: llocNou.alias.trim(),
      gmapsUrl: gmaps,
      municipi: llocNou.municipi ? { codi_ine: llocNou.municipi.codi_ine, nom: llocNou.municipi.nom } : null,
      // El resto de la ficha del lugar no se pregunta aquí: nace vacío (se completa en la ficha).
      extra: {
        direccion: null, contacto_nombre: null, contacto_telefono: null, horario: null, observaciones: null,
        dies_setmana, franges: franges.length ? franges : null,
      },
    })
    setDesantLloc(false)
    if (!r.ok || !r.data) { toast.error(textError(t, r.error)); return }
    const nou = { ...r.data, gmaps_url: gmaps, dies_setmana, franges: franges.length ? franges : null }
    setCatalogos((c) => (c ? { ...c, ubicaciones: [...c.ubicaciones, nou] } : c))
    triaLloc(nou.id, nou)
    setLlocNou(null)
    toast.success(t('po.place_saved'))
  }

  async function enviar() {
    if (!productorId) return
    // Antes de llamar al servidor: decir QUÉ falta, no esperar a que conteste con un
    // «Falten camps obligatoris» genérico que obliga a repasar todos los campos uno a uno.
    const faltants = faltantsObligatoris()
    const invalids = invalidsDe()
    if (faltants.length > 0) {
      // Lo que falta Y lo que no vale, marcado a la vez y en el orden del formulario: que un
      // kilo a 0 no espere a una segunda pulsación para verse.
      const ordre = new Map(campos.map((c, i) => [c.clave, i]))
      const pos = (k: string) => ordre.get(k === 'gmaps_url' ? 'ubicacio' : k) ?? 999
      const claus = [...new Set([...faltants.map((c) => c.clave), ...invalids])].sort((a, b) => pos(a) - pos(b))
      marcaIVeAlPrimer(claus)
      setError(t('po.missing_fields', { camps: faltants.map((c) => c.etiqueta).join(', ') }))
      return
    }
    if (invalids.length > 0) {
      marcaIVeAlPrimer(invalids)
      const porClau = new Map(campos.map((c) => [c.clave, c]))
      if (invalids.length === 1 && porClau.get(invalids[0])?.format === 'franja') {
        setError(t('po.franja_invalida'))
        return
      }
      if (editar && invalids.length === 1 && invalids[0] === 'kg' && Number(datos.kg) > 0) {
        setError(t('edit.err_kg_menys', { n: kgCanalitzats }))
        return
      }
      const noms = invalids.map((k) => (k === 'gmaps_url' ? t('po.offer_maps') : porClau.get(k)?.etiqueta ?? k))
      setError(t('po.invalid_fields', { camps: noms.join(', ') }))
      return
    }
    setCampsFaltants(new Set())
    // Los otros productos (fase 6a): cada fila con producto y kilos, sin repetir ninguno.
    if (!editar && !validaExtres(true)) return
    setEnviant(true)
    setError(null)
    // Lo propuesto desde la ficha que no se ha tocado y ya no aplica no se manda: no lo ha
    // dicho nadie. La familia, siempre la del producto (no se pregunta aquí; el servidor la exige).
    const porClau = new Map(campos.map((c) => [c.clave, c]))
    if (editar && oferta) {
      await desaEdicio(preparaEnviament())
      return
    }
    // Con un solo producto, el cuerpo de siempre (sin `productes`); con más, el del grupo.
    const enviades = filesUtils(extres)
    const aEnviar = cosAmbProductes(preparaEnviament(), extres, familiaDe)
    const r = mode === 'esborrany' && oferta
      ? await publicaEsborrany(oferta.id, aEnviar)
      : await creaOferta(productorId, aEnviar)
    setEnviant(false)
    if (!r.ok || !r.data) {
      // Un rechazo que señala OTRO producto del grupo: se marca su fila, no los campos de dalt.
      if (marcaErrorFila(r.producte_index, r.code, r.faltan, enviades)) return
      // El servidor puede saber de un campo que el cliente no vio a tiempo —el descriptor
      // cambia entre que se cargó el formulario y que se envió, porque la función se
      // despliega antes que este fichero (§11)—. Si trae `faltan`, se trata igual que la
      // validación de arriba: se marca y se dice cuál es, no el genérico crudo.
      if (r.faltan && r.faltan.length > 0) {
        const etiquetas = r.faltan.map((clave) => porClau.get(clave)?.etiqueta ?? clave)
        marcaIVeAlPrimer(r.faltan)
        setError(t('po.missing_fields', { camps: etiquetas.join(', ') }))
        return
      }
      // Solo la banda: un toast con el mismo texto a la vez repetía el aviso.
      setError(textError(t, r.error))
      return
    }
    marcaProcesVist()
    if (mode === 'crear') esborraEsborrany(productorId)
    // Las fotos que se quitaron de un esborrany ya guardado: ahora que nada las cita, fuera.
    if (mode === 'esborrany') await esborraFotesTretes(aEnviar)
    // Un grupo: cuántas ofertas han nacido y, al equipo, su código `D-…` (el ofertante no ve
    // códigos internos: ni el `E-…` ni el `D-…`). El detalle de la primera enseña las hermanas.
    if (r.data.disponibilitat_id) {
      const n = r.data.ofertes?.length ?? enviades.length + 1
      toast.success(esEquip && r.data.codi ? t('mp.creada_equip', { n, codi: r.data.codi }) : t('mp.creada', { n }))
    }
    // Sin toast: lo que hay que decir —la referencia, qué pasa ahora y por dónde seguir—
    // no cabe en un aviso que se va solo. Lo cuenta `BlocPublicada` en el detalle. A dónde se
    // va después lo decide quien monta el formulario.
    onCreada?.(r.data)
  }

  /**
   * Comprueba las filas de los otros productos (fase 6a). `publicar` exige kilos; para guardar un
   * esborrany basta el producto. Marca las filas, dice cuántas fallan y lleva a la primera.
   */
  function validaExtres(publicar: boolean): boolean {
    const errs = errorsFiles({ producte: datos.producte, varietat: datos.varietat }, extres, { publicar })
    setErrorsExtres(errs)
    const primera = extres.findIndex((f) => errs[f.clau])
    if (primera < 0) return true
    setError(t('mp.err_files'))
    window.setTimeout(() => {
      document.getElementById(`of-mp-${primera}-producte`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    return false
  }

  /**
   * Un rechazo del servidor con `producte_index` ≥ 1: la fila de ese producto, con su motivo.
   * Devuelve si lo ha tratado (el 0 es el primer producto: lo tratan los campos de siempre).
   */
  function marcaErrorFila(
    index: number | undefined, code: string | undefined, faltan: string[] | undefined, enviades: FilaProducte[],
  ): boolean {
    const fila = filaDelIndex(index, enviades)
    const clauProductes = clauErrorProductes(code)
    if (!fila) {
      // Un error de la lista entera (`massa_productes`, `productes_invalid`): en la banda.
      if (index === undefined && clauProductes && code !== 'kg_invalid' && code !== 'falta_producte') {
        setError(t(clauProductes))
        return true
      }
      return false
    }
    const motiu = clauProductes
      ?? (faltan?.includes('kg') ? 'mp.err_kg' : faltan?.includes('preu_minim') ? 'mp.err_preu' : 'mp.err_fila_generic')
    setErrorsExtres({ [fila.clau]: motiu })
    setError(t('mp.err_fila', { num: (index ?? 0) + 1, motiu: t(motiu) }))
    const pos = extres.findIndex((f) => f.clau === fila.clau)
    window.setTimeout(() => {
      document.getElementById(`of-mp-${pos}-producte`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    return true
  }

  /** Lo que se manda: sin lo propuesto que ya no aplica, con la familia del producto. */
  function preparaEnviament(): Datos {
    const porClau = new Map(campos.map((c) => [c.clave, c]))
    const aEnviar = treuProposatsQueNoApliquen(datos, proposats, (clau) => {
      const c = porClau.get(clau)
      return c ? aplica(c) : false
    })
    if (producteTriat?.familia) aEnviar.familia = producteTriat.familia
    // D2 (17-11-2026): el coste solo se DECLARA si el productor cambia la propuesta; igual a
    // ella, la oferta no guarda nada y el certificado aplica el precio del mes del albarán.
    if ('cost_kg' in aEnviar) {
      const cost = costADeclarar(aEnviar.cost_kg, referencia, oferta?.coste_kg != null ? Number(oferta.coste_kg) : null)
      if (cost === null) delete aEnviar.cost_kg
      else aEnviar.cost_kg = cost
    }
    if (typeof aEnviar.gmaps_url === 'string') {
      const g = aEnviar.gmaps_url.trim()
      if (g) aEnviar.gmaps_url = g
      else delete aEnviar.gmaps_url
    }
    return aEnviar
  }

  /**
   * Las fotos que la fila citaba y ya no: se borran de Storage DESPUÉS de guardar (al quitarlas
   * del formulario no se borran, porque cancelar dejaría la oferta citando un fichero borrado).
   */
  async function esborraFotesTretes(enviat: Datos) {
    const ara = new Set(Array.isArray(enviat.fotos) ? (enviat.fotos as string[]) : [])
    const abans = Array.isArray(oferta?.fotos) ? oferta!.fotos : []
    await Promise.all(abans.filter((r) => !ara.has(r)).map((r) => esborraFoto(r)))
  }

  /** Guardar la edición de una oferta publicada (`crear-oferta/editar` → `editar_oferta()`). */
  async function desaEdicio(aEnviar: Datos) {
    if (!oferta) return
    const porClau = new Map(campos.map((c) => [c.clave, c]))
    const canvis = canvisDeDatos(oferta, aEnviar, (clau) => {
      const c = porClau.get(clau)
      return c ? aplica(c) : true
    })
    if (Object.keys(canvis).length === 0) {
      setEnviant(false)
      toast.info(t('edit.err_sense_canvis'))
      await onEditada?.(oferta.estado)
      return
    }
    const r = await editaOferta(oferta.id, canvis)
    setEnviant(false)
    if (!r.ok) {
      const code = (r as { code?: string }).code
      setError(code && (CODIS_EDICIO as readonly string[]).includes(code) ? t(`edit.err_${code}`) : textError(t, r.error))
      return
    }
    await esborraFotesTretes(aEnviar)
    toast.success(r.data?.estado === 'pendent_validacio' && oferta.estado !== 'pendent_validacio'
      ? t('edit.ok_revalidar') : t('edit.ok'))
    await onEditada?.(r.data?.estado ?? null)
  }

  /**
   * «Desa com a esborrany» (fase C del punto 3, fila 3.1.2): basta con el producto. Lo que hay
   * escrito tiene que tener buen formato (unos kilos a 0 no se guardan), pero puede faltar todo.
   */
  async function desaComEsborrany() {
    if (!productorId || esBuit(datos.producte)) return
    const invalids = invalidsDe()
    if (invalids.length > 0) {
      marcaIVeAlPrimer(invalids)
      const porClau = new Map(campos.map((c) => [c.clave, c]))
      const noms = invalids.map((k) => (k === 'gmaps_url' ? t('po.offer_maps') : porClau.get(k)?.etiqueta ?? k))
      setError(t('po.invalid_fields', { camps: noms.join(', ') }))
      return
    }
    if (!validaExtres(false)) return
    setError(null)
    setDesantEsb(true)
    // Con otros productos, el esborrany guarda `productes[]` (fase 6a).
    const enviades = filesUtils(extres)
    const aEnviar = cosAmbProductes(preparaEnviament(), extres, familiaDe)
    const r = await desaEsborranyOferta(productorId, aEnviar, mode === 'esborrany' ? oferta?.id : null)
    setDesantEsb(false)
    if (!r.ok || !r.data) {
      if (marcaErrorFila(r.producte_index, r.code, undefined, enviades)) return
      setError(textError(t, r.error))
      return
    }
    if (mode === 'crear') esborraEsborrany(productorId)
    else await esborraFotesTretes(aEnviar)
    toast.success(t('esb.desat'))
    onEsborranyDesat?.(r.data.id)
  }

  /** Borrar el esborrany (con confirmación): la RPC solo borra lo que sigue en esborrany. */
  async function esborraEsborranyServidor() {
    if (!oferta) return
    if (!(await confirma({
      titol: t('esb.esborra_t'), descripcio: t('esb.esborra_d'), confirmar: t('esb.esborra'), destructiu: true,
    }))) return
    const r = await esborraEsborranyOferta(oferta.id)
    if (!r.ok) { toast.error(textError(t, r.error)); return }
    toast.success(t('esb.esborrat'))
    onEsborrat?.()
  }

  // Sin productor no hay descriptor que pedir ni oferta que crear. Quién falta —«no tienes
  // organización» en el panel, «elige un productor» en el alta asistida— lo dice quien
  // monta el formulario: aquí no se puede saber, y decirlo mal es peor que no decirlo.
  if (!productorId) return null
  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  /**
   * Lo que se ve del lugar ELEGIDO (fila 3.4): su municipio y su enlace de Maps, que abre en
   * otra pestaña. Si el lugar no tiene enlace, se puede escribir uno PARA ESTA OFERTA: se guarda
   * en la oferta (`excedentes.gmaps_url`), nunca en la ficha del lugar.
   */
  function detallLloc(llocId: string, ambCamp: boolean) {
    const u = (catalogos?.ubicaciones ?? []).find((x) => x.id === llocId)
    if (!u) return null
    const invalidMaps = campsFaltants.has('gmaps_url')
    return (
      <div className="mt-2 space-y-2 text-sm" data-testid="lloc-detall">
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
            <MapPin className="size-4 shrink-0" aria-hidden />
            <span className="break-words">{u.municipio ?? t('po.place_no_town')}</span>
          </span>
          {u.gmaps_url && (
            <a href={u.gmaps_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline" data-testid="lloc-maps">
              {t('po.place_open_maps')} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </p>
        {!u.gmaps_url && ambCamp && (
          <div>
            <Label htmlFor={idDe('gmaps_url')} className={ETIQUETA}>
              {t('po.offer_maps')} <span className={OPCIONAL}>{t('po.optional')}</span>
            </Label>
            <Input id={idDe('gmaps_url')} name="gmaps_url" type="url" inputMode="url" aria-invalid={invalidMaps}
              value={String(datos.gmaps_url ?? '')} placeholder="https://maps.app.goo.gl/…" maxLength={500}
              onChange={(e) => set('gmaps_url', e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">{t('po.offer_maps_hint')}</p>
            {typeof datos.gmaps_url === 'string' && /^https?:\/\/\S+$/i.test(datos.gmaps_url.trim()) && (
              <a href={datos.gmaps_url.trim()} target="_blank" rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline">
                {t('po.place_open_maps')} <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </div>
        )}
      </div>
    )
  }

  /**
   * La familia del producto elegido, en su propia fila y con su nombre (18-11-2026, petición del
   * cliente): antes salía pegada al buscador, en letra pequeña y sin decir qué era, y se mezclaba
   * con la ayuda «Si no hi és…», que es del producto. No se pregunta: sale del producto.
   */
  function familiaAssignada() {
    if (!producteTriat?.familia) return null
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/30 px-3 py-2"
        data-testid="familia-assignada">
        <span className="text-sm text-muted-foreground">{t('po.familia_assignada')}</span>
        <span className="text-sm font-medium break-words">
          {etiquetaFamilia(producteTriat.familia, catalogos, lang)}
        </span>
      </div>
    )
  }

  function control(campo: CampoOferta) {
    const valor = datos[campo.clave]
    const id = idDe(campo.clave)
    const invalid = campsFaltants.has(campo.clave)
    // Los desplegables son `Desplegable` (03-11-2026; antes `<select>` nativos): ya traen
    // `text-base md:text-sm` —por debajo de 16 px iOS amplía la página al enfocar—, la altura de
    // los `Input` y la variante `aria-invalid:`. El `name` viaja por su `<input hidden>`.

    switch (campo.tipo) {
      case 'producte':
        // Editando, el producto no cambia: cambiaría la referencia y lo que ya vieron las
        // entidades (para otro producto se cancela y se publica otra).
        if (editar) {
          return (
            <p id={id} className="flex min-h-11 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm md:min-h-8"
              data-testid="producte-fix">
              <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 break-words font-medium">{String(valor ?? '')}</span>
            </p>
          )
        }
        // Un buscador (17-11-2026): se escribe un trozo y se toca la sugerencia; la familia sale
        // de detalle a la derecha de cada sugerencia y se rellena sola. Una vez elegida NO va
        // debajo del campo (18-11-2026): se mezclaba con la ayuda del producto; va en su propia
        // fila, «Família assignada», después de la ayuda (`familiaAssignada`).
        return (
          <CercadorOpcions id={id} name={campo.clave} invalid={invalid}
            opcions={opcionsProducte} valor={String(valor ?? '') || null}
            placeholder={t('po.product_search')} detallSota={false}
            onChange={(v) => set(campo.clave, v)} />
        )
      case 'causa': {
        // Fase B del punto 3 (fila 3.6): un solo control con las 7 categorías como grupos y sus
        // subcausas como opciones; se guarda la SUBCAUSA y la causa sale de ella. Debajo, la
        // pareja entera («Categoria — Subcausa»): a 375 px el control la recorta.
        const cataleg = catalegDelDescriptor(catalogos?.causas)
        const triat = String(valor ?? '')
        const opcions = teSubcauses(cataleg)
          ? opcionsSubcausa(cataleg, lang)
          : cataleg.map((c) => ({ valor: c.codigo, text: c.nombre }))
        const complet = textSubcausa(cataleg, triat, lang)
        return (
          <div className="min-w-0">
            <Desplegable id={id} name={campo.clave} aria-invalid={invalid} data-testid="of-subcausa"
              value={triat} onChange={(v) => set(campo.clave, v)} placeholder={t('po.subcausa_ph')}
              opcions={opcions} />
            {complet && <p className="mt-1 text-xs text-muted-foreground break-words">{complet}</p>}
          </div>
        )
      }
      case 'dies': {
        // Los días de recogida (17-11-2026, solo panel): los del lugar, editables. Fase 4: si el
        // lugar elegido tiene días, solo esos se pueden marcar (un día ya marcado que no es del
        // lugar se puede quitar, no añadir).
        const diesLloc = normalitzaDies(llocTriat?.dies_setmana)
        return (
          <div id={id} tabIndex={-1} className={cn('rounded-md', invalid && 'ring-2 ring-destructive/40')}>
            <XipsTria etiquetaId={`${id}-l`}
              opcions={DIES.map((d) => ({
                valor: String(d), text: t(`org.dia_${d}`), desactivat: diesLloc.length > 0 && !diesLloc.includes(d),
              }))}
              triats={Array.isArray(valor) ? (valor as unknown[]).map(String) : []}
              onChange={(v) => set(campo.clave, v.map(Number).sort((a, b) => a - b))} />
            {diesLloc.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="of-dies-del-lloc">
                {t('po.dies_del_lloc', { dies: diesLloc.map((d) => t(`org.dia_${d}`)).join(', ') })}
              </p>
            )}
          </div>
        )
      }
      case 'ubicacio': {
        const ubis = catalogos?.ubicaciones ?? []
        if (estatLloc.tipus !== 'llista') {
          const p = ubis.find((u) => u.id === estatLloc.principalId)
          const nom = p ? (p.alias ?? p.municipio ?? t('po.place_unnamed')) : t('po.place_unnamed')
          const canvia = () => { setCanviaLloc(true); set(campo.clave, '') }
          return (
            <div id={id} data-testid="lloc-habitual" tabIndex={-1}
              className={`rounded-lg border p-3 ${invalid ? 'border-error bg-error-fondo' : 'bg-muted/30'}`}>
              <p className="text-sm">{t('po.place_habitual')}: <strong>{nom}</strong></p>
              {detallLloc(estatLloc.principalId, estatLloc.tipus === 'confirmat')}
              {estatLloc.tipus === 'confirmar' ? (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">{t('po.place_confirm_q')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" className="h-11 whitespace-nowrap shrink-0 md:h-8"
                      onClick={() => triaLloc(estatLloc.principalId)}>
                      <Check className="size-4" aria-hidden /> {t('po.place_confirm')}
                    </Button>
                    <Button type="button" variant="outline" className="h-11 whitespace-nowrap shrink-0 md:h-8" onClick={canvia}>
                      {t('po.place_change')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-sm text-exito">
                    <Check className="size-4" aria-hidden /> {t('po.place_confirmed')}
                  </span>
                  <Button type="button" variant="outline" className="h-11 whitespace-nowrap shrink-0 md:h-8" onClick={canvia}>
                    {t('po.place_change')}
                  </Button>
                </div>
              )}
            </div>
          )
        }
        return (
          <div className="space-y-2">
            {ubis.length > 0 && (
              <Desplegable id={id} name={campo.clave} aria-invalid={invalid}
                value={String(valor ?? '')} onChange={triaLloc} placeholder={t('po.tria_lloc')}
                opcions={ubis.map((u) => ({
                  valor: u.id,
                  text: `${u.alias ?? u.municipio ?? t('po.place_unnamed')}${u.alias && u.municipio ? ` · ${u.municipio}` : ''}${u.es_principal ? ` (${t('org.place_principal')})` : ''}`,
                }))} />
            )}
            {typeof valor === 'string' && valor !== '' && detallLloc(valor, true)}
            {ubis.length === 0 && !llocNou && (
              <p className="text-sm text-muted-foreground">{t(esEquip ? 'po.no_locations_equip' : 'po.no_locations')}</p>
            )}
            {/* Un lloc nou sense sortir del formulari: un productor pot tenir diversos
                camps i magatzems, i obligar-lo a anar a la fitxa a mig alta és perdre'l. */}
            {!llocNou ? (
              <Button type="button" variant="outline" className="h-11 whitespace-normal md:h-8"
                onClick={() => setLlocNou({ alias: '', maps: '', municipi: null, dies: [], franges: [] })}>
                <Plus className="size-4" aria-hidden /> {t('po.place_add')}
              </Button>
            ) : (
              <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="of-lloc-nom" className={ETIQUETA}>{t('po.place_name')}</Label>
                  <Input id="of-lloc-nom" name="lloc-nom" value={llocNou.alias}
                    placeholder={t('po.place_name_ph')}
                    onChange={(e) => setLlocNou((l) => (l ? { ...l, alias: e.target.value } : l))} />
                </div>
                <div>
                  <Label htmlFor="of-lloc-municipi" className={ETIQUETA}>{t('po.place_town')}</Label>
                  <SelectorMunicipi id="of-lloc-municipi" valor={llocNou.municipi?.codi_ine ?? null}
                    onChange={(m) => setLlocNou((l) => (l ? { ...l, municipi: m } : l))} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="of-lloc-maps" className={ETIQUETA}>
                    {t('po.place_maps')} <span className={OPCIONAL}>{t('po.optional')}</span>
                  </Label>
                  <Input id="of-lloc-maps" name="lloc-maps" type="url" inputMode="url" value={llocNou.maps}
                    placeholder="https://maps.app.goo.gl/…"
                    onChange={(e) => setLlocNou((l) => (l ? { ...l, maps: e.target.value } : l))} />
                </div>
                {/* Fase 4: los días y las franjas del lugar, que quedan en su ficha y la oferta hereda. */}
                <EditorDiesFranges idPrefix="of-lloc" dies={llocNou.dies} franges={llocNou.franges}
                  onDies={(dies) => setLlocNou((l) => (l ? { ...l, dies } : l))}
                  onFranges={(franges) => setLlocNou((l) => (l ? { ...l, franges } : l))} />
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <Button type="button" className="h-11 whitespace-normal md:h-8" disabled={desantLloc}
                    onClick={() => void desaLlocNou()}>
                    {desantLloc ? t('c.saving') : t('po.place_save')}
                  </Button>
                  <Button type="button" variant="ghost" className="h-11 md:h-8" onClick={() => setLlocNou(null)}>
                    {t('c.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      }
      case 'opcions': {
        if (campo.multiple) {
          // VARIAS a la vez (05-10-2026): una casilla por opción, con su explicación al lado,
          // que aquí sí cabe. El valor es la lista de ids, en el orden de las opciones.
          const triades = modalitatsDe(valor) as string[]
          // «Espigolada» va con las modalidades pero NO es una: es una donación con el producto
          // en el campo. Sale solo con el producto en el campo, en el alta Y al editar (proceso
          // 3.4); la regla, una sola y pura, en `lib/modalitatsOferta.ts`.
          const ambEspigolada = campo.clave === 'modalitat' && ofereixEspigolada(datos)
          const espigolada = ambEspigolada && espigoladaMarcada(datos)
          const canvia = (idOpcio: string, on: boolean) => {
            const r = triaModalitat(datos, (campo.opciones ?? []).map((o) => o.id), idOpcio, on)
            if (r.espigolada === false) set('espigolada', false)
            set(campo.clave, r.modalitat)
          }
          const triaEsp = (on: boolean) => {
            const r = triaEspigolada(on)
            set('espigolada', r.espigolada)
            set(campo.clave, r.modalitat)
            if (r.producte_al_camp) set('producte_al_camp', r.producte_al_camp)
          }
          return (
            <div id={id} role="group" aria-invalid={invalid}
              className={cn('space-y-1 rounded-md', invalid && 'ring-2 ring-destructive/40')}>
              {(campo.opciones ?? []).map((o) => (
                <FilaCasella key={o.id} checked={!espigolada && triades.includes(o.id)} onChange={(on) => canvia(o.id, on)}>
                  <span className="font-medium">{o.titulo}</span>
                  {o.descripcion && <span className="block text-xs text-muted-foreground">{o.descripcion}</span>}
                </FilaCasella>
              ))}
              {ambEspigolada && (
                <div data-testid="of-espigolada">
                  <FilaCasella checked={espigolada} onChange={triaEsp}>
                    <span className="font-medium">{t('po.mod_espigolada')}</span>
                    <span className="block text-xs text-muted-foreground">{t('po.mod_espigolada_d')}</span>
                  </FilaCasella>
                </div>
              )}
              {campo.clave === 'modalitat' && avisModalitats && (
                <p className="text-xs text-aviso">{avisModalitats}</p>
              )}
              {campo.clave === 'modalitat' && motiuConveni && (
                <p className="text-xs text-error">{t(motiuConveni)}</p>
              )}
            </div>
          )
        }
        // La explicación de la opción ELEGIDA va debajo del control, no en la opción.
        const triada = (campo.opciones ?? []).find((o) => o.id === String(valor ?? ''))
        return (
          <>
            {SI_NO.has(campo.clave) ? (
              <TriaSiNo id={id} aria-labelledby={`${id}-l`} invalid={invalid}
                valor={valor == null ? null : String(valor)} onChange={(v) => set(campo.clave, v)}
                opcions={(campo.opciones ?? []).map((o) => ({ valor: o.id, text: o.titulo }))} />
            ) : (
              <Desplegable id={id} name={campo.clave} aria-invalid={invalid}
                value={String(valor ?? '')} onChange={(v) => set(campo.clave, v)}
                {...(campo.obligatorio ? { placeholder: t('po.tria_opcio') } : { buit: t('po.tria_opcio') })}
                opcions={(campo.opciones ?? []).map((o) => ({ valor: o.id, text: o.titulo }))} />
            )}
            {triada?.descripcion && (
              <p className="mt-1 text-xs text-muted-foreground">{triada.descripcion}</p>
            )}
            {/* Dicho aquí, al elegir, y no solo al final. */}
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
              {/* El campo, del ancho de media columna (como sus vecinos); la explicación, a todo el ancho. */}
              <Input id={id} name={campo.clave} type="number" step="0.01" min="0" aria-invalid={invalid}
                className="sm:max-w-[calc(50%-0.5rem)]"
                value={valor == null ? '' : String(valor)}
                onChange={(e) => {
                  setCostTocat(true)
                  set(campo.clave, e.target.value === '' ? null : Number(e.target.value))
                }} />
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {referencia == null ? t('po.cost_no_ref')
                  : rotulRef?.font
                    ? t(producteTriat?.cost_referencia_provisional ? 'po.cost_ref_mes_prov' : 'po.cost_ref_mes', {
                        v: eurKg(referencia), mes: rotulRef.mes, font: rotulRef.font,
                      })
                    : t('po.cost_ref', { v: eurKg(referencia) })}
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
          <Input id={id} name={campo.clave} type="number" aria-invalid={invalid}
            step={campo.clave === 'retorn_quantitat' ? '1' : '0.01'}
            min={campo.clave === 'retorn_quantitat' ? '1' : '0'}
            inputMode={campo.clave === 'retorn_quantitat' ? 'numeric' : 'decimal'}
            value={valor == null ? '' : String(valor)}
            onChange={(e) => set(campo.clave, e.target.value === '' ? null : Number(e.target.value))} />
        )
      default:
        // «Fins quin dia està disponible» con CALENDARIO (revisión del 23-09-2026). El control
        // da ISO (aaaa-mm-dd) y lo que se guarda y viaja es «dd/mm/aaaa»: es lo que entiende
        // `parseDisponibleFins()` en el servidor. Por defecto, hoy + 2 días (17-11-2026).
        if (campo.clave === 'disponible_fins') {
          return (
            <Input id={id} name={campo.clave} type="date" aria-invalid={invalid}
              min={avuiMadrid()}
              value={ddmmaaaaAIso(String(valor ?? ''))}
              onChange={(e) => set(campo.clave, isoADdmmaaaa(e.target.value))} />
          )
        }
        if (campo.format === 'franja') {
          // De qué hora a qué hora (05-10-2026): `SelectorFranja`, hora y cuarto. Fase 4: si el
          // lugar tiene franjas, se dicen debajo y se avisa si la de la oferta queda fuera.
          const frangesLloc = frangesDelLloc(llocTriat?.franges)
          const fora = !franjaDinsDelLloc(valor as Partial<Franja> | null, frangesLloc)
          const textFranges = frangesLloc.map((x) => `${x.inici}–${x.fi}`).join(', ')
          return (
            <div className="min-w-0">
              <SelectorFranja id={id} valor={valor as Partial<Franja> | null} invalid={invalid}
                onChange={(f) => set(campo.clave, f)} />
              {frangesLloc.length > 0 && (
                <p className={cn('mt-1 text-xs', fora ? 'text-aviso' : 'text-muted-foreground')} data-testid="of-franges-del-lloc">
                  {t(fora ? 'po.franja_fora_lloc' : 'po.franges_del_lloc', { franges: textFranges })}
                </p>
              )}
            </div>
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
          : <Input id={id} name={campo.clave} type="text" aria-invalid={invalid} maxLength={400} value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)} />
    }
  }

  // Por qué no se puede publicar ahora mismo, si no se puede: se DICE, no solo se apaga el
  // botón (en táctil no hay tooltip, §6ter). Con varias modalidades (05-10-2026) solo se bloquea
  // si NINGUNA tiene su convenio: con una basta para publicar, y de las demás se avisa.
  const modalitatsTriades = modalitatsDe(datos.modalitat)
  const bloquejades = motiuModalitat ? modalitatsTriades.filter((m) => motiuModalitat(m) !== null) : []
  const motiuConveni = bloqueja
    ? 'avis_conv.bloquejat'
    : (motiuModalitat && modalitatsTriades.length > 0 && bloquejades.length === modalitatsTriades.length
      ? motiuModalitat(modalitatsTriades[0])
      : null)
  // Editando: si el PRODUCTOR cambia kilos o modalidades, vuelve a validación (D4). Se dice antes.
  const revalidara = editar && oferta !== null && !esEquip && oferta.estado !== 'pendent_validacio' && (
    Number(datos.kg) !== Number(oferta.kg_total ?? 0)
    || modalitatsTriades.join() !== modalitatsDe(oferta.modalitats?.length ? oferta.modalitats : oferta.modalitat).join()
    // Marcar la espigolada también la devuelve a validación (`editar_oferta`, 20270617100300).
    || (espigoladaMarcada(datos) && !oferta.espigolada_demanada)
  )
  const avisModalitats = !motiuConveni && bloquejades.length > 0
    ? t('po.mod_sense_conveni', { mods: bloquejades.map((m) => t(`od.mod_${m}`)).join(', ') })
    : null
  // El punto de partida: una oferta recién publicada, sin nadie interesado todavía. Sale del
  // mismo módulo que lo cuenta después en el detalle.
  const puntInicial = puntOferta(
    { estado: 'publicada', kgTotal: 0, kgCanalitzats: 0 }, 'productor',
  )

  return (
    <div className="space-y-4" data-testid="formulari-oferta">
      {/* --- Qué pasa cuando publicas. Abierto la primera vez; después, plegado. --- */}
      {dialegConfirma}
      {/* Solo para el productor: le cuenta qué pasará con SU oferta («Podràs seguir-ho des de Les
          meves ofertes»). En el alta asistida del equipo sobraba y le hablaba a quien no era. */}
      {!editar && !esEquip && (
      <Collapsible open={procesObert} onOpenChange={setProcesObert}>
        {/* Tarjeta a mano y no `Card`: el disparador tiene que llevar ÉL el relleno para que el
            área táctil sea la fila entera. */}
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
      )}

      {blocs.map((bloc, i) => {
        const obert = i <= obertsAra
        if (!obert) {
          // Cerrado: se ve el título (el conjunto) y por qué no se puede rellenar todavía.
          return (
            <div key={bloc.clau || i} data-testid={`bloc-${bloc.clau}`} data-obert="false"
              className="rounded-xl border border-dashed bg-muted/30 p-4">
              <p className="flex items-center gap-2 font-titulos text-base font-semibold text-muted-foreground">
                <Lock className="size-4 shrink-0" aria-hidden /> {bloc.titol ?? ''}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t('po.bloc_tancat')}</p>
            </div>
          )
        }
        return (
          <Card key={bloc.clau || i} data-testid={`bloc-${bloc.clau}`} data-obert="true">
            {bloc.titol && (
              <CardHeader>
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
                  className={cn('min-w-0', (campo.clave === 'observacions' || campo.tipo === 'ubicacio' || campo.tipo === 'dies'
                    || campo.tipo === 'producte' || campo.multiple || campo.format === 'franja'
                    // El valor de coste lleva dos líneas de explicación (fuente y mes): en media
                    // columna quedaban en una tira estrecha y larga (18-11-2026).
                    || campo.clave === 'cost_kg') && 'sm:col-span-2')}
                >
                  {/* Sin asterisco: el formulario es mínimo y todo lo que aparece hace falta,
                      así que lo que se marca es lo que se puede dejar en blanco (DESIGN.md §6).
                      La etiqueta, Inter 500 `sm` en el color del texto (DESIGN.md «Formulario»;
                      hasta el 18-11-2026 iba en `xs` gris y se confundía con las ayudas). */}
                  <Label id={`${idDe(campo.clave)}-l`} htmlFor={idDe(campo.clave)} className={ETIQUETA}>
                    {campo.etiqueta}
                    {!campo.obligatorio && <span className={OPCIONAL}>{t('po.optional')}</span>}
                  </Label>
                  {control(campo)}
                  {proposats.has(campo.clave) && !(campo.tipo === 'ubicacio' && estatLloc.tipus !== 'llista') && (
                    <p className="mt-1 text-xs text-muted-foreground" data-testid={`proposat-${campo.clave}`}>
                      {t('po.proposat_fitxa')}
                    </p>
                  )}
                  {campo.ayuda && <p className="mt-1 text-xs text-muted-foreground">{campo.ayuda}</p>}
                  {campo.tipo === 'producte' && familiaAssignada()}
                </div>
              ))}
              {/* Los OTROS productos (fase 6a), en el bloque de la cantidad: el primero ya tiene
                  producto y kilos. Ni al editar (es UNA oferta) ni sin bloques (servidor viejo). */}
              {!editar && (bloc.clau === 'quantitat' || blocs.length === 1) && (
                <AltresProductes files={extres} onChange={canviaExtres} opcionsProducte={opcionsProducte}
                  principal={esBuit(datos.producte) ? null : String(datos.producte)}
                  ambCaixes={campos.some((c) => c.clave === 'caixes' && aplica(c))}
                  ambPreu={campos.some((c) => c.clave === 'preu_minim' && aplica(c))}
                  preuPrincipal={datos.preu_minim} errors={errorsExtres} />
              )}
              {/* La FOTO va en el bloque del producto, que es donde se piensa en qué se ofrece.
                  No es un campo del descriptor porque el bot de WhatsApp todavía no recibe
                  imágenes (brecha 8): viaja en `datos.fotos` y `crear-oferta` la valida aparte. */}
              {(bloc.clau === 'producte' || (blocs.length === 1)) && productorId && (
                <div className="min-w-0 sm:col-span-2">
                  <p className={cn(ETIQUETA, 'text-sm font-medium')}>
                    {t('foto.label')} <span className={OPCIONAL}>{t('foto.recommended')}</span>
                  </p>
                  <SelectorFotos
                    productorId={productorId}
                    rutes={Array.isArray(datos.fotos) ? (datos.fotos as string[]) : []}
                    onChange={(r) => {
                      const treta = r.length < (Array.isArray(datos.fotos) ? datos.fotos.length : 0)
                      set('fotos', r)
                      // Con la oferta ya guardada, quitar una foto no la borra todavía: si se
                      // cancela, la fila la sigue citando. Se borra al guardar (`esborraFotesTretes`).
                      if (treta && mode !== 'crear') return false
                    }}
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
        )
      })}

      {/* --- El pie se queda a la vista: en un móvil el botón caería bajo el pliegue.
              `env(safe-area-inset-bottom)` porque el viewport va a `viewport-fit=cover` (§2).
              Sin `-mx-4` desde el 17-11-2026: venía de cuando la página tenía `px-4`; con el
              ancho único del shell (`w-[96%]`, §2) sobresalía 16 px (medido a 375). --- */}
      <div
        className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-background/95 py-3 backdrop-blur"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {/* El error va DENTRO del pie fijo (29-09-2026): debajo de la tarjeta quedaba tapado por
            este mismo pie en el móvil. Aquí está siempre a la vista, junto al botón. */}
        {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
        {editar && revalidara && (
          <p className="w-full rounded-md bg-aviso-fondo p-2 text-sm text-aviso">{t('edit.avis_revalidar')}</p>
        )}
        {/* Sin el convenio que toca, el botón se apaga y el motivo va escrito debajo. Editando
            no: la oferta ya circula y el convenio se mira al canalizar. */}
        <Button
          className="h-11 whitespace-normal md:h-8"
          onClick={() => void enviar()}
          disabled={enviant || desantEsb || (!editar && motiuConveni !== null)}
        >
          {enviant ? t('c.saving') : editar ? t('edit.desa') : t('po.publish')}
        </Button>
        {/* El esborrany (fase C): con el producto elegido basta para guardarlo. */}
        {!editar && (
          <Button variant="outline" className="h-11 whitespace-normal md:h-8" data-testid="desa-esborrany"
            onClick={() => void desaComEsborrany()}
            disabled={enviant || desantEsb || esBuit(datos.producte)}>
            {desantEsb ? t('c.saving') : mode === 'esborrany' ? t('esb.desa') : t('esb.desa_com')}
          </Button>
        )}
        {onCancel && (
          <Button
            variant="ghost"
            className="h-11 whitespace-normal md:h-8"
            onClick={() => { if (productorId && mode === 'crear') esborraEsborrany(productorId); onCancel() }}
          >
            {t('c.cancel')}
          </Button>
        )}
        {mode === 'esborrany' && oferta && (
          <Button variant="ghost" className="h-11 whitespace-normal text-error md:h-8" data-testid="esborra-esborrany"
            onClick={() => void esborraEsborranyServidor()} disabled={enviant || desantEsb}>
            <Trash2 className="size-4" aria-hidden /> {t('esb.esborra')}
          </Button>
        )}
        {!editar && esBuit(datos.producte) && (
          <p className="w-full text-xs text-muted-foreground">{t('esb.cal_producte')}</p>
        )}
        {motiuConveni && !editar && (
          <p className="w-full text-sm text-error">{t(motiuConveni)}</p>
        )}
      </div>
    </div>
  )
}
