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
`redestina-automatizacion-canalizacion-whatsapp-final.md` manda en el proceso de canalización y
trae los prompts 0–8; `manual-whatsapp-cloud-api-supabase-final.md` manda en la
configuración de Meta y las decisiones D1–D7; `guia-tecnica-claude-code-whatsapp-final.md`
es el mapa de ejecución. El **funcional de negocio** (visión objetivo del servicio, más amplia
que lo construido) vive en `docs/Documento funcional Redestina 2026.md` y su **versión adaptada al
estado real** en `docs/Documento funcional Redestina 2026 — adaptado.md` (ambos fuera de git); su
resumen y la correspondencia objetivo↔construido están en **§1bis**.

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
| `convenio` de colaboración | — | ⬜ |
| `excedente` | `excedentes` | ✅ |
| `demanda` | — | ⬜ |
| `interes` (solicitud de receptor) | `oferta_respuestas` (aceptación con kg/preu + aprobación del superadmin → canalización) | 🟡 |
| `sugerencia_match` persistida | `priorizar-entidades` (Edge Function pura, no persiste) | 🟡 |
| `operacion`/`entrega` (lotes; kg prev/recib/valid) | `canalizaciones` (por entidad; `kg_confirmados`/`kg_reales`) | 🟡 |
| `albaran`/`albaran_linea` (serie, estados, QR) | texto *placeholder* (`src/lib/textos.ts`) | ⬜ |
| `documento_externo` | — | ⬜ |
| `documento` / **certificados** | — | ⬜ |
| `conversacion`/`mensaje`/`adjunto` | `wa_contacts`/`wa_messages` (sin adjuntos) | 🟡 |
| `plantilla_mensaje` (tabla) | plantillas en código (`plantillas-meta.md`, `plantillas.ts`) | 🟡 |
| `notificacion` (+ *fallback* de canal) | — (envíos directos) | ⬜ |
| `encuesta_satisfaccion` | — | ⬜ |
| `diagnostico`/`plan_prevencion`/`plan_revision` | — | ⬜ |
| `derivacion_espigueo` | — | ⬜ |
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
| valor económico | `valor_eur = kg × eur_kg` (plano 1 €/kg) | 🟡 |
| vistas/indicadores (`v_kpi_subvencion`…) | `Dashboard` agrega en cliente | 🟡 |

**Brechas mayores pendientes** (orden aproximado de dependencia): ~~(1) roles y permisos~~ **resuelta**
(§4bis) → (2) organización unificada multirol + `usuario` → (3) back office 🟡 (ya hay cola de
aprobaciones y validación de altas; faltan convenios y verificación) → (4) onboarding 🟡 (ya hay alta
self-service validada; falta el **convenio** y avisar por correo de la validación) → (5) demandas →
(6) albaranes/conciliación real → **certificados** → (7) notificaciones + encuestas → (8) adjuntos de
WhatsApp → (9) diagnóstico/planes → (10) espigueo, catálogo público, calendario y mapa → (11) vistas
SQL + `historial_estado`. La más urgente ahora es la **organización unificada multirol**: mientras
`productores` y `entidades` sean dos tablas sin clave común, el registro público no puede detectar
que una organización ya existe (deuda §12.28).

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
`src/components/ui/` (generados con el CLI de shadcn, `components.json`), tokens del **tema Redestina**
en `src/index.css` (navy `#234C66` / crema `#E0EBC7` / coral `#EE7A5F`, fuente Space Grotesk),
alias `@/` → `src/`. Iconos `lucide-react`, toasts `sonner`, `cn()` en `src/lib/utils.ts`. El
logo (`public/logo-redestina.svg`) y el favicon están en `public/`.

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
(generados desde `public/logo-redestina.svg`), `apple-touch-icon` y los metas de iOS —que no lee el
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

## 3. Estructura

```text
index.html
vercel.json                    Rewrite de SPA (sin él, recargar una ruta profunda da 404)
.env.local.example             Plantilla de variables del frontend (sí se versiona)
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
                               Registre (/registre) y RestablirClau (/restablir) — §6quater
  routes/PerfilOrganitzacio.tsx  Ficha propia, escrita por RPC con lista blanca
  routes/equip/                Envoltorios de las pantallas que ya existían + Aprovacions
  routes/productor/            Inicio, listado, alta de oferta y detalle
  routes/receptor/             Mercat, interessos i històric
  types.ts                     Tipos de todas las tablas
  index.css                    Todos los estilos (global, ~825 líneas)
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
    email.ts                   enviarEmail(): llama a la Edge Function enviar-email
    i18n.tsx                   Sistema de traducciones (ca/es, per defecte ca; useT, §7)
    accessosTest.ts            Credenciales de las cuentas de prueba para /login (§6quater)
    utils.ts                   cn() (shadcn)
    crudCampos.ts              Definiciones de campos para el CRUD (claves i18n f.*)
    textos.ts                  RECOLLIDA CONFIRMADA y albarán (los compone el panel)
  components/
    AvisInstallacio.tsx        Banner de «instal·la Redestina» en móvil, productor y receptor (§2)
    LayoutAcces.tsx            Marco navy de las pantallas de acceso (+ ComprovantSessio)
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
  roles-activos.ts             Interruptor del modelo de roles: on | off | estat (§4bis)
  diagnostico-whatsapp.ts      Interroga la Graph API y distingue token caducado / número / permisos (§8ter)
  sql/rls-emergencia.sql       Paracaídas: restaura las políticas permisivas (NO es migración)
  data/                        Los CSV — IGNORADO POR GIT (datos personales, §7)
supabase/
  config.toml                  Config del CLI (puertos 553xx, ver §7)
  migrations/*.sql             Migraciones versionadas
  functions/
    _shared/whatsapp.ts        Graph API + interruptor de envío (texto/plantilla/interactivos)
    _shared/intake.ts          Motor conversacional (máquina de estados)
    _shared/oferta.ts          crearExcedente(): id_excedente + texto "OFERTA DISPONIBLE"
    _shared/camposOferta.ts    Los 14 pasos, compartidos por el intake y el panel (§6bis)
    crear-oferta/index.ts      GET /campos (descriptor) + POST (alta desde el panel del productor)
    _shared/priorizacion.ts    Puntuación de entidades (pura, sin red)
    _shared/respuestas.ts      Captura el sí/no de una entidad a una oferta (aceptación, §5)
    _shared/gate.ts            Gate de envío: quién PUEDE recibir (es_test, cuenta) + modoTestActivo (§8)
    _shared/canal.ts           Política de canal: por dónde se contacta; el correo es el defecto (§8bis)
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
| `cancelar_meva_oferta(excedente, motiu)` | El productor cancela la suya. Editarla no: el `texto_oferta` ya circuló |
| `aprovar_registre(membresia)` / `rebutjar_registre(membresia, motiu)` | Validan un alta del registro público (`20260731100000`). Exigen `pot_aprovar()` (42501), bloquean la fila con `for update` y solo actúan sobre `pendent` (22023). **Rechazar no borra nada**: queda la auditoría y la persona ve el motivo |

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

`deno run -A scripts/comprobar-rls.ts` (§11): abre sesión real con cada cuenta —con la publishable
key, como el navegador— y comprueba una matriz declarativa de *(cuenta, tabla, operación) →
permitir/denegar*. Es la primera comprobación automática del proyecto que no es `tsc`. Las
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
| **Equip** (`intern`) | `/equip/tauler · ofertes[/:id] · aprovacions · productors[/:id] · entitats[/:id] · missatgeria[/:phone] · configuracio` | Todo lo que ya existía, más la **cola global de aprobaciones** |
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
- **`docs/` y `scripts/data/` nunca entran en git.** El primero es material de trabajo —incluye el
  **funcional de negocio** (`Documento funcional Redestina 2026.md` y `Documento funcional Redestina 2026 —
  adaptado.md`, resumidos en §1bis), `nuevas-funcionalidades/` y los seis documentos operativos
  de §1 (guía de producción de WhatsApp + su HTML visual, costes, flujo de la aplicación y los dos
  de **usuarios, con contraseñas en claro**)—; el segundo son datos personales
  (teléfonos, emails y NIF de ~450 personas y entidades). `.env.local.example` sí se versiona: es la
  plantilla, sin valores.
- **Claves de Supabase**: usar las **nuevas** — `sb_publishable_...` en el frontend,
  `sb_secret_...` en el servidor. **No** usar las obsoletas `anon`/`service_role` (claves JWT
  antiguas). Los *roles* de Postgres `anon`/`authenticated`/`service_role` sí se siguen usando
  en RLS: no confundir rol con clave.
- **Errores**: `sendWhatsApp()` nunca lanza; devuelve `{ ok, status, data }`. El mapeo a texto
  legible vive en `noticeFromError()` (`Conversation.tsx`), que cubre los códigos propios
  (`window_closed`, `no_opt_in`, `unknown_contact`, `unauthorized`) y el `131047` de Meta.
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
(2026-07-30). Devuelve el documento completo: cabecera navy con el logo, tarjeta blanca con título,
cuerpo, botón y nota, filete coral, pie crema y la línea de por qué recibes esto. Está hecho con
**tablas y estilos en línea** —lo único que renderizan igual Gmail, Outlook y Apple Mail—, admite
`preheader` (la línea que la bandeja enseña junto al asunto) y pinta el botón con la técnica de
tabla + `bgcolor`, porque Outlook ignora el `padding` de un `<a>`.

**El logo es `public/logo-email.png`**, el wordmark rasterizado a 378×96 desde `logo-redestina.svg`: los
clientes de correo no pintan SVG, no resuelven rutas relativas y Gmail bloquea `data:`. Se sirve por
URL absoluta desde `APP_URL`. El `alt` del `<img>` va **estilado** (crema, 26px, bold), así que con
las imágenes bloqueadas —lo normal en Gmail con un remitente nuevo— se sigue leyendo «Redestina» sobre el
navy en vez de un icono roto. Si se cambia de dominio, basta con `APP_URL`.

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

### Registro self-service (`registro`, 31-07-2026)

`POST /functions/v1/registro` — **pública** (`--no-verify-jwt`), porque la llama quien todavía no
tiene cuenta. Crea, en este orden: la cuenta (`admin.createUser`, `email_confirm: true`), la ficha
(`productores` o `entidades`, con `es_test = false`) y la **membresía `pendent` con `activo = false`**
(§4bis). Contrato completo y códigos de error en el propio fichero; los mensajes van en catalán,
listos para mostrar.

**Abre el alta sin abrir el acceso.** La persona puede iniciar sesión y no ve absolutamente nada
—los helpers filtran por `membresias.activo`—: le sale la pantalla «Compte pendent de validació».
Quien concede el acceso de verdad es el equipo, desde Aprovacions (§6quater).

**No vincula nunca con una ficha existente.** `productores.email` y `phone` son UNIQUE sobre 345
fichas reales: si el correo o el teléfono chocan, responde `409 dades_en_us` y no crea nada. Vincular
automáticamente sería permitir apropiarse de una organización real conociendo su correo. `entidades`
no tiene ninguna restricción de unicidad, así que ahí el duplicado se cuela y lo detecta el equipo al
validar (deuda §12.28).

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

## 10bis. Los dos renames: `pdApp-wp` → `P0MA` → `Redestina`

El proyecto ha cambiado de nombre **dos veces**. El histórico importa porque cada rename deja
redirecciones vivas y nombres que no se pueden reutilizar.

### Rename 1 — `pdApp-wp` → `P0MA` (31-07-2026)

`pdApp-wp` era el nombre del producto anterior. Se cambió en la carpeta, el repo, el paquete, el
`project_id`, el proyecto de Vercel y el dominio (`pdapp-wp.carlessanz.com` → `p0ma.carlessanz.com`).

**El dominio viejo se apagó del todo el mismo día.** Se llegó a poner una redirección 308 pensando
en el logo (`/logo-email.png`) y el enlace del pie de los correos ya entregados, que quedan
congelados en la bandeja del destinatario para siempre. **Pero en este proyecto no había ningún
destinatario real**: todo lo enviado hasta el 31-07-2026 fue a `hola+*@carlessanz.com` y a las
cuatro entidades `TEST-*`, en modo test (§8). Sin correos reales que proteger, la redirección solo
era rastro, así que se retiró el DNS, los dos dominios de Vercel y los patrones `pdapp-*` de
`ALLOWED_ORIGIN` y `uri_allow_list`.

⚠️ **Ese razonamiento caduca en cuanto se salga del modo test.** A partir del primer correo a un
productor o una entidad de verdad, apagar un dominio sí rompe su historial hacia atrás y sin
remedio: entonces la respuesta correcta vuelve a ser la redirección permanente, no el corte.
**Es exactamente lo que hay que decidir en el rename 2 antes de tocar el dominio.**

### Rename 2 — `P0MA` → `Redestina` (10-09-2026)

A diferencia del anterior, este **no es solo un cambio de slug: es un rebranding**. `POMA` era
además el nombre del servicio de cara al usuario, así que cambia también lo que se lee en la
interfaz, en los correos y en las plantillas de WhatsApp.

| Qué | Antes | Ahora | Estado |
| --- | --- | --- | --- |
| Carpeta | `…/Espigoladors/P0MA` | `…/Espigoladors/Redestina` | ✅ |
| Repo | `carlessanz/P0MA` | `carlessanz/Redestina` (GitHub redirige el viejo con 301) | ✅ |
| `remote` de git local | `P0MA.git` | `Redestina.git` | ✅ |
| Paquete | `p0ma` | `redestina` | ✅ |
| `project_id` (Docker local) | `P0MA` | `Redestina` | ✅ |
| Nombre del servicio en la UI, correos y plantillas | `POMA` | `Redestina` | ✅ |
| `src/lib/poma.ts` | — | `src/lib/redestina.ts` | ✅ |
| Claves de `localStorage` y canal de Realtime | `poma-*` | `redestina-*` | ✅ |
| Documentos de `docs/` (contenido y nombre) | `POMA` | `Redestina` | ✅ |
| Proyecto Vercel | `p0ma` | `redestina` | ✅ |
| Dominio | `p0ma.carlessanz.com` | `redestina.carlessanz.com` | ✅ |
| Secretos `ALLOWED_ORIGIN` y `APP_URL` | `p0ma…` | `redestina…` | ✅ |
| `uri_allow_list` y `site_url` de Auth | `p0ma…` | `redestina…` | ✅ |
| Secreto `RESEND_FROM` | `POMA <no-reply@…>` | `Redestina <no-reply@…>` | ✅ |
| **El logo** (wordmark) | dibuja «POMA» | dibuja «Redestina» | ⬜ **pendiente (diseño)** |

**El rename se completó el 10-09-2026.** El dominio `redestina.carlessanz.com` resuelve y sirve la
aplicación, y las tres capas que tenían que reconocerlo lo reconocen: Vercel, el `ALLOWED_ORIGIN` de
las Edge Functions y la `uri_allow_list` de Auth. Verificado con preflight real: el dominio nuevo y
`localhost:5173` obtienen su propio origen de vuelta; el dominio viejo y un origen arbitrario, no.

⚠️ **`p0ma.carlessanz.com` se retiró sin redirección** y hoy devuelve **404**. Vale el mismo
razonamiento del rename 1 —seguimos en modo test y no ha recibido correo ningún destinatario real,
solo `hola+*@carlessanz.com` y las organizaciones `TEST-*`—, pero **ese razonamiento ya se ha gastado
dos veces**: al primer correo a un productor o una entidad de verdad, apagar un dominio rompe su
historial hacia atrás y sin remedio. El siguiente cambio de dominio exige redirección 308, no corte.

⚠️ **El logo no se pudo renombrar.** `public/logo-redestina.svg` es un wordmark en **paths**, no
texto: las letras de «POMA» están dibujadas como vectores. El fichero cambió de nombre, pero **lo
que se ve sigue diciendo POMA** en la landing, el menú lateral, las pantallas de acceso, el icono de
la PWA (`icona-*.png`, `apple-touch-icon.png`, `favicon.svg`) y la cabecera de todos los correos
(`logo-email.png`). Hace falta el logo nuevo en SVG y regenerar los derivados.

⚠️ **Los PDF de `docs/nuevas-funcionalidades/` cambiaron de nombre pero no de contenido**: son
binarios y por dentro siguen diciendo POMA. Sus versiones `.md` sí están actualizadas.

**No volver a crear un repo llamado `P0MA` ni `pdApp-wp`**: rompería las redirecciones 301 de
GitHub, que siguen vivas las dos.

Lo que **no** depende del nombre y por eso no se tocó: el `ref` de Supabase (`uxppvaldhptdomvdhsmn`),
la base de datos, **las migraciones ya aplicadas** (llevan `POMA` en comentarios y el nombre
`20260721120100_modelo_poma.sql`; editarlas está prohibido, §7), la URL del webhook en Meta y los
secretos de WhatsApp.

⚠️ **`Poma` es también un producto del catálogo** (manzana, en `productos.csv` y en el seed
`20260721120300_seed_catalogos.sql`), y aparece en comentarios de fichas de productores. Cualquier
sustitución masiva futura tiene que ser **sensible a mayúsculas**: `POMA` es el proyecto, `Poma` es
fruta. Un `sed -i 's/poma/redestina/gi'` renombraría la manzana.

⚠️ **Orden que hay que respetar si se repite**: `supabase stop` **antes** de cambiar `project_id`. Al
revés, el CLI filtra por el nombre nuevo, no encuentra los contenedores viejos y deja doce huérfanos
ocupando los puertos 553xx. Para limpiarlos, **filtrar por nombre**
(`docker ps -q --filter name=_Redestina`): en esta máquina conviven otros stacks de Supabase y un
`docker stop $(docker ps -q)` se los llevaría por delante.

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
   ⚠️ **Renombrar el proyecto cambia las URLs de preview**: `p0ma-*-carlessanz-projects.vercel.app`
   pasó a `redestina-*-…`, así que los pasos 3 y 4 son parte del mismo trabajo, no un extra.
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
| `https://p0ma.carlessanz.com` | **no** el mismo (cae al primero de la lista) |
| un origen arbitrario | **no** el mismo |

⚠️ **La trampa de esta comprobación**: un origen no permitido **no da error**. La función responde
`204` igual, pero con el `Access-Control-Allow-Origin` de otro origen, y es el **navegador** quien
bloquea después. Mirar solo el código de estado da un falso verde: hay que leer la cabecera.

Lo único que queda del rename es **el logo** (§10bis, deuda 41).

## 11. Comandos

```bash
npm run dev                # Vite en local
npm run build              # tsc && vite build  ← única verificación automática que existe
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
supabase secrets set --env-file .secrets.env

deno run -A scripts/import-ara.ts --dry-run   # analizar sin escribir
deno run -A scripts/import-ara.ts             # importar los CSV maestros

deno run -A scripts/comprobar-rls.ts          # arnés de RLS: matriz de permisos por cuenta (§4bis)
deno run -A scripts/crear-usuarios-prueba.ts --dry-run   # simular el alta de los 12 usuarios de prueba
deno run -A scripts/crear-usuarios-prueba.ts             # crearlos (idempotente)
deno run -A scripts/crear-usuarios-whatsapp.ts --dry-run # simular las 5 cuentas de WhatsApp (§9)
deno run -A scripts/crear-usuarios-whatsapp.ts           # crearlas (no toca ninguna ficha)

supabase migration up --local                 # aplicar migraciones pendientes SOLO en local (no borra datos)
```

Emergencia de RLS (§4bis), por orden: primero el interruptor,

```bash
deno run -A scripts/roles-activos.ts off     # o, en el SQL Editor:
# update app_settings set value = 'false' where key = 'roles_activos';
```

y si no basta, `scripts/sql/rls-emergencia.sql` en el SQL Editor.

`npm run build` corre `tsc` con `strict`, `noUnusedLocals` y `noUnusedParameters`. **Ya no es la
única comprobación automática**: `scripts/comprobar-rls.ts` verifica los permisos de verdad, contra
la base y con sesiones reales. Ejecuta las dos tras cada cambio que toque datos o políticas. Si
tocas algo de `supabase/functions/_shared/`, **redespliega todas** las funciones que lo importan.

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

**Deuda técnica:**

1. **Sin linter y sin CI.** Ya hay dos comprobaciones automáticas (`tsc` y `scripts/comprobar-rls.ts`),
   pero ninguna se ejecuta sola ni hay tests de la interfaz.
2. ~~**No hay roles**~~ — **resuelto (2026-07-30)**: modelo desplegado y **encendido** en producción
   (§4bis), verificado con el arnés (48/49 **ese día**; la referencia de hoy es 56/57 —§13— y la
   diferencia está explicada en la deuda 32). El único rojo era, y sigue siendo, un receptor
   comercial sin ninguna oferta de `venda` publicada, que es el comportamiento correcto. Queda de deuda: `tipo_receptor`
   sigue en `null` en 111 entidades y sin él un receptor no ve ninguna oferta —es triaje manual—, y
   `usuario_roles` no tiene FK a `perfiles`, así que PostgREST no puede embeber los dos (la futura
   pantalla «Equip» tendrá que cruzarlos en cliente).
3. El intake avanza de paso aunque falle el envío: si la red falla, el productor no recibe la
   pregunta pero la sesión ya avanzó, y su siguiente mensaje se lee como respuesta al paso nuevo.
4. `disponible_hasta`: el intake ahora lo **parsea** de la respuesta libre (`parseDisponibleFins`,
   §6bis) y lo rellena cuando es una fecha reconocible; si no (texto no fechable) queda `null`, el
   técnico lo normaliza en el panel y hasta entonces el job de vencidas no actúa sobre ese excedente.
5. `ProducersList` **y `ContactList`** cargan **todos** los `wa_messages` sin filtro ni paginación
   para contar los no contestados, y se suscriben a Realtime sin filtro. No escala. Igual `OffersList`, que
   recarga entero ante cualquier cambio de Realtime; el `Dashboard`, que al entrar agrega
   toda la base (productores, entidades, excedentes, canalizaciones, mensajes) en el cliente; y
   **`AppShell`**, que trae toda la tabla `wa_messages` en cada login de una cuenta con panel de equipo
   para calcular el contador del menú. Los buscadores de `ProducersList`/`OffersList` filtran **en
   cliente** sobre lo ya cargado.
6. `Conversation` carga el hilo completo sin paginación.
7. ~~`ContactList` conserva la prop `single` (modo conversación única)~~ — **resuelto**: esa prop ya
   no existe (props actuales: `contacts`, `loading`, `error`, `selectedPhone`, `onSelect`, `onReload`).
8. `index.css` es un único fichero global (~825 líneas) con clases sin namespace.
9. `types.ts` no modela `raw`; `MessageRow` en `ProducersList` duplica parte de `WaMessage`.
10. Hay migraciones que **borran datos** (`truncate wa_messages`) mezcladas con DDL.
11. Sin FK entre `productores`, `wa_contacts` y `wa_messages` (unidas por `phone`).
12. `prioritat` casi no discrimina (97 de 111 entidades son prioridad 1): aporta poco al ranking.
13. `oferta_respuestas` se registra desde el **cliente** (`OfferDetail`), no desde `whatsapp-send`:
    mantiene la Edge Function intacta pero acopla el registro al panel. Las respuestas por **email**
    no tienen captura automática (no hay inbound de correo): se marcan a mano.
14. La clasificación sí/no de `procesarRespuestaOferta` es una **heurística por lista de palabras**:
    un texto corto que empiece por «sí/no» con una oferta pendiente podría clasificarse mal.
15. La selección de plantilla de primer contacto por rol **no se ejercita en test** (siempre cae a
    `hello_world`); solo actúa en producción con `PLANTILLES_CA_APROVADES=true`.
16. **Doble rol** productor+entidad (Carles Sanz, Sebas Sale, Raquel Diaz, Laura Masdeu): tablas
    separadas sin FK, un teléfono puede estar en ambas. En el **panel** ya está resuelto —se ven los
    dos menús a la vez (§6ter)—, pero **en WhatsApp no**: el webhook lo desambigua por prioridad
    (§5), y el **diálogo de aceptación** (SÍ → kg → preu) manda sobre el intake, así que un
    productor-entidad con una oferta `pendent` que responda verá su conversación conducida por la
    aceptación (mientras `dialeg_pas` esté activo consume sus mensajes), no por el intake. Desde el
    31-07-2026 esto es **alcanzable de verdad**: hay cuatro cuentas de doble rol con móvil en la
    whitelist de Meta (§9), así que es el primer sitio donde conviene mirar si algo se comporta raro.
17. Coexisten dos gates: **`es_test`** (fuente de verdad de la app, §8) y las whitelists
    `meta_test_recipients`/`email_test_recipients` (requisito técnico de Meta en test). En test un
    destinatario debe cumplir **ambos**; se inicializaron alineados. El **Dashboard** aún gestiona
    y mide por las listas de Meta (no por `es_test`): coherente hoy porque coinciden, a revisar al
    pasar a producción de Meta o si se marca `es_test` a alguien fuera de la lista de Meta.
18. ~~**Aprobación sin roles**~~ — **resuelto (2026-07-30)**: la RPC `aprovar_resposta()` exige
    `pot_aprovar()` y el trigger `respuestas_control_aprovacio` lo impone aunque se relajen las
    políticas (§4bis). Efectivo al encender `roles_activos`. El «acuerdo del productor» que exige el
    funcional sigue implícito en la coordinación asistida del equipo (mejora futura: señal explícita).
19. **`OfferDetail` todavía aprueba a mano**, con tres llamadas sueltas (insert de canalización,
    update de la respuesta, update del excedente) en vez de la RPC `aprovar_resposta()`, que hace lo
    mismo en una transacción. Migrarlo cuando se toque el panel interno.
20. **Rol único por usuario**: `usuario_roles` admite varias filas pero la interfaz asumirá el más
    alto. El funcional (§1bis) pide multirol real por organización; las `membresias` ya lo permiten,
    la UI aún no.
21. **El canal preferente (§8bis) no llega a todos los envíos.** Lo aplican `OfferDetail` (botón
    «Enviar») y `enviar-acceso`; el **intake**, los **recordatorios** y el **ALTA/BAJA** siguen siendo
    WhatsApp puro, que es correcto —son respuestas dentro de una conversación que la persona ha
    iniciado por WhatsApp—, pero un productor que solo tenga correo no puede publicar una oferta de
    forma conversacional. La vía para él es el panel (§6ter). Falta también el fallback a correo en
    `whatsapp-send` mismo: hoy lo orquesta el llamante.
22. **Sin preferencia de canal declarada por la persona.** El canal se deduce de lo que hay en la
    ficha (móvil, opt-in, ventana). El funcional pide un campo explícito de «canal preferido» por
    organización: cuando exista, mandará sobre la deducción.
23. **`excedentes` tiene el único predicado de RLS que no puede ser InitPlan**: el `EXISTS` de
    `20260730098000_rls_ofertas_sense_recursio.sql` está correlacionado con `excedentes.modalitat`,
    así que se evalúa como SubPlan **una vez por fila**, y dentro recorre `entidades` (que reevalúa
    su propia RLS). Con 7 excedentes no se nota; el arreglo, cuando haga falta, es un SRF
    `security definer` sin correlación que devuelva las modalidades compatibles de la cuenta.
24. **Los eventos DELETE de Realtime se entregan sin evaluar RLS** (`realtime.apply_rls` los reparte
    a todos los suscriptores porque, con la replica identity por defecto, el WAL solo lleva la
    clave primaria). Hoy es inocuo: el payload es solo un id. Dejaría de serlo si algún día se
    pusiera `replica identity full` en una tabla con datos personales.
25. **Un fallo de envío por correo sigue sin dejar rastro.** WhatsApp ya lo registra (§8ter,
    `status='error'`), pero si Resend rechaza un envío solo queda en los logs de la Edge Function:
    en el panel no se distingue de un envío correcto.
26. **El registro público no tiene captcha y su límite por IP vive en memoria** (§9): se pierde en
    cada arranque en frío del isolate y no se comparte entre instancias. Lo que de verdad frena un
    abuso masivo es el tope de 20 pendientes por hora. Turnstile queda pendiente; hoy no compensa,
    porque el coste de un alta basura es una fila que el equipo rechaza con un clic.
27. **Ni el registro ni la aprobación envían correo.** `email_confirm: true` da el correo por
    verificado sin comprobarlo, así que **un error tipográfico en el correo deja la cuenta sin
    ningún canal** (y con el modo test encendido tampoco podría recuperar la contraseña, §8). Y quien
    espera validación se entera de que se la han aprobado entrando a mirar. Falta una notificación
    —que dependerá de la tabla `notificacion` con *fallback* de canal del funcional (§1bis)—.
28. **El registro no deduplica contra las organizaciones existentes.** En `productores` los UNIQUE de
    `email`/`phone` al menos cortan el alta con `dades_en_us`; `entidades` no tiene ninguna
    restricción de unicidad, así que una entidad ya fichada puede registrarse otra vez y solo lo
    detecta el equipo al validar. Se arregla de verdad con la `organizacion` unificada (§1bis,
    brecha 2), no con un parche aquí.
29. **Una ficha rechazada se queda en los listados.** `rebutjar_registre` no borra nada a propósito
    (auditoría y motivo visible), pero `ProducersList`/`EntitiesList` no filtran por `aprovacio`, así
    que esa organización aparece como una más hasta que el super_admin la borre a mano desde su
    ficha. Y la cuenta de Auth huérfana hay que borrarla aparte.
30. **Las contraseñas de las cuentas de prueba viajan en el bundle** con `VITE_ACCESSOS_TEST=true`
    (§6quater, §10). Está acotado y se apaga con la variable, pero mientras esté encendido cualquiera
    que abra `/login` entra como ellas. Desde el 31-07-2026 el alcance ya no es solo «organizaciones
    ficticias»: las cinco cuentas de WhatsApp (§9) enseñan **fichas de personas reales del equipo**
    —nombre, correo de trabajo y móvil—. Nunca cuentas con rol de plataforma, eso sigue vetado.
    Apagarlo al dejar de ser una demo.
31. **La interfaz solo alcanza la primera organización de cada tipo.** `membresias` no tiene UNIQUE
    por `(user_id, tipo)`, así que una cuenta puede ser titular de dos productores; `organitzacioActiva`
    y `useOrganitzacio` hacen `find`, o sea que **la segunda es inalcanzable**. Ya pasaba antes, pero
    ahora se nota más: el menú pinta una cabecera por panel afirmando visualmente «este es tu panel de
    productor», y con dos fichas esa cabecera miente. El arreglo de verdad exige que el `id` viaje en
    la URL (`/productor/:orgId/…`) o la `organizacion` unificada del funcional (§1bis, brecha 2).
32. **Nueve comprobaciones del arnés se quedaron sin cuenta que las recorra.** Los bloques
    `sense_rol` (3) y `pendent` (6) de `scripts/comprobar-rls.ts` siguen escritos —son la
    especificación de lo que esas cuentas deben *no* poder hacer— pero el arnés recorre las cuentas de
    `cuentas-prueba.json`, y desde el recorte del 31-07-2026 ninguna tiene esos roles: por eso la
    referencia pasó de 65/66 a **56/57**. No es un fallo de comportamiento, es **cobertura perdida**,
    y el arnés no lo avisa (salta el bloque en silencio). Se recupera dando de alta una organización
    por `/registre` y añadiendo su credencial con `"rol": "pendent"` (§9). Con ello, la **cola de
    «Registres pendents» también vuelve a tener con qué probarse**, que hoy está vacía.
33. **Borrar una organización de prueba deja rastro en `email_test_recipients`.** No hay FK: la tabla
    guarda un correo suelto (§4). Pasó dos veces el 31-07-2026 y se limpió a mano.
34. **Áreas táctiles: se subieron las cuatro que importan, no todas.** «M'interessa» (44 px en móvil),
    el `SidebarTrigger` (36), el ojo de la contraseña (de 16×16 a 32×32) y el «atrás» del detalle de
    oferta. El resto de la interfaz sigue en `h-9` (36 px), por debajo de los 44 px que recomiendan
    Apple y Google: subirlos todos es rediseñar la aplicación entera para ganar 8 px en botones
    secundarios. Los ítems de los menús desplegables (idioma, `UserMenu`) siguen en 32 px.
35. **`window.prompt()` en dos sitios** (`productor/OfertaDetall.tsx`, para cancelar una oferta; y
    `equip/Aprovacions.tsx`, para el motivo al rechazar un registro). En los navegadores integrados de
    WhatsApp o Instagram —muy probables en este público— puede estar bloqueado y devolver `null` **en
    silencio**: la acción no haría nada y no lo diría. Necesitan un diálogo propio.
36. **Las pestañas de `/registre` caben con 1 px de margen** a 320 px («Entitat receptora» ocupa 115 px
    en una pastilla de 116). No está roto y por eso no se tocó, pero cualquier traducción más larga o
    un cambio de fuente lo rompe.
37. **El aviso de instalación no se puede probar de verdad en automático.** `beforeinstallprompt` no lo
    dispara ningún navegador de escritorio ni Playwright, así que las pruebas lanzan un evento
    sintético: se verifica que **el banner reacciona**, no que Chrome lo emita. La instalación real
    solo se comprueba en un móvil.
38. **`vista_defecto` se calcula en el servidor y el frontend lo descarta** (§4bis). El panel inicial
    de `/panell` se decide por `localStorage` (`preferit`) + `ctx.rols[0]`; el campo no llega siquiera
    a `ContextSessio`. Inofensivo, pero es lógica servida y no usada.
39. **`crearExcedente()` no reintenta ante colisión del correlativo.** El comentario de `oferta.ts`
    dice que un segundo alta simultánea «reintenta con N+1», pero no hay retry: `id_excedente` se
    calcula contando las filas del día y se hace un único `insert`; si dos altas del mismo
    productor+producto coinciden en el día, la segunda choca con el `unique` y **falla** en vez de
    reintentar. Raro a la escala de Redestina, pero real (afecta tanto al intake como al panel).
40. **El albarán se genera con el productor en blanco.** `OfferDetail` pasa `productor: ''` (y
    `dataHora`/`comentaris` vacíos) a `textoAlbaran`, así que el «RECOLLIDA CONFIRMADA» nunca lleva el
    nombre del productor aunque esté disponible. Va con el checkpoint del formato definitivo del
    albarán (§12 checkpoint 4).

41. **El rebranding a Redestina es textual, no visual.** Todo lo escrito dice ya «Redestina», pero
    **el logo sigue dibujando «POMA»**: `public/logo-redestina.svg` es un wordmark en paths, no
    texto, y de él derivan los iconos de la PWA, el `apple-touch-icon`, el `favicon` y el
    `logo-email.png` de la cabecera de todos los correos. Hasta que haya logo nuevo, la aplicación
    se llama Redestina y se ve POMA (§10bis).
42. ~~**La infraestructura todavía responde al nombre viejo.**~~ — **resuelta (10-09-2026)**:
    proyecto de Vercel, dominio, `ALLOWED_ORIGIN`, `APP_URL`, `RESEND_FROM`, `site_url` y
    `uri_allow_list` migrados y verificados con preflight real (§10ter). Queda de rastro que
    `p0ma.carlessanz.com` se apagó sin redirección: inocuo hoy porque no hay destinatarios reales,
    pero es la segunda vez que se usa ese argumento (§10bis).

## 13. Al terminar cualquier cambio

1. `npm run build` en verde.
2. `deno run -A scripts/comprobar-rls.ts` si el cambio toca datos, políticas o roles. Referencia
   actual: **56/57** (el rojo conocido es un receptor comercial sin ninguna oferta de `venda`
   publicada, que es el comportamiento correcto). Cualquier otro rojo es una regresión.
3. **Actualizar este fichero** si cambió arquitectura, datos, contratos, convenciones,
   comandos o deuda técnica; y **§1bis + su tabla de correspondencia** si cambió el alcance
   funcional o el estado de implementación (✅/🟡/⬜).
4. Commit en castellano, describiendo el *qué* y el *por qué*.
