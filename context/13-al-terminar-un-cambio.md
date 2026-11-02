# AGENTS.md §13 — 13. Al terminar cualquier cambio

> Detalle de la sección 13 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §13» del código apuntan aquí.

## 13. Al terminar cualquier cambio

1. **`npm run check`** en verde: tipos de la aplicación **y de las pruebas**, `vitest run` y
   `deno check` de los scripts y las 19 funciones. Sustituye a lanzar los tres a mano.
   Referencia: **1.560 pruebas en 66 ficheros** de Vitest: 1.559 correctas y **1 saltada a propósito**
   (02-11-2026, plan 1 1B: +9 en `novaEntitat.test.ts`, nuevo, y +3 en `campsFitxa.test.ts` por la
   paridad del alta con `crear_entitat()`). Antes, **1.548 en 65** (02-11-2026, plan 1 1A: +1 en `textError.test.ts` por los cinco códigos de estado de la ficha y −1
   en `i18n.test.ts` al retirar el bloque `ct.t_` de los contactos). Antes, **1.530 en 63**
   (27-10-2026, gestión autónoma: el convenio declarado, la escalera de 17 pasos, la recogida asistida y el
   apóstrofo de los avisos; antes **1.477 en 62**, con los mensajes para avisar a mano —`tests/puresa.test.ts`
   y `tests/missatgesOferta.test.ts`—, y antes **1.429 en 60**)
   (27-10-2026, el modo test en `enviar()` y `sendEmail()` y el comodín escapado; antes **1.418**)
   (27-10-2026, los interruptores de notificaciones y el RGPD: `tests/notificacions.test.ts` y
   `tests/registroValidacio.test.ts`; antes **1.392 en 58**)
   (17-10-2026, la validación del admin antes de emitir: `registreRecollida`, `procesOferta`, `pendentsEquip`, `seguentPas`;
   antes **1.348**)
   (17-10-2026, la incidencia de recogida del lado del equipo: `tests/incidenciaRecollida.test.ts`, `textAvis` y
   `procesOferta`; antes **1.334 en 57**: 1.333 correctas y 1 saltada)
   (17-10-2026, la recogida la cierra el receptor: `tests/registreRecollida.test.ts` y el aviso nuevo; tras la fase 11 eran
   1.321 en 56; 12-10-2026, fase 11: `tests/expedient.test.ts` y las claves `exp.*` compuestas; tras la fase 10 eran
   1.311, fase 10: `tests/impacte.test.ts` y las claves `imp.mod_*`; tras la fase 9 eran 1.304, fase 9: los tipos de la ficha viva y las etapas nuevas en `tests/diagnostic.test.ts`;
   tras la fase 8 eran 1.294, fase 8: `tests/periode.test.ts`; tras la fase 7 eran 1.293, fase 7: el vocabulario `ct.t_*`; tras la fase 6 eran 1.292, fase 6: `tests/filtres.test.ts`, el ranking y las franjas `od.fr_*`; tras la fase 5 eran
   1.285, fase 5: `tests/convenisEquivalents.test.ts` y el vocabulario `sig.model_*`; tras la fase 4
   eran 1.280, +3 de las claves compuestas `tan.rev_*` y `tan.skip_sense_revisio`; tras la fase 3
   eran 1.277: `tests/confirmacions.test.ts`), **más 9 de Deno** en `tests/pdf/` (27-10-2026: +3 de `conv_declarat_test.ts`) (`deno test`, dentro
   de `check:deno`). Tras la fase 2 eran **1.273 en 50**: 1.272 correctas y 1 saltada (11-10-2026,
   fase 2 de la revisión del 08-10-2026; tras la fase 1 eran 1.257: `tests/destiFinal.test.ts` y los casos
   nuevos de `procesOferta` y `textAvis`). Antes, **1.239 pruebas en 49 ficheros**: 1.238 correctas y **1 saltada a propósito** (07-10-2026,
   tras la revisión completa: +123 sobre 1.115, de `tests/http.test.ts`, `autorizacion.test.ts`,
   `crearOferta.test.ts`, `enmascarar.test.ts`, `cerca.test.ts`, `format.test.ts`, `textError.test.ts`,
   `tancamentFormat.test.ts`, `esborranyOferta.test.ts`, las 17 de la escalera y la comprobación inversa de
   i18n). Antes, 1.115 pruebas en 40 ficheros: 1.114 correctas y **1 saltada a propósito**, la
   de la cortina con la contraseña buena, que solo corre con `CORTINA_PROVA='…'` (07-10-2026:
   +4 de `tests/urlPublica.test.ts`, la URL firmada del clon local. Antes, 1.111 en 39 (05-10-2026,
   rebanada 4: el interés por producto en la priorización y el filtro del ranking. Rebanada 3: el correo de la recogida programada y `localDateTime`. Rebanada 2: `tests/textAvis.test.ts` y `tests/edicioOferta.test.ts`. Rebanada 1: `tests/modalitats.test.ts` y `tests/franja.test.ts`, más el estado
   «pendent de validació» en `procesOferta.test.ts`. Antes, 1.040 en 35 (05-10-2026:
   +4 de `rankingEntitats.test.ts`, +5 de `filtresMercat.test.ts` y +2 de `varietatSemblaQuantitat`.
   Antes, 1.029 en 33 ficheros. 28-09-2026:
   +9 del correo de los documentos, `tests/correuDocument.test.ts`, y +17 de la cortina,
   `tests/cortina.test.ts`. Antes, 991 y ninguna saltada (28-09-2026:
   +4 de `opcionsVisibles`, las opciones del diagnóstico que derivan de otra respuesta. Antes, 987:
   +1 de la nota de la espigolada en pasado cuando la oferta ya está cerrada. Antes, 986:
   +3 de `estatEfectiuEnllac`, el estado REAL de un enlace —activo y vencido es caducado, porque la
   caducidad no se guarda—, que usan las fichas de convenio y de albarán. Antes, 983 (27-09-2026,
   tarde: +12 de la foto de las ofertas y el coste que declara el productor —`fotoOferta.test.ts`—
   y del paso `cost_kg`; antes 971. Y antes, el 27-09-2026:
   +11 de la ficha de la organización —validaciones y perfil del receptor— y +8 del cuestionario
   de entrega y transporte; antes 952, que subió de 944
   con las 8 de los estados simples de los paneles externos; antes, de 939
   el 22-09-2026: el bloque de claves compuestas pasa a vigilar también `orgdoc.t_*` contra el
   CHECK de `documentos_externos.tipo`, que `20270329100000` amplió — es justo el caso del que
   avisa §7: la lista de valores vive en Postgres y `cobertura.test.ts` no ve un `t(\`…${tipo}\`)`).
   ⚠️ Y desde el 14-09-2026 `check` corre además **`npm run lint`** (las dos reglas de
   `react-hooks`, línea base en cero, §12.1). Lo mismo corre el CI en cada push y PR.
   El hook de `.githooks/pre-commit` hace lo mismo antes de cada commit, si está instalado
   (`git config core.hooksPath .githooks`, una vez por clon).
2. `npm run build` si el cambio toca `src/`: `tsc` ya va en `check`, pero el empaquetado no.
3. `deno run -A scripts/comprobar-rls.ts` si el cambio toca datos, políticas o roles, y
   `deno run -A scripts/prueba-numeracion.ts` si toca la numeración documental.
   ⚠️ **17-10-2026**: `20270426100000` añade 2 checks en `DOCUMENTAL_EXTERN` + `rec_te_incidencia_recollida` y 2 en el
   bloque del equipo (`registrar_recollida` y `confirmar_part_declarada`, todos `denegar`). Contra el clon, con
   `20270427100000` aplicada (no cambia permisos), da **1.455/1.455 y 28 sin datos**. Con `20270428100000` (+19: `validar_recollida`
   y `retornar_recollida` denegadas a externos y al técnico, permitidas al super_admin con uuid inventado; `confirmar_recollida` pasa a
   denegar al técnico) da **1.474/1.474 y 28 sin datos** en el clon, y **la misma cifra contra producción** tras publicar `6285ad5`
   el 17-10-2026 (las tres migraciones `20270426100000`…`20270428100000` y `enviar-avis`).
   ⚠️ **27-10-2026**: `20270429100000`/`100100` añaden 25 checks (`fixar_notificacions`,
   `fixar_canal_notificacio` y el insert en `consentiments`, denegados a las siete cuentas externas y al
   equipo; `fixar_canal_notificacio` permitido al super_admin con un canal inventado → `22023`). Contra
   el clon da **1.499/1.499 y 28 sin datos**, y **la misma cifra contra producción** tras publicar `7a5f9b2` el
   27-10-2026 (las dos migraciones `20270429100000`/`100100`, las 20 funciones y el frontend).
   ⚠️ **27-10-2026, gestión autónoma**: `20270430100000`…`100200` añaden 50 checks (seis denegados a las siete
   cuentas externas —`declarar_conveni`, `registrar_envio_manual`, `registrar_recollida_assistida`,
   `fixar_hora_recollida` y las dos internas—, seis en el bloque del técnico y dos permitidos al super_admin con
   un tipo o un uuid inventados). Contra el clon da **1.549/1.549 y 28 sin datos**.
   `20270430100300` añade uno más en `DOCUMENTAL_EXTERN` (`avisos_de_oferta` sobre una oferta ajena, vacío
   = rechazo, ×7 cuentas). Con las fases 1-5 y el clon reconstruido da **1.558/1.558 y 26 sin datos**, y
   **contra producción, tras publicar `3907281`, 1.556/1.556 y 28 sin datos**: el mismo total (1.584), con
   otros datos. Después el clon se recargó con un volcado de ese día (183 migraciones), así que ahora
   coinciden.
   Con `20270430100400` (deuda 145, sin checks nuevos) el clon da 1.555/1.555 y 29 sin datos: el mismo
   total, con los datos que dejan las E2E.
   **Plan 1, rebanada 1A (`20270501100000`, 02-11-2026): +64 checks.** Siete en `DOCUMENTAL_EXTERN`
   (×7 cuentas: `cerca_entitats`, `activar_fitxa`, `desactivar_fitxa`, `desactivar_organitzacio`,
   `afegir_paper_org_equip`, y leer e insertar en `fitxa_estat_hist`, todo denegado), siete nuevos en
   el técnico (busca y lee el historial; activar, desactivar, desactivar la organización y añadir un
   papel, no) más los dos de contactos, que pasan de «permitir» a «denegar» (D3), y ocho en el
   super_admin (los cuatro de estado con uuid inventado → 22023, la búsqueda, el historial y el
   contacto denegado). **Clon, tras 1B: 1.637/1.637 y 29 sin datos (total 1.666; 1B añadió 9: `crear_entitat`
   denegado a las siete externas, permitido con `22023` al técnico y al super_admin)**; antes de 1B,
   1.628/1.628 y 29 (total 1.657; 1C añadió 9, `v_entitats_llistat`); las dos «sin datos»
   nuevas son `fitxa_estat_hist` leída por el equipo, vacía hasta el primer cambio de estado.
   **Producción, tras publicar `a07dd6a` (1C) el 02-11-2026: 1.634/1.634 y 23 sin datos** (al publicar
   1B deben ser 1.643/1.643 y 23), el mismo
   total (1.657); tras `3ec6dba` (1A) eran 1.625/1.625 y 23. Tiene menos «sin datos» que el clon
   porque sus fichas de prueba tienen más filas propias.
   ✅ **Referencia HOY: 1.432/1.432 correctas y 28 sin datos, «Sin fallos de permisos»** —la misma cifra en el clon y en producción, confirmada al publicar `497a7fa` el 12-10-2026—
   (12-10-2026, tras la fase 11 —el expediente de prevención: +58—; tras la fase 10 eran 1.374, tras la fase 10 —factores e impacto: +39; las «sin datos» bajan a 29 porque las E2E
   dejan historial de diagnóstico en el clon—; tras la fase 9 eran 1.335, tras la fase 9 —`diagnostics_historial` y `emitir_plan_basico`: +16; las dos «sin
   datos» nuevas son la lectura del historial por el equipo, que no tiene fixture—; tras la fase 8
   eran 1.319, tras la fase 8 —`kpis_equip`: +8—; tras la fase 7 eran 1.311, tras la fase 7 —catálogo de actividades, contactos y «afegir paper»: +52—; tras la fase 5
   eran 1.259, tras la fase 5 —`convenis_equivalents` y `conveni_cobreix_tot`: +16; cinco checks más «sin
   datos» porque la migración retira los convenios anteriores a medio firmar del clon—; tras la fase 4 —las dos RPC de revisión y el snapshot: +25; las «sin datos» bajan a 24
   porque las pruebas E2E dejan datos en el clon—; tras la fase 3 —`confirmar_recollida` denegada a las siete cuentas externas y permitida al
   equipo con uuid inventado, y las dos funciones internas sin EXECUTE: +16—; tras la fase 2 eran 1.202,
   tras la fase 2 —`operacio_detall`, `declinar_oferta` y `marcar_canvis_revisats`: +23—; tras
   la fase 1 eran 1.179, `20270416100000`/`100100`: +23 del destino final —`registrar_desti_final` denegada
   e `excedente_destins` sin escritura en las siete cuentas externas, `destins_finals` legible, y dos
   checks del equipo—). La anterior:
   **1.156/1.156 correctas y 26 sin datos** (07-10-2026,
   tras `20270414100000`…`20270414101100`; medida primero contra el clon local y **confirmada contra
   producción al publicar `0034a92`**, la misma cifra en las dos bases). Sube **104** sobre la anterior (1.052): **18** de
   la conciliación y el CT (`emitir_certificados_transaccion_cierre` y `albarans_germans_rec`, denegados a las
   siete cuentas externas y al equipo, permitida la primera al super_admin con uuid inventado), **93** de la
   auditoría de funciones (11 en `DOCUMENTAL_EXTERN` × 7 cuentas, 10 en `equip`, el check global
   `auditoria_funcions_obertes` y los de `convenio_vigente` sobre la ficha propia y la ajena) y −7 por el check
   de `convenio_vigente` ajeno, que pasó de «permitir» a «denegar». La migración de desempate del cierre
   (`20270414101100`) no añadió ninguno. Antes, 1.052/1.052 (06-10-2026,
   tras publicar las rebanadas 0-4: `20270408100000`…`20270412100000`). Sube **64** sobre la anterior
   (988): los checks de `descartar_convenio_esborrany` y de las RPC nuevas, multiplicados por las
   cuentas de cada bloque. Las saltadas bajan de 28 a 26 por datos, no por permisos. La cuenta
   `pendent-arnes` seguía en `pendent` tras la pasada (§9).
   La referencia anterior era:
   **988/988 correctas y 28 saltadas, «Sin fallos de permisos»** (28-09-2026,
   tras `20270406100300`: +9 de `recalcula_estat_espigolada`, denegada a las siete cuentas externas
   y a las dos del equipo —la llama solo el trigger—). La anterior: **979/979** (28-09-2026,
   tras `20270406100000`: +5 de `exercici_dels_meus_tancaments`, permitida a las dos cuentas de
   productor y vacía para las tres de receptor). La anterior: **974/974 y 28 saltadas** (27-09-2026,
   tarde, tras `20270405100000`…`100200`: +10 —`fixar_foto_producte` denegada a las siete cuentas
   externas y al técnico y permitida al super_admin, y `borrar_coste_producto` permitida—, todas
   sobre un producto INEXISTENTE o con coste 0: el arnés ya no escribe ningún coste).
   La anterior: **964/964 correctas y 28 saltadas** (27-09-2026,
   tras las fotos: +7 de `fixar_fotos_oferta` sobre una oferta ajena, en las siete cuentas
   externas). La anterior, del mismo día: **957/957 correctas y 28 saltadas** (27-09-2026,
   tras el bloque B de la revisión: +14 de `actualitzar_fitxa_productor` y `_entitat` —dos checks
   de «denegar» sobre una ficha ajena, en las siete cuentas externas—).
   La referencia anterior del mismo día era **943/943 correctas y 28 saltadas** (27-09-2026,
   tras `20270330100000`). **El total no se movió (971)**: la migración solo amplía una matriz
   de catálogo, y dos comprobaciones pasaron de correctas a «sin datos» porque desapareció la
   fila de prueba que las alimentaba —las de «producte al camp» del productor, entre otras—,
   no porque cambiara ningún permiso. Antes de esta cifra hubo que devolver `pendent-arnes` a
   pendiente (§9): aprobada, sacaba las cuatro FALLA de siempre.
   La referencia anterior era **945/945 correctas y 26 saltadas, «Sin fallos de permisos»**
   (22-09-2026, tras `20270329100000`…`100300`: la documentación de la organización y el
   convenio en papel). Son las 925 anteriores más **20**: `preparar_conveni_en_paper` y
   `registrar_conveni_en_paper` en `DOCUMENTAL_EXTERN` —que recorre **siete** cuentas
   externas, de ahí 14—, las mismas dos en `equip` (denegar: son de `es_super_admin()`, no de
   `es_intern()` ni de `pot_aprovar()`) y en `super_admin` (permitir), más la lectura de
   `documentos_externos` por el propio productor.
   ⚠️ Los dos «permitir» del super_admin van con **uuid de ceros**, y en positivo no se
   prueban nunca: `preparar_conveni_en_paper` CREA un borrador de convenio sobre una
   organización real, y `registrar_conveni_en_paper` la dejaría **operando sin haber firmado
   nada** contra producción. Cortan con `23503` y `22023`, que son errores de negocio y
   prueban que la guarda autorizó. Mismo criterio que `borrar_ficha_completa()`.
   ⚠️ **Las saltadas siguen siendo 26 y una de ellas es nueva**: la lectura de
   `documentos_externos` del productor no tiene fixture —hace falta un externo subido a SU
   ficha—, así que 0 filas es indistinguible de un rechazo y sale SALTADA, no verde.
   La referencia anterior era **925/925 + 26**
   (22-09-2026, tras `20260922124240`, la quinta rama de la RLS de `excedentes`).
   ⚠️ **El total era entonces 951 y no había ninguna FALLA**: lo que cambió respecto de la
   referencia anterior no son permisos sino **datos** —cuatro checks pasaron de correctos a
   «sin fila que probar» al cancelarse la oferta de prueba que se creó ese mismo día para
   revisar el ciclo—. Es exactamente el caso del que avisa el párrafo de más abajo: antes de
   buscar una regresión por un desfase de esta cifra, mirar si han aparecido o desaparecido
   datos. La migración **no movió ni un check**, que es lo esperado: solo amplía lo que una
   receptora ve de sus propias entregas, y el arnés no tenía ningún check sobre eso (por eso
   el fallo pudo existir, §4bis).
   La referencia inmediatamente anterior era **929/929 + 22** (22-09-2026, tras aplicar las
   cinco migraciones del diagnóstico, `20260921231946`…`231950`). Eran las 827 anteriores más **102**: doce checks en
   `DOCUMENTAL_EXTERN` ×7 cuentas —el cuestionario **sí** lo ve cualquiera con sesión, porque
   es lo que tiene que contestar; el catálogo de medidas y las reglas, no— más nueve en
   `equip` y nueve en `super_admin`.
   ⚠️ Dos de los «permitir» van con **las preguntas vacías a propósito**: la guarda de rol deja
   pasar y entonces la validación levanta `22023` antes del insert, así que se comprueba que el
   super_admin autoriza **sin publicar una versión de verdad** — que retiraría la vigente en
   producción. Mismo criterio que `borrar_ficha_completa()`.
   La referencia anterior era **827/827 + 22**
   (22-09-2026, tras aplicar `20260921223245` y `…223246`). Son las 745 anteriores más **82**
   del certificado de recepción: ocho checks en `DOCUMENTAL_EXTERN` —nada de ese circuito es
   de un externo—, nueve en `equip` (incluido el `42703` que vigila que **no aparezca nunca**
   una columna de importe), siete en `super_admin`, tres por cuenta de productor y de
   receptor, y dos en `sense_rol` y `pendent`.
   ⚠️ **Dos de ellos salieron en rojo la primera vez y el error estaba en el CHECK, no en la
   base**: dimos por hecho que `kg_rebuts_exercici()` no devolvería ni una fila a un
   generador, y sí lo hace — es `security invoker` y un productor ve las `canalizaciones` de
   sus propias ofertas (§4). Medido antes de tocar nada: la RPC y sus canalizaciones
   visibles **cuadran al kilo**, o sea que el agregado no le da ningún dato nuevo. El check
   pasó a `permitir` con la medición escrita al lado.
   La referencia anterior era **745/745 + 13** (22-09-2026, tras aplicar `20260921221806`). Son las 732 anteriores más **13** de la
   conversión de ofertas en espigolada: `crear_espigolada` **denegar** en `DOCUMENTAL_EXTERN`
   —siete cuentas externas, más `sense_rol` y `pendent`, de ahí 9— y **permitir** en `tecnic` y
   en `super_admin`, más la columna `oferta_origen_id` en el `leer` de `espigoladas` del equipo
   y los dos del productor (ve `producte_al_camp` de su oferta, **no la escribe**).
   ⚠️ Los dos «permitir» van contra un **uuid de ceros**: lo que miden es que la guarda de ROL
   deja pasar, no que la conversión funcione. En positivo **no se prueba nunca** — convertir una
   oferta real la sacaría del mercado y le montaría un REC, contra producción—, el mismo criterio
   que `borrar_ficha_completa()`.
   La referencia anterior era **732/732 + 13**
   (21-09-2026, tras aplicar `20260921211329` y `20260921211356`). Eran las 723 anteriores
   más **9** de la tanda de certificados sin factura: `emitir_certificados_cierre` con un
   check en `DOCUMENTAL_EXTERN` —que recorre siete cuentas externas, de ahí 7— más uno en
   `tecnic` y otro en `super_admin`. ⚠️ Los tres son `rpc` sobre un **uuid de ceros**: lo
   que afirman es que la guarda de ROL decide bien, no que la tanda se complete. En
   positivo **no se prueba nunca**, porque una sola llamada buena quemaría N números de la
   serie `CD` y mandaría N correos — el mismo criterio que `borrar_ficha_completa()`.
   ⚠️ **Lo que SÍ se ejercitó, y fuera del arnés**: la tanda entera sobre el cierre de
   prueba, en una transacción revertida y con `datos_provisionales` desmarcado dentro de
   ella (1 emitido, 1 saltado por `bloquejat`, snapshot con `factura` a null, series
   devueltas a 0 y **cero peticiones en la cola de `pg_net`**, o sea ningún correo). Es la
   única forma de comprobar el camino bueno sin consumir numeración legal.
   Antes de esto eran **723/723 + 13** (21-09-2026, tras `scripts/escenari-demo.ts`). Ahí
   el número subió **a la vez que se perdía cobertura**, y las dos cosas juntas merecen
   leerse despacio: se retiró el bloque
   `doble_rol` (~15 checks propios, más los compartidos de `DOCUMENTAL_EXTERN`) porque ya
   no queda ninguna cuenta de prueba con dos papeles activos (§9), y la única cuenta que lo
   ejercitaba (`hola+wa-carles@`) pasó a evaluarse contra el bloque `receptor` completo, que
   tiene más filas. El total sube por eso, no porque se haya ganado nada: la garantía real
   que se pierde —«ver dos paneles a la vez no es ver dos veces la base»— hoy no la comprueba
   nadie, y se anota como tal en la cabecera de `scripts/comprobar-rls.ts`.
   Antes de eso eran 713/713 + 14: las 686 anteriores más **27**, de la vía asistida
   (`20260921160536`…`20260921161008`): tres checks en `DOCUMENTAL_EXTERN` —que recorre
   **siete** cuentas externas, de ahí 21— y los mismos tres en los dos bloques de equipo.
   ⚠️ Los tres «permitir» se llaman con un uuid **inexistente** a propósito: lo que afirman
   es que la guarda de ROL deja pasar, no que la operación se complete.
   `acunar_enllac_assistit()` escribe —acuña un enlace y revoca el anterior—, así que
   ejercitarla en positivo contra producción le rompería el enlace a alguien de verdad. Es
   el mismo criterio de `borrar_ficha_completa()`.
   Antes de eso eran 668 más **18**: el borrado único de una ficha
   (`20260921153439`, deuda 108) mete dos checks en `DOCUMENTAL_EXTERN` —que recorre siete
   cuentas externas— y dos en cada bloque del equipo (`tecnic`, `super_admin`). ⚠️ Ninguno de
   los 18 ejercita `borrar_ficha_completa()` contra una ficha de verdad: el arnés corre contra
   producción y una regresión del bloqueo **borraría la ficha**. Lo positivo lo mide
   `bloqueigs_esborrat_fitxa()`, que es de solo lectura. **Cualquier FALLA es una regresión.**
   Referencia anterior, **668/668 correctas y 14 saltadas**: se recuperó arreglando **las dos
   cuentas que el arnés necesita y que llevaban días mudas o mintiendo**: `hola+wa-carles@`
   (bloque `doble-rol`, ~74 comprobaciones) tenía la contraseña desincronizada con el repo y se
   alineó con la Admin API (§9), y `hola+pendent-arnes@` estaba aprobada por error y se
   devolvió a `pendent` (§9).
   ⚠️ **Sube a 14 saltadas, no baja**, y no es una pérdida nueva: las tres que se suman son
   del bloque `doble-rol`, que antes no se recorría en absoluto —`oferta_respuestas`,
   `progres_meves_ofertes` y `albaranes` de esa cuenta—. Le faltan datos: las fichas de Carles
   se recrearon el 16-09 y no tienen ni respuestas ni ofertas activas ni albaranes. O sea que
   pasar de 595/596 a 668/668 **no es +73 checks nuevos**: es cobertura que vuelve.
   Referencia **anterior**, tras las RPC del proceso
   (`20270323100000`, `20270324100000`): **669/669 correctas y 13 saltadas**, «Sin fallos de
   permisos», exit 0. **No se movió** al
   revocar el UPDATE de tabla de `parametros_documentales` (`20270325100000`, §12.104), y eso
   era lo esperado: esa migración repone una capa que ninguna política alcanzaba. Son las 650 anteriores
   más 19: `pendents_equip` (permitir ×2, denegar ×7), `progres_meves_ofertes` (×5) y la lectura
   de `oferta_respuestas` por cuenta externa (×5: `denegar` en productor, `permitir` en receptor y
   **en doble rol**, que ve por su ficha de entidad lo que ella misma contestó — un `denegar` ahí
   habría sido rojo del check, no de la política).
   ⚠️ Y la rama `rpc` del arnés **ahora cuenta filas**: hasta ese día daba por buena cualquier
   llamada sin error, así que un puente que devolviera vacío salía verde igual que uno correcto.
   Con `requiereFixture` sale saltada, y el flag `vacioEsDenegar` (solo `rpc`+`denegar`) declara
   que «0 filas» es el rechazo esperado.
   (La de antes era 650/650 + 13; la saltada que bajó fue `equip · documento_envios`, §12.53.)
   ⚠️ **El salto de 504 a 649 no es de checks nuevos, es de COBERTURA**: al dar de alta las cuentas
   `pendent` y `sense_rol` (deuda 32) empezaron a recorrerse dos bloques que llevaban desde julio
   escritos y sin ejecutar. Antes de leer un desfase de esta cifra, mirar cuántas **cuentas** tiene
   `cuentas-prueba.json`: son 9. Las 504 anteriores eran las 497 más los **7** checks
   nuevos de la deuda 55 —`enlaces_token.codigo_hash` en el bloque del equipo, y
   `documentos.envio` en el del equipo y en `DOCUMENTAL_EXTERN`, que recorren 5 cuentas—. Todos
   son `denegar`, así que ninguno puede quedar saltado.
   ⚠️ **Esos checks hay que correrlos DESPUÉS de aplicar `20270320100300`, no antes.** Contra una
   base sin esa migración salen en **rojo a propósito**, porque la columna todavía es legible: es
   la prueba de que el check mide algo, no una regresión.
   (Verificada también tras acotar `reiniciar_documentos_prova()`, `20270319100000`: ahí **no se
   movió**, que era lo correcto — esa migración no toca ningún permiso.)
   ⚠️ **Y ya se sabe por qué son 14 y no menos**: ocho de ellas son del bloque
   `productor-altre`, la cuenta de `TEST-PROD-2`, y el fixture crea sus datos en
   `TEST-PROD-1` (deuda 53). No es cobertura perdida por una regresión: son datos que no
   existen, y ampliar el fixture costaría más números de series legales.
   ⚠️ **Subió 12, no 4, y el motivo conviene tenerlo claro al leer un desfase**: los checks
   nuevos son **dos** (`pendents_meus` permitir y `acunar_enllac_propi` denegar), pero la
   matriz se declara **por bloque y se ejecuta por cuenta**, así que dos checks en el bloque
   externo y en el del equipo salen multiplicados por las cuentas de cada bloque. Contar
   checks declarados y comprobaciones ejecutadas como si fueran lo mismo hace parecer una
   regresión lo que es aritmética.
   (Era 485/485 + 14 antes de esta tanda; 480/480 + 14 antes del check de `data_tall_convenis`; 442/442 + 52
   tras la etapa 3 de la organización unificada; 432/432 + 52 antes de las guardas de
   `enllacar_organitzacio` y `organitzacions_candidates`; 408/408 antes de los checks de
   `organizaciones` y `v_organizaciones`, que hasta aquella publicación no tenían tabla contra
   la que correr en remoto; y 329/329 + 46 antes del certificado a demanda.)
   ⚠️ **Esta cifra depende de qué DATOS haya en la base, no solo de qué checks existan, y el
   14-09-2026 eso se vio de golpe**: las saltadas cayeron de 52 a 14 y las correctas subieron de
   442 a 480 **sin una sola migración ni un check nuevo** — el total, 494, era idéntico—. Lo que
   cambió es que **apareció en producción el fixture de `crear-datos-documentales-prueba.ts`**
   (9 albaranes, 15 documentos, un cierre, dos convenios), así que 38 comprobaciones que no
   tenían qué mirar pasaron a ejecutarse. Consecuencia al leer un desfase: **antes de buscar una
   regresión, mirar si han aparecido o desaparecido datos**, porque una cifra que sube sin
   checks nuevos no es una mejora, es otro contenido de la base.
   ⚠️ Y ese fixture **no debería estar ahí**: este párrafo decía —y sigue valiendo como norma—
   que producción no tiene ni debe tener datos de prueba. Mientras siga, esta es la referencia;
   si se retira, las saltadas vuelven a ~52 y las correctas bajan en la misma proporción. Los
   documentos que dejó están en `modo = 'real'` y han consumido números de las series legales
   (`REC-2026-00001`, `ENT-2026-00001`…`00004`, `OPE-2026-00001`, `CONV-DON-GEN-2026-0001`,
   `PLA-2026-0001/2`), y **no se pueden borrar**: `documentos_no_esborrar` solo permite el
   `delete` con `modo = 'prueba'` (§4). O sea que el primer albarán real de 2026 será el `00002`.
   ✅ **Y contra el clon local da exactamente la misma cifra** (07-10-2026: 1.052/1.052 y 26 sin
   datos), porque el clon lleva las mismas cuentas y los mismos datos. Se ejecuta con
   `eval "$(bash scripts/local/entorno-local.sh)"` delante (§11). Si las dos cifras divergen, o el
   clon está desfasado (refrescarlo) o algo distinto se ha aplicado en uno de los dos. La
   referencia del stack local anterior (411, hasta el 14-09-2026) ya no vale para nada.
   **Cualquier FALLA es una regresión**: ya no hay rojos «conocidos y correctos» que haya que
   aprender a ignorar (§12.48). Una cuenta que no existe en esa base tampoco es un fallo: sale
   SALTADA, con el mismo criterio.
4. Para **publicar en producción**, el skill `/publicar` (§11): aplica las migraciones,
   redespliega las Edge Functions que lo necesiten, publica el frontend —en ese orden, §11— y
   comprueba dominio, CORS y permisos.
5. Si el cambio toca estilos: ningún color ni tamaño fuera de los tokens (§2bis); si cambió un
   token, `design/tokens.json`, `src/index.css` y `design/preview.html` van en el mismo commit.
6. **Actualizar este fichero** si cambió arquitectura, datos, contratos, convenciones,
   comandos o deuda técnica; y **§1bis + su tabla de correspondencia** si cambió el alcance
   funcional o el estado de implementación (✅/🟡/⬜).
7. Commit en castellano, describiendo el *qué* y el *por qué*.
