# AGENTS.md §12bis — 12bis. Decisiones con precio conocido, y lo que espera a otro

> Detalle de la sección 12bis de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §12bis» del código apuntan aquí.

## 12bis. Decisiones con precio conocido, y lo que espera a otro

Índice de las entradas **vivas** de §12 que **no son defectos pendientes**: **45 de las 53** (aritmética del 11-10-2026: la 106, que era una decisión, se cerró con la fase 1 de la revisión del 08-10-2026; no recontado). Se quedan
donde están —con su número, que el código cita— pero conviene saber qué se está mirando antes de
intentar arreglarlas. ⚠️ Aquí solo se indexa lo **abierto**: cuando una entrada se cierra sale
también de esta tabla, y si la decisión que llevaba dentro sigue valiendo se sube a su sección
funcional (pasó el 15-09-2026 con la regla de los tipos de fila, que está en §7).

### Decisiones deliberadas: se tomaron sabiendo lo que costaban

| # | La decisión | El precio que se aceptó |
|---|---|---|
| 10 | No editar migraciones ya aplicadas | Hay `truncate` mezclado con DDL en el histórico. Editarlas está prohibido (§7) |
| 12 | No reponderar `prioritat` | 97 de 111 entidades son prioridad 1: aporta poco al ranking, y arreglarlo es trabajo de negocio |
| 24 | Replica identity por defecto | Los DELETE de Realtime se reparten sin evaluar RLS. Hoy el payload es solo un id |
| 27 | El registro no manda correo | Con el modo test activo el gate lo descartaría en silencio, por tres motivos a la vez. Está escrito en `registro/index.ts:33-38` |
| 26 | Sin captcha en el registro | Turnstile es un servicio externo y §7 lo prohíbe. Lo que frena un abuso masivo es el tope durable, no el límite por IP |
| 34 | Áreas táctiles de 36 px salvo en cuatro sitios | Subirlas todas es rediseñar la aplicación entera para ganar 8 px en botones secundarios |
| 37 | El aviso de instalación se prueba con un evento sintético | `beforeinstallprompt` no lo dispara ningún navegador de escritorio. La instalación real solo se comprueba en un móvil |
| 54 | El fail-open de `roles_activos` | Con el interruptor apagado dos checks del arnés salen en rojo. Es el fail-open de §4bis, no una regresión |
| 66 | «Amb discrepància» es un filtro, no un veredicto | El veredicto real exigiría una llamada por fila |
| 67 | Rectificar solo corrige `kg_neto` | Es lo que se rectifica en la práctica; lo demás sería un segundo editor dentro de un diálogo |
| 70 | Los kilos por línea del cierre son derivados | D13 manda certificar el neto del REC; las líneas tienen que ser por canalización. **El total del donante es exacto** |
| 76 | La filigrana no se puede comprobar con un `grep` | `pdftotext` la trocea porque va girada 45° |
| 80 | El DNI del firmante fuera de `documentos.datos` | `sha256_datos` no lo cubre; lo prueba la fila de `evidencias` |
| 81 | `sense_conveni` replica la resta, no la regla | Evita 111 llamadas por oferta. La autoridad sigue siendo la RPC |
| 91 | Las «últimas 9 cifras» están triplicadas (TS + dos migraciones) | SQL no puede importar TypeScript. Unificarlo exigiría una RPC, y entonces `coincidencies.ts` dejaría de ser probable desde Vitest. Con ~450 fichas no hay problema de rendimiento |
| 83 | `albaran_rec_id` guarda el OPE en las líneas de transacción | Renombrarlo obligaría a reescribir también el circuito de donaciones |
| 98 | `nav.entity_documents` dice «Documents», igual que el menú del equipo | Son claves distintas y `cobertura.test.ts` lo permite; el texto solo coincidiría en una cuenta con panel de equipo **y** de receptor, que hoy no existe |
| 109 | La pantalla guiada llama a las RPC reales; los atajos de `OfferDetail` se retiraron el 27-10-2026, pero los GRANT siguen | «Salen los mismos documentos» es cierto **desde cualquier pantalla**; por la API, no. Cerrarlo es revocar GRANT (la 132) |
| 110 | Una cuenta, un papel: se retiró el bloque `doble_rol` del arnés | Se pierde la cobertura de aislamiento entre dos fichas de una misma cuenta. Se recupera con una cuenta interna dedicada solo al arnés |
| 113 | Una línea del CR = una canalización, con un solo producto | El **total es exacto**; lo que se reparte mal es la atribución por producto. La alternativa rompe la clave única que comparten las tres tablas de cierre |
| 114 | Una canalización sin valorización cuenta como donación en el lado receptor | En el lado del receptor el fallo contrario es peor —negarle un kilo que recibió— y es lo que hace que `kg_donacio + kg_compra = kg_total` se cumpla siempre |
| 111 | La factura deja de condicionar el certificado; D4 se retira como camino | El control de que la factura cuadre pasa de bloqueo a aviso (`discrepancia`). Nadie impide ya emitir un certificado cuya factura no ha llegado: lo que se conserva es que el PDF **no la cite** si no cuadra |
| 21 | Sin fallback a correo dentro de `whatsapp-send`; el intake no tiene equivalente por correo | El primero es diseño (lo orquesta el llamante, que sabe qué texto tiene sentido); el segundo no puede tenerlo: no hay sesión de intake sin WhatsApp. La vía sin WhatsApp es el panel (§6ter) |
| 55 | El GRANT de columna se puede reabrir con un `grant select on all tables` masivo | Ya son 5 de 5 columnas sensibles con check dedicado en el arnés (14-09-2026). La causa de fondo —`alter default privileges` de Supabase concede SELECT a tabla nueva salvo `revoke` explícito— es de la plataforma, no del repo: la vigilancia es la única defensa posible |

### Espera material de la fase 0 o de un tercero

| # | Qué falta | De quién depende |
|---|---|---|
| 17 | Las dos whitelists de test conviven con `es_test`, y el Dashboard mide por las de Meta | **Meta**: se revisa al pasar su número a producción |
| 71 · 77 · 84 | Los textos legales de RES, CD, CT, **CR**, PLA y los seis convenios | **La asesoría** |
| 85 | Prueba end-to-end del CT | 🟡 **Ya no está bloqueada**: desde `20260921214526` el CT se emite en modo prueba (`P-CT`). Queda ejercitarlo, que es trabajo, no espera |

### Son interruptores de producción, no código

| # | Qué |
|---|---|
| 4 | `disponible_hasta` cuando el texto no es fechable: lo normaliza el panel |
| 30 | `VITE_ACCESSOS_TEST` — apagarlo es decisión de negocio |
| 92 | El «Mostra interès» del correo va al panel con sesión; el enlace con token sin cuenta es fase 2 |
| 93 | `whatsappActivo()` sin caché: es lo que hace que apagar el interruptor sea inmediato |
| 95 | Tres copias del token: editar una migración aplicada está prohibido |
| 97 | Acuñar desde el panel revoca el enlace del correo, y por eso no se prueba en positivo |
| 72 | `abrir_cierre` no se prueba como «permitir» porque dejaría una cabecera sin forma de borrarla |

### Requieren una decisión de negocio (no de código, ni de un tercero externo)

| # | Qué decisión falta | Por qué no se toma sola |
|---|---|---|
| 69 | Si se hace un backfill de `data_hora_recollida` en las donaciones antiguas (solo ENT/OPE la escriben hoy, el REC no) | Un backfill cambiaría el ejercicio fiscal de datos que ya pueden estar certificados. Se dijo explícitamente que no se toca sin el equipo/la Fundación delante — no es una tarea de ingeniería, es una decisión sobre datos fiscales reales |
| 131 | Si el receptor puede ver quién ofrece antes de aprobar (D3) | Cerrar las columnas de `excedentes` cambia lo que ve el receptor y el equipo; la revisión del 23-09 pide justo lo contrario que el criterio original. La propuesta técnica está en la entrada, pero no se aplica sin esa decisión |
| 132 | Si el rol `tecnic` conserva escritura directa sobre `canalizaciones` y `excedentes` | Restringirla cambia lo que puede hacer el rol técnico en el día a día del equipo; es política de la Fundación, no solo ingeniería (misma raíz que la 109) |
| 133 · 134 | Qué frenos añadir a `recuperar-password` y `registro`, y si el alta debe verificar la titularidad del correo | Cada freno es comportamiento nuevo para personas reales (límites, esperas, verificación) y Turnstile está descartado por §7 |
| 141 | Si un receptor que no registra la recogida debe quedar bloqueado para pedir ofertas nuevas | ✅ Decidido el 17-10-2026: **de momento, sin freno**. Se revisa si en la práctica hay recogidas que nadie registra |
| 137 | Si se cambian los privilegios por defecto de funciones de `public` | Afecta a cómo se escriben todas las migraciones futuras; el arnés ya vigila el síntoma |

