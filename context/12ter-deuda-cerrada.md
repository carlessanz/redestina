# AGENTS.md §12ter — 12ter. Deuda cerrada (el índice, no el cuerpo)

> Detalle de la sección 12ter de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §12ter» del código apuntan aquí.

## 12ter. Deuda cerrada (el índice, no el cuerpo)

Las **95** entradas de §12 que están resueltas (la 106 se cerró el 11-10-2026; la 85 y la 139, el 05-11-2026; la 168, el 09-11-2026; de la 174 a la 178, el 10-11-2026) (recontado el 07-10-2026). Su cuerpo se retiró del documento el 15-09-2026;
lo que queda es esta línea, y el detalle vive en `git log -- AGENTS.md`.

**Para qué sirve esta tabla, que no es nostalgia.** 🔴 **48 de estos números están citados desde el
código** —comentarios en `src/`, `scripts/`, Edge Functions y migraciones **ya aplicadas, que no se
pueden editar** (§7)—. Un `(deuda 51)` en `limpiar-documentos-prueba/index.ts` tiene que poder
resolverse a algo; sin esta tabla apuntaría a la nada. Y sirve para lo segundo: **un número
retirado no se reutiliza**, así que la siguiente entrada nueva es la 119.

⚠️ **Lo que una entrada cerrada enseñaba y sigue siendo cierto NO está aquí: se movió a su
sección.** Al retirarlas se rescataron tres cosas que solo vivían dentro de la lista — las dos
cuentas del arnés que hay en producción y por qué una **no se debe aprobar** (§9), la invariante del
reparto del neto del REC (§4) y cuánto cuesta de verdad generar un PDF (§11). Si al cerrar una
entrada queda una lección que describe **cómo se comporta el sistema hoy**, va a su sección; a git
se va solo **cómo se llegó hasta aquí**.

| # | Qué era | Cerrada |
|---|---|---|
| 1 | Sin linter y sin CI | 11-09-2026 |
| 2 | No hay roles | 30-07-2026 |
| 3 | El intake avanza de paso aunque falle el envío | 11-09-2026 |
| 6 | `Conversation` carga el hilo completo sin paginación | 14-09-2026 |
| 7 | `ContactList` conserva la prop `single` (modo conversación única) | 2026 |
| 8 | `index.css` es un único fichero global (~825 líneas) con clases sin namespace | 10-09-2026 |
| 9 | `types.ts` no modela `raw`; `MessageRow` en `ProducersList` duplica parte de `WaMessage` | 14-09-2026 |
| 11 | Sin FK entre `productores`, `wa_contacts` y `wa_messages` | `20270321100000` |
| 13 | `oferta_respuestas` se registra desde el cliente | 14-09-2026 |
| 15 | La selección de plantilla de primer contacto por rol no se ejercita en test | 11-09-2026 |
| 16 | Doble rol productor+entidad: WhatsApp no distinguía las dos fichas, un secuestro de número | 11-09-2026 |
| 18 | Aprobación sin roles | 30-07-2026 |
| 19 | `OfferDetail` aprueba a mano, con llamadas sueltas en vez de `aprovar_resposta()` | 11-09-2026 |
| 20 | Rol único por usuario | `20270311100000` |
| 22 | Sin preferencia de canal declarada por la persona | 11-09-2026 |
| 23 | `excedentes` tiene el único predicado de RLS que no puede ser InitPlan | `20270304100400` |
| 25 | Un fallo de envío por correo ya deja rastro en la base; falta que el panel lo lea | `20270307100000` |
| 28 | El registro no deduplica contra las organizaciones existentes | `20270315100000` |
| 29 | Una ficha rechazada se queda en los listados | `20270306100100` |
| 31 | La interfaz solo alcanza la primera organización de cada tipo | `20270311100000` |
| 32 | 143 comprobaciones del arnés se quedaron sin cuenta que las recorra | 14-09-2026 |
| 35 | `window.prompt()` en dos sitios | 11-09-2026 |
| 36 | Las pestañas de `/registre` caben con 1 px de margen | 11-09-2026 |
| 38 | `vista_defecto` se calcula en el servidor y el frontend lo descarta | 11-09-2026 |
| 39 | `crearExcedente()` no reintenta ante colisión del correlativo | fase 3 |
| 40 | El albarán se genera con el productor en blanco | fase 3 |
| 41 | El rebranding a Redestina es textual, no visual | 10-09-2026 |
| 42 | La infraestructura todavía responde al nombre viejo | 10-09-2026 |
| 43 | `whatsapp-send` desplegada sin `verify_jwt` | 10-09-2026 |
| 44 | Un `functions deploy` sin cambios de código no siempre dice `No change found` | 11-09-2026 |
| 45 | Las Edge Functions no se podían typecheckear | 10-09-2026 |
| 46 | `priorizar-entidades` tenía tres errores de tipos | 10-09-2026 |
| 47 | Las tres comprobaciones siguen sin ejecutarse solas | 11-09-2026 |
| 48 | El arnés daba por fallo lo que solo era falta de datos | 10-09-2026 |
| 49 | El trigger de encolado de PDF no existe todavía | `20260928100700` |
| 50 | `ruta_documento()` solo resuelve `PROVA` | fase 5 |
| 51 | `reiniciar_documentos_prova()` borra las FILAS, no los objetos de Storage | 11-09-2026 |
| 52 | El arnés, al pasar por el super_admin, borraba todos los documentos `modo='prueba'` | `20270319100000` |
| 53 | `documento_envios` no tiene fixture en el arnés | 14-09-2026 |
| 56 | `parametros_documentales` está sembrada con datos provisionales, y nada impide emitir con ellos | fase 4 |
| 57 | El recordatorio de un enlace no se puede accionar | 11-09-2026 |
| 58 | `MAX_POR_EJECUCION = 50` es un tope silencioso | 11-09-2026 |
| 59 | El camino de envío de los recordatorios no tiene prueba automática sin stub | 11-09-2026 |
| 60 | El bloque de conformidad de los albaranes se imprime siempre en blanco | 11-09-2026 |
| 61 | El REC de una espigolada imprime el UUID de la jornada | `20270304100100` |
| 62 | `subir-documento-externo` compone a mano la hoja del nombre de fichero | `20270304100000` |
| 63 | Las herramientas locales asumen un único operador | 14-09-2026 |
| 64 | `/equip/espigolades` no tiene listado | 11-09-2026 |
| 65 | El panel no sube documentos externos | 11-09-2026 |
| 68 | El OPE no distingue sus dos confirmaciones | `20270304100200` |
| 73 | `sendEmail()` no tiene modo simulado | 11-09-2026 |
| 74 | El recordatorio al donante no lleva enlace | 11-09-2026 |
| 75 | `documentos.envio` guarda el token en claro y `GRANT select on documentos` es por tabla | `20270320100300` |
| 78 | `aprovar_resposta()` no puede devolver el aviso de convenio | 11-09-2026 |
| 79 | Una organización con doble rol necesita dos convenios | `20270312100000` |
| 82 | Un agente hizo `git checkout` de un fichero compartido y se llevó por delante una fase entera | Cubierta desde el 11-09-2026 por `tests/cobertura.test.ts`: rutas del menú, imports del router, claves i18n usadas y etiquetas de menú sin repetir. Cerrada del todo el 22-09-2026 al comprobar que la salvaguarda sigue completa |
| 86 | No hay rectificativo del CT | 11-09-2026 |
| 87 | El CPU real de `generar-documento` sigue sin medirse con precisión | 11-09-2026 |
| 88 | Los tres PDF de la prueba de publicación quedan huérfanos en `proves/2026/PROVA/` | 11-09-2026 |
| 89 | Un corte por CPU no encendía ninguna luz, y además no paraba nunca | `20270302100000` |
| 90 | Una espigolada con dos registros del mismo producto contaría los kilos dos veces | `20270320100000` |
| 94 | El intake por WhatsApp no manda el correo de confirmación de la oferta | 14-09-2026 |
| 96 | La cuenta que firma desde el panel viaja en `p_datos.panell`, no en la evidencia | `20270320100200` |
| 100 | `app_settings.updated_at` no dice cuándo se cambió un interruptor | `20270320100100` |
| 101 | `reiniciar_cierre_prueba()` borra los documentos `P-CT` pero no devuelve su contador a 0 | `20270322100000` |
| 102 | `entidades.email2` es la cuarta columna ciega de la detección de organizaciones | 15-09-2026 |
| 103 | `authenticated` tiene INSERT, UPDATE y DELETE a nivel de tabla en todo el circuito documental | `20270322100100` |
| 104 | `parametros_documentales` tiene `UPDATE` de tabla, y eso se traga su GRANT por columnas | `20270325100000` |
| 105 | Las descripciones de la modalidad no llegan por WhatsApp | 15-09-2026 |
| 107 | Un interactivo saliente no registraba las opciones ofrecidas | 15-09-2026 |
| 108 | Borrar una ficha no borraba lo suyo: tres comportamientos y uno dejaba huérfanos | `20260921153439` |
| 117 | Nada de lo publicado el 22-09-2026 se había medido en un navegador | 22-09-2026 |
| 14 | La heurística sí/no tenía un hueco de vocabulario: «de acuerdo» (castellano) no clasificaba aunque «d'acord» (catalán) sí | 22-09-2026 |
| 33 | Borrar una ficha dejaba rastro en `email_test_recipients`, sin FK y sin purga automática | `20260922025820` |
| 112 | Los borradores sin número de `cierres_periodo` se acumulaban sin limpieza | `20260922025838` |
| 118 | 5 migraciones registradas dos veces en `supabase_migrations.schema_migrations` (metadata, no esquema) | 22-09-2026 |
| 119 | Los textos `canal.*_passa` de la pantalla guiada se imprimían en cualquier estado del paso, así que en `fet` afirmaban lo contrario de lo que decía el badge | 22-09-2026 |
| 120 | `Mercat.tsx` e `Interessos.tsx` enseñaban la fecha en ISO crudo en vez de con `dataCurta()` | 22-09-2026 |
| 121 | Seis pantallas tenían las etiquetas sin `htmlFor`/`id`: `FormulariNovaOferta`, `RecordDetail`, `DialegNovaOfertaAssistida`, `Mercat`, `CanalitzacioDetall`, `PerfilOrganitzacio` | 22-09-2026 |
| 122 | El texto de WhatsApp imprimía `UBICACIÓ`/`HORARI RECOLLIDA`/`ENVASOS` vacíos y `MODALITAT` en minúscula | 22-09-2026 |
| 123 | El alta de oferta solo validaba en el servidor, con un mensaje genérico sin decir qué campo faltaba | 22-09-2026 |
| 99 | Los paneles externos listaban el plan solo por su PDF, sin enlace al diagnóstico y con el plan sustituido pintado «Emès» | 28-09-2026 |
| 129 | Ningún documento salía por correo: `documentos.envio` se preparaba y no lo leía nadie | 28-09-2026 |
| 106 | `excedentes.estado = 'cerrada'` no lo escribía nadie: ahora la escriben `registrar_desti_final()` y el trigger `canalizaciones_tanca_excedent` (desde `canalizaciones`, nunca desde el circuito legal) | `20270416100000` |
| 124 | Los dos botones del diálogo de cancelar una oferta se leían casi igual («Cancel·lar» / «Cancel·lar oferta»), en `OfferDetail.tsx` y en `OfertaDetall.tsx` del productor | 22-09-2026 |
| 130 | La pantalla guiada no elegía modalidad al aprobar un interés de una oferta con varias | 11-10-2026 (fase 8 de la revisión del 08-10-2026) |
| 125 | 22 migraciones con la fecha real del 21/22-09 iban por delante de tablas que usan: el repo no reconstruía producción | 07-10-2026 (renumeradas a `20270328100100`…`102200` en repo y en historial; el clon local lo comprueba) |
| 145 | `reiniciar_cierre_prueba()` ponía a 0 `P-RES`/`P-CD`/`P-CT` del año aunque otro cierre de prueba conservara sus documentos: la siguiente emisión chocaba con `23505`. Ahora deja el último número vivo | `20270430100400` |
| 150 | El equipo podía insertar fichas directo por REST (políticas `alta intern`) y saltarse las reglas de `crear_entitat()`: una ficha activa sin NIF | `20270501400000` |
| 178 | Una empresa confirmada de tipo `animal` no tenía nada compatible (`animal` solo admitía donación) | `20270524100000` (`animal` admite también compra) |
| 177 | Los NIF F, H y V sin forma jurídica se quedaban sin sugerencia de naturalesa | `20270524100000` (social si la receptora es `social`; empresa si no) |
| 176 | `priorizar-entidades` no miraba la naturalesa y proponía donaciones a empresas confirmadas | 10-11-2026 (`admesaPerNaturalesa`, mismo cruce que el Mercat) |
| 175 | El motor del cuestionario y el del plan básico seguían en la base sin uso | `20270524100000` (funciones y tablas `questionaris_diagnostic`, `regles_pla`, `mesures_prevencio` fuera) |
| 174 | `diagnostics_historial` ya no se escribía | `20270524100000` (`drop`; el script de publicación lo volcó antes a `scripts/data/`) |
| 168 | Un `entidades.estat` vacío (toda entidad nueva) dejaba la entidad fuera de `priorizar-entidades` | 09-11-2026 (el ranking mira el convenio que pide la modalidad) |
| 144 | El trigger del NIF hacía fallar las filas de la importación masiva con un NIF mal escrito o repetido | 02-11-2026 (`import-ara-2026.ts`, 1E) |
| 142 | Los consentimientos RGPD no tenían exportación ni forma de pedirse a quien no se registró | `20270506100000` (export en «Entitats», petición por correo desde la ficha) |
| 139 | El REC de una oferta mixta (donación y venta) se repartía solo entre las donaciones e inflaba el certificado | `20270509100000` + `20270509100700` (05-11-2026) |
| 85 | El CT no tenía prueba end-to-end | 05-11-2026: el CT se retiró (`20270509100400`) |
