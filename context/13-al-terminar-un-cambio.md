# AGENTS.md §13 — 13. Al terminar cualquier cambio

> Detalle de la sección 13 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §13» del código apuntan aquí.

## 13. Al terminar cualquier cambio

1. **`npm run check`** en verde: tipos de la aplicación **y de las pruebas**, `vitest run` y
   `deno check` de los scripts y las 19 funciones. Sustituye a lanzar los tres a mano.
   Referencia: **1.922 pruebas en 88 ficheros** de Vitest (1 saltada a propósito) **+ 52 de Deno** (10-11-2026, deuda
   174-178: +5 de `admesaPerNaturalesa` en `priorizacion.test.ts`; F·H·V en `naturalesa.test.ts`). Antes,
   **1.899 pruebas en 87 ficheros** de Vitest **+ 52 de Deno** del PDF
   (10-11-2026, Plan 2 A3: `tests/excedentsDiagnostic.test.ts` y `tests/excedentsLlegible.test.ts`, nuevos —paridad de
   `ETIQUETES_EXCEDENTS` con i18n, listas cerradas = CHECK de la migración, `CAUSES_ES` = `causas.nombre_es`—; salen unas
   54 pruebas del motor genérico del cuestionario de `tests/diagnostic.test.ts`; 5 nuevas de Deno en `tests/pdf/`
   diagnostic y expedient; arnés del clon **2.548/2.548 y 57 sin datos**, 95 checks nuevos, ningún flip; los 17 «sin datos»
   de más: 3 lecturas de `productor-altre` sin excedentes y 14 de `questionaris_diagnostic`/`questionari_vigent` de las
   externas, sin cuestionario vigente desde A3, deuda 175; producción, estimado 2.543 y ~62 sin datos tras publicar.
   Antes, **1.899 en 85 + 47 de Deno**: 10-11-2026, Plan 2 A2: `tests/diagnosticPdf.test.ts` nuevo, la paridad de `ETIQUETES_OPERATIVA` en
   `operativaLlegible.test.ts`, el hoja nuevo en `puresa.test.ts` y `tests/pdf/diagnostic_test.ts`, 4 de Deno; sin arnés:
   ni RPC ni política nuevas. Antes, **1.887 en 84 + 43 de Deno**: 10-11-2026, Plan 2 A4: `tests/predeterminatsOferta.test.ts` y `tests/operativaLlegible.test.ts`, nuevos, y las
   columnas de la Operativa en `campsFitxa.test.ts`; arnés del clon **2.470/2.470 y 40 sin datos**, 30 checks nuevos de
   `fixar_lloc_principal`, la lista blanca y los CHECK de la Operativa. Antes, **1.863 en 81**: 10-11-2026, Plan 2 A1: `tests/diagnostic.test.ts` reescrito —fuera el punto del proceso y las medidas, dentro
   `seccionsAmbEstat`/`respostaLlegible`— y `tests/pdf/expedient_test.ts`, 4 nuevas de Deno; arnés del clon 2.440/2.440 y 39
   sin datos, 56 checks nuevos y tres `permitir` del plan básico convertidos en `denegar`. Antes, 1.807 en 78 y 39 de Deno: 09-11-2026, Taula mestra fiscal: +1 en `i18n.test.ts` por la familia `org.iva_*`, y más casos en `importEntitats`, `perfilReceptor` y `campsFitxa`; antes 1.806, auditoría del equipo: +4 en `tests/equip.test.ts`, y `tests/pdf/fundacio_test.ts`, 14 nuevas de Deno; antes 1.802, pestañas del equipo y destino del mismo rol: +2 en `tests/equip.test.ts`; antes, 1.800, Configuració › Equip: `tests/equip.test.ts`, 17 pruebas, y las claves compuestas `eq.*` en `i18n.test.ts`;
   antes, 1.763 en 76 tras el importador de entidades). Antes, **1.763 en 76**:    (06-11-2026, importador de entidades: `tests/importEntitats.test.ts`, nuevo, 32 pruebas, y las familias
   `ie.c_*` en `i18n.test.ts`; antes, 1.720 en 75 tras el circuito de firma). Antes, **1.639 en 71**
   (04-11-2026, envío manual: +10 en `enviamentManual.test.ts`, nuevo, y +2 en `i18n.test.ts` por
   `alb.env_r_*` y `alb.env_e_*`). Antes, **1.629 en 70** (04-11-2026, «Copia l’enllaç»: +1 en `consentiments.test.ts`). Antes, **1.628** (04-11-2026,
   consentimiento por enlace: +5 en `consentiments.test.ts`, nuevo). Antes, **1.623 en 69** (04-11-2026, Taula mestra 1.5: +3 en `notesInternes.test.ts` y +3 en `i18n.test.ts` por `ni.tipus_*`,
   `ni.seg_*` y `el.seg_*`). Antes, **1.617** (02-11-2026, plan 1 1E: +22 en `importAra2026.test.ts`, nuevo). Antes, **1.595 en 68** (02-11-2026, plan 1 1F: +7 en `notesInternes.test.ts`, nuevo, y +1 en `i18n.test.ts` por la clave
   compuesta `ni.canal_*`). Antes, **1.587 en 67** (02-11-2026, plan 1 1D: +26 en `donarAcces.test.ts`, nuevo, y +1 en `i18n.test.ts` por la clave
   compuesta `acc.estat_*`). Antes, **1.560 en 66** (02-11-2026, plan 1 1B: +9 en `novaEntitat.test.ts`, nuevo, y +3 en `campsFitxa.test.ts` por la
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
   contacto denegado). **Plan 2 B2 (plantilla con desplegables, 10-11-2026, sin migración ni RPC: el arnés no cambia): Vitest 1.839 en 80 ficheros (+12: `tests/excelValidacions.test.ts` y el fichero .xlsx real en `importEntitats.test.ts`); E2E `importa-entitats` 3/3 en el clon (la plantilla descargada lleva los seis desplegables y los 947 municipios).** **Clon, tras el estado CRM por papel (Plan 2 B1, `20270518100000`, 10-11-2026): 2.351/2.351 y 36 sin datos (+16: `fixar_estat_crm` denegada a las siete cuentas externas con dos checks cada una y al técnico, permitida al super_admin con uuid inventado → `22023 fitxa_inexistent`). Vitest 1.827 en 79 ficheros (+7: `tests/estatCrm.test.ts`, `estatCrmDeHoja`, priorización sin `estat`).** **Clon, tras la naturalesa (Plan 2 A5, `20270523100000`, 10-11-2026): 2.609/2.609 y 57 sin datos (+61 sobre 2.548: `modalitat_naturalesa_compat` leer/insertar, `naturalesa_suggerida`, `refresca_naturalesa_suggerida` y el UPDATE de `organizaciones` en los nueve perfiles; `fixar_naturalesa` denegada a los externos sobre otra organización y permitida al titular sobre la suya y al equipo, todas con `22023`). Vitest 1.917 en 88 ficheros (+18: `tests/naturalesa.test.ts` y `campsPerfil`); E2E `perfil-recepcio` 4/4 e `importa-entitats` 8/8 en el clon. Publicado el 10-11-2026.** **Producción, tras publicar la deuda 140 (`687d610`, solo `20270525100000`, sin funciones) el 10-11-2026: 2.473/2.473 y 49 sin datos (total 2.522: el check nuevo queda «sin datos» porque producción no tiene ningún expediente de prevención, ni con número ni sin él); productores (10) y entidades (9) sin cambios.** **Clon, tras la deuda 140 (`20270525100000`, 10-11-2026): 2.479/2.479 y 43 sin datos (+1: `bloqueigs_esborrat_fitxa` del super_admin sobre un productor con un expediente numerado exige el código `expedients`, marcador `@fitxa_amb_expedient`). Vitest 1.922 en 88 ficheros, sin cambios (el código nuevo entra en la lista de `tests/i18n.test.ts`). Probado en el clon y deshecho: sin número, la ficha se borra con el expediente y su evidencia; con número, `bloqueig_esborrat: expedients`.** **Clon, tras la deuda 174-178 (`20270524100000`, 10-11-2026): 2.478/2.478 y 43 sin datos (total 2.521: −145 checks de lo que se retiró —cuestionario, plan básico, historial— y los 14 «sin datos» del cuestionario con ellos). E2E `diagnostic`, `perfil-recepcio` y `pla-prevencio` 13/13 en escritorio; ranking probado en el clon (una empresa confirmada sale de una oferta solo de donación). Publicado el 10-11-2026.** **Producción, tras publicar la deuda 174-178 (`1e6eab4`, `20270524100000` + `priorizar-entidades`) el 10-11-2026: 2.473/2.473 y 48 sin datos (total 2.521, el mismo que el clon: −145 sobre 2.666); antes de borrar se respaldaron el historial (1 fila), 5 cuestionarios, 20 medidas y 39 reglas en `scripts/data/`; planes (4), documentos PLA (4) y naturalesas (13 empresa sugerida, 3 sin) sin cambios; `priorizar-entidades` 401 sin sesión.** **Producción, tras publicar A5 (`e31cc67`, solo `20270523100000`, sin funciones) el 10-11-2026: 2.604/2.604 y 62 sin datos (+61 sobre 2.543, los checks nuevos de A5); 13 organizaciones con naturalesa «empresa» sugerida y 3 sin sugerencia, ninguna confirmada (P8 sin efecto todavía); `exportar_entitats` saca las mismas 15 filas que antes.** **Producción, tras publicar A3 (`dda296e`, `20270522100000` + `diagnostic-pdf` y `generar-documento`) el 10-11-2026: 2.543/2.543 y 62 sin datos (+69 sobre 2.474; 26 «sin datos» más porque producción no tiene excedentes ni acciones de diagnóstico todavía); documento de prueba de 6 páginas y 123.618 bytes; `diagnostic-pdf` 200/403/401 con las cuentas de prueba.** **Producción, tras publicar A2 (`7256757`, solo la función nueva `diagnostic-pdf`, con JWT) el 10-11-2026: sin migración ni checks nuevos (el arnés no cambia); descarga real con cuentas de prueba: titular 200 `application/pdf` de 1 página y 107.442 bytes, otro productor 403, sin sesión 401, equipo 200; CORS al dominio.** **Producción, tras publicar A4 (`f767350`, `20270521100000` + `crear-oferta`, `whatsapp-webhook`, `recollides-programades`) el 10-11-2026: 2.474/2.474 y 36 sin datos (+31 sobre 2.443; cuestionario de productor v3 vigente; ningún productor tenía varios lugares principales).** **Producción, tras publicar A1 (`ac4213d`, `20270520100000` + `generar-documento`) el 10-11-2026: 2.443/2.443 y 36 sin datos (+54 sobre 2.389; el documento de prueba salió con 6 páginas y 123.612 bytes; el único borrador del plan, de una entidad, quedó en el historial).** **Producción, tras publicar B4 (`520bec0`, `20270519100000`) el 10-11-2026: 2.389/2.389 y 34 sin datos (+25 sobre 2.364: los checks nuevos de B4, `canvis` y las internas; dos «sin datos» más porque producción no tiene ninguna importación todavía).** **Producción, tras publicar B3 (`6f26d93`) el 10-11-2026: 2.364/2.364 y 32 sin datos (+9, las de `exportar_entitats`).** **Producción, tras publicar `a562285` el 10-11-2026: 2.355/2.355 y 32 sin datos (+17 sobre 2.338; la «sin datos» de menos es de datos).** Antes, **clon, tras la pantalla de protección (`20270517110000`, 09-11-2026): 2.335/2.335 y 36 sin datos (total 2.371: +45, cinco checks por cada uno de los nueve perfiles — `cortina_config`, `cortina_activar` y `cortina_desar_contrasenya` por RPC y leer e insertar en la tabla —; al super_admin los dos primeros le salen «permitir», con `cortina_activar(null)` → 22023). Vitest 1.820 (+13: lector de estado, caché, fail-closed, huella propia, paridad con `cortina-hash.mjs`).** **Producción, tras publicar `780c751` el 09-11-2026: 2.338/2.338 y 33 sin datos (mismo total; la diferencia con el clon son datos).** Antes, clon, tras la revisión fiscal de la Taula mestra (`20270517100000`, 09-11-2026): 2.290/2.290 y 36 sin datos (total 2.326: +20 —cuatro checks por cuenta externa titular, con la opción nueva `errorExigit`: `regim_iva`, el correo y el CP de facturación tienen que llegar a su columna y chocar con su CHECK (`23514`), y `cooperativa_agraria` ya no es una actividad (`22023`); sin escribir nada—; una «sin datos» menos por datos del clon). Producción, tras publicar `b79ff77` el 09-11-2026: 2.293/2.293 y 33 sin datos (+20 sobre 2.273).** Antes, **clon, tras la auditoría del equipo y la regeneración de documentos (`20270516100000`/`100100`, 09-11-2026): 2.269/2.269 y 37 sin datos (total 2.306: +63 —`equip_auditoria`, `regenerar_documents_fundacio` (sin aceptar: solo informa) y la interna `documento_datos_fundacio_actual`, más la lectura y escritura de `equip_persones_arxiu` y `regeneracions_documents`, en los nueve perfiles—; las dos «sin datos» nuevas son esas dos tablas, vacías hasta el primer borrado o la primera regeneración). Producción, tras publicar `f898d5a` el 09-11-2026: 2.273/2.273 y 33 sin datos (+61 sobre 2.212; nada que regenerar, porque los datos de la Fundació no habían cambiado; la prueba que se deshace sola borró a `comunicacio@` y su identidad quedó en `equip_persones_arxiu`).** Antes, **clon, tras el rastro por fila del traspaso (`20270515100000`, 09-11-2026): 2.208/2.208 y 35 sin datos (total 2.243: +27 —`equip_traspassos_files` leída y escrita, y `equip_autoria_fila`, en los nueve perfiles—; el «sin datos» nuevo es la lectura del rastro por el super_admin, vacío hasta el primer traspaso). Producción, tras publicar `2094fac` el 09-11-2026: 2.212/2.212 y 31 sin datos (+26 sobre 2.186; la prueba que se deshace sola movió 73 filas de Sebastián con 73 apuntes).** Antes, **clon, tras la gestión de cuentas del equipo (`20270514100000`, 09-11-2026): 2.182/2.182 y 34 sin datos (total 2.216: +108; las RPC nuevas y las internas denegadas en los nueve perfiles, y las seis permitidas al super_admin con uuid inventado; el «sin datos» nuevo es `equip_traspassos`, vacío hasta que alguien traspase). Producción, tras publicar `d90ed94` el 09-11-2026: 2.186/2.186 y 30 sin datos (+107 sobre 2.079; el historial ya tiene la fila de Sebastián).** Antes, **clon, tras Configuració › Equip (`20270513100000`, 09-11-2026): 2.075/2.075 y 33 sin datos (total 2.108: +35 —`equip_membres`, `canviar_rol_equip` y `equip_rols_hist` en los perfiles que corresponde—; el «sin datos» nuevo es la lectura del historial, vacío hasta que alguien cambie un rol). Producción, tras publicar `0bc7138` el 09-11-2026: 2.079/2.079 y 29 sin datos (+38 sobre 2.041; el historial ya tiene la fila de Sebastián).** Antes, **clon, tras el importador de entidades (`20270511100000`, 06-11-2026): 2.040/2.040 y 32 sin datos (total 2.072: +99 —95 ejecutados—: `previsualitzar_importacio_entitats` e `importar_entitats` denegadas con 42501 a las siete externas, al técnico y al admin, permitidas al super_admin con `22023`; lectura de `importacions_entitats[_files]` —equipo sí, externos 0 filas— y sin escritura directa; `alta_fitxa_interna` y las `importacio_*` sin EXECUTE. Las 4 «sin datos» nuevas son la lectura del registro por el equipo mientras no haya ninguna importación, deuda 167).** **Producción, tras publicar `35ca22b` el 06-11-2026: 2.041/2.041 y 31 sin datos (total 2.072, el mismo; una «sin datos» menos que el clon porque los datos de prueba difieren).** Antes, **clon, tras el circuito de firma (`20270510100000`…`20270510100200`, 05-11-2026): 1.945/1.945 y 28 sin datos (total 1.973; los bloques `FIRMA_SERVIDOR` y `FIRMA_EXTERN`: `firmes_document` legible por el equipo y por el titular, sin INSERT ni UPDATE directos; `tancar_/rebutjar_signatura` solo al super_admin con `22023` sobre uuid inventado; `acunar_enllac_propi('firma_document',…)` denegada a los externos sin documento; las internas `signar_document_per_enllac`, `registrar_document_signat`, `document_emet_versio_signada` y `preparar_enviament_signatura` sin EXECUTE desde `authenticated`; `pendents_equip()` con 17 colas). Producción, tras publicar `f9c7516` el 05-11-2026: 1.946/1.946 y 27 sin datos (mismo total; las cuatro «sin datos» nuevas respecto a 23 son las lecturas de `firmes_document`, vacía hasta la primera firma).** Antes, **producción, tras publicar el certificado de donación del modelo (`e3d51d4`, `20270509100000`…`20270509100700`, 05-11-2026): 1.801/1.801 y 23 sin datos.** Antes, **clon, tras el bloqueo del borrado por ofertas (`20270508100000`, 04-11-2026): 1.769/1.769 y 28 sin datos (total 1.797: +1, `bloqueigs_esborrat_fitxa` del super_admin sobre una ficha con ofertas, que exige el código `ofertes` con `codiEsperat`). Producción, tras publicar `b557346` el 04-11-2026: 1.774/1.774 y 23 sin datos (mismo total).** Antes, **clon, tras el envío manual (`20270507100000`, 04-11-2026): 1.768/1.768 y 28 sin datos
   (total 1.796: +9, `preparar_enviament_albara` denegada en los nueve perfiles). Producción, tras publicar `3cfba88` el 04-11-2026: 1.773/1.773 y 23 sin datos (mismo total).** Antes, **clon, tras el consentimiento por enlace (`20270506100000`, 04-11-2026): 1.759/1.759 y 28 sin datos
   (total 1.787: +27, las tres RPC nuevas en los nueve perfiles). Producción, tras publicar `414319c` el
   04-11-2026: 1.764/1.764 y 23 sin datos (mismo total; la diferencia con el clon son datos).** **Clon, tras població real y ubicació (`20270505100000`, 04-11-2026): 1.732/1.732 y 28
   sin datos (mismo total, 1.760: sin checks nuevos; dos «sin datos» menos por datos del clon).** **Clon, tras 1.5 (`20270504100000`, 04-11-2026): 1.730/1.730 y 30 sin
   datos (total 1.760: +18 de `tancar_seguiment` y `activar_organitzacio`; una «sin datos» menos por las
   notas que dejan las E2E en el clon). Producción, tras publicar `d18f04c` el 04-11-2026 (con 20270503100000 de 1E, que aún no estaba —solo la columna `ref_externa`, sin datos—): 1.737/1.737 y 23 sin datos (mismo total, 1.760; la diferencia con el clon son datos).** Antes, **clon, tras 1F (`20270502100000`): 1.711/1.711 y 31 sin datos (total 1.742; +36:
   leer e insertar en `notes_internes`, `afegir_nota_interna` y `esborrar_nota_interna` denegadas a las
   siete externas —leer = 0 filas—; el técnico lee, añade con `22023` y no borra ni inserta directo; el
   super_admin lee, añade y borra con `22023`. Las dos lecturas del equipo salen «sin datos» mientras el
   clon no tenga ninguna nota: de ahí 29 → 31). **Tras cargar el ARA 2026 en el clon (1E, 721 fichas inactivas): la misma cifra, 1.711/1.711 y 31
   sin datos** —una ficha externa nueva no añade checks ni cambia lo que ve cada cuenta de prueba—. Producción, tras publicar `0082ac5` (1F) el 02-11-2026:
   1.717/1.717 y 25 sin datos (las mismas dos lecturas sin notas: 23 → 25).** Antes, **clon, tras 1D (`20270501500000`): 1.677/1.677 y 29 sin datos (total 1.706; +36:
   `estat_acces_org`, `desactivar_acces_org`, `concedir_acces_org` y `revertir_acces_org` denegadas a las
   siete externas; el técnico lee el estado y nada más; el super_admin lee y desactiva; concedir y revertir,
   solo `service_role`). Producción, tras publicar `b6685b1` (1D) el 02-11-2026: 1.683/1.683 y 23 sin
   datos.** Antes,
   **clon, tras cerrar la 150: 1.641/1.641 y 29 sin datos (total 1.670; +4: `insertar` en `productores` y
   `entidades` denegado al técnico y al super_admin)**; tras 1B, 1.637/1.637 y 29 (total 1.666; 1B añadió 9: `crear_entitat`
   denegado a las siete externas, permitido con `22023` al técnico y al super_admin)**; antes de 1B,
   1.628/1.628 y 29 (total 1.657; 1C añadió 9, `v_entitats_llistat`); las dos «sin datos»
   nuevas son `fitxa_estat_hist` leída por el equipo, vacía hasta el primer cambio de estado.
   **Producción, tras publicar `a07dd6a` (1C) el 02-11-2026: 1.634/1.634 y 23 sin datos** ; **tras publicar `c67e12f` (1B)
   el 02-11-2026: 1.643/1.643 y 23 sin datos** (+9, `crear_entitat`); **tras cerrar la 150
   (`20270501400000`) esa misma noche: 1.647/1.647 y 23 sin datos** (+4), el mismo
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

**E2E contra el clon** (punto 4 del canónico): `tests/e2e/*.e2e.ts`; `tests/e2e/ajuda.ts` da `sql()`,
`sqlCom()`, `compte()`, `entra()` y `motiuSaltClon()`. Un test que apaga un interruptor
(`email_activo`…) lo restaura en un `finally`.
