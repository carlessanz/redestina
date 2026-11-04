# AGENTS.md §4 — 4. Modelo de datos

> Detalle de la sección 4 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §4» del código apuntan aquí.

## 4. Modelo de datos

### Mensajería (fase 1)

**`wa_contacts`** — `id`, `phone` (UNIQUE, E.164 sin `+`), `name`, `opt_in`, `opt_in_at`,
`opt_out_at`, **`last_inbound_at`**, `created_at`.
`last_inbound_at` es la última vez que el contacto escribió: modela la ventana de servicio
de 24 h y decide si se puede enviar texto libre (§8).

**`wa_messages`** — `id`, `wa_message_id` (**índice único**: idempotencia frente a
los reintentos de Meta), `contact_phone`, `direction` (`inbound`/`outbound`), `type`,
`body`, `status`, `raw` (jsonb), `created_at`. Índice `(contact_phone, created_at)`.

### Redestina (fase 2)

**`productores`** — la tabla original (`id`, `name`, `email` UNIQUE, `phone` UNIQUE,
`created_at`) **ampliada** con `empresa`, `codigo`, `comentario`, `visitado`, `conveni`,
`tipo_empresa`, `telefono_alt`, `direccion`, `codigo_postal`, `nif`, `area_geografica`,
`poblacion`, `productos_habituales text[]`, `data_alta`, `activo`.
**`phone` es nullable**: 61 de los 339 productores importados no tienen móvil utilizable y
aun así conservamos su ficha. La UI deshabilita el envío para ellos. Campo **`es_test`** (bool,
default false, `20260723110000_es_test.sql`): marca de "usuario de prueba"; **solo estos reciben
WhatsApp/correo** (fuente de verdad del envío, §8), editable por ficha.

**`productor_ubicaciones`** — un productor puede tener varias: `alias`, `gmaps_url`,
`coord_lat`, `coord_lng`, `municipio`, `es_principal`.

**`organizaciones`** (`20270310100000`) — **la identidad común de las dos tablas de fichas**, y
la etapa 1 de la brecha 2 de §1bis. `productores.organizacion_id` y `entidades.organizacion_id`
apuntan a ella, con índice único parcial: **una organización tiene como mucho una ficha de cada
tipo**. La vista `v_organizaciones` (`security_invoker`) dice quién es cada una **leyéndolo de
sus fichas**; `es_generadora`/`es_receptora` son **derivados de tener ficha**, no declarados.

⚠️ **`canal_preferido` se escribe por RPC, no por `update`.** La tabla no tiene GRANT de
escritura para nadie, como el resto del circuito documental: la única entrada es
`actualizar_meu_canal()` (§4bis), y la pantalla es la ficha propia (`PerfilOrganitzacio`). No es
una columna más de `actualizar_mi_productor` **porque no es de la ficha**: una organización con
los dos papeles tiene UN canal preferido, y meterlo en las dos RPC crearía dos escrituras que
pueden discrepar sobre el mismo dato — justo lo que esta tabla existe para evitar.

⚠️ **No guarda ni nombre ni NIF a propósito.** Duplicarlos crearía dos fuentes de verdad para el
mismo dato, y en cuanto alguien editara una ficha nadie sabría cuál manda. Aquí solo vive lo que
no tiene otro sitio: la identidad y `canal_preferido`, que es el campo que pide el funcional para
que la organización pueda **decir** su canal en vez de que se deduzca de lo que tenga la ficha
(§8bis).

⚠️ **Y lo que los datos dijeron, que cambia lo que §12.28 daba por hecho.** Esa deuda afirma que
unificar «exigiría deduplicar 111 entidades sin clave única». **Medido contra producción el
11-09-2026: no hay nada que deduplicar.** De 345 productores y 119 entidades hay exactamente
**cuatro** pares que son la misma organización —los del equipo, §9—, y coinciden por **correo o
teléfono exactos**. Las otras 456 fichas son organizaciones distintas entre sí. El **NIF no sirve
de clave**: lo tiene el 49 % de los productores y el 55 % de las entidades, y **cero NIF aparecen
en las dos tablas**. El relleno es, por tanto, una fila por ficha y cuatro enlaces conocidos, no
una fusión con riesgo de juntar lo que no va junto.

⚠️ **El criterio de enganche es correo o teléfono, nunca el parecido del nombre.** Juntar dos
organizaciones distintas significa mezclar los kilos y el certificado fiscal de dos donantes: se
prefiere dejar dos filas separadas —el estado de hoy, que funciona— a arriesgar una fusión mala.
**Sigue valiendo tal cual para el relleno inicial y para `registro`** (el alta self-service, que
no cambió); no vale ya para `organitzacions_candidates()`, que desde el 22-09-2026 añade NIF
exacto y nombre por similitud calibrada (D3, ver más abajo) — y aun así **nunca fusiona sola**:
solo sugiere, al equipo, que decide con `enllacar_organitzacio()`. La frase de arriba sigue
siendo la razón de fondo por la que el nombre no se usó a la ligera: se calibró primero.

⚠️ **El relleno inicial no basta, y esto casi se escapa.** `20270310100000` rellenó las 464
fichas que había **en ese momento** y ahí se acababa: cualquier ficha creada después —un alta desde
`/registre`, una del panel, un fixture— nacía **sin organización y sin dar ningún error**, porque la
columna era nullable. Se vio por casualidad a los pocos minutos, al cambiar la clave de `convenios`.
Lo que mantiene la invariante es el trigger `*_estrena_organizacion` (`20270313100000`) más el
`not null`: el primero la rellena, el segundo hace que no se pueda saltar. **Migrar los datos y
mantener la invariante son dos cosas distintas**, y un `update` de relleno solo hace la primera.

✅ **La etapa 1 no cerraba ninguna deuda por sí sola, y hoy ya las cerró todas** — corregido
el 22-09-2026: este párrafo llegó a decir «las otras seis siguen necesitando su trabajo encima»
mucho después de que dejara de ser cierto. Desbloqueaba las ocho de la brecha 2 (11, 16, 20, 22,
27, 28, 31, 79) y las ocho están resueltas: **31** (una ficha por tipo, `20270311100000`), **79**
(convenios por organización, `20270312100000`), **11** (FK `wa_messages`↔contacto,
`20270321100000`), **20** (rol único por usuario, `20270311100000`), **22** (preferencia de canal,
11-09-2026), **28** (el registro deduplica, `20270315100000`) y **16** (WhatsApp distingue las dos
fichas por `organizacion_id`, 11-09-2026); **27** se reclasificó como decisión deliberada, no
defecto (§12bis). ⚠️ **Que las ocho sub-deudas estén cerradas no cierra la brecha 2**: lo que
queda —`usuario`/`rol_organizacion` propios, una organización con campos suyos, y que TODOS los
consumidores (no solo el registro) traten `organizaciones` como la identidad— es trabajo de
arquitectura sin desglosar en números, no un bug con ficha propia. Su plan vive en
`3. Claude Code/2026-09-22-plan-organizacion-unificada.md` (§1).

**`entidades`** — entidades sociales receptoras (25 columnas del Excel SDA). Los tres campos
de capacidad (`productes_frescos`, `transport_plataforma`, `descarrega_toro`) vienen como
texto libre: se guarda el original en `*_txt` y se deriva el boolean, que queda `null`
cuando el texto no es concluyente (`"1 furgo"`, `"Transpalet"`, `"In situ"`). Ampliada con
**`modalitat`** (`20260722160000_entidad_modalitat.sql`): modalitat d'aprofitament
(Donació/Transformació/Venda/Maquila/Altres), editable con desplegable en el detalle (CRUD). Y
con **`es_test`** (bool, default false, `20260723110000_es_test.sql`): como en productores, marca
de prueba que habilita el envío a la entidad (§8).

**`excedentes`** — cabecera de la oferta. `id_excedente` UNIQUE con formato
`E-AAMMDD-XXX-YYY-N`. `estado` ∈ `borrador` · `publicada` · `parcial` · `bloqueada` ·
`cerrada` · `no_colocada` · **`cancelada`** · **`pendent_validacio`** (05-10-2026: espera al equipo antes del Mercat, §6ter rebanada 1) (anulada desde el panel; check en
`20260722130100_estado_cancelada.sql`). `modalitat` ∈ `donacio` · `venda` · `maquila`. **`preu_minim`**
(numeric €/kg, `20260723130000_aceptacion_ofertas.sql`): preu mínim que fija el productor en el intake,
solo en `venda`/`maquila`; sale en `texto_oferta` y la entidad lo confirma al aceptar (§5).

**`fotos`** (`text[]`, como mucho 3, `20270404100000`): rutas del bucket `fotos-ofertes`; la
primera es la principal. Llegan en el alta (`crear-oferta`, que valida que son de la carpeta de
ese productor) y se cambian después con **`fixar_fotos_oferta(excedente, fotos)`** —el
productor de la oferta o el equipo; el permiso se comprueba ANTES que la existencia
(`20270404100100`)—. Se ven en el Mercat (tarjeta y detalle), en Interessos, en Històric, en el
detalle del productor y en el del equipo. ⚠️ **Por WhatsApp no llegan**: el bot todavía no
descarga imágenes (brecha 8).

**`foto_producte`** (bool, default `true`) y **`coste_kg`** (numeric > 0, null) —`20270405100100`,
27-09-2026—. La primera: si la oferta **no trae fotos propias**, se enseña la foto del producto del
catálogo (§6ter); `false` deja el icono genérico. La segunda: el **coste por kilo que declara el
productor** para esta oferta, partiendo de la referencia de `costes_producto` (§6bis); null = vale
la referencia. `fixar_fotos_oferta()` gana `p_foto_producte` y con `p_fotos = null` no toca las fotos.

**`format_entrega`** (`caixes`·`palet`·`envasos_propis`·`altres`, check) y **`transport_propi`**
(bool; null = no se preguntó), `20270401100000` — §6bis. `tipo_caixa` se queda para las ofertas
anteriores y ya no se escribe.

**`municipi_ine`** y **`comarca`** (`20270331100000`) — de dónde es la oferta, **copiado en
la propia oferta** porque el receptor no puede leer la ficha del productor ni sus ubicaciones.
Los rellena el trigger `excedentes_ubica` (al insertar, y al cambiar `ubicacion_id` o
`productor_id`) con `ubicar_excedente()`: la ubicación de recogida si tiene `municipio_ine`; si
no, el CP de la ficha por `codis_postals` —un municipio si el CP apunta a uno solo; si apunta a
varios, solo la comarca cuando todos comparten la misma—; si no, null. **Por trigger** porque
`excedentes` se inserta desde varios caminos (panel, WhatsApp, espigolada, fixtures).
⚠️ **El Mercat enseña la COMARCA, no el municipio** (D3: un municipio con un solo generador lo
identifica). Relleno hecho: 17 de 17 ofertas con comarca el 27-09-2026.
⚠️ **Y D3 ya se rompía antes por otro lado, sin decirlo**: el diálogo de interés del Mercat
enseñaba el `texto_oferta` entero, que lleva la línea «PRODUCTOR: …». Desde el 27-09-2026 el
detalle es estructurado y ya no la muestra; si la Fundación decide que el receptor sí debe ver
quién ofrece (lo pide la revisión del 23-09), se añade explícitamente.

**`producte_al_camp`** (bool, default false, `20260921221806`) — la oferta declara producto **sin
cosechar**: hay que ir a recogerlo. Es lo que la hace **convertible en espigolada** (§6ter) y lo que
la mete en la cola 13 del equipo. Se pregunta por los dos canales (§6bis) y sale en `texto_oferta`
**solo cuando es cierto**, con la misma asimetría que el `preu_minim`: un «PRODUCTE AL CAMP: no» en
el caso normal es ruido en un mensaje que se lee en el móvil.
⚠️ **Columna propia y no un campo en jsonb** a propósito: decide un flujo —quién crea el REC, si
sale en la cola, si se puede convertir— y un campo que decide un flujo no puede vivir en texto libre
donde una errata no la detecta nadie. `excedentes` tiene GRANT **de tabla**, así que la columna nace
legible sin tocar nada; eso **no** valdría en una tabla con GRANT por columnas (§4, `documentos`).
⚠️ La escribe **solo el equipo**: la única política de UPDATE de `excedentes` es `es_intern()`, y el
generador la fija al publicar pero **por el servidor** (`authenticated` no tiene INSERT).

**`canalizaciones`** — detalle por entidad: `kg_confirmados`, `kg_reales`, cajas, albaranes,
firmas. Relación **`excedentes` 1—N `canalizaciones`** (una oferta, varias entidades).

⚠️ **El productor ya NO lee `oferta_respuestas` de sus ofertas** (`20270324100000`). La política de
SELECT de `20260730098000` traía la rama `excedente_id in (select
excedents_dels_meus_productors())`, que le concedía `entidad_id`, `telefono` y `preu_ofert` —
comprobado el 14-09-2026 con sesión real de `TEST-PROD-1`: tres filas—. Ninguna pantalla lo pedía;
la rama nació en una migración que arreglaba una recursión entre políticas, antes de que existiera
ninguna decisión sobre qué ve el generador. Desde entonces el productor ve su embudo **solo
agregado**, por `progres_meves_ofertes()`. ⚠️ Se retiró **una referencia** a
`excedents_dels_meus_productors()`, no la función: la política de `canalizaciones` la sigue usando,
y eso es lo que hace que el productor no quede a ciegas —al aprobarse un interés nace la
canalización, y esa sí la ve, porque a esas alturas hay una entrega que coordinar.

**`oferta_respuestas`** — flujo de **aceptación** (`20260723100000_oferta_respuestas.sql`; ampliada
en `20260723130000_aceptacion_ofertas.sql`): `excedente_id` (FK, `on delete cascade`), `entidad_id`
(FK, `on delete set null`), `telefono`, `canal` (`whatsapp`·`email`·`panel`·`asistido`·**`manual`**, este desde `20270430100100`: la oferta enviada a mano), `mensaje_respuesta`,
`enviado_at`, `respondido_at`, `unique (excedente_id, entidad_id)` (reenviar actualiza, no duplica)
e índice `(telefono, estado)`. Tiene **dos ejes**: **`estado`** (`pendent`·`acceptada`·`rebutjada`) =
respuesta de la **entidad**; **`aprovacio`** (`pendent`·`aprovada`·`rebutjada`) = decisión del
**superadmin**. La aceptación guarda `kg_solicitados`, `caixes_solicitades` y `preu_ofert`; el diálogo
de WhatsApp (SÍ → kg → confirmar preu, §5) guarda su avance en `dialeg_pas`/`dialeg_dades`; al aprobar
se crea una fila en `canalizaciones` y se enlaza con `canalizacion_id` (+`aprovat_at`,
`motiu_aprovacio`). Es **distinta de `canalizaciones`**: aquella registra los kg definitivos; esta, el
sí/no de la entidad y su aprobación. Al enviar desde `OfferDetail` se deja una fila `pendent`; el
webhook la actualiza (§5). Realtime activo.

**`intake_sessions`** — estado del flujo conversacional: `telefono`, `paso_actual`,
`datos_parciales jsonb`, `excedente_id` (sin uso), `updated_at` y
**`recordatorio_enviado_at`** (marca del aviso de 10 min; `guardar()` la vuelve a `null` en
cada actividad, así el recordatorio salta 10 min tras la última interacción — §5).

**Listas maestras** — `productos` (`nombre` PK, `familia`, `eur_kg`), `causas` (`codigo` PK),
`factores_conversion` (`producto` PK, `kg_por_unidad`). Los nombres de
`factores_conversion` **no casan** con `productos` (van en mayúsculas): es tabla de
consulta, no clave foránea.

**`meta_test_recipients`** — `phone` PK (E.164 sin `+`), `etiqueta`, `created_at`
(`20260722120000_meta_test_recipients.sql`). Whitelist de destinatarios: en el entorno de
test la Cloud API solo entrega a los ≤5 números dados de alta en Meta, y **Meta no expone
ninguna API** para listarlos ni añadirlos (se gestionan en su panel confirmando un código).
La app guarda aquí su copia y la usa como fuente de verdad para separar productores (§6ter) y
para el gate de envío (§8). **Semántica clave**: si la tabla tiene filas, solo se envía a
quien esté en ella; si está **vacía**, no restringe nada (así, al pasar a un número de
producción sin el límite de 5, se vacía la lista y el gate desaparece solo). La gestiona
`src/lib/metaTest.ts` desde el Dashboard.

**`email_test_recipients`** — `email` PK, `etiqueta`, `created_at`
(`20260722150000_email_test_recipients.sql`). Whitelist análoga a `meta_test_recipients` pero
para el canal **email** (Resend): si tiene filas, `enviar-email` solo manda a esos correos;
vacía = sin límite. RLS: `authenticated` select/insert/delete. La gestiona `src/lib/emailTest.ts`
desde el Dashboard. **Ojo**: Resend sin dominio verificado solo entrega al correo propietario de
la cuenta, así que esta lista es la segunda barrera, no la única.
⚠️ **Guarda un correo suelto, sin FK**: por eso conserva `tecnologia@espigoladors.com` sin ficha
detrás a propósito (arriba en este §, es el correo propietario de la cuenta de Resend). El
31-07-2026 quedaron dos filas huérfanas (`TEST-ENT-ANIMAL`, `TEST-PROD-PENDENT`) y volvió a pasar
el 16-09-2026 con el borrado de doble rol de Carles Sanz (deuda §12.33) — dos veces la misma
disciplina manual fallando.
✅ **Ya no puede volver a pasar** (22-09-2026, `20260922025820_borrar_fitxa_purga_whitelist.sql`):
`borrar_una_fitxa()` captura el correo de la ficha antes de borrarla y purga, en la MISMA
transacción, la fila de `email_test_recipients` que coincida EXACTO — nunca toca
`tecnologia@espigoladors.com`, que no cuelga de ninguna ficha desde el origen. Lo que sigue siendo
disciplina manual es un `insert`/`update` directo en la whitelist fuera de
`borrar_ficha_completa()`, que no lleva ninguna validación — pero ese no es el caso que producía
huérfanos.

**`app_config`** — `key` PK, `value`, `updated_at` (`20260722130000_intake_recordatorios.sql`).
Clave/valor para secretos que un **job** necesita y que no pueden ir en git. Hoy guarda
`recordatorios_secret` (el que el job pasa a `intake-recordatorios`, §5). **Solo `service_role`**:
RLS activa sin política y `revoke` explícito del `SELECT` que `authenticated` heredaría por
default privileges (§9). La fila del secreto se inserta fuera de git con la service key.

**`app_settings`** — `key` PK, `value`, `updated_at` (`20260723140000_app_settings.sql`).
Clave/valor de **configuración no secreta** que gestiona el equipo desde **Configuración** (a
diferencia de `app_config`, solo `service_role` para secretos). RLS: `authenticated`
select/insert/update, y `service_role`. Hoy guarda **`test_mode`** (`'true'`/`'false'`, default
`'true'`): el **modo test global** (§8), y **`whatsapp_activo`** (`'true'`/`'false'`, default
`'true'`, `20270317100000`): el **interruptor global de WhatsApp** (§8). Desde el 27-10-2026
(`20270429100000`) también **`notificacions_actives`** (el general) y **`email_activo`** (el canal de
correo), y los tres se escriben **solo por RPC** (`fixar_notificacions`, `fixar_canal_notificacio`,
§4bis), ya no por upsert. Los leen las Edge Functions (`modoTestActivo`, `canalsActius`) y los
togglea `src/lib/settings.ts` desde Configuració › Notificacions.

⚠️ **Los dos son fail-safe, pero en sentidos CONTRARIOS, y es deliberado.** En `test_mode` la duda
—fila ausente, error de lectura, valor raro— debe **cortar** un envío a quien no es de prueba; en
`whatsapp_activo` la duda no puede dejar la plataforma **muda**, así que solo un `'false'` explícito
lo apaga. Confundirlos al copiar el patrón invierte la garantía sin que nada falle. Escribir exige
`es_super_admin()` (`20260730095000:147-156`), igual para los dos.

**`consentiments`** (`20270429100100`, 27-10-2026) — los consentimientos RGPD de las altas, **solo
inserción**: `user_id`, `organizacion_id`, `tipus` (`privacitat` · `comunicacions_plataforma` ·
`comunicacions_espigoladors`), `valor`, `versio_text`, **`sha256_text`** (huella del texto que compone
el SERVIDOR, `_shared/textosRgpd.ts`), `idioma`, `origen` (`registre` · `alta_assistida`),
`registrat_per` (quién del equipo lo declaró), `ip`, `user_agent`. Un check impide guardar una
privacidad no aceptada. Sin GRANT de escritura: la escriben `registro` y `alta-assistida` con
`service_role`. RLS de lectura: la propia cuenta o `es_intern()`. Vista `v_consentiments_vigents`
(`security_invoker`): el último valor por persona y tipo.
⚠️ **No condiciona ningún envío operativo**: los avisos del servicio los gobiernan los interruptores
(§8); esto es para comunicaciones informativas o de marketing, que hoy no existen.
`documento_envios.estado` admite además **`desactivat`**: un correo cortado por un interruptor.

### Sistema documental (fase 1)

**Regla que lo ordena todo: el número pertenece a la fila, no al fichero.**
`siguiente_numero(serie, ejercicio)` se llama DENTRO de la transacción que crea la fila del
dominio y su fila en `documentos`. Si la transacción cae, el número no se consume; si lo que
falla es el PDF (después, en la Edge Function), la fila ya existe y no hay hueco legal. Por eso
**no** es una `sequence`: `nextval()` no se deshace con el `rollback`.

**`series_documentales`** — `serie`, `ejercicio` (PK compuesta), `ultimo`, `digitos`
(`20260928100000_series_documentales.sql`). `siguiente_numero()` es un
`insert … on conflict (serie, ejercicio) do update set ultimo = ultimo + 1 returning`: el
`on conflict` toma el bloqueo de la fila y serializa; el valor solo se consolida con el `commit`
de quien lo pidió. `formato_numero(serie, ejercicio, n)` → `REC-2026-00042`. Sembradas 16 series
× ejercicios 2026-2030: REC/ENT/OPE y sus `R-` con 5 dígitos; CONV-DON-GEN/CONV-DON-REC/CONV-COM/
RES/CD/CT/PLA y `P-RES`/`P-CD` con 4; `PROVA` con 4. RLS: select `es_intern()`.
**`siguiente_numero` NO la puede ejecutar `authenticated`**, ni el super_admin: quemar un número
de una serie legal solo puede pasar dentro de la transacción de una RPC de emisión.
Verificado con `scripts/prueba-numeracion.ts` (§11): 50 emisiones concurrentes con un 20 % de
rollback, cinco pasadas, `1..N` sin huecos; y en estrés, 200 × 30 % de fallos.

**`documentos`** (`20260928100200_documentos.sql`) — una fila por documento emitido.
Polimórfica (`objeto_tipo`/`objeto_id`, sin FK por tipo ni FK inversa desde el dominio); el
dominio nunca apunta al PDF, se le pregunta con `documento_vigente()`. Columnas: `tipo` (13
valores en el CHECK vigente, de REC a PROVA; eran 12 al crearse la tabla) · `subtipo` · `objeto_tipo` (8 hoy,
con `cierre_periodo` y `cierre_receptor`; eran 6) · `objeto_id` · `numero_completo` ·
`version` · `serie` · `ejercicio` · **`modo`** (`real`/`prueba`) · `idioma` · `plantilla_id` ·
`datos jsonb` · `sha256_datos` · `ruta` · `sha256_fichero` · `bytes` · `paginas` · `estado`
(`pendiente_fichero`/`emitido`/`error`) · `intentos` · **`reencolados`** · `ultimo_error` · `envio jsonb` ·
`vigente` · `sustituido_por` · `emitido_por` · `emitido_at` · `fichero_at`. Índices:
`unique (numero_completo, version)`; único parcial `(objeto_tipo, objeto_id, tipo) where vigente`;
`(objeto_tipo, objeto_id)`; parcial `(estado) where estado <> 'emitido'`.

⚠️ **`plantilla_id` no tiene FK todavía**: `plantillas_documento` la crea `20260928100100`, que
no entró en el spike. Esa migración añadirá la FK con `alter table`.

**Dos huellas, no una.** `sha256_datos` = huella del snapshot canónico (`datos::text`, que en
`jsonb` es determinista), calculada en SQL al emitir, y **es la que se imprime** como código de
verificación. `sha256_fichero` = huella de los bytes, calculada en Deno antes del `upload`. Un
PDF no puede contener su propio hash.

**El modo vive en el dato.** `documentos.modo` decide serie con prefijo `P-`, marca de agua y
destinatarios. **No depende de `test_mode`** (§8): un cierre de prueba no llega nunca a un
donante real aunque el modo test global esté apagado. Y los documentos `modo='prueba'` no los ve
ningún externo, ni de su propia organización.

**Inmutabilidad por trigger.** `documentos_inmutable` congela tipo, objeto, número, serie, modo,
idioma, `datos`, `sha256_datos`, `ruta` y la autoría; solo deja las transiciones
`pendiente_fichero→emitido|error`, `error→emitido|pendiente_fichero` (**`emitido` es terminal**)
y `vigente` true→false. ⚠️ La transición `error→emitido` no estaba prevista y la encontró la
prueba, no la lectura: sin ella, el job de reintento —que reencola sin devolver la fila a
`pendiente_fichero`— dejaba un documento fallado imposible de recuperar.
`documentos_no_esborrar` prohíbe el `delete` salvo con
`current_setting('redestina.reinicio_prueba', true) = 'on'` **y** `modo='prueba'`; ese
interruptor solo lo fija `reiniciar_documentos_prova()` con `set_config(..., is_local => true)`,
así que no se puede dejar encendido. `documentos_objeto_existe` (before insert) sustituye a la FK
que el modelo polimórfico no puede tener: resuelve la tabla con `to_regclass`, así que **no hay
que editarlo en cada fase** —cuando la fase 3 cree `albaranes`, empieza a comprobarlos solo—.
`objeto_tipo = 'prova'` está exento.

**`documento_envios`** — `id`, `documento_id` (FK cascade), `destinatario`, `canal` (**solo
`email`**), `estado` (`pendent`/`enviat`/`error`), `proveedor_id`, `error`, `enviado_at`,
`created_at`. `canal` admite solo correo a propósito: un
documento o un enlace de firma por WhatsApp quedaría publicado en la consola de Mensajería, que
lee todo el equipo.

**Envío de documentos por correo** (28-09-2026, cierra §12.129). `generar-documento`, en
cuanto sube el PDF y lo marca generado, lo manda **adjunto** a `envio.destinatario`. Qué se
dice lo decide `_shared/correu-document.ts` (puro, con 9 pruebas), según tipo, subtipo e idioma:

| Documento | Se manda | Nota |
| --- | --- | --- |
| `CONV` firmado / contrafirmado | ✅ | «Hem rebut el teu conveni signat» / «El teu conveni ja és vigent» |
| `RES`, `CD` (anual y a demanda), `CT`, `CR` | ✅ | El **cuerpo del correo** del resumen no pide la factura. ⚠️ Pero `emitir_resumen()` sigue acuñando el enlace `subida_factura` (60 días), el PDF del resumen imprime la caja «Per què cal la factura» y el RES definitivo deja al donante en `factura_pendent`: la afirmación «no pide la factura» solo vale para el texto del correo (§12.127, abierta; verificado contra el código el 07-10-2026) |
| `REC`/`ENT`/`OPE` y sus `R-` | ❌ | Se manda el ENLACE de confirmación, no el PDF (`enviaEnllacosConfirmacio`, cliente) |
| `PLA`, `PROVA` | ❌ | El plan se descarga al momento; `envio` va a null |

- **Gates** (§8): documento de prueba → `destinatariosPrueba()` (solo `es_test` y el buzón del
  equipo); documento real → con el modo test activo, solo fichas `es_test`; y en los dos, la
  lista `email_test_recipients` si tiene filas (`enLlistaCorreuTest()`, nueva en `gate.ts`).
- **Solo al generar el fichero por primera vez**: la idempotencia (`fichero_at`) corta antes,
  así que los documentos que ya existían el día del estreno **no se reenviaron**.
- **Un correo que falla no marca el documento en `error`**: el documento está bien. Queda en
  `documento_envios` (`proposito = 'document'`, con `documento_id`) y se ve en la pestaña
  Enviaments de Documents. No hay reintento automático; hay **botón «Reenvia»** (abajo).
- ✅ **«Reenvia»** (28-09-2026): en `/equip/documents`, en la fila de cada documento que se
  manda por correo (CONV, RES, CD, CT, CR emitidos) y en la de cada envío de la pestaña
  Enviaments. Pregunta antes y llama a la Edge Function **`reenviar-documento`** (JWT,
  `exigirEquipo`), que manda **el PDF que ya está en el bucket** —no lo vuelve a renderizar—
  **al destinatario de `documentos.envio`** —nunca a uno que llegue en la petición: el botón no
  puede ser «manda este certificado a cualquier correo»; si la dirección está mal se corrige la
  ficha y se emite de nuevo—. Pasa por **las mismas barreras**, porque el envío vive en
  `_shared/envia-document.ts` y lo llaman las dos funciones: con dos copias, el reenvío podría
  acabar siendo la forma de saltarse el modo test. Responde `429 enviat_fa_poc` si ya salió
  (enviat o simulat) hace menos de 2 minutos, que es lo que para un doble clic; un error
  reciente no lo impide. Sirve también para los documentos anteriores al envío automático.
  Probado en producción: una productora recibe `403`, el equipo `429` justo después del
  envío y, pasados los dos minutos, el reenvío sale (`funcion = 'reenviar-documento'`).
- Por encima de 25 MB se manda sin adjunto (Resend limita a 40 MB y base64 infla un 33 %).
- ✅ **Probado en producción el 28-09-2026**: un certificado de recepción de prueba
  (`P-CR-2026-0001`, Obrador de Prova) se generó (3 páginas) y salió por Resend con el PDF
  adjunto (`enviat`); un `PROVA` se generó igual (6 páginas, 123.621 bytes) y sin envío.
  Retirados los dos después.
- ⚠️ El aviso «conveni signat» de `enlace-publico` va ya **solo al equipo**: a quien firma le
  llega su copia en PDF por aquí.

**Buckets** (`20260928100600_storage_buckets.sql`) — `documentos` (privado, 20 MB,
pdf/png/jpeg) y `activos` (privado, 5 MB, png/jpeg, para la firma y el sello de la apoderada).
**Sin una sola política en `storage.objects` para estos dos buckets**: nadie los toca directo, ni
para leer ni para listar. Se leen por la Edge Function `descargar-documento`, que autoriza con
`puede_ver_documento()` y firma una URL de 60 s.

⚠️ **La excepción es `fotos-ofertes`** (`20270404100000`, 27-09-2026), el bucket de las **fotos del
producto**: privado, 5 MB, jpeg/png/webp, y **con políticas propias en `storage.objects`** —las
primeras del proyecto, limitadas a `bucket_id = 'fotos-ofertes'`—. Una foto de producto no
necesita la lógica de un documento legal: se ve si se ve la oferta, y eso ya lo dice la RLS de
`excedentes`. Sube el productor **solo en su carpeta** (`<productor_id>/<uuid>.jpg`) o el equipo;
ven el equipo, el productor en su carpeta y **cualquiera que pueda ver una oferta que cite la
ruta** en `excedentes.fotos` (el `exists` se evalúa con la RLS de quien pregunta); borra el
productor en su carpeta o el equipo. **No hay política de UPDATE**: una foto no se sobrescribe, se
sube otra con otro nombre. El cliente (`src/lib/fotos.ts`) firma URLs de 1 h en lote.
✅ **Probado con sesiones reales**: el productor sube en su carpeta (200) y no en la de otro
(rechazado); la entidad social que ve la oferta firma la URL (200) y la empresa compradora —que
no ve donaciones— y otro productor no; `crear-oferta` rechaza citar una foto de otra carpeta
(`fotos_invalides`).
🔴 **La foto se recomprime en el navegador** (JPEG, lado mayor 1600 px) y eso **borra el EXIF**,
posición GPS incluida: sin ese paso, una foto hecha en la finca publicaría dónde está (D3).
⚠️ Las imágenes van con `loading="lazy"`: en una pestaña oculta (el panel del navegador integrado
cerrado) no cargan, y parece que la foto está rota. No lo está.

⚠️ **Sin uso desde el 29-09-2026: el catálogo pasó a iconos propios (§6ter)**; lo que sigue describe el bucket, que se conserva.
✅ **Y el catálogo tiene su propio bucket, `fotos-productes`** (`20270405100000`, 27-09-2026),
**separado a propósito** del de las ofertas: aquellas son del productor —se ven si se ve la oferta y
pueden enseñar su finca— y estas son del catálogo, sin dueño. Privado, 2 MB, jpeg/webp. Políticas:
**ver** cualquier `authenticated` (el receptor la necesita como respaldo en el Mercat); **subir y
borrar solo `es_super_admin()`**, ni siquiera un admin; sin UPDATE. `productos` gana `foto` (grande,
1000×750), `foto_mini` (240×240) —van juntas o ninguna, por check— y `foto_credit` (autor, licencia
y fuente: aunque sea CC0 se guarda). Se escriben solo por **`fixar_foto_producte()`**, que comprueba
el rol ANTES que la existencia y devuelve las rutas viejas para que el cliente retire los ficheros.
Las fotos iniciales salen de `scripts/fotos-cataleg.json` (§11): **solo CC0 o dominio público**.

**La carpeta ordena; la tabla autoriza.** `ruta_documento()` compone en SQL, al insertar:

```text
productors/<productor_id>/<ejercicio>/<CARPETA>/<numero>-v<n>.pdf
entitats/<entidad_id>/<ejercicio>/<CARPETA>/<numero>-v<n>.pdf
productors/<productor_id>/proves/<ejercicio>/<CARPETA>/…    (modo = 'prueba')
proves/<ejercicio>/PROVA/<numero>-v<n>.pdf                  (tipo = 'PROVA')
```

`<CARPETA>` es el `tipo` sin el prefijo `R-`: el rectificativo se archiva junto al original. Un
fichero se guarda **una sola vez**, bajo su organización propietaria; la otra parte de un
documento a dos bandas lo ve por `documents_meus()`, nunca por la ruta. La Edge Function sube
exactamente a `documentos.ruta` y no elige carpeta: si la eligiera ella, la estructura del bucket
dependería del código desplegado en cada momento. ⚠️ La función es **`stable`, no `immutable`**:
resolver el propietario exige leer tablas del dominio.

**`plantillas_documento`** — el TEXTO de los documentos, versionado y en la base
(`20260928100100`): `tipo` (mismo vocabulario que `documentos.tipo`), `idioma` (`ca`/`es`),
`version`, `titulo`, `cuerpo jsonb`, `marcadores text[]`, `vigente`, `valida_desde`.
`unique (tipo, idioma, version)` e índice único parcial `(tipo, idioma) where vigente`. `cuerpo` =
bloques `{tipo:'h1'|'h2'|'h3'|'p'|'lista'|'salt', text}` con `{{marcadores}}`: exactamente lo que
consume `_shared/pdf/plantilla.ts`. **Está en la base y no en el código** porque el texto lo
redacta la Fundación, cambia sin que cambie el software, y hay que poder responder con qué texto
EXACTO se emitió un documento de hace cinco años. Un documento ya emitido **no cambia** si la
plantilla cambia: lleva su snapshot en `documentos.datos`. Trigger `plantillas_inmutables`: en
cuanto un `documentos` la referencia, tipo/idioma/versión/título/cuerpo/marcadores quedan
congelados (42501); solo se puede mover `vigente` y `valida_desde`. **Sin GRANT de DELETE**: una
plantilla se retira, no se borra. Se siembra solo la de `PROVA` (ca+es), que no es texto de
negocio sino el ejemplo ejecutable del formato.

⚠️ La FK `documentos.plantilla_id → plantillas_documento(id)` vive en
**`20260928100250_fk_documentos_plantilla.sql`**, no en `…100100`, y no es una preferencia:
`100100 < 100200`, así que en cualquier entorno recreado desde cero ese fichero se aplica **antes**
de que exista `documentos` y el `alter table` fallaría. Que en su día funcionara fue un accidente
del orden en que se aplicaron —`100200` ya estaba y `100100` llegó después—, y entonces lo habría
destapado el primer `db reset`.
✅ **Y desde el 07-10-2026 está comprobado**: el clon local (§11) recrea el esquema desde cero con
las 148 migraciones y sale **idéntico al de producción** (comparado sin comentarios). Entre el
14-09 y el 07-10 este párrafo decía que el fallo estaba latente porque no había forma de
recrear nada; ahora la hay, y es la forma de comprobar cualquier migración nueva.

**`enlaces_token`** — firmar y confirmar **sin tener cuenta** (`20260928100300`): `proposito`
(`firma_convenio`·`confirmacion_albaran`·`subida_factura`), `objeto_tipo` + `objeto_id`,
`destinatario_email`, `canal` (`email`·`asistido`), **`token_hash` UNIQUE**, `codigo_hash`,
`caduca_at`, `abierto_at`, `usado_at`, `estado`, `recordatorios`, `ultimo_recordatorio_at`.
Índice parcial `(caduca_at) where estado='activo' and usado_at is null` (el de los recordatorios
de 7/14 días). **El token en claro solo existe en el correo**: en la base queda el sha256 de 32
bytes aleatorios, como una contraseña. `canal='asistido'` es el enlace que abre el dinamizador
delante de la persona (modelo asistido, §1bis), no un atajo.

⚠️ **`canal='panel'`** (`20270318100000`) lo acuña el propio titular desde su panel con
`acunar_enllac_propi()`, y **caduca en 1 hora**, no en 30 días: se consume al momento —el
frontend navega con él— pero la firma se comprueba en el POST, y rellenar un convenio puede
pasar del cuarto de hora. Los tres canales se imprimen **distintos** en la página de
evidencias del PDF: decir «firma asistida» de una firma propia, o «por correo» de una hecha
desde el panel, sería afirmar algo falso en un documento legal.

⚠️ **`enlaces_token.rol_parte`** (`entrega`/`recibe`, nullable, `20270304100200`) dice de qué parte
del albarán es cada enlace, con el mismo vocabulario que `albaranes.partes`. Existe por el **OPE**,
que crea **dos** enlaces —el generador entrega, la entidad recibe— y hasta ahora quedaban
indistinguibles (deuda 68). Los enlaces anteriores se quedan a `null` **y no se rellenan**: en REC y
ENT la parte se deduce del tipo, y un dato inventado en una tabla de evidencia vale menos que un
hueco. Lleva **`grant select` de columna propio**: en una tabla con GRANT por columnas, una columna
nueva no hereda nada.

**`evidencias`** — lo que hace que una firma propia valga algo: `enlace_id` (FK cascade), `tipo`
(`apertura`·`firma`·`confirmacion`·`subida`·`codigo`), `nombre`, `cargo`,
**`documento_identidad`**, `declaracion_representacion`, `trazo_firma_ruta`, `ip inet`,
`user_agent`, **`sha256_texto`** (huella del texto EXACTO que se aceptó: sin ella, «firmó» no dice
qué firmó), `payload jsonb`, `asistido_por`. No se borran nunca.

**`resolver_enlace(token_hash)`** — `security definer`, EXECUTE **solo `service_role`** (quien la
llama no tiene sesión: lo que autoriza es tener el token). Devuelve la fila **sin las
credenciales** —`tiene_codigo boolean` en vez de `codigo_hash`— más **`estado_efectivo`**
calculado al vuelo. **La caducidad no se guarda, se calcula**: si hubiera que escribirla, entre el
instante en que vence y el instante en que un job la marca el enlace seguiría funcionando. 0 filas
si el hash no coincide, y quien llama decide si eso es 404 o 410.

**`parametros_documentales`** — fila única (`id int pk check (id = 1)`, `20260928100400`) con los
datos de Espigoladors que encabezan todos los documentos y los umbrales del circuito
(`caducidad_enlace_dias` 30, `caducidad_confirmacion_dias` 15, `tolerancia_conciliacion_pct` 2,
`plazo_conciliar_sin_confirmacion_dias` 7, `fecha_corte_convenios`, `cierre_apertura`,
`cierre_provisional`). **No es `app_settings`** porque aquí hacen falta tipos: un `'2%'` mal
escrito en clave/valor no lo detecta nadie hasta que una conciliación decide mal. RLS: select
`es_intern()`, update `es_super_admin()`. `apoderada_dni` se **escribe pero no se lee** (GRANT de
UPDATE sí, de SELECT no), que es la asimetría correcta para ese dato. **Hoy está sembrada con
valores provisionales explícitos**: cada campo dice `PROVISIONAL — pendent de …` dentro del propio
texto (así sale impreso si alguien emite antes de tiempo), `cif = 'G00000000'` **no es un CIF
válido** a propósito, y `apoderada_dni`/`email_equipo` quedan NULL porque ninguna migración pone
datos personales en git. La columna **`datos_provisionales`** lo hace comprobable por código.

**`codis_postals`** (`20270328100000`) — **código postal ↔ municipio**, muchos a muchos:
`(codi_postal, codi_ine)` como clave, con FK a `municipios`. Del portal oficial de datos
abiertos de la Generalitat, conjunto «Codis postals per municipis de Catalunya»
(`analisi.transparenciacatalunya.cat`, id `tp8v-a58g`, descargado el 16-09-2026). **1.412
parejas y 1.132 códigos postales**, y **los 947 municipios de la tabla tienen alguno** —
comprobado antes de sembrar. Va en git por lo mismo que `municipios`: dato público sin nada
personal (§7). **No es un servicio externo**: es un fichero que se baja una vez; la
aplicación no llama a nadie en ejecución, y actualizarlo es otra migración.
⚠️ **Un CP no siempre es un municipio, y eso manda en la interfaz**: 936 de los 1.132 (82 %)
apuntan a uno solo —ahí `SuggerimentPoblacio` rellena sin preguntar— y 196 a varios, donde
**se ofrece a elegir**. Poner el primero sería escribir un dato que nadie ha dicho, y encima
parecería confirmado. Tampoco pisa una población ya escrita: la ofrece como sugerencia.
⚠️ El `codi_municipi` del CSV trae **seis** cifras (INE + dígito de control) y se guarda
recortado a cinco. Los centinelas `99998 No consta` y `99999 Altres/Diversos` se descartan.

**`municipios`** — el nomenclátor oficial (`20260928100500`): `codi_ine` (5 dígitos, **texto y no
int** porque los de Barcelona empiezan por 0), `nom` (forma oficial con artículo pospuesto:
`Ametlla del Vallès, l'`), `comarca`, `provincia`. **947 municipios y 43 comarcas** (Moianès y
Lluçanès incluidos), cruzados entre la API de IDESCAT y el dataset «Municipis Catalunya Geo» del
portal de datos abiertos: los 947 códigos y los 947 nombres coinciden en las dos fuentes, así que
no hay ninguna fila reconciliada a mano. Es dato público sin nada personal, así que **sí va en
git**, al revés que `scripts/data/` (§7). `productor_ubicaciones.municipio_ine` (nullable) **nace
nula en las 12 ubicaciones que hay**: casar el texto libre es un script aparte con ambigüedades
reales. Existe para dos cosas que hoy no se pueden hacer: que el «mismo municipio +2» de la
priorización deje de comparar cadenas, y que el albarán de entrega diga municipio y **comarca** de
origen sin nombrar al donante (D3).

**Jobs** (`20260928100700`, cierra la deuda 49) — trigger `documentos_encola_generacion`
(`after insert on documentos` → `net.http_post` a `generar-documento` con `x-documentos-secret` de
`app_config`) y dos de `pg_cron`: `documentos-pendientes` (`*/5 * * * *`, reencola
`pendiente_fichero`/`error` con `fichero_at is null` e `intentos < 5`, `limit 50`) y
`recordatorios-documentales` (`0 7 * * *`). **Hacen falta los dos, trigger y job**: solo el
trigger, un `net.http_post` perdido deja un documento sin PDF para siempre y nadie se entera; solo
el job, quien acaba de pulsar «Emet» mira cinco minutos una pantalla que dice «Generant…». El tope
de 5 intentos es deliberado: lo que falla cinco veces (una plantilla rota, un parámetro que falta)
no se arregla repitiendo. **Sin el secreto en `app_config`, los tres disparadores son no-op con
`notice`**, que es lo que permite emitir documentos de prueba sin que nada salga a la red.

⚠️ **Dos contadores, porque son dos fallos distintos** (`20270302100000`, §12.89). `intentos` son
las generaciones que fallaron **y lo dijeron** (lo sube `marcar_documento_error()`); `reencolados`,
las veces que el job lo intentó **conteste alguien o no**. El segundo existe porque un corte por CPU
mata el isolate sin dejar que se reporte nada: con solo `intentos`, ese documento se quedaba en 0
para siempre y el job lo reencolaba cada 5 minutos indefinidamente. Al agotarse cualquiera de los
dos topes, el job **lo da por perdido**: lo pasa a `error` con el motivo escrito, y así el caso
invisible entra por la misma puerta que ya existía —contador del menú, filtro y tooltip— sin
inventar un estado nuevo. **`estado = 'error'` con `intentos = 0` es la firma de «nadie contestó»**,
y la interfaz la deduce sin ningún marcador (badge «Encallat», `doc.st_encallat`).

**GRANT**: `authenticated` tiene `SELECT` completo en `documentos`, `documento_envios`,
`series_documentales`, `plantillas_documento` y `municipios`; `INSERT`/`UPDATE` (sin DELETE) en
`plantillas_documento`; y **`SELECT` y `UPDATE` por columnas** en `parametros_documentales`, más
`SELECT` por columnas en `enlaces_token` y `evidencias`. ⚠️ Lo del **UPDATE por columnas** es cierto
solo desde `20270325100000` (§12.104): hasta entonces la tabla arrastraba además un `UPDATE` de
tabla de los privilegios por defecto, que **subsume** al de columnas — o sea que esa frase describía
la intención y no lo que concedía la base. **Ninguna escritura en `documentos`,
`documento_envios`, `series_documentales`, `enlaces_token`, `evidencias` ni `municipios`**: la
superficie de escritura son las RPC `security definer` y `service_role`.

**Albaranes (fase 3, `20261012*`)** — `albaranes` (**REC** entrada del generador · **ENT** entrega
a la entidad · **OPE** venta o maquila) y `albaran_lineas`, donde viven **los kilos oficiales**
(`kg_bruto` / `tara_kg` / `kg_neto`, y `kg_previstos` / `kg_confirmados` / `kg_validados`); solo
`kg_validados` cuenta para indicadores y certificados (D13). **Sin ninguna columna de importe, a
propósito** —en un albarán no hay dinero— y el arnés lo comprueba esperando `42703`. ⚠️ Desde el 11-10-2026 el **PDF** del REC de donación sí imprime valor por kilo e importe (modelo de Espigoladors), calculados al renderizar desde el snapshot: la tabla sigue sin un euro (§6ter, fase 3). El número se
pide al **emitir** (`siguiente_numero`), nunca en borrador: un borrador descartado no deja hueco en
la serie. `partes` congela quién entrega y quién recibe, así que si luego cambia una ficha el
albarán no cambia. Estados: `borrador → emitido → entregado → confirmado → conciliado`, con
`anulado` y `rectificado` como salidas.

⚠️ **Un albarán nace por TRIGGER** (`canalizaciones_crea_albaranes`), no por una llamada, porque
`canalizaciones` se inserta desde más de un camino: la RPC `aprovar_resposta`, las tres llamadas
sueltas de `OfferDetail` (deuda 19) y ahora el reparto de una espigolada. El trigger **no** crea REC
para registros de espigolada —la jornada ya tiene el suyo—: sin esa excepción, el reparto duplicaba
la entrada y la conciliación contaba dos veces.

**`espigoladas`** agrupa una jornada de espigueo: sus registros son `excedentes` con
`origen='espigolament'` y su REC cuelga de `espigolada_id`.
✅ **Se cierra sola** (`20270406100300`, 28-09-2026): el trigger `canalizaciones_estat_espigolada`
pasa la jornada a `tancada` cuando cada registro tiene canalizaciones que suman al menos su
`kg_total` (`kg_confirmados`, la cuenta de la ficha) y la **reabre** si vuelve a quedar algo,
porque `repartir_espigolada()` solo admite jornadas `oberta`. Por trigger y no dentro del reparto:
las canalizaciones se tocan desde más de un camino. `recalcula_estat_espigolada()` no la puede
llamar nadie con sesión (el arnés lo vigila). Antes nada escribía `tancada`. Desde `20260921221806` guarda además
**`oferta_origen_id`**: de qué oferta «producte al camp» nació, cuando nació de una.
🔴 **Con `on delete set null`, y no es estilo**: `borrar_ficha_completa()` borra `excedentes`
**antes** que `espigoladas`, así que con el `no action` por defecto la **única puerta de borrado de
una ficha** (§7) habría quedado rota con `23503` para cualquier productor con una oferta convertida
— y no se puede arreglar reordenando aquella función, porque editar una migración aplicada está
prohibido. El enlace es trazabilidad, no evidencia fiscal: lo que certifica es el REC. `documentos_externos` (polimórfica) guarda lo que
aportan terceros: el albarán del productor, la factura del donante, fotos de incidencias. Desde
`20270329100000` cuelga además de un **`convenio`** y de la **ficha misma** (`productor`/`entidad`),
con tres tipos nuevos —`conveni_signat`, `certificat_previ`, `pla_previ`—: es el archivo anterior a
Redestina, que la Fundació ya tenía en papel.
⚠️ La rama `convenio` llevaba **meses medio puesta y rota**: `puc_pujar_document_extern()` y la
política de lectura la admitían desde `20270111100100`, pero el CHECK de la columna no, así que un
insert moría con `23514`. Lo cierra esa misma migración.
🔴 **Sobre una FICHA sube SOLO el equipo, y la lee también la organización.** Es la única rama con
esa asimetría —en albarán, cierre y convenio sube el titular—, y es deliberada: esto no es algo que
la organización aporte, es archivo que la Fundació guarda **sobre** ella. La decide
`puc_pujar_document_extern()`, no la Edge Function.
⚠️ **Y desde el 22-09-2026 un externo por fin se puede volver a ABRIR**: `descargar-documento`
acepta `{documento_extern_id}` y autoriza con **`puc_veure_document_extern()`** (§4bis). Hasta ese
día un externo se subía, se listaba y no lo descargaba nadie —esa función solo servía `documentos`—,
y `AlbaraDetall` los pintaba como texto sin botón. Guardar un certificado para que el productor lo
tenga no significa nada si no se puede bajar.

**`tipos_caja`** (con `tara_kg`) y **`costes_producto`** (+`costes_producto_hist`, con motivo
obligatorio en cada cambio).
🔴 **Desde el 27-09-2026 (`20270405100200`) `costes_producto` es el coste de REFERENCIA, uno por
producto y SIN ejercicio** (PK `producto`; el histórico conserva el año de las filas viejas). Quien
decide el coste de cada oferta es el **productor**, al publicarla (`excedentes.coste_kg`, panel y
WhatsApp, §6bis), partiendo de esta referencia. La canalización copia **al crearse** el de la oferta
o, si no hay, la referencia vigente (`trg_canalizaciones_valoriza`), y lo congela al conciliar;
`conciliar_albaran()` y `conciliacion_retroactiva()` hacen la misma cascada si llegan sin coste.
**Cambiar la referencia afecta solo a lo que se cree después** (decisión del cliente). **Sin
ninguno de los dos queda `null` y eso bloquea el cierre**, que es justo lo que se quiere —con el
1 €/kg plano de `productos.eur_kg` el bloqueo no saltaría nunca—. Lo fiscal no se movió: el cierre
y los certificados leen `canalizaciones.coste_kg`, nunca `costes_producto`.
⚠️ Hasta ese día el arnés fijaba y borraba un coste de Tomàquet «en 1999» en cada pasada; con una
fila por producto habría **sobrescrito y borrado el coste real**. Su check ahora autoriza sin
escribir (coste 0 → `22023`), y las 79 filas de histórico que dejó se borraron en la migración. `tipos_caja` nace **sembrada provisional y
desactivada** hasta que la Fundación dé la lista de taras.

Vista `v_albaranes_bandeja` (`security_invoker`) para la bandeja del equipo. Desde `20270406100100` (28-09-2026), un albarán **sin oferta** —el REC de una espigolada— toma el `producto` de sus líneas (los distintos, separados por coma) y, desde `20270406100200`, el `productor_id` de la jornada (`espigoladas`); antes los dos salían «—». GRANT: solo `SELECT` en
todas; `tipos_caja` es catálogo para cualquier autenticado, `costes_producto` solo `es_intern()`.

**`planes_prevencion` (fase 5, `20270301*`)** — el plan de prevención de una organización. Clave
excluyente `productor_id`/`entidad_id` como `convenios`, `respuestas jsonb`, `nivel`
(`basic`/`personalitzat`), `version`, `vigente`, `estado` (`esborrany`→`emes`→`substituit`), y la
numeración `PLA` pedida **al emitir**. Índices únicos parciales: **un vigente y un borrador** por
organización. Sin GRANT de escritura: todo por RPC. ⚠️ **El cuestionario real no existe** —es el
anexo B del funcional, material de la fase 0—, así que `respuestas` es un sobre
`{questionari, versio_questionari, respostes[], notes}` del que la base solo impone la forma;
`versio_questionari = 0` marca las filas hechas antes de que ese anexo exista. El plan se descarga
**al momento**: `documentos.envio` va `null` y quien lo pide hace polling.

**Diagnóstico y plan de prevención (F2, `20260921231946`…`231950`)** — **el cuestionario por fin
existe**. `questionaris_diagnostic` (`tipo_org`, `versio`, `provisional`, `vigente`, `titol jsonb`,
`preguntes jsonb`) guarda el catálogo de preguntas, versionado y validado por `questionari_valid()`
desde un CHECK; único parcial `(tipo_org) where vigente`, trigger de inmutabilidad en cuanto un plan
lo referencia, y **sin GRANT de escritura para nadie**: se publica con `publicar_questionari()`, que
retira la versión anterior en la misma transacción. RLS `vigente or es_intern()` — la organización
tiene que poder leer lo que va a contestar.

`mesures_prevencio` (catálogo, `codi` PK) y `regles_pla` (`pregunta → mesura`, con la gramática
`sempre|=|!=|in|conte|>=|<=|buit`) son la regla de negocio **en tabla**, como `convenios_exigidos`:
cambiarla es un `insert`. Lectura `es_intern()`, escritura `pot_aprovar()`, **sin delete** — una
medida se retira con `activa = false`, porque un plan emitido cita su código. La FK de `regles_pla`
es **compuesta** `(mesura_codi, tipo_org)`: una regla de productor no puede apuntar a una medida de
entidad. `planes_prevencion` gana `questionari_id` y **`mesures jsonb`**, las dos dentro de la lista
congelada de su trigger de control.

🔴 **Las respuestas y las medidas se guardan AUTOCONTENIDAS**: el sobre lleva el texto de cada
pregunta y de cada opción en ca y es, y cada medida su título y su descripción **ya resueltos al
idioma del plan**. Es el principio de `documentos.datos`: un plan de hace cinco años no puede
depender de que su cuestionario siga vigente, ni de que quien lo lee pueda leer `mesures_prevencio`,
que es del equipo.

🔴 **La generación del plan va en SQL, no en TypeScript.** Las reglas viven en tabla, la evaluación
es un join más un `jsonb_agg`, y —lo que lo decide— guardar el diagnóstico y generar su plan son **la
misma transacción**. Calculándolo fuera existiría un instante con un diagnóstico contestado y un plan
que dice otra cosa, y si la segunda llamada falla ese instante se queda para siempre.

🔴 **Solo las medidas de REGISTRO nacen obligatorias** (`registre_quantitats` en el generador;
`registre_entrades` y `registre_destinacions` en el receptor — verificado en la base: 3 de 20). Es lo
único que Redestina puede pedir con cara seria mientras el cuestionario sea provisional, y lo único
que el servicio necesita de verdad para medir. Todo lo demás se recomienda. **Lo sostiene el seed, no
un check**: el día que la fase 0 entregue el anexo B, la Fundación podrá declarar obligatoria otra
medida sin una migración — que es para lo que existe esta tabla.

✅ **Y el del PRODUCTOR ya tiene contenido real: versión 1** (`20270403100000`, 27-09-2026), con
las preguntas de la revisión funcional del 23-09 en cuatro secciones —A. Producció, B. Generació
de l'excedent, C. Gestió actual, D. Necessitats i oportunitats (`produccio`, `generacio`,
`gestio`, `necessitats`, añadidas a `SECCIONS_CONEGUDES`)—: 15 preguntas, 7 obligatorias.
Conserva los ids que ya existían donde la pregunta es la misma (`causes`, `canals_actuals`,
`volum_anual_perdut`, `transport_propi`, `registre_quantitats`), así que sus reglas siguen
valiendo; las 5 reglas de preguntas que desaparecen se **desactivan** (no se borran) y entran 7
nuevas. Resultado: 20 reglas activas y **cero huérfanas**. Probado con Mas de Prova: un
diagnóstico completo genera un plan de 8 medidas por 11 reglas, todas coherentes.
⚠️ **Sigue provisional**, y el PDF lo dice: las categorías de «Quin suport necessiteu» son del
Airtable de la Fundació y no las tenemos. Y **el motor obligó a cuatro adaptaciones** que hay que
revisar con ellos: productos por **familia** (no los 90 del catálogo), «los principales» y «los que
más excedente dan» como listas completas (no se construyen opciones a partir de otra respuesta),
un único volumen anual en kg (no por producto) y la temporalidad como doce meses.
✅ La segunda, a medias desde el 28-09-2026: «els principals» y «els que més excedent donen»
enseñan **solo las familias marcadas** en «Quins productes produïu?» (`opcionsVisibles()` en
`diagnostic.ts`, mapa `OPCIONS_DERIVADES`, con prueba). Es solo pantalla: el servidor sigue
aceptando cualquier opción, y lo ya elegido se queda visible aunque se desmarque arriba.
✅ **El editor de Configuració lo enseña** (28-09-2026): las reglas cuya pregunta ya no está en el
cuestionario vigente llevan «Pregunta retirada» y van al final, y una medida activa que ninguna
regla viva propone lleva «Cap regla la proposa» — hoy, `cadena_fred_minima` del productor, que
se quedó sin regla al retirar `capacitat_fred` en la versión 1. Antes, además, la regla
`sempre` salía «sempre sempre».
✅ **Y el PDF del plan ya conoce esas cuatro secciones** (28-09-2026, `render/pla.ts`): hasta
entonces el primer plan emitido con la versión 1 habría impreso «produccio» o «generacio» como
título de las respuestas, en un orden cualquiera. Comprobado renderizando en local el borrador de
Mas de Prova, sin emitir. De paso, el distintivo OBLIGATÒRIA/RECOMANADA tiene un ancho fijo (el
del más largo) y la columna de títulos de las medidas ya no sale torcida.
⚠️ **El del receptor sigue en la versión 0**: la revisión dice que su diagnóstico va «solo cuando
corresponda a prevención y gestión de excedentes», sin contenido.

⚠️ **El cuestionario sembrado es PROVISIONAL** (12 preguntas por tipo, 20 medidas, 32 reglas,
`versio 0`, `provisional = true`), con el mismo criterio que los seis convenios: texto de trabajo
marcado como tal para poder recorrer el circuito antes de que llegue el anexo B. Se sustituye
**publicando la versión 1**, no editando la 0: editar un cuestionario que ya ha generado
diagnósticos está prohibido por trigger. `plan_datos()` lleva `questionari_provisional` para que el
PDF lo diga impreso.
⚠️ **Y ese marcador NO es `versio_questionari === 0`**, que es lo que miraba el renderizador hasta
la F2: el seed **es** la versión 0 y **sí** tiene preguntas, así que el texto «el qüestionari encara
no està definit» pasaría a ser falso. Lo que hay que decir es que el cuestionario es texto de
trabajo sin validar, no que no exista.

⚠️ **`emitir_plan_basico()` exige ahora un diagnóstico completo** —ninguna obligatoria que aplique
sin contestar, y al menos una medida— **solo cuando el plan tiene `questionari_id`**. Los planes
anteriores a la F2 y los que entran por `guardar_plan_basico()` no lo tienen, y exigirles las
obligatorias de un cuestionario que nunca contestaron los dejaría sin poder emitirse jamás. Mismo
criterio que `20260921214526` con los datos provisionales.

**`cierres_donante.tipo`** — `donacio` (el CD, con importes y factura) · `transaccio` (el **CT**, de
venta y maquila, **sin importes**). Default `donacio`, que es lo que mantiene válidas las filas
anteriores. La clave pasa a `(cierre_id, productor_id, tipo)`: una organización puede donar **y**
vender el mismo año. El certificado de transacción **reutiliza el motor del cierre** en vez de
duplicarlo —hereda `cierre_emet_document()`, `cierre_destinatario()`, `ruta_documento()`, la RLS y
los puentes sin una línea nueva—; lo único que se duplica a propósito es la consulta base, porque
los kilos salen del **OPE** (1:1 con la canalización, sin el reparto proporcional que necesita el
REC). Un trigger `cierres_donante_tipo` impide cruzar los dos circuitos, y salta en el `update` que
pide el número, así que el rollback devuelve el número a la serie.

**Convenios y firma (fase 2, `20270111*`)** — `convenios` es el convenio de colaboración de una
organización con su ciclo de firma. `tipo` ∈ `don_gen`·`don_rec`·`com`; clave **excluyente**
productor **o** entidad, como `membresias`; `estado` ∈ `esborrany`→`pendent_firma`→`firmat`→`vigent`,
con salidas `retornat`, `resolt` y `substituit`. Índice único parcial
`(coalesce(productor_id, entidad_id), tipo) where estado = 'vigent'`: **una organización tiene como
mucho un convenio vigente de cada tipo**. El número se pide **al firmar**, no al preparar, así que un
borrador descartado no deja hueco. `datos_org` es la copia congelada de la ficha y `firmante` quién
firmó: ⚠️ **ninguno de los dos lleva DNI** —el documento de identidad vive solo en
`evidencias.documento_identidad`, fuera del GRANT (§4)—. Sin GRANT de escritura para nadie. Triggers
`convenios_control` (inmutabilidad desde `firmat` y transiciones válidas) y `convenios_no_esborrar`.

✅ **Y un tercer origen, `declarat`** (`20270430100000`, 27-10-2026): vigente **sin firma ni papel**, con número de su serie y un PDF cuya página de evidencias lo dice («donat per vigent per l'equip (nom) el dd/mm en nom de X»). Lo da `declarar_conveni()` (§4bis), solo el super_admin. `conveni_cobreix_tot()` no lo cuenta, así que la organización puede firmar el suyo desde el panel y la contrafirma lo deja `substituit`. El check `convenios_numero_segons_estat` le exige número, `firmado_at` y `declarat_per`.

🔴 **`origen`** (`plataforma`/`paper`) y **`referencia_paper`** (`20270329100100`…`100300`) — el
convenio **firmado fuera de la plataforma**, que el super_admin registra desde la ficha y que **vale
igual para operar**: `convenio_vigente()` y `exigir_convenio()` no se tocan, porque miran
`estado = 'vigent'` y nada más. Existe porque desde el 16-09-2026 la fecha de corte está encendida y
una organización con su convenio firmado en papel **no podía operar**: la única salida era volver a
firmarlo electrónicamente una por una.
⚠️ **NO consume número de serie**, por decisión del 22-09-2026: las series numeran lo que Redestina
emite, correlativo y por ejercicio, y un papel de 2023 con número de 2026 rompería lo que esa
correlatividad significa. Por eso el check `convenios_numero_segons_estat` se recreó eximiendo al
papel y exigiéndole a cambio `referencia_paper` y `firmado_at`.
⚠️ **Una transición nueva y solo una**: `esborrany → vigent`, **solo si `origen = 'paper'`**. No pasa
por `pendent_firma` ni por `firmat` porque esos estados significan «hay un enlace vivo» y «alguien ha
firmado aquí», y ninguna de las dos cosas es cierta; fingir el recorrido dejaría un rastro de estados
que nunca ocurrieron. `origen` y `referencia_paper` entran además en la lista congelada del trigger.
🔴 **No se emite ningún `documentos`.** El PDF que compone Redestina lleva su página de evidencias
—huella del texto aceptado, IP, trazo de la firma— y aquí no hubo ninguna: emitirlo sería imprimir
una afirmación falsa. Lo que acredita es el escaneado, que va a `documentos_externos` con
`tipo = 'conveni_signat'`, y la RPC **se niega si no está subido ya** (`falta_escanejat`): un
convenio no puede quedar vigente con el papel «pendiente de adjuntar».

**`convenios_exigidos`** — matriz oferta↔convenio **en tabla**, como `modalitat_receptor_compat`:
`(valorizacion, parte, tipo_convenio)`. La donación exige `don_gen` a quien entrega y `don_rec` a
quien recibe; venta y maquila exigen `com` a las dos partes. Cambiar la regla es un `insert`.
🔴 **Desde el 11-10-2026 (`20270420100000`) la matriz pide UN convenio por papel**, el de
col·laboració (`col_productor` a quien entrega, `col_receptor` a quien recibe) en las tres
modalidades; los anteriores valen por `convenis_equivalents` para lo que valían (§6ter, fase 5).

**`plantillas_documento.variante`** (`don_gen`·`don_rec`·`com` o null) — los tres modelos comparten
el tipo `CONV`, y el índice `(tipo, idioma) where vigente` solo dejaba uno vigente: ahora es
`(tipo, coalesce(variante,''), idioma)`.

⚠️ **El texto de los seis convenios NO está validado por la asesoría.** `20270111100200` siembra
texto de trabajo completo, marcado como borrador en tres sitios (primer bloque, título y pie), para
que el circuito de firma se pueda probar antes de que la fase 0 entregue los textos definitivos.
Sustituirlo es publicar la **versión 2** desde la pantalla y retirar la 1: editar una plantilla que
ya ha emitido algo está prohibido por trigger.

**Cierre anual (fase 4, `20261109*`)** — `cierres_ejercicio`, `cierres_donante` y
`cierre_donante_lineas`. **`modo` (`prueba`/`real`) vive en el dato**, con un único parcial
`(ejercicio) where modo = 'real'`: varios ensayos por año, **un solo cierre real**.
`cierres_donante` guarda el acumulado del donante (kg, valor, `bloqueos jsonb`, `resumen_numero`,
`certificado_numero`, la factura citada y la excepción de D4) y `cierre_donante_lineas` el detalle
**congelado** por canalización, con `albaran_rec_id` y la marca `retroactiva`.

`bloqueos` = `[{codigo, detall, bloqueja}]`. Bloquean de verdad `sense_conciliar`, `sense_cost` y
`dades_fiscals`; `sense_rec` y `certificat_desactualitzat` solo avisan. ⚠️ `sense_rec` **no puede
bloquear**: las canalizaciones de 2026 que ya existen no tienen albarán, y con un bloqueo el ensayo
del plan sería inejecutable. Lo que las separa del cierre real es `retroactiva`, que `cierre_base()`
excluye cuando `modo = 'real'`.

**Ninguna de las tres tiene GRANT de escritura para nadie**: todo entra por RPC. RLS `es_intern()`, y
el donante ve su fila por `cierres_donante_meus()` —los cierres de **prueba** solo si su ficha es
`es_test`, para que un donante real no se encuentre en su panel un acumulado sin valor fiscal—.
Series `P-RES`/`P-CD` en prueba; `reiniciar_cierre_prueba()` las devuelve a 0 **sin tocar
canalizaciones ni albaranes**. ⚠️ Desde `20270430100400` (deuda 145) no a 0 a secas: al **último número
que siga vivo** en esa serie y año, porque puede haber varios cierres de prueba del mismo ejercicio y
reiniciar uno no puede dejar el contador por debajo de los documentos del otro.

⚠️ **El 28-09-2026 se retiró a mano un cierre REAL de 2026** abierto el 21-09 y nunca calculado
(0 donantes, 0 documentos, series `RES`/`CD`/`CT` de 2026 a 0): un `delete` con esas mismas
condiciones en el `where`. **Cerrarlo habría sido irreversible**: `cerrar_cierre()` recalcula
—y en modo real habría metido las donaciones de las fichas de prueba en el cierre fiscal—, lo
deja `tancat` para siempre y el único parcial `(ejercicio) where modo = 'real'` impediría abrir
otro. No hay RPC para retirar un cierre real vacío; si vuelve a pasar, el mismo `delete`
condicionado. Y conviene no abrir el real hasta que toque de verdad (D1).

Job `congelar-ejercicio` en `pg_cron` a `59 22 31 12 *` **UTC**, que son las 23:59 de Madrid en
horario de invierno.

✅ **Y desde el 21-09-2026 el certificado a demanda TIENE PANTALLA**, que es lo que le
faltaba: `CertificatsFitxa` vive en el slot `avisos` de la ficha de la entidad productora
—junto a `BadgeConveni`— y desde ahí se emite con `DialegCertificatPeriode`. Antes el
backend estaba entero y **no lo llamaba nadie**: la única forma de emitir uno era SQL a
mano. ⚠️ **Calcular ya ESCRIBE**: `calcular_certificado_periodo()` inserta la fila antes de
que nadie decida emitir, que es lo que permite enseñar kilos y bloqueos primero; el precio
es que probar tres ventanas deja tres borradores sin número (§12.112). ⚠️ **El modo no se
elige, se deduce de `es_test`**: un desplegable prueba/real ahí sería la forma de mandarle a
un donante real un certificado con marca de agua, o al revés.

**Certificado a demanda (`20270303*`)** — `cierres_periodo` y `cierre_periodo_lineas`: el mismo
acumulado de un donante, pero de una **ventana de fechas** dentro de un ejercicio. Tabla hermana y
no un `tipo` más de `cierres_donante`, por dos cosas que no se pueden forzar: aquella cuelga de
`cierres_ejercicio` —de donde salen modo y ejercicio, y un certificado a demanda **no abre cierre**,
menos aún el real— y su clave `(cierre_id, productor_id, tipo)` dejaría **uno** por año, cuando un
donante puede pedir varios. Serie propia **`CDP`** (+`P-CDP`), nunca la del anual: los números del
182 son correlativos y solo del cierre. **El documento se emite con `documentos.tipo = 'CD'`** —el
renderizador se elige por `tipo`, y `cd.ts` ya imprimía un periodo—, así que lo que lo distingue es
la serie y `objeto_tipo = 'cierre_periodo'`, el séptimo. Se archiva en la carpeta `CD/` del donante.

🔴 **LA FACTURA YA NO CONDICIONA EL CERTIFICADO** (`20260921211329`, decisión del cliente del
21-09-2026). Hasta esa fecha `emitir_certificado()` exigía una factura del donante que cuadrase
**al céntimo** con el valor calculado, o la **excepción de D4**: `es_super_admin()` más un motivo
que se imprimía en el PDF. Ahora se emite sin ella. La factura se sigue registrando si llega, y
`discrepancia` pasa de bloqueo a **aviso** — en el panel es ámbar, no rojo.

⚠️ **Lo que NO se relajó, y es lo que impide que esto sea un agujero**: el certificado solo
**cita** la factura cuando `round(factura_importe, 2) = round(valor_total, 2)`. Si no cuadra, el
PDF imprime «Certificat emès sense factura del donant» y no la nombra. Un certificado que dijera
12.340,00 € citando una factura de 11.900 € afirmaría dos cifras incompatibles en un papel con
efecto fiscal, que es justo lo que la regla vieja evitaba; lo que se ha retirado es el **bloqueo**,
no la coherencia.

⚠️ **`p_motivo_excepcion` sigue en la firma de las dos RPC y SE IGNORA.** Se conserva porque
`src/lib/tancament.ts` y el arnés la llaman, y cambiar la firma rompería a quien ya la usa; pero
`excepcion_sin_factura` no se vuelve a escribir desde ninguna parte. Las columnas `excepcion_*` y
su rama en `render/cd.ts` **se quedan para los documentos históricos**: `documentos` es inmutable
y los que se emitieron así tienen que seguir imprimiéndose como lo que son. Queda anotado como
decisión con su precio en §12.111.

✅ **Y aparece la emisión en bloque**: `emitir_certificados_cierre(cierre)` (`20260921211356`)
recorre los donantes de un cierre **`tancat`** y emite uno a uno, cada uno en su subbloque
`begin/exception`, devolviendo `{emesos, ja_tenien, saltats[{cd, donant, codi, motiu}]}`. **No la
llama `cerrar_cierre()` ni el job de `pg_cron` de fin de año, a propósito**: cerrar ya es el acto
irreversible, encadenarle la emisión quitaría el momento de revisar la lista, y el job corre a las
23:59 del 31 de diciembre **sin sesión**, así que emitiría N documentos legales con la autoría en
blanco y nadie mirando.

**El anual manda.** `emitir_certificado()` deja los parciales del mismo donante y ejercicio en
`substituit`, con su documento `vigente = false` y `sustituido_por` apuntando al anual; y
**`datos_182()` sigue leyendo solo el cierre anual**, o la gestoría recibiría filas duplicadas. Entre
parciales rige lo mismo: uno que **contenga** a otro lo sustituye —es el caso normal, «lo de este año
a fecha de hoy» repetido— y un solapamiento **a medias** lo bloquea `periode_encavalcat`.

⚠️ **El texto de alcance va en el CUERPO del PDF, no en una marca de agua**: un certificado a fecha
intermedia es un documento válido de otra cosa, no un borrador. Entra por `plantillas_documento` con
la variante **`parcial`** del tipo `CD` (`20270303100200`; texto de trabajo **no validado por la
asesoría**, marcado como borrador en tres sitios igual que los convenios), y por eso
`emitir_certificado_periodo()` se niega si esa plantilla no está vigente: sin ella el PDF saldría con
el cuerpo del certificado anual y afirmaría algo que no es cierto.

**Certificado de recepción (`20260921223245` / `…223246`)** — `cierres_receptor` y
`cierre_receptor_lineas`: los kilos que una **entidad receptora** ha recibido en una ventana de
fechas, **donación y compra juntas**. Sirve para acreditar sostenibilidad ante terceros; **no es un
documento fiscal**, no va al 182 y **no tiene ni una columna de importe** —igual que
`albaran_lineas`, y el arnés lo comprueba esperando `42703`, que es la única forma de verificar una
ausencia—. Tabla propia y no un `tipo` más de `cierres_donante` porque el eje es `entidad_id` y
porque **no abre cierre**. Serie propia **`CR`** (+`P-CR`) y `objeto_tipo = 'cierre_receptor'`, el
**octavo**. Se archiva en `entitats/<entidad_id>/<ejercicio>/CR/`. `documents_meus()` gana su rama;
`puede_ver_documento()` no se toca porque delega en ella.

⚠️ **Los kilos salen del ENT (donación) o del OPE (venta/maquila), que cuelgan 1:1 de la
canalización**, así que aquí **no hay reparto proporcional** y por tanto tampoco el bloqueo
`periode_parteix_excedent` que sí necesita el certificado del donante. Lo que sí hereda es
`periode_encavalcat`: dos certificados de la misma entidad que se solapen a medias acreditarían los
mismos kilos dos veces ante dos terceros distintos.

🔴 **Las dos mitades del papel NO se imprimen igual, y es decisión del cliente.** En **compra**
(venta y maquila) **sí se nombra al generador**: hay dos partes que ya han contratado entre ellas,
como en el albarán `OPE`. En **donación** rige D3 con todo su rigor —municipio y comarca, nunca la
organización— y eso **no lo sostiene un comentario, lo sostienen dos cosas**: el check
`cierre_receptor_lineas_d3_check`, que hace imposible guardar `productor_id`, `productor_nom` o
`productor_nif` en una línea de donación, y el tipo `ProcedenciaDonacio` de `render/cr.ts`, que **no
declara ninguna clave capaz de llevar un nombre** — así que imprimir al donante ahí no compila.
El check importa porque la entidad lee sus propias líneas por RLS (`cierres_receptor_meus()`): un
descuido no se quedaría en el PDF, **se serviría por la API**. Y las tablas **no guardan
`id_excedente` ni `excedente_id`** —ese formato filtra las tres primeras letras del productor (§9)—
ni `recogida.lugar` ni `responsable_origen`.
⚠️ Lo que esto **no** arregla: un municipio con un solo generador sigue siendo identificable, el
mismo límite que ya tiene el `ENT` desde la fase 3.

**Ninguna de las dos tiene GRANT de escritura**: todo por RPC. RLS `es_intern()` y el puente
`cierres_receptor_meus()` —los de **prueba** solo si la ficha es `es_test`, como
`cierres_donante_meus()`—. `reiniciar_recepcions_prova()` devuelve `P-CR` a 0 **sin tocar
canalizaciones ni albaranes** (comprobado al ejercitarlo: los 13 albaranes y las 8 canalizaciones
siguen ahí; las cifras que devuelve son lo revisado, no lo borrado).

⚠️ **El texto de la plantilla `CR` NO está validado por la asesoría** (ca+es, marcado como borrador
en tres sitios), igual que los convenios y el `CD/parcial`. Y `recepcio_emet_document()` pide la
plantilla con **`variante is null` y `order by version desc`**, no con un `limit 1` a secas: hoy solo
hay un modelo, pero ese `limit 1` es exactamente lo que en el `CD` podía imprimir el texto del
parcial en el certificado anual sin dar ningún error.

✅ **Ejercitado de punta a punta en modo prueba el 22-09-2026**: `calcular_certificat_recepcio` sobre
una entidad con entregas conciliadas devuelve sus kilos y sus bloqueos; con `sense_conciliar` puesto,
emitir **se niega** con `22023` y el motivo legible; sin bloqueos emite `P-CR-2026-0001` con su PDF
(3 páginas, 114 KB) en `entitats/<id>/proves/2026/CR/`. Limpiado después con
`reiniciar_recepcions_prova(2026)` y `limpiar-documentos-prueba`.

⚠️ **El reparto del neto del REC se calcula por `(coalesce(albaran_rec_id, excedente_id),
producto)`**, y esa clave es la invariante que hay que conservar si alguna vez se toca
(`20270320100000`): **por cada `(albaran_rec_id, producto)`, la suma de los `kg_neto` repartidos
es exactamente `rec_neto`**. El `producto` no es de adorno —un REC de espigolada con dos
productos tiene dos netos bajo el mismo albarán, y particionar solo por el albarán mezclaría dos
netos en un denominador—, y el `coalesce` tampoco: cuando `rec_neto` es null el id también lo es,
y todos los nulos caerían en una sola partición. La clave se calcula **una sola vez** en la CTE
`conrec` justo para que las cuatro ventanas que la usan no puedan volver a separarse, que es lo
que permitió que el fallo existiera. ⚠️ El SQL vivo está en **`20270303100500`**, no en
`20270303100000`: aquella se recreó con `create or replace` y la advertencia en prosa se quedó en
la vieja.

🔴 **El reparto del neto del REC estaba mal para cualquier ventana que no fuera el año entero.** Se
calculaba con `partition by excedente_id` **sobre las filas ya filtradas por fecha**, así que un
corte que partiera un excedente atribuía el neto ENTERO a las líneas visibles: kilos **inflados**, no
incompletos, en un documento con efecto fiscal. Medido: una ventana que dejaba fuera 40 de 1.000 kg
seguía diciendo 1.000. Desde `20270303100000` el reparto y el residuo se calculan sobre **todas** las
canalizaciones conciliadas del excedente y la fecha se filtra **después** (961,17 kg en ese mismo
caso); `cierre_base()` y `cierre_pendents()` pasan a ser envoltorios de las versiones por periodo,
para que no haya dos definiciones de «qué entra en un cierre». Como red, `cierre_base_periodo()`
marca `excedent_partit` y el certificado a demanda lo convierte en el bloqueo
`periode_parteix_excedent`, que **bloquea de verdad**: repartir un albarán entre dos certificados es
una decisión de negocio, no un detalle de cálculo.

🔴 **Y la base de cálculo la podía leer cualquier cuenta con sesión.** `cierre_base()` y
`cierre_pendents()` son `security definer` con GRANT a `authenticated` y **no comprobaban rol**, al
revés que sus vecinas `datos_182()` y `comparar_cierre_prueba()`: un productor o una entidad podía
llamar a `cierre_base(2026)` por PostgREST y recibir **la donación de todos los donantes** —nombre,
producto, kilos conciliados y coste por kilo, fila a fila—. No estaba en ninguna lista de deuda y el
arnés no lo miraba. Cerrado en `20270303100500` con el idioma de siempre
(`auth.uid() is not null and not es_intern()`, para no dejar fuera a `service_role`), y ahora lo
vigilan cuatro checks por cada cuenta externa.

⚠️ **Y un fallo silencioso que el seed de la plantilla habría introducido**: `cierre_emet_document()`
pedía la plantilla con `tipo` e `idioma` y un `limit 1` **sin mirar la variante ni ordenar**. En
cuanto existe una `CD`/`parcial` vigente hay dos plantillas vigentes de tipo `CD`, y ese `limit 1`
podía elegir cualquiera: **el certificado ANUAL podía salir impreso con el texto que dice que no
sirve para el 182**. No da ningún error; solo se ve leyendo el PDF.

⚠️ **CINCO columnas quedan fuera del GRANT de SELECT y ninguna política lo suple**:
`enlaces_token.token_hash`, `enlaces_token.codigo_hash`, `evidencias.documento_identidad`,
`parametros_documentales.apoderada_dni` y —desde `20270320100300`— **`documentos.envio`**. RLS no
sabe restringir columnas; el GRANT sí (mismo patrón que `perfiles`, §4bis). Consecuencia práctica:
**un `select('*')` sobre esas cuatro tablas responde `42501 permission denied for column`** — hay
que pedir columnas explícitas, y en un solo literal (§7).

⚠️ **`documentos.envio` es la única que un EXTERNO podía leer de verdad, y por eso se cerró**: el
sobre del correo lleva, en el resumen anual, **el token en claro** del enlace de subida de factura
(`emitir_resumen()`), y el donante ve su propia fila por `documents_meus()`. El mismo secreto que
`enlaces_token` guarda hasheado se servía en claro desde la tabla de al lado. Cuando se cerró no
había ninguno emitido (0 de 15 documentos), así que fue preventivo.
⚠️ **Corolario para quien añada una columna a `documentos`**: desde ese `revoke`, **toda columna
nueva nace sin SELECT** y hay que otorgarla a mano. Es la contrapartida del `alter default
privileges` de `20260721160000:66`, que actúa al crear la **tabla**, no al añadir una columna
(precedente: `enlaces_token.rol_parte`, `20270304100200:39`).

### Borrado de una ficha: un único camino, `borrar_ficha_completa()`

✅ **Desde `20260921153439` hay UNA puerta** (§4bis), y es la que aplica la regla de §7.
Hace, en una sola transacción: (1) comprueba los **bloqueos fiscales** —albaranes que ya no
son borrador, cierres anuales o a demanda, líneas de cierre que citan la ficha, convenios o
planes **con número**, y cualquier `documentos` emitido de esos objetos— y si hay alguno se
niega con `22023 bloqueig_esborrat: <codis>` **sin tocar nada**; (2) si no, arrastra lo
operativo en orden —adjuntos y enlaces de los albaranes en borrador, esos albaranes, las
sesiones de intake (antes que los excedentes, que las referencian), respuestas,
canalizaciones, ofertas, espigoladas, ubicaciones y los enlaces de firma de sus convenios—;
(3) borra la ficha, que arrastra en `CASCADE` convenios, membresías y planes; y (4)
**retira la organización si se queda sin ninguna ficha**. Con `tambe_germana` hace lo mismo
con la otra ficha del doble rol **dentro de la misma transacción**: o las dos o ninguna.

⚠️ **Las claves foráneas NO se cambiaron, y es deliberado.** «Poner `CASCADE` en todo»
sería lo contrario de la regla: se llevaría por delante cierres y líneas de cierre, que son
la evidencia fiscal que el circuito existe para conservar. Las `NO ACTION` se quedan y
pasan a ser la **última red** —si algún día la función se dejara un camino, la base rechaza
en vez de dejar un hueco—. Lo que cambia es que ahora hay una sola puerta, que comprueba
antes y **dice el motivo**.

⚠️ **Una cosa se queda fuera a propósito**: `wa_contacts`/`wa_messages` (no tienen FK a la
ficha, solo comparten teléfono —§ «Integridad»—, y el hilo documenta por qué se retiró;
se borra desde la papelera de Mensajería). `email_test_recipients` **ya no** se queda fuera:
desde el 22-09-2026 se purga en el mismo paso, sin llevarse nunca
`tecnologia@espigoladors.com` (deuda §12.33, cerrada; detalle arriba en «Modelo de datos»).
Y lo que SQL no puede hacer: **retirar los ficheros de
Storage**. Sus rutas salen en `fitxers_orfes` del resultado, para que lo haga quien llama.

🔴 **Exige `es_super_admin()`, no `pot_aprovar()`**, y conviene saber por qué: borrar una
ficha ya lo exigía —lo imponen las políticas `productores: baixa super_admin` y
`entidades: baixa super_admin` (`20260730095000`)— y una función `security definer` **no
evalúa esas políticas por dentro**, así que su guarda es la única que queda. Ponerla en
`pot_aprovar()` no habría sido elegir un rol: habría **ampliado en silencio** a los `admin`
un privilegio destructivo, en el mismo cambio que les quita el `23503` que los frenaba.

**Por qué hizo falta: los TRES comportamientos que HABÍA** (histórico, hasta el
21-09-2026; se conserva porque explica qué compra la función y qué no se puede «simplificar»
después volviendo a tocar las FK).

Medido el 16-09-2026 sobre las 18 claves foráneas que apuntan a `productores`,
`entidades` y `organizaciones`. La regla de §7 decía qué debía pasar; esto es lo que pasaba
cuando el borrado era un `.delete()` a pelo desde el panel:

| `delete_rule` | Cuántas | Quiénes | Qué ocurría de verdad |
| --- | --- | --- | --- |
| `CASCADE` | 6 | `convenios`, `membresias`, `planes_prevencion` (×2 tablas) | Se van con la ficha ✅ |
| `NO ACTION` | 9 | `excedentes`, `canalizaciones`, `espigoladas`, `cierres_donante`, `cierres_periodo`, `intake_sessions`, `productor_ubicaciones`, y `organizaciones` desde las dos fichas | **Rechazan el borrado** con `23503`. No deja huérfanos, pero el panel enseña el error crudo de Postgres |
| `SET NULL` | 3 | `oferta_respuestas.entidad_id`, `cierre_donante_lineas.entidad_id`, `cierre_periodo_lineas.entidad_id` | 🔴 **El borrado pasa y la fila se queda apuntando a nadie** — el huérfano exacto que la regla prohíbe |

⚠️ **Lo peor no era ninguno de los tres por separado, era que fueran tres.** Borrar una
entidad cuyo único rastro eran respuestas a ofertas **funcionaba** y dejaba esas respuestas
sin entidad (el detalle de la oferta enseñaba entonces un interés de nadie); borrar una que
además tuviera una canalización **fallaba**; y las dos cosas salían del mismo botón,
`RecordDetail:116`, que hacía un `.delete()` a pelo sobre la tabla.

⚠️ **Y la organización SIEMPRE se quedaba**: `organizaciones` es `NO ACTION` desde las dos
fichas, así que al borrar la última ficha su organización sobrevivía vacía. Las dos purgas
del 16-09-2026 —las 451 del import y la de Carles Sanz— tuvieron que retirarla **a mano**,
en un paso aparte, justo por esto. Es el paso (4) de la función de arriba.

⚠️ **Lo que NO cambió y sigue vigente**: el reparto de las 18 FK es exactamente el mismo
—la tabla de arriba describe la base de hoy—. Lo que cambió es que ya no se llega a ellas
por un `.delete()` suelto. Un borrado que se salte `borrar_ficha_completa()` vuelve a tener
los tres comportamientos, así que **el panel y cualquier limpieza manual usan la RPC**.

**Revisión de los correos del 28-09-2026**: la confirmación de albarán se manda por fin por
correo (`enviaEnllacosConfirmacio`, desde `AlbaraDetall` y desde la pantalla guiada, que
**descartaba** el enlace); el aviso de «conveni signat» son dos correos, uno para quien firma
(a su panel) y otro para el equipo (a Aprovacions), en vez de mandar a quien firma a
`/equip/convenis`; se retiraron dos promesas falsas («te n’enviarem una còpia en PDF»,
«t’avisarem quan estigui canalitzada»); `plantillaEmail()` acepta `idioma` y el pie deja de salir
en catalán en un correo en castellano; y el recordatorio de factura al donante queda apagado
(§12.129).

**Revisión de avisos y mensajes del 28-09-2026** (WhatsApp, avisos de la aplicación y todo lo
que ve el receptor; migración `20270407100000`). Lo que cambia de comportamiento:
- **WhatsApp**: BAIXA corta de verdad (`403 opt_out`) y se acepta además de BAJA; la salutació
  pide ALTA, no «OK»; una oferta enviada por correo ya no captura respuestas de WhatsApp; los
  mensajes que no son sí/no reciben otra vez los botones; «t'avisarem quan estigui canalitzada»
  y «ho revisem i et diem alguna cosa» se retiraron (nadie avisaba); el intake acepta la
  ubicación de WhatsApp, no inventa kg si no hay factor de conversión, limita el texto libre a
  400 caracteres, repite la pregunta tras tres fallos y apostrofa («d'Albercoc»). §5, §6bis, §8.
- **Receptor**: «M'interessa» comprueba el convenio que exige la modalidad (en el Mercat y en
  la base); las consultas de sus pantallas ya **no reciben** `texto_oferta`, `id_excedente`,
  `productor_id` ni `ubicacion_id` (D3: ninguna los pintaba, pero llegaban al navegador); un
  interés sobre una oferta ya cubierta sale «No disponible» y no «Per respondre»; el Històric
  da por recibida una entrega confirmada; ofertas vencidas sin botón; errores traducidos.
- **Avisos**: Configuració ya no dice «desat» a un `admin` que la RLS ha rechazado; los avisos
  de éxito de `OfferDetail` miran el resultado; un envío simulado se anuncia como simulado; las
  bandas se recalculan tras actuar (`refrescAvisos`); `textError()` en todas las pantallas del
  equipo; la banda de convenio ya no enseña un instante «de moment pots seguir operant» al
  cargar (el contexto llega en dos tiempos, y sin organización no se avisa).
- ⚠️ **Queda una decisión**: el `texto_oferta` que se manda por WhatsApp y correo a las
  entidades sigue diciendo «PRODUCTOR: …» y el enlace de Maps de la finca, también en
  donación. El panel del receptor ya no lo recibe; el mensaje, sí. Lo decide la Fundació (D3,
  y la revisión del 23-09 pide que el receptor vea quién ofrece).
- Siguen con texto crudo, fuera de esta tanda: los errores de CARGA de los listados del equipo
  (`setError(err.message)`), `DadesFundacio` y las whitelists.

**Revisión de los paneles del productor y del equipo, 28-09-2026** (sin migraciones):
- **Servidor**: `crear-oferta` comprueba el convenio que exige la modalidad a quien entrega
  (`exigir_convenio(…, 'entrega')`, `403 sense_conveni` con la clave `po.cal_conveni_*`) cuando
  publica el propio productor; el alta asistida no, porque el equipo lo resuelve en la fase 1
  del ciclo guiado. Por WhatsApp ya no se acepta interés sobre una oferta cubierta, cancelada o
  cerrada (se le dice y la fila, que sigue `pendent`, pasa a `dialeg_pas = 'fet'`). Los correos
  a organizaciones (`enviar-email` y los documentos) llevan `reply_to` al buzón del equipo
  (`bustiaEquip()`): salían de `no-reply@` y las respuestas no llegaban a nadie.
- **Productor**: fuera las promesas falsas («t'avisarem quan estigui decidit»), los kg de
  «Tancada» dicen cuáles son los oficiales, la factura se presenta como opcional (no condiciona
  el certificado desde el 21-09), la venta o maquila no se publica sin el convenio `com`, quitar
  una foto ya no deja la oferta apuntando a un fichero borrado, y los errores de carga ya no se
  pintan como lista vacía. Su navegador deja de recibir `canalizaciones.*` y el REC entero.
- **Equipo**: un `tecnic` ve en gris, con el motivo, lo que la base le rechazaría (contrafirmar,
  aprobar, borrar, costes, listas de prueba, plan personalizado); las acciones irreversibles o
  que envían algo fuera (emitir albarán, marcar entregado, contrafirmar, aprobar un alta,
  resúmenes, cerrar el ejercicio, abrir el cierre real, campañas) preguntan antes y dicen qué
  pasará; los guardados comprueban filas (RLS devuelve 200 con 0 filas); una URL de ficha
  inexistente ya no abre el formulario de alta; en el ciclo guiado el interés asistido de venta
  o maquila pide precio (siempre fallaba) y «Prepara el conveni» prepara el tipo que toca.
- ⚠️ **Decisiones que quedan para Carles**: (1) `assegurarContacte()` y el alta manual de
  Missatgeria marcan `opt_in: true` al abrir un chat, sin que la persona lo haya dado (§8 dice
  que la plantilla exige consentimiento); quitarlo impide al equipo el primer contacto por
  plantilla. (2) ~~El descriptor del alta solo está en catalán~~ — traducido el mismo día (§6bis). (3)
  `cancelar_meva_oferta()` deja cancelar una oferta con canalizaciones sin tocarlas; el diálogo
  ya lo advierte. (4) El intake por WhatsApp comprueba el convenio **al final**, en
  `crearExcedenteDesdeSesion()` (el intake no pasa por `crear-oferta`, y hasta hoy publicaba sin
  él): sin convenio se le dice y se descarta la sesión. Preguntarlo al empezar exigiría saber
  la modalidad antes, que es el paso 13.

**Revisión de los PDF y del panel del 28-09-2026** (sin migraciones): en los albaranes, la
columna «Motiu fora de circuit» se montaba sobre «Caixes» (ahora «Motiu»), la línea salía
numerada «0» —el trigger crea las líneas con `ordre = 0`; ahora se numera por posición— y las
incidencias guardadas con la clave `descripcion` se imprimían como JSON crudo
(`textoIncidencias()` acepta ya las dos lenguas). En el panel: la columna «Espera» de Albarans
pasa a «Espera o data» (mezcla días y fechas), «Subtipus» de Documents a «Fase», el aviso de
convenio distingue productora («publicar ofertes») de receptora («mostrar interès»), `/registre`
pierde el único asterisco y la portada habla de tú en las dos tarjetas.

### Integridad

Las tablas Redestina sí tienen foreign keys. Las de mensajería **no**: `productores`,
`wa_contacts` y `wa_messages` siguen unidas solo por `phone`, sin FK.

### RLS y GRANTs — hacen falta LAS DOS capas

**Los GRANT dicen qué operaciones puede intentar un rol; las políticas, sobre qué filas.** El
reparto por rol de plataforma y por organización vive en **§4bis** (tabla `usuario_roles`,
`membresias` y el interruptor `roles_activos`); aquí queda el mapa de privilegios.

`service_role` acceso total en todas (lo usan las Edge Functions, y además ignora RLS por
`BYPASSRLS`). `anon` **no tiene ningún privilegio** desde `20260721160000_auth_authenticated.sql`.
**`authenticated`** tiene `SELECT` en todas —las políticas de §4bis deciden qué filas— más
escritura donde hace falta: `INSERT`/`UPDATE`/`DELETE` en `wa_contacts`, `productores`, `entidades`,
`canalizaciones`, `oferta_respuestas` y `productor_ubicaciones`; `DELETE` en `wa_messages`;
`UPDATE` en `excedentes`; `INSERT`/`DELETE` en las dos whitelists de test; `SELECT`/`INSERT`/
`UPDATE` en `app_settings`.

⚠️ **Y desde `20270322100100` eso es lo que dice el GRANT, no solo la intención.** Hasta esa fecha
`authenticated` tenía `INSERT`, `UPDATE` y `DELETE` **a nivel de tabla en casi todo `public`** —
`documentos`, `albaranes`, `convenios`, `enlaces_token`, `series_documentales`, `municipios`…—, no
por ningún GRANT del repo sino por el `alter default privileges` que Supabase deja puesto para
`postgres`: **cada `create table` heredaba `arwdxtm` sin que nadie escribiera una línea**. Las
frases de este párrafo —«sin `INSERT` en `wa_messages`», «sin `INSERT` en `excedentes`», «ninguna
escritura en `documentos`…»— describían lo que debía ser, no lo que había. Revocado en **33
relaciones** (27 tablas y 6 vistas) más cuatro parciales, con su `alter default privileges`, igual
que el TRUNCATE de `20270309100000`.
**No era alcanzable**: las 33 tienen RLS y ninguna política que autorice la operación revocada, así
que PostgREST las rechazaba igual. No se cerró una puerta: se repuso la segunda capa. Lo que cambia
es el mensaje (`42501` en vez de «0 filas afectadas») y que una política mal escrita mañana ya no
baste para abrir la escritura por accidente.
🔴 **Consecuencia al crear una tabla nueva**: `authenticated` nace con **SELECT y nada más**. Una
tabla escribible desde el panel necesita ahora su `grant insert, update, delete … to authenticated`
**explícito**, además de su política. Es lo que se quiere: que escribir sea una decisión que se lee
en el diff. Casos deliberadamente cerrados a nivel de GRANT, antes incluso de
evaluar RLS: **sin `INSERT` en `wa_messages`** (el envío pasa siempre por la Edge Function), **sin
`INSERT` en `excedentes`** (los crea el servidor, que es quien genera `id_excedente` y
`texto_oferta`), **sin escritura en `usuario_roles` ni `membresias`** (la escalada de privilegios
sería imposible aunque una política fallara), y `perfiles` con **`GRANT UPDATE` por columnas**
(`nombre`, `telefono`, `idioma`, `vista_defecto`: nadie reactiva su propia cuenta). `app_config` es
**solo `service_role`** (§9). Realtime en `wa_contacts`, `wa_messages`, `excedentes`,
`canalizaciones` y `oferta_respuestas`.

⚠️ **`authenticated` tenía `TRUNCATE` sobre 51 tablas de `public`, y eso no lo ve ninguna
política.** Venía del bootstrap de Supabase (`grant all`), que el proyecto revocó **a `anon`**
(`20260721160000:56`) pero nunca a `authenticated`. Importa por dos cosas: **la RLS no se aplica a
TRUNCATE** —así que para esa operación no había una capa, había cero— y **TRUNCATE no dispara
triggers de fila**, con lo que `documentos_no_esborrar` —la garantía sobre la que descansa el
circuito documental entero— se saltaba sin tocar ninguna de sus defensas. Revocado en
`20270309100000`, junto con el `alter default privileges` para que no vuelva con la siguiente
tabla.
**No era alcanzable**, y conviene decirlo sin exagerar: PostgREST expone SELECT/INSERT/UPDATE/
DELETE y RPC, no TRUNCATE, y no hay ninguna función que lo ejecute. No se cerró una puerta
abierta: se repuso una capa donde no había otra. Quedan fuera cinco tablas de `storage` y
`supabase_functions`, que son de la plataforma y tampoco son alcanzables.

**Las políticas RLS por sí solas no bastan.** Supabase ya no expone automáticamente las
tablas nuevas del esquema `public` a los roles de la Data API
(`auto_expose_new_tables` viene desactivado y el ajuste desaparece el 2026-10-30). Sin un
`GRANT` explícito, PostgREST devuelve `permission denied for table X` **antes** de evaluar
RLS, y fallan tanto el frontend como las Edge Functions.

Los GRANT están en `20260721120200_grants_data_api.sql`, que además fija
`alter default privileges` para que las tablas futuras los hereden. **Si creas una tabla
nueva, comprueba que es accesible**:
`select has_table_privilege('authenticated','public.X','SELECT')`.



### Origen de las fichas importadas (plan 1, rebanada 1E, `20270503100000`, 02-11-2026)

- **`productores.ref_externa`** y **`entidades.ref_externa`** (texto, nullable, sin default; índice
  **único parcial** `where ref_externa is not null`): `ARA26:<hoja>:<línea del CSV>` en las fichas que
  carga `scripts/import-ara-2026.ts` (§6.1), que las reencuentra por ahí en la segunda pasada. Las
  fichas creadas en el panel la dejan a `null`. GRANT de tabla de siempre (legible por RLS, escribible
  solo por el equipo); la interfaz no la enseña (`NO_ES_MOSTRA` en `campsFitxa.ts`). El plan la daba
  por puesta en 1A; 1A no la añadió.

### Notas internas: el CRM mínimo (plan 1, rebanada 1F, `20270502100000`, 02-11-2026)

D4: un hilo cronológico por organización, **solo del equipo**, sin «próxima acción» ni cola.

- **`notes_internes`** (`id`, `organizacion_id` → `organizaciones` **`on delete cascade`** —cuando
  `borrar_ficha_completa()` retira una organización vacía, sus notas se van con ella—, `data` timestamptz
  `default now()` = cuándo fue el contacto, `canal` CHECK `telefon · whatsapp · email · visita · reunio ·
  altres`, `autor` → `perfiles` **`on delete set null`**, `text` CHECK 1–2.000 caracteres tras `btrim`,
  `created_at`). Índice `(organizacion_id, data desc, created_at desc)`.
- **Solo inserción.** Nadie tiene UPDATE (una nota se corrige escribiendo otra); el INSERT es por
  `afegir_nota_interna()` y el DELETE por `esborrar_nota_interna()` (super_admin), §4bis.
- **Dos capas**: `revoke all` a `anon` **y** a `authenticated`, `grant select` a `authenticated` con la
  política `notes_internes_llegir` = `(select es_intern())`. Un externo que hace `select` recibe **0 filas
  sin error** (no puede saber que hay notas suyas); `anon`, `42501`.
- **`v_entitats_llistat`** suma al final `darrer_contacte_at` y `darrer_contacte_canal` (la nota más
  reciente por `data desc, created_at desc`, `left join lateral`). Sigue `security_invoker`, así que a un
  actor le salen `null`.
- 🔴 **Las notas nunca salen por ningún canal** (§8): ninguna Edge Function, plantilla, documento ni
  la ficha del actor las lee.

### El CRM completo y el estado global (Taula mestra 1.5, `20270504100000`, 04-11-2026)

1.5 pide «data, canal, tipus, responsable, resultat/comentari, propera acció i data», historial,
«darrera interacció i seguiments pendents». Carles pidió el 04-11 acabar lo que D4 dejó fuera:

- **`notes_internes` +** `tipus` (`not null default 'seguiment'`, CHECK `seguiment · captacio ·
  operativa · incidencia · documentacio · altres`), `responsable` (quién lleva el seguimiento; las
  notas de 1F se rellenan con su autor), `propera_accio` (1–500) + `propera_data` (date; CHECK: las dos
  o ninguna), `seguiment_fet_at` + `seguiment_fet_per` (CHECK: solo con próxima acción). Índice parcial
  de pendientes `(organizacion_id, propera_data) where propera_accio is not null and seguiment_fet_at is null`.
- `responsable` y `seguiment_fet_per` → **`auth.users`**, no `perfiles`, **a propósito**: con tres FK a
  `perfiles`, el embed `autor:perfiles(nombre)` del frontend publicado pasaba a ser ambiguo (PGRST201) y
  dejaba de cargar las notas entre la migración y el `git push`. Como `usuario_roles.user_id`.
- La nota sigue sin UPDATE: lo único que cambia después es el cierre del seguimiento, por
  `tancar_seguiment()` (§4bis).
- **`v_entitats_llistat`** suma al final `seguiments_pendents` (int) y `propera_seguiment` (la fecha
  pendiente más próxima). A un actor, 0 y null.
- **`activar_organitzacio(p_org)`**: la pareja de `desactivar_organitzacio()` (§4bis).

### Població real, àrea editable i «Ubicació» (`20270505100000`, 04-11-2026)

En una ficha ponía «Mercabarna» como población: no es un municipio sino un lugar de Barcelona.
Carles pidió que la población sea siempre un municipio de verdad, que población y área se puedan
editar y un campo aparte para esos lugares.

- **`ubicacio`** (text, CHECK 1–120 sin blancos) en `productores` y `entidades`: el lugar que no es
  un municipio (Mercabarna, un polígono, un mercado).
- **`poblacion` ya no es texto libre**: `trg_fitxa_municipi()` (ahora `before insert or update of
  municipio_ine, poblacion`) la deriva SIEMPRE del municipio. Un texto que llega sin municipio
  (registro público, importación, dato antiguo) se casa con `municipi_de_text()` —sin acentos,
  mayúsculas ni el artículo pospuesto, y **solo con una coincidencia exacta y única**: «Sant Boi» o
  «Hospitalet» no casan—; si no casa, pasa a `ubicacio` (si estaba vacía) y la población queda null.
  Un texto escrito junto a un municipio que no es él («Polígon Can Calderon» + Viladecans) también va a
  `ubicacio`. Borrar el municipio a propósito vacía la población.
- **`area_geografica` = la comarca, editable**: sale del municipio al insertar y al cambiar de
  municipio, **salvo que la misma escritura cambie el área** (así respeta la que elige la pantalla).
  Las RPC del actor solo aceptan una comarca de `municipios` **o el valor que ya tenía** (los
  «Terres Ebre», «Girona», «Bages-Vallès»… del ARA son zonas de Espigoladors, no comarcas, y se
  conservan hasta que alguien los cambie): `comarca_desconeguda`. El equipo escribe directo (sin
  comprobación en la base; la pantalla solo ofrece la lista).
- `actualitzar_fitxa_productor/entitat` aceptan `ubicacio` (`ubicacio_massa_llarga`) y
  `area_geografica`; `crear_entitat` acepta `ubicacio`. `municipi_de_text()` sin EXECUTE para nadie.
- Datos: `update … set poblacion = poblacion where municipio_ine is null` los pasa por la regla. En el
  clon (con el ARA): 6 + 4 casados, 96 + 15 a `ubicacio`.

### Consentimiento RGPD por enlace y su exportación (`20270506100000`, 04-11-2026)

**Por qué.** Solo había consentimiento si la persona se registraba en `/registre`. Las entidades que da de
alta el equipo no tenían ninguno, y declararlo el equipo en su nombre (`alta_assistida`) no vale: el
consentimiento lo da la persona con una acción suya. Ahora el equipo lo **pide** y la persona lo **da**.

- `consentiments.user_id` admite nulo; columnas nuevas `email` y `enlace_id` (FK a `enlaces_token`,
  `on delete set null`); `origen` gana `enllac`. CHECK `consentiments_titular`: o hay cuenta, o es
  `enllac` con correo (la organización puede quedar nula si se borra la ficha; el correo no).
- `v_consentiments_vigents` agrupa por persona: la cuenta, o (sin cuenta) organización + correo; suma
  `email` al final.
- `enlaces_token`: propósito `consentiment_rgpd` sobre `objeto_tipo = 'organizacion'`.
- `demanar_consentiment(p_org, p_email)` (equipo, `es_intern()`): correo de la ficha si no se da,
  `sense_correu`/`organitzacio_desconeguda` (22023); revoca el enlace vivo anterior; caduca a los
  `caducidad_enlace_dias` (30); devuelve el token en claro, que solo viaja en el correo.
- `registrar_consentiment_enllac(p_token_hash, p_respostes, p_versio, p_idioma, p_ip, p_user_agent)`
  (solo `service_role`, la llama `enlace-publico`): `PT404`/`PT409`/`PT410` como los otros enlaces;
  exige los tres tipos con su huella y la privacidad en `true` (`falta_acceptacio`); inserta las tres
  filas, una evidencia `confirmacion` y gasta el enlace.
- `llista_consentiments()` (equipo): el valor vigente por persona y tipo con su correo (el de la
  cuenta, o el del enlace) y su organización. Lo usa «Entitats › Correus amb consentiment» (CSV con
  `;` y BOM, solo quien aceptó alguna comunicación; `lib/consentiments.ts`, con test).

### El listado «Entitats» (plan 1, rebanada 1C, `20270501200000`, 02-11-2026)

- **`v_entitats_llistat`** (`security_invoker`): una fila por organización con ficha (las
  organizaciones vacías no salen). Lo de `v_organizaciones` más `es_test` (alguna ficha), `rebutjada`
  (alguna membresía rechazada), `modalitats_interes` y `prioritat` de la entidad, `conveni_productor`
  / `conveni_entitat` (existe `convenios.estado = 'vigent'` de esa ficha) y `darrera_activitat`
  (`greatest` de la última oferta del productor y de la última respuesta o canalización de la
  entidad). `anon` nada; `authenticated` SELECT, y la RLS de las tablas de debajo decide: el equipo
  todas, un actor la suya (arnés: 9 checks).
- `v_productores_llistat` y `v_entidades_llistat` **se conservan sin consumidor** (§7, compatibles
  hacia atrás; deuda 149).

### Estado de las fichas y búsqueda (plan 1, rebanada 1A, `20270501100000`, 02-11-2026)

- **`entidades.activo`** (`boolean not null default true`): ya existía en `productores`. Las fichas de
  prueba nacen activas; las de una importación nacerán inactivas (D2, rebanada 1F).
- **D7**: la organización está activa si lo está alguno de sus papeles (`v_organizaciones.activa`).
- **Activar exige NIF válido y razón social** (P9). Lo hace cumplir el trigger `trg_fitxa_estat()`
  (`before update of activo`, en las dos tablas), así que ni una escritura directa del equipo se lo
  salta. Orden de los errores, todos `22023`: `falta_nif` (`nif_valid('')` da `true`, por eso tiene
  su comprobación propia) → `nif_invalid` → `falta_rao_social`. Desactivar no exige nada.
- **`fitxa_estat_hist`** (`tipus`, `productor_id`/`entidad_id` con `on delete cascade`, `activo`, `per`
  → `perfiles` `set null`, `at`): una fila por cambio real, escrita solo por el trigger. RLS: la lee
  `es_intern()`; `authenticated` solo tiene SELECT.
- **`v_organizaciones`** (sigue `security_invoker`): columnas nuevas al final, en este orden: `activa`,
  `productor_activo`, `entidad_activo`, `razon_social`, `nom_comercial`
  (`coalesce(p.empresa, e.nombre, p.name)`), `persona_contacte`, `municipio_ine`, `comarca`
  (`area_geografica`), `tipus_activitat` (unión ordenada), `te_compte` y `compte_estat`
  (`activa`·`pendent`·`desactivada`·`cap`, por las membresías y el `perfiles.activo`; una
  rechazada cuenta como `cap`). La cuenta es independiente de la ficha: desactivar la ficha no toca
  la cuenta.
- **El Mercat**: `modalitats_compatibles_meves()` añade `and e.activo`, que vacía la rama del Mercat
  de la política de `excedentes` para una entidad inactiva. Las ramas de historial no cambian.
