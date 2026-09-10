export interface WaContact {
  id: string
  phone: string
  name: string | null
  opt_in: boolean
  opt_in_at: string | null
  opt_out_at: string | null
  /** Última vez que el contacto nos escribió; define la ventana de servicio de 24 h */
  last_inbound_at: string | null
  created_at: string
}

export interface Productor {
  id: string
  name: string
  email: string | null
  /** E.164 sin '+'. Nullable: hay productores del Excel sin teléfono utilizable */
  phone: string | null
  created_at: string
  empresa: string | null
  codigo: string | null
  comentario: string | null
  visitado: string | null
  conveni: string | null
  tipo_empresa: string | null
  /** Teléfonos adicionales encontrados en la misma celda del Excel */
  telefono_alt: string | null
  direccion: string | null
  codigo_postal: string | null
  nif: string | null
  area_geografica: string | null
  poblacion: string | null
  productos_habituales: string[] | null
  data_alta: string | null
  activo: boolean | null
  /** Usuario de prueba: solo estos reciben WhatsApp/email (fuente de verdad, §8) */
  es_test: boolean
}

export interface WaMessage {
  id: string
  wa_message_id: string | null
  contact_phone: string
  direction: 'inbound' | 'outbound'
  type: string | null
  body: string | null
  status: string | null
  created_at: string
}

export interface ProductorUbicacion {
  id: string
  productor_id: string | null
  alias: string | null
  gmaps_url: string | null
  coord_lat: number | null
  coord_lng: number | null
  municipio: string | null
  es_principal: boolean | null
}

export interface Entidad {
  id: string
  nombre: string
  codigo: string | null
  familia: string | null
  prioritat: number | null
  estat: string | null
  gestio: string | null
  /** Modalitat d'aprofitament: Donació · Transformació · Venda · Maquila · Altres */
  modalitat: string | null
  comentarios: string | null
  area_geografica: string | null
  poblacion: string | null
  direccion: string | null
  codigo_postal: string | null
  horario: string | null
  nif: string | null
  telefono: string | null
  telefono2: string | null
  telefono3: string | null
  email: string | null
  email2: string | null
  contacto: string | null
  contacto2: string | null
  calendari_repartiment: string | null
  /** Derivado del texto libre del Excel; null cuando no es concluyente */
  productes_frescos: boolean | null
  productes_frescos_txt: string | null
  transport_plataforma: boolean | null
  transport_plataforma_txt: string | null
  descarrega_toro: boolean | null
  descarrega_toro_txt: string | null
  data_alta: string | null
  opt_in: boolean | null
  /** Usuario de prueba: solo estos reciben WhatsApp/email (fuente de verdad, §8) */
  es_test: boolean
  created_at: string
}

export type EstadoExcedente =
  | 'borrador'
  | 'publicada'
  | 'parcial'
  | 'bloqueada'
  | 'cerrada'
  | 'no_colocada'
  | 'cancelada'

export type Modalitat = 'donacio' | 'venda' | 'maquila'

export interface Excedente {
  id: string
  /** Formato E-AAMMDD-XXX-YYY-N */
  id_excedente: string | null
  productor_id: string | null
  ubicacion_id: string | null
  familia: string | null
  producto: string | null
  variedad: string | null
  kg_total: number | null
  num_caixes: number | null
  tipo_caixa: string | null
  retorn_envasos: string | null
  modalitat: Modalitat | null
  causa: string | null
  causa_codigo: string | null
  disponible_desde: string | null
  disponible_hasta: string | null
  horari_recollida: string | null
  responsable: string | null
  observacions: string | null
  valor_eur: number | null
  /** Preu mínim (€/kg) que fixa el productor; només venda/maquila */
  preu_minim: number | null
  texto_oferta: string | null
  estado: EstadoExcedente
  motivo_no_colocada: string | null
  created_at: string
}

export interface Canalizacion {
  id: string
  excedente_id: string | null
  entidad_id: string | null
  kg_confirmados: number | null
  kg_reales: number | null
  caixes_entregades: number | null
  caixes_retornades: number | null
  data_hora_recollida: string | null
  albaran_aprofitat: string | null
  albaran_entrada: string | null
  firmado_entidad: boolean | null
  firmado_productor: boolean | null
  comentarios: string | null
  estado: string | null
  created_at: string
}

export interface OfertaRespuesta {
  id: string
  excedente_id: string
  entidad_id: string | null
  /** E.164 sin '+'; casa la respuesta entrante con la fila pendiente */
  telefono: string | null
  canal: 'whatsapp' | 'email'
  /** Respuesta de la ENTIDAD */
  estado: 'pendent' | 'acceptada' | 'rebutjada'
  kg_solicitados: number | null
  caixes_solicitades: number | null
  preu_ofert: number | null
  /** Decisión del SUPERADMIN (aprueba y convierte en canalización) */
  aprovacio: 'pendent' | 'aprovada' | 'rebutjada'
  aprovat_at: string | null
  motiu_aprovacio: string | null
  canalizacion_id: string | null
  /** Estado del diálogo de aceptación por WhatsApp */
  dialeg_pas: string | null
  dialeg_dades: Record<string, unknown>
  mensaje_respuesta: string | null
  enviado_at: string
  respondido_at: string | null
  created_at: string
}

export interface IntakeSession {
  id: string
  telefono: string | null
  productor_id: string | null
  paso_actual: string | null
  datos_parciales: Record<string, unknown>
  excedente_id: string | null
  updated_at: string
}

/**
 * Vincula una cuenta con su ficha de organización (§4bis). `aprovacio` es un eje
 * SEPARADO de `activo` a propósito: `activo=false` tendría que significar a la vez
 * «todavía no validada» (registro público, sale en la cola de aprobaciones) y
 * «desactivada por el equipo» (no debe reaparecer nunca).
 */
export interface Membresia {
  id: string
  user_id: string
  tipo: 'productor' | 'entidad'
  /** Exactamente una de las dos, coherente con `tipo` */
  productor_id: string | null
  entidad_id: string | null
  rol_org: 'titular' | 'operador'
  activo: boolean
  /** Decisión del equipo sobre el alta: solo la mueven las RPC aprovar/rebutjar_registre */
  aprovacio: 'pendent' | 'aprovada' | 'rebutjada'
  aprovat_at: string | null
  aprovat_per: string | null
  motiu_aprovacio: string | null
  created_at: string
}

export interface Producto {
  nombre: string
  familia: string | null
  eur_kg: number | null
}

export interface Causa {
  codigo: string
  nombre: string | null
}

export interface FactorConversion {
  producto: string
  kg_por_unidad: number | null
}

// --- Sistema documental (fase 1, migraciones 20260928*) ---

export type DocumentoTipo =
  | 'REC' | 'ENT' | 'OPE'
  | 'R-REC' | 'R-ENT' | 'R-OPE'
  | 'CONV' | 'RES' | 'CD' | 'CT' | 'PLA' | 'PROVA'

export type DocumentoObjetoTipo =
  | 'albaran' | 'convenio' | 'cierre_donante' | 'espigolada' | 'plan' | 'prova'

export type DocumentoEstado = 'pendiente_fichero' | 'emitido' | 'error'

export interface Documento {
  id: string
  tipo: DocumentoTipo
  subtipo: 'emes' | 'conciliat' | 'firmat' | 'contrafirmat' | 'provisional' | 'definitiu' | null
  objeto_tipo: DocumentoObjetoTipo
  objeto_id: string
  numero_completo: string
  version: number
  serie: string
  ejercicio: number
  /** El modo vive en el dato: decide serie P-*, marca de agua y destinatarios */
  modo: 'real' | 'prueba'
  idioma: 'ca' | 'es'
  plantilla_id: string | null
  /** Snapshot congelado de lo que dice el documento; el PDF se regenera desde aquí */
  datos: Record<string, unknown>
  /** Huella del snapshot. Es la que se IMPRIME como código de verificación */
  sha256_datos: string
  /** Ruta dentro del bucket `documentos`, fijada por ruta_documento() al insertar */
  ruta: string | null
  /** Huella de los bytes del PDF; verifica la descarga */
  sha256_fichero: string | null
  bytes: number | null
  paginas: number | null
  estado: DocumentoEstado
  intentos: number
  ultimo_error: string | null
  envio: Record<string, unknown> | null
  vigente: boolean
  sustituido_por: string | null
  emitido_por: string | null
  emitido_at: string
  fichero_at: string | null
}

export interface DocumentoEnvio {
  id: string
  documento_id: string
  destinatario: string
  canal: 'email'
  estado: 'pendent' | 'enviat' | 'error'
  proveedor_id: string | null
  error: string | null
  enviado_at: string | null
  created_at: string
}

export interface SerieDocumental {
  serie: string
  ejercicio: number
  ultimo: number
  /** Relleno con ceros: REC-2026-00042 son 5, RES-2026-0012 son 4 */
  digitos: number
}
