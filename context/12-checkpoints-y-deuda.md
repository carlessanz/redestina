# AGENTS.md §12 — 12. Checkpoints de negocio y deuda técnica

> Detalle de la sección 12 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §12» del código apuntan aquí.

## 12. Checkpoints de negocio y deuda técnica

**Checkpoints que NO son código** (Redestina §10): la construcción está completa, pero para poner
Redestina en producción real quedan pasos de configuración y negocio.

1. ~~**Salir del modo PoC**~~ — **hecho (2026-07-22)**: `WHATSAPP_ENVIO_REAL=true` en remoto. Lo
   que contiene el riesgo ahora es el entorno de test de Meta (≤5 números) + `meta_test_recipients`.
2. **Plantillas propias en Meta — desbloquea el envío a receptores fuera de ventana.** Registrar y
   esperar aprobación de `oferta_excedent`, `confirmacio_productor` y las de primer contacto
   **`salutacio_productor` / `salutacio_entitat`** (contenido en `_shared/plantillas-meta.md`). **Esto
   es lo que permite mandar una oferta a un receptor que NO ha escrito en 24 h**: fuera de la ventana
   Meta solo entrega plantillas. Requiere además un **número de producción** con verificación de
   empresa y método de pago (en el sandbox solo `hello_world` y solo los ≤5 números de
   `meta_test_recipients`). El código ya está cableado: la salutació por rol tras
   `PLANTILLES_CA_APROVADES`, y el **envío de la oferta como plantilla** (`enviarOfertaPlantilla` en
   `OfferDetail`) tras **`PLANTILLA_OFERTA_APROVADA`** (ambos en `src/lib/plantillas.ts`, hoy `false`).
   Al aprobarlas: poner los dos flags a `true`, **añadir su texto legible a `TEXTO_PLANTILLA`**
   (`_shared/whatsapp.ts`, si no la consola las registra como `[plantilla: nombre]`; §6ter),
   actualizar el secreto `WHATSAPP_PHONE_ID` con el número de producción, vaciar
   `meta_test_recipients` y (opcional) apagar el modo test. Un solo commit. Los pasos en Meta,
   con rutas de clic y textos listos para pegar, están en `docs/Guía producción WhatsApp — Redestina.md`.
3. **Opt-in real de las entidades**: `false` en las 111 que se importaron —hoy borradas (§6)—;
   el toggle deja la mecánica, pero recoger el consentimiento es trabajo de negocio, y habrá que
   hacerlo sobre las fichas que se reimporten.
4. **Formato definitivo del albarán**: se genera con placeholders (`src/lib/textos.ts`); el
   formato legal del Excel se confirma al integrarlo.
5. **Reexportar `prod_actius.csv`** con la columna Producte para rellenar `productos_habituales`
   (hoy vacío: el intake ofrece el catálogo completo por familias).
6. **Paso a producción de Meta**: número real, verificación de empresa, método de pago.
7. **Apagar la demo**: `VITE_ACCESSOS_TEST=false` en Vercel **y redesplegar** (es variable de build,
   no basta con cambiarla), y comprobar con `grep` sobre `dist/` que ninguna contraseña sobrevive.
   Va con los otros interruptores de producción —modo test (§8) y whitelists de Meta/correo (§4)—,
   pero es independiente de ellos: se puede apagar antes, en cuanto el equipo deje de enseñar la
   aplicación a terceros.
8. **Avisar a mano de que se ha validado un alta.** Hoy nada notifica la aprobación (deuda §12.27),
   así que hace falta un procedimiento del equipo —qué se le dice a la persona y por qué canal—
   hasta que exista la notificación automática. Igual con un **duplicado detectado en la cola**: la
   función rechaza el alta a propósito, pero vincular esa cuenta con la ficha que ya existe exige
   `service_role` y no hay procedimiento escrito.
9. **Checklist de ficha antes de aprobar una entidad**: sin `estat` no entra en la priorización y
   sin `tipo_receptor` no ve ninguna oferta. Hoy es conocimiento tácito del equipo.
10. **Datos reales de Espigoladors en `parametros_documentales`.** La fila está sembrada con
    valores provisionales visibles (§4). Antes de emitir nada con efecto fiscal hay que sustituir
    razón social, CIF, domicilio, inscripción, los datos de la apoderada, los PNG de firma y sello
    (al bucket privado `activos`), `email_equipo` y `fecha_corte_convenios`, y poner
    `datos_provisionales = false`.
    ✅ **Y ya se rellenan desde la aplicación** (21-09-2026): la sección «Dades de la Fundació»
    de **Configuració** (`components/equip/DadesFundacio.tsx`) escribe esa fila, así que esto
    deja de ser «SQL a mano». Lo que sigue faltando es el **material** —los datos reales, el DNI
    de la apoderada y los PNG de firma y sello—, no la pantalla.
    ⚠️ El interruptor `datos_provisionales` **no se puede desmarcar mientras algún campo siga
    vacío o conserve lo sembrado**, y eso incluye dos literales que NO contienen la palabra
    «PROVISIONAL» y habrían pasado un filtro ingenuo: el CIF `G00000000` y el CP `00000`. Lo
    comprueba `campsPendents()` (`src/lib/campsFundacio.ts`, puro y con pruebas). **No valida
    ningún CIF**: solo reconoce lo que sembró `20260928100400`.
    ⚠️ **`apoderada_dni` se escribe pero no se lee** (GRANT de UPDATE sí, de SELECT no, §4), así
    que el campo sale siempre vacío y dejarlo en blanco **no lo borra**. Por eso queda fuera de
    `campsPendents()`: exigirlo bloquearía el interruptor para siempre.
    ✅ **`email_equipo` ya no es NULL**: apunta a `hola@carlessanz.com`, que está en
    `email_test_recipients`. Era el destinatario de TODO lo que se emite en modo prueba y estaba
    en `example.invalid`, o sea que un ensayo no tenía a dónde llegar.
    ⚠️ **Desde el 21-09-2026 esto ya no bloquea los ENSAYOS** (`20260921214526`): con
    `datos_provisionales = true` se emite en **modo prueba** —serie `P-*`, marca de agua y
    `destinatariosPrueba`— y solo se niega el modo real.
11. **Textos legales de las plantillas.** `plantillas_documento` solo trae sembrada la de `PROVA`
    (el ejemplo del formato). Los textos ca/es de REC, ENT, OPE, CONV, RES, CD, CT y PLA los
    entrega la fase 0 y los introduce el equipo desde la pantalla: una migración no inserta texto
    legal sin validar.
12. **Casar `productor_ubicaciones.municipio_ine`** con el texto libre que hay hoy (script aparte,
    con ambigüedades reales: hay nombres de municipio repetidos entre provincias). Hasta entonces
    la columna es nula en las 12 ubicaciones y la priorización sigue comparando cadenas.

**Deuda técnica: aquí vive solo lo ABIERTO.** Lo cerrado se retiró de esta lista el 15-09-2026 y
queda indexado en **§12ter**, una línea por entrada. Hasta ese día convivían las dos cosas —65
entradas resueltas y 41 vivas, 1.263 líneas— y eso derrotaba el propósito de la lista: para saber
qué quedaba había que leerla entera y descartar dos de cada tres. El detalle de una cerrada está en
`git log` del fichero, que es donde le toca.

⚠️ **Léase con la clave de §12bis.** No todo lo que queda es arreglable, y confundirlo hace que la
lista se vuelva ruido otra vez: de las 43 vivas, **42 están catalogadas** allí como decisión con su
precio anotado, espera de material de un tercero, interruptor de producción o decisión de negocio
pendiente. §12bis separa **lo que es un defecto** de **lo que no lo es**.
⚠️ **Y esta propia cifra estuvo mal, sin que nadie la hubiera recontado desde el 15-09-2026**:
decía «39 vivas, 32 catalogadas» mientras el cuerpo real ya tenía 47 y §12bis catalogaba 39 —dos
huecos de conteo distintos, uno por cada número—. Se descubrió el 22-09-2026 al cerrar la entrada
16 y comprobar la cuenta a mano en vez de aritmética heredada. La lección: **una cifra de
recuento no se corrige a ojo al cerrar una entrada, se recuenta con `grep`/`comm` contra el
fichero**, porque sumar y restar de memoria es exactamente cómo se llegó a este desajuste.

✅ **Y por la tarde del mismo 22-09-2026 se resolvió todo lo que quedaba por catalogar,
salvo una.** De las 8 sin catalogar, **4 se cerraron de verdad con código**: 14 (el hueco de
vocabulario castellano del clasificador sí/no, cerrado en `respuestas.ts`), 33 (la purga de
`email_test_recipients` se automatizó dentro de `borrar_una_fitxa()`, y las dos filas huérfanas
que había se limpiaron), 112 (nueva RPC `limpiar_periodes_borrador()`, y el único borrador que
había en producción, limpiado) y 118 (las 5 filas de metadata duplicada, borradas de
`supabase_migrations.schema_migrations`). **2 más se reclasificaron** de "trabajo pendiente" a
"decisión ya tomada" y pasaron a catalogarse en §12bis: 21 (lo que quedaba abierto no tiene
equivalente posible o es diseño deliberado) y 55 (la vigilancia ya está completa 5/5; la causa de
fondo es de la plataforma, no del repo). Y **69 se reclasificó** como "requiere decisión de
negocio" —no de un tercero externo, sino del propio equipo/Fundación sobre si vale la pena un
backfill fiscal— y se cataloga también en §12bis. **Solo queda sin catalogar la #5**, con su
alcance ya reducido: la recarga en ráfaga de `OffersList` y el `select` completo de `entidades`
del Dashboard se cerraron; lo que sigue abierto (el filtrado en cliente de los tres listados, y
dos consultas del Dashboard que agregan por fila) es una decisión de alcance explícita dado el
volumen de datos actual, no una tarea pendiente sin dueño.
✅ **Auditada la lista entera contra el código y la base reales el 22-09-2026, por la mañana**
(tres agentes en paralelo, uno por tercio, más verificación directa de los hallazgos con más
peso): esas 8 seguían siendo exactamente las que faltaban por catalogar en ese momento, ninguna se
había cerrado todavía, pero **12 de las 46 vivas tenían texto que ya no describía el código de
hoy** (cifras, alcance o comportamiento) y se corrigieron una por una en su propio cuerpo —
números 12, 17, 27, 33, 34, 37, 67, 71, 84, 95, 99 y 109. La 82 sí se cerró del todo esa mañana:
su salvaguarda (`tests/cobertura.test.ts`) está completa y verificada, mismo patrón que cerró la
16 y la 117 antes ese mismo día.
⚠️ La 16 —que hasta el 22-09-2026 figuraba aquí como «la brecha 2 de §1bis vista desde el
código»— se cerró ese día: su propio cuerpo solo describía arreglos ya hechos (11-09-2026), y lo
que de verdad queda de la brecha 2 —`usuario`/`rol_organizacion` propios, deduplicación sin
depender de correo/teléfono exactos— es arquitectura sin desglosar en un número, no un bug con
ficha propia. Su plan vive en `3. Claude Code/2026-09-22-plan-organizacion-unificada.md` (§1).

🔴 **Los números no se renumeran NUNCA, y borrar tampoco los libera.** Hay comentarios en `src/`,
`supabase/functions/`, `scripts/` y `tests/` que citan **69** de ellos —48 apuntan a entradas ya
cerradas, y muchos viven en migraciones aplicadas, que no se pueden editar (§7)—. Por eso §12ter
conserva el número de cada cerrada aunque su cuerpo se haya ido: sin esa línea, esos 48 punteros
apuntarían a la nada. Un número retirado no se reutiliza jamás.

⚠️ **05-11-2026 (certificado de donación según el modelo): se cierran la 85 y la 139 y se abren la 154, la
155 y la 156**: **62 vivas** y la siguiente entrada nueva es la 157.
⚠️ **04-11-2026 (consentimiento RGPD por enlace, `20270506100000`): se cierra la 142** (exportación en
«Entitats» y petición por correo desde la ficha): **61 vivas** y la siguiente entrada nueva sigue siendo la 154.
⚠️ **02-11-2026 (plan 1, rebanada 1D): se abren la 151 y la 152**: **62 vivas** y la siguiente entrada nueva
es la 153.
⚠️ **02-11-2026 (tras publicar 1B): se cierra la 150** (`20270501400000`): **60 vivas** y la siguiente
entrada nueva sigue siendo la 151.
⚠️ **02-11-2026 (plan 1, rebanada 1B): se abre la 150**: **61 vivas** y la siguiente entrada nueva es la 151.
⚠️ **02-11-2026 (plan 1, rebanada 1C): se cierra la 147 y se abre la 149**; la 142 queda a medias (la
pantalla sí, la exportación no): siguen **60 vivas** y la siguiente entrada nueva es la 150.
⚠️ **02-11-2026 (plan 1, rebanada 1A): se abren la 146, la 147 y la 148**: **60 vivas** (aritmética) y la
siguiente entrada nueva es la 149.
⚠️ **27-10-2026 (gestión autónoma): se abre y se cierra la 145** (el reinicio del cierre de prueba dejaba la
serie en 0 con documentos vivos de otro cierre; `20270430100400`) y la 109 queda a medias (la pantalla ya no
tiene atajos; los GRANT siguen): **57 vivas** (aritmética) y la siguiente entrada nueva es la 146.
⚠️ **27-10-2026 (interruptores de notificaciones y RGPD): se abren la 142, la 143 y la 144**: **57 vivas**
(aritmética) y la siguiente entrada nueva es la 145.
⚠️ **17-10-2026 (la recogida la cierra el receptor): se abre la 141** (el bloqueo de 48 h ya no actúa
sobre las recogidas nuevas, decisión de producto): **54 vivas** y la siguiente entrada nueva es la 142.
⚠️ **12-10-2026 (fases 8-11 de la revisión del 08-10-2026): se cerró la 130** (fase 8) **y se abre la
140** (el borrado de una ficha no conoce los expedientes de prevención): siguen **53 vivas** y la siguiente
entrada nueva es la 141.
⚠️ **11-10-2026: se cierra la 106** (`cerrada` ya la escribe alguien, fase 1 de la revisión del 08-10-2026): **53 vivas** y la siguiente entrada nueva sigue siendo la 140.
⚠️ **07-10-2026 (revisión completa): se abren la 131-139** —cinco son decisiones de producto o de
política, no defectos (131, 132, 133, 134, 137)—: **54 vivas** (45 + 9; el recuento por `grep` no es fiable
porque la lista de checkpoints de arriba usa la misma numeración, así que esta cifra es aritmética y no se
ha recontado) y la siguiente entrada nueva es la 140. De paso se **cierran sin número propio** cuatro
errores funcionales de los flujos —ventas y maquilas que no conciliaban nunca (OPE de dos partes y
conciliación manual de ENT/OPE), REC conciliado sin arrastrar las salidas, el CT sin pantalla ni emisión en
bloque, y `repartir_espigolada` sin exigir el convenio del generador— y la lista de §4bis de funciones
abiertas a `anon`.
⚠️ **07-10-2026: se cierra la 125** (el repo ya reconstruye producción desde cero, §11 «El clon
local»): **45 vivas** y la siguiente entrada nueva sigue siendo la 131.
⚠️ **05-10-2026: se abre la 130** (la pantalla guiada no elige modalidad): **46 vivas** y la
siguiente entrada nueva es la 131.
⚠️ **28-09-2026: se abre y se cierra la 129** (ningún documento salía por correo): siguen **45
vivas** y la siguiente entrada nueva es la 130.
⚠️ **27-09-2026: se abren la 127** (el correo del resumen anual sigue pidiendo la factura) **y la
128** (una canalización conciliada sin coste no se puede valorar después), así que son **45 vivas**
y la siguiente entrada nueva es la 129. El párrafo de abajo es el recuento
del 22-09-2026 y no se ha rehecho entero.

Estado al 22-09-2026, tras la segunda pasada de la tarde (cierra 14, 33, 112, 118; reclasifica
21, 55 y 69), la revisión funcional en navegador de esa misma tarde (abre 119-124, más la 125
del renombrado de migraciones) y su arreglo por la noche (cierra 119-124): **43 entradas vivas**
(3 parciales 🟡 — 5, 69, 85 — y 40 abiertas) y **82 cerradas**, sobre 125 numerados — recontado
con `grep`/`comm` contra el fichero, no a mano. La revisión en navegador dejó además **cuatro
arreglos sin número, porque se hicieron en el mismo cambio que las diez encontradas**: la clave
i18n compuesta `od.ch_asistido`, la RLS que dejaba a la receptora sin ver el producto de sus
entregas, el desmontaje de la pantalla en cada recarga del contexto y el `sense_conveni` que el
servidor mandaba y la pantalla tiraba. Cuatro son de la tanda de
F2-F5 —113 y 114 del certificado de recepción, 115 y 116 del diagnóstico— y las cuatro nacen
catalogadas en §12bis: dos como decisiones con su precio y dos como espera de material de la fase
0. La **117 se cerró ese mismo día**, midiendo en un navegador de verdad las catorce rutas que
pedía —el navegador integrado de la aplicación de Claude, no Playwright: §2 (regla 4) y §6ter
(`AvisDiagnostic`) cuentan los dos defectos que salieron, arreglados en el mismo cambio—. Y la
**16 se cerró horas después**, al auditar qué quedaba de verdad de la brecha 2 (§1bis): llevaba
desde el 11-09-2026 con su trabajo hecho y sin nadie que lo marcara.
Y la **82 se cerró esa misma tarde**, en la auditoría completa de las 47 entradas que quedaban:
tres agentes en paralelo comprobaron cada una contra el código y la base reales (§ arriba). Ninguna
resultó estar resuelta del todo salvo la 82, pero **12 tenían texto desactualizado** —cifras que ya
no describían la base de hoy, comportamiento que había cambiado sin que nadie lo anotara aquí, o
líneas de código que se habían movido— y se corrigieron sin cerrarlas: siguen siendo trabajo
pendiente, solo que descrito con precisión. El hallazgo más señalado: la 99 daba por hecho que no
existía ninguna pantalla de planes de prevención, y hoy existen dos (`PlaPrevencio.tsx`, en el
panel del equipo y en el externo).

4. `disponible_hasta`: el intake ahora lo **parsea** de la respuesta libre (`parseDisponibleFins`,
   §6bis) y lo rellena cuando es una fecha reconocible; si no (texto no fechable) queda `null`, el
   técnico lo normaliza en el panel y hasta entonces el job de vencidas no actúa sobre ese excedente.
5. 🟡 **Cargas de tabla entera sin filtro ni paginación** — *la peor, resuelta (11-09-2026)*.
   `ProducersList`, `ContactList` y `AppShell` se traían **toda** `wa_messages` para contar los
   mensajes sin contestar, y `AppShell` lo hacía **en cada login** de una cuenta con panel de
   equipo, todo para pintar un número en el menú. Ahora lo agrega la base con
   `missatges_sense_contestar()` (`20270306100000`), que es una consulta de siete líneas y un
   índice. Las suscripciones de Realtime pasan a **invalidar** el contador en vez de acumular
   filas en memoria: acumulando, una pestaña abierta desde por la mañana llevaba encima todo el
   día. `countUnanswered()` se queda como especificación legible de la regla —tiene sus pruebas—
   y como respaldo.
   ✅ **Y el Dashboard, que era la excepción que esta entrada daba por resuelta sin serlo**
   (14-09-2026): seguía trayéndose **`wa_messages` entera** y recontándola con una copia local de
   la regla. Ahora usa `pendentsPerTelefon()` —la misma RPC y el mismo helper que el badge del
   menú, así que las dos cifras ya no pueden divergir— y pide los recibidos y las sesiones de
   intake con `count: 'exact', head: true`. Las que **siguen pidiendo filas van comentadas con su
   motivo**: la KPI de la lista de Meta cruza teléfonos con otra tabla, y los kg pendientes son
   `kg_total − canalizado` **por oferta**; con un `count` se rompen.
   ✅ **`productor/Ofertes.tsx`**: su suscripción a `canalizaciones` era global —la canalización de
   cualquier productor recargaba la pantalla de todos—. `canalizaciones` no tiene `productor_id` y
   el filtro de Realtime es una sola comparación sobre la propia tabla, así que se filtra en el
   manejador contra los ids de mis ofertas. ⚠️ **El DELETE se queda sin guarda a propósito**: con
   la replica identity por defecto solo viaja la clave primaria (§12.24), así que no hay
   `excedente_id` con el que decidir.
   ✅ **Y la recarga en ráfaga de `OffersList` y el `select` completo de `entidades` del
   Dashboard, cerrados (22-09-2026)**. `OffersList` recargaba entero ante CADA evento de
   Realtime en `excedentes`/`canalizaciones` (`event: '*'`), y una sola acción del equipo —
   aprobar un interés, repartir una espigolada— escribe varias filas seguidas: una ráfaga de
   eventos disparaba otras tantas recargas completas redundantes. Ahora se coalescen con un
   debounce de 400 ms (`ESPERA_RECARREGA_MS`, `OffersList.tsx`): una ráfaga entera produce UNA
   sola recarga, la de después del último evento; la carga inicial al montar sigue siendo
   inmediata. Y el `Dashboard` traía la tabla `entidades` entera (`select('email, opt_in')`)
   solo para dos recuentos: pasa a tres `count: 'exact', head: true` en paralelo (total,
   `opt_in = true`, `email` no vacío), con el mismo patrón que ya usaban `wa_messages` e
   `intake_sessions` en la misma función. Las tres cifras que salen en pantalla no cambian.
   ⚠️ **Sigue abierto, y es DECISIÓN de alcance, no olvido**: `productores.select('phone')` del
   Dashboard sigue trayendo filas —`conMovil` mira la FORMA del teléfono (≥9 cifras tras
   quitar separadores), no su existencia, y la columna es texto libre (§6); un `not null`
   contaría un «Truca al fix» como móvil, y expresar la misma regex en SQL la duplicaría con
   la de TypeScript, que es justo el patrón que ya se evitó en otros sitios (§12.91)—;
   `excedentes`/`canalizaciones` del Dashboard siguen trayendo filas porque agregan **por
   oferta**, no admiten `count`; y los buscadores de `ProducersList`/`EntitiesList`/`OffersList`
   siguen filtrando **en cliente**. Esto último se acepta explícitamente dado el volumen actual
   (7 productores, 8 entidades en producción, tras el borrado del 16-09-2026, §6): paginar
   servidor-side hoy sería sobre-ingeniería. Revisar si el catálogo vuelve a crecer (al
   reimportar los CSV de ARA, §6, volverían a ser ~345 productores y ~111 entidades).

10. Hay migraciones que **borran datos** (`truncate wa_messages`) mezcladas con DDL. Son **dos**, y
    solo una mezcla: `20260717080924_productores_y_limpieza.sql:3-4` (el `truncate` y un `delete`, en
    el mismo fichero que crea `productores`) y `20260717084210_vaciar_mensajes.sql:1`, que es un
    fichero de limpieza de una sola línea. Las demás apariciones de «truncate» en el repo son la
    revocación de `20270309100000`, no borrado.

12. `prioritat` casi no discrimina. ⚠️ La cifra que llevaba esta entrada («97 de 111 entidades son
    prioridad 1») describía los datos reales, borrados el 16-09-2026 (§6): hoy solo hay **8
    entidades de prueba**, 5 con `prioritat = 1` y 3 sin prioridad. El código que pondera el campo
    (`_shared/priorizacion.ts`) no ha cambiado; lo que cambió fue el dato, así que el diagnóstico
    de fondo —el campo aporta poco al ranking— sigue sin poder medirse hasta reimportar datos
    reales.

17. Coexisten dos gates: **`es_test`** (fuente de verdad de la app, §8) y las whitelists
    `meta_test_recipients`/`email_test_recipients` (requisito técnico de Meta en test). En test un
    destinatario debe cumplir **ambos**; se inicializaron alineados. Desde el 15-09-2026 el Dashboard
    ya **no las gestiona** —el gestor se fue a Configuració con el resto de interruptores (§6ter)—.
    ✅ **Y el KPI que medía por la lista de Meta ya no existe** —corregido el 22-09-2026, al
    comprobar el código en vez de repetir lo que decía esta entrada—: se retiró del Dashboard en
    el mismo refactor del 14-09-2026 que cerró la mitad de la deuda 5, y `cargarNumerosTest()`
    (`src/lib/metaTest.ts:17`) se quedó sin un solo llamador en todo `src/` (verificado por grep:
    un único resultado, su propia definición) — código muerto, no un riesgo activo. Lo único que
    sigue en el Dashboard sobre teléfonos es `conMovil`, que mide la **forma** del número, no su
    pertenencia a ninguna whitelist. Lo que sigue vigente es solo la primera mitad: los dos gates
    coexisten y hoy están alineados, a revisar el día que el número pase a producción.

21. **El canal preferente (§8bis) no llega a todos los envíos** — *cubierto lo que se podía cubrir
    (14-09-2026), y lo que queda es decisión, no deuda (reclasificado 22-09-2026, ver §12bis)*.
    Con el interruptor global (§8) el correo ya cubre los momentos que eran solo de
    WhatsApp: la **confirmación de oferta registrada** (`crear-oferta`), la **respuesta de la
    entidad** (botón «Mostra interès» al panel, donde `manifestar_interes()` cae en la misma cola) y
    la **mensajería manual** del equipo (`DialegCorreu`).
    Lo que queda **no es código pendiente**: el **intake conversacional** y su **recordatorio** no
    tienen —ni pueden tener— equivalente por correo (no hay sesión de intake sin WhatsApp); la vía
    para publicar sin WhatsApp es el panel (§6ter). El **ALTA/BAJA** solo significa algo dentro de
    WhatsApp. Y el **fallback a correo dentro de `whatsapp-send`** se deja a propósito fuera: lo
    orquesta el llamante, que es quien sabe qué texto tiene sentido por correo — meterlo dentro de
    la función acoplaría el texto de cada caso de uso a una función genérica de envío.

24. **Los eventos DELETE de Realtime se entregan sin evaluar RLS** (`realtime.apply_rls` los reparte
    a todos los suscriptores porque, con la replica identity por defecto, el WAL solo lleva la
    clave primaria). Hoy es inocuo: el payload es solo un id. Dejaría de serlo si algún día se
    pusiera `replica identity full` en una tabla con datos personales.

26. **El registro público no tiene captcha y su límite por IP vive en memoria** (§9): se pierde en
    cada arranque en frío del isolate y no se comparte entre instancias. Lo que de verdad frena un
    abuso masivo es el tope de 20 pendientes por hora. Turnstile queda pendiente; hoy no compensa,
    porque el coste de un alta basura es una fila que el equipo rechaza con un clic.
27. **El registro no envía correo** — y es **decisión, no descuido** (reclasificada el 14-09-2026,
    §12bis). El propio código lo explica en `registro/index.ts:33-38`: con el modo test activo la
    cuenta recién creada no pasaría `esCuentaPermitida`, así que el correo se descartaría en
    silencio. Medido: la bloquearían **tres** condiciones independientes, no una —sin fila en
    `usuario_roles`, membresía `activo = false` hasta que alguien apruebe, y ficha
    `es_test = false`—. Lo que queda como deuda de verdad es la consecuencia, no la causa:
    `email_confirm: true` da el correo por verificado sin comprobarlo, así que **un error
    tipográfico en el correo deja la cuenta sin ningún canal** (y con el modo test encendido
    tampoco podría recuperar la contraseña, §8). Falta una notificación de ese caso concreto —que
    dependerá de la tabla `notificacion` con *fallback* de canal del funcional (§1bis)—.
    ✅ **Esta entrada decía «ni el registro ni la aprobación», y la segunda mitad caducó sin que
    nadie la corrigiera aquí** (corregido el 22-09-2026): desde el 16-09-2026 **aprobar sí envía
    correo** — `aprovarRegistre()` en `Aprovacions.tsx:364` llama a `enviarAcces()` con el enlace
    mágico al panel, tal como documenta §9 con detalle (la casilla «de prova» que hay que marcar
    antes de aprobar, y los tres avisos distintos si el correo no sale). Con eso, «quien espera
    validación se entera entrando a mirar» tampoco es ya cierto en general: si el envío sale bien,
    se entera por correo.

30. **Las contraseñas de las cuentas de prueba viajan en el bundle** con `VITE_ACCESSOS_TEST=true`
    (§6quater, §10). Está acotado y se apaga con la variable, pero mientras esté encendido cualquiera
    que abra `/login` entra como ellas. Desde el 31-07-2026 el alcance ya no es solo «organizaciones
    ficticias»: las cinco cuentas de WhatsApp (§9) enseñan **fichas de personas reales del equipo**
    —nombre, correo de trabajo y móvil—. Nunca cuentas con rol de plataforma, eso sigue vetado.
    Apagarlo al dejar de ser una demo.

34. **Áreas táctiles: se subieron las cuatro que importan, no todas.** «M'interessa» (44 px en móvil),
    el `SidebarTrigger` (36), el ojo de la contraseña (de 16×16 a 32×32) y el «atrás» del detalle de
    oferta. El resto de la interfaz sigue en `h-9` (36 px), por debajo de los 44 px que recomiendan
    Apple y Google: subirlos todos es rediseñar la aplicación entera para ganar 8 px en botones
    secundarios. Los ítems de los menús desplegables (idioma, `UserMenu`) siguen en 32 px.
    ⚠️ **«El resto sigue en `h-9`» se quedó corto, y en el buen sentido** (recontado el 14-09-2026):
    hay **27 botones con `h-11 md:h-8`**, o sea 44 px en móvil y 32 solo en escritorio, repartidos
    por las pantallas del equipo y los componentes de documentos. El fondo sigue siendo cierto —las
    variantes base de `ui/button.tsx:24-30`, `ui/input.tsx:11` y `ui/select.tsx:40` están todas por
    debajo de 44 px, y son ~250 controles—, pero la interfaz ya no es uniforme: quien mida esto otra
    vez debe contar `h-11` antes de concluir.
    ⚠️ **Y ya ha vuelto a subir** (recontado el 22-09-2026, tal como pedía la frase de arriba): son
    **57** botones con `h-11 md:h-8` en 23 ficheros, más una variante nueva —`h-11 ... sm:h-8`,
    breakpoint `sm` en vez de `md`— en `AvisConveni.tsx:84` y `AvisDiagnostic.tsx:92`, introducida
    ese mismo día (§2, regla 4). La cifra sube con cada pantalla que se toca, así que no vale citar
    ningún número como si fuera fijo: `grep -rlE "h-11.*(md|sm):h-8" src/ --include="*.tsx"` da la
    cuenta de hoy.

37. **El aviso de instalación no se puede probar de verdad en automático.** `beforeinstallprompt` no lo
    dispara ningún navegador de escritorio ni Playwright. La instalación real solo se comprueba en
    un móvil.
    ⚠️ **Y no era «las pruebas lanzan un evento sintético»: no hay ninguna prueba, de ningún tipo**
    (corregido el 22-09-2026, comprobado por grep sobre todo `tests/`: cero resultados para
    `AvisInstallacio`, `useInstalacio` o `beforeinstallprompt`). La limitación de plataforma sigue
    siendo cierta —es la razón de fondo por la que no hay ni habrá una prueba automática completa—,
    pero hoy no hay ni el sustituto sintético que esta entrada daba por hecho. Si alguna vez existió,
    se perdió sin dejar rastro en el histórico de `tests/`.

54. **Dos checks nuevos dependen de `roles_activos`.** Con el interruptor apagado —como nace
    cualquier entorno recreado desde las migraciones— `es_super_admin()` devuelve `true` para
    cualquier autenticado, así que «el equipo NO emite documentos de prueba» sale en rojo. Es el
    fail-open deliberado de §4bis, no una regresión: hay que encender el interruptor antes de
    juzgar el resultado. Está escrito en la cabecera del script.

55. **Los campos sensibles los protege un GRANT, no una política, y eso se puede deshacer sin
    querer** — *la vigilancia, completa desde el 14-09-2026; la causa de fondo es estructural de
    Supabase y no se puede cerrar por código (reclasificada 22-09-2026, ver §12bis)*.
    `enlaces_token.token_hash`, `enlaces_token.codigo_hash`,
    `evidencias.documento_identidad` y `parametros_documentales.apoderada_dni` están fuera del
    GRANT de SELECT (§4). Un `grant select on all tables in schema public to authenticated`
    —exactamente la línea que ya existe en `20260721160000`— los volvería a abrir **sin que
    ninguna política cambie ni ningún test de RLS lo note**.
    🔴 **Y el riesgo no es futuro, ya está puesto** (medido el 14-09-2026): además de aquel GRANT,
    `20260721160000:66` deja un **`alter default privileges in schema public grant select on tables
    to authenticated`**. O sea que **toda tabla nueva nace con SELECT sobre todas sus columnas**, sin
    que nadie vuelva a escribir un GRANT masivo: basta con crear una tabla con un campo sensible y
    olvidar el `revoke`. Las dos migraciones documentales empiezan por ese `revoke` justamente por
    eso (`20260928100300:220-225`, `20260928100400:142-147`), y quien añada una columna a una tabla
    con GRANT por columnas tiene que otorgarla a mano (el precedente es `20270304100200:39`).
    ✅ **Y ya son CINCO de cinco** (14-09-2026): `codigo_hash` tiene por fin su check propio —hasta
    ese día estaba en el `revoke` y en el comentario, pero reabrirlo solo a él habría salido verde— y
    `documentos.envio` entra con **dos**, uno de equipo y otro de cuenta externa. El externo es el
    que de verdad mide: un donante **sí** ve su fila por `documents_meus()`, así que si alguien
    restaurara el GRANT por tabla ese check pasaría de «rechazado» a «ve 1 fila» y saldría **rojo**.
    La regla para la próxima columna sensible: el `revoke` en la migración y el check en el arnés,
    **en el mismo cambio**.

66. **«Amb discrepància» es un filtro, no un veredicto.** `v_albaranes_bandeja` solo sabe si hubo
    rechazo o si lo confirmado no cuadra con el neto de ese albarán; la diferencia real la calcula
    `propuesta_conciliacion()` cruzando el REC con todos sus ENT, y eso sería una llamada por fila.
67. **Rectificar solo permite corregir `kg_neto` por línea**, no el producto ni las cajas. Es lo que
    se rectifica en la práctica, y evita meter un segundo editor completo dentro de un diálogo.
    ⚠️ **La limitación es de la pantalla, no de la RPC** —matiz añadido el 22-09-2026—:
    `rectificar_albaran()` (`20261012100500_rpc_albaranes.sql:1043-1088`) delega en
    `emitir_albaran(nueva.id, a.recogida, p_lineas, ...)`, que sí aceptaría reemplazar producto y
    cajas si le llegaran. Es `DialegRectificar`, dentro de `AlbaraDetall.tsx`, quien solo renderiza
    un campo editable de `kg_neto` por línea y deja el producto como etiqueta fija. La entrada
    sigue describiendo la experiencia real del equipo, solo que el sitio donde vive la restricción
    es otro.

69. 🟡 **La fecha del cierre ya se escribe, pero solo la de la entrega — requiere decisión de
    negocio, no código (reclasificada 22-09-2026, ver §12bis).** `emitir_albaran()` rellena
    `data_hora_recollida` cuando está vacía (`20270304100300`), así que las canalizaciones nuevas ya
    no dependen del respaldo `coalesce(data_hora_recollida, conciliada_at, created_at)`, que puede
    caer semanas después.
    **Lo que queda, y no estaba en la deuda original**: solo la escriben **ENT y OPE** —el REC no
    tiene `canalizacion_id`—, así que en una **donación** la fecha guardada es la de la entrega a la
    entidad, no la de la entrada del donante; si esa entrega cruza el 31 de diciembre, el año podría
    no ser el del REC.
    ⚠️ **El histórico no se ha tocado a propósito**, y no debe tocarse sin el equipo delante: un
    backfill cambiaría el ejercicio fiscal de datos ya certificados. Por construcción el cambio no
    alcanza nada cerrado —`emitir_albaran` exige `borrador` y `cierre_base` solo mira `conciliada`,
    estado al que no se llega sin emitir antes—, verificado con tres transacciones revertidas.
70. **Los kilos por línea del cierre son derivados, no medidos.** D13 manda certificar el neto del
    albarán de recepción, pero las líneas tienen que ser por canalización para saber a qué entidades
    llegó el producto: el neto se reparte proporcionalmente a `kg_conciliados`, con el residuo del
    redondeo a la línea mayor. Con un rechazo grande en un solo lote, ese lote absorbe parte de la
    merma. **El total del donante —lo único que sale en el certificado y en el 182— es exacto.**
71. **No hay plantilla `RES` sembrada**, así que `documentos.plantilla_id` sale `null` ahí, igual
    que en REC/ENT/OPE. ⚠️ **Y la parte de `CD` hay que decirla con más cuidado** (corregido el
    22-09-2026, verificado con `select tipo, variante from plantillas_documento`): existe una
    plantilla `CD`, pero es la variante **`parcial`** del certificado a demanda (§4,
    `20270303100200`), sembrada aparte por una razón legal concreta —sin ella,
    `emitir_certificado_periodo()` se niega—. La `CD` **base, la del certificado anual**
    (`variante` null) sigue sin sembrar, así que `documentos.plantilla_id` sigue saliendo `null`
    en cualquier certificado de donación anual que se emita.
72. **`abrir_cierre` no se puede probar como «permitir» en el arnés**: dejaría una cabecera de
    cierre y no hay RPC que la borre. Se cubre por el lado del «denegar», y con
    `reiniciar_cierre_prueba`/`conciliacion_retroactiva` sobre un uuid inventado.

76. **La filigrana de los documentos de prueba no se puede comprobar con un `grep` literal**:
    `pdftotext` la trocea porque va girada 45°. Cualquier verificación automática tiene que buscar
    fragmentos (`PR`, `O`, `V`, `A`…), no la frase entera.

77. **El texto de los seis convenios no está validado por la asesoría** (§4). Se siembra texto de
    trabajo marcado como borrador para poder probar el circuito antes de la fase 0. Sustituirlo es
    publicar la versión 2 y retirar la 1, **no editar la existente**: en cuanto una plantilla ha
    emitido algo, el trigger la congela.

80. **El DNI del firmante no entra en `documentos.datos` aunque el PDF lo imprima.** El
    renderizador lo lee de `evidencias` con `service_role`. **Precio conocido: `sha256_datos` no
    cubre ese dato**, así que la huella del snapshot no prueba qué documento de identidad se
    declaró — eso lo prueba la fila de `evidencias`.
    ⚠️ **El motivo que esta entrada daba caducó, y la conclusión sobrevive por otro** (revisado el
    15-09-2026). Decía que `documentos` tenía «`grant select` sobre la tabla entera», y desde
    `20270320100300` (§12.75) es **por columnas**. Pero `datos` es una de las columnas concedidas
    —el donante lee ahí su propio documento por `documents_meus()`—, así que meter el DNI dentro
    seguiría deshaciendo el GRANT por columnas de `evidencias`. Lo que cambia es el argumento, no
    la decisión.

81. **`sense_conveni` de `priorizar-entidades` replica la resta, no la regla.** Para no llamar a
    `convenio_vigente()` 111 veces por oferta, lee `convenios_exigidos` y los convenios vigentes y
    calcula la diferencia en TypeScript. La regla sigue en la tabla y la autoridad sigue siendo la
    RPC (`exigir_convenio`): una divergencia solo produce un aviso de más o de menos en el panel.
83. **`cierre_donante_lineas.albaran_rec_id` guarda el OPE en las líneas de transacción.** El
    nombre se queda corto desde que el CT reutiliza el motor del cierre; renombrarlo obligaría a
    reescribir también el circuito de donaciones, así que se deja anotado.
84. **No hay plantillas `CT` ni `PLA`** en `plantillas_documento`, como tampoco las hay de REC, ENT,
    OPE ni RES: los textos son material de la fase 0. `documentos.plantilla_id` queda `null` y el
    renderizador imprime su texto de trabajo con el aviso.
    ⚠️ **La lista de acompañantes tenía dos de más, corregido el 22-09-2026**: `CONV` **sí** tiene
    plantilla desde hace tiempo —6 filas, las 3 variantes en los 2 idiomas, todas vigentes y
    marcadas `[ESBORRANY]`/`[BORRADOR]` en el título (§4, deuda §12.77)— y `CD` la tiene **para el
    certificado a demanda** (variante `parcial`), aunque no para el certificado anual (ver §12.71).
    `CT` y `PLA` sí siguen sin ninguna, tal como dice la entrada.

85. ~~E2E del CT~~ **Cerrada el 05-11-2026**: el CT se retiró (`20270509100400`); ya no hay nada que
    recorrer. Lo emitido se sigue descargando. Ver §12ter.

91. **La detección de organización del registro tiene puntos ciegos, todos hacia el lado seguro.**
    ⚠️ **La primera mitad de esta entrada era FALSA** y se corrige (14-09-2026): decía «solo mira
    `entidades.telefono`», y `registro/index.ts:632` mira **también `productores.phone`**. El hueco
    real es otro: no mira `entidades.telefono2` ni `telefono3` —que existen desde
    `20260721120100:62-63`— **ni `productores.telefono_alt`**, que la entrada ni mencionaba y guarda
    precisamente los números extra que el import de ARA encontró en la misma celda.
    El segundo punto ciego sí era exacto: el filtro es un regex tolerante a separadores **anclado al
    FINAL** del campo (`registro/coincidencies.ts:88-90`), así que un teléfono guardado en medio de
    texto (`612345678 / 933000000`) no casa — y como el ancla va en la consulta, la fila **ni
    siquiera llega a memoria**, con lo que `mateixTelefon()` (que sí compara las últimas 9 cifras)
    nunca la ve.
    Todos producen un **duplicado que ve el equipo, nunca una fusión equivocada**, que es el orden
    correcto de preferencias.
    ✅ **Resuelta el 14-09-2026**: se miran las tres columnas secundarias, el patrón deja de ir
    anclado y `clausTelefon()` saca **todas** las claves de 9 cifras que contiene un campo — porque
    arreglar solo el ancla no bastaba: `mateixTelefon()` comparaba las últimas 9 del campo entero, y
    en `612345678 / 933000000` esas son las del **segundo** número, así que la fila llegaba a memoria
    y se descartaba igual.
    🔴 **Y la fuerza de la señal depende ahora de la columna, que es lo que evita un daño nuevo.**
    Una coincidencia por columna **principal** se comporta como siempre, `409 dades_en_us` incluido;
    una por **secundaria no deniega jamás**: cae en el camino de «papel nuevo», con su nota para el
    equipo. El motivo es que un `409` **no es un duplicado que alguien revisa, es un alta denegada**,
    y una centralita compartida dice «se cogen el teléfono en el mismo sitio», no «son la misma
    organización». Medido en producción: 7 números compartidos por organizaciones distintas, de los
    cuales **1** es principal↔principal (sigue denegando, y ya denegaba antes) y **6** pasan a
    revisión; sin la regla habrían sido 7 denegaciones. `Decisio.camp` se estrecha a `MotiuFort`, así
    que un 409 no puede citar una columna débil ni por error de refactor: lo sostiene el compilador.
    ⚠️ **Dos de esos seis son ganancia neta**: `Group Fructusweb` y `Josep Salvadó` tienen **dos
    fichas cada uno con `organizacion_id` distinto** — duplicados reales que hoy no ve nadie y que
    saldrán marcados en cuanto esa organización vuelva a pasar por el registro.
    ⚠️ **La columna normalizada y el índice funcional se descartan**, al revés de lo que decía esta
    entrada: con 111 entidades y ~450 fichas no hay problema de rendimiento que lo justifique, y la
    lógica de «últimas 9 cifras» está **triplicada** (TypeScript en `coincidencies.ts`, y SQL en
    `20270310100000:111-114` y `20270315100000:64-99`) porque SQL no puede importar TypeScript.
    Unificarla exigiría mover la decisión a una RPC, y entonces `coincidencies.ts` dejaría de poder
    probarse desde Vitest — que es justo lo que `tests/registro.test.ts` explica que se ganó. Queda
    como decisión con precio conocido (§12bis).

92. **El correo de la oferta no captura la respuesta sin cuenta.** El botón «Mostra interès» lleva
    a `/receptor/mercat`, que exige sesión — y de las 111 entidades importadas casi ninguna la
    tiene. El equivalente real del diálogo de WhatsApp sería un propósito `resposta_oferta` en
    `enlaces_token` + `enlace-publico`, para contestar kg y precio desde el correo sin registrarse.
    Se dejó fuera a propósito (fase 2): mientras tanto, la entidad contesta el correo y el equipo
    marca la respuesta a mano en `OfferDetail`, que es el camino que ya existía.
93. **`whatsappActivo()` se lee sin caché: una consulta más por cada saliente.** Es deliberado (§8):
    cachearla dejaría a los isolates calientes enviando después de apagar el interruptor. Si algún
    día pesara, la respuesta no es una caché de tiempo sino no llegar hasta ahí — el webhook y
    `whatsapp-send` ya cortan mucho antes.

95. **La generación del token está copiada en tres migraciones aplicadas.**
    `marcar_entregado()`, `enviar_convenio()` e `iniciar_firma_asistida()` llevan cada una su
    copia del cálculo (dos `gen_random_uuid()` + reloj → sha256 → base64url). Desde
    `20270318100000` existe `generar_token_enlace()` y lo nuevo la usa —`acunar_enllac_propi()`
    en esa misma migración, `signar_conveni_propi()` (`20270326100000`) y
    `acunar_enllac_assistit()` (`20260921160536`)—, pero las tres viejas se quedan como están:
    **editar una migración aplicada está prohibido** (§7). Se unifican el día que alguna se recree
    por otro motivo.
    ⚠️ **Y una de las tres SÍ se recreó por otro motivo, y siguió sin usarla** (verificado el
    22-09-2026): `iniciar_firma_asistida()` se reescribió el `20260921161008`
    (`firma_assistida_sense_codi.sql:59`) —después de que `generar_token_enlace()` ya existiera—
    y mantuvo su generación inline en vez de adoptarla. No es solo que tres migraciones antiguas
    quedaran quietas: una se tocó más tarde con `generar_token_enlace()` ya disponible y decidió
    no usarla, así que la próxima vez que alguien la toque no hay excusa de «no existía todavía».

97. **Acuñar un enlace desde el panel revoca el que la persona tenga en el correo.** Es la
    misma regla que `enviar_convenio()` —dos enlaces vivos son dos firmas posibles y la segunda
    no tendría dónde ir— y el precio es aceptable porque quien acuña es esa misma persona. El
    corolario, que sí es deuda: **no hay check del arnés que ejercite la permisión en positivo**,
    porque correría también contra producción. La guarda sí se comprueba.
98. **`nav.entity_documents` pasa a valer «Documents», que es lo que dice el menú del equipo.**
    `tests/cobertura.test.ts` exige que las `labelKey` no se repitan —por los tooltips del menú
    plegado— y no se repiten: son claves distintas. Lo que coincide es el TEXTO, y solo se vería
    en una cuenta que tuviera a la vez panel de equipo y de receptor, que hoy no existe (las de
    doble rol son productor+receptor).

109. 🔴 **La pantalla guiada es una CONVENCIÓN, no una imposición.** `/equip/canalitzacio`
     (§6ter) llama a las RPC reales del circuito, así que salen exactamente los mismos
     documentos y correos que si lo hubiera hecho la organización — **cuando se usa**. Pero
     `authenticated` conserva `insert`/`update`/`delete` sobre `oferta_respuestas` y escritura
     directa sobre `canalizaciones`, así que los atajos de `OfferDetail.tsx:278` (`registrarEnvio`),
     `:299` (`marcarRespuesta`) y `:507`/`:525` (alta y `guardarKgReales`) —renumerados el
     22-09-2026, el fondo no cambió— siguen existiendo y siguen produciendo lotes **sin `canal`,
     sin compatibilidad de modalidad comprobada y sin precio mínimo**, indistinguibles en el
     listado de los que pasaron por el circuito. Cerrarlo es revocar esos GRANT y reescribir `OfferDetail` y
     `Aprovacions` para que pasen por RPC: ~2 días. ⚠️ Mientras tanto, «se generan los mismos
     documentos» es una frase con condición, y así hay que decirla.
     🟡 **Desde el 27-10-2026 (gestión autónoma, fase 2) la PANTALLA ya no ofrece ningún atajo**:
     `marcarRespuesta`, el alta directa de canalizaciones y `guardarKgReales` se retiraron de
     `OfferDetail`, sustituidos por el interés asistido, `FormulariAprovacio` y la recogida asistida, que
     pasan por las mismas RPC que la organización (`tests/e2e/paritat-assistida.e2e.ts` lo compara fila a
     fila). Quedan dos escrituras directas que no rompen la paridad —registrar el envío por WhatsApp o
     correo (`registrarEnvio`) y rechazar un interés (`rebutjarResposta`)— y, sobre todo, **los GRANT**:
     cualquier cuenta del equipo puede seguir escribiendo esas tablas por la API. Eso es la 132.

110. **El arnés se quedó sin ninguna cuenta que ejercite el aislamiento del doble rol**
     (21-09-2026, `scripts/escenari-demo.ts`, §9). Decisión de producto: cada cuenta de
     prueba pasa a tener un solo papel activo, y la última que tenía dos
     (`hola+wa-carles@`) se quedó con uno. El bloque `doble_rol` del arnés se retiró
     porque un bloque de checks sin ninguna cuenta real que lo cumpla es un fantasma: hoy
     nada comprueba que ver dos paneles a la vez —productor y receptor— no es ver dos
     veces la base. Se recupera dando de alta una cuenta interna dedicada solo al arnés,
     nunca mostrada en ninguna demo, con el mismo criterio que ya sostiene los bloques
     `pendent` y `sense_rol`. Las fichas con doble rol de negocio (Carles Sanz, Sebas
     Sale, Raquel Diaz, Laura Masdeu) siguen existiendo tal cual: lo que falta es la
     cuenta de prueba que lo mire.

111. **La excepción D4 se retira como camino, y sus columnas se quedan como histórico**
     (21-09-2026, `20260921211329`). Decisión del cliente: el certificado deja de exigir
     factura. Con la factura fuera de la condición, «excepción sin factura» o se marcaría
     en **todos** los certificados —y el PDF imprimiría la caja de excepción en todos, lo
     cual es falso— o sería un camino muerto. Así que `p_motivo_excepcion` se conserva en
     la firma de `emitir_certificado()` y `emitir_certificado_periodo()` **y se ignora**, y
     `excepcion_sin_factura` no se vuelve a escribir. Las columnas `excepcion_*`, su rama en
     `render/cd.ts` y el badge del panel **se quedan**: `documentos` es inmutable y los
     certificados que se emitieron por excepción tienen que seguir imprimiéndose como tales.
     El precio: el control de que la factura cuadre pasa de ser un bloqueo a ser el aviso
     `discrepancia`, que alguien tiene que mirar. Ver §12bis.

115. **El cuestionario de diagnóstico, las 20 medidas y las 32 reglas son texto de trabajo
     SIN validar por la Fundació.** Es la misma decisión que los seis convenios
     (`20270111100200`) y el mismo precio: se emite con `provisional = true`, **sale impreso en
     el PDF**, y se sustituye publicando la versión 1 desde la pantalla, nunca editando la 0.
     Espera material de la fase 0 (anexo B).
     🟡 **Del productor ya hay versión 1** (27-09-2026) con el contenido de la revisión, todavía
     provisional por la lista de «suport» y las cuatro adaptaciones del motor (§4). El receptor
     sigue en la 0. Las 20 medidas del catálogo siguen siendo texto de trabajo.
116. **`desar_mesures_pla()` y `fixar_nivell_pla()` no tienen check en el arnés.** Su guarda
     depende del plan, así que va **después** de buscarlo: con un uuid inventado responden
     `22023 «no existe»` y no el `42501`, así que un `denegar` ahí **saldría verde por el motivo
     equivocado**, que es peor que no tenerlo. Se cubren el día que el fixture documental deje
     un plan con borrador.

113. **Una línea del certificado de recepción es una canalización entera, con un solo
     producto.** `cierre_receptor_lineas` tiene `unique (cierre_receptor_id, canalizacion_id)` y
     toma el `producto` del excedente, así que un ENT con varias líneas de producto —una
     espigolada repartida— suma todos sus kilos bajo un único nombre en la tabla de procedencias.
     Es la misma simplificación que ya tienen `cierre_donante_lineas` y `cierre_periodo_lineas`, y
     se conserva **a propósito**: la alternativa es romper esa clave única y con ella el modelo
     mental que el equipo ya tiene de las tres tablas. El **total de kilos es exacto**; lo que se
     reparte mal es su atribución por producto.
114. **`cierre_base_recepcio()` cuenta una canalización sin `valorizacion` como donación;
     `cierre_base()` y `cierre_base_transaccion()` la dejan caer.** Las tres son anteriores al
     trigger de `20261012100100`, así que solo afecta a filas viejas, pero la divergencia es real:
     un kilo que el certificado de la receptora incluye puede no estar en el del donante. Se
     eligió así porque en el lado del receptor el fallo contrario es peor —negarle un kilo que
     recibió— y porque es lo que hace que `kg_donacio + kg_compra = kg_total` se cumpla siempre.
     La misma expresión está **duplicada a propósito** en `kg_rebuts_exercici()`: si divergieran,
     el acumulado del panel y el del certificado dirían cifras distintas sobre lo mismo.

✅ **Las seis siguientes de la revisión funcional en navegador del 22-09-2026 se cerraron
todas el mismo día, en un segundo cambio** (el informe completo, con la evidencia de cada
una, está en `3. Claude Code/`). Los cuatro hallazgos mayores de esa revisión ya se habían
arreglado en el primer cambio y por eso no tienen número: la clave `od.ch_asistido` (§7, y
`tests/i18n.test.ts` la vigila ahora), la RLS que dejaba a la receptora sin ver el producto
de sus entregas (§4bis, `20260922124240`), el desmontaje de la pantalla en cada recarga del
contexto (§6quater) y el `sense_conveni` que el servidor mandaba y la pantalla tiraba
(§4bis). Las seis numeradas (119-124) están en §12ter.

126. **`documentos_objeto_existe` no conoce `cierre_periodo` ni el archivo de una ficha.** El
     `case` del trigger (`20260928100200:270-276`) resuelve `albaran`, `convenio`,
     `cierre_donante`, `espigolada` y `plan`; `cierre_periodo` **sí está** en el CHECK de
     `documentos.objeto_tipo` (`20270303100100:239`) y **no** en ese `case`, así que `v_tabla`
     queda null, `to_regclass('public.')` también y el insert muere con un `0A000` que dice
     «falta la tabla» cuando lo que falta es una rama. Hoy no es alcanzable —nadie emite un
     `documentos` de `cierre_periodo` sin pasar por `periodo_emet_document()`, que ya existe y
     funciona— pero el mensaje mentiría el día que alguien lo toque.
     ⚠️ Esto **no afecta** a la documentación de una organización (§4): eso vive en
     `documentos_externos`, que es polimórfica **sin** trigger de existencia. Ahí quien comprueba
     que la ficha existe es `ruta_documento()`, que devuelve `0A000` si no la encuentra —y por eso
     su `select` sobre `productores`/`entidades` no es decorativo—.

127. **El correo del resumen anual sigue ofreciendo subir la factura.** El 27-09-2026 se quitó
     la subida del panel del productor (revisión funcional del 23-09: el productor gestiona su
     factura con su gestor, y el certificado no depende de ella desde el 21-09), pero
     `emitir_resumen()` sigue acuñando el enlace `subida_factura` y el correo lo ofrece. No se
     tocó porque es backend del cierre (RPC + `enlace-publico`) y hay que decidir si se retira
     del todo o se deja como vía opcional.

128. **Una canalización conciliada SIN coste no tiene forma de recibirlo después.** La destapó el
     análisis del coste sin ejercicio (27-09-2026), pero es anterior: `conciliar_albaran()` exige
     el albarán entregado o confirmado, y `conciliacion_retroactiva()` rechaza las ya conciliadas,
     así que fijar después la referencia (o el coste de la oferta) no llega a esa canalización y su
     bloqueo `sense_cost` del cierre no se levanta. Hoy no hay ninguna en ese estado que importe
     (son fixtures); cuando la haya hará falta una RPC de «valorar a posteriori» con motivo.

**Abiertas por la revisión completa del 07-10-2026** (auditoría de seguridad y de calidad del frontend,
más el trazado de los flujos contra el código; informe en `3. Claude Code/2026-10-07-auditoria-completa.md`).
Las 131-135 y la 137 son **decisiones de producto o de política**, no defectos que se arreglen solos.

131. **D3 sigue abierta en la capa REST: `excedentes` entrega al receptor columnas que identifican al
     donante.** El GRANT SELECT de `excedentes` es de tabla y la política de lectura deja a la
     receptora leer filas del Mercat y de sus canalizaciones, con `texto_oferta` («PRODUCTOR: …»),
     `id_excedente` (las tres primeras letras del donante), `productor_id`, `ubicacion_id`,
     `responsable`, `observacions` y `validada_per`; Realtime las emite igual (medido en el clon: 13 de 26
     `texto_oferta` llevan «PRODUCTOR»). El cliente ya no las pide, pero la API sí las sirve. Propuesta técnica:
     RPC `mercat_ofertes()` `security definer` con lista blanca de columnas y recortar las ramas del
     receptor de la política a lo que necesitan Interessos e Històric; después un check «denegar» de
     `leer` con `columnas: "texto_oferta"` desde una cuenta receptora. **Decisión de producto previa**: si el
     receptor debe ver quién ofrece (la revisión del 23-09 lo pide), y el WhatsApp/correo ya lo mandan.
132. **Un `tecnic` se salta las puertas `pot_aprovar()` escribiendo directo en las tablas** (misma raíz que la
     109). `canalizaciones` tiene INSERT/UPDATE por columnas —incluidas `estado`, `kg_conciliados`, `coste_kg`,
     `conciliada_at`— y DELETE de tabla con la política `es_intern()`, sin trigger de control: puede crear una
     canalización sin `aprovar_resposta()` ni `exigir_convenio()` y conciliar kilos y coste sin
     `conciliar_albaran()`, datos que alimentan `cierre_base` y los certificados fiscales. En `excedentes`,
     `trg_excedentes_validacio` es solo `BEFORE INSERT`: un técnico puede hacer `UPDATE estado='publicada'` y
     saltarse `validar_oferta()` y la revalidación D4. No es explotable desde fuera. Propuesta: trigger
     `before update` que, con `auth.uid() is not null`, rechace los cambios fiscales salvo que la RPC haya fijado
     `set_config('redestina.rpc_fiscal','on',true)` (patrón de `redestina.reinicio_prueba`), o GRANT de UPDATE
     por columnas limitado a las operativas.
133. **`recuperar-password` (`verify_jwt=false`) no tiene ningún freno**: ni límite por IP o por correo, ni
     honeypot. Con `test_mode` apagado, un bucle POST con el correo de la víctima le manda N correos de
     recuperación e invalida los enlaces vivos; el camino «la cuenta existe» tarda más que el otro y permite
     enumerar. Propuesta (solo dentro del stack): 5 intentos/10 min por IP en memoria, un enlace como mucho
     cada 5-15 min por correo mirando `documento_envios`, honeypot, y la misma respuesta 200 genérica siempre.
134. **El anti-abuso de `registro` es débil y las cuentas nacen con el correo sin verificar.** La IP sale de
     `x-forwarded-for` (controlable; también en `enlace-publico` y `verificar-certificat`, y el contador es en
     memoria por isolate), el único freno real son los 20 pendientes por hora —un atacante que rote la cabecera
     bloquea el registro legítimo y deja basura en `auth.users`/organizaciones/convenios— y `email_confirm: true`
     permite reclamar el correo de una organización real con la contraseña del atacante (el equipo aprueba por
     organización, no por titularidad del correo). Turnstile queda descartado (§7).
135. **D3 residual en snapshots y vistas.** `documentos.datos.referencies.registre` de los ENT lleva
     `E-AAMMDD-XXX-YYY-N` (XXX = tres letras del donante; 7 de 8 ENT del clon) y la entidad lee su fila por
     `documents_meus()`; `v_albaranes_bandeja` expone `id_excedente` y `productor_id` a la entidad dueña de
     un ENT; `albaranes.recogida` es jsonb libre y solo `enlace-publico/albaran.ts` tapa `lugar` y
     `responsable_origen` con una lista negra. Arreglo: vistas o RPC que filtren, o sanear al emitir.
136. **Sin code splitting**: las rutas se importan todas de forma estática (un único chunk de 1,65 MB; aviso de
     Vite >500 kB). Propuesta lista: `React.lazy` salvo `Landing`, `LoginUsuaris`, `LoginEquip`, `Comuns` y
     `AppShell`, un `<Suspense fallback={<CarregantSeccio />}>` alrededor de los `<Outlet />` de `AppShell` y
     otro en `ArrelApp`, y escuchar `vite:preloadError` para recargar cuando un despliegue invalida los chunks.
     Pendiente también partir `i18n.tsx` (4.713 líneas) por idioma/módulo.
137. **Los privilegios por defecto de funciones siguen abiertos**: cada función nueva nace con EXECUTE para
     PUBLIC y `anon`. El arnés ya lo detecta con `auditoria_funcions_obertes()` (§4bis), pero la causa
     sigue: propuesta `alter default privileges for role postgres in schema public revoke execute on
     functions from public, anon` (conservando `authenticated`, que algunas RPC del panel usan sin grant
     explícito; el default de `supabase_admin` no se puede cambiar desde `postgres`).
138. **El certificado de recepción no se puede rectificar ni marcar enviado desde la interfaz**: existen las
     RPC (`rectificar_certificat_recepcio`, `marcar_enviat_recepcio`, `20270328101200`) y los envoltorios en
     `src/lib/certificatRecepcio.ts` (`rectificarCertificatRecepcio`, `marcarEnviatRecepcio`) pero ningún
     botón los llama. Brecha funcional, no solo código muerto. (El CT, que tenía el mismo hueco, se retiró el 05-11-2026.)
139. ~~REC mixto~~ **Cerrada el 05-11-2026** (`20270509100000` + `20270509100700`): reproducida en el clon
     (la social salía con 64,29 kg de 50); el neto del REC se reparte ahora entre todas las conciliadas del
     REC y después se descartan las no certificables. Ver §12ter.

140. **`borrar_ficha_completa()` y `bloqueigs_esborrat_fitxa()` no conocen los expedientes de prevención**
     (fase 11, `20270425100000`). La FK `expedients_prevencion.productor_id` es `restrict` a propósito: un
     expediente con su PDF emitido es documentación. Hoy borrar una ficha con expediente falla con `23503`
     (la «última red» de §4) en vez de con `bloqueig_esborrat: expedients` y su motivo. Arreglo: rama
     `expedients` en las dos funciones (bloquea si tiene `numero_completo`; si no, arrastra el expediente).


141. **Sin emisión a la hora de recogida, el bloqueo de 48 h (G1) ya no actúa sobre las recogidas
     nuevas** (17-10-2026, `20270426100000`). `bloqueig_per_albara()` cuenta albaranes `entregado`
     con enlace sin usar, y ahora los albaranes no se emiten hasta que se registra la recogida, así
     que una entidad que no la registra nunca no queda bloqueada. Lo que la empuja es el aviso
     `recollida_per_registrar` y la cola `albarans_esborrany` del equipo. Si se quiere el freno,
     hace falta un bloqueo por «recogida pasada hace > 48 h sin registrar» en `manifestar_interes()`.
     ✅ **Decidido el 17-10-2026 (Carles): de momento se queda SIN freno.** Lo que empuja al receptor es
     el aviso y la cola del equipo; si se quiere el freno, es la propuesta de arriba.

143. **Con WhatsApp apagado, los mensajes que entran se registran pero nadie los ve** (27-10-2026).
     El webhook sigue guardando los entrantes (§5), y Missatgeria desaparece con el canal (§8). Es lo
     pedido —«no deben aparecer los apartados»—, pero si alguien escribe mientras está apagado, el
     equipo solo lo verá al reactivarlo.
144. ~~**El trigger del NIF rechaza filas de la importación masiva**~~ (27-10-2026; **cerrada el
     02-11-2026 por 1E**). `productores_nif`/`entidades_nif` levantan `nif_invalid` y `nif_en_us` al
     insertar, y `scripts/import-ara.ts` era anterior. El importador nuevo (`import-ara-2026.ts`) valida
     el NIF como el trigger antes de insertar: el inválido entra vacío y el repetido lo conserva la
     primera fila, los dos con nota e informe (§6.1); 0 errores en la carga del clon.

146. **`organizacion_contactos` se queda sin uso** (02-11-2026, plan 1 1A, D3 + P6). Un contacto por
     ficha: la sección «Persones de contacte» y `components/ContactesOrganitzacio` se retiraron, y
     `desar_contacte_org()`/`esborrar_contacte_org()` ya no se ejecutan con sesión (solo
     `service_role`). La tabla y sus filas se conservan a propósito (P6: no se borra nada en 1A).
     Arreglo: cuando el plan lo cierre, pasar lo útil al contacto de la ficha y borrar tabla y RPC.
147. ~~**Una ficha nueva desde `RecordDetail` nace con `activo=false`**~~ (02-11-2026, visto en 1A;
     **cerrada en 1C el mismo día**). El formulario genérico guardaba los booleanos sin marcar como
     `false`. Desde 1C `activo` no es un campo de la ficha (`GESTIONATS_PER_COMPONENT`): el alta no lo
     manda y la columna toma su `default true`; se cambia en «Rols» por `activar_fitxa()` /
     `desactivar_fitxa()`, con rastro.
148. **La entidad inactiva sigue viendo las ofertas que ya se le enviaron** (02-11-2026, 1A; decisión
     pendiente). Lo que se apaga es la rama del Mercat (`modalitats_compatibles_meves()`); la de
     historial (`excedents_amb_interes_meu()`) sigue, y esa incluye las respuestas `pendent` de un envío
     por correo o WhatsApp, no solo el interés que mostró. No puede hacer nada con ellas
     (`comprova_interes()` la corta con `entitat_inactiva`, con texto traducido), pero las ve. Si se
     quiere esconderlas, filtrar en esa función las `pendent` de una entidad inactiva.
149. **`v_productores_llistat` y `v_entidades_llistat` se quedan sin consumidor** (02-11-2026, plan 1
     1C). El listado único lee `v_entitats_llistat`; las dos vistas de antes se conservan por la regla
     de compatibilidad hacia atrás (§7: el frontend vigente sigue sirviéndose mientras se publica).
     Arreglo: `drop view` en una migración posterior, cuando 1C lleve publicada un tiempo.
150. ~~**El INSERT directo de fichas del equipo sigue abierto**~~ (02-11-2026, plan 1 1B; **cerrada el mismo
     día con `20270501400000`**, tras publicar 1B: sin políticas `alta intern` ni GRANT de INSERT). Desde 1B el panel
     da de alta solo por `crear_entitat()`, que exige NIF válido, razón social y `tipo_receptor` porque
     la ficha nace activa; pero las políticas `alta intern` de `productores` y `entidades` siguen dejando
     a cualquiera del equipo insertar directo (lo necesita el frontend de 1C mientras se publica 1B, §7),
     y por ahí nace una ficha activa sin NIF. Arreglo: `revoke insert` a `authenticated` y quitar las dos
     políticas en una migración posterior, cuando 1B esté publicada (el registro y el alta asistida
     escriben con `service_role`, no les afecta); el arnés pasará esos `insertar` a «denegar».
     **1B se publicó el 02-11-2026 (`c67e12f`)** y el cierre se hizo esa misma noche.
151. **La rama `alta_assistida` de `registro/alta.ts` queda muerta** (02-11-2026, plan 1 1D, P1). 1D retiró
     la función `alta-assistida`, su diálogo y el modo `assistit` de `FormulariAlta`, pero no tocó
     `registro/alta.ts` (`executarAlta` con `origen = 'alta_assistida'`, `registrat_per`, membresía
     aprobada): cambiarlo obliga a redesplegar `registro`, la función pública, y 1D no la publica. Los
     textos `ASSISTITS` de `textosRgpd` y el valor `alta_assistida` de `consentiments.origen` se quedan a
     propósito (reproducen la huella de los consentimientos ya guardados). Arreglo: quitar la rama y sus
     opciones la próxima vez que se toque y se redespliegue `registro`.
152. **Nadie acepta la privacidad de quien recibe acceso por «Dona-li accés»** (02-11-2026, plan 1 1D, P3).
     `donar-acces` no guarda ningún consentimiento: nadie los acepta por la persona, y aceptar la política
     de privacidad (y ofrecer los dos consentimientos opcionales) en el **primer acceso** es otra pieza de
     seguridad —pantalla de bloqueo + registro con la huella del texto del servidor— que no entró en 1D.
     Mientras el modo test esté encendido, `donar-acces` solo da acceso a organizaciones `es_test`, así
     que no hay nadie real afectado. 🔴 **Condición para apagar el modo test.** Arreglo: una pantalla tras
     el login que exija la privacidad si la cuenta no tiene fila en `consentiments`, con una RPC que la
     guarde con `origen` propio y la huella de `textosRgpd`.
     🟡 **04-11-2026**: el equipo ya puede **pedir** el consentimiento por correo desde la ficha (enlace
     `consentiment_rgpd`, `/consentiment/:token`, sin cuenta; `20270506100000`). Sigue faltando exigirlo
     en el primer acceso a quien entra sin haberlo dado.
153. **La importación del ARA 2026 no crea `productor_ubicaciones`** (02-11-2026, plan 1 1E). Las columnas
     «Coord»/«Coord 2» de Prod traen 14 pares numéricos útiles y mucho texto («Visitat, varies finques»);
     se guardan en la nota «ARA 2026» del comentario, no como lugar de recogida. Arreglo, si se quiere:
     crearlas al activar la ficha, o una pasada del importador que lea la nota.
154. **Código muerto del CT** (05-11-2026, `20270509100400`). El certificado de transacción (venta y maquila)
     se retiró: las tres RPC de emisión responden `22023 certificat_transaccio_retirat` y
     `calcular_cierre_transacciones` no escribe. Siguen vivas, sin uso, `cierre_base_transaccion`,
     `cierre_pendents_transaccion`, `cierre_datos_certificado_transaccion` y la llamada desde
     `congelar_un_cierre`/`congelar_ejercicio`; `render/ct.ts` se conserva para lo ya emitido. Retirarlas
     cuando se decida qué es una venta sin albarán de serie legal (D20, plan 3A).
155. **Una rectificación de certificado reimprime la `data_expedicio` guardada** (05-11-2026). Los
     `rectificar_certificado*` no tienen parámetro para cambiarla: si hace falta otra fecha, se emite de nuevo.
156. **Cómo elige el equipo el ámbito del certificado (oferta, intervalo o ejercicio) lo decide el cliente**
     (05-11-2026). El motor admite los tres; `DialegCertificatDonacio` lleva un selector aislado que se
     ajustará a la respuesta (opción por defecto, orden o quitar alguna). Relacionado: una entidad sin
     `tipo_receptor` queda fuera del certificado (`entitat_no_social:desconegut`) y sale en «Excloses».
