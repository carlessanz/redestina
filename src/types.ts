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
  /** Municipio del catálogo. Nulo mientras no se case con el texto libre de `municipio` */
  municipio_ine: string | null
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
  created_at: string  // --- fase 3 ---
  origen: 'intake' | 'panel' | 'asistido' | 'espigolament'
  espigolada_id: string | null
  /** Previsión para el futuro módulo de espigolament: evita duplicar kilos */
  ref_externa: string | null

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
  created_at: string  // --- fase 3: valorización, lote y conciliación ---
  valorizacion: 'donacio' | 'venda' | 'maquila' | null
  /** Coste por kilo del ejercicio, copiado al crear y congelado al conciliar. Null bloquea el cierre */
  coste_kg: number | null
  nota_lote: string | null
  codigo_lote: string | null
  /** Los únicos kilos que cuentan para indicadores y certificados (D13) */
  kg_conciliados: number | null
  conciliada_at: string | null
  conciliada_por: string | null
  motivo_conciliacion: string | null
  conciliacion_retroactiva: boolean

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
  /** Generaciones que fallaron Y lo reportaron (lo sube `marcar_documento_error`) */
  intentos: number
  /**
   * Veces que el job de reintento lo ha encolado, conteste el generador o no.
   * ⚠️ `estado === 'error' && intentos === 0` es la firma de «nadie contestó»: la función
   * murió sin reportar, típicamente cortada por el límite de CPU del runtime. Es la única
   * forma de distinguir ese caso de un error normal, y no hace falta ningún marcador.
   */
  reencolados: number
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

export interface BloquePlantilla {
  tipo: 'h1' | 'h2' | 'h3' | 'p' | 'lista' | 'salt'
  /** En `lista`, una entrada por elemento. En `salt`, nada */
  text?: string | string[]
}

export interface PlantillaDocumento {
  id: string
  tipo: DocumentoTipo
  idioma: 'ca' | 'es'
  version: number
  titulo: string
  /** Bloques {tipo, text} con {{marcadores}}: la forma que consume _shared/pdf/plantilla.ts */
  cuerpo: BloquePlantilla[]
  /** Contrato declarado: qué claves espera el texto. Sirve para negarse a emitir con huecos */
  marcadores: string[]
  /**
   * Los tres modelos de convenio comparten el tipo `CONV`, y el índice único
   * `(tipo, idioma) where vigente` solo dejaba uno: la variante es lo que los separa.
   */
  variante: ConvenioTipo | null
  vigente: boolean
  valida_desde: string
  created_by: string | null
  created_at: string
}

/**
 * ⚠️ `token_hash` y `codigo_hash` NO están aquí a propósito: quedan fuera del GRANT de
 * SELECT (20260928100300), así que un `select('*')` responde 42501. Pide columnas.
 */
export interface EnlaceToken {
  id: string
  proposito: 'firma_convenio' | 'confirmacion_albaran' | 'subida_factura'
  objeto_tipo: 'albaran' | 'convenio' | 'cierre_donante'
  objeto_id: string
  destinatario_email: string | null
  destinatario_nombre: string | null
  canal: 'email' | 'asistido'
  codigo_caduca_at: string | null
  caduca_at: string
  abierto_at: string | null
  usado_at: string | null
  /** Estado escrito. La caducidad por reloj la calcula resolver_enlace() como estado_efectivo */
  estado: 'activo' | 'usado' | 'caducado' | 'revocado'
  recordatorios: number
  ultimo_recordatorio_at: string | null
  creado_por: string | null
  created_at: string
}

/** Lo que devuelve resolver_enlace() (solo service_role, desde una Edge Function) */
export interface EnlaceResuelto extends Omit<EnlaceToken, 'creado_por'> {
  tiene_codigo: boolean
  estado_efectivo: 'activo' | 'usado' | 'caducado' | 'revocado'
}

/** ⚠️ Sin `documento_identidad`: fuera del GRANT de SELECT (solo lo lee el renderizador) */
export interface Evidencia {
  id: string
  enlace_id: string
  tipo: 'apertura' | 'firma' | 'confirmacion' | 'subida' | 'codigo'
  nombre: string | null
  cargo: string | null
  declaracion_representacion: boolean
  trazo_firma_ruta: string | null
  ip: string | null
  user_agent: string | null
  /** Huella del texto aceptado: es lo que convierte un «firmó» en un «firmó ESTO» */
  sha256_texto: string | null
  payload: Record<string, unknown> | null
  asistido_por: string | null
  created_at: string
}

/** Fila única (id = 1). ⚠️ Sin `apoderada_dni`: se escribe pero no se lee */
export interface ParametrosDocumentales {
  id: 1
  razon_social: string | null
  cif: string | null
  domicilio: string | null
  codigo_postal: string | null
  poblacion: string | null
  inscripcion: string | null
  apoderada_nombre: string | null
  apoderada_cargo: string | null
  /** Ruta dentro del bucket privado `activos`, no una URL */
  firma_ruta: string | null
  sello_ruta: string | null
  email_equipo: string | null
  caducidad_enlace_dias: number
  caducidad_confirmacion_dias: number
  tolerancia_conciliacion_pct: number
  plazo_conciliar_sin_confirmacion_dias: number
  fecha_corte_convenios: string | null
  /** 'MM-DD': el año lo pone el ejercicio que se cierra */
  cierre_apertura: string
  cierre_provisional: string
  /** true mientras los datos sembrados no sean los reales de la Fundación */
  datos_provisionales: boolean
  actualizado_at: string
  actualizado_por: string | null
}

export interface Municipio {
  /** Código INE de 5 dígitos. Texto, no número: los de Barcelona empiezan por 0 */
  codi_ine: string
  /** Nombre oficial con artículo pospuesto: «Ametlla del Vallès, l'» */
  nom: string
  comarca: string
  provincia: 'Barcelona' | 'Girona' | 'Lleida' | 'Tarragona'
}

// --- Albaranes y espigoladas (fase 3, migraciones 20261012*) ---

export type TipoAlbaran = 'REC' | 'ENT' | 'OPE'
export type EstadoAlbaran =
  | 'borrador' | 'emitido' | 'entregado' | 'confirmado' | 'conciliado' | 'anulado' | 'rectificado'

export interface Albaran {
  id: string
  tipo: TipoAlbaran
  serie: string | null
  ejercicio: number | null
  numero: number | null
  /** Se pide al EMITIR, nunca en borrador: un borrador descartado no deja hueco en la serie */
  numero_completo: string | null
  excedente_id: string | null
  espigolada_id: string | null
  canalizacion_id: string | null
  estado: EstadoAlbaran
  /** Quién entrega y quién recibe, congelado al emitir: si la ficha cambia, el albarán no */
  partes: Record<string, unknown> | null
  recogida: Record<string, unknown> | null
  retorn_envasos: string | null
  observaciones: string | null
  incidencias: Record<string, unknown>[] | null
  rechazo: 'cap' | 'parcial' | 'total'
  motivo_rechazo: string | null
  idioma: 'ca' | 'es'
  emitido_at: string | null
  emitido_por: string | null
  entregado_at: string | null
  confirmado_at: string | null
  conciliado_at: string | null
  conciliado_por: string | null
  motivo_conciliacion: string | null
  destino_final: string | null
  anulado_at: string | null
  motivo_anulacion: string | null
  rectifica_a: string | null
  rectificado_por: string | null
  created_at: string
}

export interface AlbaranLinea {
  id: string
  albaran_id: string
  orden: number
  producto: string | null
  variedad: string | null
  familia: string | null
  causa: string | null
  num_cajas: number | null
  tipo_caja: string | null
  kg_bruto: number | null
  /** Tara TOTAL de la línea, no por caja */
  tara_kg: number | null
  kg_neto: number | null
  kg_previstos: number | null
  kg_entregados: number | null
  kg_confirmados: number | null
  /** Los oficiales: solo estos cuentan para indicadores y certificados */
  kg_validados: number | null
  lote_origen: string | null
  created_at: string
  // Sin importes, a propósito: en un albarán no hay dinero.
}

export interface Espigolada {
  id: string
  productor_id: string
  ubicacion_id: string | null
  fecha: string
  num_voluntarios: number | null
  notas: string | null
  ref_externa: string | null
  estado: 'oberta' | 'tancada'
  creada_por: string | null
  created_at: string
}

export interface TipoCaja {
  codigo: string
  nombre: string
  tara_kg: number
  retornable: boolean
  activo: boolean
  /** true mientras la Fundación no dé la lista real de taras */
  provisional: boolean
  orden: number
}

export interface CosteProducto {
  producto: string
  ejercicio: number
  coste_kg: number
  motivo: string
  fijado_por: string | null
  updated_at: string
}

export interface DocumentoExterno {
  id: string
  objeto_tipo: 'albaran' | 'cierre_donante'
  objeto_id: string
  tipo: 'albaran_productor' | 'factura' | 'foto_incidencia' | 'altre'
  numero: string | null
  fecha: string | null
  ruta: string
  sha256: string | null
  mime: string | null
  bytes: number | null
  origen: 'panel' | 'enlace' | 'whatsapp'
  subido_por: string | null
  created_at: string
}

// --- Cierre anual y certificados (fase 4, migraciones 20261109*) ---

export interface CierreEjercicio {
  id: string
  ejercicio: number
  /** Vive en el dato: decide serie P-*, marca de agua y destinatarios. Varios ensayos por año, un solo cierre real */
  modo: 'prueba' | 'real'
  estado: 'obert' | 'provisional' | 'tancat' | 'declarat'
  abierto_at: string
  calculado_at: string | null
  provisional_at: string | null
  cerrado_at: string | null
  declarado_at: string | null
  creado_por: string | null
  notas: string | null
  created_at: string
}

export type EstatCierreDonante =
  | 'calculat' | 'resum_enviat' | 'factura_pendent' | 'factura_rebuda'
  | 'coincident' | 'discrepancia' | 'certificat_emes' | 'enviat' | 'declarat'

/** Con algún `bloqueja` en true, el certificado no se puede emitir */
export interface BloqueigCierre {
  codigo: string
  detall: string
  bloqueja: boolean
}

export interface CierreDonante {
  id: string
  cierre_id: string
  productor_id: string
  /** `donacio` = certificado de donación (con importes y factura) · `transaccio` = de transacción */
  tipo: 'donacio' | 'transaccio'
  datos_fiscales: Record<string, string | null> | null
  kg_total: number
  valor_total: number
  estado: EstatCierreDonante
  bloqueos: BloqueigCierre[]
  resumen_numero: string | null
  certificado_numero: string | null
  certificado_at: string | null
  factura_numero: string | null
  factura_fecha: string | null
  factura_importe: number | null
  factura_doc_externo_id: string | null
  /** D4: solo el super_admin, y con motivo registrado */
  excepcion_sin_factura: boolean
  excepcion_motivo: string | null
  excepcion_por: string | null
  recordatorios: number
  ultimo_recordatorio_at: string | null
  requiere_llamada: boolean
  rectificaciones: number
  calculado_at: string | null
  enviado_at: string | null
  declarado_at: string | null
  created_at: string
}

export interface CierreDonanteLinea {
  id: string
  cierre_donante_id: string
  canalizacion_id: string
  albaran_rec_id: string | null
  producto: string | null
  mes: number | null
  kg_neto: number
  coste_kg: number | null
  valor: number
  entidad_id: string | null
  /** Conciliada a mano para el ensayo: `cierre_base()` la excluye en modo real */
  retroactiva: boolean
  created_at: string
}

// --- Convenios y firma (fase 2, migraciones 20270111*) ---

export type ConvenioTipo = 'don_gen' | 'don_rec' | 'com'
export type ConvenioEstado =
  | 'esborrany' | 'pendent_firma' | 'firmat' | 'vigent' | 'retornat' | 'resolt' | 'substituit'

export interface Convenio {
  id: string
  tipo: ConvenioTipo
  tipo_org: 'productor' | 'entidad'
  productor_id: string | null
  entidad_id: string | null
  plantilla_id: string | null
  idioma: 'ca' | 'es'
  serie: string | null
  ejercicio: number | null
  numero: number | null
  /** Se pide al FIRMAR, no al preparar: un borrador descartado no deja hueco en la serie */
  numero_completo: string | null
  estado: ConvenioEstado
  roles_com: ('venedora' | 'compradora' | 'obrador')[]
  /** Copia congelada de la ficha en el momento de firmar */
  datos_org: Record<string, unknown>
  /** Quién firmó. ⚠️ SIN documento de identidad: eso vive solo en `evidencias` */
  firmante: { nombre?: string; cargo?: string; email?: string } | null
  enlace_id: string | null
  enviado_at: string | null
  firmado_at: string | null
  contrafirmado_at: string | null
  contrafirmado_por: string | null
  devuelto_at: string | null
  motivo_devolucion: string | null
  resuelto_at: string | null
  fecha_efecto_resolucion: string | null
  motivo_resolucion: string | null
  sustituido_por: string | null
  creado_por: string | null
  created_at: string
  updated_at: string
}

/** Matriz en tabla: qué convenio exige cada valorización a cada parte */
export interface ConvenioExigido {
  valorizacion: 'donacio' | 'venda' | 'maquila'
  parte: 'entrega' | 'recibe'
  tipo_convenio: ConvenioTipo
}

// --- Plan de prevención (fase 5, migraciones 20270301*) ---

export interface PlanPrevencion {
  id: string
  tipo_org: 'productor' | 'entidad'
  productor_id: string | null
  entidad_id: string | null
  nivel: 'basic' | 'personalitzat'
  /**
   * ⚠️ El cuestionario real NO existe todavía (anexo B del funcional, material de la fase 0):
   * la base solo impone la forma del sobre. `versio_questionari = 0` marca las filas hechas
   * antes de que ese anexo exista.
   */
  respuestas: {
    questionari?: string
    versio_questionari?: number
    respostes?: { id: string; pregunta?: string; valor?: unknown }[]
    notes?: string
  }
  version: number
  vigente: boolean
  estado: 'esborrany' | 'emes' | 'substituit'
  idioma: 'ca' | 'es'
  serie: string | null
  ejercicio: number | null
  numero: number | null
  numero_completo: string | null
  creado_por: string | null
  emitido_por: string | null
  emitido_at: string | null
  sustituido_por: string | null
  created_at: string
  updated_at: string
}
