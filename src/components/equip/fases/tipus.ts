// Lo que comparten las seis fases del ciclo guiado (`/equip/canalitzacio/:id`).
//
// La pantalla se partió el 27-10-2026 (gestión autónoma, fase 5): `CanalitzacioDetall` carga,
// calcula la escalera y pinta el punto; cada fase es un componente con sus acciones y sus
// mensajes. Lo que una fase necesita del lote viaja en `ContextFase`, y ninguna vuelve a leer
// lo que ya leyó el orquestador.

import type { Missatge } from '../../../lib/missatgesOferta'
import type { CanalitzacioCanal, FetsCanal, PasEscala } from '../../../lib/passosCanalitzacio'
import type { Excedente, Modalitat } from '../../../types'

/** Un convenio, tal como lo devuelve `canalitzacio_assistida()`. */
export interface ConveniFase {
  id: string
  estado: string
  numero: string | null
  tipo?: string | null
  /** `declarat` = vigente sin firma (fase 1 de la gestión autónoma). */
  origen?: string | null
}

/** Lo que la RPC devuelve además de los hechos del ciclo. */
export interface ExtraCanal {
  oferta: {
    id: string; id_excedente: string | null; modalitat: string | null; producto: string | null
    /** Todas las modalidades de la oferta (la RPC las devuelve desde el 07-10-2026). */
    modalitats?: string[] | null
  }
  productor: { id: string; nom: string | null } | null
  /** El cierre del ejercicio de la oferta (el real si lo hay), con su id para enlazarlo. */
  exercici: { id: string; estado: string; modo: string } | null
  respostes: {
    id: string; entidad_id: string | null; entitat: string
    estado: string; aprovacio: string; kg_solicitados: number | null
    /** Desde `20270430100000`: lo que pidió, igual que en el Mercat. */
    canal?: string | null
    preu_ofert?: number | null
    modalitat?: Modalitat | null
    recollida_at?: string | null
    kg_aprovats?: number | null
    tipo_receptor?: string | null
    /** El convenio que ESTA receptora necesita para esta modalidad, si lo tiene. */
    conveni_rec: ConveniFase | null
  }[]
  albarans: {
    id: string; tipo: string; estado: string; numero: string | null
    canalizacion_id: string | null
    conciliado_at?: string | null
    fora_tolerancia?: boolean | null
  }[]
  conveni_gen: ConveniFase | null
  /** Las canalizaciones con lo que dice de su recogida (`20270430100000`). */
  canalitzacions: CanalitzacioCanal[]
}

export interface ContextFase {
  fets: FetsCanal
  extra: ExtraCanal
  /** La fila entera de la oferta: el texto, la finca, `producte_al_camp`… */
  oferta: Excedente | null
  /** La escalera entera, por si una fase necesita saber el estado de un paso. */
  escala: PasEscala[]
  /** Los mensajes de la oferta (`useMissatgesOferta`); cada fase filtra los suyos. */
  missatges: Missatge[]
  potAprovar: boolean
  esSuperAdmin: boolean
  /** Tras cualquier acción: vuelve a leer el lote, los contadores y los mensajes. */
  onCanvi: () => void
}

/** Un paso concreto de la escalera. */
export function pasDe(escala: PasEscala[], pas: PasEscala['pas']): PasEscala | undefined {
  return escala.find((x) => x.pas === pas)
}
