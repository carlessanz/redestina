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
  MessageSquare, Package, PlusCircle, Settings2, Sprout, Store, Truck, UserCircle, Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Rol } from './rols'

/** Contadores que el sidebar pinta como badge; se resuelven en AppSidebar. */
export type Comptador = 'aprovacions' | 'missatges' | 'documents'

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

const EQUIP: NavGrup[] = [
  { items: [{ to: '/equip/tauler', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true }] },
  {
    titolKey: 'nav.grp_operacio',
    items: [
      { to: '/equip/ofertes', labelKey: 'nav.offers', icon: Package },
      { to: '/equip/aprovacions', labelKey: 'nav.approvals', icon: ClipboardCheck, comptador: 'aprovacions' },
      { to: '/equip/missatgeria', labelKey: 'nav.messaging', icon: MessageSquare, comptador: 'missatges' },
      { to: '/equip/documents', labelKey: 'nav.documents', icon: FileText, comptador: 'documents' },
      { to: '/equip/albarans', labelKey: 'nav.albarans', icon: Truck },
      { to: '/equip/espigolades', labelKey: 'nav.espigolades', icon: Leaf },
      { to: '/equip/tancament', labelKey: 'nav.tancament', icon: Calculator },
      { to: '/equip/costos', labelKey: 'nav.costos', icon: Coins },
      { to: '/equip/convenis', labelKey: 'nav.convenis', icon: FileSignature },
    ],
  },
  {
    titolKey: 'nav.grp_base',
    items: [
      { to: '/equip/productors', labelKey: 'nav.producers', icon: Users },
      { to: '/equip/entitats', labelKey: 'nav.entities', icon: Building2 },
    ],
  },
  { items: [{ to: '/equip/configuracio', labelKey: 'nav.settings', icon: Settings2 }] },
]

const PRODUCTOR: NavGrup[] = [
  {
    items: [
      { to: '/productor/inici', labelKey: 'nav.home', icon: Home, end: true },
      { to: '/productor/ofertes/nova', labelKey: 'nav.new_offer', icon: PlusCircle, primari: true, barra: false },
      // `Sprout` y no `Package`: el panel del equipo ya usa `Package` para «Ofertes», y
      // con los dos menús a la vez el mismo icono dos veces no distingue nada.
      { to: '/productor/ofertes', labelKey: 'nav.my_offers', icon: Sprout, end: true },
      { to: '/productor/documents', labelKey: 'nav.my_documents', icon: FolderOpen },
      { to: '/productor/perfil', labelKey: 'nav.my_producer_org', icon: UserCircle },
    ],
  },
]

const RECEPTOR: NavGrup[] = [
  {
    items: [
      { to: '/receptor/mercat', labelKey: 'nav.market', icon: Store, end: true },
      { to: '/receptor/interessos', labelKey: 'nav.my_interests', icon: Handshake },
      { to: '/receptor/historic', labelKey: 'nav.history', icon: History, barra: false },
      { to: '/receptor/documents', labelKey: 'nav.entity_documents', icon: Receipt },
      { to: '/receptor/perfil', labelKey: 'nav.my_entity', icon: Building2 },
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
