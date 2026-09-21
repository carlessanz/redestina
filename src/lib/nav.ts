// Menú declarativo por rol. Mismo espíritu que el NAV que vivía en App.tsx (array de
// objetos con clave i18n), ampliado a grupos, iconos y contadores en vivo.
//
// El menú es lo que hace visible el modelo de roles: cada panel enseña sus secciones y,
// cuando una misma cuenta tiene varios (productora y receptora a la vez), el sidebar los
// pinta TODOS, uno debajo de otro y separados. Antes enseñaba uno y había que conmutar,
// lo que además no funcionaba: el conmutador cambiaba el panel sin navegar y la guarda de
// la ruta lo revertía en el render siguiente.
//
// Por eso ningún `labelKey` puede repetirse entre paneles: en modo icono la etiqueta solo
// se ve como tooltip, y dos «La meva organització» seguidos no distinguen nada.

import {
  Building2, Calculator, ClipboardCheck, Coins, FileSignature, FileText, FolderOpen, Handshake, History,
  Home, LayoutDashboard, Leaf, Receipt,
  MessageSquare, Package, PlusCircle, Settings2, Sprout, Store, Truck, Users, Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Rol } from './rols'

/** Contadores que el sidebar pinta como badge; se resuelven en AppSidebar. */
export type Comptador =
  | 'aprovacions' | 'missatges' | 'documents'
  // Albarans que esperan al EQUIPO (borradores por emitir + REC por conciliar; no cuenta
  // los que esperan a la otra parte) y productos canalizados este año sin coste por kilo.
  // Los alimenta `pendents_equip()` (14-09-2026), la misma fuente que el tablero.
  | 'albarans' | 'costos'
  // Lo que el panel externo tiene pendiente de firmar o confirmar (`pendents_meus()`).
  // Uno por panel: una cuenta con doble rol no debe ver en su menú de productor lo que
  // espera su entidad.
  | 'pendents_productor' | 'pendents_receptor'

export interface NavItem {
  to: string
  labelKey: string
  icon: LucideIcon
  /** Coincidencia exacta (para los índices de sección). */
  end?: boolean
  comptador?: Comptador
  /** Acción destacada del panel (se pinta como botón, no como enlace). */
  primari?: boolean
  /**
   * `false` = fuera de la barra inferior de móvil; sigue en el menú lateral.
   *
   * La barra reparte el ancho a partes iguales, así que a 360 px cada celda da ~62 px de
   * texto y las etiquetas de este proyecto piden 62-113 px (son largas a propósito: §2,
   * `nav.ts` las elige únicas entre paneles para que los tooltips del menú plegado no se
   * repitan). Con cinco entradas la barra desborda hasta 94 px en catalán, y `truncate` no
   * lo arregla: el `li` es `flex-1` y un flex item con `min-width:auto` no encoge por
   * debajo de su contenido, así que el `nowrap` convierte el salto de línea en
   * desbordamiento. Cuatro es el máximo real.
   */
  barra?: false
}

export interface NavGrup {
  titolKey?: string
  items: NavItem[]
}

// El menú del equipo sigue, de arriba abajo, EL CAMINO DE UNA OFERTA; lo que no es de la
// oferta (organizaciones, archivo técnico, configuración) va debajo. Hasta el 14-09-2026 el
// orden era el de las fases de desarrollo, y se leía al revés: «Costos per quilo» iba detrás
// del Tancament al que precede (sin coste no hay certificado), «Convenis» —lo que habilita
// operar— era la última entrada, y «Espigolades», que es un ORIGEN de oferta, iba después de
// los albaranes. Sin números en las etiquetas: son también el título de la barra superior y
// el tooltip del menú plegado. La secuencia numerada vive en el «Com funciona» del tablero
// (`FASES_EQUIP` en procesOferta.ts), que enlaza a cada entrada en este mismo orden.
const EQUIP: NavGrup[] = [
  { items: [{ to: '/equip/tauler', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true }] },
  {
    titolKey: 'nav.grp_operacio',
    items: [
      // Primero el camino entero: la pantalla guiada lleva un lote de punta a punta
      // (modelo asistido, §1bis). Las de debajo son sus paradas sueltas.
      // `barra: false` — el equipo tiene siete secciones y la barra de móvil admite cuatro.
      { to: '/equip/canalitzacio', labelKey: 'nav.canalitzacio', icon: Workflow, barra: false },
      { to: '/equip/ofertes', labelKey: 'nav.offers', icon: Package },
      // Junto a Ofertes porque es el otro origen: una jornada crea registros y un REC.
      { to: '/equip/espigolades', labelKey: 'nav.espigolades', icon: Leaf },
      { to: '/equip/aprovacions', labelKey: 'nav.approvals', icon: ClipboardCheck, comptador: 'aprovacions' },
      { to: '/equip/missatgeria', labelKey: 'nav.messaging', icon: MessageSquare, comptador: 'missatges' },
      { to: '/equip/albarans', labelKey: 'nav.albarans', icon: Truck, comptador: 'albarans' },
    ],
  },
  {
    titolKey: 'nav.grp_tancament',
    items: [
      // ANTES del Tancament: es su prerrequisito (`cost.blocking_hint`).
      { to: '/equip/costos', labelKey: 'nav.costos', icon: Coins, comptador: 'costos' },
      { to: '/equip/tancament', labelKey: 'nav.tancament', icon: Calculator },
    ],
  },
  {
    titolKey: 'nav.grp_base',
    items: [
      { to: '/equip/productors', labelKey: 'nav.producers', icon: Users },
      { to: '/equip/entitats', labelKey: 'nav.entities', icon: Building2 },
      // Papeleo POR ORGANIZACIÓN (la campaña va por fichas), no una etapa de la oferta.
      // Sin badge: los «per contrasignar» ya suman en Aprovacions.
      { to: '/equip/convenis', labelKey: 'nav.convenis', icon: FileSignature },
    ],
  },
  {
    titolKey: 'nav.grp_sistema',
    items: [
      // Archivo técnico (PDF, envíos), no trabajo del lote.
      { to: '/equip/documents', labelKey: 'nav.documents', icon: FileText, comptador: 'documents' },
      { to: '/equip/configuracio', labelKey: 'nav.settings', icon: Settings2 },
    ],
  },
]

const PRODUCTOR: NavGrup[] = [
  {
    items: [
      { to: '/productor/inici', labelKey: 'nav.home', icon: Home, end: true },
      { to: '/productor/ofertes/nova', labelKey: 'nav.new_offer', icon: PlusCircle, primari: true, barra: false },
      // `Sprout` y no `Package`: el panel del equipo ya usa `Package` para «Ofertes», y
      // con los dos menús a la vez el mismo icono dos veces no distingue nada.
      { to: '/productor/ofertes', labelKey: 'nav.my_offers', icon: Sprout, end: true },
      { to: '/productor/documents', labelKey: 'nav.my_documents', icon: FolderOpen, comptador: 'pendents_productor' },
    ],
  },
]

const RECEPTOR: NavGrup[] = [
  {
    items: [
      { to: '/receptor/mercat', labelKey: 'nav.market', icon: Store, end: true },
      { to: '/receptor/interessos', labelKey: 'nav.my_interests', icon: Handshake },
      { to: '/receptor/historic', labelKey: 'nav.history', icon: History, barra: false },
      { to: '/receptor/documents', labelKey: 'nav.entity_documents', icon: Receipt, comptador: 'pendents_receptor' },
    ],
  },
]

/**
 * La ficha de la organización, FUERA de los dos paneles (16-09-2026).
 *
 * Estaba dentro de cada uno —«La meva explotació» en productor, «La meva entitat» en
 * receptor— y con doble rol eso daba dos entradas con dos nombres para una misma
 * organización. Ahora es una sola, con un nombre único, y se pinta después de todos los
 * paneles: no pertenece a ninguno, igual que la organización no es «de» un papel.
 *
 * ⚠️ NO la ve el equipo: opera en nombre de otros y no tiene organización propia. Quien la
 *    monta (`AppSidebar`) la añade solo si hay algún panel externo.
 */
export const ORGANITZACIO: NavGrup[] = [
  {
    items: [
      { to: '/organitzacio', labelKey: 'nav.my_org', icon: Building2, barra: false },
    ],
  },
]

export function navPerRol(rol: Rol | null): NavGrup[] {
  switch (rol) {
    case 'intern': return EQUIP
    case 'productor': return PRODUCTOR
    case 'receptor': return RECEPTOR
    default: return []
  }
}

/** Entradas planas, para la barra inferior de móvil. */
export function itemsPlans(grups: NavGrup[]): NavItem[] {
  return grups.flatMap((g) => g.items)
}
