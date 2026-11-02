# AGENTS.md §1 — 1. Proyecto

> Detalle de la sección 1 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §1» del código apuntan aquí.

## 1. Proyecto

**PDApp / Redestina** — plataforma de canalización de excedentes agrícolas de Espigoladors, con
WhatsApp Cloud API como canal. Un productor ofrece un excedente por WhatsApp, el sistema lo
convierte en una **oferta** con identificador propio, prioriza **entidades sociales**
receptoras y registra las **canalizaciones** hasta el cierre con kg reales y albaranes.

Dos fases:

| Fase | Qué es | Estado |
| --- | --- | --- |
| **1. Infraestructura WhatsApp** | Consola de mensajería: webhook con firma, envío texto/plantilla, opt-in, Realtime | ✅ construida y endurecida |
| **2. Redestina** | Intake conversacional, excedentes/canalizaciones, priorización, cierre | ✅ construida (prompts 0bis–8). Quedan checkpoints de negocio, no de código (§12) |

Actualmente en **entorno de pruebas** de Meta con **`WHATSAPP_ENVIO_REAL` activado**
(2026-07-22): los envíos salen de verdad, pero Meta en test **solo entrega a los ≤5 números
verificados** en su panel (reflejados en `meta_test_recipients`, §4); a cualquier otro número
Meta rechaza con `131030`. La protección real la da, pues, el propio entorno de test de Meta
más la whitelist `meta_test_recipients`. Ver §8.

**Mensajería siempre individual**, nunca a grupos: la Cloud API no escribe en grupos. Para
publicar en un grupo se ofrece "copiar texto" y se pega a mano.

La especificación completa está en `docs/nuevas-funcionalidades/` (fuera de git):
`redestina-automatizacion-canalizacion-whatsapp-final.md` (**v4**, 10-09-2026) manda en el proceso de
canalización y trae los prompts 0–8 (incluidos 6bis mapa y 7bis exportación a Excel);
`manual-whatsapp-cloud-api-supabase-final.md` manda en la configuración de Meta y las decisiones
D1–D7; `guia-tecnica-claude-code-whatsapp-final.md` es el mapa de ejecución. El **funcional de
negocio** (visión objetivo del servicio, más amplia que lo construido) vive en `docs/Documento
funcional Redestina 2026.md` (**v3**, septiembre 2026, con el feedback de la Fundación: vocabulario
**AFCV** —alimentos fuera del circuito de venta habitual— en lugar de «excedente», necesidades de los
receptores, un registro repartido en varias operaciones con valorización propia, formulario mínimo
con campos dinámicos, coste por kilo en donaciones, mapa en el match, exportación a Excel y catálogos
maestros) y su **versión adaptada al estado real** en `docs/Documento funcional Redestina 2026 —
adaptado.md` (ambos fuera de git; copia vigente del funcional en `0. Documentación vigente/` de la carpeta del proyecto
de consultoría); su resumen y la correspondencia objetivo↔construido están en **§1bis**. En el código
la tabla sigue siendo `excedentes` y los textos dicen «excedent»: el rename de vocabulario es brecha
pendiente (ver el adaptado, §0).

`docs/` guarda además siete documentos operativos (también fuera de git): **`Guía producción
WhatsApp — Redestina.md`** (los pasos en Meta del checkpoint §12.2 —número de producción, verificación,
pago, plantillas— con el estado de preparación verificado el 24-07-2026, y su versión visual
`WhatsApp producción (visual).html`), **`Costes de WhatsApp — Redestina.md`** (modelo de costes: la
ventana de 24 h es gratis, la plantilla se paga), **`Flujo de la aplicación Redestina.md`** (el flujo
end-to-end con diagramas Mermaid y los textos literales que se envían), **`Guía de prueba — ciclo
completo asistido.md`** (21-09-2026: el recorrido paso a paso del ciclo entero desde `/equip/canalitzacio`
—qué cuenta, qué botón, qué comprobar en pantalla y en el correo— y la tabla que contrasta el camino
propio con el asistido, que es lo que demuestra que producen el mismo documento; §6ter),
**`Usuarios y accesos —
Redestina.md`** (las 3 cuentas reales del equipo con su rol y las **12 de prueba con su contraseña**, más
cómo reenviar un acceso, cortar uno y recrear las cuentas) y **`usuarios-test.md`** (la tabla escueta
de esas 12 cuentas, para tenerla a mano al probar). Los dos últimos **llevan credenciales en claro**:
que estén fuera de git no es un detalle, es el motivo de que existan ahí.
⚠️ La guía de prueba **no las repite**: cita las cuentas por su correo y manda a `usuarios-test.md`
para la contraseña, que es lo que permite enseñarla sin repartir credenciales.

**Dos documentos vigentes no tienen copia en `docs/` y viven solo en `0. Documentación vigente/` de la carpeta del
proyecto de consultoría** (§ abajo), así que no se encuentran buscando en el repo: **`Definición de
producto REDESTINA v3.md`** (en `1. Producto y funcional/`), la capa estratégica que enmarca al resto —principios, cinco líneas,
propuesta de valor por actor, Lean Canvas, recorridos por rol, alcance del MVP y trazabilidad con la
subvención ARC (expediente TER/4617/2024)—, y **`Flujo de usuarios REDESTINA v4.md`** (en `2. Flujos/`), los recorridos
objetivo por rol paso a paso. Jerarquía cuando se solapan: la Definición de Producto manda en **el
porqué y el para quién**, el funcional en **el qué**, y la automatización y la guía técnica en **el
cómo sobre este repo**.

⚠️ Y en `3. Claude Code/2026-09-10-plan-sistema-documental.md` está el plan del **circuito documental**
—cimientos, convenios con firma por enlace, albaranes desde la base, cierre anual y certificados de
donación—, con quince decisiones abiertas (D1–D15) y una **fecha dura**: para certificar el ejercicio
2026 desde Redestina tendría que estar en producción antes del **1 de diciembre de 2026** (D1, cuya
recomendación es no hacerlo y estrenar con 2027). Es la obra grande que viene después de las brechas
de §1bis, y hoy el repo no tiene nada de ella. Su **plan de ejecución sobre este repo** —spike, fases con
migraciones, funciones, pantallas, arnés y aceptación, y el modelo de trabajo con los tres agentes de
`.claude/agents/`— está en `3. Claude Code/2026-09-10-plan-ejecucion-sistema-documental.md` (aprobado
el 10-09-2026; el código arranca con el spike del 21/09).

⚠️ Y en `3. Claude Code/2026-09-22-plan-organizacion-unificada.md` está el plan de la otra brecha
mayor todavía viva, la **organización unificada multirol** de §1bis: siete de sus ocho sub-deudas
originales (11, 20, 22, 27, 28, 31, 79) ya están cerradas y la octava (16) también, así que lo que
queda no es una lista de bugs sino una decisión de modelo de datos —`usuario`/`rol_organizacion`
propios, una organización con campos suyos, deduplicación que no dependa de correo/teléfono
exactos—. Análisis del estado real por consumidor y fases propuestas, sin código todavía.

La **documentación generada para la consultoría** (informes, análisis, propuestas) no va a `docs/`
sino a la carpeta del proyecto, fuera del repo: `/Users/carlessanz/Library/CloudStorage/GoogleDrive-hola@carlessanz.com/Mi unidad/02-Proyectos/04-Espigoladors/03-Redestina/3. Claude Code/`
(acceso por `additionalDirectories` en `.claude/settings.local.json`; reglas en `CLAUDE.md`,
sección «Carpeta del proyecto de consultoría»). Nada con credenciales ni datos personales sale de `docs/`.



### Plan 1 — CRM y registro de entidades: decisiones (02-11-2026)

Plan en `3. Claude Code/2026-11-02-plan-1-crm-entitats.md`. Decisiones de §1 (cerradas) y propuestas
por defecto de §8 que se aplican, con la rebanada donde toman cuerpo:

- **D1** una sola «Entitat» en la interfaz; las dos tablas se quedan. **D2** lo importado nace inactivo
  y activar exige NIF (1A pone la regla; 1F, el import). **D3** un contacto por ficha: se retira
  «Persones de contacte» (1A). **D4** CRM mínimo. **D5** sin acceso por defecto. **D6** búsqueda por
  NIF y por nombre (`cerca_entitats`, 1A). **D7** activo por papel; la organización, si lo está alguno
  (1A). **D8** `campsFitxa.ts` como lista única de campos (1C).
- **P1** unificar los flujos de alta · **P2** RPC si hay doble papel · **P3** consentimiento RGPD en el
  primer acceso · **P4** sin correo de bienvenida · **P5** la persona ve y edita sus campos extra ·
  **P6** no se borra `organizacion_contactos` (1A la deja sin uso; deuda 146) · **P7** exportación para
  Airtable · **P8** «1 convenio» va al plan 3 · **P9** activar exige solo NIF válido y razón social
  (1A, trigger) · **P10** el listado muestra solo las activas por defecto (1C; `cerca_entitats` ya
  admite `p_nomes_actives`).
- **1A publicada el 02-11-2026 (`3ec6dba`)**: migración `20270501100000` aplicada con
  `aplicar-migracion.ts`, `priorizar-entidades` redesplegada y frontend por el push.
- **1C publicada el 02-11-2026 (`a07dd6a`)**: migración `20270501200000` aplicada con
  `aplicar-migracion.ts` (`scripts/data/publicar-1c.sh`), ninguna función, frontend por el push
  (`version.json` = `a07dd6a8cd5c`). Arnés en producción 1.634/1.634 y 23 sin datos.
- **1B publicada el 02-11-2026 (`c67e12f`)**: «Nova entitat» en dos pasos y `crear_entitat()`
  (migración `20270501300000`). Decisiones aplicadas: **D6** (el buscador es el paso 1); **P2
  ampliada** (toda alta del panel por la RPC, con uno o dos papeles: un solo camino); **la entidad
  nace activa**, así que el alta exige NIF válido y razón social (coherente con D2/P9) y, si es
  receptor, `tipo_receptor`; el alta la puede hacer el técnico (como antes), activar y añadir papel
  siguen siendo de `pot_aprovar()`; **P1** a medias por diseño (§7 del plan: «Nova organització amb
  compte» se queda hasta 1D, y la casilla «Dona-li accés» no se enseña hasta entonces). Publicado:
  la migración `20270501300000` (aplicada con `aplicar-migracion.ts`; la función existe, solo
  `authenticated` la ejecuta, `auditoria_funcions_obertes()` en 0) y el frontend (`version.json` =
  `c67e12f05fe3`); ninguna Edge Function. Arnés en producción 1.643/1.643 y 23 sin datos. Detalle en
  §4bis y §6ter.
- **Deuda 150 cerrada tras publicar 1B (02-11-2026, `20270501400000`)**: fuera las políticas `alta intern`
  y el GRANT de INSERT de `productores`/`entidades`; el alta solo nace por `crear_entitat()` (o con
  `service_role`). Solo base de datos: ni funciones ni frontend. Aplicada en producción (sin políticas
  INSERT ni GRANT de INSERT; UPDATE intacto); arnés en producción 1.647/1.647 y 23 sin datos.
