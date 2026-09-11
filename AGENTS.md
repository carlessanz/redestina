# AGENTS.md

Documento canónico de contexto para agentes de IA (Claude Code, Codex, Cursor…) que
trabajan en este repositorio. `CLAUDE.md` lo importa; **no dupliques contenido allí.**

> **Regla permanente:** toda modificación que cambie la arquitectura, el esquema de datos,
> los contratos de las Edge Functions, las convenciones o los comandos **debe actualizar
> este fichero en el mismo cambio.** Si el código y este documento discrepan, el documento
> está roto.

---

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
adaptado.md` (ambos fuera de git; copia vigente del funcional en la raíz de la carpeta del proyecto
de consultoría); su resumen y la correspondencia objetivo↔construido están en **§1bis**. En el código
la tabla sigue siendo `excedentes` y los textos dicen «excedent»: el rename de vocabulario es brecha
pendiente (ver el adaptado, §0).

`docs/` guarda además seis documentos operativos (también fuera de git): **`Guía producción
WhatsApp — Redestina.md`** (los pasos en Meta del checkpoint §12.2 —número de producción, verificación,
pago, plantillas— con el estado de preparación verificado el 24-07-2026, y su versión visual
`WhatsApp producción (visual).html`), **`Costes de WhatsApp — Redestina.md`** (modelo de costes: la
ventana de 24 h es gratis, la plantilla se paga), **`Flujo de la aplicación Redestina.md`** (el flujo
end-to-end con diagramas Mermaid y los textos literales que se envían), **`Usuarios y accesos —
Redestina.md`** (las 3 cuentas reales del equipo con su rol y las **12 de prueba con su contraseña**, más
cómo reenviar un acceso, cortar uno y recrear las cuentas) y **`usuarios-test.md`** (la tabla escueta
de esas 12 cuentas, para tenerla a mano al probar). Los dos últimos **llevan credenciales en claro**:
que estén fuera de git no es un detalle, es el motivo de que existan ahí.

**Dos documentos vigentes no tienen copia en `docs/` y viven solo en la raíz de la carpeta del
proyecto de consultoría** (§ abajo), así que no se encuentran buscando en el repo: **`Definición de
Producto REDESTINA 2026.md`**, la capa estratégica que enmarca al resto —principios, cinco líneas,
propuesta de valor por actor, Lean Canvas, recorridos por rol, alcance del MVP y trazabilidad con la
subvención ARC (expediente TER/4617/2024)—, y **`Flujo de usuarios REDESTINA.md`**, los recorridos
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

La **documentación generada para la consultoría** (informes, análisis, propuestas) no va a `docs/`
sino a la carpeta del proyecto, fuera del repo: `/Users/carlessanz/Documents/Claude/Projects/Redestina/3. Claude Code/`
(acceso por `additionalDirectories` en `.claude/settings.local.json`; reglas en `CLAUDE.md`,
sección «Carpeta del proyecto de consultoría»). Nada con credenciales ni datos personales sale de `docs/`.

## 1bis. Visión funcional Redestina 2026 (modelo objetivo ↔ lo construido)

Resumen del **funcional de negocio** (el *to-be*, `docs/Documento funcional Redestina 2026.md`) y su
reconciliación con lo que hay en el repo (el *as-is*, que describe el **resto** de este documento). El
detalle vive en `docs/Documento funcional Redestina 2026 — adaptado.md` (fuera de git). **Regla:** cuando
cambie el alcance funcional o el estado de implementación, mantener al día esta §1bis y su tabla.

**Qué es Redestina.** Un **servicio** de la Fundació Espigoladors apoyado por tecnología (un dinamizador de
referencia + red de actores + plataforma como **ERP del servicio**, fuente única sin duplicidades). En
la fase inicial la operativa es **asistida**: el equipo opera en nombre de las organizaciones. Ocho
principios: servicio apoyado por tecnología; modelo asistido; ERP fuente única; pagos fuera / valor
dentro; Espigoladors es parte del intercambio (receptora y donante en donaciones); **multirol real**;
trazabilidad e indicadores; preparado para evolucionar.

**Cinco líneas de servicio:** (1) canalización social/donación —core—, (2) salida comercial, (3)
transformación por maquila, (4) espigueo, (5) diagnóstico y prevención.

**Actores/roles (multirol):** generador, receptor social, receptor comercial, obrador, Fundació
Espigoladors (operador legal del intercambio) y equipo interno (dinamizador, técnico, Super Admin).

**Flujo core E2E:** registrar (usuario o asistido) → back office **confirma** → publicar → **match
asistido** (propone el sistema, decide el dinamizador) → coordinar recogida → borradores documentales
→ **conciliación** (previsto/documento/recepción real) → documentación definitiva y **certificados**.

**Estados objetivo:** excedente NUEVO→PENDIENTE→DISPONIBLE→EN GESTIÓN→CERRADO (cierre por destino);
demanda; organización (alta→convenio→verificada; y diagnóstico); match
(propuesto→validado→coordinado→conciliado); albarán (borrador→emitido→entregado→conciliado).

**Albaranes y conciliación:** un albarán por entrega física; en donaciones **doble tramo**
(donante→Espigoladors y Espigoladors→entidad); numeración de serie sin huecos (ALB/ALR); kilos
oficiales solo desde operaciones **conciliadas**; **ningún certificado antes de conciliar**. Certificado
de **donación** (al donante, lo emite Espigoladors) y de **transacción** (al generador).

**Comunicación (§14 del funcional):** módulo WhatsApp (Cloud API) + email por preferencia de canal,
notificaciones automáticas, captura estructurada y encuestas. **Lo construido (Fase 1) implementa y
excede** esta visión en la captura conversacional (ver §5, §6bis, §8): intake, opt-in, gates,
recordatorios. Pendiente: tabla de notificaciones con *fallback* de canal, adjuntos descargados,
encuestas.

**Diagnóstico y planes de prevención:** servicio técnico (plan básico/personalizado) con plan
**activo** alimentado por el histórico. ⬜ No construido.

**Modelo de datos objetivo:** base única compartida (Redestina + back office + CRM); `organizacion`
(multirol) y `usuario` como cosas distintas; Espigoladors dentro del modelo; `historial_estado` para
trazabilidad total; JSON flexible y catálogos parametrizables. Entidades: organizacion, usuario,
rol_organizacion, convenio, excedente, demanda, interes, sugerencia_match, operacion, entrega,
albaran(+linea), documento_externo, documento/certificados, conversacion/mensaje/adjunto,
plantilla_mensaje, notificacion, encuesta_satisfaccion, diagnostico/plan/plan_revision,
derivacion_espigueo, historial_estado, webhook_log y catálogos.

**Indicadores comprometidos (medir desde dentro):** +40 % de organizaciones en 24 meses (base 14),
≥50 t/año intercambiadas, −5/−10 % de pérdidas, ≥5 funcionalidades nuevas, satisfacción 60–80 %.

**Correspondencia objetivo↔construido** (✅ construido · 🟡 parcial · ⬜ pendiente):

| Objetivo (funcional) | Hoy (repo) | Estado |
| --- | --- | --- |
| `organizacion` multirol única | `productores` + `entidades` (2 tablas, sin multirol; doble rol por teléfono + prioridad del webhook) | 🟡 |
| `usuario` de organización | `perfiles` + `membresias` (vincula la cuenta con su ficha; §4bis) | ✅ |
| `rol_organizacion` | `membresias.rol_org` (titular/operador) + `usuario_roles` de plataforma | 🟡 |
| `convenio` de colaboración | `convenios` + `convenios_exigidos`, con firma por enlace, contrafirma y campaña (§4) | ✅ |
| `excedente` | `excedentes` | ✅ |
| `demanda` | — | ⬜ |
| `interes` (solicitud de receptor) | `oferta_respuestas` (aceptación con kg/preu + aprobación del superadmin → canalización) | 🟡 |
| `sugerencia_match` persistida | `priorizar-entidades` (Edge Function pura, no persiste) | 🟡 |
| `operacion`/`entrega` (lotes; kg prev/recib/valid) | `canalizaciones` + `albaran_lineas` con previstos/entregados/confirmados/validados y conciliación con tolerancia | ✅ |
| `albaran`/`albaran_linea` (serie, estados, QR) | `albaranes` + `albaran_lineas`: REC/ENT/OPE con series sin huecos, estados, conciliación y PDF (§4) | ✅ |
| `documento_externo` | `documentos_externos` (albarán del productor, factura, fotos) | ✅ |
| `documento` / **certificados** | `documentos` + `plantillas_documento` + `series_documentales`; certificados de donación y de transacción (§4) | ✅ |
| `conversacion`/`mensaje`/`adjunto` | `wa_contacts`/`wa_messages` (sin adjuntos) | 🟡 |
| `plantilla_mensaje` (tabla) | plantillas en código (`plantillas-meta.md`, `plantillas.ts`) | 🟡 |
| `notificacion` (+ *fallback* de canal) | — (envíos directos) | ⬜ |
| `encuesta_satisfaccion` | — | ⬜ |
| `diagnostico`/`plan_prevencion`/`plan_revision` | `planes_prevencion` con su PDF. **Falta el cuestionario** (anexo B, fase 0) | 🟡 |
| `derivacion_espigueo` | `espigoladas` con alta manual y reparto en lotes | 🟡 |
| `historial_estado` | — | ⬜ |
| `webhook_log` | `wa_messages.raw` (jsonb) | 🟡 |
| catálogos (categorías/unidades/motivos/destinos) | `productos`/`causas`/`factores_conversion` | 🟡 |
| back office, cola de **aprobaciones**, Super Admin | `Aprovacions` con **dos colas**: respuestas a ofertas y **registros pendientes**; aprobar exige `pot_aprovar()` | 🟡 |
| **alta de organización** (onboarding) | **registro público self-service** (`/registre` → Edge Function `registro`) con validación del equipo (§9) | 🟡 |
| **roles y permisos** | RLS por rol y organización, encendida en producción (§4bis) | ✅ |
| parte pública / catálogo público | **landing pública** en `/` + `/login`, `/admin` y `/registre` (§6quater). Catálogo público de ofertas, no | 🟡 |
| **modelo asistido** | de facto: el equipo opera todo desde el panel | 🟡 |
| multiidioma `ca`/`es` | i18n propio (`src/lib/i18n.tsx`) | ✅ |
| móvil primero / responsive | responsive `md`, mensajería lista↔conversación | ✅ |
| módulo de comunicación WhatsApp | Fase 1 + intake/opt-in/gates/recordatorios | ✅/excede |
| valor económico | `costes_producto` por producto y ejercicio, congelado en la canalización al conciliar; sin coste no hay cierre | ✅ |
| vistas/indicadores (`v_kpi_subvencion`…) | `Dashboard` agrega en cliente | 🟡 |

**Brechas mayores pendientes** (orden aproximado de dependencia): ~~(1) roles y permisos~~
**resuelta** (§4bis) → **(2) organización unificada multirol + `usuario`** — 🟡 **en curso**:
la identidad existe y cada ficha cuelga de la suya (`organizaciones` + `v_organizaciones`, §4), con
el trigger que garantiza que las nuevas también (`20270313100000`); los **convenios** ya son de la
organización y no de la ficha (§12.79), y una cuenta tiene **una ficha de cada tipo** (§12.31).
Faltan los consumidores de WhatsApp y del registro (§12.16, §12.28) → ~~(3) back office~~ y
~~(4) onboarding~~ **resueltas** (cola de aprobaciones con tres colas, alta self-service y convenio
en el registro) → (5) demandas → ~~(6) albaranes/conciliación real y certificados~~ **resueltos**
(fases 3, 4 y 5 del sistema documental: §4) → (7) notificaciones + encuestas → (8) adjuntos de
WhatsApp → ~~(9) diagnóstico/planes~~ 🟡 (la estructura está; **falta el cuestionario**, anexo B) →
(10) 🟡 espigueo con alta manual; faltan catálogo público, calendario y mapa → (11) vistas SQL +
`historial_estado`.

⚠️ **Lo que bloquea ahora no es código, es material de la fase 0**: los textos legales validados por
la asesoría (los ocho tipos de documento y los tres convenios), los datos fiscales reales de
Espigoladors con la firma y el sello de la apoderada, las taras por tipo de caja, los costes por kilo
del ejercicio y el cuestionario de diagnóstico. Todo el circuito funciona con valores provisionales
**marcados como tales**, y el certificado se niega a emitirse mientras lo sean. La más urgente ahora sigue siendo la **organización unificada multirol**, ya con
su etapa 1 hecha: la clave común existe (`organizaciones`, §4), y lo que falta es que los
consumidores la usen — empezando por el registro público, que es quien no podía detectar que una
organización ya existe (deuda §12.28).

## 2. Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | Vite 7 + React 19 + TypeScript 5.9 (`strict`) + **Tailwind v4 + shadcn/ui** + **react-router v7** |
| Datos / Realtime | Supabase (`@supabase/supabase-js` v2) |
| Backend | Edge Functions de Supabase (Deno / TypeScript) |
| Email | **Resend** (API HTTP, vía Edge Function `enviar-email`) |
| BD | Postgres (Supabase) con RLS |
| Scripts | Deno 2.x (`scripts/import-ara.ts`) |
| Hosting frontend | Vercel (proyecto `redestina`) |

**Con router** (`react-router` v7, desde 2026-07-30: los paneles por rol necesitan URL propia,
enlace profundo y gesto «atrás»; el `useState<View>` anterior no daba ninguna de las tres) y sin
librería de estado. Desde el 31-07-2026 el router es además la **capa raíz**, con rutas públicas y
privadas (§6quater): ya no hay un `AuthGate` envolviéndolo todo. `vercel.json` añade el *rewrite* de SPA: sin él, recargar cualquier ruta que no
sea `/` devuelve 404 en producción. **UI con Tailwind v4 + shadcn/ui**: componentes en
`src/components/ui/` (generados con el CLI de shadcn, `components.json`), tokens del **sistema de
diseño REDESTINA** en `src/index.css` (verde `#4e6b45` / coral `#ef7d77` / crema `#f5f1ea`, Sora para
títulos e Inter para el cuerpo; la fuente de verdad es `design/tokens.json`, §2bis), alias `@/` →
`src/`. Iconos `lucide-react`, toasts `sonner`, `cn()` en `src/lib/utils.ts`. El logo en sus seis
variantes, el favicon y los iconos están en `public/` (§2bis).

⚠️ **La barra inferior de móvil admite CUATRO entradas, no cinco, y va al límite.** Reparte el
ancho a partes iguales con `flex-1`, así que a 360 px cada celda da ~90 px y las etiquetas de este
proyecto piden 66-112 px —son largas a propósito: `nav.ts` las elige únicas entre paneles para que
los tooltips del menú plegado no se repitan (§2bis, `text-nav`)—. Medido: con cuatro entradas la
barra pide **exactamente 360 px** en los dos paneles; con cinco pedía **393** y desbordaba. Y
`truncate` **no** lo arregla: el `li` es `flex-1` y un flex item con `min-width: auto` no encoge por
debajo de su contenido, así que el `nowrap` convierte el salto de línea en desbordamiento.
Consecuencias: una entrada que no quepa se marca **`barra: false`** en `NavItem` y se queda solo en
el menú lateral (hoy, «Nova oferta» en productor —ya es `primari` y cabe dentro de Inici— e
«Històric» en receptor); y **cualquier etiqueta nueva o traducción más larga rompe la barra**, así
que al añadir una hay que medirla, no estimarla.

**Layout** (desde 2026-07-30): **menú lateral vertical plegable** (`sidebar` de shadcn: 16rem ↔ 3rem
en modo icono, estado en cookie, atajo Ctrl/Cmd+B) + barra superior de 14 con el título de la
sección y el menú de la persona (idioma y salir). En móvil el menú se abre como panel deslizante y,
**solo en los paneles de productor y receptor**, hay además **barra inferior** con sus 3-4 secciones
(el equipo tiene siete, no caben). La barra inferior es hermana flex `shrink-0`, no `fixed`: así
ninguna pantalla necesita padding inferior y el composer del chat nunca queda debajo.

⚠️ **Contrato de alturas**: el shell es una columna flex `h-dvh overflow-hidden`; `main` es
`min-h-0 flex-1` y scrollea él, salvo en las rutas marcadas `fullBleed` (Mensajería), que gestionan
su propio alto. **Ninguna pantalla vuelve a escribir `h-dvh`.** Hay un tercer flag de layout en el
`RouteHandle`, **`ample`** (no confundir con `fullBleed`): cambia el contenedor de `main` de
`max-w-6xl px-4` a `w-[96%] px-2` y lo llevan los tres listados del equipo (`productors`, `entitats`,
`ofertes`), que necesitan más ancho.

**PWA instalable** (`vite-plugin-pwa`, `generateSW`): manifest, iconos 192/512 + *maskable*
(generados desde `public/isotipo-redestina.svg`, la hoja sola; §2bis), `apple-touch-icon` y los metas de iOS —que no lee el
manifest—, `viewport-fit=cover` para que `env(safe-area-inset-*)` valga algo en iPhone.
`registerType: 'autoUpdate'` + `cleanupOutdatedCaches` + `Cache-Control: must-revalidate` en
`/index.html` y `/sw.js` (`vercel.json`): un service worker mal desplegado se queda pegado en los
dispositivos, y esto hace que una recarga baste para coger la versión nueva. ⚠️ **Nada de Supabase
se cachea** (`NetworkOnly` para `*.supabase.co`, y `/functions/`, `/rest/` y `/auth/` fuera del
`navigateFallback`): los datos siguen siendo 100 % autenticados y personales —lo público (§6quater)
es solo el shell estático—, y cachear una respuesta de
PostgREST en un móvil compartido podría servírsela a la siguiente persona. Para retirar el service
worker de los dispositivos, desplegar una vez con `selfDestroying: true`.

**Aviso de instalación** (2026-08-01, `src/hooks/useInstalacio.ts` + `src/components/AvisInstallacio.tsx`).
La aplicación era instalable desde el principio, pero la opción vivía en un menú del navegador que
nadie abre. Ahora se ofrece **solo a productores y receptores en móvil** (`rolActiu !== 'intern'` +
`md:hidden`); el equipo trabaja desde el escritorio. **Dos caminos que no son intercambiables**:
Android/Chrome dispara `beforeinstallprompt` y se puede abrir el diálogo real del sistema; **iOS no lo
dispara y no lo hará**, así que ahí se explican los dos pasos de Compartir → «Afegir a pantalla
d'inici» — sin esa rama ningún iPhone vería nunca el aviso. ⚠️ El evento es **de un solo uso y llega
antes del primer render**, por eso lo captura `escoltaInstalacio()` desde `main.tsx` **antes de montar
React** y lo guarda en estado de módulo; escucharlo dentro de un componente llega tarde y el aviso no
saldría nunca. El banner es **hermano flex `shrink-0`, no `fixed`** —mismo contrato de alturas que la
barra inferior—, así que resta alto al `main` y no tapa nada. Quien lo descarta no lo vuelve a ver en
**30 días**: `redestina-install-descartat` guarda la **fecha**, no un booleano, porque un booleano no sabe
expresar eso.

**Responsive** (breakpoint `md`, 768px). Los **listados** van
en tabla con `overflow-x-auto` (scroll horizontal en móvil); los **detalles/CRUD** usan grids
`sm:grid-cols-2`. La **mensajería** usa patrón **lista↔conversación**: en móvil la lista ocupa toda
la pantalla y, al elegir un contacto, la conversación pasa a pantalla completa con botón «atrás»
(`Conversation` recibe `onBack`); en escritorio conviven las dos columnas. La mensajería **ya no
escribe `h-dvh` propio** (era texto residual de la arquitectura anterior, contradecía el contrato de
alturas de arriba): su alto lo aporta el shell porque su ruta va marcada `fullBleed` (§6ter).

**Tres reglas de móvil que se comprobaron midiendo, no leyendo** (2026-08-01; auditoría con
Playwright a 320/360/390 px sobre las 11 rutas, públicas y privadas — **0 px de desbordamiento
horizontal en todas**, que es la referencia a mantener):

1. ⚠️ **Ningún control de formulario por debajo de 16 px en móvil.** iOS Safari amplía la página al
   enfocar un campo con `font-size < 16px` y, como el viewport renuncia a `maximum-scale` a propósito
   (accesibilidad), **no deshace el zoom al salir**. `Input`/`Textarea` de shadcn ya traen
   `text-base md:text-sm`; los `<select>` nativos de `NovaOferta` no, y tocar el primer desplegable
   dejaba los 13 campos restantes ampliados y desplazándose en horizontal. **Cualquier control
   estilado a mano tiene que repetir ese `text-base md:text-sm`.**
2. **`whitespace-nowrap` viene de serie en `Button`.** Una etiqueta larga dentro de un botón fija un
   ancho mínimo que se **propaga hacia arriba por los grids** y termina desplazando la página entera
   (pasó en `/login`: 47 px a 320 px de ancho). Si el texto de un botón puede crecer, `whitespace-normal`.
3. **`env(safe-area-inset-left/right)` importa en horizontal.** `viewport-fit=cover` lleva el
   contenido hasta el borde físico; sin el `env()` lateral, en iPhone con muesca el contenido queda
   bajo el recorte. Se aplica con `max(padding, env(...))` en `AppShell` y `LayoutAcces`; la barra
   inferior ya cubría el `bottom`.

## 2bis. Sistema de diseño (10-09-2026)

La imagen de REDESTINA (branding de agosto de 2026: `BRANDING_REDESTINA_FINAL.ai`) está implantada
como **sistema de diseño que el código consume**. Tres piezas, en `design/`:

| Fichero | Qué es | Manda en |
|---|---|---|
| `design/tokens.json` | **Fuente única** de colores (marca, neutros cálidos, estados, gráficos, mapa a shadcn, extensión), tipografías y jerarquía, espaciado, radios, sombras, puntos de corte y reglas del logo. Cada valor lleva `origen: branding` (del diseñador) o `derivado` (definido por la consultoría). | Los valores. |
| `design/DESIGN.md` | Reglas que un token no captura: cuándo se usa cada variante del logo y su zona de respeto, jerarquía tipográfica, tono de los mensajes y patrones de componentes (botón, tarjeta, badge, tabla, formulario, vacío, alertas, sidebar, barra móvil, diálogo, portada). | El uso. |
| `design/preview.html` | Página autónoma con todos los componentes pintados con los tokens. Se abre en el navegador; no forma parte del build. Sirve para validar antes de tocar la aplicación. | La muestra. |

`design/PLAN.md` es el plan con el que se implantó; queda como histórico.

**Reglas para el código:**

- **Todo estilo sale de los tokens.** No se escribe ningún hex, ningún `text-[13px]`, ningún color
  de la paleta genérica de Tailwind (`bg-green-100`, `text-red-700`, `bg-blue-*`…). Se usan las
  clases que salen de `src/index.css`: las de shadcn (`bg-primary`, `text-muted-foreground`,
  `border-input`, `bg-sidebar-accent`…) y las de la **extensión REDESTINA**: `coral`,
  `coral-foreground`, `coral-oscuro`, `coral-suave`, `coral-texto`, `verde-claro`, `verde-oscuro`,
  `exito` / `exito-fondo`, `aviso` / `aviso-fondo`, `error` / `error-fondo`, `chart-1…5`, y la fuente
  `font-titulos` (Sora). Los estados se pintan con `bg-exito-fondo text-exito`,
  `bg-aviso-fondo text-aviso`, `bg-error-fondo text-error`; lo neutro-informativo con
  `bg-secondary text-secondary-foreground`.
- **`text-nav` (0.6875rem / 11 px) es el único tamaño por debajo de `xs`**, y existe para una sola
  cosa: las etiquetas de la barra inferior de móvil. Son largas a propósito —`nav.ts` las eligió
  únicas entre paneles para que los tooltips del menú plegado no se repitan—, así que a `xs`
  (0.75rem) rompen a dos líneas en una celda de ~85 px y desalinean las pestañas. Antes era un
  `text-[11px]` a pelo, que contradecía la regla de arriba; el valor es el mismo, pero ahora sale
  de `tipografia.escala.nav` en `design/tokens.json`. No usarlo en texto que haya que leer.
- **`accent` de shadcn NO es el coral.** Es la superficie de hover de menús, selects y botones
  ghost (crema oscurecido). El coral es acento de marca y vive en `coral`; solo da 2.67:1 sobre
  blanco: nunca texto pequeño en coral ni texto blanco sobre coral (encima va negro,
  `coral-foreground`; para texto coral, `coral-texto`).
- **El error es rojo (`error` / `destructive`), no coral.** El coral no significa fallo.
- **Los títulos van en Sora solos**: `@layer base` pone `font-titulos` en `h1`–`h4`. No hace falta
  pedirlo en cada pantalla; para un título que no es un `h*`, la clase `font-titulos`.
- **Los nombres de shadcn no se renombran** (`primary`, `secondary`, `muted`, `accent`,
  `destructive`, `sidebar-*`, `chart-*`): son el contrato con `src/components/ui/`.
- **`src/index.css` se deriva de `tokens.json` a mano** (no hay generador). **Para cambiar un
  color**: se cambia el valor en `design/tokens.json`, se replica en `:root` de `src/index.css`
  (y en `@theme inline` si es un token nuevo), se comprueba `design/preview.html` y, si el color
  también aparece en los correos, en las constantes de `supabase/functions/_shared/resend.ts`
  (§9) y en `theme_color` / `background_color` de `vite.config.ts` e `index.html`. Nunca al revés.
- **Logo** (SVG con las letras en trazados, no dependen de la fuente), en `public/`:
  `logo-redestina.svg` (horizontal, por defecto, sobre crema o blanco),
  `logo-redestina-apilado.svg` (espacios cuadrados), `logo-redestina-negativo.svg` (**sobre verde o
  fondos oscuros**: sidebar, pie de la landing, pantallas de acceso; la barra superior de la
  landing es clara y lleva el logo en color),
  `logo-redestina-mono.svg` (un color, `currentColor`), `isotipo-redestina.svg` (solo la hoja:
  favicon, iconos PWA, avatares) e `isotipo-redestina-mono.svg`. `logo-email.png` es el negativo
  rasterizado a 410×120 para la cabecera verde de los correos. Nada de `brightness-0 invert` ni
  filtros sobre el logo: se elige la variante. Zona de respeto, tamaños mínimos y prohibiciones en
  `design/DESIGN.md §4`.
- **Fuentes**: Sora (500/600/700/800) e Inter (400/500/600/700), libres (OFL), desde Google Fonts
  en `index.html`. No hay fuentes propias en el repo.
- Modo oscuro: no existe en el branding y no se implementa (`@custom-variant dark` se queda sin valores).

## 3. Estructura

```text
index.html                     Carga Sora e Inter (Google Fonts), theme-color verde
vercel.json                    Rewrite de SPA (sin él, recargar una ruta profunda da 404)
vitest.config.ts               Config de las pruebas, aparte de vite.config.ts (§11)
tsconfig.tests.json            Tipos de las pruebas: Node y Deno, que la app NO debe ver
.githooks/pre-commit           Tipos + vitest + deno check antes de cada commit (§13)
tests/                         Pruebas unitarias (Vitest). Módulos de negocio, no pantallas
  deno.d.ts                    El global `Deno` declarado al mínimo, para que tsc compruebe
  cobertura.test.ts            Que el menú, las rutas y las claves i18n apunten a algo real
design/                        Sistema de diseño (§2bis): tokens.json, DESIGN.md, preview.html, PLAN.md
public/                        Logo en seis variantes SVG, favicon, iconos PWA y logo-email.png (§2bis)
.env.local.example             Plantilla de variables del frontend (sí se versiona)
.claude/skills/publicar/       Skill /publicar: el procedimiento de publicación (§11)
.claude/agents/                Tres agentes de proyecto (dades, servidor, interficie) con los que se
                               ejecutan por fases el sistema documental (§1, §7); Opus a esfuerzo alto
src/
  main.tsx                     Punto de entrada React
  App.tsx                      Dos capas: SessioProvider → RouterProvider (el contexto de rol
                               se monta más abajo, dentro de RequireSessio; §6quater)
  router/index.tsx             Mapa de rutas: públicas + privadas por rol (§6quater)
  layout/AppShell.tsx          Sidebar + barra superior + contenido + barra inferior (§2)
  layout/AppSidebar.tsx        Menú lateral plegable; con varios paneles los pinta todos (§6ter)
  layout/BottomNav.tsx         Barra inferior de móvil (productor y receptor)
  layout/UserMenu.tsx          Avatar, idioma y salir
  hooks/useSessio.tsx          Sesión cruda (¿hay token?) + evento PASSWORD_RECOVERY (§6quater)
  hooks/useAppContext.tsx      get_my_session_context(): quién eres (§4bis). El panel activo se
                               DERIVA de la URL; useOrganitzacio(tipus) para las pantallas
  hooks/use-mobile.ts          Hook del breakpoint (lo usa el sidebar de shadcn)
  hooks/useInstalacio.ts       ¿Se puede instalar la PWA, y cómo? (automática o manual iOS; §2)
  routes/Comuns.tsx            ArrelApp, RequireSessio, raíz por rol, RoleGuard y «sense accés»
  routes/public/               Landing, LoginUsuaris (/login), LoginEquip (/admin),
                               Registre (/registre), RestablirClau (/restablir) y
                               Confirmar (/confirmar/:token, sin sesión) — §6quater
  routes/PerfilOrganitzacio.tsx  Ficha propia, escrita por RPC con lista blanca
  routes/equip/                Envoltorios de las pantallas que ya existían + Aprovacions
                               + Documents (bandeja del sistema documental)
                               + Albarans/AlbaraDetall/Espigolades (fase 3)
  routes/productor/            Inicio, listado, alta de oferta y detalle
  routes/receptor/             Mercat, interessos i històric
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
    mensajes.ts                countUnanswered(): mensajes «sin contestar» por teléfono (§5)
    metaTest.ts                Lista de números de prueba de Meta (whitelist de envío, §9)
    emailTest.ts               Lista de correos de prueba (whitelist del canal email)
    settings.ts                getTestMode()/setTestMode(): modo test global (app_settings, §8)
    documents.ts               descarregarDocument() (URL firmada 60 s) i esperarGeneracio() (§4)
    albarans.ts                Envoltorios de las RPC de albaranes; nunca lanzan (§4bis)
    enllacPublic.ts            Cliente de enlace-publico, sin sesión (§9)
    email.ts                   enviarEmail(): llama a la Edge Function enviar-email
    i18n.tsx                   Sistema de traducciones (ca/es, per defecte ca; useT, §7)
    accessosTest.ts            Credenciales de las cuentas de prueba para /login (§6quater)
    utils.ts                   cn() (shadcn)
    crudCampos.ts              Definiciones de campos para el CRUD (claves i18n f.*)
    textos.ts                  RECOLLIDA CONFIRMADA y albarán (los compone el panel)
  components/
    AvisInstallacio.tsx        Banner de «instal·la Redestina» en móvil, productor y receptor (§2)
    EnllacOrganitzacio.tsx     Con quién comparte organización una ficha, y el botón de separarla.
                               Solo del equipo: lee la otra tabla de fichas (§12.28)
    LayoutAcces.tsx            Marco verde (bg-primary) de las pantallas de acceso (+ ComprovantSessio)
    FormulariAcces.tsx         Entrar y pedir enlace de recuperación (+ BotoUll)
    SelectorIdioma.tsx         Idioma suelto, para lo público (dentro va en UserMenu)
    AccessosTest.tsx           Botones de «entrar com a…» en /login (§6quater)
    Dashboard.tsx              Landing tras login: guía del proceso, KPIs y gestor de la lista Meta
    OffersList.tsx             Ofertas activas con kg en vivo (Realtime) + buscador
    OfferDetail.tsx            Detalle: priorización, canalizaciones, opt-in, cierre, cancelar
    ProducersList.tsx          Tabla de productores: buscador, separación Meta, detalle/nuevo/enviar
    EntitiesList.tsx           Tabla de entidades: buscador, badge "Meta", detalle/nueva/enviar
    RecordDetail.tsx           Ficha CRUD genérica (editar/crear/borrar) de productor o entidad
    ContactList.tsx            Sidebar de contactos + alta manual
    Conversation.tsx           Hilo de mensajes + composer + Realtime
    Settings.tsx               Configuración: interruptor del modo test global + idioma (§8)
scripts/
  import-ara.ts                Importación idempotente de los 5 CSV maestros
  crear-usuario.ts             Alta de cuentas por la Admin API (no envía correos)
  set-config.ts                Escribe una clave en app_config con la service key (p. ej. recordatorios_secret)
  comprobar-rls.ts             Arnés de RLS: matriz (cuenta, tabla, operación) → PASS/FAIL (§4bis)
  crear-usuarios-prueba.ts     5 organizaciones ficticias TEST-* y 7 cuentas, idempotente (§9)
  crear-usuarios-whatsapp.ts   5 cuentas de organización sobre las fichas REALES con móvil en
                               Meta; no crea ni toca ninguna ficha, solo enlaza (§9)
  prueba-numeracion.ts         Numeración documental sin huecos bajo concurrencia (§4)
  huellas-funciones.ts         Qué Edge Functions cambiaron de verdad entre dos despliegues (§12.44)
  roles-activos.ts             Interruptor del modelo de roles: on | off | estat (§4bis)
  diagnostico-whatsapp.ts      Interroga la Graph API y distingue token caducado / número / permisos (§8ter)
  sql/rls-emergencia.sql       Paracaídas: restaura las políticas permisivas (NO es migración)
  data/                        Los CSV — IGNORADO POR GIT (datos personales, §7)
supabase/
  config.toml                  Config del CLI (puertos 553xx, ver §7)
  migrations/*.sql             Migraciones versionadas
  functions/
    _shared/cors.ts            originPermitido()/corsPara(): CORS de las funciones públicas (§10)
    _shared/pdf/               Motor de PDF: maquetador A4, fuentes embebidas, plantillas y
                               render/ (rec, ent, ope, res, cd, conv, pla, ct + cierre.ts común).
                               `pintarFirma()` la comparten CD y CT; el CT NO importa lletres.ts
                               porque no lleva ningún importe
    _shared/whatsapp.ts        Graph API + interruptor de envío (texto/plantilla/interactivos)
    _shared/intake.ts          Motor conversacional (máquina de estados)
    _shared/oferta.ts          crearExcedente(): id_excedente + texto "OFERTA DISPONIBLE"
    _shared/camposOferta.ts    Los 14 pasos, compartidos por el intake y el panel (§6bis)
    crear-oferta/index.ts      GET /campos (descriptor) + POST (alta desde el panel del productor)
    _shared/priorizacion.ts    Puntuación de entidades (pura, sin red)
    _shared/respuestas.ts      Captura el sí/no de una entidad a una oferta (aceptación, §5)
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
                               las fuentes y el logo, declarados con static_files en config.toml
    descargar-documento/       POST (JWT): URL firmada de 60 s tras puede_ver_documento()
    recordatorios-documentales/ POST {}: enlaces sin usar a 7 y 14 días → aviso al equipo
                               (el token no se puede reenviar, §9)
    limpiar-documentos-prueba/ POST (JWT, super_admin): borra los PDF huérfanos de proves/.
                               La otra mitad de reiniciar_documentos_prova() (§12.51)
    _shared/resend.ts          sendEmail() + plantillaEmail(): el maquetado de TODOS los correos (§9bis)
    _shared/plantillas-meta.md Contenido de las plantillas de Meta (oferta_excedent…) listo
docs/                          Material de trabajo local — IGNORADO POR GIT (§7)
  nuevas-funcionalidades/      Specs Redestina, manuales y CSV de origen
```

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
no tiene otro sitio: la identidad y `canal_preferido`, que es el campo que pide el funcional y la
deuda §12.22 —hoy el canal se **deduce** de la ficha y la persona no puede decir el suyo—.

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

⚠️ **El relleno inicial no basta, y esto casi se escapa.** `20270310100000` rellenó las 464
fichas que había **en ese momento** y ahí se acababa: cualquier ficha creada después —un alta desde
`/registre`, una del panel, un fixture— nacía **sin organización y sin dar ningún error**, porque la
columna era nullable. Se vio por casualidad a los pocos minutos, al cambiar la clave de `convenios`.
Lo que mantiene la invariante es el trigger `*_estrena_organizacion` (`20270313100000`) más el
`not null`: el primero la rellena, el segundo hace que no se pueda saltar. **Migrar los datos y
mantener la invariante son dos cosas distintas**, y un `update` de relleno solo hace la primera.

🟡 **La etapa 1 no cerraba ninguna deuda por sí sola**: desbloqueaba las ocho de la brecha 2
(11, 16, 20, 22, 27, 28, 31, 79). Cerradas ya **31** (una ficha por tipo, `20270311100000`) y **79**
(convenios por organización, `20270312100000`); las otras seis siguen necesitando su trabajo encima.

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
`cerrada` · `no_colocada` · **`cancelada`** (anulada desde el panel; check en
`20260722130100_estado_cancelada.sql`). `modalitat` ∈ `donacio` · `venda` · `maquila`. **`preu_minim`**
(numeric €/kg, `20260723130000_aceptacion_ofertas.sql`): preu mínim que fija el productor en el intake,
solo en `venda`/`maquila`; sale en `texto_oferta` y la entidad lo confirma al aceptar (§5).

**`canalizaciones`** — detalle por entidad: `kg_confirmados`, `kg_reales`, cajas, albaranes,
firmas. Relación **`excedentes` 1—N `canalizaciones`** (una oferta, varias entidades).

**`oferta_respuestas`** — flujo de **aceptación** (`20260723100000_oferta_respuestas.sql`; ampliada
en `20260723130000_aceptacion_ofertas.sql`): `excedente_id` (FK, `on delete cascade`), `entidad_id`
(FK, `on delete set null`), `telefono`, `canal` (`whatsapp`·`email`·`panel`), `mensaje_respuesta`,
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
⚠️ **Guarda un correo suelto, sin FK**: borrar una organización **no** la quita de aquí. El
31-07-2026 quedaron dos filas huérfanas (`TEST-ENT-ANIMAL`, `TEST-PROD-PENDENT`) apuntando a
organizaciones que ya no existían. Es inocuo —la whitelist solo *permite*, no envía— pero la lista
deja de describir quién existe; al borrar una organización de prueba, borrar también su fila.

**`app_config`** — `key` PK, `value`, `updated_at` (`20260722130000_intake_recordatorios.sql`).
Clave/valor para secretos que un **job** necesita y que no pueden ir en git. Hoy guarda
`recordatorios_secret` (el que el job pasa a `intake-recordatorios`, §5). **Solo `service_role`**:
RLS activa sin política y `revoke` explícito del `SELECT` que `authenticated` heredaría por
default privileges (§9). La fila del secreto se inserta fuera de git con la service key.

**`app_settings`** — `key` PK, `value`, `updated_at` (`20260723140000_app_settings.sql`).
Clave/valor de **configuración no secreta** que gestiona el equipo desde **Configuración** (a
diferencia de `app_config`, solo `service_role` para secretos). RLS: `authenticated`
select/insert/update, y `service_role`. Hoy guarda **`test_mode`** (`'true'`/`'false'`, default
`'true'`): el **modo test global** (§8). Lo leen las Edge Functions (`modoTestActivo`) y lo togglea
`src/lib/settings.ts` desde la página Configuración.

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
dominio nunca apunta al PDF, se le pregunta con `documento_vigente()`. Columnas: `tipo` (12
valores, de REC a PROVA) · `subtipo` · `objeto_tipo` (6) · `objeto_id` · `numero_completo` ·
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
`created_at`. Cierra parcialmente la deuda §12.25. `canal` admite solo correo a propósito: un
documento o un enlace de firma por WhatsApp quedaría publicado en la consola de Mensajería, que
lee todo el equipo.

**Buckets** (`20260928100600_storage_buckets.sql`) — `documentos` (privado, 20 MB,
pdf/png/jpeg) y `activos` (privado, 5 MB, png/jpeg, para la firma y el sello de la apoderada).
**Sin una sola política en `storage.objects`**: nadie toca Storage directo, ni para leer ni para
listar. Se lee por la Edge Function `descargar-documento`, que autoriza con
`puede_ver_documento()` y firma una URL de 60 s.

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
de que exista `documentos` y el `alter table` fallaría. Que hoy funcione en local —donde `100200`
ya estaba aplicada y `100100` llegó fuera de orden— habría escondido el problema hasta el primer
`db reset`.

**`enlaces_token`** — firmar y confirmar **sin tener cuenta** (`20260928100300`): `proposito`
(`firma_convenio`·`confirmacion_albaran`·`subida_factura`), `objeto_tipo` + `objeto_id`,
`destinatario_email`, `canal` (`email`·`asistido`), **`token_hash` UNIQUE**, `codigo_hash`,
`caduca_at`, `abierto_at`, `usado_at`, `estado`, `recordatorios`, `ultimo_recordatorio_at`.
Índice parcial `(caduca_at) where estado='activo' and usado_at is null` (el de los recordatorios
de 7/14 días). **El token en claro solo existe en el correo**: en la base queda el sha256 de 32
bytes aleatorios, como una contraseña. `canal='asistido'` es el enlace que abre el dinamizador
delante de la persona (modelo asistido, §1bis), no un atajo.

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
`notice`**, que es lo que permite emitir documentos de prueba en local sin que nada salga a la red.

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
`SELECT` por columnas en `enlaces_token` y `evidencias`. **Ninguna escritura en `documentos`,
`documento_envios`, `series_documentales`, `enlaces_token`, `evidencias` ni `municipios`**: la
superficie de escritura son las RPC `security definer` y `service_role`.

**Albaranes (fase 3, `20261012*`)** — `albaranes` (**REC** entrada del generador · **ENT** entrega
a la entidad · **OPE** venta o maquila) y `albaran_lineas`, donde viven **los kilos oficiales**
(`kg_bruto` / `tara_kg` / `kg_neto`, y `kg_previstos` / `kg_confirmados` / `kg_validados`); solo
`kg_validados` cuenta para indicadores y certificados (D13). **Sin ninguna columna de importe, a
propósito** —en un albarán no hay dinero— y el arnés lo comprueba esperando `42703`. El número se
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
`origen='espigolament'` y su REC cuelga de `espigolada_id`. `documentos_externos` (polimórfica,
`albaran`/`cierre_donante`) guarda lo que aportan terceros: el albarán del productor, la factura del
donante, fotos de incidencias.

**`tipos_caja`** (con `tara_kg`) y **`costes_producto`** (+`costes_producto_hist`, con motivo
obligatorio en cada cambio). `costes_producto` es el **único origen del valor fiscal**: al crear una
canalización se copia su `coste_kg` y se congela al conciliar; **si no hay coste del ejercicio queda
`null` y eso bloquea el cierre**, que es justo lo que se quiere —con el 1 €/kg plano de
`productos.eur_kg` el bloqueo no saltaría nunca—. `tipos_caja` nace **sembrada provisional y
desactivada** hasta que la Fundación dé la lista de taras.

Vista `v_albaranes_bandeja` (`security_invoker`) para la bandeja del equipo. GRANT: solo `SELECT` en
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

**`convenios_exigidos`** — matriz oferta↔convenio **en tabla**, como `modalitat_receptor_compat`:
`(valorizacion, parte, tipo_convenio)`. La donación exige `don_gen` a quien entrega y `don_rec` a
quien recibe; venta y maquila exigen `com` a las dos partes. Cambiar la regla es un `insert`.

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
canalizaciones ni albaranes**.

Job `congelar-ejercicio` en `pg_cron` a `59 22 31 12 *` **UTC**, que son las 23:59 de Madrid en
horario de invierno.

**Certificado a demanda (`20270303*`)** — `cierres_periodo` y `cierre_periodo_lineas`: el mismo
acumulado de un donante, pero de una **ventana de fechas** dentro de un ejercicio. Tabla hermana y
no un `tipo` más de `cierres_donante`, por dos cosas que no se pueden forzar: aquella cuelga de
`cierres_ejercicio` —de donde salen modo y ejercicio, y un certificado a demanda **no abre cierre**,
menos aún el real— y su clave `(cierre_id, productor_id, tipo)` dejaría **uno** por año, cuando un
donante puede pedir varios. Serie propia **`CDP`** (+`P-CDP`), nunca la del anual: los números del
182 son correlativos y solo del cierre. **El documento se emite con `documentos.tipo = 'CD'`** —el
renderizador se elige por `tipo`, y `cd.ts` ya imprimía un periodo—, así que lo que lo distingue es
la serie y `objeto_tipo = 'cierre_periodo'`, el séptimo. Se archiva en la carpeta `CD/` del donante.

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

⚠️ **Cuatro columnas quedan fuera del GRANT de SELECT y ninguna política lo suple**:
`enlaces_token.token_hash`, `enlaces_token.codigo_hash`, `evidencias.documento_identidad` y
`parametros_documentales.apoderada_dni`. RLS no sabe restringir columnas; el GRANT sí (mismo
patrón que `perfiles`, §4bis). Consecuencia práctica: **un `select('*')` sobre esas tres tablas
responde `42501 permission denied for column`** — hay que pedir columnas explícitas, y en un solo
literal (§7).

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
`UPDATE` en `app_settings`. Casos deliberadamente cerrados a nivel de GRANT, antes incluso de
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

`roles_activos()` · `es_intern()` · `pot_aprovar()` · `es_super_admin()` · `mi_rol()` ·
`mis_productores()` · `mis_entidades()` · `soc_titular(tipo, org)` ·
**`get_my_session_context()`** (una llamada al entrar: rol, `vista_defecto` y organizaciones; desde
`20260731100000` devuelve además **`registre_pendent`** y **`registre_rebutjat`** — sin ellas la
interfaz no podría distinguir a quien espera validación de quien simplemente no tiene organización:
los dos llegan con `organizaciones = []`, porque la membresía pendiente es `activo = false`).

⚠️ **Dos matices del contexto que el resto de la doc no capturaba** (verificado 2026-08-01):
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
| `manifestar_interes(excedente, entidad, kg, preu, caixes)` | El receptor acepta desde el panel. Deja la fila igual que el diálogo de WhatsApp (`acceptada` + `aprovacio='pendent'`, `canal='panel'`), así **cae en la misma cola de aprobación** que ya existe. Valida compatibilidad y `preu_minim` |
| `aprovar_resposta(resposta, kg, preu, motiu)` | Aprobar y canalizar **en una transacción** (hoy `OfferDetail` hace 3-4 llamadas sueltas). Exige `pot_aprovar()` |
| `actualizar_mi_productor(…)` / `actualizar_mi_entidad(…)` | Autoedición con **lista blanca**: nunca `es_test`, `activo`, `codigo`, `conveni`, `prioritat`, `estat`, `gestio` |
| `actualizar_meu_canal(tipo, ficha, canal)` | Fija `organizaciones.canal_preferido` desde la ficha propia (`20270314100000`). **Es la única escritura de esa tabla**, que no tiene GRANT de UPDATE para nadie. `canal` null = volver a deducirlo. Pasa el titular **o el equipo** —al revés que las dos de arriba, y por eso: sobre las fichas el equipo tiene GRANT y edita desde `RecordDetail`, sobre `organizaciones` no tiene ninguno, y el modelo es asistido |
| `cancelar_meva_oferta(excedente, motiu)` | El productor cancela la suya. Editarla no: el `texto_oferta` ya circuló |
| `organitzacions_candidates(tipo, ficha)` | Qué organizaciones podrían ser la misma que la de esta ficha, calculado **al vuelo** con el criterio de siempre —correo o teléfono exactos, nunca el nombre—. `es_intern()`: enseña nombre, NIF, correo y teléfono de otra organización |
| `enllacar_organitzacio(tipo, ficha, organitzacio)` | **Fusiona**: mueve la ficha —y sus convenios, solo los suyos— a esa organización y retira la que deja vacía. `pot_aprovar()`. Se niega con el motivo si el destino ya tiene ficha de ese tipo o si las dos traen convenio vigente del mismo tipo. Con `organitzacio` NULL **separa** la ficha en una organización nueva, que es el deshacer |
| `aprovar_registre(membresia)` / `rebutjar_registre(membresia, motiu)` | Validan un alta del registro público (`20260731100000`). Exigen `pot_aprovar()` (42501), bloquean la fila con `for update` y solo actúan sobre `pendent` (22023). **Rechazar no borra nada**: queda la auditoría y la persona ve el motivo |
| `siguiente_numero(serie, ejercicio)` | El correlativo, dentro de la transacción de emisión. **Sin `execute` para `authenticated`** |
| `formato_numero(serie, ejercicio, n)` | `REC-2026-00042` |
| `ruta_documento(objeto_tipo, objeto_id, tipo, numero, version, modo, ejercicio)` | La carpeta por organización (§4 «Sistema documental»). `stable`, no `immutable`: lee el dominio. Solo `service_role` |
| `puede_ver_documento(documento, user default null)` | Autoriza la descarga. `service_role` puede preguntar por un usuario concreto; un `authenticated` que pase el uuid de otro se lleva `42501` |
| `documento_vigente(objeto_tipo, objeto_id, tipo)` | Qué PDF vale hoy. **`security invoker` a propósito**: la RLS de `documentos` se aplica igual que en un `select` |
| `documents_meus(user default null)` | Puente `security definer` (`setof uuid`) entre `documentos` y las organizaciones del usuario. **Fase 1: vacío**; cada fase la reescribe con `create or replace` sin tocar la tabla ni su política |
| `emitir_documento_prova(fallar default false)` | Documento de humo, serie `PROVA`, `modo='prueba'`. Exige `es_super_admin()`. Con `fallar` levanta excepción **después** de pedir el número: es lo que prueba `scripts/prueba-numeracion.ts` |
| `reiniciar_documentos_prova()` | Borra los documentos `modo='prueba'` y pone a 0 `PROVA`/`P-*` del ejercicio. Única excepción a la inmutabilidad |
| `marcar_documento_generado(id, sha, bytes, paginas)` / `marcar_documento_error(id, err)` | Solo `service_role`. La `ruta` no se pasa: ya está fijada. `generado` es idempotente |
| `emitir_albaran(id, recogida, lineas, idioma)` | Pide número, congela `partes`, emite el PDF. `es_intern()`; `22023` si no es borrador |
| `marcar_entregado(id)` | Crea los enlaces de confirmación y **devuelve el token en claro**: es la única vez que existe (en la base solo está su hash). `es_intern()` |
| `registrar_confirmacion(enlace, payload, evidencia)` | **Solo `service_role`.** Usa SQLSTATE `PT404`/`PT409`/`PT410`, que PostgREST traduce a HTTP sin que la Edge Function traduzca nada |
| `propuesta_conciliacion(rec)` | Contrasta el neto del REC con la suma de los ENT confirmados y dice si cae dentro de la tolerancia |
| `conciliar_albaran(id, kg_validados, motivo, destino_final)` | Fija los kilos oficiales. Exige confirmación **o** plazo vencido con motivo |
| `anular_albaran` / `rectificar_albaran` | `pot_aprovar()`. El rectificativo usa serie `R-<tipo>` y deja el original en `rectificado` |
| `crear_espigolada` / `repartir_espigolada` | La jornada y sus lotes. `repartir_espigolada` es el único camino que **no** pasa por `aprovar_resposta()`, así que llama por su cuenta a `exigir_convenio()` |
| `fijar_coste_producto` / `fijar_tipo_caja` (`pot_aprovar()`) · `borrar_coste_producto` (`es_super_admin()`) | El valor fiscal y las taras. Borrar existe porque un coste fijado en el ejercicio equivocado no tenía vuelta atrás |
| `albarans_de_les_meves_orgs()` | Puente: REC→productor, ENT→entidad, OPE→las dos. **Sin borradores** |
| `exigir_convenio(tipo, org)` | **Stub** en la fase 3: solo devuelve aviso. La fase 2 lo convierte en bloqueo tras la fecha de corte |
| `abrir_cierre` · `calcular_cierre` · `emitir_resumen` · `registrar_factura` · `simular_factura` · `emitir_certificado` · `marcar_enviado` · `marcar_declarado` · `rectificar_certificado` · `reiniciar_cierre_prueba` · `conciliacion_retroactiva` | El ciclo del cierre anual. `abrir_cierre` en modo real exige `es_super_admin()`; `simular_factura` solo existe en cierres de prueba |
| `cierre_base` · `cierre_pendents` · `datos_182` · `comparar_cierre_prueba` · `provincia_por_cp` | Las consultas. La base de cálculo son donaciones **conciliadas** con la fecha de recogida dentro del año **en hora de Madrid**, con los kilos del REC conciliado repartidos entre las canalizaciones del registro (D13) |
| `cerrar_cierre(cierre)` | Cierra **un** cierre por su uuid: recalcula, emite los resúmenes definitivos y pasa a `tancat`. `pot_aprovar()`, y **`es_super_admin()` si el cierre es real** |
| `congelar_un_cierre(cierre)` | La misma operación, interna (`service_role`). El job `congelar_ejercicio(año)` la llama en bucle, así que **hay una sola implementación** de «qué es congelar un cierre» |
| `cierre_base_periodo(desde, hasta, modo)` · `cierre_pendents_periodo(desde, hasta)` | La base de cálculo de una ventana. `cierre_base`/`cierre_pendents` son envoltorios suyos. **Solo equipo** (`42501`): antes no lo eran, y era una fuga |
| `calcular_certificado_periodo(productor, desde, hasta, modo)` | El borrador del certificado a demanda y sus bloqueos. `pot_aprovar()`. `22023` si la ventana cruza dos ejercicios, si acaba en el futuro o si esa ventana ya tiene certificado |
| `registrar_factura_periodo(periodo, numero, fecha, importe, doc_externo)` | La factura del periodo. Existe para que el camino normal del certificado a demanda sea el mismo del anual y la excepción de D4 siga siendo una excepción |
| `emitir_certificado_periodo(periodo, motivo)` | Las guardas del anual, literalmente —`datos_provisionales` → `42501`, ningún `bloqueja`, kg y valor positivos, factura coincidente o D4 con `es_super_admin()`— más la plantilla `CD/parcial` vigente. Sustituye los parciales contenidos |
| `rectificar_certificado_periodo(periodo, motivo)` · `marcar_enviado_periodo(periodo)` · `reiniciar_periodes_prova(ejercicio)` | El resto del ciclo. Rectificar no consume número: es la versión siguiente |
| `rectificar_certificado_transaccion(cd, motivo)` | **Ya existe** (cierra la deuda 86): un CT con un error no tenía ninguna salida. Sin serie `R-CT`, que no se finge |
| `ruta_documento_externo(objeto_tipo, objeto_id, tipo, ejercicio, extension, modo)` | La ruta **entera** de un fichero que aporta otro: `<org>/<ejercicio>/externs/<uuid>-<tipo>.<ext>`. Solo `service_role`. Antes la carpeta la daba SQL y el nombre lo componía TypeScript, en dos funciones distintas (deuda 62) |
| `modalitats_compatibles_meves()` | Puente **sin correlación** de la RLS de `excedentes`: qué modalidades puede recibir alguna de mis entidades. El EXECUTE a `authenticated` **no es opcional** — una política se evalúa con los privilegios de quien consulta |
| `missatges_sense_contestar()` | Entrantes posteriores al último saliente, por teléfono. `security invoker`: agrega solo lo que quien pregunta ya podía leer (deuda 5) |
| `puc_pujar_document_extern(objeto_tipo, objeto_id, user)` | Puente único de permiso para subir externos: `albaran` → `albarans_de_les_meves_orgs`, `cierre_donante` → `cierres_donante_meus`, y el equipo siempre. Lo usa `subir-documento-externo` |
| `preparar_convenio` · `enviar_convenio` · `contrafirmar_convenio` · `retornar_convenio` · `resolver_convenio` · `iniciar_firma_asistida` | El ciclo del convenio. `enviar_convenio` devuelve **el token en claro** (única vez que existe) y reenviar **revoca el anterior** |
| `guardar_plan_basico` · `emitir_plan_basico` · `plan_datos` · `puc_gestionar_pla` | El plan de prevención. `emitir_plan_basico` deja `envio` null: descarga inmediata por polling |
| `calcular_cierre_transacciones` · `emitir_certificado_transaccion` · `cierre_base_transaccion` | El CT, sobre albaranes OPE conciliados. Como el CD, **se niega mientras `datos_provisionales` sea `true`** |
| `firmar_convenio_por_enlace` · `validar_codi_firma` | **Solo `service_role`**: quien firma no tiene sesión, lo que autoriza es el token. `PT403` si falta validar el código de la firma asistida |
| `convenio_vigente(tipo_org, org, valorizacion, parte)` · `exigir_convenio(...)` | **`exigir_convenio` ya no es stub**: antes de `fecha_corte_convenios` avisa, después levanta `42501 sense_conveni`. Lo aplican `aprovar_resposta()` y `repartir_espigolada()` |

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
el cálculo, y a partir de ahí toda corrección pasa por `rectificar_certificado()`, que numera una
rectificativa — el error de un clic no se deshace, se documenta. Un cierre de prueba no tiene
ninguna de esas consecuencias, y exigir el super_admin ahí solo conseguiría que el ensayo no se
hiciera.

⚠️ **`emitir_certificado()` se niega mientras `parametros_documentales.datos_provisionales` sea
`true`**, citando el CIF sembrado. Un certificado con efecto fiscal no puede salir con un CIF
inválido; cierra la deuda 56.

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

### Verificación

`deno run -A scripts/comprobar-rls.ts` (§11): abre sesión con cada cuenta —con la publishable
key, como el navegador— y comprueba una matriz declarativa de *(cuenta, tabla, operación) →
permitir/denegar*. Referencia con el sistema documental: **95/95 correctas y 12 saltadas** (107
comprobaciones). Contra local hay que darle también `SB_SECRET_KEY`: ahí no inicia sesión, firma el
JWT, porque el CLI apaga el login por correo (§9).

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
- **Un `UPDATE` denegado por RLS no da error.** PostgREST no encuentra filas que cumplan el `using`
  y devuelve éxito con cero afectadas, así que un rechazo era indistinguible de un acierto. La rama
  de `actualizar` pide ahora las filas afectadas (`.select('id')`) y trata «cero filas sobre una
  fila que sé que existe» como denegación. Es el argumento del §12.48 por el otro lado. Es la primera comprobación automática del proyecto que no es `tsc`. Las
credenciales viven en `scripts/data/cuentas-prueba.json` (fuera de git).

Si algo sale mal: **Nivel 0**, `update app_settings set value='false' where key='roles_activos';`
(10 segundos). **Nivel 1**, `scripts/sql/rls-emergencia.sql`, que vive **fuera** de
`supabase/migrations/` para que `db push` no lo aplique nunca.

## 5. Flujos

**Envío (saliente)** — `Conversation` → `sendWhatsApp()` → `POST /functions/v1/whatsapp-send`
(con el JWT de la sesión en `Authorization`) → aplica las reglas de envío (§8) → `POST
graph.facebook.com/{API_VERSION}/{PHONE_ID}/messages` → upsert en `wa_messages` → Realtime.
Si Meta devuelve error, la función lo reenvía **tal cual** con su status HTTP.

**Recepción (entrante)** — Meta → `POST /functions/v1/whatsapp-webhook` → valida
`X-Hub-Signature-256` (HMAC-SHA256 del cuerpo **crudo**, comparación en tiempo constante) →
upsert del contacto → **upsert** del mensaje por `wa_message_id` → actualiza
`last_inbound_at` → Realtime. Tras validar la firma **siempre responde 200**, para que Meta
no reintente. **Gate `es_test`**: el mensaje se registra y abre la ventana, pero solo se
**responde** (ALTA/BAJA, respuesta a oferta, intake) si el número es de un productor/entidad
marcado `es_test`; si no, se deja en la consola para una persona (§8).

**Estados** — los `value.statuses` actualizan `wa_messages.status` casando por
`wa_message_id`.

**Palabras clave** — `BAJA` pone `opt_in=false` + `opt_out_at`; `ALTA` pone `opt_in=true` +
`opt_in_at`. **Ambas responden confirmación** por WhatsApp (estamos en ventana, es gratis) y
se registran como `outbound`.

**Aceptación de una oferta (diálogo)** — `procesarRespuestaOferta()` (`_shared/respuestas.ts`),
enganchada en el webhook **antes del intake y con prioridad sobre él**. Trabaja sobre la fila
`pendent` de `oferta_respuestas` más reciente para ese teléfono (**la última oferta enviada**) y
conduce un **diálogo corto**: un **sí** arranca `dialeg_pas='kg'` («quants kg vols?»); tras el número,
si la modalitat es `venda`/`maquila` con `preu_minim` pide **confirmar el preu** con botones
(`accept:preu_*`) y finaliza dejando `estado='acceptada'`, `kg_solicitados`, `preu_ofert` y
`aprovacio='pendent'`; un **no** claro en el paso inicial o en el paso `kg` pasa a `rebutjada`.
⚠️ **Rechazar el preu mínimo NO marca `rebutjada`**: la fila queda `estado='acceptada'` con
`preu_ofert=null` y `mensaje_respuesta="L'entitat no accepta el preu mínim (a revisar per l'equip)."`,
y sigue en la cola de aprobación para que el equipo decida. **Mientras el diálogo
está en curso la fila sigue `pendent`** (así el emparejamiento la sigue encontrando). Solo consume
interactivos con prefijo `accept:` (los del intake, `familia:`…, se dejan pasar). **Resuelve el doble
rol**: un número productor **y** entidad con oferta pendiente que contesta se atiende aquí; sin oferta
pendiente o texto no clasificable, devuelve `false` y cae al intake. El **superadmin aprueba** la
aceptación desde el panel y la convierte en canalización (§6ter).

**Intake conversacional** — un productor escribe → el webhook lo identifica por `phone` en
`productores` → `procesarIntake()` (`_shared/intake.ts`). El estado vive en
`intake_sessions` (una fila por teléfono) y cada mensaje se interpreta según `paso_actual`.
Al completarse, `crearExcedenteDesdeSesion()` da de alta el excedente y avisa al productor.
Detalle en §6bis.

**Recordatorio de intake a medias** — la base **no** puede enviar WhatsApp, así que el aviso
de 10 min se dispara así: `pg_cron` (cada 2 min) → `disparar_recordatorios_intake()` →
`net.http_post` (**pg_net**) → Edge Function `intake-recordatorios` → busca sesiones inactivas
entre 10 min y 12 h sin avisar y manda `sendBotones` «Continuar / Cancel·lar», marcando
`recordatorio_enviado_at`. La función se despliega `--no-verify-jwt` y se protege con un secreto
compartido (cabecera `x-recordatorios-secret`) que vive en `app_config` (lo lee el job) y en el
secreto `RECORDATORIOS_SECRET` (lo valida la función). Si el productor pulsa **Continuar** se
reanuda el paso; **Cancel·lar** (o la palabra **`Stop`**) borra la sesión. Detalle en §6bis.

**"Sin contestar"** — `countUnanswered()` (`src/lib/mensajes.ts`, compartido): mensajes `inbound`
posteriores al último `outbound` de ese teléfono. Lo usan `ProducersList` (badge) y `ContactList`
(ordena los contactos con pendientes arriba y muestra el contador).

## 6. Importación de datos maestros

Los datos maestros entran por **dos vías distintas, y la diferencia importa**:

| Qué | Cómo | Por qué |
| --- | --- | --- |
| Catálogos (`productos`, `causas`, `factores_conversion`) | Migración `20260721120300_seed_catalogos.sql` | Son configuración, no llevan datos personales: pueden vivir en git y deben existir en todos los entornos |
| `productores` y `entidades` | `scripts/import-ara.ts` | Llevan nombre, NIF, teléfono, email y dirección: los CSV **nunca** se versionan (§9) |

Para **regenerar el seed de catálogos** tras reexportar los CSV: el fichero se generó
leyendo `scripts/data/{causas,productos,factores_conversion}.csv`, normalizando las familias
igual que el script y emitiendo `insert … on conflict … do update`. Basta con crear una
migración nueva con el mismo formato; no editar la ya aplicada.

`scripts/import-ara.ts` (Deno) carga los 5 CSV de `scripts/data/`. **Idempotente**: se puede
ejecutar las veces que haga falta. Admite `--dry-run`. Verificado end-to-end contra la base
local (dos pasadas: la segunda actualiza, no duplica).

| CSV | Filas | Destino | Clave |
| --- | --- | --- | --- |
| `causas.csv` | 8 | `causas` | `codigo` |
| `factores_conversion.csv` | 15 | `factores_conversion` | `producto` |
| `productos.csv` | 91 → 90 | `productos` | `nombre` |
| `sda.csv` | 111 | `entidades` | `nombre` (lookup manual) |
| `prod_actius.csv` | 339 | `productores` | ver abajo |

Peculiaridades verificadas de los datos, todas manejadas por el script:

- **`prod_actius.csv` tiene la cabecera DESPLAZADA** respecto a los datos: la primera
  columna real es una fecha de alta que no figura en la cabecera. Se importa por
  **posición**, ignorando la cabecera. El mapeo está documentado en el propio script.
- **3 códigos apuntan a productores distintos** (`CN038`, `PR215`, `PR273`). Usar `codigo`
  como clave fusionaría fichas: para los códigos ambiguos se cae a `nombre + población`.
- **Los teléfonos son texto libre**: espacios entre grupos, nombres pegados, extensiones y
  hasta tres números en una celda. `extraerTelefonos()` busca secuencias de 9 dígitos
  tolerando separadores; el primero va a `phone` y el resto a `telefono_alt`. Si no se
  extrae ninguno pero la celda tenía texto, se conserva en crudo.
  Resultado: **278 de 339 con teléfono, de los cuales solo 272 son móviles** — los 6 fijos
  no reciben WhatsApp. 3 colisiones (el segundo se queda con `phone = null`).
- `productos.csv` trae erratas de familia (`Fruita seca`, `Fruit vermell`,
  `Hort Tub/Bul/Arr`) que se normalizan, y un `Garrofa` duplicado que se fusiona.
- `email` es UNIQUE: vacíos y duplicados van a `null` (solo 78 de 339 tienen email).
- Solo 12 productores tienen par de coordenadas numérico → se crean ~12 ubicaciones.
- `productos_habituales` queda **vacío**: la columna Producte no existe en este export.
  Reimportar cuando se reexporte el Excel ARA con esa columna.

## 6bis. El intake conversacional

Catorce pasos (13 fijos + 1 condicional; `PASOS`/`CAMPOS` en `_shared/camposOferta.ts` —el comentario
de `intake.ts` que dice «trece» es engañoso): `familia` → `producte` → `varietat` → `kg` → `caixes` →
`tipus_caixa` → `retorn` → `ubicacio` → `disponible_fins` → `horari` → `modalitat` →
**`preu_minim`** (solo si `modalitat` es `venda`/`maquila`; en `donació` se salta) → `causa` →
`observacions`. Las opciones salen **siempre de las tablas** (`productos`, `causas`), nunca
escritas a mano. El `preu_minim` (€/kg) queda en `excedentes` y aparece en la oferta (§5/§6ter).

**`disponible_fins` → `disponible_hasta` (parseo).** La respuesta libre al paso `disponible_fins`
(«Fins quin dia està disponible? p. ex. 23/07») se intenta convertir a fecha real con
`parseDisponibleFins()` (`_shared/oferta.ts`): reconoce `dd/mm[/aaaa]` con separadores `/ - .`,
infiere el año (el actual, o el siguiente si ya pasó) y rellena `disponible_hasta` al crear el
excedente. Si no reconoce una fecha, queda `null` (como antes) y el panel la normaliza a mano; el
texto de la oferta conserva siempre el original. Esto reduce la deuda §12.4.

**Arranca preguntando, no con el cuestionario.** Ante un mensaje que no sea ALTA/BAJA de un
productor sin sesión abierta, Redestina responde con una **guía corta** (qué es, qué preguntará, y
que puede escribir `Stop` cuando quiera) y los botones *Sí / Ara no*. Es una desviación
deliberada del Redestina §8, que hacía que *cualquier* mensaje lanzara el formulario: con 271
productores escribiendo por cualquier motivo, eso secuestra conversaciones normales.

**La paginación es el caso normal.** Las listas de WhatsApp admiten 10 filas: se muestran 9
opciones y la décima es "Més…". Hace falta porque hay **12 familias** y cuatro superan los
10 productos (Horta Tub/Bul/Arr 16, Fruita Dolça 14, Horta Fruit 14, Horta Fulla 12).

**Casos que el motor ya contempla:**

- Respuesta que no encaja: se repite la pregunta hasta 2 veces; a partir del 3.er fallo el motor
  responde el texto «Escriu Stop per aturar». ⚠️ **No** es un botón de cancelar, y **no** resetea el
  contador de intentos: si se sigue fallando, repite ese texto en bucle hasta una respuesta válida.
- **Cancelar en cualquier momento**: la palabra **`Stop`** (alias ocultos `CANCELAR`/`CANCEL·LAR`) **o** el botón
  `intake:cancelar` (del recordatorio) borran la sesión de `intake_sessions`.
- **Recordatorio a los 10 min** de inactividad: aviso «Continuar / Cancel·lar» (§5). *Continuar*
  (`intake:continuar`) reanuda el paso donde se dejó; se manda una sola vez por periodo inactivo.
- Sesión inactiva más de 12 h: se descarta y se empieza de cero (el recordatorio actúa antes).
- Productor **sin ubicaciones** (329 de 341): no se puede enviar una lista vacía, así que se
  pide el enlace de Google Maps por texto. El enlace crea una `productor_ubicaciones` que
  hereda el municipio de la ficha.
- Cantidad en unidades o manats: se convierte con `factores_conversion` si hay factor.
- ⚠️ **`tipus_caixa` y `retorn` son opcionales en el panel pero obligatorios en el intake por
  WhatsApp.** Son `obligatorio:false` en `camposOferta.ts`, pero el intake los pide con lista de
  opciones y **sin fila «saltar»**, así que por WhatsApp el productor no puede avanzar sin pulsar una.
  Las dos interfaces del «mismo cuestionario» divergen en esto.
- ⚠️ **Callejón en `ubicacio` cuando SÍ hay ubicaciones.** Se ofrece la fila «Comparteix un punt»
  (`ubicacio:nova`), pero `interpretar()` la excluye y exige un enlace de Maps por texto: pulsarla
  (sin texto) cuenta como fallo y **re-muestra la misma lista** en vez de pedir el enlace. El caso
  «sin ubicaciones» (pedir el enlace por texto) sí funciona.

**Identificador**: `E-AAMMDD-XXX-YYY-N` (3 letras del productor, 3 del producto, N = orden
del día). Ejemplo real: `E-260721-CAR-TOM-1`.

**Textos que se publican** — reproducen los que el equipo escribe hoy a mano, emojis
incluidos. `componerTextoOferta()` en `_shared/oferta.ts` genera "OFERTA DISPONIBLE"
(PRODUCTE, PRODUCTOR, MUNICIPI, UBICACIÓ, QUANTITAT, DISPONIBLE, HORARI RECOLLIDA,
MODALITAT, CAUSA, ENVASOS, RESPONSABLE, OBSERVACIONS). Queda pendiente el de "RECOLLIDA
CONFIRMADA" (🚚 con SDA/ENTITAT, DATA i HORA, KG RECOLLITS, KG FALTEN RECOLLIR, Comentaris),
que corresponde al momento de cierre y todavía no está implementado.

## 6ter. Distribución, cierre y panel

**Tres paneles, un mismo dato.** Desde 2026-07-30 la navegación es un **menú lateral plegable**
(§2) cuyo contenido depende del rol (`src/lib/nav.ts`), con rutas propias:

| Panel | Rutas | Qué ve |
| --- | --- | --- |
| **Equip** (`intern`) | `/equip/tauler · ofertes[/:id] · aprovacions · productors[/:id] · entitats[/:id] · missatgeria[/:phone] · **documents** · **albarans[/:id]** · **espigolades/nova[/:id]** · configuracio` | Todo lo que ya existía, más la **cola global de aprobaciones** y la **bandeja de documentos** (§4) |
| **Productor** | `/productor/inici · ofertes · ofertes/nova · ofertes/:id · perfil` | Sus ofertas, su progreso y el **alta con el mismo cuestionario del intake** |
| **Receptor** | `/receptor/mercat · interessos · historic · perfil` | Las ofertas **compatibles con su `tipo_receptor`** (el filtro NO es de cliente: lo aplica la RLS de `excedentes` con la matriz `modalitat_receptor_compat`, §4bis), su interés y su histórico |

Los tres cuelgan de `RequireSessio` y de `/panell`, que es la raíz por rol (§6quater); la raíz `/`
es desde el 31-07-2026 la página pública.

Las pantallas del equipo son **los mismos componentes de siempre** (`Dashboard`, `OffersList`,
`OfferDetail`, `ProducersList`, `EntitiesList`, `RecordDetail`, `ContactList`, `Conversation`,
`Settings`), sin tocar: lo único que cambió es quién los monta y de dónde sale el `id`.

### Doble rol: los paneles se ven todos a la vez (31-07-2026)

Una cuenta puede tener más de un panel —productor y receptor, y también el del equipo—. Hasta hoy el
menú enseñaba **uno cada vez**, con un conmutador en el pie. Ahora los enseña **todos**, uno debajo
de otro, cada uno con su cabecera (`panel.producer` / `panel.receiver` / `app.team`) y separados por
un `SidebarSeparator`. Con **un solo panel la interfaz es idéntica a antes**: sin cabeceras y con el
nombre de la organización arriba, que es el caso de casi todas las cuentas.

El conmutador, además, **no funcionaba**: solo llamaba a `setRolActiu` sin navegar, y el `RoleGuard`
de la ruta en la que estabas lo revertía en el render siguiente. No se notaba porque hasta hoy no
había ninguna cuenta real con doble rol.

**El panel activo se deriva de la URL** (`rolDeLaRuta()` en `src/lib/rols.ts`, inversa de
`rutaArrel()`, comparando el **primer segmento entero**, no un prefijo). Antes era un `useState` que
tres sitios distintos tenían que mantener en fase con la ruta, y se desincronizaba de verdad: cada
`SIGNED_IN` devolvía el panel activo al preferido, así que a una cuenta de doble rol se le vaciaba el
mercado hasta que la guarda lo corregía. Tres consecuencias, todas deliberadas:

- **`RoleGuard` ya no escribe estado durante el render** (era un efecto en render, que React 19
  señala). Y cuando deniega, redirige a **`/panell`**, no a `rutaArrel(rolActiu)`: con el rol
  derivado, ese destino sería la propia ruta denegada y la pantalla se quedaría **en blanco sin
  ningún error**. `/panell` es el único sitio que no pertenece a ningún panel.
- **Las pantallas declaran qué organización quieren** con `useOrganitzacio('productor'|'entidad')`,
  en vez de heredar la del panel activo. Invierte el contrato: una pantalla de productor ya no puede
  acabar leyendo la ficha de la entidad porque el panel activo fuera otro.
- **`PerfilOrganitzacio` recibe el tipo por prop y las dos rutas llevan `key`.** Es la misma pantalla
  en `/productor/perfil` y `/receptor/perfil`, y react-router no pone `key` a rutas de la misma
  forma: React reutilizaba la instancia. Al saltar de una a otra cambiaban la tabla y los campos pero
  **la fila seguía siendo la anterior**, así que pulsar «Desar» en esa ventana sobrescribía la ficha
  de la entidad con la dirección del productor y vaciaba cinco campos. Con el conmutador roto era
  casi inalcanzable; el menú unificado lo habría puesto a un clic.

**En móvil la barra inferior sigue enseñando solo el panel de la URL** (8 secciones no caben en 5
huecos); el menú lateral deslizante los enseña todos. Y los **contadores** del menú dependen ahora de
*tener* el panel de equipo, no de estar mirándolo: si no, los badges quedarían en blanco justo cuando
avisan de algo. De paso, la consulta —que se trae todos los `wa_messages`, deuda §12.5— deja de
relanzarse cada vez que se cruza de panel.

**El productor publica con el mismo cuestionario que el bot**, y no por copia: el formulario pide el
descriptor a `GET /functions/v1/crear-oferta/campos`, que lo sirve desde `_shared/camposOferta.ts`,
el mismo módulo del que el intake saca sus pasos. El alta llama a `POST /crear-oferta`, que reutiliza
`crearExcedente()` de `_shared/oferta.ts`: **un solo sitio genera `id_excedente` y `texto_oferta`**.
`authenticated` no tiene INSERT sobre `excedentes`, así que el correlativo no es falsificable.

**El receptor muestra interés** con la RPC `manifestar_interes()`, que deja la fila de
`oferta_respuestas` igual que el diálogo de WhatsApp (`acceptada` + `aprovacio='pendent'`, con
`canal='panel'`): **cae en la misma cola** que el equipo ya aprueba desde `OfferDetail`, con su
Realtime ya cableado.

Navegación anterior (barra superior de 6 secciones en `App.tsx`): retirada. **Configuració** (`Settings.tsx`)
reúne el interruptor del **modo test** (§8) y el idioma. El **Dashboard** (`Dashboard.tsx`) es la
landing tras el login: guía del proceso (los 4 momentos), KPIs agregados (ofertas por estado
—incluidas `cancelada`—, kg canalizados/pendientes, productores/entidades y cuántos pueden
recibir por estar en la lista Meta, mensajes recibidos/sin contestar, sesiones de intake) y el
**gestor de la lista de test de Meta**. `OffersList`, `ProducersList` y `EntitiesList` llevan
**buscador**; `ProducersList` **y** `EntitiesList` separan en dos grupos —primero los usuarios de
prueba (`es_test`, badge "Test", pueden recibir), luego el resto—. Mensajería muestra la lista
completa de contactos (ya no la conversación única), con **buscador** bajo el título «Contactes»,
un **filtro por tipo** (Tots / Productors / Receptors: clasifica cada contacto cruzando su teléfono
—normalizado a solo dígitos— con `productores.phone` y `entidades.telefono`; un doble-rol sale en
ambos), filas compactas (nombre y teléfono en una línea) y **orden por pendientes** (los contactos
con mensajes sin contestar arriba, con contador). La columna de contactos queda **fija** con scroll
interno propio (no scrollea la página). Desde la cabecera de la conversación se puede **borrar el
hilo entero** (papelera): elimina los `wa_messages` del contacto y su `wa_contact` (si vuelve a
escribir, el webhook lo recrea; §4). Layout responsive (§2).

**CRUD de productores y entidades.** Cada listado tiene, por fila, «Detalle» y «Enviar
mensaje», y en la cabecera «Nuevo/Nueva». «Detalle» abre `RecordDetail`, una ficha a pantalla
completa (como el detalle de oferta) con **todos los campos editables**; guarda (insert/update),
borra (con confirmación) y puede abrir la mensajería con el teléfono de la ficha. `RecordDetail`
es **genérico**: recibe las definiciones de `src/lib/crudCampos.ts` (`PRODUCTOR_CAMPOS` /
`ENTIDAD_CAMPOS`) y la tabla destino. Necesita los GRANT/RLS de escritura del §4. «Enviar
mensaje» (en listado y ficha) asegura el teléfono como `wa_contact` y abre Mensajería, tanto
para productores como para entidades.

**Envío de la oferta y feedback.** Los botones **«WhatsApp»/«Correu»** del detalle son **siempre
clicables** (rollover) y **cada clic da un toast**: enviado, o el motivo exacto (sense telèfon/correu,
opt-in, `es_test` amb mode test, finestra tancada). El gate `es_test` del **cliente** ahora **respeta
`test_mode`**: con el modo test apagado (producción) se puede enviar a cualquier entidad; el servidor
lo revalida (§8). ⚠️ `OfferDetail` toma ese `test_mode` del `modo_test` que devuelve
`priorizar-entidades` (no de `getTestMode()`, que sí usan otras pantallas). El envío intenta primero el **texto de la oferta**
(`texto_oferta`) dentro de la ventana de 24 h (gratis). Si el servidor responde `window_closed`, se
**ofrece enviarla como plantilla `oferta_excedent`** (acción explícita en el toast, porque tiene
coste), única vía de Meta para llegar a un receptor que no ha escrito: `enviarOfertaPlantilla` asegura
el `wa_contact`, construye los `components` con `construirComponentsOferta` (`src/lib/ofertaTemplate.ts`,
mapeo de `plantillas-meta.md §1`) y envía `type:'template'`. Está tras el flag
**`PLANTILLA_OFERTA_APROVADA`** (`src/lib/plantillas.ts`, hoy `false`): mientras esté apagado, el
toast avisa honestamente de que hace falta la plantilla aprobada + número de producción; el envío por
plantilla real se activa poniendo el flag a `true` cuando Meta la apruebe (§12.2). **Mensajería** también
confirma el envío de la salutació/plantilla (toast de éxito) y **bloquea reenvíos ~30 s** («Enviada ✓»),
para no duplicar plantillas de pago.

**Aceptación y aprobación de la oferta (panel).** Cada envío desde `OfferDetail` (WhatsApp o email)
deja una fila `pendent` en `oferta_respuestas`. La entidad que responde por WhatsApp la actualiza sola
mediante el diálogo (§5) —con `kg_solicitados` y `preu_ofert`— y el detalle lo refleja **en vivo**
(Realtime) en «Respostes de les entitats», con badge de `estado` **y** de `aprovacio`. El técnico puede
**marcar a mano** acceptada/rebutjada (imprescindible para el email, sin respuesta automática). Para una
fila `acceptada` pendiente de aprobar, el **superadmin** ajusta kg/preu y pulsa **«Aprovar i
canalitzar»**: se crea la `canalización` (`kg_confirmados`), se enlaza (`canalizacion_id`) y el
excedente avanza a `parcial`/`bloqueada` (misma regla que el alta manual); o **«Rebutjar»** con motiu.
Si los kg superan los que **faltan** por cubrir, pide **confirmación** (aviso no bloqueante, igual que
el alta manual): evita canalizar de más sin querer, pero permite hacerlo si es intencionado. Hoy
cualquier `authenticated` puede aprobar (no hay roles; §12). La aprobación/canalización necesita las
políticas de escritura de `canalizaciones`/`excedentes` (§4; se añadieron en
`20260724100000_…`, antes fallaba con «row-level security policy»).

**Copiar el texto de la oferta** escribe al portapapeles `text/plain` (con `\n`) **y** `text/html`
con **cada línea en su propio `<div>`** (`textoAHtmlPortapapeles`): así los saltos se conservan al
pegar en WhatsApp, correo o documentos. Un único `<div>` con `<br>` no basta: WhatsApp lo aplana al
pegar. El **composer del chat** (`Conversation`) es un `<textarea>` multilínea (`field-sizing`
crece con el contenido): conserva los saltos al pegar; **Enter envía**, **Shift/Alt+Enter** inserta
salto de línea.

**Primer contacto / salutació.** El botón de `Conversation` hace dos cosas según la ventana de
24 h: si está **abierta**, envía el **texto de salutació** en català con «respon OK» como texto
libre (`textoSalutacio`, `src/lib/plantillas.ts`) —así en pruebas se ve el mensaje real sin
depender de la aprobación de Meta—; si está **cerrada**, envía una **plantilla** por rol
(`plantillaPrimerContacte`): en test siempre `hello_world` (la única aprobada, contenido fijo en
inglés), en producción `salutacio_entitat`/`salutacio_productor` cuando `PLANTILLES_CA_APROVADES=true`.
En la consola una plantilla se registra con su **texto legible** si está en el mapa
`TEXTO_PLANTILLA` (`_shared/whatsapp.ts`); hoy ese mapa **solo cubre `hello_world`**, así que
`salutacio_*` y `oferta_excedent` caerían al fallback `[plantilla: nombre]` — al aprobarlas hay que
darlas de alta ahí (§12.2). Contenido de las plantillas en `_shared/plantillas-meta.md` (§12).

**Cancelar / anular una oferta ya creada.** `OfferDetail` ofrece dos acciones de anulación:
«Marcar como no colocada» (no se encontró destino, exige motivo) y «Cancelar oferta»
(estado `cancelada`). Un intake a medias no llega aquí: al cancelar se borra la sesión sin
crear excedente. Las ofertas `cancelada`/`cerrada`/`no_colocada` salen del listado de activas y
se cuentan en el Dashboard.

**Cabecera del detalle.** `OfferDetail` muestra en la cabecera la **modalitat**
(Donació/Venda/Maquila, claves `od.mod_*`) y, en `venda`/`maquila`, el **preu mínim** (€/kg). El
campo «Disponible fins» es un input de fecha **controlado** que arranca con la fecha parseada por el
intake (§6bis) y persiste al editar (se re-sincroniza con `exc.disponible_hasta` tras recargar).

**Priorización** (`priorizar-entidades` + `_shared/priorizacion.ts`, función pura). Dado un
excedente, ordena las entidades candidatas. Pesos: misma área +3 (mismo municipio +2 extra);
`transport_plataforma` +1 y `descarrega_toro` +1 (peso doble si `kg_total > 500`); producto
fresco + entidad que acepta frescos +2; `prioritat` suma `max(0, 3 - prioritat)`. Sobre el
`estat` (6 valores reales, no 2): `Signat` puntúa arriba; las tres variantes `Pendent*` van al
final con aviso; `No procedeix` y sin estado se **excluyen**. Sin `opt_in` no se excluye, se
marca (no se le puede enviar por API). Sobre ese ranking, `OfferDetail` aplica un **reorden de
presentación estable**: primero las **contactables**, sin tocar la puntuación del servidor; y añade a
la línea de motivos «No és usuari de prova» en las que no lo son, para que se vea *por qué* el botón
está gris. ⚠️ La condición real de «contactable» es `(!testMode || es_test) && canal !== 'cap'`
(`OfferDetail.tsx`): se apoya en el `canal` que decide el servidor (§8bis), no en opt-in+teléfono/email
por separado, y con el modo test **apagado todas** son contactables. El `testMode` sale del `modo_test`
que devuelve `priorizar-entidades`, no de `getTestMode()`.

**Opt-in de entidades**: las 111 tienen `opt_in=false`. Se marca a mano con un toggle en el
detalle (mecánica de PoC). En producción se combinará con el ALTA por WhatsApp.

**Canalizaciones**: el panel registra kg por entidad; al cubrir `kg_total` el excedente pasa a
`bloqueada` y se ofrece copiar "RECOLLIDA CONFIRMADA". El cierre registra `kg_reales` (marca si
difieren) y genera el albarán (plantilla con placeholders, `src/lib/textos.ts`).

**No colocadas**: manual desde el panel (motivo obligatorio) o automático por el **job de
vencidas** (`pg_cron`, `marcar_excedentes_vencidos()`), que marca `no_colocada` los excedentes
con `disponible_hasta` vencida >24 h y kg sin cubrir. Ahora el intake **rellena** `disponible_hasta`
cuando la respuesta es una fecha reconocible (§6bis); si no lo es, queda `null` y el job no actúa
hasta que el panel la normalice.

## 6quater. Parte pública, accesos separados y registro (31-07-2026)

Hasta hoy **no existía ninguna página pública**: `AuthGate` envolvía el router entero, así que
cualquier URL enseñaba el login del equipo («Consola Redestina · accés restringit a l'equip») y el router
ni se montaba sin sesión. Eso servía cuando los únicos usuarios eran tres personas del equipo; con
paneles de productor y de receptor deja de servir, porque no hay dónde explicar qué es Redestina ni por
dónde entra alguien que todavía no tiene cuenta.

### La composición se invierte

```text
App.tsx   SessioProvider            sesión cruda (¿hay token?) + evento PASSWORD_RECOVERY
            └─ RouterProvider
router    ArrelApp                  si esRecovery → /restablir, desde cualquier ruta
            ├─ públicas   /  /login  /admin  /registre  /restablir
            ├─ RequireSessio         monta AppContextProvider SOLO con sesión confirmada
            │    ├─ /panell (raíz por rol)  ·  /sense-acces
            │    └─ AppShell → /equip  /productor  /receptor
            └─ *  → /
```

**Por qué dos contextos y no uno.** `useSessio` (nuevo) solo dice si hay token; `useAppContext` dice
quién eres, y tiene un fallback (`contextDegradat`) que **simula equipo interno** cuando la RPC de
sesión falla. Ese fallback es correcto dentro de la aplicación y catastrófico fuera: montarlo sin
sesión regalaría el panel del equipo a cualquiera que abriera la web. Por eso `AppContextProvider`
vive **dentro** de `RequireSessio` y no puede alcanzarse de otra manera.

| Ruta | Qué es |
| --- | --- |
| `/` | **Landing pública** (`routes/public/Landing.tsx`): hero, «Com funciona» (los 4 momentos, con copy propio `land.*`), «Per a qui» y pie. Con sesión redirige a `/panell` |
| `/login` | Acceso de **productores y entidades**, con enlace al registro y los accesos de prueba |
| `/admin` | Acceso del **equipo**, con el copy de siempre. **No se enlaza desde lo público** |
| `/registre` | Alta self-service por rol (§9) |
| `/restablir` | Contraseña nueva tras un enlace de recuperación |
| `/confirmar/:token` | **Confirmación de un albarán sin sesión** (fase 3). Móvil primero: se abre desde una finca. Lo que autoriza es el token, no una cuenta (§9) |
| `/panell` | Lo que antes era `/`: manda a cada cual a su panel |

⚠️ **`/admin` no está enlazado, pero eso no es una protección.** Quien conozca la URL ve el mismo
formulario; lo que protege el panel del equipo son `RoleGuard` y las políticas de la base, no el
secreto de la ruta.

⚠️ **Los enlaces de recuperación y los mágicos aterrizan en `/`** (`redirectTo = APP_URL`) y
supabase-js consume los tokens del hash en cualquier ruta. Desde que la raíz es pública, quien
captura el evento `PASSWORD_RECOVERY` es `ArrelApp`, que desvía a `/restablir`. Si algún día se
cambia `APP_URL`, hay que revisar esto **y** la allow-list de Auth (§10).

**Deep-link**: antes la URL nunca cambiaba (el login se pintaba encima). Ahora `RequireSessio`
guarda la URL pedida en `location.state.from` y las dos pantallas de acceso vuelven a ella al
entrar; si la cuenta no tiene ese panel, `RoleGuard` la recoloca como siempre.

### Accesos directos a las cuentas de prueba

`/login` muestra, bajo el formulario, un botón por cuenta de prueba agrupado en **Fitxes reals de
l'equip** / Productors / Receptors (`src/lib/accessosTest.ts` +
`components/AccessosTest.tsx`): un clic abre sesión. Cada botón lleva **el nombre de la organización
en grande y qué es debajo, en pequeño** —es el nombre lo que identifica la cuenta al elegir, no su
tipo—.

El primer grupo va primero a propósito: es el único con el que se puede ejercitar el producto entero,
porque son las únicas fichas con móvil verificado en Meta. Su título no dice «WhatsApp» ni «doble
rol» porque **ninguna de las dos cosas es cierta para las cinco** —Anna Garreta solo tiene ficha de
entidad, y Laura Masdeu no tiene teléfono—; la excepción de cada una va en su propia etiqueta.

**No hay grupo «Control».** La cuenta sin rol y la del registro pendiente se retiraron el 31-07-2026:
son estados del sistema, no organizaciones con las que alguien quiera entrar a mirar, y ocupaban
sitio en la puerta de acceso. El caso pendiente se reproduce dando de alta cualquier organización
desde `/registre`.

Dos límites que **no se pueden relajar**:

1. **Ninguna cuenta con rol de plataforma.** Las de equipo (`hola+superadmin`, `hola+equip` y las
   tres reales) no están ni pueden estar: ven las 452 fichas con nombre, NIF, teléfono y dirección.
   El primer grupo sí enseña **fichas de personas reales del equipo**, pero por cuentas *externas*
   creadas aparte (§9), así que cada una ve solo la suya. Se aceptó explícitamente: es contacto
   profesional del propio equipo, no de los 345 productores externos.
2. Todo el bloque va tras la variable de build **`VITE_ACCESSOS_TEST`** (§10). Con ella apagada,
   Vite pliega la constante a `false`, el `&&` queda en código muerto y el módulo con las
   contraseñas **se cae del bundle**. Verificado con `grep` sobre `dist/`, no por confianza: la
   contraprueba con el flag encendido sí las encuentra.

### Aprovacions: dos colas

`src/routes/equip/Aprovacions.tsx` tiene ahora **«Registres pendents»** (altas del registro público:
`membresias` con `aprovacio='pendent'`, embebiendo la ficha, más una segunda consulta a `perfiles`
—`membresias.user_id` referencia `auth.users`, no `perfiles`, así que PostgREST no los embebe) y la
cola de respuestas a ofertas de siempre. Cada fila enlaza a la ficha para poder **completarla antes**
de aprobar (una entidad nueva llega con `estat = null` y hasta que se rellene no entra en la
priorización). Los botones llaman a `aprovar_registre` / `rebutjar_registre` (§4bis). El contador del
menú (`AppShell`) **suma las dos colas**.

## 7. Convenciones

- **Teléfonos**: E.164 **sin** `+`, solo dígitos → `34612345678`. Validación en el frontend:
  `/^[1-9]\d{6,14}$/`. El `+` se añade solo al *mostrar*. Móviles españoles = `346…`/`347…`.
- **Endpoint de Meta**: `https://graph.facebook.com/{WHATSAPP_API_VERSION}/{PHONE_ID}/messages`.
  La versión se lee del entorno (default `v23.0`), no está hardcodeada.
- **Idioma**: la **interfaz es bilingüe català/castellà** (sistema i18n propio en
  `src/lib/i18n.tsx`: `useT()`, diccionaris `ca`/`es`, **per defecte `ca`**, selector a la barra
  superior, preferència a `localStorage`). Els textos de la interfície viuen com a **claus**
  (p. ex. `nav.offers`, `f.email`); les etiquetes de camps del CRUD també (`crudCampos.ts` guarda
  claus `f.*`). Els **comentaris del codi** en castellà; els **missatges de WhatsApp**, en català
  (no passen per i18n). Identificadors en inglés salvo los del dominio (`productores`, `entidades`,
  `excedentes`, `canalizaciones`).
- **Secretos**: nunca en el código. Env vars, siempre.
- **Sin servicios externos nuevos** (10-09-2026). Cualquier capacidad nueva —generación de PDF, firma
  electrónica, almacenamiento de ficheros, colas, notificaciones— se resuelve con **librerías npm dentro
  del stack** (Edge Functions de Deno con `npm:`, React) y con lo que ya da Supabase (Storage, `pg_cron`,
  `pg_net`), nunca con un SaaS ni con un microservicio aparte. Los PDF se generan con `pdf-lib` en una
  Edge Function y van a Supabase Storage, en **una carpeta por organización** ordenada por ejercicio y
  tipo. Detalle en el plan de ejecución del sistema documental (§1).
- **Ejecución por fases con agentes** (10-09-2026). Los bloques de desarrollo del sistema documental
  se reparten entre los tres agentes de `.claude/agents/` —`dades` (migraciones, RPC, arnés),
  `servidor` (Edge Functions) e `interficie` (pantallas)— sobre **ficheros disjuntos del mismo árbol de
  trabajo**, sin worktrees ni ramas (se trabaja siempre en `main`). Los ficheros compartidos
  (`config.toml`, `src/types.ts`, `nav.ts`, `router`, `i18n.tsx`, `_shared/*.ts` salvo `pdf/`, este
  documento) los toca solo la sesión que orquesta. Todos en **Opus 5 a esfuerzo alto**.
- **`docs/` y `scripts/data/` nunca entran en git.** El primero es material de trabajo —incluye el
  **funcional de negocio** (`Documento funcional Redestina 2026.md` y `Documento funcional Redestina 2026 —
  adaptado.md`, resumidos en §1bis), `nuevas-funcionalidades/` y los seis documentos operativos
  de §1 (guía de producción de WhatsApp + su HTML visual, costes, flujo de la aplicación y los dos
  de **usuarios, con contraseñas en claro**)—; el segundo son datos personales
  (teléfonos, emails y NIF de ~450 personas y entidades). `.env.local.example` sí se versiona: es la
  plantilla, sin valores.
  **`.claude/settings.local.json` tampoco**: lleva rutas de esta máquina (el
  `additionalDirectories` de la carpeta de consultoría, §1). Lo ignoraba solo el `~/.config/git/ignore`
  del usuario, que no viaja con el repo; desde el 10-09-2026 la regla está también en el `.gitignore`
  propio, para que un clon en otra máquina no lo suba sin querer. **Ni `.claude/launch.json`**, que
  lo genera el panel de navegador al arrancar `npm run dev` y fija el puerto de esta máquina.
- **Claves de Supabase**: usar las **nuevas** — `sb_publishable_...` en el frontend,
  `sb_secret_...` en el servidor. **No** usar las obsoletas `anon`/`service_role` (claves JWT
  antiguas). Los *roles* de Postgres `anon`/`authenticated`/`service_role` sí se siguen usando
  en RLS: no confundir rol con clave.
- **Errores**: `sendWhatsApp()` nunca lanza; devuelve `{ ok, status, data }`. El mapeo a texto
  legible vive en `noticeFromError()` (`Conversation.tsx`), que cubre los códigos propios
  (`window_closed`, `no_opt_in`, `unknown_contact`, `unauthorized`) y el `131047` de Meta.
- **La lista de columnas de un `.select()` va en UN literal**, nunca concatenada ni interpolada.
  supabase-js deduce el tipo de la fila analizando ese literal; ante una expresión devuelve
  `GenericStringError` y la fila se queda sin columnas, con lo que todo uso posterior deja de
  compilar. Si la lista es larga, que la línea sea larga (deuda §12.46).
- **Migraciones**: `supabase/migrations/AAAAMMDDHHMMSS_descripcion.sql`. Nunca editar una ya
  aplicada; añadir una nueva.
- **Puertos del Supabase local**: este proyecto usa el rango **553xx** (API 55321, BD 55322,
  Studio 55323…), desplazado respecto al 543xx por defecto. En esta máquina conviven varios
  stacks de Supabase a la vez y el rango por defecto está ocupado por otros proyectos; con
  los puertos propios, `supabase start` levanta este entorno **sin parar los demás**. Si
  añades un servicio nuevo a `config.toml`, dale también un puerto 553xx libre.

## 8. Reglas de negocio

> ⚠️ **Envío real ACTIVADO en remoto** (`WHATSAPP_ENVIO_REAL=true`, 2026-07-22). El interruptor
> (env var) gobierna el único punto que llama a la Graph API (`enviar()` en `_shared/whatsapp.ts`):
> solo si vale exactamente `"true"` sale algo. En remoto ya lo está, así que **sí se contacta con
> Meta**; en local, sin el secreto, se **simula** (`status='simulat'`). Lo que evita el desastre en
> remoto es que el número **sigue en el entorno de test de Meta**: Meta solo entrega a los ≤5
> verificados (los de `meta_test_recipients`); el resto lo rechaza con `131030`. **Aviso: si el
> número pasa a producción con el interruptor en `true`, enviaría a TODOS** — revisar lista y flujo
> antes. Afecta a TODO: intake, recordatorios, ALTA/BAJA y ofertas a entidades. Para volver a
> simular: `supabase secrets set WHATSAPP_ENVIO_REAL=false`. El webhook siempre recibe.

**Reglas de envío** (decisión D1 del manual; implementadas en `whatsapp-send`; se evalúan
antes del interruptor de arriba, así que en modo PoC un envío bloqueado por regla ni siquiera
llega a simularse):

| Tipo | Condición | Si no se cumple | Por qué |
| --- | --- | --- | --- |
| `text` | ventana de 24 h abierta (`last_inbound_at` < 24 h) | `409 window_closed` | Es una respuesta de servicio; **no** requiere opt-in |
| `template` | `opt_in = true` | `403 no_opt_in` | La iniciamos nosotros: requiere consentimiento (RGPD + Meta) |

Contacto inexistente → `404 unknown_contact`. Sin sesión válida → `401 unauthorized`.

⚠️ **Orden real de las comprobaciones en `whatsapp-send`**: los gates `403` van **antes** que el
`404`/`409` de esta tabla. Secuencia: `exigirEquipo` (`401`) → validación de campos (`400`) → gate
`es_test` (`403 no_test_user`) → gate `meta_test_recipients` (`403 no_test_recipient`) → contacto
inexistente (`404`) → ventana/opt-in (`409`/`403`). Un destinatario existente pero no-test recibe
`403`, nunca llega al `404`.

**Modo test global + gate `es_test`** — **fuente de verdad de la app** para permitir el envío,
**independiente de la fase de Meta**. Un interruptor global, **`app_settings.test_mode`** (default
`'true'`, editable desde **Configuración**, §6ter), decide si se aplica el gate: con el **modo test
ACTIVADO** solo se envía a los usuarios `es_test`; **apagado**, a todos (producción). `es_test` (bool en
`productores` y `entidades`, `20260723110000_es_test.sql`) marca quién puede recibir; se edita por ficha
(CRUD) y decide los listados y los botones del panel. El gate vive en `_shared/gate.ts` (`modoTestActivo`,
`esTelefonoTest`, `esEmailTest`, `esCuentaPermitida`) y se aplica en **seis** sitios: el **webhook** (no
responde a quien no sea `es_test`), **whatsapp-send** y **enviar-email** (`403 no_test_user`),
**intake-recordatorios** (salta a los no-test) y —desde el 30-07-2026— **`enviar-acceso`** y
**`recuperar-password`**. Cubre **todo**: ofertas, intake, recordatorios, ALTA/BAJA, accesos y resets, por
WhatsApp y correo.
**Fail-safe**: si `test_mode` falta o no se puede leer, se trata como ACTIVADO (no se envía a no-test).
Sobrevive al paso a producción de Meta: al vaciar `meta_test_recipients`, el modo test sigue filtrando.
Se arrancó con `test_mode='true'` y `es_test=true` a quienes ya estaban en las whitelists. Solo el
`super_admin` puede togglear `test_mode` (§4bis): apagarlo es sensible y la UI pide confirmación.

⚠️ `esEmailTest` mira **productores y entidades** (antes solo entidades): con el correo como canal por
defecto (§8bis), mirar solo una tabla dejaba sin poder recibir nada a un productor de prueba sin WhatsApp.

**Gate de cuenta** (`esCuentaPermitida`) — los correos de **acceso** y de **recuperación de contraseña**
no van a un productor ni a un receptor, sino a alguien con credenciales de la plataforma, así que `es_test`
no les aplica directamente. Con el modo test activo pasa quien sea **equipo interno** (tiene fila en
`usuario_roles`) **o** esté vinculado por `membresias` a una organización `es_test`. El equipo interno pasa
siempre **a propósito**: dejarlos sin poder recuperar su contraseña los bloquearía fuera de la aplicación
que administran, y para recibir algo hay que tener ya una cuenta con un rol concedido a mano.
`recuperar-password` es **pública** (`--no-verify-jwt`), así que sin este gate cualquiera podría provocar
un correo nuestro a cualquier dirección con cuenta; sigue respondiendo el 200 genérico de siempre, que no
revela si el correo existe ni si pasó el gate.

**Barrera del modo prueba de un documento** (`destinatariosPrueba` en `_shared/gate.ts`, fase 4) —
con `documentos.modo = 'prueba'` solo pasan las direcciones de una organización `es_test` y el buzón
`parametros_documentales.email_equipo`, **aunque `test_mode` esté apagado**. Y esa es toda la
cuestión: el modo test global se apaga el día que Redestina sale a producción, pero los cierres de
prueba se siguen ensayando **cada diciembre**, así que un resumen o un certificado de ensayo no
puede llegar nunca a un donante real. Es la **segunda** barrera —`cierre_destinatario()` en SQL ya
elige a quién se escribe—, y su fail-safe es el de siempre: si no se puede leer el buzón del equipo,
esa dirección se bloquea.

**Gate de la lista de test de Meta** (segunda barrera, requisito técnico del entorno de test): si
`meta_test_recipients` tiene alguna fila y el destinatario **no** está en ella →
`403 no_test_recipient`. Si la tabla está **vacía**, no restringe (§4). Es defensa en
profundidad: la UI ya desactiva el botón, pero el servidor corta aunque la UI fallara. Es
**independiente** del interruptor `WHATSAPP_ENVIO_REAL`: el gate limita **a quién** se podría
enviar; el interruptor, si sale **algo** (hoy, no).

Consecuencia práctica: se puede responder a cualquiera que escriba espontáneamente aunque no
tenga opt-in, pero no iniciar una conversación sin consentimiento.

## 8ter. Cuando Meta rechaza un envío

**Un envío rechazado por Meta se registra igual**, con `wa_messages.status = 'error'` y el error de
la Graph API en `raw` (`registrarFallo()` en `_shared/whatsapp.ts`). La conversación lo pinta en rojo
con «NO ENVIAT ⚠️». El `wa_message_id` es sintético (`err-…`) porque Meta no devuelve wamid al
rechazar y la columna es UNIQUE.

**Por qué existe esto** (31-07-2026): los cuatro `sendX` registraban el saliente solo `if (r.ok)`.
Cuando Meta empezó a rechazar todos los envíos, en la consola no aparecía **nada**: ni el mensaje ni
un aviso. Desde el panel era indistinguible de «no ha pasado nada», así que el fallo se detectó
porque una persona notó que el bot no contestaba, no por el sistema. El síntoma característico de
esto es **entrantes que se registran y cero salientes**: el webhook funciona, lo que falla es la
salida.

### Diagnóstico: `scripts/diagnostico-whatsapp.ts`

```bash
WHATSAPP_TOKEN='EAA…' WHATSAPP_PHONE_ID='…' deno run -A scripts/diagnostico-whatsapp.ts
```

Interroga a la Graph API y distingue las tres causas que desde la app se ven iguales: token
caducado, número que ya no es accesible, o permisos de la app. Lo importante es **qué código
devuelve Meta**:

| Error de Meta | Qué significa | Qué hacer |
| --- | --- | --- |
| `190` (OAuthException) | El **token** ya no vale (caducado o revocado) | Generar uno nuevo → `supabase secrets set WHATSAPP_TOKEN=…` |
| `100` subcode `33` | El token **sí** vale, pero no puede acceder a ese `phone_id`: el número cambió de WABA, la app perdió permiso, o el `phone_id` configurado ya no es el bueno | Comparar con la lista de números del punto 3 del script |
| `131030` | El destinatario no está en los ≤5 verificados del entorno de test | `meta_test_recipients` (§4) |
| `131047` | Ventana de 24 h cerrada | Solo cabe plantilla aprobada (§12.2) |

⚠️ Tras cambiar cualquier secreto hay que **redesplegar** las funciones que lo leen (`whatsapp-send`,
`whatsapp-webhook`, `intake-recordatorios`): los secretos se inyectan en el arranque.

## 8bis. Canal preferente: el correo es el canal por defecto

**Regla (2026-07-30):** WhatsApp solo se usa cuando de verdad se puede; en cualquier otro caso, **correo**.
Nadie se queda sin recibir una oferta porque su ficha no tenga WhatsApp o no lo haya aceptado nunca — y
eso son casi todos: de 345 productores, 61 no tienen móvil utilizable, y las 111 entidades importadas
tienen `opt_in = false`.

Vive en **`_shared/canal.ts`**, función **pura y sin red** (mismo criterio que `priorizacion.ts`):

| Situación | Canal |
| --- | --- |
| Móvil **y** ventana de 24 h abierta | **WhatsApp** (texto libre, gratis, consentimiento implícito: nos acaba de escribir) |
| Móvil **y** `opt_in = true` | **WhatsApp** (plantilla; fuera de ventana es lo único que entrega Meta) |
| Sin teléfono · teléfono fijo · sin opt-in y ventana cerrada | **Correo** |
| Ni móvil útil ni correo | **ninguno**, y el panel lo dice para que se complete la ficha |

`esMovil()` descarta los fijos españoles (`34` + algo que no sea `6`/`7`): son 6 en el import de ARA y no
reciben WhatsApp. Fuera de España no se puede saber por el prefijo, así que se acepta: más vale intentarlo
y que lo rechace Meta que descartarlo por nuestra cuenta.

**La organización puede DECIR su canal** (`organizaciones.canal_preferido`, desde la etapa 1 de la
organización unificada). `decidirCanal()` lo recibe **por parámetro** —el módulo sigue siendo puro y
sin red; quien lee la tabla es `_shared/organizacion.ts`— y lo respeta **cuando el canal pedido es
viable**. ⚠️ Una preferencia **no es un permiso**: pedir WhatsApp no abre la ventana de 24 h ni
sustituye al opt-in (son requisitos de Meta, no gustos), así que si no se puede se cae al otro canal
y la decisión lo dice con `preferenciaRespetada: false` — el panel y los logs lo enseñan, porque una
preferencia ignorada en silencio es peor que no tenerla. `null` = deducir como siempre, que es el
caso de las 464 fichas de hoy. Lo aplican `priorizar-entidades` (por entidad: `canal_preferit`,
`preferencia_respectada`) y `enviar-acceso` (`canal: 'auto'`, por la organización de la cuenta); se
escribe con `actualizar_meu_canal()` desde el perfil (§4bis).

**Quién PUEDE recibir (§8, `es_test`) y POR DÓNDE (esto) son cosas distintas y se aplican las dos.** Hoy,
con el modo test activo, la política de canal solo llega a alcanzar a los usuarios `es_test`.

**Lo decide el servidor, no el panel.** `priorizar-entidades` devuelve por entidad `canal`, `motiu_canal`,
`whatsapp_possible`, `email_possible`, más `email`, `es_test` y el `modo_test` global; `OfferDetail` los
pinta y los obedece, sin recalcular nada (antes tenía su propia heurística, que podía discrepar de lo que
haría el servidor al enviar). El botón **«Enviar»** usa el canal recomendado y **cae al correo si WhatsApp
falla**; los botones «WhatsApp» y «Correu» siguen ahí para forzar uno. `enviar-acceso` acepta
`canal: 'auto'` (el valor por defecto) con la misma política y el mismo respaldo.

**El intake conversacional ocurre siempre dentro de la ventana** (la abre el productor al
escribir), así que no necesita plantilla ni opt-in.

**Proceso de canalización** — cuatro momentos: entrada de oferta (intake) → distribución
(priorizar entidades y avisarlas individualmente) → confirmación (bloqueo al cubrir los kg) →
cierre real (kg reales, albaranes, o marcar `no_colocada` con motivo).

**Valoración**: `valor_eur = kg × productos.eur_kg` (hoy plano a 1 €/kg).

## 9. Seguridad y autenticación

**Todo DATO exige una sesión de Supabase Auth.** Ya no hay lectura anónima: el
`PasswordGate` cosmético se sustituyó por un login real con `signInWithPassword`, las políticas RLS
y los GRANT pasaron de `anon` a `authenticated`, y `whatsapp-send` valida el JWT del usuario.

Desde el 31-07-2026 **hay páginas públicas** (landing, los dos accesos, el registro; §6quater), pero
eso no abre ningún dato: `anon` sigue sin un solo privilegio de tabla, y lo público es HTML estático
más dos Edge Functions con sus propios controles (`recuperar-password` y `registro`).

| Pieza | Cómo se protege |
| --- | --- |
| Datos (PostgREST) | RLS + GRANT sobre `authenticated`. `anon` no tiene ningún privilegio: responde `42501 permission denied` |
| **Rol y organización** | Tablas `usuario_roles` y `membresias` (§4bis). El rol **no viaja en el JWT**: se consulta en cada política, así que desactivar una cuenta corta el acceso al instante en vez de esperar a que caduque el token |
| **Edge Functions con JWT** | `exigirEquipo()` de `_shared/autorizacion.ts` en `whatsapp-send`, `enviar-email`, `priorizar-entidades` y `enviar-acceso`. Hace falta porque corren con `service_role`, que **ignora RLS** (§4bis) |
| `whatsapp-send` | Desplegada **con** verificación de JWT (sin `--no-verify-jwt`) y además comprueba `getUser(token)` |
| `whatsapp-webhook` | Sigue con `--no-verify-jwt` porque Meta no envía JWT; se valida la firma `X-Hub-Signature-256` |
| Alta de cuentas | Admin API (`scripts/crear-usuario.ts`) **o** la Edge Function pública `registro`, que crea la cuenta con la membresía **PENDIENTE**: el acceso real lo concede el equipo al aprobar. `enable_signup` sigue `false` y así debe seguir — la Admin API lo ignora, y así el alta pasa siempre por nuestro código |
| Login | `FormulariAcces.tsx`: `signInWithPassword` + botón «ojo» + «¿olvidaste la contraseña?». Se monta en `/login` (usuarios) y `/admin` (equipo) |
| Recuperar contraseña | Edge Function `recuperar-password` (pública) + Resend; **no** usa el mailer nativo (§ abajo) |

### Correos: ahora sí, pero solo por Resend

Cambió la política del proyecto: el reset de contraseña y el envío de ofertas por email **sí
mandan correo**, pero **siempre por Resend** (nunca el mailer nativo de Supabase Auth, que sigue
apagado y en test). Detalle:

- El **mailer nativo de Auth sigue apagado**: `enable_confirmations=false`,
  `mailer_autoconfirm=true`, cuentas con `admin.createUser({email_confirm:true})` → el **alta no
  envía nada**. Sigue prohibido usar `resetPasswordForEmail()`, `inviteUserByEmail()` o magic
  links (esos disparan el mailer nativo).
- El **reset** usa `admin.generateLink({type:'recovery'})` (Admin API, **no** envía correo por sí
  mismo) y el enlace se manda por **Resend** desde `recuperar-password`. La app detecta el evento
  `PASSWORD_RECOVERY` (en `useSessio`, §6quater) y desvía a `/restablir`. La `redirectTo` (APP_URL)
  debe estar en la allow-list de Auth (Management API, **no** config push; §10).
- **Dominio `espigoladors.com` verificado en Resend** y `RESEND_FROM="Redestina <no-reply@espigoladors.com>"`
  configurado, así que **se envía a cualquier dirección** (verificado el envío a un correo externo).
  Si se cambia de dominio, verificarlo en `resend.com/domains` y ajustar `RESEND_FROM`. El gate
  `email_test_recipients` limita, mientras se está en pruebas, a los correos de esa whitelist.

### Maquetado de los correos — una sola plantilla, en el servidor

**`plantillaEmail()` en `_shared/resend.ts` es el único sitio donde se maqueta un correo**
(2026-07-30). Devuelve el documento completo: cabecera verde con el logo en negativo, tarjeta blanca con título,
cuerpo, botón y nota, filete coral, pie crema y la línea de por qué recibes esto. Está hecho con
**tablas y estilos en línea** —lo único que renderizan igual Gmail, Outlook y Apple Mail—, admite
`preheader` (la línea que la bandeja enseña junto al asunto) y pinta el botón con la técnica de
tabla + `bgcolor`, porque Outlook ignora el `padding` de un `<a>`.

**El logo es `public/logo-email.png`**, el logo negativo rasterizado a 410×120 desde
`logo-redestina-negativo.svg` (se pinta a 150×44): los clientes de correo no pintan SVG, no resuelven
rutas relativas y Gmail bloquea `data:`. Se sirve por URL absoluta desde `APP_URL`. El `alt` del
`<img>` va **estilado** (crema, 26px, bold), así que con las imágenes bloqueadas —lo normal en Gmail
con un remitente nuevo— se sigue leyendo «Redestina» sobre el verde en vez de un icono roto. Si se
cambia de dominio, basta con `APP_URL`. **Los colores del correo son constantes al principio de
`resend.ts`** (`VERDE`, `CREMA`, `CORAL`, `FONDO`, `BORDE`, `TEXTO`, `SUAVE`) copiadas de
`design/tokens.json`: si cambia un token, se cambian ahí (y en `enviar-acceso/index.ts`, que lleva
dos en línea) y se redespliegan las funciones.

⚠️ **`textoAHtml(titulo, cuerpo)` ESCAPA su contenido**: es para texto plano (el `texto_oferta`, el
albarán). Pasarle HTML lo publica como markup literal — pasó con `enviar-acceso` el 30-07-2026 y el
correo llegó enseñando `<p>Hola…</p>`. Para HTML, `plantillaEmail()` directamente.

**El cliente no maqueta.** `enviar-email` acepta un campo opcional **`plantilla`**
(`{ titulo, preheader?, boton?, nota? }`); cuando viene, el `html`/`text` recibido es solo el
*contenido* y el servidor lo envuelve. Sin `plantilla` manda el `html` tal cual (compatible hacia
atrás). Por eso `OfferDetail` ya no construye HTML de correo: pasa `plantilla` y el texto.

### Enlaces de acceso (`enviar-acceso`)

`POST /functions/v1/enviar-acceso { email, canal? }` genera el enlace con
`admin.generateLink({type:'magiclink'})` —Admin API, **no** manda nada— y lo envía por Resend, igual
que `recuperar-password`. Como el `redirectTo` es exactamente `APP_URL`, que ya está en
`uri_allow_list`, **no hay que tocar Auth por Management API** (§ arriba).

**Está restringida al equipo** (`exigirEquipo`: `401`/`403`) y respeta el gate de cuenta (`403
no_test_user` con el modo test activo, §8). `canal` es **opcional y por defecto `'auto'`**: decide con
la política de `_shared/canal.ts` (§8bis), admite `'ambos'`, y ante fallo de WhatsApp **cae a correo**,
devolviendo `motiu_canal`.

**Por correo va el enlace; por WhatsApp, solo el código de 6 cifras.** Un enlace mágico es una
credencial al portador, y `sendText()` guarda el cuerpo en `wa_messages`, que el equipo lee desde
Mensajería: el enlace quedaría publicado en la consola. Por eso `sendText()` acepta `bodyConsola`,
que redacta lo que se registra. El código caduca en 1 hora, es de un solo uso y no sirve sin conocer
el correo.

Límite real del canal WhatsApp (§8): solo llega a números de `meta_test_recipients`, de una ficha
`es_test`, **y con la ventana de 24 h abierta** —fuera de ella solo entran plantillas aprobadas, y
la única que hay es `hello_world`, que no admite variables—. Para el resto de las cuentas, correo.
Mandarlo por WhatsApp de forma general exigiría número de producción y una plantilla de categoría
`AUTHENTICATION` (checkpoint §12.2).

### Subida de la factura del donante (fase 4)

`GET /enlace-publico?t=` con propósito `subida_factura` devuelve el resumen del donante (número,
ejercicio, kg, **importe esperado**, bloqueos, modo y el PDF del resumen firmado 60 s).
`POST { t, accion:'subir_factura', numero, fecha?, importe?, fitxer }` acepta **multipart** o JSON
con `fitxer_base64` (PDF/JPG/PNG, ≤10 MB): sube a la ruta de `ruta_documento(… 'externs' …)` **con
el modo del cierre**, deja la fila en `documentos_externos` (`tipo='factura'`, `origen='enlace'`) y
llama a `registrar_factura()`, que decide `coincident`/`discrepancia`/`factura_rebuda`. Si el
registro falla se borran fichero y fila. Deja evidencia `subida` y **el token se consume**
(reintento → 409). El otro camino es el panel del donante, y los dos resuelven el permiso con
`puc_pujar_document_extern()`.

⚠️ **El DNI de la apoderada y los PNG de firma y sello no viajan en `documentos.datos`**: los lee
`generar-documento` con `service_role` de `parametros_documentales` y del bucket `activos`, y solo
para estamparlos. `documentos.datos` lo lee el donante por `documents_meus()`; meter ahí el DNI
anularía el GRANT por columnas. Para emitir un certificado real hacen falta, además de
`datos_provisionales = false`, el `apoderada_dni`, la `firma_ruta` y el `sello_ruta`.

⚠️ **El resumen anual SÍ lleva importes; los albaranes no.** La regla «ningún importe» es de los
documentos legales de entrega (REC/ENT/OPE), no del resumen: su función es justamente pedirle al
donante una factura por una cifra concreta (anexo B.1).

### Firma de convenios por enlace (fase 2)

`enlace-publico` gana el propósito `firma_convenio` con tres acciones: `firmar`, `enviar_codi` y
`validar_codi`. Es **firma electrónica simple**: lo que la acredita no es el trazo, es la evidencia.

**El texto que se firma lo compone el servidor** (`_shared/pdf/convenio.ts`, el mismo módulo que
imprime el PDF, para que el texto hasheado y el impreso sean el mismo) y su sha256 se **recalcula**
en el POST: nunca se acepta la huella del cliente, y si no coincide, `409 document_canviat`.
⚠️ **La huella cubre el articulado y las dos declaraciones, no los datos que la persona teclea**: si
los cubriera cambiaría con cada tecla y el guardia dejaría de distinguir un cambio real. Lo tecleado
va a `evidencias.payload` y se congela en `convenios.datos_org`. **Precio conocido**: el NIF o el
domicilio que se corrigen al firmar salen luego en el PDF sin estar en esa huella.

El trazo es un PNG que se sube a `<org>/<ejercicio>/evidencies/<enlace>.png` **antes** de llamar a la
RPC, y se retira si esta falla. **El DNI de quien firma vive solo en `evidencias.documento_identidad`**
(§4): no está en `documentos.datos`, así que `sha256_datos` no lo cubre; lo lee `generar-documento`
con `service_role` solo para la página de evidencias.

El segundo factor (6 cifras, 10 min) es **solo** de la firma asistida. `enviar_codi` **manda el
correo antes de escribir `codigo_hash`**: al revés, un fallo de correo dejaría el enlace exigiendo un
código que nadie tiene. En un enlace por correo responde `409 no_cal_codi`.

`registro` acepta los datos del convenio y crea el borrador con su enlace: devuelve el token **solo**
si firma quien registra (misma sesión, misma persona); si firma otra, el enlace queda esperando y lo
envía el equipo, porque `registro` sigue sin mandar ningún correo (§8).

### Recordatorios de enlaces (`recordatorios-documentales`)

`POST /functions/v1/recordatorios-documentales {}` — **pública** (`--no-verify-jwt`) porque la
llama `pg_cron` a las 7:00; se protege con el mismo secreto compartido que `generar-documento`
(`x-documentos-secret` / `DOCUMENTOS_SECRET`, en `app_config.documentos_secret` para el job).
Busca enlaces `activo`, sin `usado_at` y **con `caduca_at` en el futuro** —la caducidad se calcula,
no se guarda— que lleven 7 días (`recordatorios = 0`) o 14 (`recordatorios = 1`); a partir del
segundo aviso no manda nada más.

⚠️ **El recordatorio no puede llevar el enlace, y por eso va al equipo y no al destinatario.** De
`enlaces_token` solo existe `token_hash`: el token en claro vive únicamente en el correo original.
Emitir uno nuevo rompería en silencio el que la persona quizá ya tiene abierto —y revocar+crear es
una decisión del equipo, no de un cron—; mandar un correo sin enlace sería un aviso que no se puede
accionar. Así que se manda **un solo resumen diario** a `parametros_documentales.email_equipo` con
los enlaces vencidos, para que alguien reenvíe desde el panel o llame. Es el modelo asistido
(§1bis) aplicado al recordatorio.

Respeta los gates (§8): `modoTestActivo()` + `esEmailTest()` **sobre el destinatario**, aunque el
correo vaya al equipo —lo que el aviso desencadena es reenviar un enlace a esa persona—; un enlace
`asistido` (sin correo con que comprobarlo) también se salta con el modo test activo. **Los
contadores solo se suben si el correo salió**: si no, el hito sigue pendiente y se reintenta
mañana. Con `email_equipo` NULL (hoy lo es) no falla: lo registra, lo cuenta como
`sense_email_equip` y sigue. Devuelve `{ok, revisados, avisados, saltados, motivos}`.

### Confirmación por enlace (`enlace-publico`, fase 3)

`GET ?t=<token>` y `POST {t, accion}` — **pública** (`--no-verify-jwt`): quien confirma una entrega
no tiene cuenta. **El token es la única credencial**, y en la base solo vive su sha256. Anti-abuso
como `registro`: honeypot, 10 intentos/10 min por IP en memoria y freno durable (≥50 evidencias/hora
→ 429).

**`evidencias.sha256_texto` es la huella del acta que compone el SERVIDOR**, no la que manda el
cliente. El `GET` devuelve el acta entera en `text_confirmacio` —declaración, número, código de
verificación y una línea por producto con sus kg— y la página está obligada a mostrarla tal cual; el
`POST` la vuelve a componer y hashea la suya. Si la del cliente no cuadra, `409 document_canviat`.
Aceptar la huella del cliente convertiría la evidencia en una declaración suya sobre lo que dice
haber visto. Los kg tecleados **no** entran en la huella: eso es lo respondido, y va en `payload`.

⚠️ **D3 también se aplica en la API, no solo en el PDF.** El albarán de entrega filtraba la
identidad del generador por dos vías que no eran evidentes: `id_excedente` tiene el formato
`E-AAMMDD-XXX-YYY-N`, donde **XXX son las tres primeras letras del nombre del productor**, y
`recogida.lugar` (la finca) más `responsable_origen` (la persona en origen) salían tanto impresos
como en el JSON público. Los tres se tapan en ENT y el lugar se sustituye por el municipio. Si se
añade algún campo nuevo al snapshot, hay que preguntarse si nombra al donante.

### Registro self-service (`registro`, 31-07-2026)

`POST /functions/v1/registro` — **pública** (`--no-verify-jwt`), porque la llama quien todavía no
tiene cuenta. Crea, en este orden: la cuenta (`admin.createUser`, `email_confirm: true`), la ficha
(`productores` o `entidades`, con `es_test = false`) y la **membresía `pendent` con `activo = false`**
(§4bis). Contrato completo y códigos de error en el propio fichero; los mensajes van en catalán,
listos para mostrar.

**Abre el alta sin abrir el acceso.** La persona puede iniciar sesión y no ve absolutamente nada
—los helpers filtran por `membresias.activo`—: le sale la pantalla «Compte pendent de validació».
Quien concede el acceso de verdad es el equipo, desde Aprovacions (§6quater).

**Detecta que la organización ya existe, y aun así NO vincula** (etapa 2 de la brecha 2,
11-09-2026). Antes solo veía los choques con `productores` —y los veía porque allí `email` y `phone`
son UNIQUE—, así que una entidad ya fichada se registraba otra vez y solo lo notaba el equipo al
validar. Ahora consulta las fichas de las dos tablas y **`v_organizaciones`**, con el mismo criterio
que usó la migración de la etapa 1: **correo o teléfono exactos** (el teléfono, por sus últimas 9
cifras), **nunca el parecido del nombre** —juntar dos organizaciones distintas es mezclar los kilos y
el certificado fiscal de dos donantes—. Tres caminos:

| Coincidencia | Qué hace |
| --- | --- |
| Ninguna | Alta normal. La ficha **estrena su fila en `organizaciones`** (`creada_por` = la cuenta recién creada) |
| Con una organización que **no** tiene ficha de ese tipo | **Es la misma organización estrenando papel.** El alta sigue, la ficha estrena **identidad provisional propia** y se le deja una nota en el comentario; responde `200 { revisio_equip: true }`. El equipo las une después con `enllacar_organitzacio()` (§4bis) |
| Con una organización que **ya** tiene ficha de ese tipo | `409 dades_en_us` con `camp`, como hasta ahora — **y ahora también para entidades** |

⚠️ **El papel nuevo no se enlaza solo, y no es timidez.** Enlazar sería convertir «conozco el correo
de esta organización» en «soy esta organización» por un rodeo: hoy el acceso lo da `membresias`, que
apunta a una ficha, así que el enlace no abriría nada **todavía**; pero la unificación existe para
que mañana los convenios, los albaranes y los certificados se resuelvan **por organización**, y ese
día el enlace se convierte —sin que nadie lo vuelva a mirar— en acceso a los kilos y al certificado
fiscal de la otra ficha, creado por un POST sin sesión. Aprobar un alta es un clic y nada en esa
pantalla diría que además se confirma una identidad. Tampoco se le crea una organización propia: eso
fabricaría el duplicado que esto viene a detectar; pero **tampoco puede quedarse sin ninguna**:
desde `20270313100000` la columna es `not null` y el trigger le pone una. Así que nace con una
**identidad provisional propia** —que es, de hecho, ese duplicado, solo que **con una nota que lo
dice**— y el equipo la une a la buena desde Aprovacions. Unir es **fusionar**, no rellenar un hueco:
lo hace `enllacar_organitzacio()` (§4bis).

⚠️ **Y esto no siempre estuvo bien contado.** La etapa 2 se escribió creyendo que la ficha quedaba
con `organizacion_id` NULL, y así lo decían su código y esta sección: era falso desde el momento en
que se publicó, porque el trigger de la etapa 1 va delante. No tenía consecuencia visible —la nota
seguía siendo el marcador— salvo una: en ese camino la organización la creaba el trigger, fuera del
alcance de la compensación, así que si fallaba el alta de la membresía la ficha se borraba y esa
organización **quedaba huérfana**. Desde el 11-09-2026 `registro` la crea siempre él.

**Las consultas van a las fichas, no a la vista**, y después la vista. `v_organizaciones` expone un
solo correo y un solo teléfono por organización (el del productor cuando hay las dos, por el
`coalesce`), así que filtrar por ella dejaría invisible el correo de la otra ficha — que es justo el
caso a cazar. Las fichas dicen QUIÉN casa; la vista, QUÉ PAPELES tiene ya esa organización, que es lo
único que separa el papel nuevo del duplicado. Si la vista falla, se trata como duplicado: rechazar
un alta legítima lo arregla el equipo; dar por nueva una organización que ya está, no.

**La compensación cubre cuatro pasos** (cuenta → organización → ficha → membresía): si falla la ficha
se borran organización y cuenta; si falla la membresía, ficha, organización y cuenta. La organización
es además **best-effort**: si no se puede crear, la ficha nace sin ella antes que perder un alta —y
desde `20270313100000` ni eso, porque el trigger se la pone igual.

**Enumeración aceptada a propósito.** Un correo ya registrado devuelve `409 email_ja_registrat`, al
revés que `recuperar-password`, que siempre responde 200 genérico. La incoherencia es deliberada: la
respuesta genérica solo funciona si puedes rematar el flujo por correo («si ya tenías cuenta, te
hemos escrito») y **este registro no envía ningún correo**; un genérico dejaría a la persona legítima
esperando una validación que no llegaría nunca.

**Anti-abuso proporcionado** (sin captcha, deuda §12.26): honeypot `web` —que responde 200 falso—,
límite de 5 intentos/10 min por IP **en memoria** (best-effort: se pierde en cada arranque en frío y
no se comparte entre instancias) y un freno global durable: ≥20 registros pendientes en la última
hora → 429. A la escala de Redestina, ese freno no molesta a nadie legítimo y corta un abuso masivo aunque
roten las IP.

**Compensación**: si falla el insert de la ficha se borra la cuenta; si falla la membresía se borran
ficha y cuenta. El orden está elegido para que el peor residuo posible sea una cuenta de Auth sin
membresía —inocua, no sale en ningún listado— y nunca una ficha huérfana contaminando los 345
productores reales.

⚠️ **Nadie recibe ningún correo**: ni de bienvenida, ni de verificación del correo, ni al aprobar.
Hoy la persona se entera entrando. Con el modo test encendido tampoco podría recibirlo: su
organización nace `es_test = false` y el gate de cuenta (§8) la bloquea. Deuda §12.27.

### Usuarios de prueba

`scripts/crear-usuarios-prueba.ts` crea **5 organizaciones ficticias** —2 productores (`TEST-PROD-1`,
`TEST-PROD-2`) y 3 receptores (`TEST-ENT-SOCIAL`, `TEST-ENT-OBRADOR` transformador,
`TEST-ENT-COMERCIAL`), todas `es_test`— y **7 cuentas**: una por organización, más las 2 del equipo
(`super_admin` y `tecnic`). Ficticias a propósito: un fallo de permisos no expone entonces ninguna
organización real, y ningún botón manda un WhatsApp a un receptor de verdad. Sin teléfono
(`productores.phone` es UNIQUE y los números del equipo ya están dados de alta): para WhatsApp están
las cuentas de la sección siguiente.

**El juego se recortó dos veces el 31-07-2026** (era 7 organizaciones y 13 cuentas):

1. Fuera los pares **titular/operador**, porque el producto **no tiene cargos dentro de la
   organización**: todos los usuarios de una empresa ven el mismo panel, y el registro público
   siempre crea `titular`. `rol_org` sigue en el esquema (§4bis) pero de facto vale siempre
   `titular`, así que **ninguna cuenta ejercita ya el caso `operador`** —y `PerfilOrganitzacio` sigue
   condicionando el guardado a `rol_org === 'titular'`, o sea que esa rama es código sin cobertura—.
2. Fuera el receptor de **alimentación animal** (esa línea no se usa todavía) y las dos de
   **control** —la cuenta sin rol y la del registro pendiente—, que salían en `/login` sin ser un
   caso de uso.

Cada cuenta que sobra es una ficha más de ruido en los listados del equipo y en la priorización.

⚠️ **Lo que costó el segundo recorte** (deuda §12.32): el arnés pierde los bloques `sense_rol` y
`pendent` (pasa de 66 a 57 comprobaciones) y ya no hay nada en la cola de «Registres pendents». Ambos
se recuperan **sin tocar el fixture**: basta con dar de alta una organización desde `/registre`, que
produce exactamente el caso pendiente, y añadir su credencial a `scripts/data/cuentas-prueba.json`.
Y al borrar las dos organizaciones quedaron **dos filas huérfanas en `email_test_recipients`**, que
no tiene FK (§4, deuda §12.33).

### Cuentas para probar WhatsApp (31-07-2026)

Ninguna de esas 7 puede usar WhatsApp: sus fichas nacen **sin teléfono** a propósito. Las únicas
fichas con móvil verificado en Meta son las de **cinco personas del equipo de Espigoladors** (Carles
Sanz, Sebas Sale, Raquel Diaz, Anna Garreta, Laura Masdeu), y tres de ellas solo tenían **cuenta de
equipo** (`super_admin`/`admin`), que no puede ir a los accesos de `/login`.

`scripts/crear-usuarios-whatsapp.ts` resuelve eso creando **cuentas de organización aparte**
(`hola+wa-{carles,sebas,raquel,anna,laura}@carlessanz.com`, sin fila en `usuario_roles`) enlazadas
por membresía a esas mismas fichas. **Nunca crea ni modifica una ficha**: solo enlaza, busca por
correo, y si una no existe avisa y no la inventa — es lo que lo distingue del fixture, que sí crea
organizaciones ficticias, y por eso es un script aparte.

**Cuatro de las cinco quedan con doble rol real** (ficha de productor **y** de entidad), que es lo
que ejercita el menú con los dos paneles (§6ter) y también la desambiguación del webhook (§12.16).
Laura Masdeu no tiene teléfono ni está en la whitelist de Meta: su cuenta sirve para recorrer el
panel, no para el canal.

⚠️ Es idempotente pero **no cambia la contraseña de una cuenta que ya exista**: si se pierden, hay
que resetearlas por la Admin API. Y el aislamiento depende de que `roles_activos` esté encendido
(§4bis): con el interruptor apagado, estas cuentas verían toda la base como cualquier otra.

### Lo que sigue pendiente

- ~~El modelo de roles existe pero está apagado~~ — **`roles_activos` está ENCENDIDO** desde el
  30-07-2026 y verificado (§4bis): cada cuenta ve solo lo suyo, y `hola@carlessanz.com` es
  `super_admin`. Dar de alta una cuenta ya **no** equivale a dar acceso total: sin rol ni membresía
  activa no se ve nada. Se revierte con `deno run -A scripts/roles-activos.ts off`.
- `enable_signup = false` vive en `config.toml` y **debe seguir así**: el alta pasa siempre por
  nuestro código (Admin API o la Edge Function `registro`, que la ignora porque usa `service_role`).
  Si alguien reactivara el flag, cualquiera podría registrarse **saltándose la validación del
  equipo** y quedaría con una cuenta sin membresía —que hoy no ve nada, pero tampoco pasa por la
  cola—. No es una vía de escalada, es una vía de ruido.
- **Los accesos de prueba llevan contraseñas en el bundle** mientras `VITE_ACCESSOS_TEST` esté a
  `true` (hoy lo está, también en Vercel producción). Son solo de organizaciones ficticias `TEST-*`
  (§6quater), pero cualquiera que abra `/login` puede entrar como ellas y ver lo que ellas ven.
  Apagar la variable al salir de la fase de demo.
- Los datos personales **ya están en remoto**: 341 productores y 111 entidades, importados
  el 21-07-2026. Lo único que los protege es la autenticación de arriba; verificado que con
  la publishable key las tablas responden `42501`. Dar de alta una cuenta equivale a dar
  acceso a las 452 fichas completas.
- La app de Vercel tiene además Deployment Protection (SSO), que es una capa de
  plataforma independiente de todo lo anterior.

### ⚠️ No hacer `supabase config push`

Los flags de auth de **remoto** (`external_email_enabled`, `disable_signup`) se gestionan
por el **Dashboard o el Management API**, no por `config.toml`. Dos razones:

1. `config push` ya falla a mitad (error de Storage con esta versión del CLI).
2. Peor: arrastra `enable_signup = false` del toml y **desactiva el login por email en
   remoto** — GoTrue responde entonces "Email logins are disabled", que no es un error de
   contraseña sino del proveedor apagado. Pasó el 21-07-2026 y dejó fuera al equipo.

Para reactivarlo (Management API, con el token del CLI en el keychain):

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://api.supabase.com/v1/projects/<ref>/config/auth \
  -d '{"external_email_enabled": true}'
```

En el **CLI local** los dos flags no son independientes: `external.email` sigue a
`enable_signup`, así que con `enable_signup = false` el login por email tampoco funciona en
local. No importa en la práctica: `npm run dev` usa `.env.local`, que apunta a **remoto**.

## 10. Variables de entorno

**Frontend** (`.env.local`, ignorado por git; plantilla en `.env.local.example`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`)
- `VITE_ACCESSOS_TEST` — `"true"` enseña en `/login` los accesos de un clic a las cuentas de prueba
  (§6quater). **Es una variable de build**: cambiarla exige recompilar y volver a desplegar, no basta
  con editarla en Vercel. Con cualquier otro valor —o ausente— el módulo con las contraseñas se cae
  del bundle. Hoy vale `true` en local y en Vercel producción.

**Edge Functions** (secrets de Supabase):

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_API_VERSION` (default `v23.0`)
- `WHATSAPP_ENVIO_REAL` — `"true"` en remoto desde 2026-07-22 (envíos reales, §8); ausente u
  otro valor = simula (`status='simulat'`)
- `ALLOWED_ORIGIN` — admite **varios orígenes separados por comas** y `*` como comodín
  dentro de un origen, porque los despliegues de Vercel no tienen URL estable.
  Valor actual:
  `http://localhost:5173,https://redestina.carlessanz.com,https://redestina-*-carlessanz-projects.vercel.app`.
  **La app en producción se sirve desde el dominio propio**, que hay que añadir aquí (si no, el
  navegador bloquea por CORS todas las llamadas a las Edge Functions). Si se cambia/añade dominio,
  actualizar este secret.
  ⚠️ Un cambio de este secret **no llega a un isolate caliente**: `ALLOWED_ORIGINS` es un `const` de
  módulo que se evalúa al cargar. Hay que **redesplegar** las funciones, y no dar por buena una
  prueba hecha diez segundos después.
- `RECORDATORIOS_SECRET` — secreto compartido que valida `intake-recordatorios`; el **mismo**
  valor va en `app_config.recordatorios_secret` para que el job lo pueda enviar (§4, §5). Nunca
  en git.
- `RESEND_API_KEY` — API key de Resend (ofertas por email y reset de contraseña). Nunca en git.
- `RESEND_ENVIO_REAL` — **`"true"` exacto o no sale ni un correo** (gemelo del de WhatsApp, §8).
  Permite ensayar el circuito entero en local sin salir a la red y sin `RESEND_API_KEY`: la
  comprobación va **antes** de mirar la clave.
  🔴 **Crearlo ANTES de redesplegar** las cinco funciones que mandan correo (`enviar-email`,
  `enviar-acceso`, `recuperar-password`, `recordatorios-documentales`, `enlace-publico`). Al revés,
  **el correo se apaga entero y en silencio** — incluido `recuperar-password`, así que alguien
  puede quedarse fuera de la aplicación sin ningún mensaje de error.
- `RESEND_FROM` — remitente (`from`) de un dominio **verificado** en Resend.
  Valor actual: `Redestina <no-reply@espigoladors.com>`. Ausente = usa `onboarding@resend.dev`, que solo
  entrega al correo owner de la cuenta.
- `APP_URL` — URL de la app para el `redirectTo` del reset. Valor actual:
  `https://redestina.carlessanz.com`; tiene que estar en la allow-list de Auth (`uri_allow_list`).
- `SB_SECRET_KEY` (`sb_secret_...`)
- `SUPABASE_URL` (la inyecta Supabase automáticamente)

**Redirect URLs de Auth** (Management API, no config push): `site_url` = APP_URL y `uri_allow_list`
incluye `localhost:5173`, el dominio de producción y el comodín de los despliegues de Vercel, todos
sobre `redestina`.
⚠️ **Son dos matchers distintos**: el de las Edge Functions convierte `*` en `[A-Za-z0-9-]+` y compara
orígenes completos (sin `/**`); el de GoTrue es glob y **sí** necesita el `/**` final. No copiar el
mismo literal a los dos sitios.

**Scripts**: `SUPABASE_URL` y `SB_SECRET_KEY` en el entorno.

## 10bis. Nombres retirados y lo que dejaron aprendido

El proyecto se llamó **`pdApp-wp`** hasta el 31-07-2026, **`P0MA`** hasta el 10-09-2026, y desde
entonces **`Redestina`**. El segundo cambio no fue solo un slug: `POMA` era también el nombre del
servicio de cara al usuario, así que cambió lo que se lee en la interfaz, en los correos y en las
plantillas de WhatsApp.

⚠️ **No crear nunca un repo llamado `P0MA` ni `pdApp-wp`.** GitHub mantiene una redirección 301
desde los dos hacia `Redestina`, y funciona también para git (`git ls-remote` sobre la URL vieja
devuelve el `main` actual), así que un clon con el remote antiguo sigue trabajando sin enterarse.
Crear un repo con cualquiera de esos nombres **rompe la redirección** y desvía esos clones a otro
repositorio en silencio.

Cuatro cosas que costaron descubrir y siguen valiendo:

1. ⚠️ **`supabase stop` ANTES de cambiar `project_id`.** Al revés, el CLI filtra por el nombre nuevo,
   no encuentra los contenedores viejos y deja doce huérfanos ocupando los puertos 553xx. Para
   limpiarlos, **filtrar por nombre** (`docker ps -q --filter name=_Redestina`): en esta máquina
   conviven otros stacks de Supabase y un `docker stop $(docker ps -q)` se los llevaría por delante.
2. ⚠️ **El próximo cambio de dominio exige redirección 308, no corte.** Los dos dominios anteriores
   se apagaron sin redirección, y las dos veces valió el mismo argumento: seguimos en modo test y no
   ha recibido correo ningún destinatario real, solo `hola+*@carlessanz.com` y las organizaciones
   `TEST-*`. **Ese argumento ya se ha gastado dos veces.** Al primer correo a un productor o una
   entidad de verdad, apagar un dominio rompe su historial hacia atrás y sin remedio: el logo y el
   enlace del pie viven para siempre en la bandeja de quien lo recibió.
3. ⚠️ **`Poma` es un producto del catálogo, no el proyecto.** Es *manzana*: está en `productos.csv`,
   en el seed `20260721120300_seed_catalogos.sql` y en comentarios de fichas de productores.
   Cualquier sustitución masiva tiene que ser **sensible a mayúsculas** — un
   `sed -i 's/poma/redestina/gi'` renombraría la fruta.
4. **Las migraciones ya aplicadas conservan `POMA` en sus comentarios**, y una se llama
   `20260721120100_modelo_poma.sql`. Editarlas está prohibido (§7): el nombre es parte de su
   identidad.

~~⚠️ El rebranding es textual, no visual: falta el logo.~~ — **resuelto (10-09-2026)** con el
sistema de diseño (§2bis): logo nuevo en seis variantes, iconos de la PWA, favicon y `logo-email.png`
regenerados. Deuda 41 cerrada. Los PDF de
`docs/nuevas-funcionalidades/` cambiaron de nombre pero no de contenido: son binarios y por dentro
siguen diciendo POMA.

## 10ter. Cómo se completó el rename (10-09-2026)

Los pasos de infraestructura del rename 2, **ya ejecutados**. Se dejan escritos porque son el
procedimiento a repetir el día que cambie el dominio, y porque dos de ellos tienen trampa.

1. **Vercel — renombrar el proyecto** (`p0ma` → `redestina`): Settings → General → Project Name. El
   `projectId` no cambia, así que conserva variables, dominios e historial; `.vercel/project.json`
   no hace falta tocarlo.
   ⚠️ **Hace falta rol OWNER.** El CLI de esta máquina está autenticado como `upsocial`
   (csanz@upsocial.org), que en este equipo es **DEVELOPER**: despliega y lee, pero un
   `PATCH /v9/projects/{id}` responde `403 forbidden`. El OWNER es `carlessanz`
   (hola@carlessanz.com). Se hizo desde el Dashboard con esa cuenta.
   ⚠️ **Renombrar el proyecto cambia las URLs de preview**: pasaron a
   `redestina-*-carlessanz-projects.vercel.app`, así que los pasos 3 y 4 son parte del mismo
   trabajo, no un extra.
2. **Vercel — el dominio** `redestina.carlessanz.com`, con su registro DNS.
3. **Secretos de Supabase** (`supabase secrets set`): `ALLOWED_ORIGIN`, `APP_URL` y `RESEND_FROM`.
   ⚠️ **Redesplegar después TODAS las Edge Functions**: `ALLOWED_ORIGINS` es un `const` de módulo y
   un isolate caliente no ve el secreto nuevo (§10). Se redesplegaron las nueve, con sus flags de
   `verify_jwt` (§11) — que además es lo que llevó a producción los textos con el nombre nuevo.
4. **Auth — `site_url` y `uri_allow_list`** por Management API (**nunca** `config push`, §9):
   ```bash
   TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
   curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     https://api.supabase.com/v1/projects/uxppvaldhptdomvdhsmn/config/auth \
     -d '{"site_url":"https://redestina.carlessanz.com","uri_allow_list":"…"}'
   ```
   ⚠️ Los dos matchers **no** llevan la misma sintaxis: el de las Edge Functions compara orígenes
   sin `/**`; el de GoTrue es glob y sí lo necesita (§10). La lista incluye cada origen en las dos
   formas para no depender de esa diferencia.

**Cómo se verificó** (y cómo verificarlo la próxima vez): un preflight `OPTIONS` real contra una
Edge Function pública con cuatro orígenes distintos. Lo que hay que ver es que la respuesta devuelve
**el origen pedido**, no el primero de la lista:

```bash
curl -i -X OPTIONS "$SUPABASE_URL/functions/v1/registro" \
  -H "Origin: https://redestina.carlessanz.com" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
```

| Origen probado | Respuesta esperada |
| --- | --- |
| `https://redestina.carlessanz.com` | el mismo origen ✅ |
| `http://localhost:5173` | el mismo origen ✅ (si no, se rompe `npm run dev`) |
| un dominio retirado o cualquier origen arbitrario | **no** el mismo (cae al primero de la lista) |

⚠️ **La trampa de esta comprobación**: un origen no permitido **no da error**. La función responde
`204` igual, pero con el `Access-Control-Allow-Origin` de otro origen, y es el **navegador** quien
bloquea después. Mirar solo el código de estado da un falso verde: hay que leer la cabecera.

Lo único que queda del rename es **el logo** (§10bis, deuda 41).

## 11. Comandos

```bash
npm run dev                # Vite en local
npm run build              # tsc && vite build  (solo mira src/: ni scripts ni Edge Functions)
npm run preview            # servir el build

supabase db push                                          # aplicar migraciones
supabase functions deploy whatsapp-send        # con verify_jwt
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy priorizar-entidades  # con verify_jwt
supabase functions deploy intake-recordatorios --no-verify-jwt   # lo llama pg_cron
supabase functions deploy enviar-email         # con verify_jwt (ofertas por email)
supabase functions deploy recuperar-password --no-verify-jwt     # login público
supabase functions deploy crear-oferta         # con verify_jwt (alta desde el panel del productor)
supabase functions deploy registro --no-verify-jwt               # registro público self-service (§9)
supabase functions deploy enviar-acceso        # con verify_jwt (enlace mágico / código de acceso)
supabase functions deploy generar-documento --no-verify-jwt      # la llama el trigger por pg_net
supabase functions deploy descargar-documento # con verify_jwt (URL firmada de 60 s)
supabase functions deploy recordatorios-documentales --no-verify-jwt  # lo llama pg_cron
supabase functions deploy enlace-publico --no-verify-jwt        # confirmación pública (§9)
supabase functions deploy subir-documento-externo               # con verify_jwt (multipart, 10 MB)
supabase functions deploy limpiar-documentos-prueba            # con verify_jwt (super_admin; §12.51)
supabase secrets set --env-file .secrets.env
# ⚠️ Los flags de arriba están además DECLARADOS en `supabase/config.toml`, que manda sobre el
# CLI: desde el 10-09-2026 las nueve tienen su `verify_jwt` escrito (antes, tres se apoyaban en
# el default del CLI, que es `true` — correcto, pero no escrito en ninguna parte, que es
# exactamente la distancia de la que nació la deuda 43).

# Publicar en producción: el procedimiento completo vive en el skill `/publicar`
# (.claude/skills/publicar/SKILL.md). Ejecutarlo es preferible a repetir los pasos a mano:
# recoge los flags de cada función y las trampas de verificación.
# ⚠️ El orden es **base de datos → Edge Functions → frontend**, de abajo arriba, y cada capa
# solo depende de otra ya publicada. El `git push` es lo que dispara Vercel, así que va el
# ÚLTIMO: hacerlo antes publica la interfaz nueva contra un esquema viejo, y una pantalla que
# consulta una tabla que no existe responde 42P01 hasta que se aplique la migración. La
# consecuencia es que las migraciones tienen que ser compatibles hacia atrás —el frontend
# vigente sigue sirviéndose durante esa ventana—: añadir sí, renombrar o borrar exige dos
# publicaciones.

deno run -A scripts/import-ara.ts --dry-run   # analizar sin escribir
deno run -A scripts/import-ara.ts             # importar los CSV maestros

deno run -A scripts/comprobar-rls.ts          # arnés de RLS: matriz de permisos por cuenta (§4bis)
# ⚠️ Contra la base LOCAL el arnés NO inicia sesión: el CLI apaga el login por correo
# (§9), así que firma el JWT con el secreto del stack. Necesita SB_SECRET_KEY para
# resolver los uuid, y las cuentas creadas con crear-usuarios-prueba.ts.
SUPABASE_URL=http://127.0.0.1:55321 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_… \
  SB_SECRET_KEY=sb_secret_… deno run -A scripts/comprobar-rls.ts

# Numeración documental sin huecos (§4 «Sistema documental»)
SUPABASE_URL=http://127.0.0.1:55321 SB_SECRET_KEY=sb_secret_… \
  deno run -A scripts/prueba-numeracion.ts                    # 5 pasadas × 50 emisiones
  deno run -A scripts/prueba-numeracion.ts --pasadas 2 --emisiones 200 --fallos 0.3

# Typecheck de lo que `tsc` NO mira. ⚠️ El --config es obligatorio: `deno check` toma la
# configuración del cwd, no la de la carpeta del módulo, y sin ella no resuelve los imports.
deno check scripts/*.ts
for d in supabase/functions/*/; do [ "$(basename $d)" = "_shared" ] && continue; \
  deno check --config "$d/deno.json" "$d/index.ts"; done

# Pruebas unitarias (Vitest 4). Corren en Node sobre los módulos de negocio, que son
# TypeScript puro: ni una referencia a `Deno.`, ni un import `npm:`/`jsr:`.
npm test                      # vitest run
npm run test:watch            # durante el desarrollo
npm run test:cobertura        # con cobertura v8 sobre src/lib y _shared

# Los tres controles de una vez (lo que conviene ejecutar antes de dar nada por terminado):
npm run check                 # tipos (app + pruebas) + vitest + deno check
npm run check:tipos           # solo tsc: tsconfig.json y tsconfig.tests.json

# El hook de pre-commit se instala UNA VEZ por clon (git no ejecuta hooks versionados solo):
git config core.hooksPath .githooks

# Qué Edge Functions han cambiado DE VERDAD entre dos despliegues (§12.44). La salida del
# CLI no sirve para saberlo; el `ezbr_sha256` sí, pero hace falta guardar el de antes.
deno run -A scripts/huellas-funciones.ts guardar    # ANTES de desplegar
deno run -A scripts/huellas-funciones.ts comparar   # después
deno run -A scripts/huellas-funciones.ts listar     # solo mirar

deno run -A scripts/crear-usuarios-prueba.ts --dry-run   # simular el alta de los 12 usuarios de prueba
deno run -A scripts/crear-usuarios-prueba.ts             # crearlos (idempotente)
deno run -A scripts/crear-usuarios-whatsapp.ts --dry-run # simular las 5 cuentas de WhatsApp (§9)
deno run -A scripts/crear-usuarios-whatsapp.ts           # crearlas (no toca ninguna ficha)

supabase migration up --local                 # aplicar migraciones pendientes SOLO en local (no borra datos)

# ⚠️ La tanda documental necesita --include-all. El spike aplicó 20260928100600 y ...100800
# dejando huecos por debajo, así que las seis migraciones de la segunda mitad de la fase 1
# son «anteriores a la última aplicada» y el CLI las rechaza con
# LegacyMigrationMissingRemoteError. No es un error: es el precio de haber adelantado dos
# ficheros en el spike.
supabase migration up --local --include-all
supabase db push --include-all            # en remoto, la primera vez tras la fase 1

# Secreto del sistema documental, en los DOS sitios (el job lo manda, la función lo valida):
deno run -A scripts/set-config.ts documentos_secret '<valor>'   # app_config
supabase secrets set DOCUMENTOS_SECRET='<el mismo valor>'       # secreto de la función
```

Logs de las Edge Functions **en remoto**. ⚠️ Este CLI **no tiene `functions logs`** (`supabase
functions` solo trae list/delete/download/deploy/new/serve), así que durante un tiempo se dio por
hecho que había que abrir el panel. No hace falta: el **Management API de analítica** los sirve por
SQL, con el mismo token del keychain que se usa para Auth (§9).

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
SQL="select timestamp, event_message from function_logs order by timestamp desc limit 20"
curl -sS -G "https://api.supabase.com/v1/projects/uxppvaldhptdomvdhsmn/analytics/endpoints/logs.all" \
  -H "Authorization: Bearer $TOKEN" --data-urlencode "sql=$SQL"
```

`function_logs` son los `console.*` de las funciones (ahí sale el JSON de tiempos de
`generar-documento`, §12.87) y `edge_logs` las peticiones HTTP. El `cpu_time_used`, la región y la
memoria de cada isolate viven en el evento `shutdown`, dentro de `metadata`, y hay que desplegarlo
con `unnest`. **Saca siempre `execution_id`**, o los números no se pueden atribuir:

```bash
SQL="select f.timestamp, f.event_message, m.execution_id, m.region, m.cpu_time_used
     from function_logs f cross join unnest(f.metadata) as m
     order by f.timestamp desc limit 30"
curl -sS -G "https://api.supabase.com/v1/projects/uxppvaldhptdomvdhsmn/analytics/endpoints/logs.all" \
  -H "Authorization: Bearer $TOKEN" --data-urlencode "sql=$SQL" \
  --data-urlencode "iso_timestamp_start=2026-09-11T00:50:00.000Z" \
  --data-urlencode "iso_timestamp_end=2026-09-11T00:58:00.000Z"
```

⚠️ **La ventana por defecto son minutos, no horas.** Sin `iso_timestamp_start`/`iso_timestamp_end`
solo se ve lo más reciente y una ejecución de hace un rato parece no existir. Esos dos parámetros
son la forma de ir a buscarla; van **fuera** del SQL, como parámetros de la petición.

⚠️ **El `cpu_time_used` de una ejecución NO es el del `shutdown` más reciente.** Un isolate sigue
vivo un rato tras responder, así que su `shutdown` llega minutos después y entremedias se apagan
otros. Hay que casar `execution_id` con el del log de la ejecución. Cómo salió mal esto la primera
vez, y cuál es la señal de haberse equivocado, en §12.87.

⚠️ Un `unnest` mal escrito responde `Backend error! Retry your query`, que **no** es un fallo
transitorio: es la consulta.

Emergencia de RLS (§4bis), por orden: primero el interruptor,

```bash
deno run -A scripts/roles-activos.ts off     # o, en el SQL Editor:
# update app_settings set value = 'false' where key = 'roles_activos';
```

y si no basta, `scripts/sql/rls-emergencia.sql` en el SQL Editor.

`npm run build` corre `tsc` con `strict`, `noUnusedLocals` y `noUnusedParameters`, **pero solo
sobre `src/`**: ni los scripts de Deno ni las Edge Functions entran en ese `tsconfig`, así que
durante meses no los comprobó nadie. Hoy hay **cuatro** comprobaciones automáticas: `tsc` (de la
aplicación **y** de las pruebas, con `tsconfig.tests.json`), **`vitest`**, `deno check` (scripts y
las 14 funciones) y `scripts/comprobar-rls.ts`, que verifica los permisos de verdad, contra la
base y con sesiones reales. Las tres primeras van juntas en `npm run check` y en el hook de
pre-commit; el arnés se queda fuera porque necesita credenciales. Si tocas algo de
`supabase/functions/_shared/`, **redespliega todas** las funciones que lo importan.

⚠️ **Las pruebas no viven en `src/` y eso es deliberado.** Importan dos mundos que la aplicación
no conoce —los módulos Deno de `_shared/`, que se referencian con extensión `.ts`, y utilidades de
Node— así que tienen su propio `tsconfig`. Meter `"node"` en los tipos del `tsconfig` de la
aplicación dejaría `process`, `Buffer` y `fs` visibles dentro de `src/`, que se empaqueta para el
navegador: haría compilar código que revienta en producción.

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
3. **Opt-in real de las entidades**: hoy `false` en las 111; el toggle deja la mecánica, pero
   recoger el consentimiento es trabajo de negocio.
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
    `datos_provisionales = false`. ⚠️ **`email_equipo` es NULL** y es el destinatario de TODO lo
    que se emite en modo prueba: hasta que se rellene, un cierre de ensayo no tiene a dónde enviar.
11. **Textos legales de las plantillas.** `plantillas_documento` solo trae sembrada la de `PROVA`
    (el ejemplo del formato). Los textos ca/es de REC, ENT, OPE, CONV, RES, CD, CT y PLA los
    entrega la fase 0 y los introduce el equipo desde la pantalla: una migración no inserta texto
    legal sin validar.
12. **Casar `productor_ubicaciones.municipio_ine`** con el texto libre que hay hoy (script aparte,
    con ambigüedades reales: hay nombres de municipio repetidos entre provincias). Hasta entonces
    la columna es nula en las 12 ubicaciones y la priorización sigue comparando cadenas.

**Deuda técnica.** ⚠️ **Léase con la clave de §12bis.** No todo lo que hay en esta lista es
arreglable, y confundirlo hace que la lista entera se vuelva ruido: se lee, se comprueba que no se
puede hacer nada con la mitad, y se aprende a ignorarla. §12bis separa **lo que es un defecto** de
**lo que es una decisión con su precio anotado** y de **lo que depende de material que no está en
el código**. Los números **no se renumeran nunca**: hay comentarios en `src/`, `supabase/functions/`
y `scripts/` que citan dieciséis de ellos, y renumerar los rompería en silencio.


1. 🟡 **Sin linter y sin CI** — *la mitad resuelta (11-09-2026)*. Ya hay **430 pruebas de
   Vitest** sobre los módulos de negocio y un **hook de pre-commit** que corre tipos, pruebas y
   `deno check` (§11, §13), así que las comprobaciones ya no dependen de que alguien se acuerde.
   Lo que sigue faltando: **linter** (no hay ESLint) y **CI de verdad** — el hook se puede saltar
   con `--no-verify` y no protege a quien no lo haya instalado, y el arnés de RLS sigue fuera
   porque necesita credenciales. Lo que costó no tener nada de esto está medido: `deno check` no
   había pasado nunca sobre las Edge Functions (§12.45) y escondía tres errores de tipos reales.
2. ~~**No hay roles**~~ — **resuelto (2026-07-30)**: modelo desplegado y **encendido** en producción
   (§4bis), verificado con el arnés (48/49 **ese día**; la referencia de hoy es 56/56 + 1 saltada
   —§13— y la
   diferencia está explicada en la deuda 32). El único rojo era, y sigue siendo, un receptor
   comercial sin ninguna oferta de `venda` publicada, que es el comportamiento correcto. Queda de deuda: `tipo_receptor`
   sigue en `null` en 111 entidades y sin él un receptor no ve ninguna oferta —es triaje manual—, y
   `usuario_roles` no tiene FK a `perfiles`, así que PostgREST no puede embeber los dos (la futura
   pantalla «Equip» tendrá que cruzarlos en cliente).
3. ~~**El intake avanza de paso aunque falle el envío.**~~ — **resuelta (11-09-2026)**:
   `preguntar()` devuelve `boolean`, las 14 ramas miran el `.ok` de su envío, y **el orden se
   invierte** — se pregunta primero y el paso solo avanza si salió. La respuesta sí se guarda
   (está entendida y validada); lo que no se mueve es `paso_actual`, así que el reintento es
   idempotente.
   ⚠️ **`_intentos` no lo toca un fallo de red**, y esa distinción es el fondo del asunto: ese
   contador sube solo cuando `interpretar()` no entiende la respuesta. Confundir las dos cosas
   expulsaría del formulario a quien contesta bien y tiene mala cobertura.
   Verificado contra la base local con la Graph API devolviendo 500 a voluntad: con el código
   anterior, un fallo en el paso «producte» dejaba la sesión en «varietat» sin que el productor
   viera la pregunta, y su siguiente mensaje («Poma») se guardaba como **variedad**.
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
   ⚠️ **Sigue abierto** lo demás, y no es poco: `OffersList` recarga entero ante cualquier evento
   de Realtime; el `Dashboard` agrega **seis tablas** en el cliente al entrar; y los buscadores de
   `ProducersList`/`OffersList` filtran **en cliente** sobre lo ya cargado, así que la paginación
   de esos listados exige rehacer búsqueda, orden y el reparto test/resto en servidor.
6. `Conversation` carga el hilo completo sin paginación.
7. ~~`ContactList` conserva la prop `single` (modo conversación única)~~ — **resuelto**: esa prop ya
   no existe (props actuales: `contacts`, `loading`, `error`, `selectedPhone`, `onSelect`, `onReload`).
8. ~~`index.css` es un único fichero global (~825 líneas) con clases sin namespace.~~ — **resuelto**: desde el paso a Tailwind v4 + shadcn solo contiene tokens y base (§2bis).
9. `types.ts` no modela `raw`; `MessageRow` en `ProducersList` duplica parte de `WaMessage`.
10. Hay migraciones que **borran datos** (`truncate wa_messages`) mezcladas con DDL.
11. Sin FK entre `productores`, `wa_contacts` y `wa_messages` (unidas por `phone`).
12. `prioritat` casi no discrimina (97 de 111 entidades son prioridad 1): aporta poco al ranking.
13. `oferta_respuestas` se registra desde el **cliente** (`OfferDetail`), no desde `whatsapp-send`:
    mantiene la Edge Function intacta pero acopla el registro al panel. Las respuestas por **email**
    no tienen captura automática (no hay inbound de correo): se marcan a mano.
14. 🟡 **La clasificación sí/no sigue siendo una heurística por lista de palabras**, pero ya
    está **medida** y tres errores reales están corregidos (11-09-2026, `tests/respuestas.test.ts`,
    67 pruebas). Los tres cerraban una oferta al revés **sin que nadie lo revisara** —la fila
    queda resuelta y se contesta «gràcies per contestar»—:
    · «**si no ens va be**» («sí, pero no nos va bien») se leía **acceptada**: el «no» va en medio
      y no casaba por empieza/termina, pero el «si » inicial sí. El caro: comprometía kilos que
      nadie había pedido.
    · «**no hi ha problema**» se leía **rebutjada**, siendo una aceptación.
    · «**si us plau**» se leía **acceptada**, siendo una cortesía — `normalizar()` quita los
      acentos antes de comparar (hace falta para que «SI» funcione), así que el `si` átono y el
      `sí` tónico son indistinguibles.
    La regla que los cubre sin fingir comprensión del lenguaje: **ante señales de los dos signos,
    no se decide**. Un `null` deja el mensaje en la consola para una persona, que es el resultado
    correcto cuando la máquina no sabe; una fila pendiente es preferible a una resuelta al revés.
    ⚠️ Lo que **sigue abierto**: es una lista de palabras, y hay huecos de vocabulario conocidos
    —el castellano «de acuerdo» no está (sí el catalán `d'acord`)— y una frontera arbitraria en
    las 5 palabras: «no ens va bé això» se clasifica y «no ens va gens bé això» no.
15. ~~La selección de plantilla de primer contacto por rol no se ejercita en test.~~ —
    **resuelta (11-09-2026)**: `tests/plantillas.test.ts` cubre las dos ramas del flag. La
    encendida se ejercita recompilando el mismo fuente con `PLANTILLES_CA_APROVADES = true`, y la
    prueba verifica que la sustitución ha ocurrido de verdad — si el flag se renombrara, la suite
    falla en vez de probar dos veces el mismo caso. Sigue siendo cierto que **en producción** solo
    actúa cuando Meta apruebe las plantillas (checkpoint §12.2).
    ⚠️ Hay ahí un `expect(PLANTILLES_CA_APROVADES).toBe(false)` **puesto para fallar** el día que
    se encienda: el checkpoint exige cuatro cosas más en ese mismo commit, y esa parada es el
    recordatorio.
16. **Doble rol** productor+entidad (Carles Sanz, Sebas Sale, Raquel Diaz, Laura Masdeu): tablas
    separadas sin FK, un teléfono puede estar en ambas. En el **panel** está resuelto (§6ter), y
    desde la etapa 1 de `organizaciones` el sistema **sabe** que las dos fichas son la misma
    organización (comparando `organizacion_id`) en vez de deducirlo de que compartan teléfono.
    En **WhatsApp** manda desde el 11-09-2026 la regla «**un mensaje contesta a la última pregunta
    que le hicimos**» (`atendreElDialeg()`, pura, en `_shared/respuestas.ts`): la oferta pendiente
    sigue teniendo prioridad sobre el intake —es una pregunta concreta y ya hecha—, **salvo que el
    intake haya hablado después** de enviarse la oferta (`intake_sessions.updated_at` >
    `oferta_respuestas.enviado_at`).
    ⚠️ **Lo que arregló, medido**: de 17 respuestas plausibles a preguntas del intake, `clasificar()`
    resuelve **7** como sí/no («no ho sé» a la varietat, «No» a les observacions, «Sí» escrit a
    `retorn`, «ok matins» a l'horari…), y cada una cerraba la oferta con una respuesta dirigida a
    otra pregunta. La que aceptaba abría el paso `kg`, que consume **todos** los mensajes siguientes
    y **no caducaba nunca**, así que dejaba el número **secuestrado de forma permanente**: ese
    productor no podía volver a publicar nada por WhatsApp. Ahora el diálogo caduca a las 12 h como
    el intake (marca en `dialeg_dades.darrer_missatge_at`, jsonb que ya existía); caducar **no
    resuelve la fila** —sigue `pendent` para el panel—, solo libera el número.
    La organización **no decide nada aquí** —la elección depende de qué se preguntó el último— pero
    sí se **registra** en el log a quién se está atendiendo y si las dos fichas son la misma
    organización, que antes era indistinguible de dos organizaciones con el mismo teléfono.
17. Coexisten dos gates: **`es_test`** (fuente de verdad de la app, §8) y las whitelists
    `meta_test_recipients`/`email_test_recipients` (requisito técnico de Meta en test). En test un
    destinatario debe cumplir **ambos**; se inicializaron alineados. El **Dashboard** aún gestiona
    y mide por las listas de Meta (no por `es_test`): coherente hoy porque coinciden, a revisar al
    pasar a producción de Meta o si se marca `es_test` a alguien fuera de la lista de Meta.
18. ~~**Aprobación sin roles**~~ — **resuelto (2026-07-30)**: la RPC `aprovar_resposta()` exige
    `pot_aprovar()` y el trigger `respuestas_control_aprovacio` lo impone aunque se relajen las
    políticas (§4bis). Efectivo al encender `roles_activos`. El «acuerdo del productor» que exige el
    funcional sigue implícito en la coordinación asistida del equipo (mejora futura: señal explícita).
19. ~~**`OfferDetail` aprueba a mano**, con llamadas sueltas en vez de `aprovar_resposta()`.~~ —
    **resuelta (11-09-2026)**, y no era lo que esta entrada decía. Estaba escrita como un problema
    de elegancia —cuatro escrituras sin transacción— y era **una regla de negocio sin aplicar**:
    `aprovar_resposta()` comprueba el convenio vigente de las dos partes, y el panel **no llamaba a
    la RPC**, así que pasada `fecha_corte_convenios` una canalización sin convenio entraba igual.
    Como este es el **único sitio desde el que el equipo aprueba**, el bloqueo no existía en la
    práctica. Ahora va por la RPC, con el aviso previo de §12.78.
    Lo único que se pierde es `canalizaciones.comentarios = 'Preu acordat: …'`, que la RPC no
    escribe: **no lo lee nadie** —ninguna pantalla pinta esa columna— y el precio vive en
    `oferta_respuestas.preu_ofert`, que es su sitio.
20. ~~**Rol único por usuario.**~~ — **cerrada por medición (11-09-2026): las dos mitades de esta
    entrada ya no describen nada.**
    La primera —«la interfaz asumirá el más alto»— **no es una aproximación, es la definición**: la
    jerarquía de `usuario_roles` es **acumulativa** (`admin` es todo lo de `tecnic` y más;
    `super_admin`, todo lo de `admin` y más), así que quedarse con el más alto es la lectura
    correcta, no una simplificación. En producción hay **una** cuenta con dos filas
    (`hola@carlessanz.com`: `admin` + `super_admin`) y quedarse con `super_admin` es exactamente lo
    que debe pasar. `mi_rol()` ordena y `limit 1`.
    La segunda —«el multirol por organización la UI aún no»— se resolvió el **31-07-2026**: el menú
    pinta **todos los paneles a la vez** (§6ter) y el panel activo se deriva de la URL. Y desde
    `20270311100000` la base impone una ficha de cada tipo por cuenta (§12.31).
    Lo que sí queda, y no es esto: `rol_org` (`titular`/`operador`) vale **siempre `titular`** de
    facto —el producto no tiene cargos dentro de la organización—, así que la rama `operador` de
    `PerfilOrganitzacio` es código sin cobertura (§9).
21. **El canal preferente (§8bis) no llega a todos los envíos.** Lo aplican `OfferDetail` (botón
    «Enviar») y `enviar-acceso`; el **intake**, los **recordatorios** y el **ALTA/BAJA** siguen siendo
    WhatsApp puro, que es correcto —son respuestas dentro de una conversación que la persona ha
    iniciado por WhatsApp—, pero un productor que solo tenga correo no puede publicar una oferta de
    forma conversacional. La vía para él es el panel (§6ter). Falta también el fallback a correo en
    `whatsapp-send` mismo: hoy lo orquesta el llamante.
22. ~~**Sin preferencia de canal declarada por la persona.**~~ — **resuelta (11-09-2026)**:
    `organizaciones.canal_preferido` se escribe con `actualizar_meu_canal()` desde el perfil y lo
    respetan `decidirCanal()` y sus dos consumidores (§8bis). Queda el límite, que es **de Meta y no
    del código**: la preferencia elige **entre los canales viables**; pedir WhatsApp sin opt-in y con
    la ventana cerrada sigue saliendo por correo, ahora marcado como preferencia incumplida en el
    panel y en el log — que es la diferencia entre no poder cumplirla y ignorarla.
23. ~~**`excedentes` tiene el único predicado de RLS que no puede ser InitPlan.**~~ — **resuelta
    (`20270304100400`)**: el `EXISTS` correlacionado se sustituye por el SRF `security definer`
    `modalitats_compatibles_meves()` y un `modalitat in (select …)`, que el planner resuelve una vez
    y hashea. Medido con `explain (analyze)`: desaparecen el `SubPlan` por fila y el `Seq Scan on
    entidades` anidado —con su segunda llamada a `mis_entidades()`—, y el plan pasa de 57 líneas a
    23. Matiz honesto: sale como `hashed SubPlan`, no como `InitPlan`, igual que las otras tres
    ramas sin correlación; el comportamiento es el mismo (una evaluación y hash).
    **Equivalencia verificada**, que es lo que de verdad importaba: para las 7 cuentas de la base
    local —y repitiéndolo con `roles_activos` apagado— el conjunto de ofertas visible con la
    política vieja y con la nueva es **idéntico**.
24. **Los eventos DELETE de Realtime se entregan sin evaluar RLS** (`realtime.apply_rls` los reparte
    a todos los suscriptores porque, con la replica identity por defecto, el WAL solo lleva la
    clave primaria). Hoy es inocuo: el payload es solo un id. Dejaría de serlo si algún día se
    pusiera `replica identity full` en una tabla con datos personales.
25. 🟡 **Un fallo de envío por correo ya deja rastro en la base; falta que el panel lo lea.**
    Y la entrada se quedaba corta: `documento_envios` **no la escribía nadie y no la leía nadie**,
    y el caso que describía —correos con documento adjunto— **no existe**, porque
    `EmailPayload.attachments` está declarado y ningún llamante adjunta nada. O sea que en la
    práctica **ningún** correo dejaba rastro: ni los de acceso, ni los de recuperación, ni las
    ofertas, ni el código de firma.
    `20270307100000` la generaliza —`documento_id` nullable, objeto polimórfico, `proposito`,
    `funcion` y el estado `simulat`— y `sendEmail()` la escribe con `service_role`.
    ⚠️ **No se guarda el asunto, y no es un olvido**: el correo del código de firma lleva las seis
    cifras en el propio `subject`, y esta tabla la lee todo el equipo. Mismo criterio que
    `bodyConsola` en `sendText()` (§9).
    ⚠️ `registrarEnvio()` **se apaga solo** si la migración no está (`42P01`/`42703`/`PGRST204`),
    avisando una vez por isolate: así función y migración se pueden desplegar en cualquier orden.
    **Lo que falta**: la pantalla. Sin ella el dato existe pero el equipo no lo ve.
26. **El registro público no tiene captcha y su límite por IP vive en memoria** (§9): se pierde en
    cada arranque en frío del isolate y no se comparte entre instancias. Lo que de verdad frena un
    abuso masivo es el tope de 20 pendientes por hora. Turnstile queda pendiente; hoy no compensa,
    porque el coste de un alta basura es una fila que el equipo rechaza con un clic.
27. **Ni el registro ni la aprobación envían correo.** `email_confirm: true` da el correo por
    verificado sin comprobarlo, así que **un error tipográfico en el correo deja la cuenta sin
    ningún canal** (y con el modo test encendido tampoco podría recuperar la contraseña, §8). Y quien
    espera validación se entera de que se la han aprobado entrando a mirar. Falta una notificación
    —que dependerá de la tabla `notificacion` con *fallback* de canal del funcional (§1bis)—.
28. ~~**El registro no deduplica contra las organizaciones existentes.**~~ — **resuelta entera
    (11-09-2026)**: `registro` consulta `v_organizaciones` y distingue los tres casos (§9), y el
    equipo **une las dos fichas desde Aprovacions** con `enllacar_organitzacio()`
    (`20270315100000`). La persona que registra ve además el motivo de su espera, con el
    `revisio_equip` que devuelve la función — las dos altas esperan al equipo, pero solo una tiene
    un motivo particular, y callárselo haría parecer que la espera es la de todo el mundo.
    ⚠️ **Enlazar resultó ser FUSIONAR, no rellenar un hueco**, y eso solo se vio al ir a
    construirlo: la etapa 2 daba por hecho que la ficha quedaba con `organizacion_id` NULL, y el
    trigger de la etapa 1 va delante y le pone una. O sea que el caso «papel nuevo» **sí producía
    el duplicado que la detección venía a evitar**, solo que con una nota que lo decía. La RPC
    mueve la ficha y sus convenios a la organización buena y retira la que se queda vacía.
    ⚠️ **Lo que NO decide la máquina**: si las dos organizaciones traen convenio vigente del mismo
    tipo, se niega y pide resolver uno antes — juntar dos acuerdos firmados no es un efecto
    colateral de un clic.
    **El deshacer tiene botón** (`EnllacOrganitzacio`, 11-09-2026): donde una ficha comparte
    organización se ofrece separarla, y eso llama a la misma RPC con `organitzacio` NULL. Va en
    **dos** sitios y por motivos distintos: en Aprovacions, porque es donde se acaba de enlazar; y
    en la **ficha del equipo**, porque un enlace equivocado se descubre semanas después, cuando ese
    registro hace mucho que no está en ninguna cola. Donde la ficha está sola en su organización no
    se pinta nada: no hay nada que separar.
29. ~~**Una ficha rechazada se queda en los listados.**~~ — **resuelta (11-09-2026)** con
    `v_productores_llistat` / `v_entidades_llistat` (`20270306100100`), que añaden la marca
    derivada `rebutjada`; los dos listados la pintan en rojo.
    **Se marca y NO se esconde**, y la diferencia importa: **el super_admin llega a la ficha
    desde ese listado** y es quien tiene que borrarla, así que esconderla convertiría el ruido
    en un residuo inalcanzable — exactamente lo que ya pasó con `email_test_recipients` (§12.33).
    ⚠️ Las vistas llevan **`security_invoker = true`**, y no es un detalle: sin él correrían con
    los permisos del propietario y **se saltarían la RLS** de las tablas de debajo, que es lo
    único que protege las 452 fichas con nombre, NIF, teléfono y dirección.
    Sigue abierto lo que la entrada decía al final: **la cuenta de Auth huérfana hay que borrarla
    aparte**, y eso no lo arregla una vista.
30. **Las contraseñas de las cuentas de prueba viajan en el bundle** con `VITE_ACCESSOS_TEST=true`
    (§6quater, §10). Está acotado y se apaga con la variable, pero mientras esté encendido cualquiera
    que abra `/login` entra como ellas. Desde el 31-07-2026 el alcance ya no es solo «organizaciones
    ficticias»: las cinco cuentas de WhatsApp (§9) enseñan **fichas de personas reales del equipo**
    —nombre, correo de trabajo y móvil—. Nunca cuentas con rol de plataforma, eso sigue vetado.
    Apagarlo al dejar de ser una demo.
31. ~~**La interfaz solo alcanza la primera organización de cada tipo.**~~ — **resuelta al revés
    de como esta entrada proponía (`20270311100000`)**, y el motivo es la medición: de **14
    membresías vivas en producción, CERO cuentas tienen dos fichas del mismo tipo**. El problema no
    existe todavía.
    Así que en vez de rehacer la navegación de los dos paneles externos para meter el `orgId` en la
    URL —el arreglo «de verdad» que pedía, para un caso que nadie ha tenido— se **impone en la base
    la invariante que el código ya asume**: índice único parcial sobre `membresias (user_id, tipo)
    where activo and aprovacio = 'aprovada'`. Si algún día hace falta de verdad, quitarlo es una
    línea, y entonces tocará hacer el selector **con un caso real delante que diga cómo debe
    comportarse**.
    ⚠️ Parcial a propósito: una membresía **rechazada o desactivada no ocupa sitio**, o alguien a
    quien se le rechazó un alta no podría volver a intentarlo.
32. **Nueve comprobaciones del arnés se quedaron sin cuenta que las recorra.** Los bloques
    `sense_rol` (3) y `pendent` (6) de `scripts/comprobar-rls.ts` siguen escritos —son la
    especificación de lo que esas cuentas deben *no* poder hacer— pero el arnés recorre las cuentas de
    `cuentas-prueba.json`, y desde el recorte del 31-07-2026 ninguna tiene esos roles: por eso la
    referencia pasó de 65/66 a **56/56 + 1 saltada**. No es un fallo de comportamiento, es
    **cobertura perdida**; el arnés sigue saltando esos bloques en silencio por no tener cuenta que
    los recorra, aunque desde el 10-09-2026 sí avisa de la cobertura que se queda huérfana **dentro**
    de un bloque que sí se recorre (§12.48). Se recupera dando de alta una organización
    por `/registre` y añadiendo su credencial con `"rol": "pendent"` (§9). Con ello, la **cola de
    «Registres pendents» también vuelve a tener con qué probarse**, que hoy está vacía.
33. 🟡 **Borrar una organización de prueba deja rastro en `email_test_recipients`.** No hay FK:
    la tabla guarda un correo suelto (§4). Pasó dos veces el 31-07-2026 y se limpió a mano.
    **Estado comprobado el 11-09-2026**: de las 11 filas de producción, **10 tienen ficha detrás**
    y la única que no —`tecnologia@espigoladors.com`, «Owner Resend (test)»— es deliberada: es el
    correo propietario de la cuenta de Resend, el único al que se entregaba antes de verificar el
    dominio. O sea que **hoy no hay ningún huérfano**.
    ⚠️ Y por eso no se puede automatizar con «borra lo que no tenga ficha»: esa regla se llevaría
    por delante justamente la fila que tiene que estar. Sigue siendo disciplina al borrar.
34. **Áreas táctiles: se subieron las cuatro que importan, no todas.** «M'interessa» (44 px en móvil),
    el `SidebarTrigger` (36), el ojo de la contraseña (de 16×16 a 32×32) y el «atrás» del detalle de
    oferta. El resto de la interfaz sigue en `h-9` (36 px), por debajo de los 44 px que recomiendan
    Apple y Google: subirlos todos es rediseñar la aplicación entera para ganar 8 px en botones
    secundarios. Los ítems de los menús desplegables (idioma, `UserMenu`) siguen en 32 px.
35. ~~**`window.prompt()` en dos sitios.**~~ — **resuelta (11-09-2026)**. Y eran **tres**, no dos:
    la entrada nombraba `productor/OfertaDetall.tsx` y `equip/Aprovacions.tsx` —este último ya se
    había arreglado por el camino— pero no los **dos de `OfferDetail.tsx`** (rechazar una
    aprobación y marcar no colocada), que nadie había anotado. Los tres usan ya el `DialegMotiu`
    que existía. `grep -rn "window.prompt" src/` no devuelve ninguno.
    ⚠️ Quedan **seis `window.confirm()`**. Ese sí devuelve un booleano y su bloqueo se comporta
    como «cancelar», que es el lado seguro; aun así son seis sitios donde el navegador integrado
    decide por la persona.
36. ~~**Las pestañas de `/registre` caben con 1 px de margen.**~~ — **resuelta (11-09-2026)**, y
    medido en Chrome real a 320 px sobre la aplicación construida, no sobre una maqueta: era **peor**
    de lo que decía la entrada. El texto «Entitat receptora» ocupaba **111,14 px** en una caja de
    contenido de **98 px**: se comía entero el `px-2` de la pastilla y se quedaba a 2,86 px del
    borde. No desbordaba la página solo porque el `grid-cols-2` de Tailwind es `minmax(0,1fr)`.
    El arreglo **no depende de la longitud del texto**, que era el criterio: se retira el
    `whitespace-nowrap` que `TabsTrigger` trae de serie, la lista puede crecer a lo alto y el botón
    puede encoger (`min-w-0`). De paso el área táctil sube de 34,5 px a 44 en móvil.
    Comprobado **dos veces y por separado**, a 320 px sobre la aplicación corriendo: con la etiqueta
    real, `white-space: normal`, 111,13 px de texto en una caja de 98 que envuelve a dos líneas y
    **0 px de desbordamiento**; y con una etiqueta inventada de 50 caracteres, la pastilla crece a
    88 px de alto, el ancho no se mueve y el desbordamiento **sigue en 0**.
37. **El aviso de instalación no se puede probar de verdad en automático.** `beforeinstallprompt` no lo
    dispara ningún navegador de escritorio ni Playwright, así que las pruebas lanzan un evento
    sintético: se verifica que **el banner reacciona**, no que Chrome lo emita. La instalación real
    solo se comprueba en un móvil.
38. ~~**`vista_defecto` se calcula en el servidor y el frontend lo descarta.**~~ — **resuelta
    (11-09-2026)**. Y no era «inofensivo» como decía esta entrada: la pantalla de perfil **deja
    escribir ese campo** (hay `grant update` desde `20260730090000:134`), así que había un ajuste
    que el usuario podía cambiar y que no hacía absolutamente nada. El comentario de `rolInicial()`
    llegó a afirmar que «`vista_defecto` manda si el usuario la ha elegido», que era falso.
    Precedencia, ahora fijada con pruebas: **el dispositivo** (`localStorage`, la decisión más
    reciente y concreta) → **la cuenta** (`vista_defecto`, que es lo que hace útil el ajuste en un
    dispositivo nuevo) → el primer panel que tenga. Un `vista_defecto` que ya no corresponde —una
    membresía retirada— se ignora en vez de mandar a una ruta denegada.
39. ~~**`crearExcedente()` no reintenta ante colisión del correlativo.**~~ — **resuelta (fase 3)**:
    `generarId()` pide el número a `siguiente_numero(prefijo, ejercicio)` en vez de contar filas con
    un `like`, y ante `23505` reintenta hasta 3 veces. El formato `E-AAMMDD-XXX-YYY-N` no cambia.
    Verificado con dos altas **en paralelo** del mismo productor y producto: `-2` y `-3`, las dos
    correctas. El comentario del fichero afirmaba desde julio que reintentaba, y no era verdad.

40. ~~**El albarán se genera con el productor en blanco.**~~ — **ya lo estaba, y el documento no
    se enteró.** `textoAlbaran()` **no existe** desde la fase 3, que lo retiró: `src/lib/textos.ts`
    solo exporta `textoRecollidaConfirmada`, que es un aviso de WhatsApp para copiar y pegar, no un
    documento. Queda el matiz de que ese aviso sigue pasando `dataHora` y `comentaris` vacíos —dos
    líneas—, pero no tiene efecto legal. Sirve de precedente: **una lista de deuda envejece en las
    dos direcciones**, y dar por buena una entrada vieja hace escribir código para un problema que
    ya no está.

41. ~~**El rebranding a Redestina es textual, no visual.**~~ — **resuelta (10-09-2026)**: sistema
    de diseño implantado (§2bis) con el logo nuevo, sus variantes, iconos PWA, favicon y
    `logo-email.png`; la barra superior de la landing es clara con el logo en color (como propone
    `design/DESIGN.md §6`) y el hero, el pie y los accesos van en verde con el negativo. Las Edge
    Functions con la plantilla de correo nueva hay que **redesplegarlas** (`/publicar`, §11) para
    que los correos salgan con los colores nuevos.
42. ~~**La infraestructura todavía responde al nombre viejo.**~~ — **resuelta (10-09-2026)**:
    proyecto de Vercel, dominio, `ALLOWED_ORIGIN`, `APP_URL`, `RESEND_FROM`, `site_url` y
    `uri_allow_list` migrados y verificados con preflight real (§10ter). Queda de rastro que
    el dominio anterior se apagó sin redirección: inocuo hoy porque no hay destinatarios reales,
    pero es la segunda vez que se usa ese argumento (§10bis).
43. ~~**`whatsapp-send` desplegada sin `verify_jwt`**~~ — **resuelta (10-09-2026)**: `config.toml`
    declaraba `verify_jwt = false` y manda sobre el CLI, así que cada `functions deploy` la dejaba
    en `false` mientras §9 y §11 decían lo contrario. No era una vía de entrada —`exigirEquipo()`
    ya respondía `401` sin sesión— pero faltaba la barrera de la plataforma *delante* de la propia.
    Puesto `verify_jwt = true` y redesplegada (v102). Verificado contra producción: sin cabecera
    `Authorization` corta la plataforma (`UNAUTHORIZED_NO_AUTH_HEADER`) antes de entrar al código;
    con el JWT de una sesión de equipo entra y actúan los gates internos (`403 no_test_user`); el
    preflight sigue devolviendo el origen correcto, porque un `OPTIONS` no lleva JWT. Las nueve
    funciones coinciden ya con §11.
44. 🟡 **Un `functions deploy` sin cambios de código no siempre dice `No change found`** —
    *ya hay forma de saberlo (11-09-2026)*: **`scripts/huellas-funciones.ts`**. Guarda el
    `ezbr_sha256` de las 14 funciones antes de desplegar y dice después cuáles cambiaron de
    verdad. Es lo que esta entrada pedía y no se había hecho por falta del valor de antes.
    ⚠️ Lo que **no** responde, y conviene no confundirlo: si el bundle desplegado coincide con
    el código del repo. Dice si **cambió entre dos momentos**, que es otra pregunta. Para lo
    primero haría falta reproducir el empaquetado byte a byte, que el CLI no ofrece.
    **Validado el 11-09-2026**: un redespliegue sin tocar nada dice `No change found` **y** deja
    las 15 huellas idénticas, así que el `ezbr_sha256` sí depende del contenido.
    ⚠️ **Y la plataforma reempaqueta por su cuenta.** El 11-09-2026, una hora después de
    desplegar solo `registro`, las **15** huellas habían cambiado respecto a la base guardada.
    No fue un despliegue mío: las 15 tenían `updated_at` **en el mismo segundo** (10:42:03), que
    es la firma de una operación de Supabase sobre todo el proyecto. Comprobado que no movió nada
    que importe —las 15 siguen `ACTIVE`, con su `verify_jwt`, y los cuatro endpoints públicos
    responden 400/200/403/401 como antes—.
    Consecuencia para leer la herramienta: **«han cambiado todas» tiene ya tres causas** y solo
    una es un problema — el `deno.lock` o un `deno.json` tocado (cambio real y esperado), un
    reempaquetado de la plataforma (nada que hacer, `updated_at` idéntico lo delata), o un
    despliegue masivo que no se pretendía. Antes de alarmarse, mirar `updated_at`.
    ⚠️ **Y `deno.lock` entra en el bundle de TODAS.** Al publicar ese día cambiaron las 14,
    incluida `descargar-documento`, que solo importa `autorizacion.ts` y `cors.ts` —ninguno
    tocado—. La causa era el `deno.lock`, que se había actualizado al instalar Vitest. Es el mismo
    caso que el `deno.json` de abajo, y sin saberlo se lee como un fallo de la herramienta: si
    cambian **todas** a la vez, mira primero el lock.
    Lo que sigue valiendo del análisis original: El
    10-09-2026, cinco funciones desplegadas hacía diez minutos volvieron a empaquetarse
    («Deploying… script size: 1.8 MB») sin que su código hubiera cambiado. Es inocuo —el
    despliegue es idempotente— pero significa que **la salida del CLI no sirve para saber si el
    bundle desplegado estaba al día**; solo `No change found` es concluyente en un sentido, y su
    ausencia no prueba nada en el otro.
    ⚠️ Y al revés, antes de leer un redespliegue masivo como un caso de esto: **el `deno.json` de
    cada función entra en su bundle**, así que tocar los nueve import maps —como hizo `6e157fe`—
    cambia las nueve de verdad, aunque el único `index.ts` modificado sea el de
    `priorizar-entidades`. Al publicarlo (10-09-2026) ninguna de las nueve dijo `No change found`, y
    eso era lo correcto. `supabase functions list` publica un `ezbr_sha256` por función: es el
    candidato a comparación fiable entre dos despliegues, pero **todavía no se ha usado así**
    —haría falta guardar el valor de antes—, así que hoy sigue sin haber forma cómoda de saberlo.
45. ~~**Las Edge Functions no se podían typecheckear.**~~ — **resuelta (10-09-2026)**: los nueve
    `deno.json` mapeaban `"@supabase/functions-js"` sin barra final, y un import map **no resuelve
    subpaths a partir de un mapping exacto**, así que `import "@supabase/functions-js/edge-runtime.d.ts"`
    —la primera línea de las nueve funciones— fallaba con `TS2307` y `deno check` moría ahí, antes
    de mirar una sola línea propia. Añadida la entrada `"@supabase/functions-js/":
    "jsr:/@supabase/functions-js@^2/"` (⚠️ con la barra **después** de `jsr:`; sin ella no resuelve).
    Las nueve pasan `deno check`. Lo que tapaba: los tres errores de la entrada 46.
46. ~~**`priorizar-entidades` tenía tres errores de tipos.**~~ — **resuelta (10-09-2026)**, y la
    causa merece recordarse porque se puede repetir en cualquier consulta: el `.select()` tenía la
    lista de columnas partida en **dos cadenas concatenadas con `+`**. supabase-js deduce el tipo de
    la fila **analizando ese literal**, y ante una expresión se rinde y devuelve `GenericStringError`
    —o sea que `entidades` dejaba de tener columnas y todo uso posterior (`e.id`, `e.telefono`)
    fallaba—. El `as unknown as EntidadPriorizable[]` de la llamada a `priorizar()` escondía la mitad
    del problema. Ver la convención del `select` en §7.
47. ~~**Las tres comprobaciones siguen sin ejecutarse solas.**~~ — **resuelta (11-09-2026)**:
    `.githooks/pre-commit` corre tipos, `vitest` y —solo si el commit toca `scripts/` o
    `supabase/functions/`— `deno check`. El arnés de RLS se queda fuera **a propósito**: necesita
    credenciales y una base viva, y un hook que falla sin red se acaba desinstalando entero.
    ⚠️ **Hay que instalarlo una vez por clon**: `git config core.hooksPath .githooks`. Git no
    ejecuta hooks versionados por su cuenta, así que en una máquina nueva no protege nada hasta
    que alguien lo haga.
48. ~~**El arnés daba por fallo lo que solo era falta de datos.**~~ — **resuelta (10-09-2026)**. El
    check «el receptor ve las ofertas compatibles» salía en rojo para el receptor comercial porque
    no hay ninguna oferta de `venda` publicada, y el arnés remataba con «Revisa las políticas antes
    de seguir» + `exit 1`. O sea que **el resultado normal se presentaba como una emergencia**, y
    solo se sabía que era inofensivo leyendo este documento. El 10-09-2026 costó una sesión: el
    arnés se dio por roto cuando estaba dando el resultado correcto.
    El fondo del asunto es que **con RLS activa un `select` que devuelve 0 filas no distingue «la
    política me bloquea» de «no hay nada que ver»**: no hay error, la política simplemente filtra.
    Marcarlo como fallo afirmaba más de lo que el arnés puede saber. Ahora esas lecturas llevan
    `requiereFixture` y salen como **saltadas**, con una línea que dice qué crear para recuperar la
    cobertura. Es la misma idea del mecanismo `vacias` que ya existía para las tablas sin filas,
    extendida al **subconjunto** que una cuenta debería ver.
    ⚠️ Lo que eso podía tapar, y por eso lleva red: el check lo comparten las dos cuentas
    receptoras, así que si RLS se rompiera y **ninguna** viera ofertas, antes habrían sido dos rojos
    y ahora serían dos saltadas silenciosas. El informe avisa aparte cuando una comprobación queda
    saltada por **todas** las cuentas de su bloque —«no las cubre nadie»—, que es la señal que de
    verdad importa. El agrupado es por bloque de la matriz y no por tabla: el check homónimo del
    equipo, que sí pasa, taparía el de los receptores.

49. ~~**El trigger de encolado de PDF no existe todavía.**~~ — **resuelta**:
    `20260928100700_jobs_documentales.sql` trae el trigger y los dos jobs (§4 «Sistema
    documental»). Sin el secreto en `app_config` son no-op con `notice`, que es lo que permite
    emitir documentos de prueba en local sin que nada salga a la red.
50. ~~**`ruta_documento()` solo resuelve `PROVA`.**~~ — **resuelta (fase 5)**: cubre los seis
    `objeto_tipo` y ya no queda ninguna rama que levante `0A000`. Cada fase rellenó la suya, que era
    el plan.

51. ~~**`reiniciar_documentos_prova()` borra las FILAS, no los objetos de Storage.**~~ —
    **resuelta (11-09-2026)** con la Edge Function **`limpiar-documentos-prueba`**, la otra mitad
    de esa RPC. Tres guardas, y ninguna es prescindible: solo lista dentro de `proves/`, solo borra
    lo que **ninguna fila reclama** —ni `documentos.ruta`, ni `documentos_externos.ruta`, ni
    `evidencias.trazo_firma_ruta`— y exige sesión de `super_admin`. Admite `{"seco": true}`.
    ⚠️ **Las tres comprobaciones de «reclamado» hacen falta, y la prueba lo demostró en vivo**: de
    los 10 objetos bajo `proves/` en local, el único protegido fue la **factura que sube el donante
    en el ensayo del cierre**, que no está en `documentos`. Con la comprobación obvia se habría
    borrado, rompiendo la conciliación del ensayo en curso.
    Ejecutada contra local: 9 huérfanos, 1,13 MB recuperados, segunda pasada a cero.
52. **El arnés, al pasar por el super_admin, borra todos los documentos `modo='prueba'`** de la
    base contra la que corre (`emitir_documento_prova` + `limpiar: reiniciar_documentos_prova`).
    Hoy es inocuo; a partir de la fase 4 no debe ejecutarse a la vez que un ciclo de cierre de
    prueba en curso, o hay que acotar la limpieza a la serie `PROVA`.
    ⚠️ **Ya ha mordido una vez**, el mismo día que se escribió: durante el spike, el arnés
    ejecutándose en paralelo hizo desaparecer los documentos que la Edge Function acababa de
    generar y devolvió el contador a `PROVA-2026-0001`. Desde fuera parecía que
    `emitir_documento_prova()` pisaba la fila anterior; no era eso —dos emisiones seguidas dan
    `0001` y `0002`, cada una con su `objeto_id`—, era el arnés limpiando. El síntoma
    característico es «mi documento estaba y ya no está».
53. **`documentos` y `documento_envios` no tienen fixture en el arnés.** Los dos checks de
    lectura del equipo salen SALTADA (§12.48) hasta que exista algún documento persistente.
    `crear-datos-documentales-prueba.ts` (fase 4) es quien los creará.
54. **Dos checks nuevos dependen de `roles_activos`.** Con el interruptor apagado —como nace
    cualquier entorno recreado desde las migraciones— `es_super_admin()` devuelve `true` para
    cualquier autenticado, así que «el equipo NO emite documentos de prueba» sale en rojo. Es el
    fail-open deliberado de §4bis, no una regresión: hay que encender el interruptor antes de
    juzgar el resultado. Está escrito en la cabecera del script.

55. **Los cuatro campos sensibles del sistema documental los protege un GRANT, no una política,
    y eso se puede deshacer sin querer.** `enlaces_token.token_hash`, `enlaces_token.codigo_hash`,
    `evidencias.documento_identidad` y `parametros_documentales.apoderada_dni` están fuera del
    GRANT de SELECT (§4). Un `grant select on all tables in schema public to authenticated`
    —exactamente la línea que ya existe en `20260721160000`— los volvería a abrir **sin que
    ninguna política cambie ni ningún test de RLS lo note**. Hoy lo vigila el arnés con cuatro
    checks dedicados; el arreglo de verdad es no volver a escribir nunca un GRANT masivo sobre
    `all tables`, y añadir el `revoke` correspondiente si alguna vez se hace.
56. ~~**`parametros_documentales` está sembrada con datos provisionales, y nada impide emitir con
    ellos.**~~ — **resuelta (fase 4)**: `emitir_certificado()` es quien lo comprueba, y levanta
    `42501` citando el CIF sembrado. Un certificado con efecto fiscal no sale con un CIF inválido.
    Sustituir los datos reales sigue siendo checkpoint de negocio (§12 checkpoint 10).

57. ~~**El recordatorio de un enlace no se puede accionar.**~~ — **resuelta (11-09-2026)**. Sigue
    yendo al equipo —el token en claro no existe y eso no cambia—, pero ahora **lleva hasta el
    sitio**: cada fila tiene su enlace a `/equip/convenis/<id>` o `/equip/albarans/<id>`, que es
    donde `enviar_convenio()` y `marcar_entregado()` emiten uno nuevo, y dice qué hay que hacer.
    Y **se identifica por el número, no por un trozo de uuid**: `ENT-2026-00042`, o el tipo del
    convenio cuando todavía no tiene número —se pide al firmar—.
    No hizo falta ninguna RPC nueva: las dos ya existían, cableadas y con pantalla. Lo único que
    faltaba era el enlace.
58. ~~**`MAX_POR_EJECUCION = 50` es un tope silencioso.**~~ — **resuelta (11-09-2026)**: el tope
    sigue en 50 —acota el coste del gate y para un recordatorio es intrascendente— pero ahora **se
    dice** en tres sitios: campo propio `limit: {tope, enllacos, factures, retallat}` en la
    respuesta, `console.warn` con `avis: "limit_execucio"` para poder filtrarlo por nivel, y un
    recuadro en el propio correo. Una lista recortada que no lo dice se lee como completa.
59. ~~**El camino de envío de los recordatorios no tiene prueba automática sin stub.**~~ —
    **resuelta (11-09-2026)** con `RESEND_ENVIO_REAL` (deuda 73). Ejercitado en local sin ningún
    stub: `{"ok":true,"revisados":1,"avisados":1,…}`. Ese `avisados: 1` era justo lo inalcanzable,
    porque el contador solo se mueve si el correo salió y en local nunca salía.

60. ~~**El bloque de conformidad de los albaranes se imprime siempre en blanco.**~~ — **resuelta
    (11-09-2026)**, y el arreglo «evidente» no habría servido de nada: ⚠️ el snapshot se congela
    **al emitir**, y `marcar_entregado()` exige `estado='emitido'`, así que cuando llega la
    confirmación `documentos.datos` lleva rato siendo inmutable. Meter las evidencias en
    `albaran_datos()` no arregla ningún PDF existente. Se leen con `service_role` desde
    `generar-documento`, que es el camino que el convenio ya usaba.
    El OPE se resuelve gracias a **`rol_parte`** (deuda 68, de la misma tanda): cada confirmación
    se casa con su espacio. ⚠️ Una confirmación **sin rol** —los enlaces anteriores a esa
    migración— **no se atribuye a nadie**: se lista aparte. Ponerla bajo «Entrega» sin saberlo
    sería inventarse quién firmó qué en un documento legal.
    **La IP y el user-agent no se imprimen**: el albarán lo descarga también la otra parte, el
    texto legal ya dice que quedan registrados, y `evidencias` es donde se consultan.
    Coste medido: **+1,3 ms** en un OPE con dos confirmaciones y **0 ms** en un ENT, más ~5 ms de
    las dos consultas — sobre los 174 ms de `ms_render` de §12.87.
61. ~~**El REC de una espigolada imprime el UUID de la jornada.**~~ — **resuelta
    (`20270304100100`)**: `albaran_datos()` pone `coalesce(espigoladas.ref_externa, id::text)`. Solo
    afecta a lo que se emita desde ahora: un snapshot ya congelado no cambia, ni debe.
    ⚠️ El arreglo **solo luce si el equipo rellena `ref_externa`**, que es opcional y hoy está vacía
    casi siempre; el `coalesce` deja el UUID donde no la haya.
62. ~~**`subir-documento-externo` compone a mano la hoja del nombre de fichero.**~~ — **resuelta
    (`20270304100000`)**: `ruta_documento_externo()` devuelve la ruta entera. Y eran **dos**
    consumidores, no uno: la subida de factura de `enlace-publico` hacía exactamente el mismo apaño
    y no estaba anotada.
    Verificado lo que de verdad importaba: **la ruta generada es idéntica a la de antes en los 12
    objetos de la base local** (ENT, OPE, REC y tres cierres en modo prueba, incluido un albarán sin
    ejercicio). Si no lo fuera, los ficheros ya subidos quedarían en una carpeta y los nuevos en
    otra.
63. **Las herramientas locales asumen un único operador, y con agentes en paralelo eso rompe.** Dos
    casos vistos el mismo día: el arnés borrando los documentos de prueba que otro acababa de
    generar (deuda 52), y **dos `supabase functions serve` a la vez**, que no caben porque el
    runtime es un contenedor de Docker con nombre fijo por proyecto
    (`supabase_edge_runtime_<proyecto>`) — el segundo muere con `Conflict … already in use` y puede
    dejar el primero colgado en un estado que ni `docker rm -f` deshace. Regla: el serve lo levanta
    quien va a probar, y no se mantiene uno de fondo. Alternativa cuando el contenedor está
    inservible: probar las funciones con `deno run` directo contra la base local —mismo código y
    HTTP real—, que es como se verificó la fase 3.

64. ~~**`/equip/espigolades` no tiene listado.**~~ — **resuelta (11-09-2026)**: tercera pantalla
    en `Espigolades.tsx`, con buscador y las columnas que sirven para encontrar una jornada (data,
    productor, referència, registres, quilos, estat). El menú ya apunta al listado y no al alta, y
    el «Enrere» del detalle vuelve a las espigoladas en vez de a los albaranes, que era el sitio
    menos malo mientras no había listado.
    Las tres consultas están acotadas a lo que sale en pantalla —los nombres se piden con `.in()`
    sobre los `productor_id` visibles, no las 343 fichas—, pero **el listado sigue sin paginar**,
    como el resto: eso es §12.5.
65. ~~**El panel no sube documentos externos.**~~ — **resuelta (11-09-2026)**: formulario en la
    ficha del albarán, con el mismo patrón que el del productor. No hizo falta tocar el servidor:
    `subir-documento-externo` ya aceptaba `objeto_tipo: 'albaran'`.
    ⚠️ **`factura` NO está entre las opciones, a propósito**: una factura es del cierre anual del
    donante, y colgarla de un albarán la dejaría fuera de `registrar_factura()`.
    Sigue sin poderse **borrar ni descargar** un externo desde ahí: `documentos_externos` no tiene
    RPC de borrado y `descargar-documento` solo sirve `documentos`. Se decide en la base, no en la
    pantalla.
66. **«Amb discrepància» es un filtro, no un veredicto.** `v_albaranes_bandeja` solo sabe si hubo
    rechazo o si lo confirmado no cuadra con el neto de ese albarán; la diferencia real la calcula
    `propuesta_conciliacion()` cruzando el REC con todos sus ENT, y eso sería una llamada por fila.
67. **Rectificar solo permite corregir `kg_neto` por línea**, no el producto ni las cajas. Es lo que
    se rectifica en la práctica, y evita meter un segundo editor completo dentro de un diálogo.
68. 🟡 **El OPE no distingue sus dos confirmaciones** — *resuelto en la base
    (`20270304100200`)*: `enlaces_token.rol_parte` y `marcar_entregado()` escribiéndolo en las tres
    ramas, con el mismo vocabulario que `albaranes.partes`. **Queda que la ficha lo pinte**,
    aguantando el `null` de los enlaces anteriores: en REC y ENT la parte se deduce del tipo del
    albarán, pero en un OPE viejo no hay de dónde sacarla.

69. 🟡 **La fecha del cierre ya se escribe, pero solo la de la entrega.** `emitir_albaran()` rellena
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
71. **No hay plantillas `RES` ni `CD` sembradas** (el texto es material de la fase 0), así que
    `documentos.plantilla_id` sale `null` en los dos, igual que en REC/ENT/OPE.
72. **`abrir_cierre` no se puede probar como «permitir» en el arnés**: dejaría una cabecera de
    cierre y no hay RPC que la borre. Se cubre por el lado del «denegar», y con
    `reiniciar_cierre_prueba`/`conciliacion_retroactiva` sobre un uuid inventado.

73. ~~**`sendEmail()` no tiene modo simulado.**~~ — **resuelta (11-09-2026)**: existe
    **`RESEND_ENVIO_REAL`**, gemelo exacto del de WhatsApp. Mientras no valga `"true"` exacto no
    sale nada y se devuelve `{simulado:true}`; la comprobación va **antes** de mirar
    `RESEND_API_KEY`, para que en local sin clave funcione el camino entero.
    La decisión está aislada en `esEnvioReal()`, que es pura y **tiene pruebas** —incluido que
    `TRUE`, `1`, `yes` y `" true"` no encienden nada—. El interruptor de WhatsApp lleva desde julio
    sin nadie que lo vigile; este no.
    🔴 **El secreto va ANTES del despliegue.** Si se redespliegan las cinco funciones que mandan
    correo sin crearlo, **el correo se apaga entero y en silencio** — incluido
    `recuperar-password`, o sea que alguien puede quedarse fuera de la aplicación sin ningún
    mensaje de error.
74. ~~**El recordatorio al donante no lleva enlace.**~~ — **resuelta (11-09-2026)**: el botón del
    correo apunta a `/productor/documents`, que es donde está el formulario de subida (§12.65) y
    donde `puc_pujar_document_extern()` resuelve el permiso. Sin sesión aterriza en el login, que
    sigue siendo el camino.
75. **`documentos.envio` guarda el token en claro y `GRANT select on documentos` es por tabla**, así
    que el donante puede leer su propio token. Es inocuo —es suyo— pero **`envio` no debe pintarse
    tal cual en ninguna pantalla**, y el día que guarde algo de otra persona habrá que pasarlo a
    GRANT por columnas.
76. **La filigrana de los documentos de prueba no se puede comprobar con un `grep` literal**:
    `pdftotext` la trocea porque va girada 45°. Cualquier verificación automática tiene que buscar
    fragmentos (`PR`, `O`, `V`, `A`…), no la frase entera.

77. **El texto de los seis convenios no está validado por la asesoría** (§4). Se siembra texto de
    trabajo marcado como borrador para poder probar el circuito antes de la fase 0. Sustituirlo es
    publicar la versión 2 y retirar la 1, **no editar la existente**: en cuanto una plantilla ha
    emitido algo, el trigger la congela.
78. ~~**`aprovar_resposta()` no puede devolver el aviso de convenio.**~~ — **resuelta
    (11-09-2026)**: `OfferDetail` llama a `convenio_vigente()` para las dos partes **antes** de
    aprobar y enseña qué convenio falta, con confirmación. La limitación de la RPC sigue ahí —su
    tipo de retorno es `canalizaciones` y el `raise notice` lo descarta PostgREST—, pero ya no tiene
    consecuencia: el aviso llega por delante y el bloqueo duro (`42501 sense_conveni`, desde la
    fecha de corte) se traduce a un mensaje propio en vez de soltar el error crudo.
    De paso se estrenó `conveniVigent()` de `src/lib/convenis.ts`, que llevaba escrito desde la
    fase 2 **sin que lo llamara nadie**.
79. ~~**Una organización con doble rol necesita dos convenios.**~~ — **resuelta
    (`20270312100000`)**, y la entrada era cierta **solo a medias**. Mirando `convenios_exigidos`:
    en **donación** son **dos tipos distintos** (`don_gen` a quien entrega, `don_rec` a quien
    recibe), así que una organización que dona y recibe firma los dos **con razón** y ahí no había
    nada que arreglar. La redundancia estaba en **venta y maquila**, donde las dos partes necesitan
    el **mismo** tipo `com`: con el índice por ficha, una organización de doble rol firmaba **dos
    veces el mismo acuerdo**. Ahora el índice único y `convenio_vigente()` van por
    `organizacion_id`, resolviendo la ficha con `organizacion_de()`.
    `productor_id` y `entidad_id` **se quedan**, y no por compatibilidad: dicen **con qué papel** se
    firmó, que es lo que congela `datos_org`.
    ⚠️ **Se hizo ahora porque salía gratis: en producción hay CERO convenios**, así que no se migró
    ningún documento firmado. El día que haya cientos, esto sería una migración de documentos legales.
    🟠 **Lleva dentro una decisión de negocio sin confirmar**: se asume que el convenio comercial
    `com` es **uno por organización** y cubre su compra y su venta, no uno por papel. Es la lectura
    natural y encaja con que la matriz pida el mismo tipo a las dos partes, pero **es una lectura**.
    Si la asesoría dice otra cosa se revierte con dos líneas, y sin datos que rehacer mientras no se
    firme nada. Va con los textos de los convenios, que tampoco están validados (§12.77).
80. **El DNI del firmante no entra en `documentos.datos` aunque el PDF lo imprima.** `documentos`
    tiene `grant select` sobre la tabla entera, así que meterlo ahí deshacía el GRANT por columnas
    de `evidencias`. El renderizador lo lee de `evidencias` con `service_role`. **Precio conocido:
    `sha256_datos` no cubre ese dato**, así que la huella del snapshot no prueba qué documento de
    identidad se declaró — eso lo prueba la fila de `evidencias`.

81. **`sense_conveni` de `priorizar-entidades` replica la resta, no la regla.** Para no llamar a
    `convenio_vigente()` 111 veces por oferta, lee `convenios_exigidos` y los convenios vigentes y
    calcula la diferencia en TypeScript. La regla sigue en la tabla y la autoridad sigue siendo la
    RPC (`exigir_convenio`): una divergencia solo produce un aviso de más o de menos en el panel.
82. ⚠️ **Un agente NO debe hacer `git checkout` de un fichero compartido para restaurar su entorno
    de pruebas.** *(Y desde el 11-09-2026 hay red: `tests/cobertura.test.ts` comprueba que cada
    entrada del menú tiene ruta, que cada ruta resuelve a un fichero y que **toda clave i18n usada
    existe en los dos idiomas**. Se ganó el sueldo el primer día: cazó 17 claves que dos pantallas
    nuevas usaban sin definir, con nombre y fichero, en vez de que salieran en producción como
    identificadores crudos en el menú. La obligación de «auditar antes de cada commit» dependía de
    que alguien se acordara; ahora la ejecuta `npm run check`.)* Pasó el 10-09-2026 y costó trabajo: un agente montó rutas e i18n temporales para
    poder medir, y al terminar restauró `src/router/index.tsx` y `src/lib/i18n.tsx` con
    `git checkout` — llevándose por delante la integración de la fase 4 que estaba en el árbol sin
    commitear. **El build no lo detecta**: unas rutas que no existen y unas claves que faltan
    compilan igual, así que se commiteó una fase entera con sus pantallas inalcanzables. Lo cazó el
    intento de integrar la fase siguiente. Regla: quien toque un fichero compartido guarda **copia
    del contenido** y restaura esa copia, nunca la versión de git; y el orquestador **audita
    cobertura de rutas y de claves** antes de cada commit, no solo el build. Es la tercera cara de
    la deuda 63: las herramientas locales asumen un único operador.

83. **`cierre_donante_lineas.albaran_rec_id` guarda el OPE en las líneas de transacción.** El
    nombre se queda corto desde que el CT reutiliza el motor del cierre; renombrarlo obligaría a
    reescribir también el circuito de donaciones, así que se deja anotado.
84. **No hay plantillas `CT` ni `PLA`** en `plantillas_documento`, como tampoco las hay de REC, ENT,
    OPE, CONV, RES ni CD: los textos son material de la fase 0. `documentos.plantilla_id` queda
    `null` y el renderizador imprime su texto de trabajo con el aviso.

85. **El certificado de transacción no tiene prueba end-to-end.** `emitir_certificado_transaccion`
    aborta con `42501` porque el fixture deja `datos_provisionales = true` —que es la barrera
    funcionando, no un fallo—, así que no hay ninguna fila `documentos` de tipo `CT` que generar. El
    renderizador se probó en directo y el despacho son ocho líneas. Se cierra el día que el fixture
    pueda desmarcar el flag, o con los datos reales de la Fundación.
86. ~~**No hay rectificativo del CT.**~~ — **resuelto (11-09-2026)**: existe
    `rectificar_certificado_transaccion()`. La entrada decía que el CT «no entra en el ciclo del 182,
    así que no se finge que exista un R-CT», y eso sigue siendo cierto —**no hay serie `R-CT`**—,
    pero de ahí no se seguía que un CT con un error tuviera que quedarse sin salida. Rectifica como
    el CD: misma numeración, versión siguiente, sin consumir número.

87. ~~**El CPU real de `generar-documento` sigue sin medirse con precisión.**~~ — **medido
    (11-09-2026)**. El criterio de salida del spike queda cerrado, con un margen cómodo pero no
    enorme. Documento de 6 páginas y 123.614 bytes en producción: **`ms_render` 174,3 ms**
    (presupuesto del spike: 800 ms), `ms_activos` 1 ms con los activos ya en caliente,
    `ms_subida` 107,8 ms y `ms_total` 462,6 ms. El runtime declara en su `shutdown`
    **`cpu_time_used` 390 ms** y 22 MB: un **19,5 %** del techo de 2 s de CPU y un 8,7 % de los
    256 MB. Cinco generaciones reales medidas dan **325-572 ms de CPU**, así que ese es el orden
    de magnitud a asumir para un documento de 6 páginas; los convenios de 8-10 páginas de la
    fase 2 no tienen un factor 10 de margen, tienen un factor 4.
    ⚠️ **`cpu_time_used` es del ISOLATE entero, no de la petición**: cubre el arranque, la
    evaluación de módulos con `pdf-lib` dentro, la petición, la subida y las RPC. Por eso sale
    **mayor** que `ms_render`, que solo mide maquetar el PDF, aunque una sea CPU y el otro reloj
    de pared.
    ⚠️ **Hay que cruzar por `execution_id`, no coger el `shutdown` más reciente.** La primera
    lectura de este dato dio 72 ms y era de otro isolate: el del cron `documentos-pendientes`,
    que arranca cada 5 min, no encuentra nada y se apaga. Esos no-op gastan **33-77 ms**, o sea
    que un valor de esa horquilla es la señal característica de haber leído el isolate
    equivocado. El `shutdown` bueno llega **minutos después** del log de la generación (el
    isolate sigue vivo esperando más peticiones), así que no es ni siquiera el siguiente.
    ⚠️ **Una emisión puede ejecutarse dos veces, en dos regiones.** Dos de las tres generaciones
    de la publicación salen con el mismo `documento` y distinto `execution_id` en `eu-west-1` y
    `eu-west-3`, con un segundo de diferencia; la de después tuvo una sola. No pasa nada porque
    la función es idempotente (con `fichero_at` ya puesto responde 200 sin hacer nada) —que es
    justo para lo que se escribió esa guarda—, pero esa emisión costó el doble y la causa no
    está averiguada.
88. ~~**Los tres PDF de la prueba de publicación quedan huérfanos en `proves/2026/PROVA/`.**~~ —
    **borrados en producción (11-09-2026)** con `limpiar-documentos-prueba` (deuda 51):
    `PROVA-2026-0001/0002/0003-v1.pdf`, **370.801 bytes**. En seco primero —3 revisados, 3
    huérfanos, 0 borrados—, comprobado que ninguna fila los reclamaba, y después de verdad. La
    segunda pasada encuentra 0, así que es idempotente y `proves/` queda vacío.
89. ~~**Un corte por CPU no encendía ninguna luz, y además no paraba nunca.**~~ — **resuelto
    (11-09-2026, `20270302100000_documentos_encallados.sql`)**. Al medir el CPU de verdad (§12.87)
    se vio que el único fallo del que se hablaba era justo el único que el circuito no sabía
    contar. Si el runtime corta la generación por pasarse de los 2 s, **mata el isolate a mitad**:
    no hay excepción que capturar, el `catch` de `generar-documento` no llega a llamar a
    `marcar_documento_error()` y la fila se queda en `pendiente_fichero` con `ultimo_error` NULL.
    Dos consecuencias, las dos encontradas leyendo el código con la medición delante, no probando:
    **(1)** el contador del menú y el filtro de la bandeja miran `estado = 'error'`, así que ese
    documento desaparecía en silencio —quien lo emitió veía «no s'ha pogut generar» a los 30 s de
    polling y el equipo no veía nada—; **(2)** el tope de `intentos < 5` del job **no lo acotaba**,
    porque `intentos` solo sube cuando la función reporta: se quedaba en 0 y el job reencolaba
    cada 5 minutos para siempre, 288 llamadas al día muriendo igual. El comentario de
    `20260928100700` daba ese caso por cubierto y no lo estaba.
    Arreglo: `documentos.reencolados` cuenta los intentos del job **contesten o no**, y al agotar
    cualquiera de los dos topes el job marca `error` con el motivo escrito (§4, «Jobs»). Verificado
    en local: cinco pasadas suben el contador, la sexta da el documento por perdido y la séptima ya
    no lo toca; un error reportado de verdad conserva su mensaje y sigue reintentándose.
    `generar-documento` emite además `console.warn` con `avis: "render_lent"` por encima de 800 ms
    de `ms_render` — un aviso **anticipado**, porque el día que se pase del techo real no habrá log
    que mirar.
    ⚠️ Lo que **no** cubre: si el corte pasa con el tope ya agotado por otra causa, el motivo que
    se conserva es el primero (el `coalesce` no pisa un `ultimo_error` que ya existía). Y el umbral
    de 800 ms es el presupuesto del spike, no el límite: entre ese aviso y la muerte real hay
    margen, que es justo para lo que sirve.

90. 🟠 **Una espigolada con dos registros del mismo producto contaría los kilos dos veces.**
    El reparto del neto del REC particiona por `excedente_id`, y en una espigolada el REC cuelga de
    la **jornada** y se empareja con los registros **por producto**. Si una misma jornada tuviera dos
    registros del mismo producto, cada uno recibiría el neto entero de esa línea del REC.
    La clave correcta sería `(albaran_rec_id, producto)`, pero cambiarla altera el **cierre anual**,
    que ya ha calculado con la actual — es una decisión aparte y con el equipo delante, no un
    arreglo de paso. Encontrado al arreglar el reparto por ventanas (`20270303100000`), donde queda
    anotado en la cabecera. **No se ha dado todavía**: hoy ninguna jornada tiene dos registros del
    mismo producto.

91. **La detección de organización del registro tiene dos puntos ciegos conocidos, los dos hacia el
    lado seguro.** Solo mira `entidades.telefono` (no `telefono2`/`telefono3`), igual que la
    migración de la etapa 1; y el filtro que va a la consulta es un regex tolerante a separadores
    anclado al FINAL del campo, así que un teléfono guardado en medio de texto
    (`612345678 / 933000000`) no se encuentra. Los dos fallos producen un **duplicado que ve el
    equipo, nunca una fusión equivocada**, que es el orden correcto de preferencias. El arreglo de
    verdad es una columna normalizada o un índice funcional sobre las últimas 9 cifras, no más
    expresiones regulares.

## 12bis. Decisiones con precio conocido, y lo que espera a otro

Índice de las entradas de §12 que **no son defectos pendientes**. Se quedan donde están —con su
número, que el código cita— pero conviene saber qué se está mirando antes de intentar arreglarlas.

### Decisiones deliberadas: se tomaron sabiendo lo que costaban

| # | La decisión | El precio que se aceptó |
|---|---|---|
| 10 | No editar migraciones ya aplicadas | Hay `truncate` mezclado con DDL en el histórico. Editarlas está prohibido (§7) |
| 12 | No reponderar `prioritat` | 97 de 111 entidades son prioridad 1: aporta poco al ranking, y arreglarlo es trabajo de negocio |
| 24 | Replica identity por defecto | Los DELETE de Realtime se reparten sin evaluar RLS. Hoy el payload es solo un id |
| 26 | Sin captcha en el registro | Turnstile es un servicio externo y §7 lo prohíbe. Lo que frena un abuso masivo es el tope durable, no el límite por IP |
| 34 | Áreas táctiles de 36 px salvo en cuatro sitios | Subirlas todas es rediseñar la aplicación entera para ganar 8 px en botones secundarios |
| 37 | El aviso de instalación se prueba con un evento sintético | `beforeinstallprompt` no lo dispara ningún navegador de escritorio. La instalación real solo se comprueba en un móvil |
| 54 | El fail-open de `roles_activos` | Con el interruptor apagado dos checks del arnés salen en rojo. Es el fail-open de §4bis, no una regresión |
| 63 | Las herramientas locales asumen un operador | Un `functions serve` por vez, y el arnés borra los documentos de prueba de quien sea |
| 66 | «Amb discrepància» es un filtro, no un veredicto | El veredicto real exigiría una llamada por fila |
| 67 | Rectificar solo corrige `kg_neto` | Es lo que se rectifica en la práctica; lo demás sería un segundo editor dentro de un diálogo |
| 70 | Los kilos por línea del cierre son derivados | D13 manda certificar el neto del REC; las líneas tienen que ser por canalización. **El total del donante es exacto** |
| 76 | La filigrana no se puede comprobar con un `grep` | `pdftotext` la trocea porque va girada 45° |
| 80 | El DNI del firmante fuera de `documentos.datos` | `sha256_datos` no lo cubre; lo prueba la fila de `evidencias` |
| 81 | `sense_conveni` replica la resta, no la regla | Evita 111 llamadas por oferta. La autoridad sigue siendo la RPC |
| 82 | Regla de trabajo, no deuda | Un agente no hace `git checkout` de un fichero compartido |
| 83 | `albaran_rec_id` guarda el OPE en las líneas de transacción | Renombrarlo obligaría a reescribir también el circuito de donaciones |
| 86 | No hay rectificativo del CT | El CD lo tiene porque el 182 lo exige; el CT no entra en ese ciclo |

### Espera material de la fase 0 o de un tercero

| # | Qué falta | De quién depende |
|---|---|---|
| 15 · 17 | Plantillas aprobadas y el paso a producción de Meta | **Meta** |
| 71 · 77 · 84 | Los textos legales de RES, CD, CT, PLA y los seis convenios | **La asesoría** |
| 85 | Prueba end-to-end del CT | Bloqueada por `datos_provisionales`, que es la barrera funcionando |

### Son interruptores de producción, no código

| # | Qué |
|---|---|
| 4 | `disponible_hasta` cuando el texto no es fechable: lo normaliza el panel |
| 30 | `VITE_ACCESSOS_TEST` — apagarlo es decisión de negocio |
| 72 | `abrir_cierre` no se prueba como «permitir» porque dejaría una cabecera sin forma de borrarla |

## 13. Al terminar cualquier cambio

1. **`npm run check`** en verde: tipos de la aplicación **y de las pruebas**, `vitest run` y
   `deno check` de los scripts y las 14 funciones. Sustituye a lanzar los tres a mano.
   Referencia: **430 pruebas en 15 ficheros**, todas correctas y ninguna pendiente.
   El hook de `.githooks/pre-commit` hace lo mismo antes de cada commit, si está instalado
   (`git config core.hooksPath .githooks`, una vez por clon).
2. `npm run build` si el cambio toca `src/`: `tsc` ya va en `check`, pero el empaquetado no.
3. `deno run -A scripts/comprobar-rls.ts` si el cambio toca datos, políticas o roles, y
   `deno run -A scripts/prueba-numeracion.ts` si toca la numeración documental.
   Referencia en **remoto**, fijada tras publicar la etapa 3 de la organización unificada
   (11-09-2026): **442/442 correctas y 52 saltadas**, «Sin fallos de permisos», exit 0. (Era
   432/432 + 52 antes de las guardas de `enllacar_organitzacio` y `organitzacions_candidates`;
   408/408 antes de los checks de `organizaciones` y `v_organizaciones`, que hasta esa publicación
   no tenían tabla contra la que correr en remoto; y 329/329 + 46 antes del certificado a demanda.) Las saltadas son
   normales: producción no tiene —ni debe tener— el fixture de
   `crear-datos-documentales-prueba.ts`, así que los checks que necesitan albaranes, cierres o
   convenios de prueba no tienen qué mirar.
   Referencia en **local** con el fixture (`crear-usuarios-prueba.ts` +
   `crear-datos-documentales-prueba.ts`) y `roles_activos` en `true`: **411 comprobaciones, todas
   correctas y 15 saltadas** por falta de datos, terminando en «Sin fallos de permisos» con código
   de salida 0.
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
