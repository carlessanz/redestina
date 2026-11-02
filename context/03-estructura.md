# AGENTS.md §3 — 3. Estructura

> Detalle de la sección 3 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §3» del código apuntan aquí.

## 3. Estructura

```text
index.html                     Carga Sora e Inter (Google Fonts), theme-color verde
vercel.json                    Rewrite de SPA (sin él, recargar una ruta profunda da 404)
middleware.js                  La CORTINA de contraseña (Vercel, §9). GENERADO por
                               scripts/construir-cortina.mjs desde cortina/: no se edita a mano
cortina/                       Su lógica (pura, con pruebas) y el logo que pinta (§9)
vitest.config.ts               Config de las pruebas, aparte de vite.config.ts (§11)
tsconfig.tests.json            Tipos de las pruebas: Node y Deno, que la app NO debe ver
.githooks/pre-commit           Tipos + vitest + deno check antes de cada commit (§13)
tests/                         Pruebas unitarias (Vitest). Módulos de negocio, no pantallas
  pdf/                         Pruebas de DENO del renderizador (`*_test.ts`): las corre
                               `deno test` dentro de `npm run check:deno`, no Vitest ni tsc
  e2e/                         Playwright (`*.e2e.ts`, `playwright.config.ts`): recorridos de
                               las rebanadas del 05-10-2026; se saltan sin credenciales (§11)
  deno.d.ts                    El global `Deno` declarado al mínimo, para que tsc compruebe
  cobertura.test.ts            Que el menú, las rutas y las claves i18n apunten a algo real
  passosCanalitzacio.test.ts   Las claves COMPUESTAS del ciclo guiado (`canal.<pas>_t`) en ca
                               y es, y que el orden de las comprobaciones no se mueva
design/                        Sistema de diseño (§2bis): tokens.json, DESIGN.md, preview.html, PLAN.md
.github/workflows/             CI: tipos + vitest + deno check + build en cada push y PR (§12.1).
                               El arnés de RLS NO está aquí: necesita credenciales de producción
public/                        Logo en seis variantes SVG, favicon, iconos PWA y logo-email.png (§2bis)
.env.local.example             Plantilla de variables del frontend (sí se versiona)
.claude/skills/publicar/       Skill /publicar: el procedimiento de publicación (§11)
.claude/agents/                Tres agentes de proyecto (dades, servidor, interficie) con los que se
                               ejecutan por fases el sistema documental (§1, §7); Opus a esfuerzo alto
.codex/agents/, .agents/skills/ Los mismos tres agentes y el skill /publicar para Codex (29-09-2026)
src/
  main.tsx                     Punto de entrada React
  App.tsx                      Dos capas: SessioProvider → RouterProvider (el contexto de rol
                               se monta más abajo, dentro de RequireSessio; §6quater)
  router/index.tsx             Mapa de rutas: públicas + privadas por rol (§6quater)
  layout/AppShell.tsx          Sidebar + barra superior + contenido + barra inferior (§2)
  layout/AppSidebar.tsx        Menú lateral plegable; con varios paneles los pinta todos, y pie con «Sortir» (§6ter)
  layout/BottomNav.tsx         Barra inferior de móvil (productor y receptor)
  layout/UserMenu.tsx          Avatar, idioma y salir (salir está también en el pie del menú lateral)
  hooks/useSessio.tsx          Sesión cruda (¿hay token?) + evento PASSWORD_RECOVERY (§6quater)
  hooks/useConveni.ts          ¿La organización activa tiene convenio vigente? Y la fecha de corte
  components/AvisConveni.tsx   La banda que lo avisa en los paneles de productor y receptor
  hooks/useAppContext.tsx      get_my_session_context(): quién eres (§4bis) + useWhatsappActiu()
                               (§8). El panel activo se
                               DERIVA de la URL; useOrganitzacio(tipus) para las pantallas
  hooks/use-mobile.ts          Hook del breakpoint (lo usa el sidebar de shadcn)
  hooks/useInstalacio.ts       ¿Se puede instalar la PWA, y cómo? (automática o manual iOS; §2)
  hooks/useComptadorsEquip.ts  Los badges del equipo, derivados del store de pendentsEquip.ts
  hooks/useMissatgesOferta.ts  Los mensajes de una oferta (`missatgesOferta.ts` + `avisos_de_oferta()`); con
                               `perspectiva` productor/entidad solo pide los avisos (§6ter, gestión autónoma)
  routes/Comuns.tsx            ArrelApp, RequireSessio, raíz por rol, RoleGuard y «sense accés»
  routes/public/               Landing, LoginUsuaris (/login), LoginEquip (/admin),
                               Registre (/registre), RestablirClau (/restablir),
                               Privacitat (/privacitat, 27-10-2026) y
                               Confirmar (/confirmar/:token, sin sesión) — §6quater
  routes/PerfilOrganitzacio.tsx  Ficha propia: los bloques de `campsFitxa` con `veu: tots`, por RPC con lista blanca (§6ter)
  routes/equip/Entitats.tsx    El listado «Entitats» (una fila por organización, `v_entitats_llistat`; 1C)
  routes/equip/EntitatDetall.tsx  La ficha ÚNICA por organización del equipo (1C)
  routes/equip/NovaEntitat.tsx  «Nova entitat» en dos pasos: buscar (cerca_entitats) y dar de alta (crear_entitat) (1B)
  hooks/useEsborrarFitxa.tsx   Borrar una organización (`borrar_ficha_completa`, diálogo de doble rol)
  routes/PerfilRecepcio.tsx    «El meu perfil de recepció» del receptor (fase 9, §6ter)
  routes/PlaOrganitzacio.tsx   «El meu pla de prevenció», solo lectura (fase 11, §6ter)
  routes/equip/                Canalitzacio[Detall] (el ciclo guiado, §6ter) +
                               envoltorios de las pantallas que ya existían + Aprovacions
                               + Documents (bandeja documental: 6 pestanyes, amb Enviaments)
                               + Albarans/AlbaraDetall/Espigolades (fase 3)
                               + Productes/ProducteDetall: el catálogo con foto y coste de
                               referencia (antes «Costos per quilo», 27-09-2026, §6ter)
  routes/productor/            Inicio, listado, alta de oferta, detalle y Documents
  routes/receptor/             Mercat, interessos, històric i Documents
  types.ts                     Tipos de todas las tablas
  index.css                    Tokens del sistema de diseño (:root + @theme inline) y base (§2bis)
  lib/
    supabase.ts                Cliente Supabase (lanza si faltan las env vars)
    rols.ts                    Tipos del contexto de sesión y ruta por rol (§4bis)
    nav.ts                     Menú declarativo por rol (grupos, iconos, contadores)
    ofertes.ts                 Alta de oferta (Edge Function) e interés (RPC) de los paneles
    contactes.ts               assegurarContacte(): crea el wa_contact antes de abrir el chat
    whatsapp.ts                sendWhatsApp(): llama a la Edge Function; nunca lanza
    plantillas.ts              plantillaPrimerContacte(): tría plantilla de 1r contacte per rol (§6ter)
    ofertaTemplate.ts          construirComponentsOferta(): variables de la plantilla oferta_excedent (§6ter)
    redestina.ts               priorizarEntidades(): llama a la Edge Function con el JWT
    rankingEntitats.ts         PURO: filtro por `tipo_receptor` y «veure'n més» (de 15 en 15) del
                               ranking de entidades del detalle de oferta (05-10-2026)
    filtresMercat.ts           PURO: filtros del Mercat (comarca + categoría de producto, el mismo
                               vocabulario que `perfil_receptor`), recordados por entidad (05-10-2026)
    mensajes.ts                countUnanswered(): mensajes «sin contestar» por teléfono (§5)
    metaTest.ts                Lista de números de prueba de Meta (whitelist de envío, §9)
    emailTest.ts               Lista de correos de prueba (whitelist del canal email)
    settings.ts                Los dos interruptores de app_settings: modo test y whatsapp_activo (§8)
    versio.ts                  La versión compilada (`__VERSIO__`) contra `/version.json`, y
                               retiraServiceWorkers() (§2)
    documents.ts               descarregarDocument() (URL firmada 60 s) i esperarGeneracio() (§4)
                               + reenviarDocument() (botó «Reenvia», equip)
    tancamentFormat.ts         PURO: lo que de `tancament.ts` no necesita el cliente de Supabase (`csv182` con
                               escape de fórmulas, `euros`, `eurKg`, `bloqueja`, `exerciciDeNumero`). `tancament.ts` lo
                               reexporta, así que ningún import cambia, y es probable desde Vitest
    esborranyOferta.ts         PURO: el borrador de la oferta (sessionStorage, 24 h) y la conversión de fechas
                               dd/mm/aaaa ↔ ISO de `FormulariNovaOferta`; un borrador sin `desat` se descarta
    cerca.ts                   PURO: el buscador de los listados (`consultaCerca`, `casaCerca`,
                               `filtraCerca`; minúsculas, SIN quitar acentos a propósito —`senseAccents()`
                               existe y activarlo es una línea, pero cambiaría lo que encuentra cada
                               listado—). `hooks/useCerca.ts` lo envuelve. 13 pantallas lo usan (07-10-2026)
    format.ts                  PURO: números (`nombre`, `kg`, `preu`), fechas (`dataCurta`, `dataHora`,
                               `diaMes`, `diaMesHora`) y «hoy» (`avuiMadrid`, `avuiLocal`). Sustituye las
                               copias de `fmtKg`, `kgFmt`, `dataCurtaSenseAny`… `albarans.ts` y
                               `tancament.ts` conservan aún sus propias `dataCurta`/`dataTancament`
                               idénticas: se pueden reexportar desde aquí
    textError.ts               El texto de un error para un aviso: el código conocido se traduce
                               (sense_conveni…), una clave i18n pasa por t(), el texto crudo de
                               Postgres/Auth/red cae a c.error. Antes muchos avisos enseñaban
                               «alb.err_generic» o un mensaje de la base sin acentos
    refrescAvisos.ts           refrescaAvisos()/useTicAvisos(): las bandas y contadores del panel
                               (convenio, ficha incompleta, diagnóstico) se recalculan tras actuar
    pendents.ts                pendents_meus() i acunar_enllac_propi(): què falta signar o
                               confirmar, i l'enllaç propi per fer-ho (§6ter)
    documentsPanell.ts         Helpers purs de les pantalles de documents (agrupar per
                               exercici, quin PDF val, l'ordre del conveni)
    certificatRecepcio.ts      Cliente de las 5 RPC del certificado de recepción; nunca lanza
    codiVerificacio.ts         PURO: el código impreso y la URL de verificación. Aparte de
                               verificacio.ts por el precedente campsFundacio/parametresFundacio:
                               aquel importa el cliente de Supabase, que lanza al cargarse, así
                               que un fichero que lo importe no se puede probar desde Vitest
    verificacio.ts             La mitad con red: pregunta a verificar-certificat, SIN sesión
    diagnostic.ts              PURO: la gramática de condiciones (espejo de avaluar_regla),
                               qué pregunta aplica, qué obligatorias faltan, el prefill y el
                               punto del proceso. ⚠️ Divergir de SQL NO fallaría: una pregunta
                               que la pantalla oculta contaría como obligatoria en el servidor,
                               así que el test la cubre operador por operador
    diagnosticApi.ts           Envoltorios de las RPC del diagnóstico; nunca lanzan
    campsFundacio.ts           Els camps de `parametros_documentales` i `campsPendents()`:
                               QUÈ falta per poder desmarcar `datos_provisionales`. Pur,
                               amb test (§12.10)
    parametresFundacio.ts      Llegir i desar aquella fila. La meitat amb xarxa, a part
                               perquè l'altra es pugui provar des de Vitest
    procesOferta.ts            EL MODELO DEL PROCESO (§6ter): de los estados reales a
                               «etapa + què passa + què toca + qui», por rol. Puro, con test
    seguentPas.ts              Lo mismo para las fichas largas del equipo: albarà, conveni,
                               exercici, donant
    canalitzacio.ts            Cliente de la pantalla guiada; nunca lanza, como albarans.ts
    passosCanalitzacio.ts      EL CICLO ENTERO de una canalización para la pantalla guiada
                               del equipo: 17 pasos sobre las seis fases de FASES_EQUIP (desde el
                               27-10-2026; eran 21), con qué los bloquea. La recogida son cuatro:
                               `recollida_hora`, `recollida_registrar`, `albarans` y `conciliar`,
                               medidos por canalización viva. Puro, y con su propio test porque
                               sus claves se componen (cobertura.test.ts no las ve)
    pendentsEquip.ts           La cola de trabajo del equipo (`pendents_equip()`) en un store
                               de módulo; alimenta los badges del menú Y el tablero (§6ter)
    conversioEspigolada.ts     Los siete rechazos de la conversión, traducidos POR SU CÓDIGO.
                               Módulo aparte de albarans.ts a propósito: aquel importa el
                               cliente de Supabase, y un fichero que lo importe no se puede
                               cargar desde Vitest — sin separarlo, estas claves no tendrían red
    progresOfertes.ts          progres_meves_ofertes(): cuántas entidades interesadas por oferta,
                               SIN nombres, para el panel del productor (§6ter)
    registreRecollida.ts       PURO: la validación de «Registra la recollida» (la regla de la RPC) y la
                               traducción de sus rechazos (17-10-2026)
    aprovarResposta.ts         comprovaConvenis() + aprovarResposta() + rebutjarResposta(): la
                               aprobación de un interés, compartida por OfferDetail y Aprovacions
    albarans.ts                Envoltorios de las RPC de albaranes; nunca lanzan (§4bis)
    enllacPublic.ts            Cliente de enlace-publico, sin sesión (§9)
    email.ts                   enviarEmail(): llama a la Edge Function enviar-email
    i18n.tsx                   Sistema de traducciones (ca/es, per defecte ca; useT, §7)
    accessosTest.ts            Credenciales de las cuentas de prueba para /login (§6quater)
    utils.ts                   cn() (shadcn)
    fotos.ts                   Recomprimir (sin EXIF), subir, borrar y firmar las fotos de las ofertas
                               (`urlsFotos` firma en cualquiera de los dos buckets de fotos)
    fotoOferta.ts              PURO, con test: QUÉ enseña una oferta —su foto o el icono de su
                               producto— (§6ter)
    iconaProducte.ts           PURO, con test: `slugProducte()` y la URL del icono de un producto
                               (`public/icones-productes/<slug>.svg`)
    fotosProducte.ts           El catálogo (nombre y familia), una vez por sesión
    validacio.ts               PURO: NIF/NIE/CIF con dígito de control, teléfono (normaliza a E.164
                               sin +), correo y CP. Devuelve claves i18n. Y `varietatSemblaQuantitat()`,
                               el aviso del alta de oferta cuando la variedad es un número (05-10-2026)
    perfilReceptor.ts          Los campos propios de cada tipo de receptor (listas cerradas) que van
                               a `entidades.perfil_receptor`, y los tipos de empresa
    municipis.ts               El nomenclátor (`municipios`) cargado una vez por sesión, y el nombre
                               oficial vuelto legible («l'Ametlla del Vallès»)
    campsFitxa.ts              PURO, con test: LA definición de campos de la ficha de una organización
                               (tabla, bloque, quién ve, quién edita; plan 1 1C, D8). Sustituye a `crudCampos.ts`
    novaEntitat.ts             PURO, con test: el alta en dos pasos (1B): «parece un NIF», qué ofrecer
                               al elegir un resultado, obligatorios del alta y carga de `crear_entitat()`
    textos.ts                  RECOLLIDA CONFIRMADA y albarán (los compone el panel)
    conveniDeclarat.ts         PURO: los rechazos de `declarar_conveni()` por su código, con prueba
    copiar.ts                  Copiar al portapapeles como text/plain + text/html (un <div> por
                               línea, que es lo que WhatsApp conserva al pegar). Salió de OfferDetail
    missatgesOferta.ts         PURO: los mensajes del ciclo de una oferta para avisar a mano
                               (27-10-2026): el WhatsApp EXACTO de cada aviso —con `textAvis` y
                               `formatWhatsappAvis` del servidor— y los compuestos (la oferta, el
                               alta, lo que contesta el bot, RECOLLIDA CONFIRMADA), con su correo y
                               si salió. `tests/missatgesOferta.test.ts`
  components/
    AvisInstallacio.tsx        Banner de «instal·la Redestina» en móvil, productor y receptor (§2)
    TriaPaper.tsx              El conmutador «productora / receptora» del doble rol. Estaba
                               copiado TRES veces y una copia ya había divergido (sin icono y
                               sin reparto a partes iguales): dos botones distintos para la
                               misma elección en dos pantallas seguidas
    BotoCopiar.tsx             El botón de copiar de toda la aplicación (icono ✓ y aviso «Copiat»);
                               `onCopiat` para «Copia i marca com a enviada»
    MissatgeACopiar.tsx        Un mensaje del ciclo: a quién va, si salió, el WhatsApp y el correo
                               plegado; con `nomesLectura` para los paneles de ofertante y receptor
    DialegCorreu.tsx           «Envia un correu» desde una ficha o un listado; sustituye a la
                               mensajería cuando WhatsApp está apagado (§8)
    documents/                 Las piezas que comparten los dos paneles externos:
                               PendentsDeTu (firmar/confirmar desde el panel), LlistaConvenis,
                               LlistaDocuments, TaulaAlbarans y LlistaPlans (los PDF del plan,
                               el sustituido marcado, y el enlace al diagnóstico; §6ter)
    proces/                    Lo que pinta el modelo del proceso en los TRES paneles:
                               PasosProces, QueTocaAra, LlegendaEstats, BlocPublicada,
                               BotoAmbMotiu y BadgeEstat (el estado simple de los paneles
                               externos, §6ter)
    equip/                     CertificatsFitxa (els certificats d'una productora, des de la
                               seva fitxa) + DialegCertificatPeriode (el de «a demanda») +
                               Bloquejos (extret de TancamentDetall: el comparteixen les dues
                               pantalles), PendentsEquip (la cola de trabajo del tablero), ComFunciona
                               (los seis pasos de FASES_EQUIP, enlazados) y los TRES diálogos
                               asistidos: DialegAssistit (albarà y factura),
                               DialegFirmaAssistida (conveni) y DialegNovaOfertaAssistida
                               (l'alta, des de l'índex del cicle) (§6ter). Y DialegEspigolada:
                               convertir una oferta «producte al camp» en jornada (§6ter)
    GestorWhitelist.tsx        Las dos whitelists de prueba (Meta y correo); vive en Configuració
    equip/DadesFundacio.tsx    Los datos fiscales de la Fundación, en Configuració: es lo que
                               desbloquea el certificado REAL (§12.10). Solo super_admin
    FormulariDiagnostic.tsx    EL cuestionario, uno para los tres sitios (propio, asistido y
                               ficha del equipo): el patrón de FirmaConveni
    PlaPrevencio.tsx           Las medidas por bloque, la edición del equipo y la emisión
    TargetaDiagnostic.tsx      El estado y el botón, en la ficha y en el panel externo
    TargetaPerfilRecepcio.tsx  La tarjeta que lleva al perfil de recepción del receptor (fase 9)
    expedient/                 ExpedientVista y TaulaElements: el Pla de Prevenció como expediente (fase 11)
    AvisDiagnostic.tsx         La banda, en tono aviso: el diagnóstico NO bloquea operar
    equip/EditorDiagnostic.tsx El cuestionario, las medidas y las reglas, desde Configuració
    EnllacOrganitzacio.tsx     Con quién comparte organización una ficha, el botón de separarla y
                               el aviso si el nombre o el NIF no coinciden entre las dos (D1 del
                               plan de organización unificada, 22-09-2026). Solo del equipo: lee
                               la otra tabla de fichas (§12.28)
    FirmaConveni.tsx           EL formulario de firma del convenio. Uno solo, para la página
                               pública y para el diálogo; `ample` decide el reparto (§6quater)
    DialegFirmaConveni.tsx     Firmar sin salir del panel: 80vw × 88vh, acuña el enlace al abrir. Con `conveniId`
                               firma ESE convenio (`acunar_enllac_propi`); sin él, el del papel (`signar_conveni_propi`)
    FormulariConfirmacio.tsx   EL formulario de confirmación del albarán. Uno solo, para
                               /confirmar/:token y para el diálogo asistido del equipo
    FormulariFactura.tsx       Ídem con la factura del donante (/factura/:token)
    FormulariNovaOferta.tsx    EL cuestionario de alta de oferta. `productorId` por PROP:
                               es lo que permite que el equipo publique en nombre de otro
    LayoutAcces.tsx            Marco verde (bg-primary) de las pantallas de acceso (+ ComprovantSessio)
    FormulariAcces.tsx         Entrar y pedir enlace de recuperación (+ BotoUll)
    SelectorIdioma.tsx         Idioma suelto, para lo público (dentro va en UserMenu)
    FotosOferta.tsx            Las fotos del producto: useUrlsFotos (firma en lote), FotoOferta,
                               FotoGenerica (icono por familia), useFotosOfertes + FotoOfertaResolta
                               (la regla de `fotoOferta.ts`, firmada en lote en los dos buckets),
                               SelectorFotos (subir y quitar) y CasellaFotoProducte
    DetallOfertaReceptor.tsx   El detalle de una oferta como lo ve el receptor (foto grande, kilos, comarca,
                               modalidad, precio, formato…). Uno solo para el Mercat y para Els meus
                               interessos y el Històric, cuyas filas lo abren desde el 28-09-2026 (el
                               Històric añade la entrega: kilos, fecha y albarán)
    CampsPerfilReceptor.tsx    Los campos del perfil de cada tipo de receptor (`perfil_receptor`). Uno
                               solo para la ficha propia y la del equipo
    RegistraRecollida.tsx      «Registra la recollida» del receptor, dentro de la ficha de la operación
                               (`registrar_recollida()`, 17-10-2026, §6ter)
    LlocsRecollida.tsx         Los lugares de recogida de una productora: lista, alta y baja. Uno solo
                               para la ficha propia y la del equipo
    SelectorMunicipi.tsx       Elegir municipio de la lista oficial (INE), con búsqueda y comarca;
                               lo usan el alta de oferta y la ficha de la organización
    AccessosTest.tsx           Botones de «entrar com a…» en /login (§6quater)
    Dashboard.tsx              Tablero = cola de trabajo: Pendent de l'equip, Com funciona, KPIs (§6ter)
    OffersList.tsx             Ofertas con kg en vivo (Realtime) + buscador; pestañas Actives/Tancades/Totes
    OfferDetail.tsx            Detalle: priorización, canalizaciones, opt-in, cierre, cancelar
    fitxa/                     Los bloques de la ficha única (1C): BlocCamps (los campos de un bloque,
                               para el equipo y para el actor), BlocRols (activar/desactivar/añadir papel),
                               CanalPreferit, Consentiments (RGPD, solo equipo)
    ContactList.tsx            Sidebar de contactos + alta manual
    Conversation.tsx           Hilo de mensajes + composer + Realtime
    Settings.tsx               Configuració POR PESTAÑAS (`?tab=`, 27-10-2026): General, Notificacions, Fundació,
                               Impacte y Diagnòstic (§6ter)
    configuracio/              Interruptor (la tarjeta Activat/Desactivat), SeccioGeneral (modo test,
                               validación, idioma) y SeccioNotificacions (los tres interruptores, §8)
    FormulariAlta.tsx          EL formulario de alta con cuenta y casillas RGPD: `/registre` y el alta
                               asistida (`mode`), patrón de FirmaConveni (§9)
    equip/DialegAltaAssistida.tsx  «Nova organització amb compte» (§9)
    AvisCorreuDesactivat.tsx   La banda de «el correu està apagat» en cierre y certificados (§8)
    MissatgesDelPunt.tsx       Los mensajes de un paso (por fase y destinatario), en los tres paneles
    CampsRecollida.tsx         Día y hora de recogida dentro de la franja: Mercat e interés asistido
    equip/DialegConveniDeclarat.tsx  «Dona'l per vigent»: el convenio declarado (§4, gestión autónoma)
    equip/FormulariInteresAssistit.tsx  «Registra l'interès» con las mismas guardas que el Mercat
    equip/FormulariAprovacio.tsx  Aprobar o rechazar un interés: OfferDetail, Aprovacions y ciclo guiado
    equip/DialegRegistraRecollida.tsx  La recogida en nombre de la receptora (o validarla), desde el ciclo y el albarán
    equip/DialegConciliar.tsx  Conciliar un albarán; el mismo en AlbaraDetall y en la fase 5 del ciclo guiado
    equip/fases/               Las seis fases del ciclo guiado (Conveni, Entrada, Distribucio, Aprovacio,
                               Recollida, Tancament) y AccionsConveni, que comparten la 1 y la 4
scripts/
  import-ara.ts                Importación idempotente de los 5 CSV maestros
  crear-usuario.ts             Alta de cuentas por la Admin API (no envía correos)
  set-config.ts                Escribe una clave en app_config con la service key (p. ej. recordatorios_secret)
  comprobar-rls.ts             Arnés de RLS: matriz (cuenta, tabla, operación) → PASS/FAIL (§4bis)
  crear-usuarios-prueba.ts     5 organizaciones ficticias TEST-* y 7 cuentas, idempotente (§9)
  crear-usuarios-whatsapp.ts   5 cuentas de organización sobre las fichas REALES con móvil en
                               Meta; no crea ni toca ninguna ficha, solo enlaza (§9)
  crear-datos-documentales-prueba.ts  La espigolada del plan de punta a punta: lotes, REC, tres
                               ENT, convenios, dos ofertas y el cierre de prueba. Fixture del arnés
  crear-respuestas-prueba.ts   Las respuestas de las entidades a una oferta en sus tres estados
                               (aprobada y canalizada, pendiente de aprobar, rechazada). Usa las
                               SESIONES de las cuentas de prueba, no la service key, para pasar
                               por manifestar_interes() y aprovar_resposta()
  escenari-demo.ts             El escenario de demostración (21-09-2026, §9): limpia las ofertas
                               sin rastro documental, deja cada cuenta de test con un solo papel,
                               firma los convenios que hacen falta por el camino real (RPC +
                               enlace público) y crea nueve ofertas `E-DEMO-*` con un estado del
                               circuito cada una — publicada sin enviar, con interés esperando,
                               con precio rechazado, cubierta, cancelada, sin destino… Horta de
                               Prova SL se queda A PROPÓSITO sin ninguna: es el generador del
                               ciclo guiado (§6ter) y su lote se monta desde el panel. Idempotente
                               en lo que puede serlo; consume numeración legal de convenios
  prueba-numeracion.ts         Numeración documental sin huecos bajo concurrencia (§4)
  huellas-funciones.ts         Qué Edge Functions cambiaron de verdad entre dos despliegues (§12.44)
  aplicar-migracion.ts         Aplica UNA migración por la API de gestión y la registra en
                               schema_migrations con el número del fichero (§11)
  historial-migraciones.ts     El historial de migraciones de producción frente al repo
                               (`comparar`), y la renumeración de la deuda 125 (§7)
  local/                       EL CLON LOCAL (§11): volcar-produccion.sh (lo ejecuta Carles con el
                               token), preparar-entorno.sh, cargar-local.sh, copiar-storage.ts,
                               funciones-local.sh, entorno-local.sh y recompte.ts. Nunca escriben
                               fuera de 127.0.0.1
  fotos-cataleg.ts (+ .json)   Las fotos del catálogo y de las ofertas desde un MANIFIESTO versionado
                               (fuente, autor y licencia CC0/dominio público de cada una): descarga,
                               recorta, WebP sin metadatos y sube. Los binarios no van a git (§11).
                               ⚠️ Ya no se usa (29-09-2026): productos → iconos, y las fotos de
                               ejemplo de las ofertas se retiraron
  icones-productes.ts          Dibuja los 90 iconos de producto (SVG plano 64×64, sin licencias de
                               terceros) en public/icones-productes/ (§6ter)
  incrustar-activos.ts         Regenera activos/incrustats.ts: las fuentes y el logo del PDF
                               en base64, dentro del bundle (§11)
  roles-activos.ts             Interruptor del modelo de roles: on | off | estat (§4bis)
  diagnostico-whatsapp.ts      Interroga la Graph API y distingue token caducado / número / permisos (§8ter)
  estado-documentos.ts         ¿Hay documentos, y su PDF está en el bucket? Separa las tres causas de
                               una bandeja vacía: sin filas, RLS, o el disparador no-op sin secreto
  sql/rls-emergencia.sql       Paracaídas: restaura las políticas permisivas (NO es migración)
  data/                        Los CSV — IGNORADO POR GIT (datos personales, §7)
supabase/
  config.toml                  Config del CLI: project_id, migraciones y verify_jwt por función (§7)
  migrations/*.sql             Migraciones versionadas
  functions/
    _shared/cors.ts            originPermitido()/corsPara()/origenPorDefecto(): CORS de las funciones públicas (§10)
    _shared/http.ts            json(), respondedor(cors), preflight(cors), igualesTiempoConstante() y
                               exigirSecreto(req, cabecera, esperado): lo que antes estaba copiado en las
                               19 funciones (07-10-2026). Todas las funciones lo importan
    _shared/cliente.ts         El tipo ClienteSupabase (solo tipo: Vitest no carga la librería)
    _shared/enmascarar.ts      enmascararEmail()/enmascararTelefono() para los logs (PII)
    _shared/pdf/               Motor de PDF: maquetador A4, fuentes embebidas, plantillas y
                               render/ (rec, ent, ope, res, cd, conv, pla, ct + cierre.ts común).
                               `pintarFirma()` la comparten CD y CT; el CT NO importa lletres.ts
                               porque no lleva ningún importe
    _shared/whatsapp.ts        Graph API + interruptor de envío (texto/plantilla/interactivos)
    _shared/intake.ts          Motor conversacional (máquina de estados)
    _shared/oferta.ts          crearExcedente(): id_excedente; reexporta el texto de `textOferta.ts`
    _shared/textOferta.ts      HOJA: el texto "OFERTA DISPONIBLE" (`componerTextoOferta`, envasos, cajas)
    _shared/textIntake.ts      HOJA: lo que contesta el bot al cerrar el intake, y `de()` («d’Alvocat»)
    _shared/textRespostes.ts   HOJA: lo que contesta el bot a un interés (kg, precio, gracias, no)
    _shared/textOfertaRegistrada.ts  HOJA: el correo «oferta registrada» (y su texto plano)
    _shared/camposOferta.ts    Los 14 pasos, compartidos por el intake y el panel (§6bis)
    crear-oferta/index.ts      GET /campos (descriptor) + POST (alta desde el panel del productor);
                               `validacio.ts` (puro): `fotosValides()` y `veuCostReferencia()`
    enlace-publico/            `index.ts` solo enruta (254 líneas; era 2.195): `comun.ts` (cliente, token,
                               anti-abuso, URL firmada, base64), `albaran.ts`, `factura.ts`, `convenio.ts`
    registro/                  `index.ts` (anti-abuso) + `alta.ts` (orden de pasos, compensación y
                               consentimientos RGPD; lo comparte `alta-assistida`) + `validacio.ts`,
                               `deteccio.ts` (duplicados), `conveni.ts`, `cliente.ts` y `coincidencies.ts`
    alta-assistida/            POST (JWT + pot_aprovar): el alta de una organización con cuenta, ya aprobada
    _shared/textosRgpd.ts      Las tres declaraciones RGPD y su huella; copia en `src/lib/textosRgpd.ts`
    recordatorios-documentales/ `index.ts` + `enllacos.ts` (`tocaAviso`, avisos a 7 y 14 días) y `factures.ts`
    _shared/priorizacion.ts    Puntuación de entidades (pura, sin red)
    _shared/respuestas.ts      Captura el sí/no de una entidad a una oferta (aceptación, §5);
                               los textos, de `textRespostes.ts`
    _shared/confirmacions.ts   PURO: los botones `conf:<enlace>:ok|dif` y los kilos de la
                               confirmación de un albarán por WhatsApp (fase 3, 11-10-2026)
    _shared/confirmacionsWhatsapp.ts  Lo consume el webhook ANTES de la respuesta de oferta y
                               del intake; `recollides-programades` manda la pregunta
    _shared/pdf/render/albara1p.ts  El albarán de UNA página (modelo de Espigoladors, fase 3):
                               REC/ENT/OPE con `datos.format = 'albara-1p'`. Los antiguos
                               (rec.ts, ent.ts, ope.ts) siguen pintando lo emitido antes
    _shared/gate.ts            Gate de envío: quién PUEDE recibir (es_test, cuenta) + modoTestActivo (§8)
    _shared/canal.ts           Política de canal: por dónde se contacta; el correo es el defecto (§8bis)
    _shared/organizacion.ts    organizaciones: preferencia de canal y doble rol real (§8bis, §12.16)
    _shared/autorizacion.ts    Autorización por rol: contextoUsuario/exigirEquipo (§4bis; service_role ignora RLS)
    priorizar-entidades/       POST: ranking de entidades para un excedente (JWT)
    whatsapp-send/index.ts     POST: reglas de envío; delega en _shared
    whatsapp-webhook/index.ts  GET verificación / POST recepción; respuesta a oferta + intake
    intake-recordatorios/      POST: avisa intakes a medias (lo llama pg_cron vía pg_net)
    enviar-email/index.ts      POST: ofertas por email (JWT + gate email_test_recipients)
    recuperar-password/index.ts POST público: genera enlace de reset y lo manda por Resend
    registro/index.ts          POST público: alta self-service (cuenta + ficha + membresía
                               PENDIENTE; el acceso lo concede el equipo al aprobar, §9)
    enviar-acceso/index.ts     POST: enlace mágico por correo y código de 6 cifras por WhatsApp (§9)
    generar-documento/         POST (secreto): renderiza el PDF y lo sube al bucket. activos/ con
                               las fuentes y el logo, y su copia EN EL BUNDLE (incrustats.ts):
                               static_files ya no llega al isolate (§11)
    descargar-documento/       POST (JWT): URL firmada de 60 s tras puede_ver_documento()
    reenviar-documento/        POST (JWT, equipo): vuelve a mandar un documento emitido por
                               correo, al destinatario de su `envio` y con las mismas barreras (§4)
    recordatorios-documentales/ POST {}: enlaces sin usar a 7 y 14 días → aviso al equipo
                               (el token no se puede reenviar, §9)
    limpiar-documentos-prueba/ POST (JWT, super_admin): borra los PDF huérfanos de proves/.
                               La otra mitad de reiniciar_documentos_prova() (§12.51)
    _shared/resend.ts          sendEmail() + plantillaEmail(): el maquetado de TODOS los correos (§9bis)
    _shared/url-publica.ts     Reescribe el origen de una URL firmada con URL_PUBLICA_STORAGE (solo
                               el clon local; en producción no hace nada, §11)
    _shared/correu-document.ts Qué dice el correo que acompaña a un documento emitido (puro, §4)
    _shared/envia-document.ts  Lo manda: barreras + PDF adjunto + traza. Uno solo para
                               generar-documento y reenviar-documento (§4)
    _shared/plantillas-meta.md Contenido de las plantillas de Meta (oferta_excedent…) listo
docs/                          Material de trabajo local — IGNORADO POR GIT (§7)
  nuevas-funcionalidades/      Specs Redestina, manuales y CSV de origen
```

