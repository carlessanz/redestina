# AGENTS.md §4bis — 4bis. Identidad, roles y permisos

> Detalle de la sección 4bis de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §4bis» del código apuntan aquí.

## 4bis. Identidad, roles y permisos

Hasta 2026-07-30 **no existía ningún modelo de usuario**: solo la sesión de Supabase Auth, y
`AuthGate` era binario (hay sesión → acceso total a las 452 fichas). Esto es lo que lo sustituye.
Es la base de los paneles por rol (productor / receptor / equipo interno).

### Tablas

**`perfiles`** — 1:1 con `auth.users` (`20260730090000_perfiles_roles_membresias.sql`): `id` (FK a
`auth.users`, on delete cascade), `email`, `nombre`, `telefono`, `idioma` (`ca`/`es`),
`vista_defecto` (`intern`·`productor`·`receptor`), **`activo`**, `created_at`, `updated_at`. Un
trigger `on_auth_user_created` crea el perfil al dar de alta la cuenta. Poner `activo=false` corta
el acceso **en la consulta siguiente**: el rol se consulta en cada política, no viaja en el JWT.

**`usuario_roles`** — rol de **plataforma** (equipo interno), PK `(user_id, rol)`. Vocabulario:
`super_admin` > `admin` > `tecnic`. Los usuarios **externos no tienen fila aquí**: su acceso sale
solo de `membresias`.

| Rol | Qué añade |
| --- | --- |
| `tecnic` | Opera el día a día: ofertas, mensajería, fichas |
| `admin` | Además: aprueba y canaliza, gestiona las whitelists de test |
| `super_admin` | Además: apaga el modo test (`app_settings`) y borra fichas |

**`membresias`** — enlaza una cuenta con una ficha: `user_id`, `tipo` (`productor`/`entidad`),
`productor_id` **o** `entidad_id` (check de FK excluyente), `rol_org` (`titular`/`operador`),
`activo`. **Decisión de modelo**: no se crea todavía la `organizacion` unificada del funcional
(§1bis, brecha 2) porque exigiría deduplicar 111 entidades sin clave única y reescribir el panel;
las membresías ya cubren los dos casos reales —**doble rol** productor+entidad (dos filas) y varios
usuarios por organización (N filas)— sin tocar nada de lo que hay.

**Eje de aprobación** (`20260731100000_registre_public.sql`): `aprovacio`
(`pendent`·`aprovada`·`rebutjada`, default **`aprovada`**), `aprovat_at`, `aprovat_per`,
`motiu_aprovacio`. Mismo vocabulario que `oferta_respuestas` (§4), y por el mismo motivo: `activo`
solo no bastaba, porque tendría que significar a la vez «todavía no validada» y «desactivada por el
equipo», y esas dos cosas se comportan al revés (la primera sale en la cola y ve «estem revisant la
teva sol·licitud»; la segunda no debe reaparecer nunca). Cuatro estados y no hay más — un check
(`aprovacio = 'aprovada' or activo = false`) hace imposible el quinto:

| `aprovacio` | `activo` | Qué es |
| --- | --- | --- |
| `pendent` | false | Alta del registro público esperando validación |
| `rebutjada` | false | Alta rechazada, con su motivo (es auditoría: no se borra nada) |
| `aprovada` | true | Membresía normal |
| `aprovada` | false | Membresía desactivada por el equipo |

El default `aprovada` es lo que mantiene válidas las filas que ya existían: eran altas hechas a
mano, o sea aprobadas por definición. Índice parcial `(created_at) where aprovacio = 'pendent'` para
la cola, y la tabla está en la publicación de **Realtime** (la cola se refresca sola).

**`entidades.tipo_receptor`** (`20260730091000_entidades_tipo_receptor.sql`) — `social` · `animal` ·
`transformador` · `comercial`. `modalitat` no servía: es texto libre, admite null y no puede
expresar «alimentació animal». Se **deriva** de `modalitat` lo que se puede y el resto queda `null`
para triaje manual desde la ficha (mismo criterio que `productes_frescos`). ⚠️ Mientras
`tipo_receptor` sea `null`, esa entidad **no ve ninguna oferta** en su panel, pero sigue apareciendo
en la priorización interna (que corre con `service_role`).

**`modalitat_receptor_compat`** — matriz oferta↔receptor **en tabla**, no escrita a mano en las
políticas: `donacio`→social/animal/transformador, `venda`→comercial/transformador,
`maquila`→transformador. Cambiar la regla de negocio es un `insert`/`delete`.

🔴 **Y la regla cambió el 27-09-2026 (revisión funcional del 23-09), aplicada en remoto ese
mismo día.** La Fundación dijo: empresa → solo venta y maquila; entidad social → donación + venta
+ maquila. `20270330100000` añade `venda`/`maquila`→`social` y `maquila`→`comercial`. **Solo
inserta**, así que el mercado, `manifestar_interes()` y el asistido cambian a la vez sin tocar
código. ⚠️ **Los convenios NO cambian**: una entidad social verá ya las ofertas de venta, pero
`aprovar_resposta()` no la canalizará sin un convenio `com` vigente, que es lo que dice
`convenios_exigidos`.
Comprobado en el navegador con `Menjador Social de Prova`: el Mercat enseña ya la maquila y
la venta de Mas de Prova, con su precio, junto a las donaciones.
⚠️ **Cómo se aplicó, porque es la vía de ahora en adelante**: el login del CLI de esta máquina
es de otra cuenta de Supabase (Custodia/Reemprende), así que hay un token propio de Redestina
—desde el 06-10-2026 **`Redestina - Admin - Producción`**, pegado en la sesión temporal (§11);
antes se leía del llavero como `Supabase Redestina`—, y la migración entra por la API de gestión
(`POST /v1/projects/uxppvaldhptdomvdhsmn/database/query`) en **una transacción junto con su
`insert` en `supabase_migrations.schema_migrations` con el número del fichero**. Así el
historial remoto y el repo casan sin renumerar nada, al revés que `apply_migration` del MCP (§7).

### El interruptor `roles_activos`

> ✅ **ENCENDIDO en producción desde el 2026-07-30.** Cada cuenta ve solo lo suyo. Verificado tras
> el encendido: las tres cuentas del equipo siguen viendo las 343 fichas de productor, las 116
> entidades y la mensajería, y pueden canalizar y editar; un productor de prueba solo ve su ficha.

`app_settings.roles_activos` (`'false'` de fábrica). Todos los helpers de rol empiezan por
`not roles_activos() or …`: **con el interruptor apagado el comportamiento es exactamente el de
antes** (cualquier autenticado lo puede todo), y encenderlo es el único paso que cambia algo. Se
revierte con `deno run -A scripts/roles-activos.ts off`, en segundos, sin desplegar y sin cerrar
sesiones (el rol se consulta en cada política, no viaja en el JWT).

⚠️ **El «ENCENDIDO» del recuadro es estado de la base remota, no del repo.** La migración
`20260730090000` inserta `roles_activos = 'false'`, así que **cualquier entorno recreado desde las
migraciones nace apagado** (permisivo) y se enciende fuera de git con el script. El estado real solo
se comprueba con `deno run -A scripts/roles-activos.ts estat`, no leyendo el repo.

**Quién es quién hoy**: `hola@carlessanz.com` es `super_admin`; las otras dos cuentas del equipo son
`admin`. Consecuencia práctica: **solo el super_admin puede apagar el modo test** o borrar fichas.

Es un **fail-open deliberado**, al revés que el fail-safe de `test_mode` (§8): allí la duda debe
cortar un envío; aquí la duda no debe dejar al equipo sin poder trabajar.

### Helpers (`20260730092000_funciones_sesion_y_rol.sql`)

Todos `stable security definer set search_path = public, pg_temp`, con `revoke execute … from
public, anon`. Son `security definer` para poder consultarse **desde una política** sin recursión:
⚠️ por eso **nunca** hay que poner `force row level security` en `perfiles`/`usuario_roles`/
`membresias`.

`roles_activos()` · **`whatsapp_activo()`** (§8; `20270317100000`, mismo molde que
`roles_activos()` pero con el `coalesce` a `'true'`) · `es_intern()` · `pot_aprovar()` ·
`es_super_admin()` · `mi_rol()` ·
`mis_productores()` · `mis_entidades()` · `soc_titular(tipo, org)` ·
**`get_my_session_context()`** (una llamada al entrar: rol, `vista_defecto` y organizaciones; desde
`20260731100000` devuelve además **`registre_pendent`** y **`registre_rebutjat`** — sin ellas la
interfaz no podría distinguir a quien espera validación de quien simplemente no tiene organización:
los dos llegan con `organizaciones = []`, porque la membresía pendiente es `activo = false`; y desde
`20270317100000`, **`whatsapp_actiu`** — el interruptor global viaja aquí porque `app_settings` solo
la lee el equipo y esto lo necesitan los tres paneles).

⚠️ **Dos matices del contexto que el resto de la doc no capturaba** (verificado 2026-08-01; el contexto ya no tiene
modo degradado desde el 07-10-2026, §6quater):
- `get_my_session_context()` calcula `es_intern`/`pot_aprovar`/`es_super_admin` con **`mi_rol()`**
  (rol real, **sin** el fail-open de los helpers homónimos de RLS). Consecuencia deliberada: con el
  interruptor apagado la **base** es permisiva (todo autenticado puede todo), pero la **interfaz**
  enseña el panel externo a una cuenta sin fila en `usuario_roles`.
- **`vista_defecto` se calcula pero el frontend hoy lo ignora**: `mapejaContext()` (`rols.ts`) no lo
  copia al `ContextSessio`, y el panel inicial de `/panell` se decide con el `preferit` de
  `localStorage` y `ctx.rols[0]`. Es un campo servido y descartado (deuda técnica 38).

⚠️ `get_my_session_context()` está marcada **`parallel restricted`** (`20260731080000`). Recrearla
con `create or replace` **reescribe todos los atributos**, así que hay que repetir esa marca de
forma explícita o se vuelve `PARALLEL UNSAFE` en silencio.

En las políticas van envueltos en `(select …)` para que el planner los evalúe **una vez por
consulta** (InitPlan) y no una vez por fila.

### Escrituras por RPC (`20260730097000_rpc_paneles_externos.sql`)

RLS no sabe restringir por columna, ni comparar con el valor anterior de una fila, ni agrupar varias
escrituras en una transacción. Por eso la superficie de escritura de los paneles externos son
funciones, no políticas:

| RPC | Qué hace |
| --- | --- |
| `manifestar_interes(excedente, entidad, kg, preu, caixes)` | El receptor acepta desde el panel. Deja la fila igual que el diálogo de WhatsApp (`acceptada` + `aprovacio='pendent'`, `canal='panel'`), así **cae en la misma cola de aprobación** que ya existe. Valida compatibilidad y `preu_minim`, y desde `20270407100000` (28-09-2026) **el convenio que exige la modalidad** (`exigir_convenio(…, modalitat, 'recibe')`: una entidad social con solo el `don_rec` no puede pedir una venta, que exige el `com`) y que los kg no pasen de `kg_total` (`kg_maxim`). Antes no miraba ningún convenio y el rechazo llegaba al aprobar, sin que la entidad lo supiera |
| `aprovar_resposta(resposta, kg, preu, motiu)` | Aprobar y canalizar **en una transacción** (hoy `OfferDetail` hace 3-4 llamadas sueltas). Exige `pot_aprovar()` |
| `actualizar_mi_productor(…)` / `actualizar_mi_entidad(…)` | Autoedición con **lista blanca**: nunca `es_test`, `activo`, `codigo`, `conveni`, `prioritat`, `estat`, `gestio` |
| `actualizar_meu_canal(tipo, ficha, canal)` | Fija `organizaciones.canal_preferido` desde la ficha propia (`20270314100000`). **Es la única escritura de esa tabla**, que no tiene GRANT de UPDATE para nadie. `canal` null = volver a deducirlo. Pasa el titular **o el equipo** —al revés que las dos de arriba, y por eso: sobre las fichas el equipo tiene GRANT y edita desde `RecordDetail`, sobre `organizaciones` no tiene ninguno, y el modelo es asistido |
| `cancelar_meva_oferta(excedente, motiu)` | El productor cancela la suya. Editarla no: el `texto_oferta` ya circuló. ⚠️ **Desde `20270416100000` solo por error o incidencia**: motivo obligatorio (`22023 cal_motiu`) y solo desde `borrador`/`pendent_validacio`/`publicada` **sin canalizaciones** (`22023 te_canalitzacions`); con kilos asignados lo que toca es registrar el destino del resto |
| `operacio_detall(canalizacion)` (`20270417100000`) | **La ficha de una operación ya asignada** (fase 2 de la revisión del 08-10-2026): producto, kg sol·licitats / assignats (los de la canalización, lo vigente) / rebuts, fecha y hora, estado de la recogida (`pendent·programada·entregada·confirmada·conciliada`), la contraparte con persona y teléfono, y **el lugar de recogida completo** (dirección, contacto, teléfono, horario, observaciones y Maps de `productor_ubicaciones`). Solo para las partes y el equipo; devuelve `setof`, así que a cualquier otro le da cero filas. `security definer` porque la entidad no lee `productores` ni `productor_ubicaciones`: es D1 (tras aprobar, las partes se ven), y a la entidad no se le da una canalización anulada |
| `contraparts_canalitzacions()` (recreada en `20270417100000`) | La de la rebanada 2 más `data_hora_recollida`, `kg_aprovats` y `estat_recollida`, y **sin las canalizaciones anuladas**. Cambió el `returns table`: se borró y recreó, con su `revoke`/`grant` |
| `declinar_oferta(resposta)` (`20270417100100`) | «No m'interessa» desde «Ofertes per a tu»: una fila `pendent` pasa a `rebutjada`. Solo la entidad (ni el equipo); el permiso antes que la existencia (`42501` con uuid inventado). `22023 ja_resposta` si ya se contestó |
| `marcar_canvis_revisats(excedente)` (`20270417100100`) | El equipo da por revisados los cambios de una oferta (`excedentes_canvis.revisat_at`), que es lo que vacía la cola `ofertes_modificades`. `es_intern()` |
| `registrar_desti_final(excedente, destins jsonb)` (`20270416100000`) | **El destino final de los kilos** (fase 1 de la revisión del 08-10-2026, §6ter): sustituye TODOS los destinos externos de la oferta (`excedente_destins`) por la lista `[{desti, kg, receptor?, data?}]`. Titular o equipo; para un externo el permiso va antes que la existencia (`42501` con uuid inventado, como `fixar_fotos_oferta`), para el equipo un uuid inventado da `22023 oferta_inexistent`. Rechazos: `estat_no_admet_desti` (solo `publicada`/`parcial`/`bloqueada`/`no_colocada`), `desti_desconegut`, `kg_invalids`, `data_futura`, `massa_kg`. Sin kilos sin destino y sin recogidas en marcha → **`cerrada`** + `tancada_at`; con recogidas en marcha, `bloqueada` |
| `desti_excedent(excedente)` (`20270416100000`) | `(kg_total, kg_redestina, kg_externs, kg_sense_desti)`. **`security invoker`**: agrega lo que quien pregunta ya lee. `kg_redestina` = `kg_confirmados` de las canalizaciones no anuladas (lo ASIGNADO, la misma cuenta que decide `parcial`/`bloqueada`; una merma al recoger se explica en la conciliación, no se pide como destino). La misma regla está en `src/lib/destiFinal.ts` |
| `organitzacions_candidates(tipo, ficha)` | Qué organizaciones podrían ser la misma que la de esta ficha, calculado **al vuelo**: correo, teléfono o **NIF** exactos, o **nombre con similitud ≥ 0,65** (`pg_trgm`, D3 del plan de organización unificada, 22-09-2026). Devuelve `motius text[]` —no un único valor: con cuatro señales, nombrar cada combinación a mano habría sido dieciséis frases— y `similitud numeric`, que solo lleva valor cuando `nom_semblant` cuenta. `es_intern()`: enseña nombre, NIF, correo y teléfono de otra organización |
| `enllacar_organitzacio(tipo, ficha, organitzacio)` | **Fusiona**: mueve la ficha —y sus convenios, solo los suyos— a esa organización y retira la que deja vacía. `pot_aprovar()`. Se niega con el motivo si el destino ya tiene ficha de ese tipo o si las dos traen convenio vigente del mismo tipo. Con `organitzacio` NULL **separa** la ficha en una organización nueva, que es el deshacer |
| `aprovar_registre(membresia)` / `rebutjar_registre(membresia, motiu)` | Validan un alta del registro público (`20260731100000`). Exigen `pot_aprovar()` (42501), bloquean la fila con `for update` y solo actúan sobre `pendent` (22023). **Rechazar no borra nada**: queda la auditoría y la persona ve el motivo |
| `borrar_ficha_completa(tipo, ficha, tambe_germana default false)` (`20260921153439`) | **EL** camino de borrado de una ficha (§4 «Borrado de una ficha»). Se niega con el motivo si hay **ofertas** (desde `20270508100000`), documentos, albaranes o cierres (`22023 bloqueig_esborrat: <codis>`, con el texto legible en `details`); si no, arrastra lo operativo, borra la ficha y **retira la organización si queda vacía**. Con `tambe_germana`, las dos fichas del doble rol en la **misma transacción** — que es lo que hoy no garantiza el panel con sus dos `.delete()` sueltos. **`es_super_admin()`**, como las políticas de `delete` que sustituye; `42501 no_autoritzat` si no. Devuelve `jsonb` con lo borrado y `fitxers_orfes`, las rutas de Storage que SQL no puede retirar |
| `bloqueigs_esborrat_fitxa(tipo, ficha)` (`20260921153439`) | La misma pregunta, **sin borrar**: una fila `(codi, n, detall)` por motivo y **cero filas = se puede borrar**. Existe por lo mismo que `comprovaConvenis()` (§12.78): el panel tiene que poder avisar **antes**, no enterarse con un error a mitad. Códigos: `ofertes` (productor con algún excedente, cualquier estado) · `ofertes_rebudes` (entidad con respuestas o canalizaciones; los dos desde `20270508100000`) · `albarans` · `tancaments` · `linies_tancament` · `convenis` · `plans` · `documents`. La ficha del equipo la llama **antes** y, si hay bloqueo, propone `desactivar_organitzacio`/`desactivar_fitxa`. `es_intern()` |
| `siguiente_numero(serie, ejercicio)` | El correlativo, dentro de la transacción de emisión. **Sin `execute` para `authenticated`** |
| `formato_numero(serie, ejercicio, n)` | `REC-2026-00042` |
| `ruta_documento(objeto_tipo, objeto_id, tipo, numero, version, modo, ejercicio)` | La carpeta por organización (§4 «Sistema documental»). `stable`, no `immutable`: lee el dominio. Solo `service_role` |
| `puede_ver_documento(documento, user default null)` | Autoriza la descarga. `service_role` puede preguntar por un usuario concreto; un `authenticated` que pase el uuid de otro se lleva `42501` |
| `documento_vigente(objeto_tipo, objeto_id, tipo)` | Qué PDF vale hoy. **`security invoker` a propósito**: la RLS de `documentos` se aplica igual que en un `select`. Desde `20270320100300` devuelve **`returns table` con las 27 columnas legibles, no el compuesto `documentos`**: con `returns documentos` habría devuelto `envio` —el token— y además su `select d.*` habría dejado de funcionar en cuanto esa columna salió del GRANT (un `d.*` exige privilegio sobre TODAS). Se pudo cambiar el tipo de retorno porque **no la llamaba nadie**: cero referencias y cero dependencias en `pg_depend` |
| `set_updated_at()` (`20270320100100`) | Trigger genérico `before update`: `updated_at = now()` del servidor. En `app_settings`, `app_config` y `perfiles`. **NO en `intake_sessions`**, donde esa columna es actividad de la persona y no mtime de la fila (§12.100) |
| `documents_meus(user default null)` | Puente `security definer` (`setof uuid`) entre `documentos` y las organizaciones del usuario. **Fase 1: vacío**; cada fase la reescribe con `create or replace` sin tocar la tabla ni su política |
| `emitir_documento_prova(fallar default false)` | Documento de humo, serie `PROVA`, `modo='prueba'`. Exige `es_super_admin()`. Con `fallar` levanta excepción **después** de pedir el número: es lo que prueba `scripts/prueba-numeracion.ts` |
| `reiniciar_documentos_prova()` | Borra los documentos `modo='prueba'` y pone a 0 `PROVA`/`P-*` del ejercicio. Única excepción a la inmutabilidad |
| `marcar_documento_generado(id, sha, bytes, paginas)` / `marcar_documento_error(id, err)` | Solo `service_role`. La `ruta` no se pasa: ya está fijada. `generado` es idempotente |
| `emitir_albaran(id, recogida, lineas, idioma)` | Pide número, congela `partes`, emite el PDF. `es_intern()`; `22023` si no es borrador. 🔴 **Desde `20270428100000`**: `22023 recollida_no_validada` para un albarán del flujo de recogida (ENT/OPE de canalización, REC de su oferta; no espigolada) fuera del contexto `redestina.validacio_recollida` (solo lo fijan `validar_recollida`, `confirmar_recollida` y `rectificar_albaran`) |
| `marcar_entregado(id)` | Crea los enlaces de confirmación y **devuelve el token en claro**: es la única vez que existe (en la base solo está su hash). `es_intern()`. ⚠️ **Desde `20270418100100`** una parte **sin correo y con móvil** (`es_mobil()`, la regla de `esMovil()`) recibe un enlace `canal = 'whatsapp'` con `destinatario_telefono` y **sin token en la salida** (por WhatsApp no viaja: quedaría en la consola de Mensajería); `recollides-programades` le manda los botones. Sin correo ni móvil, ninguna fila: la vía es `confirmar_recollida()` |
| `confirmar_recollida(canalizacion, kg_reals, data, observacions, foto)` (`20270418100100`) | 🔁 **Desde `20270430100200` es un ENVOLTORIO** de `registrar_recollida_assistida()` (o de `validar_recollida()` si la entidad ya la registró): concilia SIEMPRE y las líneas llevan los kilos REALES; lo que sigue describe la versión anterior. **«Confirma la recollida» del equipo** (fase 3 de la revisión del 08-10-2026, §6ter). ⚠️ **Desde `20270428100000` solo `pot_aprovar()`** (es el admin validando directamente; el `tecnic` recibe `42501`) y marca la canalización validada. Antes, solo `es_intern()` **con sesión** (la identidad es parte de la evidencia; permiso antes que existencia). En una transacción: emite y entrega el ENT/OPE si estaba en `borrador`/`emitido` (**consume numeración**), confirma por cada parte que falte con un enlace `asistido` acuñado y consumido al momento (`confirmar_part_assistida`, `asistido_por` = la cuenta), fija `kg_reales`, y cuando ya no queda ninguna salida del registro sin confirmar emite/entrega/confirma el **REC** con la suma de lo real; dentro de tolerancia concilia en cascada, fuera la deja en `albarans_conciliar`. Sin REC (venta/maquila pura) concilia la salida. Rechazos `22023`: `canalitzacio_inexistent`, `canalitzacio_anulada`, `sense_albara`, `ja_confirmada`, `kg_invalids`, `data_futura`, `foto_aliena`. Devuelve `{albara_id, albara, estat, rec, conciliat, fora_tolerancia, …}` |
| `aprovar_certificat_ofertant(id, tipus)` · `aprovar_certificat_equip(id, tipus, nota)` (`20270419100000`) | **La revisión del certificado de donación** (fase 4 de la revisión del 08-10-2026, §6ter). `tipus` = `anual` (`cierres_donante`) o `periode` (`cierres_periodo`). La primera, el titular, por `cierres_donante_meus()`/`cierres_periodo_meus()` y con el permiso **antes** que la existencia; la segunda, `pot_aprovar()` con nota obligatoria (`cal_nota`). Las dos exigen `pendent_revisio` (`no_pendent_revisio`); la del titular, además, sin bloqueos (`certificat_bloquejat`). `certificat_revisio_snapshot()` es interna (sin EXECUTE para `authenticated`) |
| `confirmar_part_assistida(…)` · `repartir_kg_linies(albaran, kg)` · `es_mobil(tel)` (`20270418100100`) | Internas de lo anterior. Las dos primeras **sin EXECUTE para `authenticated`** (el arnés lo vigila); `repartir_kg_linies` la usa también el webhook con `service_role` para repartir los kilos de WhatsApp entre las líneas (proporcional a lo previsto, residuo a la mayor) |
| `registrar_recollida_assistida(canalizacion, resultat, kg_reals, data, observacions, motiu, foto)` (`20270430100200`) | **La recogida en nombre del receptor, en un paso**: registra con el MISMO código que el receptor (`registrar_recollida_escriu`) y valida con el MISMO `validar_recollida()` en una transacción → ENT/OPE, REC y conciliación con los kilos reales, igual que el camino del usuario. Solo `pot_aprovar()` con sesión. `cal_motiu` con diferencia; `foto_aliena` si la foto no es de un albarán de esa entrega. La autoría: `recollida_registrada_per` = la cuenta del equipo, incidencia con `origen = 'equip'`, y `validar_recollida()` imprime la confirmación como **asistida** («Registrada per l'equip en nom de X», canal `asistido`) cuando quien registró no es miembro de la entidad |
| `registrar_recollida_escriu(…)` · `confirmar_part_declarada(…, p_canal)` (`20270430100200`) | Internas. La primera es lo que guarda un registro (extraída de `registrar_recollida`, que ahora solo autoriza y la llama); la segunda gana `p_canal` (`panel`/`asistido`, firma de 10 argumentos) |
| `fixar_hora_recollida(canalizacion, quan)` (`20270430100200`) | La hora de una entrega desde el ciclo guiado. `es_intern()`. `hora_passada`, `ja_registrada`; vuelve a pedir el registro a la hora nueva (`registre_demanat_at` a null) y el trigger avisa a las dos partes (`recollida_canviada`) |
| `registrar_confirmacion(enlace, payload, evidencia)` | **Solo `service_role`**, salvo **una sesión de equipo sobre un enlace `asistido`** (desde `20270418100100`, la usa `confirmar_recollida()`): una función, un camino. Usa SQLSTATE `PT404`/`PT409`/`PT410`, que PostgREST traduce a HTTP sin que la Edge Function traduzca nada. ⚠️ **Desde `20270414100000` un OPE lo confirman las DOS partes**: solo pasa a `confirmado` cuando confirma la última parte con enlace vivo (otro `rol_parte`, no usado, `activo` y no caducado); si solo hay un enlace —ficha sin correo— o el de la otra parte caducó o se revocó, pasa a `confirmado` como en REC/ENT. Los kg de la línea los fija la parte `recibe` (`entrega` solo escribe si `recibe` aún no confirmó); se conserva el rechazo más grave (`total` > `parcial` > `cap`) con los motivos encadenados; una parte que ya confirmó recibe `PT409`. En REC y ENT no cambia nada |
| `propuesta_conciliacion(rec)` | Contrasta el neto del REC con la suma de los ENT confirmados y dice si cae dentro de la tolerancia |
| `conciliar_albaran(id, kg_validados, motivo, destino_final)` | Fija los kilos oficiales. Exige confirmación **o** plazo vencido con motivo. ⚠️ **Desde `20270414100100` sobre un REC exige motivo fuera de tolerancia (`22023 fora_de_tolerancia`) y concilia EN CASCADA** los ENT/OPE hermanos en `confirmado` (los obtiene `albarans_germans_rec(rec)`: mismo excedente o misma espigolada), con el motivo propagado o «Conciliat amb l'albarà de recepció <num>»; las canalizaciones quedan `conciliada` con `coste_kg` congelado. Todo o nada: si un hermano falla, falla el REC entero. Antes, conciliar un REC no tocaba las salidas y el cierre quedaba bloqueado por `sense_conciliar`. Un ENT/OPE se puede conciliar también por separado (UI `AlbaraDetall` desde el 07-10-2026). ⚠️ **Desde `20270427100000` exige motivo si hay incidencia de recogida** (REC: `rec_te_incidencia_recollida()`; ENT/OPE: `canalizaciones.incidencia_recollida`) → `22023 cal_motiu_incidencia`, comprobado después del plazo y antes de la tolerancia |
| `albarans_germans_rec(rec)` (`20270414100100`) | Los ENT/OPE de un REC (mismo excedente o misma espigolada), con la condición de `propuesta_conciliacion()`. Interna: solo `service_role` |
| `conciliacions_automatiques()` (`20270414100100`; desde `20270426100000` salta lo que tiene una incidencia de recogida) | Job (solo `service_role`). Tres ramas: (1) REC `confirmado` con todas sus salidas confirmadas y dentro de tolerancia → concilia el REC, que arrastra las salidas (incluye el REC de una espigolada); (2) ENT/OPE `confirmado` cuyo REC ya está `conciliado` —el caso que antes se quedaba colgado—; (3) OPE `confirmado` sin REC vivo (venta o maquila puras). Ya no cuenta enlaces usados: con `registrar_confirmacion` de dos partes, un OPE `confirmado` ya significa que confirmaron todas |
| `anular_albaran` / `rectificar_albaran` | `pot_aprovar()`. El rectificativo usa serie `R-<tipo>` y deja el original en `rectificado` |
| `crear_espigolada(productor, ubicacion, fecha, voluntarios, notas, lineas, ref_externa, excedente)` / `repartir_espigolada` | La jornada y sus lotes. `repartir_espigolada` es el único camino que **no** pasa por `aprovar_resposta()`, así que llama por su cuenta a `exigir_convenio()`. ⚠️ **Con `p_excedente` CONVIERTE una oferta** (`20260921221806`, §6ter): no crea ningún excedente, **reutiliza ese** —`origen` a `espigolament`, `espigolada_id` a la jornada, `estado` a `borrador` hasta el reparto— y crea el REC con su línea. Se niega con `22023` y un código legible en `oferta_inexistent` · `productor_no_coincideix` · `sense_producte_al_camp` · `ja_es_espigolada` · `ja_te_canalitzacions` · `ja_te_albarans` · `massa_linies`. Toma `for update` sobre la oferta **antes de insertar nada**: sin ese bloqueo, dos conversiones simultáneas pasarían las guardas a la vez y crearían dos jornadas del mismo producto, que es la duplicación que esta fase existe para impedir. ⚠️ **La firma de siete argumentos se retiró en la misma migración**: `create or replace` no puede cambiar el número de argumentos, así que habrían convivido dos y cualquier llamada de siete sería **ambigua (42725)** |
| `fijar_coste_producto(producto, coste, motivo)` / `fijar_tipo_caja` (`pot_aprovar()`) · `borrar_coste_producto(producto, motivo)` (`es_super_admin()`) | El coste **de referencia** y las taras. **Sin ejercicio desde `20270405100200`** (drop de las firmas viejas con `p_ejercicio`): un coste por producto que se actualiza cuando hace falta |
| `fixar_foto_producte(producto, foto, foto_mini, credit)` (`20270405100000`) | La foto del catálogo. **Solo `es_super_admin()`**, comprobado antes que la existencia. Las dos rutas a null = quitarla. Devuelve las rutas anteriores: los ficheros los retira el cliente |
| `fixar_notificacions(actives)` · `fixar_canal_notificacio(canal, actiu)` (`20270429100000`) | Los interruptores de notificaciones (§8). **Solo `es_super_admin()` con sesión** (`42501`; `service_role` sin EXECUTE). La primera con `false` pone a `'false'` las tres claves en la misma transacción; con `true` solo enciende el general. La segunda (`email`/`whatsapp`) se niega a encender un canal con el general apagado (`22023 notificacions_desactivades`); un canal desconocido es `22023 canal_desconegut`, que es lo que usa el arnés |
| `notificacions_actives()` · `email_activo()` · `whatsapp_activo()` | Los helpers, ya EFECTIVOS (canal = general Y canal). Fail-safe encendido. `whatsapp_activo()` cambió de significado el 27-10-2026: antes leía solo su clave |
| `fixar_fotos_oferta(excedente, fotos, foto_producte default null)` | Las fotos de una oferta publicada y, desde `20270405100100`, la casilla «foto del producte». `p_fotos` null = no tocar las fotos. El productor de la oferta o el equipo |
| `albarans_de_les_meves_orgs()` | Puente: REC→productor, ENT→entidad, OPE→las dos. **Sin borradores** |
| `exigir_convenio(tipo, org)` | **Stub** en la fase 3: solo devuelve aviso. La fase 2 lo convierte en bloqueo tras la fecha de corte |
| `abrir_cierre` · `calcular_cierre` · `emitir_resumen` · `registrar_factura` · `simular_factura` · `emitir_certificado` · `marcar_enviado` · `marcar_declarado` · `rectificar_certificado` · `reiniciar_cierre_prueba` · `conciliacion_retroactiva` | El ciclo del cierre anual. `abrir_cierre` en modo real exige `es_super_admin()`; `simular_factura` solo existe en cierres de prueba. ⚠️ **Desde `20270414100200`**: `calcular_cierre()` calcula también las filas `transaccio` (llama a `calcular_cierre_transacciones`, idempotente; el retorno gana la clave `transaccions`, y `congelar_un_cierre()` las vuelve a calcular al cerrar, inocuo) y `marcar_declarado()` marca **solo `tipo='donacio'`**: el CT no va al 182. **Desde `20270509100200`** `emitir_certificado(cd, motivo, p_data_expedicio, p_annex)`: fecha de expedición por defecto el 31-12 (en real nunca antes; en prueba con el ejercicio en curso, hoy), `22023 data_expedicio_fora_rang`; exige plantilla `CD` vigente sin variante. Desde `20270509100400` `calcular_cierre()` ya no crea filas `transaccio` (`transaccions: null`) |
| `emitir_certificados_transaccion_cierre(cierre)` (`20270414100200`) | 🔴 **Retirada el 05-11-2026** (`20270509100400`): tras la guarda `pot_aprovar()` (`42501`) responde `22023 certificat_transaccio_retirat`. El CT ya no se emite; lo emitido se conserva (deuda 154) |
| `cierre_base` · `cierre_pendents` · `datos_182` · `comparar_cierre_prueba` · `provincia_por_cp` | Las consultas. La base de cálculo son donaciones **conciliadas** con la fecha de recogida dentro del año **en hora de Madrid**, con los kilos del REC conciliado repartidos entre las canalizaciones del registro (D13) |
| `cerrar_cierre(cierre)` | Cierra **un** cierre por su uuid: recalcula, emite los resúmenes definitivos y pasa a `tancat`. `pot_aprovar()`, y **`es_super_admin()` si el cierre es real** |
| `congelar_un_cierre(cierre)` | La misma operación, interna (`service_role`). El job `congelar_ejercicio(año)` la llama en bucle, así que **hay una sola implementación** de «qué es congelar un cierre» |
| `cierre_base_periodo(desde, hasta, modo)` · `cierre_pendents_periodo(desde, hasta)` | La base de cálculo de una ventana. `cierre_base`/`cierre_pendents` son envoltorios suyos. **Solo equipo** (`42501`): antes no lo eran, y era una fuga |
| `calcular_certificado_periodo(productor, desde, hasta, modo, p_excedente default null)` (`20270509100100`) | El borrador del certificado a demanda y sus bloqueos. `pot_aprovar()`. `22023` si la ventana cruza dos ejercicios, si acaba en el futuro o si ya tiene certificado. **Con `p_excedente` (ámbito oferta)** ignora desde/hasta y deriva la ventana de lo certificable de la oferta; `22023 oferta_daltri_productor` / `oferta_sense_certificable` |
| `registrar_factura_periodo(periodo, numero, fecha, importe, doc_externo)` | La factura del periodo. Existe para que el camino normal del certificado a demanda sea el mismo del anual y la excepción de D4 siga siendo una excepción |
| `emitir_certificado_periodo(periodo, motivo, p_data_expedicio, p_annex, p_excedente)` (`20270509100200`) | Las guardas del anual —`datos_provisionales` → `42501`, ningún `bloqueja`, kg y valor positivos— más la plantilla `CD/parcial` vigente. Sustituye los contenidos (por líneas si interviene una oferta). Fecha de expedición por defecto hoy, rango `[periodo_hasta, hoy]` o `22023 data_expedicio_fora_rang`; `p_excedente` solo comprueba (`22023 oferta_no_coincideix`). No exige factura; `p_motivo_excepcion` se ignora |
| `emitir_certificados_cierre(cierre, p_data_expedicio, p_annex)` (`20260921211356`, firma de `20270509100200`) | **Todos los certificados de un cierre, de una vez.** Exige `pot_aprovar()`, que el cierre exista (`for update`), que esté **`tancat`**, que esté calculado y —**solo si el cierre es REAL** (`20260921214526`)— que `datos_provisionales` sea falso; esto último **fuera del bucle**, o el resultado serían N saltados con el mismo motivo. Recorre los `cierres_donante` de tipo `donacio` sin número, salta los bloqueados y los de 0 kg **con su código**, y emite el resto en subbloques `begin/exception` para que un fallo no tumbe la tanda. Devuelve `{emesos, ja_tenien, saltats}`. 🔴 **No la llama `cerrar_cierre()` ni `congelar_*`**: ver §4. La fecha de expedición (defecto 31-12) se valida una vez, tras las guardas |
| `exercici_dels_meus_tancaments()` (`20270406100000`) | El **ejercicio y el modo** de los `cierres_donante` que ve el donante, por el mismo puente que su RLS (`cierres_donante_meus()`) y **solo esas tres columnas**: `cierres_ejercicio` sigue siendo del equipo. Sin ella, un cierre recién calculado —sin número todavía— salía «Exercici —» en `productor/Documents` y, si era de prueba, **sin la marca de prueba**. Esa pantalla distingue además donación de transacción (`tipo`): una fila de venta o maquila ya no enseña «Valor de la donació: 0,00 €» |
| `rectificar_certificado_periodo(periodo, motivo)` · `marcar_enviado_periodo(periodo)` · `reiniciar_periodes_prova(ejercicio)` | El resto del ciclo. Rectificar no consume número: es la versión siguiente |
| `limpiar_periodes_borrador()` (`20260922025838`, deuda §12.112, cerrada) | Borra los borradores de `cierres_periodo` (+líneas, en cascada) sin `certificado_numero` — de CUALQUIER modo, a diferencia de `reiniciar_periodes_prova()`, que solo alcanza `modo='prueba'`. Nunca toca una fila numerada. `es_super_admin()` |
| `cierre_base_recepcio(desde, hasta, modo)` · `cierre_pendents_recepcio(desde, hasta)` | La base de cálculo del **certificado de recepción**. **Solo equipo** (`42501`), con el idioma de `20270303100500`: cruzan canalizaciones, excedentes, albaranes y productores **sin que ninguna RLS vuelva a filtrar**, así que sin la guarda una entidad podría pedir por PostgREST lo que ha recibido todo el mundo, con el nombre de cada generador — el agujero exacto que aquella migración encontró en `cierre_base()` |
| `kg_rebuts_exercici(ejercicio, entidad)` | El acumulado del año del panel de la receptora, **leído en SQL y no sumado en cliente**. `security invoker`, como `pendents_equip()`: agrega solo lo que quien pregunta ya puede leer, así que no lleva guarda propia. ⚠️ **Corolario que sorprende y no es una fuga**: a un *generador* le devuelve filas —los kilos de SUS entregas agregados por entidad—, porque su RLS ya le deja leer las `canalizaciones` de sus propias ofertas. Medido el 22-09-2026: la RPC y sus canalizaciones visibles cuadran al kilo, o sea que el agregado no le da ni un dato nuevo |
| `calcular_certificat_recepcio(entidad, desde, hasta, modo)` | El borrador y sus bloqueos. `pot_aprovar()`. `22023` si la ventana cruza dos ejercicios, acaba en el futuro o ya tiene certificado. ⚠️ **Calcular ya ESCRIBE**, como su hermana de periodo (§12.112) |
| `emetre_certificat_recepcio(id, motiu)` | Emite el `CR`. Las guardas del certificado a demanda **tras F1**: no exige factura (no existe el concepto aquí) y `datos_provisionales` **solo bloquea el modo real**. ⚠️ `p_motiu` **no es la D4 retirada ni un parámetro que se ignore**: es una nota interna que se guarda en `notas` y **no se imprime** |
| `rectificar_certificat_recepcio(id, motiu)` · `marcar_enviat_recepcio(id)` · `reiniciar_recepcions_prova(ejercicio)` | El resto del ciclo. Sin serie `R-CR`: rectificar no consume número, es la versión siguiente |
| `rectificar_certificado_transaccion(cd, motivo)` | 🔴 **Retirada el 05-11-2026** (`20270509100400`): `22023 certificat_transaccio_retirat` tras la guarda |
| `ruta_documento_externo(objeto_tipo, objeto_id, tipo, ejercicio, extension, modo)` | La ruta **entera** de un fichero que aporta otro: `<org>/<ejercicio>/externs/<uuid>-<tipo>.<ext>`. Solo `service_role`. Antes la carpeta la daba SQL y el nombre lo componía TypeScript, en dos funciones distintas (deuda 62) |
| `modalitats_compatibles_meves()` | Puente **sin correlación** de la RLS de `excedentes`: qué modalidades puede recibir alguna de mis entidades. El EXECUTE a `authenticated` **no es opcional** — una política se evalúa con los privilegios de quien consulta |
| `excedents_de_les_meves_canalitzacions()` (`20260922124240`) | La **quinta rama** de esa misma política: los excedentes de los que alguna de mis entidades ha recibido una canalización. Sin ella, una entrega que **no nació de un interés registrado** —el reparto de una espigolada, o el alta directa del equipo por los atajos de la deuda 109— dejaba a la receptora leyendo «—» en el producto y la referencia de lo que ella misma había recibido: `v_albaranes_bandeja` es `security_invoker`, así que su join con `excedentes` se evalúa con la RLS de quien pregunta y el producto salía `null`. Medido en producción el 22-09-2026: 3 de las 4 entregas del Menjador Social. ⚠️ **No relaja D3**: abre la misma fila que ya abren la rama del interés y la del mercado; el rigor de no nombrar al donante vive en el renderizador del `ENT` y en el CHECK de `cierre_receptor_lineas` (§4), que no se tocan. ⚠️ El arnés no lo cazaba porque no es un permiso mal puesto, es una fila que no existe para esa sesión |
| `missatges_sense_contestar()` | Entrantes posteriores al último saliente, por teléfono. `security invoker`: agrega solo lo que quien pregunta ya podía leer (deuda 5) |
| `puc_pujar_document_extern(objeto_tipo, objeto_id, user)` | Puente único de permiso para subir externos: `albaran` → `albarans_de_les_meves_orgs`, `cierre_donante` → `cierres_donante_meus`, `convenio` → `convenios_meus`, y el equipo siempre. **`productor`/`entidad` caen al `false` final a propósito**: el equipo ya ha salido arriba, y a una ficha no sube nadie más (§4). Lo usa `subir-documento-externo` |
| `puc_veure_document_extern(id, user default null)` (`20270329100000`) | Autoriza la **descarga de un externo**. Espejo de `puede_ver_documento()`: guarda anti-suplantación, equipo por rol, fail-open del interruptor, y si no, la misma condición que la política de lectura. ⚠️ `documentos_externos` **no tiene columna `modo`**, así que el modo prueba se reconoce **por la ruta** (`…/proves/…`), como ya hace `limpiar-documentos-prueba`. ⚠️ Para `productor`/`entidad` consulta `membresias` **inline** y no `mis_productores()`: aquellas leen `auth.uid()` y con `service_role` —que es como la llama la Edge Function— devolverían vacío, o sea que un externo propio se vería como ajeno |
| `preparar_conveni_en_paper(tipo_org, org, tipo)` · `registrar_conveni_en_paper(conveni, data_firma, referencia, signant_nom, signant_carrec, notes)` (`20270329100300`) | El convenio firmado **fuera de la plataforma** (§4). **`es_super_admin()`**, no `pot_aprovar()`: decide si una organización puede operar sin haber firmado aquí, y eso no se amplía en silencio al equipo. Son **dos llamadas y el orden es la garantía**: primero el borrador (para tener el `id` del que colgará el PDF), después el escaneado, y solo entonces la validación, que se niega con `falta_escanejat`. ⚠️ **`service_role` NO tiene el EXECUTE**: no hay ningún job que declare convenios vigentes, y con `auth.uid()` nulo las guardas lo dejarían pasar. ⚠️ No pasa por `preparar_convenio` para marcar el origen: aquella es idempotente y sobre un borrador que ya existiera el origen se quedaría en `plataforma` sin que nada lo dijera |
| `declarar_conveni(tipo_org, org, tipo, signant_nom, signant_carrec, data_firma, referencia, notes)` (`20270430100000`) | **El convenio DECLARADO**: el super_admin lo da por vigente con los datos de la ficha, sin firma ni escaneado (plan de gestión autónoma, §6ter). **Solo `es_super_admin()` con sesión** (permiso antes que existencia; `service_role` sin EXECUTE). `tipo` tiene que ser el `col_*` del papel (`tipus_desconegut`); exige NIF y domicilio en la ficha (`falta_dades_fitxa`, con los campos en `detail`) y la apoderada en los parámetros. Se niega si ya hay uno vigente de ese tipo (`ja_vigent`: sustituiría uno firmado por uno sin firma), si la organización ya firmó (`ja_signat`: falta contrafirmar) o si está `retornat`; uno `pendent_firma` se recupera (revoca el enlace y vuelve a borrador). **Consume número** de la serie `CONV-COL-*` dentro de la transacción, deja `origen = 'declarat'`, `declarat_per/at`, y emite el PDF `contrafirmat` con la página «Conveni donat per vigent per declaració». **Sin fila en `evidencias`** (no hubo enlace) |
| `preparar_convenio` · `enviar_convenio` · `contrafirmar_convenio` · `retornar_convenio` · `resolver_convenio` · `iniciar_firma_asistida` | El ciclo del convenio. `enviar_convenio` devuelve **el token en claro** (única vez que existe) y reenviar **revoca el anterior**. ⚠️ `preparar_convenio` la puede pedir además **el titular de esa organización** (`20270326100000`), no solo el equipo: es idempotente —si ya hay uno en marcha lo devuelve— así que abrirla no multiplica borradores |
| `marcar_avisos_llegits(ids, objecte_tipo)` · `marcar_mercat_vist()` · `contraparts_canalitzacions()` (`20270410100000`) | Avisos y D1 (§6ter, rebanada 2). Las tres solo de lo propio (`mis_productores()`/`mis_entidades()`/`auth.uid()`). `crear_avis()` y `disparar_avisos_pendents()` solo `service_role` |
| `programar_albarans_recollida()` (⚠️ desde `20270426100000` ya no emite: crea el aviso `recollida_per_registrar` y devuelve `[]`) · `recordar_confirmacions_recollida()` · `conciliacions_automatiques()` (`20270412100000`) | Los jobs de la recogida programada (§6ter, rebanada 3). **Solo `service_role`** (`42501` con sesión). Devuelven los tokens en claro las dos primeras: la única vez que existen |
| `validar_recollida(canalizacion, kg default null, motiu default null)` · `retornar_recollida(canalizacion, motiu)` (`20270428100000`) | **La validación del admin** que genera los albaranes de una recogida (§6ter). `pot_aprovar()` con sesión (permiso antes que existencia; `service_role` sin EXECUTE). Validar emite ENT/OPE (y el REC cuando no falta ninguna salida) con los kg validados y concilia; rechazos `22023`: `canalitzacio_inexistent`, `canalitzacio_anulada`, `no_registrada`, `ja_validada`, `kg_invalids`, `cal_motiu_validacio`, `motiu_llarg`, `sense_albara`, `albara_ja_confirmat`. Devuelve `{albara_id, albara, tipus, estat, rec{id,numero,estat}|null, kg_reals, kg_assignats, kg_declarats, conciliat, esperant_altres}`. Retornar: `no_registrada`, `ja_validada`, `cal_motiu`, `motiu_llarg`, `albara_ja_confirmat`; aviso `recollida_retornada` |
| `registrar_recollida(canalizacion, resultat, kg_reals, data, observacions)` (`20270426100000`) | 🔴 **Desde `20270428100000` solo GUARDA la declaración** (no emite ni concilia; devuelve `{estat:'pendent_validacio', kg_declarats, kg_assignats, resultat}`): lo que sigue describe la versión de `20270426100000`. **«Registra la recollida» del RECEPTOR** (§6ter, «La recogida la cierra el receptor»). Solo una cuenta con membresía activa en la entidad de esa canalización (`42501` también con uuid inventado; el equipo tampoco: tiene `confirmar_recollida()`). `resultat` ∈ `coincideix` (= los kg asignados) · `menys` · `mes` (estos dos con motivo). Autoriza con la sesión y **después actúa como el servidor** (vacía `request.jwt.claims`/`request.jwt.claim.sub` en la transacción y los repone al salir), porque reutiliza `emitir_albaran`/`marcar_entregado`/`registrar_confirmacion`/`conciliar_albaran`, que solo admiten equipo o servidor; la identidad queda en `canalizaciones.recollida_registrada_per` y en las evidencias. Emite la salida con los kg reales, confirma la parte del receptor (y en OPE la del ofertante, declarada), emite y confirma el REC cuando no falta ninguna salida, concilia si coincide y deja incidencia si no. Rechazos `22023`: `canalitzacio_anulada`, `ja_registrada`, `resultat_invalid`, `kg_no_coincideixen`, `kg_invalids`, `kg_zero`, `kg_no_menys`, `kg_no_mes`, `falta_motiu_diferencia`, `motiu_llarg`, `data_futura`, `data_anterior`, `sense_albara`. Devuelve `{albara_id, albara, tipus, estat, rec, kg_reals, kg_assignats, conciliat, en_revisio, esperant_altres}` |
| `confirmar_part_declarada(…)` · `rec_te_incidencia_recollida(rec)` (`20270426100000`) | Internas de lo anterior y del job de conciliación. Sin EXECUTE para `authenticated` (el arnés lo vigila); la primera además exige modo servidor (`42501` con sesión) |
| `bloqueig_per_albara(tipo, org)` · `comprova_hora_recollida(ex, quan)` (`20270412100000`) | El bloqueo de 48 h (G1) y la regla de la hora de recogida. La primera solo responde por lo propio a un externo |
| `editar_oferta(id, canvis, texto, actor)` (`20270410100000`) | **Solo `service_role`** (la llama `crear-oferta/editar` con el actor de la sesión). Lista blanca de campos, kg ≥ canalizado, D4 (revalidación si el productor cambia kg o modalidades) e historial en `excedentes_canvis` |
| `validar_oferta(id)` · `rebutjar_oferta(id, motiu)` (`20270409100000`) | Sacan una oferta de `pendent_validacio`: a `publicada` (sale al Mercat) o a `cancelada` con el motivo en `motivo_no_colocada`. `pot_aprovar()` (`42501`); `22023` si no está pendiente o sin motivo. Guardan `validada_at`/`validada_per` |
| `descartar_convenio_esborrany(id)` (`20270408100000`) | Borra un convenio en **`esborrany`** (sin número: no deja hueco en ninguna serie). Solo `pot_aprovar()` (`42501`); `22023` si no es borrador o si tiene `documentos_externos`. Borra antes sus `enlaces_token` (no debería tener). `pendent_firma` **no** se descarta: ya ha salido un enlace hacia alguien. Deja `raise log` con quién y qué. Botón «Descarta l'esborrany» en `ConveniDetall`. Existe porque `convenios` no tiene `grant delete` y la Fundació va a un único convenio por tipo de entidad (reunión del 05-10-2026) |
| `signar_conveni_propi(tipo_org, org)` (`20270326100000`) | **De cero a la página de firma en una llamada**: prepara el convenio si no existe, lo pasa de `esborrany` a `pendent_firma` y acuña un enlace `canal='panel'` de 1 h, devolviendo el token en claro. Solo `soc_titular()`. El `tipo` se **deduce** (productor→`don_gen`, entidad→`don_rec`) y no entra por parámetro: recibirlo dejaría pedir `com` desde una pantalla que no sabe nada de esa matriz. ⚠️ **`enviado_at` se queda NULL** — significa «cuándo se le mandó por correo», y aquí no se mandó nada— pero `datos_org` **sí** se refresca al salir del borrador, como en `enviar_convenio`. 🔴 **Desde `20270415100000` (11-10-2026) se NIEGA (`22023`, «Ja tens un conveni vigent d'aquest tipus») si ya hay un convenio vigente de ese tipo y ninguno en marcha**: `preparar_convenio()` solo reutiliza `esborrany`/`pendent_firma`/`retornat`/`firmat`, así que con un vigente creaba otro, que al contrafirmarse sustituía al vigente y quemaba un número legal. Una renovación que el equipo ya dejó en marcha sí se puede firmar. **Esta RPC es solo para «el convenio por defecto de mi papel»** (la usa `AvisConveni`); firmar uno concreto que ya existe es `acunar_enllac_propi()` |
| `pendents_meus()` | Qué tienen pendiente de firmar o confirmar las organizaciones de la cuenta, con el `estado_efectivo` del último enlace. **Nunca devuelve el token ni su hash.** Lo decide el estado del OBJETO (convenio en `pendent_firma`/`retornat`, albarán en `entregado`), no el del enlace |
| `acunar_enllac_propi(proposito, objeto_tipo, objeto_id, rol_parte)` | Acuña un enlace `canal='panel'` (1 h) **para uno mismo** y devuelve el token en claro; el frontend abre `/signar` o `/confirmar`. Firma: solo `soc_titular()`. Confirmación: cualquier miembro activo. **Revoca el enlace activo anterior**, como `enviar_convenio`. El `grant execute` va **solo a `authenticated`** (y `revoke` de `public`/`anon`): el equipo tiene `enviar_convenio`/`marcar_entregado`. ⚠️ **Aun así `service_role` PUEDE ejecutarla** —conserva el EXECUTE del `alter default privileges` del bootstrap, que esta migración no revocó—, y lo que la corta es la guarda interna `auth.uid() is null → 42501`. Medido contra producción al publicar (14-09-2026): la denegación es real, pero la impone la función, no el GRANT |
| `generar_token_enlace()` | El token de 32 bytes y su sha256, en un solo sitio. Solo `service_role` (la llaman funciones definer). Las tres RPC anteriores conservan su copia: están en migraciones aplicadas |
| `guardar_plan_basico` · `emitir_plan_basico` · `plan_datos` · `puc_gestionar_pla` | El plan de prevención. `emitir_plan_basico` deja `envio` null: descarga inmediata por polling. ⚠️ `plan_datos()` es **solo `service_role`** desde `20270414100500` (devolvía NIF, correo y respuestas del cuestionario a cualquier sesión que tuviera el uuid) y además lleva guarda con `puc_gestionar_pla` como defensa en profundidad · 🔴 **A1 (`20270520100000`): retirada de la interfaz (D4); solo `service_role`** |
| `auditoria_funcions_obertes()` (`20270414101000`) | Funciones de `public` abiertas de más: categoría `definer_anon` (`security definer`, no trigger, ejecutable por `anon`/PUBLIC) y `trigger_api` (de trigger, ejecutable por `anon`/`authenticated`). `security invoker`, solo equipo (`42501`). La vigila un check global del arnés contra `PERMITIDAS_ABIERTAS` (vacía; añadir una entrada exige escribir el motivo). Hoy devuelve 0 filas |
| `questionari_vigent(tipo_org)` | El cuestionario que toca contestar. **`security invoker`**: la política de la tabla (`vigente or es_intern()`) ya dice lo que hay que decir, y una `definer` solo podría ampliar el alcance |
| `publicar_questionari(tipo_org, titol, preguntes, provisional, vigent)` | La versión siguiente, retirando la anterior **en la misma transacción**. `pot_aprovar()`. Devuelve **`regles_orfes`**: las reglas que apuntan a una pregunta que ya no existe. **No bloquea** —una regla huérfana no dispara— pero quien publica tiene que verlo, o el plan siguiente saldría con menos medidas y nadie sabría por qué |
| `desar_diagnostic(tipo_org, org, respostes, notes, idioma)` | Guarda **siempre**, completo o no —un cuestionario de doce preguntas no se contesta de una sentada—, compone el sobre autocontenido. 🔴 **Desde `20270423100000` (fase 9) ya NO genera el plan**: guarda la versión en `diagnostics_historial`, deriva `productos_habituales`/`temporada` del productor y valida `max` y `ubicacio_aliena`. ⚠️ `p_respostes` es el mapa plano `{pregunta_id: valor}`: **el array con los textos lo compone el servidor**, porque si lo compusiera el cliente el texto congelado sería el que el navegador dijo haber enseñado (mismo criterio que `sha256_texto` en la firma de un convenio) · 🔴 **A1 (`20270520100000`)**: solo el equipo (`es_intern()`; un externo recibe `42501` también sobre lo suyo, D5), solo productores (`22023 nomes_productors`), upsert en **`diagnostics`** (una fila por productor, D1); ya no escribe `planes_prevencion` ni `diagnostics_historial` (P10) |
| `generar_pla_des_de_diagnostic(tipo_org, org, forcar)` | Evalúa `regles_pla` y escribe `mesures`. **Desduplica por `codi`** ganando la que la deja obligatoria y, a igualdad, la de `prioritat` menor. `22023 mesures_editades` si alguien ya ajustó la lista a mano: regenerar en silencio se llevaría por delante el criterio del técnico que estuvo delante de la persona · 🔴 **Desde la fase 9 (`20270423100000`) solo el equipo** (`es_intern()`; `42501` a cualquier externo), igual que `emitir_plan_basico()`: el Pla de Prevenció es un servicio que prepara Redestina · 🔴 **A1 (`20270520100000`): retirada de la interfaz (D4); solo `service_role`** |
| `desar_mesures_pla(plan, mesures, observacions)` | El ajuste manual. Dos invariantes: **el texto de una medida del catálogo se relee del catálogo** —nadie reescribe el contenido de una medida en un documento con el sello de la Fundación— y **una obligatoria que produjeron las reglas no se puede quitar** (`22023 falten_obligatories`) · 🔴 **A1 (`20270520100000`): retirada de la interfaz (D4); solo `service_role`** |
| `fixar_nivell_pla(plan, nivel)` | Subir a `personalitzat` exige `pot_aprovar()`; bajar a `basic`, no. El plan personalizado es un **servicio técnico**, no una casilla: si una organización pudiera declararlo desde su panel, estaría contratándose a sí misma algo que nadie ha prestado · 🔴 **A1 (`20270520100000`): retirada de la interfaz (D4); solo `service_role`** |
| `diagnostic_estat(tipo_org, org)` · `diagnostics_equip()` | En qué punto está, en una llamada (`sense_questionari · sense_comencar · incomplet · a_punt · emes`, con `falten[]`), y la misma pregunta para toda la base. La segunda es `security invoker` con guarda de equipo, como `pendents_equip()` · 🔴 **A1**: leen `diagnostics`; estados `sense_questionari · sense_comencar · incomplet · complet` (las claves del plan, a null/0/false); + `actualitzat_at`, `actualitzat_per_nom`, `diagnostic_id` |
| `diagnostic_datos(tipo_org, org, p_user)` | **A1.** Snapshot de lectura del diagnóstico para la ficha, «El meu diagnòstic» y el PDF de A2 (`diagnostic-pdf` la llama con `service_role` y `p_user = ctx.userId`). `puc_gestionar_pla` con sesión; con `service_role`, `p_user` obligatorio (`22023 falta_usuari`) y la misma comprobación para ese usuario (interno o membresía activa y aprobada); un `p_user` ajeno con sesión → `42501`. Permiso antes que existencia: `22023 nomes_productors` / `fitxa_inexistent` después. Quién actualizó: solo el **nombre** del perfil, nunca el correo |
| `avaluar_regla` · `pregunta_aplica` · `diagnostic_falten` · `compondre_respostes` · `questionari_valid`… | Los helpers puros (`immutable`, sin tocar ninguna tabla). ⚠️ `avaluar_regla` es **la única** gramática de condiciones: la comparten `regles_pla` y el `aplica_a` de una pregunta condicional, porque dos implementaciones de «¿se cumple esto?» acabarían divergiendo — y entonces **una pregunta que la pantalla oculta contaría como obligatoria en el servidor** |
| `calcular_cierre_transacciones` · `emitir_certificado_transaccion` · `cierre_base_transaccion` | 🔴 **CT retirado el 05-11-2026** (`20270509100400`): `emitir_certificado_transaccion` responde `22023 certificat_transaccio_retirat` tras la guarda; `calcular_cierre_transacciones` no escribe y devuelve `{retirat:true}` (la llaman `congelar_*`). `cierre_base_transaccion`/`cierre_pendents_transaccion` conservan la guarda de equipo (`20270414100400`) y quedan sin uso (deuda 154). La tarjeta del CT de `TancamentDetall` se quitó |
| `cierre_exclosos_periodo(productor, desde, fins, p_excedente, modo)` (`20270509100000`) | Lo que **no** entra en un certificado de donación y por qué (`venda`, `maquila`, `sense_entitat`, `sense_valoritzacio`, `entitat_no_social:<tipo>`, `conciliacio_retroactiva`). Equipo (`es_intern()`; externos `42501`). `motiu_exclusio_certificat()` —el criterio único— no tiene EXECUTE para `authenticated` |
| `firmar_convenio_por_enlace` · `validar_codi_firma` | **Solo `service_role`**: quien firma no tiene sesión, lo que autoriza es el token. `PT403` si falta validar el código de la firma asistida |
| `conveni_cobreix_tot(tipo_org, org)` (`20270420100000`) | ¿Lo vigente de esta organización ya cubre TODAS las modalidades de su papel (un `col_*`, o los anteriores juntos)? La usa `signar_conveni_propi()` para la guarda de «ja tens un conveni vigent». Interna: sin EXECUTE para `authenticated` |
| `convenio_vigente(tipo_org, org, valorizacion, parte)` · `exigir_convenio(...)` | **`exigir_convenio` ya no es stub**: antes de `fecha_corte_convenios` avisa, después levanta `42501 sense_conveni`. Lo aplican `aprovar_resposta()` y `repartir_espigolada()` (esta, desde `20270414100300`, exige el convenio **del generador** además del de la entidad). ⚠️ **Desde `20270414100600` `exigir_convenio()` y `organizacion_de()` son solo `service_role`** (y las llamadas internas de las funciones definer): el mensaje de la primera llevaba el NOMBRE de la organización —una receptora lo obtenía de un productor ajeno—, lo que rompe D3. `convenio_vigente()` sí la llama el navegador (`aprovarResposta.ts`, solo pantallas del equipo) y por eso lleva guarda de pertenencia: con sesión, o eres del equipo o la ficha es de `mis_productores()`/`mis_entidades()`; si no, `42501` |
| `data_tall_convenis()` (`20270316100000`) | Devuelve `fecha_corte_convenios` y **nada más** de `parametros_documentales`, que es del equipo. La necesita el panel externo para avisar con la misma fecha con la que corta la base. `authenticated` puede ejecutarla |
| `pendents_equip()` (`20270323100000`, ampliada en `20260921221806`) | **La cola de trabajo del equipo en una sola llamada**: **quince** filas `(cua, n, ref, detall)` (eran trece hasta la rebanada 1, que añadió `ofertes_per_validar`, y catorce hasta el 11-10-2026, que añadió `ofertes_modificades`), **siempre las quince** aunque `n` valga 0: `registres`, `convenis_contrasignar`, `ofertes_per_validar`, `respostes`, `missatges`, `ofertes_sense_enviar`, `ofertes_modificades` (ofertas editadas por el productor que el equipo no ha revisado; cuenta también en el badge de Ofertes), `ofertes_vencudes` (desde el 11-10-2026, «ofertes sense destí registrat»), `albarans_esborrany`, `albarans_conciliar`, `albarans_esperant`, `costos`, `tancament`, `documents_error` y `espigolades_per_convertir`. `albarans_esperant` solo se enseña como subtítulo, no como cola accionable. Una de ellas es `espigolades_per_convertir` (ofertas publicadas con `producte_al_camp` y sin jornada). ⚠️ Cuenta solo `publicada` y **no `parcial`**, que encaja a propósito con la guarda: una oferta con canalizaciones ya no es convertible, así que contarla sería ofrecer un botón que la base va a rechazar. `security invoker`, como `missatges_sense_contestar()`: agrega solo lo que quien pregunta ya puede leer; `42501` a cualquier cuenta externa. Fechas en hora de Madrid, no `current_date` (la sesión de PostgREST va en UTC). ⚠️ Dos colas se calculan con `not exists` (`ofertes_sense_enviar`, `costos`) y contarían **al revés** si a alguien le faltara visibilidad: por eso no puede abrirse «total, son cifras» — a un externo le mentiría. Es la fuente única de los badges del menú y del tablero (§6ter). ⚠️ **Desde `20270427100000`** `albarans_esborrany` cuenta solo los borradores que son trabajo del equipo (espigoladas, recogidas pasadas sin registrar…) y `albarans_conciliar` suma los ENT/OPE confirmados sin REC vivo y los que tienen incidencia con el REC ya conciliado (§6ter, «La recogida la cierra el receptor») |
| `progres_meves_ofertes()` (`20270323100000`) | El embudo de las ofertas **activas** de mis organizaciones productoras: `(excedente_id, n_enviades, n_interessades, n_per_aprovar)`. **Nunca devuelve `entidad_id`, nombre, teléfono ni precio**: la decisión del cliente es «cuántas, sin nombres». Puente `security definer` sobre `mis_productores()`; sin sesión, `42501`; sin ficha de productor, 0 filas (como los demás puentes). Con `service_role` responde `42501` por la guarda, aunque el EXECUTE lo tenga por los privilegios por defecto (el mismo matiz que `acunar_enllac_propi`) |
| `acunar_enllac_assistit(proposito, objeto_tipo, objeto_id, rol_parte)` (`20260921160536`) | **La vía asistida de albaranes y facturas**: acuña un enlace `canal='asistido'` de 1 h para que el equipo conduzca la confirmación o la subida de factura **con la persona delante**. Al revés que casi todo el circuito documental, **exige sesión de equipo y `service_role` NO puede** (se le revoca el EXECUTE): un enlace asistido con `creado_por` nulo sería un acto conducido por nadie, que es justo lo que `evidencias.asistido_por` existe para impedir. ⚠️ El destinatario sale de **la ficha de la parte**, no del perfil de quien acuña —el equipo no es parte— y **puede quedar `null`**: eso es lo que cierra el hueco de que `marcar_entregado()` solo crea enlace `where d.email is not null`, dejando sin confirmación posible a una ficha sin correo. Sin parámetro `p_email`: un correo escrito a mano sería una afirmación falsa sobre a quién se escribió. `firma_convenio` **queda fuera** — ya está `iniciar_firma_asistida()` |
| `manifestar_interes_assistit(excedente, entidad, kg, preu, caixes)` (`20260921160749`) | El interés de una entidad conducido por el equipo (`canal='asistido'`). **Función nueva, no se relajó `manifestar_interes()`**: una sola función con dos regímenes de autorización es donde se esconde el fallo. Conserva las tres comprobaciones que los atajos de `OfferDetail` se saltan — estado de la oferta, `modalitat_receptor_compat` y precio mínimo |
| `comprova_interes(excedente, entidad, kg, preu, modalitat, recollida)` (`20270430100100`) | **Las guardas de un interés en un solo sitio** (estado, compatibilidad, `cal_modalitat`, `exigir_convenio`, `kg_maxim`, precio mínimo, `comprova_hora_recollida`). Interna (`security invoker`, sin EXECUTE). La comparten `manifestar_interes()` y `manifestar_interes_assistit()`, que desde `20270430100100` acepta además **`p_recollida`** (firma de 7 argumentos: la de 6 se borró) y tiene **las mismas comprobaciones que el receptor** salvo la pertenencia y el bloqueo de 48 h |
| `registrar_envio_manual(excedente, entidad)` (`20270430100100`) | La oferta enviada **a mano** (el equipo copia el texto y lo pega en el WhatsApp de la entidad): fila `pendent` con **`canal = 'manual'`**, sin que salga nada. `es_intern()`. `22023 oferta_no_disponible` si no está `publicada`/`parcial`; `ja_resposta` si la entidad ya mostró interés o está aprobada (no se pisa). Reenviar sobre una rechazada la devuelve a `pendent` (mover `aprovacio` exige `pot_aprovar()`, trigger) |
| `avisos_de_oferta(excedente)` (`20270430100300`) | Los avisos de una oferta, de sus respuestas y de sus canalizaciones en una llamada, para componer los mensajes de cada paso (`src/lib/missatgesOferta.ts`). **`security invoker` sin guarda de rol, a propósito**: la RLS de `avisos` ya da al equipo todo y a cada organización lo suyo, así que sirve a los tres paneles |
| `avisos_sense_enviar_per_oferta()` (`20270430100300`) | Cuántos avisos de cada oferta **no salieron** (`canal_enviat = 'cap'`), en una llamada: la columna «Missatges per enviar» del índice del ciclo guiado. `security invoker`, como la anterior |
| `canalitzacio_assistida(excedente)` · `canalitzacions_actives(limit)` (`20260921160920`) | Las lecturas de la pantalla guiada. ⚠️ Son `security definer`, así que **podrían** devolver lo que el GRANT por columnas protege: por eso **no leen `enlaces_token` en absoluto** —lo pendiente lo dice el estado del OBJETO (§6ter)—. Y devuelven **hechos, no el paso**: qué toca lo calcula `passosCanalitzacio.ts`, y calcularlo dos veces garantiza que diverjan |

> 🔴 **EL CORTE ESTÁ ENCENDIDO desde el 16-09-2026**: `fecha_corte_convenios = 2026-09-16`,
> a petición del cliente («bloquear hasta que no se haya firmado»). Ya no es un aviso: sin
> convenio vigente, «Publicar oferta» y «M'interessa» están apagados en el panel **y** la
> base los rechaza con `42501 sense_conveni`. Alcance decidido explícitamente: **se bloquean
> las acciones, no el panel** — quien no ha firmado sigue viendo sus pantallas, que es donde
> vive el botón de firmar.
>
> 🔴 **Y encenderlo destapó un fallo que lo habría hecho inútil.** `convenio_vigente()` busca
> el convenio por `convenios.organizacion_id`, y **los cinco convenios de la base lo tenían
> NULL** —el `vigent` incluido—, así que la función **no podía devolver `true` para nadie**:
> con el corte puesto, una organización quedaba bloqueada para siempre aunque firmara.
> Causa: `20270312100000` añadió la columna y la rellenó una vez, pero `preparar_convenio()`
> nunca la escribe y no había trigger — la misma lección que §4 ya tenía escrita para
> `organizaciones` («migrar los datos y mantener la invariante son dos cosas distintas») sin
> aplicar aquí. Cerrado en `20270327100000` con relleno + trigger + `not null`. **Solo era
> alcanzable con la fecha de corte puesta**, o sea el día en que más caro salía.

**El convenio en el panel externo (14-09-2026).** Decisión de producto: el panel **se sigue
viendo** sin convenio, lo que no se puede es operar. `useConveni` lee los convenios de la
organización (su propia RLS ya los filtra) y la fecha de corte, y `AvisConveni` pinta una banda
encima de cualquier pantalla de productor o receptor con tres mensajes distintos, porque son tres
situaciones distintas: sin convenio, enviado y sin firmar, o firmado pendiente de contrafirma.
Antes del corte es un aviso y se puede operar. Desde el corte, la banda pasa a roja y se apagan
las dos acciones que la base va a rechazar igualmente con `42501`: «Publicar oferta» y
«M'interessa». **El equipo no pasa por aquí**: opera en nombre de otros y no tiene organización
propia. Con `fecha_corte_convenios` a null (hoy), nada se bloquea: solo se avisa.

⚠️ **`marcar_entregado()` devuelve además `rol_part`** en cada enlace, y **`resolver_enlace()`
devuelve `rol_parte`**. `resolver_enlace` hubo que borrarla y recrearla: `create or replace` **no
cambia el `returns table`**, así que **hay que repetir el `revoke`/`grant`** (se hizo en
`20270304100200`) — la misma trampa que el `parallel restricted` de `get_my_session_context()`.

⚠️ **`emitir_albaran()` escribe `canalizaciones.data_hora_recollida`** si estaba vacía, con la misma
fecha del acto con la que elige el ejercicio de la serie. **Nunca pisa una fecha existente y no hubo
backfill**: el `coalesce(data_hora_recollida, conciliada_at, created_at)` de `cierre_base`,
`cierre_pendents` y `cierre_base_transaccion` se queda donde está. ⚠️ Solo la escriben **ENT y OPE**
—el REC no tiene `canalizacion_id`—, así que en una donación la fecha guardada es la de la **entrega
a la entidad**, no la de la entrada del donante (deuda 69).

⚠️ **`get_my_session_context()` devuelve además `conveni_pendent`.** Al recrearla hay que repetir
`parallel restricted`, como siempre (se hizo en `20270111100100`).

⚠️ **Cerrar el cierre real exige `es_super_admin()`; el de prueba, solo `pot_aprovar()`.** No es
simetría con `abrir_cierre`: es que **cerrar es el acto irreversible**. Abrir consume la serie del
año; cerrar emite los resúmenes definitivos con los que se le pide la factura al donante y congela
el cálculo, y a partir de ahí toda corrección pasa por `rectificar_certificado()`, que **no consume
número**: emite la versión siguiente del MISMO número de certificado (`rectificaciones + 1`, con el motivo en
el snapshot) —no existe serie `R-CD`; verificado contra la base el 07-10-2026, y una versión anterior de este
párrafo decía lo contrario— — el error de un clic no se deshace, se documenta. Un cierre de prueba no tiene
ninguna de esas consecuencias, y exigir el super_admin ahí solo conseguiría que el ensayo no se
hiciera.

⚠️ **`emitir_certificado()` se niega mientras `parametros_documentales.datos_provisionales`
sea `true` — pero SOLO EN MODO REAL** (`20260921214526`). Un certificado con efecto fiscal no
puede salir con un CIF inválido; uno de **prueba** sí, porque no lo tiene: serie con prefijo
`P-`, marca de agua, y `destinatariosPrueba` (§8) solo lo deja llegar a una organización
`es_test` o al buzón del equipo. Hasta el 21-09-2026 la guarda cortaba los dos, así que el
último escalón de la guía de prueba **no se podía recorrer nunca** — ni en la demo, ni al
validar una migración. Vale igual para las otras seis de la familia:
`emitir_certificado_periodo`, `emitir_certificado_transaccion`, `emitir_certificados_cierre` y
las tres `rectificar_certificado*`. Cierra la deuda 56 **solo para el modo real**.
⚠️ **La interfaz lo decide con `bloquejaProvisionals(provisionals, mode)`**
(`src/lib/canalitzacio.ts`), y ahí el modo **puede faltar** —no hay ejercicio todavía— y
entonces bloquea, igual que `dadesFiscalsProvisionals()` responde `true` ante la duda. En SQL no
puede faltar (`modo` es `not null` con check), así que `modo = 'real'` y `modo <> 'prueba'` son
la misma condición: la asimetría es deliberada y no se «corrige».
⚠️ **Lo que NO se relajó**: el snapshot sigue llevando `dades_provisionals`, así que el PDF de
prueba **declara impreso** que los datos lo son. Comprobado emitiendo uno el 21-09-2026
(`P-CD-2026-0001`, 2 páginas, `factura` a null, `dades_provisionals: true`).

⚠️ **Una guarda escrita como `es_intern()` a secas deja fuera a `service_role` en silencio.** Pasó
con `datos_182`: devolvía **0 filas**, indistinguible de «este cierre no tiene certificados». La
forma correcta en todo el circuito es `auth.uid() is not null and not es_intern()`.
**Y volvió a pasar el 11-09-2026 con `actualizar_meu_canal`** (`20270314100100`), que tenía el GRANT
de `service_role` y respondía `42501` al usarlo: se vio al verificar el despliegue llamándola con la
service key. Un GRANT que no sirve para nada es **peor** que no tenerlo — el día que una Edge
Function la llame, el fallo parecerá de permisos de datos y no lo será. Al escribir una guarda
nueva, comprobarla **con la service key**, no solo con una sesión.

⚠️ **`auth.uid() is null` significa `service_role`.** Las RPC documentales comprueban el rol solo
cuando hay sesión de usuario (`if auth.uid() is not null and not es_super_admin() then raise`),
igual que `trg_membresias_control_aprovacio`. Sin esa salida, con `roles_activos` encendido en
producción `service_role` se quedaría fuera de sus propias funciones.

Además, dos triggers imponen lo mismo aunque alguien relajara las políticas:
`respuestas_control_aprovacio` impide mover `aprovacio`/`canalizacion_id` de `oferta_respuestas`
(cierra la deuda §12.18), y **`membresias_control_aprovacio`** impide mover `activo`/`aprovacio` de
`membresias` a quien no puede aprobar. Este segundo hoy no protege de nada alcanzable —
`authenticated` ni siquiera tiene GRANT de UPDATE sobre `membresias`—: protege del día en que
alguien conceda ese GRANT para, pongamos, dejar que un titular cambie el `rol_org` de su equipo.

### Autorización de las Edge Functions — capa aparte

`service_role` tiene **`BYPASSRLS`**: las Edge Functions no se ven afectadas por RLS, ni para bien
ni para mal. Sin una comprobación propia, cualquier cuenta con sesión podría enviar WhatsApp o
priorizar entidades. `_shared/autorizacion.ts` (`contextoUsuario`, `exigirEquipo`) se aplica en
**`whatsapp-send`**, **`enviar-email`**, **`priorizar-entidades`** y también **`enviar-acceso`**, y
respeta el mismo interruptor que la base. Devuelve `401 unauthorized` sin sesión y `403 forbidden` si
no es del equipo. ⚠️ `contextoUsuario` trata una cuenta con `perfiles.activo=false` como **sin
sesión** → `401` (no `403`).

🔴 **`rolesActivos()` falla CERRADO ante un error de lectura** (07-10-2026). Hasta ese día devolvía `false`
también cuando la lectura de `app_settings` fallaba —no distinguía un error del valor `'false'`—, y como
`false` es el modo permisivo, un fallo transitorio de la base dejaba `exigirEquipo` abierto a cualquier cuenta
con sesión, incluida una recién registrada y sin aprobar (`whatsapp-send`, `enviar-email`,
`priorizar-entidades`, `enviar-acceso`, `reenviar-documento`, `limpiar-documentos-prueba`). Ahora un error
—o una excepción del cliente— devuelve `true` y deja un `console.error`; solo `'true'` enciende el
interruptor, y la fila ausente o `'false'` explícito siguen siendo el modo permisivo documentado. `tests/autorizacion.test.ts`.
(El equipo sigue pasando aunque la lectura falle: su rol se lee aparte.) Queda anotado, sin cambiar:
`contextoUsuario()` no detecta una cuenta desactivada si falla la lectura de `perfiles`.

🔴 **Auditoría de funciones y GRANT del 07-10-2026** (`20270414100400`…`101000`; el detalle de cada RPC
está en la tabla de arriba). Causa común: el `alter default privileges … on functions` de Supabase concede
EXECUTE a PUBLIC, `anon`, `authenticated` y `service_role` a **toda función nueva** salvo `revoke`
explícito. «`anon` no tiene ningún privilegio» (§4) es verdad para las **tablas**, no para las funciones.
Se cerraron: `cierre_base_transaccion`/`cierre_pendents_transaccion` (guarda de equipo),
`cierre_datos_certificado_transaccion` y `plan_datos` (solo `service_role`), `exigir_convenio` y
`organizacion_de` (solo `service_role`), `convenio_vigente` (guarda de pertenencia), `ruta_documento` (volvió
a tener EXECUTE para `authenticated` por un regrant de `20270111100100`; otra vez solo `service_role`),
`disparar_recordatorios_intake` y `marcar_excedentes_vencidos` (**ejecutables por `anon`** con la clave
pública: cualquiera podía disparar el job con el secreto válido; ahora solo `service_role` y con
`search_path = public, pg_temp`) y 32 funciones de trigger sin EXECUTE para la API (siguen disparando: el
EXECUTE se comprueba al crear el trigger, no al dispararlo). **Costumbre desde hoy**: toda función nueva lleva
`revoke execute … from public, anon` (y de `authenticated` si es solo del servidor o de trigger); lo vigila el
check global `auditoria_funcions_obertes()` del arnés. Propuesta no aplicada: `alter default privileges for role
postgres in schema public revoke execute on functions from public, anon` (mantendría `authenticated`; una
función futura que deba ser anónima necesitaría su `grant` explícito).
Otras correcciones de Edge Functions del mismo día: `crear-oferta` GET solo sirve `cost_referencia` al
equipo o a quien tiene ficha de productor (antes, a cualquier sesión) y valida las rutas de `fotos` con su forma
exacta `<productor_id>/<uuid>.<jpg|jpeg|png|webp>` (rechaza `..`, `//` y subcarpetas); `enviar-avis` reclama el
aviso de forma atómica (`update … where enviat_at is null returning`; `error_envio='en_curs'` con
`canal_enviat` null significa «reclamado y no terminado», y si el isolate muere se prefiere no reintentar a
mandar doble); los logs con PII enmascaran correo y teléfono (`_shared/enmascarar.ts`; el log del webhook de
WhatsApp se queda como estaba, decisión documentada); el `verify_token` del GET del webhook se compara en
tiempo constante.

### Verificación

`deno run -A scripts/comprobar-rls.ts` (§11): abre sesión con cada cuenta —con la publishable
key, como el navegador— y comprueba una matriz declarativa de *(cuenta, tabla, operación) →
permitir/denegar*. **La cifra de referencia está en §13 y solo ahí**: este párrafo llegó a decir
95/95 cuando §13 ya iba por 442, que es el desfase exacto que el skill `/publicar` también sufrió
dos veces. Abre sesión de verdad contra la base a la que apunte `SUPABASE_URL` —producción o el
clon local (§11)—, así que una cuenta que no puede entrar sale en rojo. Contra el clon da la
misma cifra que contra producción, porque lleva las mismas cuentas y los mismos datos.

Del sistema documental comprueba que el técnico lee plantillas y parámetros pero **no los
escribe**, que el super_admin sí, que ninguna cuenta externa ve plantillas, parámetros, enlaces ni
evidencias, que **el nomenclátor sí lo ve todo el mundo** (es catálogo, como `productos`) y —lo que
no afirmaba nada más— que **ni el equipo puede leer `enlaces_token.token_hash`,
`evidencias.documento_identidad` ni `parametros_documentales.apoderada_dni`**.

Dos mecanismos que conviene conocer antes de tocarlo:
- **`Check.columnas`**. En las tablas con GRANT por columnas, un `select('*')` lo corta el GRANT
  *antes* de evaluar ninguna política, así que un check «denegar» saldría verde **sin haber probado
  la RLS**. Con la lista explícita, lo que devuelve 0 filas es la política; la columna sensible se
  comprueba aparte, con su propio check que sí espera `permission denied for column`.
- 🔴 **Un error que no es un rechazo NO demuestra que la autorización dejó pasar** (21-09-2026).
  Muchos checks de `permitir` se llaman a propósito con un **uuid inexistente** —el arnés corre
  contra producción y no puede escribir—, así que se espera un error y lo que se mide es la
  guarda de ROL. La rama `rpc` daba por bueno **cualquier** error en ese caso, y eso incluía los
  de programación: **`canalitzacions_actives` respondía `42702 column reference is ambiguous`
  desde que se creó —no devolvió una fila ni una vez— y el arnés la contaba en verde**. Ahora
  solo cuentan los **errores de negocio** (`ERRORES_DE_NEGOCIO`: los `PT4xx` del circuito,
  `22023` y las restricciones `235xx`); la clase `42` y `22P02` significan que la función está
  rota y son FALLA aunque el check sea de `permitir`. ⚠️ Lo destapó **ejecutar la función desde
  la pantalla**, no el arnés: el SQL de una migración es una cadena para `deno check`, así que
  lo único que encuentra esto es llamarla.
- 🔴 **El arnés cierra su sesión con `signOut({ scope: "local" })`, y no es un detalle**
  (28-09-2026). El `signOut()` por defecto de supabase-js es **global**: cierra todas las
  sesiones de la cuenta. Como entra con las mismas cuentas de los botones de `/login`, cada
  pasada echaba a quien las estuviera usando en el navegador, y de una forma engañosa: la
  pantalla seguía cargando —PostgREST solo verifica la firma del JWT— pero las Edge Functions
  respondían `401` (`getUser()` → `session_not_found`), así que las descargas fallaban sin
  motivo aparente. Y el **«Sortir» de la aplicación también es `scope: "local"`** desde el
  mismo día (`UserMenu`, `AppSidebar` y la pantalla «sense accés» de `Comuns`), por decisión
  del cliente: salir cierra solo el dispositivo actual. Antes era global y salir en el móvil
  cerraba el ordenador. ⚠️ `RestablirClau` conserva el `signOut()` por defecto: ahí es el
  final de un enlace de recuperación, no el botón de salir.
- **Un `UPDATE` denegado por RLS no da error.** PostgREST no encuentra filas que cumplan el `using`
  y devuelve éxito con cero afectadas, así que un rechazo era indistinguible de un acierto. La rama
  de `actualizar` pide ahora las filas afectadas (`.select('id')`) y trata «cero filas sobre una
  fila que sé que existe» como denegación. Es el argumento del §12.48 por el otro lado. Es la primera comprobación automática del proyecto que no es `tsc`. Las
credenciales viven en `scripts/data/cuentas-prueba.json` (fuera de git).

Si algo sale mal: **Nivel 0**, `update app_settings set value='false' where key='roles_activos';`
(10 segundos). **Nivel 1**, `scripts/sql/rls-emergencia.sql`, que vive **fuera** de
`supabase/migrations/` para que `db push` no lo aplique nunca.



### Notas internas (plan 1, rebanada 1F, `20270502100000`, 02-11-2026)

| RPC | Quién | Qué hace |
| --- | --- | --- |
| `afegir_nota_interna(p_org, p_canal, p_text, p_data default now()) → notes_internes` | `es_intern()` **con sesión** (`auth.uid() is null` también `42501`) | Inserta la nota con `autor = auth.uid()` (no se firma en nombre de otro). Errores `22023`: `canal_nota_desconegut`, `nota_buida`, `nota_massa_llarga` (> 2.000), `nota_futura` (más de un día por delante), `organitzacio_inexistent`; el permiso va **antes** que la existencia |
| `esborrar_nota_interna(p_id)` | `es_super_admin()` con sesión | Borra la nota; `22023 nota_inexistent` si no está |
| `afegir_nota_interna(…, p_tipus default 'seguiment', p_responsable default auth.uid(), p_propera_accio, p_propera_data)` (04-11-2026, `20270504100000`: drop + create, la llamada de 1F sigue valiendo) | igual | Nuevos `22023`: `tipus_nota_desconegut`, `responsable_no_equip` (sin fila en `usuario_roles`), `propera_accio_sense_data` / `propera_data_sense_accio`, `propera_accio_massa_llarga` (> 500) |
| `tancar_seguiment(p_id)` (04-11-2026) | `es_intern()` con sesión | Da por hecha la próxima acción (`seguiment_fet_at = now()`, `_per = auth.uid()`); idempotente. `nota_inexistent`, `nota_sense_seguiment` |
| `demanar_consentiment(p_org, p_email)` (04-11-2026, `20270506100000`) | `es_intern()` con sesión | Acuña el enlace `consentiment_rgpd` (revoca el anterior) y devuelve el token en claro para el correo. `organitzacio_desconeguda`, `sense_correu` |
| `llista_consentiments()` (04-11-2026) | `es_intern()` con sesión | Consentimiento vigente por persona y tipo, con correo y organización (exportación) |
| `preparar_enviament_albara(p_albaran, p_per)` (04-11-2026, `20270507100000`) | solo `service_role` (`enviar-albara`) | Documento vigente y destinatarios de correo del albarán (misma regla que `marcar_entregado`); si está `entregado` y la parte no ha confirmado, revoca su enlace de correo activo y acuña uno nuevo (token en claro solo en la respuesta). `albara_no_emes` (22023), `albara_desconegut` (PT404) |
| `equip_membres()` (09-11-2026, `20270513100000`) | `es_super_admin()` (`42501` al resto; `security definer`) | **El equipo**: una fila por cuenta con rol de plataforma (no los usuarios de organizaciones): `user_id`, `email` (de `auth.users`), `nom`, `rol` (el más alto, como `mi_rol()`), `actiu`, `ultim_acces`, `des_de` y `otorgat_per` (de esa fila), `es_tu`. Lo pinta Configuració › Equip |
| `canviar_rol_equip(p_user, p_rol)` (09-11-2026, `20270513100000`) | `es_super_admin()`; el permiso va antes que la existencia | Fija el rol de una cuenta **del equipo**: `super_admin`·`admin`·`tecnic`, o `cap` (la saca; conserva sus membresías de organización). Deja UNA sola fila en `usuario_roles` (la PK `(user_id, rol)` permitía dos y «subir» dejaba la vieja) y una fila en `equip_rols_hist` (con los correos, no solo ids). `22023`: `rol_invalid`, `no_et_pots_canviar` (a uno mismo), `usuari_inexistent`, `no_es_de_lequip` (no da de alta cuentas ni convierte una externa: da acceso a todo y merece su propia puerta), `ultim_super_admin` (nunca el equipo sin super_admin; bloqueo `pg_advisory_xact_lock`). Mismo rol y una fila → no-op sin historial (`canviat:false`) |
| `equip_membres()` (redefinida en `20270514100000`) | `es_super_admin()` | Gana `telefon` y `membresies` (membresías de organización activas: debería ser 0). `drop` + `create`, porque `create or replace` no cambia `returns table` |
| `editar_membre_equip(p_user, p_nom, p_telefon)` (`20270514100000`) | `es_super_admin()`; también a uno mismo | Nombre (≤120) y teléfono E.164 sin `+` (8-15 cifras, sin cero inicial; la RPC quita `+`, espacios, guiones y paréntesis). **El correo no**: es el de acceso y va por la Admin API. `22023`: `nom_massa_llarg`, `telefon_invalid`, `usuari_inexistent`, `no_es_de_lequip`. Sin cambio real → `canviat:false` |
| `activar_membre_equip(p_user)` · `desactivar_membre_equip(p_user, p_desti default null)` (`20270514100000`) | `es_super_admin()`; **nunca a uno mismo** (`no_et_pots_tocar`) | Activar/desactivar = `perfiles.activo` (todos los helpers de rol lo exigen: la cuenta pierde TODO). Desactivar cierra sus `auth.sessions` y, con `p_desti`, traspasa antes sus acciones; el único super_admin activo no se desactiva (`ultim_super_admin`). Desactivar lo ya inactivo con destino sirve para traspasar |
| `esborrar_membre_equip(p_user, p_desti default null)` (`20270514100000`) | `es_super_admin()`; nunca a uno mismo ni al último super_admin activo | Borra de `auth.users` (perfil, rol y sesiones en cascada). **Sin `p_desti` solo si la cuenta no ha hecho nada** (`cal_desti`): dejar las autorías a NULL rompe reglas de negocio (un convenio «declarado» exige constar quién lo declaró, `convenios_numero_segons_estat`) y deja lo emitido sin responsable. Antes de esta migración era IMPOSIBLE borrar a quien hubiera emitido algo: el `SET NULL` disparaba la inmutabilidad |
| `traspassar_accions_equip(p_origen, p_desti)` · `equip_accions(p_user)` (`20270514100000`) | `es_super_admin()` | Pasar todo lo que consta a nombre de una cuenta a otra **activa y del equipo** (`desti_igual`, `desti_no_equip`), y contarlo `{accions:[{taula,columna,n}], total, membresies, es_equip}` para el diálogo |
| `equip_columnes_autoria()` · `equip_moure_accions()` · `equip_valida_desti()` · `equip_total_accions()` · `trg_membresia_no_equip()` · `trg_rol_no_membre()` (`20270514100000`) | internas: sin EXECUTE para sesiones | Ver «Gestión del equipo» en `04-modelo-de-datos.md`. `equip_moure_accions()` redefinida en `20270515100000`: apunta cada fila movida en `equip_traspassos_files` y devuelve también `traspas_id` |
| `equip_auditoria(p_user default null, p_limit default 200)` (`20270516100000`) | `es_super_admin()` (42501) | Auditoría del equipo con nombre y correo aunque la cuenta esté borrada (`esborrat`); `mou_accions` = cada traspaso. `equip_autoria_fila` gana los nombres (drop + create) |
| `regenerar_documents_fundacio(p_accepto default false)` (`20270516100100`) | `es_super_admin()` (42501); con `p_accepto`, además `test_mode` encendido (`22023 nomes_en_mode_test`) | Sin aceptar, informa; aceptado, emite la versión siguiente de lo vigente no firmado con los datos actuales de la Fundació. Interna sin EXECUTE: `documento_datos_fundacio_actual(jsonb, text)`; triggers `trg_equip_arxiva_persona`, `trg_equip_noms` |
| `cortina_config()` · `cortina_activar(p_activa)` (`20270517110000`) | `es_super_admin()` (42501); `cortina_activar(null)` → `22023` | La «pantalla de protección previa a la home» (§9): estado, contraseña en claro (solo la ve el super_admin) y encender/apagar. La tabla `cortina_config` no tiene GRANT para nadie |
| `cortina_desar_contrasenya(pw, hash, per)` (`20270517110000`) | solo `service_role` (la llama la Edge Function `cortina-config`, que calcula la huella) | Guarda contraseña y huella a la vez (CHECK: juntas o ninguna) |
| `equip_autoria_fila(p_taula, p_id)` (`20270515100000`) | `es_super_admin()` (42501) | La cadena de traspasos de una fila (clave primaria simple), del más antiguo al más reciente: el primer `origen_email` es quien la hizo. Vacía si nunca se traspasó |
| `registrar_consentiment_enllac(...)` (04-11-2026) | solo `service_role` (`enlace-publico`) | Guarda las tres respuestas del enlace con la huella del servidor, deja evidencia y gasta el enlace. `PT404`/`PT409`/`PT410`, `falta_acceptacio`, `dades_invalides` |

Arnés (04-11-2026, +18 en total): `tancar_seguiment` y `activar_organitzacio` denegadas a las externas;
el técnico cierra seguimientos (`22023`) y no activa organizaciones; el super_admin, las dos (`22023`).

Las dos: `revoke execute` de `public, anon, service_role` y `grant` a `authenticated`;
`auditoria_funcions_obertes()` sigue en 0. Arnés (+36): leer e insertar en `notes_internes` y las dos
RPC, denegadas a las siete cuentas externas (`DOCUMENTAL_EXTERN`; leer = 0 filas); el técnico lee
(«sin datos» si no hay notas), añade (`22023` con uuid inventado) y no borra ni inserta directo; el
super_admin lee, añade y borra (`22023`) y tampoco inserta directo.

### El acceso a la plataforma de una entidad que ya existe (plan 1, rebanada 1D, `20270501500000`, 02-11-2026)

D5 + P1: **el alta del equipo es siempre sin acceso** (`crear_entitat`), y el acceso se da después,
**sobre la organización que ya existe**, con un correo para que la persona ponga su contraseña. Lo hace
la Edge Function `donar-acces` (§9) con cuatro RPC:

| RPC | Quién | Qué hace |
| --- | --- | --- |
| `concedir_acces_org(p_org, p_user, p_email, p_per) → jsonb` | **solo `service_role`** (con sesión, `42501`) | En una transacción, con `for update` sobre las fichas activas: vuelve a comprobar los invariantes (`organitzacio_inexistent`, `correu_invalid`, `entitat_inactiva`, `perfil_inexistent`, `compte_equip`, `registre_pendent`, `compte_en_altra_org`, `altre_compte_actiu`, todos `22023`), escribe el correo en las fichas activas si cambia, crea o reactiva la membresía **titular · aprovada · activa · `aprovat_per`** en **cada ficha activa** y pone `perfiles.activo = true`. Devuelve una **foto** de lo anterior (`correus`, `noves`, `reactivades`, `perfil_activo`, `canvis`) |
| `revertir_acces_org(p_foto jsonb)` | **solo `service_role`** | Deshace lo que dice la foto: la compensación de `donar-acces` si falla el enlace o el correo |
| `desactivar_acces_org(p_org) → jsonb` | `pot_aprovar()` (técnico y externos, `42501`; existencia, `22023`) | `membresias.activo = false` en todas las fichas de la organización; `perfiles.activo = false` de cada cuenta que se queda sin otra membresía activa **y no tiene `usuario_roles`** (nunca desactiva una cuenta del equipo). Reactivar = «Dona-li accés» otra vez |
| `estat_acces_org(p_org) → table(estat, compte_email, enviat_at, darrer_acces_at)` | `es_intern()` | El estado para la ficha: `sense` · `pendent` (registro por validar) · `enviat` (no ha entrado) · `actiu` · `desactivat`. **El correo sale enmascarado** (`···@domini`); `enviat_at` es el último `documento_envios` con `proposito = 'acces_entitat'` y `darrer_acces_at`, `auth.users.last_sign_in_at`. La pantalla no consulta `auth` |

**Desviación del plan**: el plan ponía la lectura del estado dentro de la función; como RPC sale igual
de enmascarada, el frontend sigue sin tocar `auth` y el arnés puede comprobar quién la lee.
`concedir_` y `revertir_`: `revoke` de `public, anon, authenticated` y `grant` a `service_role`;
`desactivar_` y `estat_`: `revoke` de `public, anon, service_role` y `grant authenticated`.
`auditoria_funcions_obertes()` sigue en 0.

Arnés (+36): las cuatro denegadas a las siete cuentas externas (`DOCUMENTAL_EXTERN`); el técnico lee el
estado (`22023` con uuid inventado) pero no desactiva; el super_admin lee y desactiva; `concedir_` y
`revertir_` denegadas a todo `authenticated`.

### `crear_entitat()`: el alta de una entidad (plan 1, rebanada 1B, `20270501300000`, 02-11-2026)

`crear_entitat(p_dades jsonb) returns jsonb` (`{organizacion_id, productor_id, entidad_id}`),
`security definer`, `revoke` de `public`, `anon` **y `service_role`** (ningún job da de alta; la
importación de 1E escribe con su script). Es el paso 2 de «Nova entitat» (§6ter). Decisiones aplicadas:

- **P2, ampliada: TODA alta del panel pasa por la RPC, con uno o con dos papeles.** El plan la pedía
  «si hay doble rol»; con un papel también, para que haya un solo camino y las reglas vivan en el
  servidor y no solo en la pantalla. Crea la primera ficha (el trigger `*_estrena_organizacion` estrena
  la organización) y cuelga la segunda de ella; un fallo de cualquiera deshace las dos.
- **Nace activa, así que se le exige lo que a una que se activa** (D2, P9): NIF presente y válido
  (`falta_nif`, `nif_invalid`, mismos códigos que el trigger de 1A, que solo mira los UPDATE de
  `activo`) y razón social (`falta_rao_social`). El NIF repetido lo corta el trigger del NIF al
  insertar (`nif_en_us`). Un correo o teléfono que ya tiene otra ficha de productor (índices únicos)
  da `22023 dades_en_us`.
- **Un receptor necesita `tipo_receptor`** (`cal_tipus_receptor`): sin él no ve ninguna oferta del
  Mercat (`modalitat_receptor_compat`) y nada se lo diría. Decisión de 1B (en 1C el alta no lo pedía).
- **Permiso `es_intern()` con sesión** (el técnico también), el mismo que el alta directa de antes
  (RLS `alta intern`); activar una ficha que ya existe y añadir un papel siguen siendo de
  `pot_aprovar()` (1A). Externos: `42501`.
- Claves de `p_dades`: `rols` (`productor`/`entidad`), `es_test` y las de `CLAUS_ALTA` de
  `src/lib/campsFitxa.ts` (`nom_comercial`, `razon_social`, `nif`, `tipus_empresa`, `tipus_activitat`,
  `persona_contacte`, `email`, `telefon`, `direccion`, `codigo_postal`, `municipio_ine`,
  `tipo_receptor`), **las mismas claves que la ficha**, que la RPC reparte a las columnas de cada tabla.
  `tests/campsFitxa.test.ts` las lee del SQL y exige que coincidan. Las actividades se reparten por
  papel con `tipus_activitat.aplica` (las `ambdos`, en las dos); una que no aplica a ningún papel
  elegido da `tipus_activitat_desconegut`.
- Deja una fila en `fitxa_estat_hist` por ficha (activa, `per = auth.uid()`): quién la dio de alta.
- **Es la única puerta de alta del panel** (deuda §12.150, cerrada el 02-11-2026 con `20270501400000`):
  sin las políticas `alta intern` ni el GRANT de INSERT, nadie con sesión inserta en `productores` ni
  en `entidades`; las tres funciones que lo hacen (`crear_entitat`, `afegir_paper_org_equip`,
  `afegir_paper_organitzacio`) son `security definer`, y el registro, el alta asistida y el import
  escriben con `service_role`. El arnés lo vigila (+4: el técnico y el super_admin, `insertar` en las
  dos tablas, `42501`).

Arnés: `crear_entitat` denegado a las siete cuentas externas (`DOCUMENTAL_EXTERN`) y permitido
—con `rols: []`, `22023 cal_paper`, sin escribir nada— al técnico y al super_admin: **+9**.

### Importación de entidades desde Excel (`20270511100000`, 06-11-2026)

- **`alta_fitxa_interna(p_rols, p_org, p_activo, p_productor jsonb, p_entitat jsonb)`**: el núcleo del alta,
  **sin EXECUTE para nadie** (ni `service_role`). Crea las fichas en una organización nueva o colgadas de
  `p_org`, activas o inactivas, con rastro en `fitxa_estat_hist`; `unique_violation` → `22023 dades_en_us`.
  `crear_entitat()` se recreó encima (comparada con la anterior en 16 entradas: mismos errores y mismo
  resultado; sigue leyendo de `d` las mismas claves, así que `tests/campsFitxa.test.ts` no cambia).
- **`previsualitzar_importacio_entitats(p_files jsonb)`** e **`importar_entitats(p_fitxer jsonb, p_files
  jsonb)`**: `if auth.uid() is not null and not es_super_admin() then 42501` (técnico y admin también
  fuera; `service_role` pasa, con `creat_per` null). Las dos ejecutan **el mismo código**
  (`importacio_processa(..., p_aplicar)`), así que la previsualización dice exactamente lo que hará la
  importación sobre la misma base. `volatile` (crean tablas temporales con índice btree y GIN de
  trigramas): **siempre por POST**, nunca `{get:true}`. Medido en el clon (~736 fichas): 1.000 filas en
  0,29 s (previsualizar), 0,43 s (importar) y 0,44 s (reimportar), dentro del `statement_timeout` de 8 s.
  **B4 (`20270519100000`)**: la importación **actualiza** (celda vacía no toca, valor distinto sobrescribe salvo lo
  que ya vale la organización) e identifica primero por «ID Redestina»; cada fila devuelve `canvis` y el registro
  los guarda (`importacions_entitats_files.canvis`, lectura del equipo). Internas nuevas sin EXECUTE para nadie:
  `entitat_valors_org(productores, entidades)` (también la usa `exportar_entitats`), `importacio_si_correu`,
  `importacio_si_telefon`; `importacio_compara` pasa a 4 argumentos (`p_protegits`). El arnés comprueba que
  `importacio_compara` e `importacio_si_correu` dan 42501 a todos y que `canvis` solo lo lee el equipo. Detalle en
  `context/06` §6.4.
  - Errores de lote (`22023`): `dades_invalides`, `massa_files` (>1.000), `fila_invalida`, `fila_repetida`,
    y en `importar_entitats` además `sense_files` y `dades_invalides` si `p_fitxer` no trae `nom` (≤255) y
    `sha256` (64 hex).
  - `importar_entitats` toma `pg_advisory_xact_lock(hashtext('importar_entitats'))` (no hay índice único
    de NIF: el candado impide dos importaciones a la vez), **recalcula la identidad** de cada fila y abre
    un savepoint por fila: un error de fila no aborta el lote; un `42501`, sí.
  - **Identidad, por orden**: NIF válido (en cualquiera de las dos tablas) → `ref_externa` `AIRTABLE:` →
    `IMP:`; si no hay fuerte, **débil** = correo exacto, teléfono por las últimas 9 cifras (principales y
    secundarias) o nombre con similitud ≥ 0,65 → fila `dubtosa` con hasta 10 `candidats`. **Nunca une
    sola**: la `decisio` (`crear` · `ometre` · uuid de un candidato recalculado) solo cuenta en filas
    dudosas; sin ella, `omesa`; un uuid que no es candidato, `error decisio_no_candidata`.
  - **Acciones**: nueva → fichas **inactivas** de los papeles pedidos en una organización; existente con
    el papel → **solo rellena huecos** (nunca pisa, nunca toca `activo`, `es_test` ni `ref_externa`; las
    diferencias, en `conflictes`); existente sin ese papel → `paper_afegit` en la misma organización
    (inactiva, con lo que falte copiado de la hermana, su `es_test` y su NIF). La nota va como bloque
    `[Importació AAAA-MM-DD · fila N]`; en una ficha existente solo se añaden las líneas que no estén.
    **Reimportar el mismo fichero deja todas las filas en `sense_canvis`.**
  - Dentro del lote: NIF o ref `IMP:` repetidos, o dos filas que resuelven a la misma organización →
    `repetit_al_fitxer:<fila>` en la segunda; correo o teléfono compartidos con una fila anterior →
    aviso `semblant_a_fila:<n>` (sin unir).
  - Avisos (no bloquean): `sense_nif`, `nif_invalid` (entra sin NIF, valor original a la nota),
    `nif_diferent_germana`, `correu[2]_invalid`, `telefon[2]_invalid`, `correu_en_us` y `telefon_en_us`
    (UNIQUE de `productores`: a la nota), `correu2_a_nota`, `tipus_empresa_desconegut`,
    `tipus_activitat_desconegut:<codi>`, `modalitat_desconeguda:<v>`, `sense_tipus_receptor`,
    `tipus_receptor_desconegut`, `codi_postal_invalid`, `municipi_ine_desconegut`, `municipi_no_trobat`,
    `area_desconeguda`, `area_no_coincideix`, `ref_externa_en_us`.
- Internas sin EXECUTE desde ninguna sesión: `importacio_processa`, `importacio_aplica_fila`,
  `importacio_actualitza`, `importacio_normalitza_fila` y nueve ayudantes `importacio_*`;
  `auditoria_funcions_obertes()` sigue en 0.
- Arnés: +99 checks (95 ejecutados; las 4 «sin datos» son la lectura del registro por el equipo mientras
  no haya ninguna importación, deuda 167). Prueba `scripts/sql/prova-importacio.sql`: 67 comprobaciones.

### La lista blanca del actor, ampliada (plan 1, rebanada 1C, `20270501200000`, 02-11-2026)

`actualitzar_fitxa_entitat()` acepta además `telefono2`, `telefono3`, `email2`, `contacto2`,
`productes_frescos[_txt]`, `transport_plataforma[_txt]` y `descarrega_toro[_txt]` (P5: son datos de la
organización; los tres booleanos admiten `null`, otro tipo da `22023 logistica_invalida`). Siguen
fuera `tipo_receptor`, `estat`, `prioritat`, `es_test`, `activo`… **La lista blanca y `campsFitxa.ts`
no pueden separarse**: `tests/campsFitxa.test.ts` lee las claves `d ? '…'` de la última migración
que define cada RPC y las compara con `edita: 'tots'`. Al ampliar una, se amplía la otra en el mismo
cambio. `actualizar_meu_canal()` la usa también la ficha del equipo (ya admitía `es_intern()`).

### RPC del estado de las fichas (plan 1, rebanada 1A, `20270501100000`, 02-11-2026)

| RPC | Quién | Qué |
| --- | --- | --- |
| `cerca_entitats(p_q, p_nomes_actives=false, p_limit=10)` | `es_intern()` con sesión | Busca organizaciones por NIF (normalizado, prefijo; exacto primero) y por nombre (contiene o `similarity ≥ 0.4` sobre `nom_comercial`, `razon_social`, `nombre`). Menos de 3 caracteres = vacío. Devuelve ficha(s), estado y `compte_estat` (D6). |
| `activar_fitxa(p_tipus, p_id)` / `desactivar_fitxa(…)` | `pot_aprovar()` con sesión | `{tipus,id,activo,canviat}`; idempotentes. `fitxa_inexistent`, `tipus_desconegut`; las reglas de activar las pone el trigger. |
| `fixar_estat_crm(p_tipus, p_id, p_estat)` (B1, `20270518100000`) | `pot_aprovar()` con sesión | `void`. Fija el estado CRM de un papel (`potencial · en_desenvolupament · actiu · inactiu`); `activo` y las reglas de activar (NIF, razón social) los pone el trigger. Permiso antes que existencia: `42501`, luego `22023 estat_desconegut · tipus_desconegut · fitxa_inexistent`. `aprovar_registre()` conserva firma y retorno y, desde B1, intenta pasar la ficha a `actiu` (en un subbloque: si el trigger corta, la aprobación sigue). |
| `exportar_entitats(p_ids uuid[] default null)` (B3, `20270518110000`) | `es_intern()` con sesión (**también `tecnic`**, D10); externos `42501` | `returns table`: una fila por organización con ficha (`p_ids` = las visibles; `null` = todas), en **códigos**: papeles, nombre, razón social, NIF, forma jurídica, tipo de receptor, actividades (orden del catálogo), modalidades, contacto (el `name` del productor solo si no es igual a `empresa`), correos, teléfonos, dirección, CP, municipio (nombre legible; sin INE, la ubicación), comarca, ID Airtable, `data_alta` (texto, la más antigua de las dos fichas) y `estat_crm` de cada papel. Solo lectura; la compone el navegador (`lib/exportEntitats.ts`). Arnés: externos denegar, equipo y super_admin permitir. |
| `desactivar_organitzacio(p_org)` | `pot_aprovar()` | Desactiva los dos papeles; devuelve cuántos. `organitzacio_inexistent`. |
| `activar_organitzacio(p_org)` (04-11-2026, `20270504100000`) | `pot_aprovar()` con sesión | «Activa l'entitat»: todas sus fichas en una transacción (si a una le falta NIF válido o razón social, el trigger corta todo); devuelve cuántas. `organitzacio_inexistent`. |
| `afegir_paper_org_equip(p_org, p_paper)` | `pot_aprovar()` | Crea la ficha hermana con los datos comunes, `es_test` y `activo` de la existente, sin membresía; el NIF solo se copia si es válido. `paper_desconegut`, `organitzacio_inexistent`, `ja_te_paper`, `organitzacio_buida`, `dades_en_us`. |

Las cuatro: `revoke … from public, anon, service_role` + `grant … to authenticated` (piden sesión).
La guarda es `auth.uid() is null or not …` → `42501`: aquí `service_role` tampoco entra, porque
el autor del cambio tiene que quedar en el historial.

- **Revocadas de `authenticated`**: `desar_contacte_org()` y `esborrar_contacte_org()` (D3, deuda 146).
- **`comprova_interes()`**: su primera comprobación es ahora `entitat_inactiva` (22023), así que la
  rechazan por igual `manifestar_interes()` y `manifestar_interes_assistit()`.
- **`kpis_equip()`**: claves nuevas `entitats_actives`, `ofertants_actius` y `receptors_actius` (foto de
  hoy). `entitats_receptores` no se filtra por `activo`: es un hecho del periodo, y filtrarla por el
  estado de hoy falsearía periodos pasados.

### Firma de documentos (circuito unificado, `20270510100100`, 05-11-2026)

| RPC | Quién | Qué hace y errores |
|---|---|---|
| `document_part_signant(doc)` · `puc_signar_document(doc, user)` | `authenticated` | Consultas: qué parte firma la versión vigente (0 filas si no se puede) y si esta cuenta puede firmarla (equipo siempre; externo solo titular activo y documento real) |
| `acunar_enllac_propi('firma_document','documento',doc)` | titular | Enlace `panel` 1 h → `{id, token, url_path '/signar-document/<token>', caduca_at}`. `42501` si no es suyo/no titular/prueba; `22023 usa_firma_conveni`·`versio_substituida`·`ja_signat`·`no_signable` |
| `signar_document_per_enllac(enlace, evidencia)` | solo servidor | Firma con trazo: valida (`PT404/PT409/PT410`, `document_canviat`, `dades_invalides`), inserta `evidencias` y **cierra** (versión `signat` encolada). `42501` si una sesión la llama |
| `registrar_document_signat(doc, user, fitxer, signant)` | solo servidor | Fichero subido: `42501` sin permiso (antes que existencia); `no_signable`·`versio_substituida`·`ja_signat`·`dades_invalides`. Super_admin → `correu` y cierre; si no → `pujat`, queda `signat` |
| `tancar_signatura(firma, nota)` · `rebutjar_signatura(firma, motiu)` | `es_super_admin()` | Desde `signat`; `cal_motiu`, `estat_incorrecte`, `versio_substituida` |
| `preparar_enviament_signatura(doc, email, per)` | solo servidor | Enlace `email` 30 días para el correo con «signa'l en línia»; `sense_correu`, `usa_firma_conveni`, `ja_signat`… |
| `document_emet_versio_signada`, `document_signatura_comprova`, `ruta_document_signat` | internas / servidor | Sin EXECUTE desde la API |

Triggers de respaldo nuevos: `documentos_firma_substituida` (rechaza sola la firma que esperaba sobre una
versión sustituida), `firmes_document_avis` (aviso al cerrar), `documentos_esborra_enllacos_firma`.
Arnés: bloques `FIRMA_SERVIDOR` y `FIRMA_EXTERN`; `filasExactas` para las 17 colas de `pendents_equip`.

## Familias de RPC que el canónico ya no enumera (movidas de `AGENTS.md` el 02-11-2026, 1E)

### Lista de familias movida de `AGENTS.md` (10-11-2026, A1, para hacer sitio)

Párrafo de §4bis «Superficie de escritura de los paneles = RPC» tal como estaba en el canónico:

- **Superficie de escritura de los paneles = RPC**, no políticas. Familias (nombres exactos en
  el detalle): interés y aprobación (`manifestar_interes`, `manifestar_interes_assistit`,
  `comprova_interes`, `aprovar_resposta`, `declinar_oferta`, `registrar_envio_manual`); ficha
  propia (`actualitzar_fitxa_productor/entitat` con lista blanca, `actualizar_meu_canal`,
  `afegir_paper_organitzacio`); ofertas (`cancelar_meva_oferta`, `validar_oferta`,
  `rebutjar_oferta`, `editar_oferta` solo servidor, `fixar_fotos_oferta`, `registrar_desti_final`,
  `desti_excedent`, `marcar_canvis_revisats`); recogida (`registrar_recollida` del receptor
  **solo declara**; `validar_recollida`/`retornar_recollida` del admin emiten y concilian;
  `registrar_recollida_assistida`, `confirmar_recollida` envoltorio, `fixar_hora_recollida`, `operacio_detall`); albaranes (`emitir_albaran` con candado
  `recollida_no_validada`, `marcar_entregado`, `registrar_confirmacion`, `conciliar_albaran` en
  cascada con motivo obligatorio ante incidencia, `anular_/rectificar_albaran`,
  `crear_espigolada` —convierte una oferta `producte_al_camp`—, `repartir_espigolada`);
  convenios (ciclo `*_convenio`, `*_conveni_*`, `iniciar_firma_asistida`, `acunar_enllac_*`;
  `firmar_convenio_por_enlace` solo servidor); organización
  (`organitzacions_candidates`, `enllacar_organitzacio`, `aprovar_/rebutjar_registre`,
  `cerca_entitats` —equipo, NIF y nombre, D6—, `crear_entitat` (1B, `es_intern()`: NIF válido, razón social y
  `tipo_receptor`), `exportar_entitats` (B3, `es_intern()`), `activar_/desactivar_fitxa`, `fixar_estat_crm` (B1),
  `activar_/desactivar_organitzacio` y `afegir_paper_org_equip` —`pot_aprovar()`—; acceso (1D):
  `estat_acces_org` (equipo, correo enmascarado), `desactivar_acces_org` (`pot_aprovar()`),
  `concedir_/revertir_acces_org` (solo `service_role`, los usa `donar-acces`); notas (1F):
  `afegir_nota_interna` y `tancar_seguiment` (`es_intern()` con sesión), `esborrar_nota_interna`
  (`es_super_admin()`); RGPD: `demanar_consentiment`, `llista_consentiments` (equipo),
  `registrar_consentiment_enllac` (servidor); albarán por correo: `preparar_enviament_albara` (servidor); equipo (`es_super_admin()`, nunca a uno mismo: `equip_*`, `canviar_rol_equip`, `*_membre_equip`, `traspassar_accions_equip`);
  `borrar_ficha_completa`, `bloqueigs_esborrat_fitxa`); importación (`previsualitzar_importacio_entitats`,
  `importar_entitats`: `es_super_admin()`, ≤1.000 filas); firma (`acunar_enllac_propi('firma_document',…)`
  titular, `tancar_/rebutjar_signatura` super_admin, `puc_signar_document`; servidor: `signar_document_per_enllac`,
  `registrar_document_signat`, `preparar_enviament_signatura`);
  y las de cierre y certificados, diagnóstico y
  plan, equipo, interruptores y jobs (solo `service_role`), con su nombre, en el detalle (§4bis, «Familias»).



Para que `AGENTS.md` quepa en su tope de 48 KB, estas familias se citan allí solo por su nombre. La
lista, tal como estaba:

- cierre y certificados (`abrir_/calcular_/cerrar_cierre`, `emitir_resumen`, `emitir_certificado*`, `emitir_certificados_cierre`, `*_transaccion*`, `*_periodo`, `*_recepcio`, `rectificar_*`, `reiniciar_*_prova`, `cierre_base*` solo equipo); diagnóstico y plan (`questionari_vigent`, `publicar_questionari`, `desar_diagnostic`, `generar_pla_des_de_diagnostic` y `emitir_plan_basico` solo equipo, `desar_mesures_pla`, `fixar_nivell_pla`, `diagnostic_estat`, expedientes `obrir_/desar_/verificar_/tancar_/exportar_expedient`, `desar_element_expedient`); equipo (`pendents_equip()` 16 colas, `kpis_equip`, `canalitzacio_assistida`, `canalitzacions_actives`, `avisos_de_oferta`, `avisos_sense_enviar_per_oferta`, `progres_meves_ofertes`, `pendents_meus`, `missatges_sense_contestar`, `kg_rebuts_exercici`, `impacte_*`); interruptores (`fixar_notificacions`, `fixar_canal_notificacio`, `fixar_factor_impacte`, `fijar_coste_producto`); jobs solo `service_role` (`programar_albarans_recollida`, `recordar_confirmacions_recollida`, `conciliacions_automatiques`, `volcar_quantificacio_expedients`, `disparar_recordatorios_intake`, `marcar_excedentes_vencidos`, `congelar_un_cierre`).

### Operativa del productor (Plan 2, A4, `20270521100000`, 10-11-2026)

- **`fixar_lloc_principal(p_lloc uuid) returns void`** (security definer): sin ficha de productor ni ser del equipo →
  `42501`; lugar inexistente → `22023 lloc_inexistent` (solo después de comprobar el permiso); lugar de otro → `42501`
  («Aquest lloc no es teu»). Desmarca los demás y marca ese. `grant` a `authenticated` y `service_role`.
- **`actualitzar_fitxa_productor`**: misma firma; la lista blanca crece con `productos_habituales`,
  `productes_principals`, `varietats`, `volum_produccio`, `temporada`, `envasos_habituals`, `canals_comercials`,
  `tipologia_clients`, `facturacio_anual_eur`, `facturacio_rang`, `volum_comercialitzat_kg`, `suport_interes` (con
  validación de forma: lista, objeto o número → `22023`). Paridad con `campsFitxa.ts` en `tests/campsFitxa.test.ts`.
- **El equipo** escribe la Operativa por UPDATE directo (política `productores: edicio intern`), también desde la
  sección 1 del diagnóstico: «Desa» escribe primero lo cambiado de la ficha y después `desar_diagnostic`.
- **`desar_diagnostic`** ya no deriva `productos_habituales` ni `temporada` (T4: son origen).
- **Arnés** (+30): lectura de las columnas nuevas por productor, equipo y super_admin; el productor no hace UPDATE
  directo; cinco CHECK y una forma inválida por la RPC (`errorExigit`, sin escribir); `fixar_lloc_principal` con uuid
  inventado = `22023` para productor y equipo, denegada a receptor, sin rol y pendiente; lectura de
  `productor_ubicaciones` con `es_principal, dies_setmana, franges`.

### `diagnostic-pdf`: el PDF del diagnóstico bajo demanda (Plan 2, A2, 10-11-2026)

Edge Function con `verify_jwt = true` y la autorización en dos capas, como `descargar-documento`:
`contextoUsuario()` (sesión y cuenta activa → `401`) y después `diagnostic_datos(p_tipo_org, p_org, p_user)` con
`p_user = ctx.userId` (la misma regla que la pantalla: equipo, o membresía aprobada y activa de esa ficha). La RPC
comprueba el permiso antes que la existencia, así que un productor ajeno **y un uuid inventado** reciben `403
forbidden` (un id que no es uuid, también `403`, sin llegar a la base). `22023 nomes_productors` → `400`;
`fitxa_inexistent` → `404`. **Sin RPC ni política nuevas** (por eso A2 no añade checks al arnés): lo que se
comprueba es la función, en `tests/e2e/diagnostic-pdf.e2e.ts` (titular 200, ajeno 403, uuid inventado 403, sin
sesión 401). Además de la RPC, solo lee el catálogo `tipus_activitat` (los nombres de la actividad).

### Excedentes del diagnóstico: escritura solo del equipo (Plan 2, A3, `20270522100000`, 10-11-2026)

- **`desar_excedents_diagnostic(p_productor uuid, p_productes jsonb, p_notes text default null, p_idioma text default
  null) returns jsonb`** (security definer). Externo → `42501` **antes** de mirar si la ficha existe (también sobre la
  suya: D5); después `22023` con prefijo: `fitxa_inexistent`, `idioma_desconegut`, `productes_no_llista` (también un
  payload mal formado), `producte_repetit`, `producte_fora_principals` (solo al crear un bloque nuevo de un
  no-principal), `sense_excedent_amb_causes`, `causa_desconeguda`, `causa_repetida`, `frequencia_desconeguda`,
  `volum_negatiu` (también no numérico), `gestio_desconeguda`, `desti_desconegut`, `accio_fora_destins`,
  `accio_repetida`, `text_massa_llarg`. **Reemplaza el conjunto** del productor en una transacción (lo ausente se
  borra por cascada); excedentes por `(producte, causa)` y acciones por `(producte, causa, desti)` conservan id,
  estado, notas y `feta_*`; una acción con texto vacío deja de existir. Upsert de la cabecera de `diagnostics`
  (notas, idioma, `complet`/`falten`, `actualitzat_*`; nunca toca `respostes`/`sobre`). ⚠️ `p_notes = null` **borra**
  las notas: el formulario manda siempre el valor actual. Devuelve `{diagnostic_id, complet, falten, productes_n,
  excedents_n, accions_n}`.
- **`fixar_estat_accio(p_accio uuid, p_estat text, p_notes text default null) returns jsonb`** (definer; `es_intern()`
  → `42501`; `22023 estat_desconegut · text_massa_llarg · accio_inexistent`): `feta` pone `feta_at/per` (volver a
  marcarla conserva los originales), otro estado los limpia; `p_notes` no nulo sustituye la nota; siempre
  `actualitzat_*`. Se guarda al momento, aparte de «Desa».
- **`diagnostic_falten_productor(p)`**: `security invoker`, `grant` a `authenticated` (bajo RLS: un externo solo
  calcula lo suyo; una ficha que no ve da los tres códigos de Operativa, nunca «completa»).
  **`diagnostic_excedents_json(p)`**: definer interna, `revoke` también de `authenticated`.
- **El frontend ya no llama a `desar_diagnostic`** (P11): se conserva, sin exigir cuestionario vigente, solo para la
  ventana base → frontend (deuda 175). `publicar_questionari` sigue como estaba (super_admin), sin pantalla.
- **Arnés** (+95; ningún `permitir` pasa a `denegar`): bloques `DIAGNOSTIC_EXCEDENTS_EXTERN` (en `DOCUMENTAL_EXTERN`:
  las dos RPC con uuid nulo → denegar; insertar en las tres tablas → denegar), `DIAGNOSTIC_EXCEDENTS_EQUIP` (equip y
  super_admin: leen las tres con `requiereFixture`, no insertan ni actualizan, las RPC con uuid nulo → `errorExigit
  22023`), `DIAGNOSTIC_EXCEDENTS_SENSE_PRODUCTOR` (receptor, sin rol, pendiente: no leen nada) y el productor (lee lo
  suyo; `desar_excedents_diagnostic` sobre lo suyo y `fixar_estat_accio` sobre su acción —marcador
  `@meva_accio_diagnostic`— → denegar). Los argumentos están elegidos para que una guarda rota no borre nada
  (`p_productes: {}`, `p_estat: "no_existeix"`). Efecto colateral: los 14 checks de `questionaris_diagnostic` /
  `questionari_vigent` de las cuentas externas pasan a «sin datos» porque ya no hay cuestionario vigente (se retiran
  con la deuda 175).
- **Fixture del clon** (para que las lecturas no salgan «sin datos»): Mas de Prova, Tomàquet × EX, estacional,
  500 kg, gestión `{donacio, residu}`, destinos `{donacio, venda}` y una acción de donación «TEST arnes: …» pendiente.
  Producción no lo tiene: allí esas lecturas salen «sin datos».

### Naturalesa: `fixar_naturalesa` (Plan 2, A5, `20270523100000`, 10-11-2026)

`fixar_naturalesa(p_org uuid, p_naturalesa text) returns void`, `security definer`, `authenticated` y `service_role`:

- Permiso primero: `service_role` o `es_intern()` (todo el equipo, también el técnico: es dato de ficha, como el resto
  de «Dades de l'entitat»), o el **titular** de alguna ficha de esa organización (`soc_titular`). Si no, `42501
  nomes_equip_o_titular` (también con un uuid inventado).
- `22023 naturalesa_desconeguda` si el valor no es `entitat_social`/`empresa`; `22023 organitzacio_inexistent`.
- El titular **solo mientras no esté confirmada**: después `42501 naturalesa_confirmada` (la cambia el equipo).
- Siempre la deja `confirmada`. Nadie escribe `organizaciones` directo (sin GRANT de UPDATE; el arnés lo comprueba
  con `COLUMNA_INOCUA.organizaciones = 'naturalesa'`).
- Arnés (+61 checks): en todos los perfiles, leer sí / insertar no en `modalitat_naturalesa_compat`,
  `naturalesa_suggerida` sí, `refresca_naturalesa_suggerida` no, `organizaciones` UPDATE no; `fixar_naturalesa` denegada
  sobre un uuid nulo a los externos, permitida al titular sobre la suya (`@meva_organitzacio`) con `22023` por valor
  desconocido, y al equipo y al super_admin con `22023` (organización inexistente y valor desconocido). El efecto en el
  Mercat no se prueba en el arnés (habría que confirmar una ficha compartida): lo cubren la E2E `perfil-recepcio` y la
  prueba SQL de la sesión.
