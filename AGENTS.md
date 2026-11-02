# AGENTS.md

Documento canónico de contexto para agentes de IA (Claude Code, Codex, Cursor…) que
trabajan en este repositorio. `CLAUDE.md` lo importa; **no dupliques contenido allí.**

> **Regla permanente:** toda modificación que cambie la arquitectura, el esquema de datos,
> los contratos de las Edge Functions, las convenciones o los comandos **debe actualizar
> este fichero en el mismo cambio.** Si el código y este documento discrepan, el documento
> está roto.

> 🔴 **Regla de tamaño (02-11-2026): este fichero se carga ENTERO en cada sesión y no puede
> pasar de 48 KB.** Llegó a 681 KB (~200.000 tokens: la ventana de contexto entera) y cada
> sesión del proyecto se compactaba antes de empezar. Aquí vive **solo lo vigente, en forma
> compacta**; el detalle de cada sección —con su historia, sus medidas y sus porqués— está en
> **`context/<sección>.md`**, que se lee bajo demanda y se mantiene al día con la misma regla
> permanente. Una cita «AGENTS.md §N» del código vale para las dos: el número de sección es el
> mismo. `tests/agentsMida.test.ts` falla si este fichero supera el tope. **Lo histórico («el
> día X se vio que…») va al fichero de detalle, nunca aquí.**

| § | Fichero de detalle | § | Fichero de detalle |
| --- | --- | --- | --- |
| 1 | `context/01-proyecto.md` | 7 | `context/07-convenciones.md` |
| 1bis | `context/01bis-vision-funcional.md` | 8 | `context/08-reglas-de-negocio.md` |
| 2 | `context/02-stack.md` | 8bis | `context/08bis-canal-preferente.md` |
| 2bis | `context/02bis-sistema-de-diseno.md` | 8ter | `context/08ter-cuando-meta-rechaza.md` |
| 3 | `context/03-estructura.md` | 9 | `context/09-seguridad-autenticacion.md` |
| 4 | `context/04-modelo-de-datos.md` | 10 · 10bis · 10ter | `context/10-variables-de-entorno.md`, `10bis-nombres-retirados.md`, `10ter-rename-completado.md` |
| 4bis | `context/04bis-identidad-roles-permisos.md` | 11 | `context/11-comandos.md` |
| 5 | `context/05-flujos.md` | 12 | `context/12-checkpoints-y-deuda.md` |
| 6 · 6bis | `context/06-importacion-datos-maestros.md`, `06bis-intake-conversacional.md` | 12bis · 12ter | `context/12bis-decisiones-con-precio.md`, `12ter-deuda-cerrada.md` |
| 6ter · 6quater | `context/06ter-distribucion-cierre-panel.md`, `06quater-parte-publica-registro.md` | 13 | `context/13-al-terminar-un-cambio.md` |

---

## 1. Proyecto

**Redestina** (antes PDApp / P0MA) — plataforma de canalización de excedentes agrícolas de la
Fundació Espigoladors, con WhatsApp Cloud API como canal. Un productor ofrece un excedente, el
sistema lo convierte en una **oferta** con identificador propio, prioriza **entidades**
receptoras y registra las **canalizaciones** hasta el cierre con kg reales, albaranes y
certificados. Dos fases construidas: **1. infraestructura WhatsApp** y **2. Redestina**
(intake, priorización, canalización, cierre, sistema documental, paneles por rol).

- Entorno de **pruebas de Meta** con `WHATSAPP_ENVIO_REAL=true`: Meta solo entrega a los ≤5
  números verificados (`meta_test_recipients`); el resto rechaza con `131030`. Mensajería
  siempre individual (la Cloud API no escribe en grupos).
- **Documentación fuera del repo**: `docs/` (ignorado por git; funcionales, guías operativas,
  `Usuarios y accesos` y `usuarios-test.md` **con credenciales**) y la carpeta de consultoría en
  Google Drive `…/02-Proyectos/04-Espigoladors/03-Redestina/` (`0. Documentación vigente/`,
  `1. Fuentes/`, `2. Contexto/`, **`3. Claude Code/`** = lo que escribe Claude). Solo se escribe
  en `3. Claude Code/`; nunca credenciales ni datos personales allí. Jerarquía: la *Definición de
  producto v3* manda en el porqué, el *funcional 2026 v3* en el qué, la automatización y la guía
  técnica en el cómo.
- **Planes vivos** en `3. Claude Code/`: sistema documental (2026-09-10, ejecutado), organización
  unificada (2026-09-22), revisión del 08-10 (2026-10-11, fases 0-11 hechas) y **plan 1 CRM y
  registro de entidades** (2026-11-02, rebanadas 1A-1F; **1A, 1C, 1B y 1D publicadas el
  02-11-2026**, 1D en `b6685b1`).
- Vocabulario: en el código la tabla es `excedentes` y los textos dicen «oferta»; «AFCV» es el
  término del funcional, pendiente de rename.

## 1bis. Visión funcional (objetivo ↔ construido)

Servicio apoyado por tecnología, **modelo asistido** (el equipo opera en nombre de las
organizaciones), ERP fuente única, **multirol real**, cinco líneas (donación —core—, salida
comercial, maquila, espigueo, diagnóstico/prevención). Flujo core: registrar → validar →
publicar → match asistido → recogida → albaranes → conciliación → certificados.

Construido ✅: usuario/membresías, convenios con firma por enlace, excedentes, canalizaciones
con conciliación, albaranes REC/ENT/OPE sin huecos, documentos externos, certificados CD/CT/CR,
roles y RLS, registro self-service validado, i18n ca/es, responsive, comunicación WhatsApp+correo,
coste por kilo, PWA. Parcial 🟡: organización multirol (`organizaciones` es identidad común;
faltan `usuario`/`rol_organizacion` propios y campos propios), `interes`, `sugerencia_match` (no
persiste), plantillas en código, diagnóstico (ficha viva v2) y Pla de Prevenció (expediente
provisional), espigueo, catálogos, back office, parte pública, indicadores (`kpis_equip`,
`impacte_*`). Pendiente ⬜: `demanda`, `notificacion` con fallback, encuestas,
`historial_estado`, adjuntos de WhatsApp. **Lo que bloquea hoy es material de la fase 0**
(textos legales, datos fiscales reales, taras, cuestionario definitivo), no código.

## 2. Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | Vite 7 + React 19 + TypeScript 5.9 `strict` + Tailwind v4 + shadcn/ui + react-router v7 |
| Datos | Supabase (`@supabase/supabase-js` v2), Postgres con RLS + GRANT, Realtime |
| Backend | Edge Functions (Deno); correo por **Resend** |
| Scripts / pruebas | Deno 2.x; Vitest 4; Playwright (E2E); `deno test` para el PDF |
| Hosting | Vercel (proyecto `redestina`, dominio `redestina.carlessanz.com`) |

- **Producción es la base de verdad; el clon local (Docker, puertos 553xx) es una copia** (§11).
- Router como capa raíz con rutas públicas y privadas (§6quater). Sin librería de estado.
  `vercel.json` lleva el rewrite de SPA.
- **Contrato de alturas**: shell `h-dvh overflow-hidden`; `main` es `min-h-0 flex-1`, scrollea
  él y lleva `scrollbar-gutter: stable`; ninguna pantalla escribe `h-dvh`. Flags de ruta:
  `fullBleed` (Mensajería) y `ample` (listados anchos). `CarregantSeccio` como esqueleto con alto.
- **Barra inferior de móvil: cuatro entradas como máximo** (`barra: false` para lo que no
  cabe, `labelBarraKey` para etiqueta corta; `li` con `min-w-0`). Medir, no estimar.
- **PWA instalable sin service worker** (`selfDestroying`): el SW con precache escondía los
  despliegues tras la cortina. `/version.json` + `useVersioNova` avisan de versión nueva.
  Aviso de instalación solo en móvil (dispositivo, no ancho) para productor y receptor.
- **Siete reglas de móvil medidas** (detalle en `context/02-stack.md`): controles ≥16 px
  (`text-base md:text-sm`, también en `SelectTrigger` y `<select>`); `Button` trae
  `whitespace-nowrap` **y `shrink-0`** (ancho explícito `w-full sm:w-auto` si el texto crece);
  `env(safe-area-inset-*)`; en una fila texto+botón el botón va a su línea en móvil
  (`flex-wrap`, `min-w-0 flex-1 basis-*`); `grid-cols-1` explícito antes de `sm:grid-cols-2`;
  celdas de tabla con `whitespace-normal`; **auditar `scrollWidth > clientWidth` en los hijos**,
  no solo en el documento.

## 2bis. Sistema de diseño

`design/tokens.json` (fuente única), `design/DESIGN.md` (uso), `design/preview.html` (muestra).
Reglas: **ningún hex ni clase de la paleta genérica de Tailwind**; solo las clases de
`src/index.css` (shadcn + extensión REDESTINA: `coral*`, `verde-claro/oscuro`, `exito`, `aviso`,
`error` y sus `-fondo`, `chart-1…5`, `font-titulos`, `text-nav` solo para la barra inferior).
`accent` no es el coral; el error es rojo; títulos en Sora; nombres de shadcn no se renombran;
`index.css` se deriva a mano de `tokens.json` (y los colores del correo viven en
`_shared/resend.ts`). Logo en seis variantes en `public/`; `logo-email.png` es el logo en color
(cabecera de correo clara); el sello `segell-redestina.svg` va sin texto. Ningún control de
formulario estilado a mano (`components/Casella`, `ui/input`, `ui/select`). Badge sobre fondo de
color = chip blanco con texto en color. `{n}` reservado a contadores (singular `<clau>_1`). Sin
modo oscuro. Dos h2 de la portada van en `coral-oscuro` por decisión del cliente (2,85:1).

## 3. Estructura (resumen; árbol completo en `context/03-estructura.md`)

```text
CLAUDE.md · AGENTS.md · context/        Contexto para agentes (este fichero + detalle por sección)
middleware.js · cortina/                La cortina de contraseña de Vercel (generado; §9)
design/                                 Sistema de diseño (§2bis)
tests/  (unit Vitest · pdf/ Deno · e2e/ Playwright)   .githooks/pre-commit · .github/workflows/
.claude/agents/ (dades, servidor, interficie) · .claude/skills/publicar/
src/
  App.tsx · router/index.tsx · layout/ (AppShell, AppSidebar, BottomNav, UserMenu)
  hooks/ (useSessio, useAppContext, useConveni, useMissatgesOferta…)
  routes/ public/ · equip/ · productor/ · receptor/ · PerfilOrganitzacio · PerfilRecepcio · PlaOrganitzacio
  components/ (ui/ shadcn · documents/ · proces/ · equip/ (fases/, diálogos asistidos) · expedient/ …)
  lib/ (módulos PUROS con test: procesOferta, passosCanalitzacio, seguentPas, validacio, format,
        cerca, filtres, missatgesOferta, destiFinal, registreRecollida, diagnostic, i18n…)
  types.ts · index.css
scripts/  comprobar-rls.ts (arnés) · aplicar-migracion.ts · local/ (clon) · fixtures crear-*.ts ·
          escenari-demo.ts · historial-migraciones.ts · huellas-funciones.ts · data/ (ignorado)
supabase/ config.toml · migrations/ · functions/ (_shared/ con pdf/, hojas de texto, gate, canal,
          autorizacion, resend; 20 funciones: whatsapp-send/webhook, crear-oferta, registro,
          donar-acces, enviar-email/acceso/avis, generar/descargar/reenviar-documento,
          enlace-publico, subir-documento-externo, priorizar-entidades, recordatorios-*,
          recollides-programades, recuperar-password, verificar-certificat, limpiar-documentos-prueba)
docs/ (ignorado por git)
```

## 4. Modelo de datos (detalle y porqués en `context/04-modelo-de-datos.md`)

**Mensajería**: `wa_contacts` (`phone` E.164 sin `+`, opt-in, `last_inbound_at` = ventana 24 h),
`wa_messages` (`wa_message_id` único: idempotencia; `raw` guarda opciones de los interactivos).
Sin FK con `productores`: unidas por teléfono.

**Fichas**: `productores` y `entidades` (dos tablas, con `es_test`, `activo`, `nif` validado por
trigger `*_nif` —`nif_invalid`/`nif_en_us`—, `razon_social`, `municipio_ine` → trigger rellena
`poblacion` y `area_geografica` = comarca, `tipus_activitat[]`, `perfil_receptor` jsonb,
`tipo_receptor` social·animal·transformador·comercial, `modalitats_interes`), ambas colgando de
**`organizaciones`** (identidad común, `organizacion_id not null` por trigger; una ficha de cada
tipo por organización; solo guarda identidad y `canal_preferido`, escrito por
`actualizar_meu_canal()`). Vista `v_organizaciones` (`security_invoker`). `productor_ubicaciones`
(lugares de recogida con dirección, contacto, horario). **Solo quedan fichas de prueba** en
producción (§6).

**Estado de las fichas (plan 1, 1A, `20270501100000`)**: `activo` en las dos; la organización está
activa si lo está algún papel (D7). Pasar a activa exige NIF válido y razón social (trigger
`trg_fitxa_estat`: `falta_nif`·`nif_invalid`·`falta_rao_social`, P9) y todo cambio deja fila en
`fitxa_estat_hist` (solo la lee el equipo). `v_organizaciones` añade `activa`, `*_activo`,
`nom_comercial`, `persona_contacte`, `comarca`, `tipus_activitat` y `compte_estat`. Una entidad
inactiva no entra en el Mercat (`modalitats_compatibles_meves()`; la rama de historial sigue), ni
en `priorizar-entidades`, ni en los selectores del equipo, y `comprova_interes()` la rechaza con
`entitat_inactiva`. **Un contacto por ficha (D3)**: `organizacion_contactos` se conserva (P6) pero
sus RPC no se ejecutan con sesión y la pantalla se retiró (deuda 146). **1C (`20270501200000`)**:
vista `v_entitats_llistat` (`security_invoker`, una fila por organización: lo de `v_organizaciones`
más `es_test`, `rebutjada`, `modalitats_interes`, `conveni_productor/entitat` y
`darrera_activitat`) para el listado «Entitats»; `v_productores_llistat`/`v_entidades_llistat`
quedan sin uso (deuda 149).

**Ofertas**: `excedentes` (`id_excedente` `E-AAMMDD-XXX-YYY-N`; `estado` borrador · publicada ·
pendent_validacio · parcial · bloqueada · cerrada · no_colocada · cancelada; `modalitat` +
`modalitats[]`; `preu_minim`, `coste_kg`, `fotos[]`, `producte_al_camp`, `format_entrega`,
`transport_propi`, `municipi_ine`/`comarca` por trigger, franja `hora_recollida_*`,
`disponible_hasta`); `oferta_respuestas` (`estado` de la entidad × `aprovacio` del equipo;
`canal` whatsapp·email·panel·asistido·manual; `kg_solicitados/kg_aprovats`, `modalitat`,
`recollida_at`); `canalizaciones` (kg confirmados/reales/conciliados, `valorizacion`, `coste_kg`
congelado al conciliar, `data_hora_recollida`, columnas de la recogida protegidas por trigger);
`excedente_destins` + catálogo `destins_finals`; `excedentes_canvis`; `avisos` (lo que se le
cuenta a una organización; los crean triggers); `intake_sessions`; `espigoladas`.

**Catálogos**: `productos` (iconos propios en `public/icones-productes/`), `causas`,
`factores_conversion`, `costes_producto` (coste de **referencia**, uno por producto, +hist),
`tipos_caja`, `municipios` (947, INE texto), `codis_postals`, `tipus_activitat`,
`factors_impacte`, `modalitat_receptor_compat` y `convenios_exigidos` (reglas **en tabla**),
`convenis_equivalents`. Whitelists `meta_test_recipients`, `email_test_recipients` (vacía = sin
límite). `app_config` (secretos de jobs, solo `service_role`) y `app_settings` (`test_mode`
fail-safe cerrado; `roles_activos`, `whatsapp_activo`, `email_activo`, `notificacions_actives`
fail-safe abierto; `validacio_ofertes`). `consentiments` (RGPD, solo inserción).

**Sistema documental** — regla que lo ordena todo: **el número pertenece a la fila, no al
fichero**; `siguiente_numero(serie, ejercicio)` se llama dentro de la transacción que crea la
fila (`series_documentales`, sin `sequence`). `documentos` (polimórfica, `modo` real/prueba en
el dato, dos huellas `sha256_datos` —la impresa— y `sha256_fichero`, **inmutable por trigger**,
sin borrado salvo `reiniciar_documentos_prova()`), `documento_envios` (solo correo),
`plantillas_documento` (texto versionado en la base, congelado al emitir), `enlaces_token`
(firmar y confirmar sin cuenta: solo el hash; canales email·asistido·panel·whatsapp),
`evidencias`, `parametros_documentales` (fila única, **sembrada provisional**;
`datos_provisionales` bloquea el modo real), buckets `documentos`/`activos` sin políticas
(descarga por Edge Function) y `fotos-ofertes` con políticas propias. Ruta
`<org>/<ejercicio>/<CARPETA>/<numero>-v<n>.pdf`. Jobs: trigger `documentos_encola_generacion` +
`pg_cron` `documentos-pendientes` (5 intentos, dos contadores). **Cinco columnas fuera del GRANT
de SELECT**: `enlaces_token.token_hash/codigo_hash`, `evidencias.documento_identidad`,
`parametros_documentales.apoderada_dni`, `documentos.envio` → `select('*')` da `42501`; toda
columna nueva de `documentos` nace sin SELECT.

**Albaranes** (`albaranes`, `albaran_lineas`: REC entrada · ENT entrega · OPE venta/maquila;
solo `kg_validados` cuenta; **sin columna de importe**; nacen por trigger al crear la
canalización; estados borrador→emitido→entregado→confirmado→conciliado, anulado, rectificado
`R-`). PDF de una página (`albara1p`); el REC de donación imprime valor por kilo (decisión del
cliente). `documentos_externos` (albarán del productor, factura, fotos, archivo previo de la
ficha, evidencias de expediente). **Convenios** (`convenios`: tipos `col_productor`/
`col_receptor` desde el 11-10-2026, los anteriores `don_gen`/`don_rec`/`com` valen por
equivalencia; `origen` plataforma · paper · **declarat**; uno vigente por tipo; número al
firmar; `convenio_vigente()`/`exigir_convenio()`; **fecha de corte encendida** desde el
16-09-2026: sin convenio no se publica ni se muestra interés). **Cierre anual** (`cierres_ejercicio`,
`cierres_donante` tipo donacio/transaccio con `revisio_estat`, `cierre_donante_lineas`;
`P-*` en prueba; `datos_182()`), **certificado a demanda** (`cierres_periodo`, serie `CDP`),
**certificado de recepción** (`cierres_receptor`, serie `CR`, sin importes, D3 por CHECK). La
factura ya no condiciona el certificado (21-09-2026); el anual sustituye a los parciales.
**Diagnóstico y plan**: `questionaris_diagnostic` (v2 productor; receptor retirado),
`mesures_prevencio`, `regles_pla`, `planes_prevencion` (sobre autocontenido),
`diagnostics_historial`, y el **expediente** `expedients_prevencion` + 7 hijas. Impacto:
`impacte_*` sobre kilos conciliados.

**Borrado de una ficha: una sola puerta, `borrar_ficha_completa()`** (`es_super_admin()`):
rechaza con `22023 bloqueig_esborrat: <codis>` si hay documentos, albaranes o cierres; si no,
arrastra lo operativo, borra la ficha, retira la organización vacía y purga la whitelist. Las FK
`NO ACTION` se quedan como última red. Un `.delete()` suelto está prohibido (§7).

**RLS y GRANT — dos capas**: `service_role` todo (y `BYPASSRLS`); `anon` **ningún privilegio**
de tabla; `authenticated` nace con **SELECT y nada más** en una tabla nueva (los `alter default
privileges` de escritura y TRUNCATE están revocados) —una tabla escribible desde el panel
necesita su `grant` explícito además de su política—. Escritura directa solo en `wa_contacts`,
`productores`, `entidades`, `canalizaciones`, `oferta_respuestas`, `productor_ubicaciones`,
whitelists y `app_settings` (con políticas por rol); en las dos fichas solo UPDATE y DELETE
(**el alta, solo por RPC**: deuda 150 cerrada); `excedentes` solo UPDATE; nunca INSERT en
`wa_messages` ni `excedentes`; nunca escritura en `usuario_roles`/`membresias`. Comprobar una
tabla nueva: `has_table_privilege('authenticated','public.X','SELECT')`.

## 4bis. Identidad, roles y permisos (tabla completa de RPC en `context/04bis-…md`)

- `perfiles` (1:1 con `auth.users`; `activo`, `idioma` —decide el idioma del convenio—,
  `mercat_vist_at`), `usuario_roles` (`super_admin` > `admin` > `tecnic`; externos sin fila),
  `membresias` (cuenta ↔ ficha; `rol_org` titular/operador; eje `aprovacio` pendent · aprovada ·
  rebutjada × `activo`; **el rol no viaja en el JWT**: se consulta en cada política).
- **`roles_activos` ENCENDIDO en producción** (fail-open deliberado; un entorno recreado nace
  apagado: `scripts/roles-activos.ts`). `hola@carlessanz.com` es `super_admin`; las otras dos
  cuentas del equipo, `admin`.
- Helpers `stable security definer set search_path = public, pg_temp` con `revoke execute …
  from public, anon`: `es_intern()`, `pot_aprovar()`, `es_super_admin()`, `mi_rol()`,
  `mis_productores()`, `mis_entidades()`, `soc_titular()`, `get_my_session_context()`
  (**repetir `parallel restricted` al recrearla**). Nunca `force row level security` en esas
  tres tablas. En políticas van envueltos en `(select …)`.
- **Idioma de las guardas**: `if auth.uid() is not null and not es_intern() then raise 42501`
  (`auth.uid() is null` = `service_role`; una guarda `es_intern()` a secas lo deja fuera en
  silencio). **El permiso se comprueba antes que la existencia** (un uuid inventado da `42501`
  a quien no puede). Toda función nueva: `revoke execute … from public, anon` (y de
  `authenticated` si es interna o de trigger); `auditoria_funcions_obertes()` debe seguir en
  **0 filas** (lo vigila el arnés). `create or replace` **no cambia `returns table`** ni el
  número de argumentos: drop + create + revoke/grant.
- **Superficie de escritura de los paneles = RPC**, no políticas. Familias (nombres exactos en
  el detalle): interés y aprobación (`manifestar_interes`, `manifestar_interes_assistit`,
  `comprova_interes`, `aprovar_resposta`, `declinar_oferta`, `registrar_envio_manual`); ficha
  propia (`actualitzar_fitxa_productor/entitat` con lista blanca, `actualizar_meu_canal`,
  `afegir_paper_organitzacio`); ofertas (`cancelar_meva_oferta`, `validar_oferta`,
  `rebutjar_oferta`, `editar_oferta` solo servidor, `fixar_fotos_oferta`, `registrar_desti_final`,
  `desti_excedent`, `marcar_canvis_revisats`); recogida (`registrar_recollida` del receptor
  **solo declara**; `validar_recollida`/`retornar_recollida` del admin emiten y concilian;
  `registrar_recollida_assistida`, `confirmar_recollida` envoltorio, `fixar_hora_recollida`,
  `operacio_detall`, `contraparts_canalitzacions`); albaranes (`emitir_albaran` con candado
  `recollida_no_validada`, `marcar_entregado`, `registrar_confirmacion`, `conciliar_albaran` en
  cascada con motivo obligatorio ante incidencia, `anular_/rectificar_albaran`,
  `crear_espigolada` —convierte una oferta `producte_al_camp`—, `repartir_espigolada`);
  convenios (`preparar_/enviar_/contrafirmar_/retornar_/resolver_convenio`,
  `iniciar_firma_asistida`, `signar_conveni_propi`, `acunar_enllac_propi`,
  `acunar_enllac_assistit`, `preparar_/registrar_conveni_en_paper`, `declarar_conveni`,
  `descartar_convenio_esborrany`, `firmar_convenio_por_enlace` solo servidor); organización
  (`organitzacions_candidates`, `enllacar_organitzacio`, `aprovar_/rebutjar_registre`,
  `cerca_entitats` —equipo, NIF y nombre, D6—, `crear_entitat` —1B: alta con uno o dos papeles en una
  transacción, `es_intern()`; nace activa, así que exige NIF válido, razón social y `tipo_receptor`—, `activar_/desactivar_fitxa`,
  `desactivar_organitzacio` y `afegir_paper_org_equip` —`pot_aprovar()`—; acceso (1D):
  `estat_acces_org` (equipo, correo enmascarado), `desactivar_acces_org` (`pot_aprovar()`),
  `concedir_/revertir_acces_org` (solo `service_role`, los usa `donar-acces`);
  `borrar_ficha_completa`, `bloqueigs_esborrat_fitxa`); cierre y certificados (`abrir_/
  calcular_/cerrar_cierre`, `emitir_resumen`, `emitir_certificado*`, `emitir_certificados_cierre`,
  `*_transaccion*`, `*_periodo`, `*_recepcio`, `rectificar_*`, `reiniciar_*_prova`,
  `cierre_base*` solo equipo); diagnóstico y plan (`questionari_vigent`, `publicar_questionari`,
  `desar_diagnostic`, `generar_pla_des_de_diagnostic` y `emitir_plan_basico` solo equipo,
  `desar_mesures_pla`, `fixar_nivell_pla`, `diagnostic_estat`, expedientes `obrir_/desar_/
  verificar_/tancar_/exportar_expedient`, `desar_element_expedient`); equipo (`pendents_equip()`
  16 colas, `kpis_equip`, `canalitzacio_assistida`, `canalitzacions_actives`,
  `avisos_de_oferta`, `avisos_sense_enviar_per_oferta`, `progres_meves_ofertes`,
  `pendents_meus`, `missatges_sense_contestar`, `kg_rebuts_exercici`, `impacte_*`); interruptores
  (`fixar_notificacions`, `fixar_canal_notificacio`, `fixar_factor_impacte`,
  `fijar_coste_producto`); jobs solo `service_role` (`programar_albarans_recollida`,
  `recordar_confirmacions_recollida`, `conciliacions_automatiques`,
  `volcar_quantificacio_expedients`, `disparar_recordatorios_intake`,
  `marcar_excedentes_vencidos`, `congelar_un_cierre`).
- Triggers de respaldo: `respuestas_control_aprovacio`, `membresias_control_aprovacio`,
  `canalizaciones_protegeix_recollida`, `documentos_inmutable`, `convenios_control`.
- **Edge Functions**: `service_role` ignora RLS, así que `_shared/autorizacion.ts`
  (`contextoUsuario`, `exigirEquipo`: `401`/`403`) se aplica en las que lo necesitan;
  `rolesActivos()` **falla cerrado** ante un error de lectura.
- **Verificación**: `deno run -A scripts/comprobar-rls.ts` abre sesión real con cada cuenta de
  `scripts/data/cuentas-prueba.json` (fuera de git) y comprueba la matriz (cuenta, tabla,
  operación). `Check.columnas` para tablas con GRANT por columnas; un `permitir` con uuid
  inventado solo acepta **errores de negocio** (`22023`, `PT4xx`, `235xx`): la clase `42` es
  FALLA; un UPDATE denegado por RLS devuelve 0 filas y se trata como denegación; cierra con
  `signOut({scope:'local'})`. **Cualquier FALLA es una regresión.** Emergencia: nivel 0
  `roles_activos=false`; nivel 1 `scripts/sql/rls-emergencia.sql`.

## 5. Flujos (detalle en `context/05-flujos.md`)

Envío: `sendWhatsApp()` → `whatsapp-send` (JWT, reglas §8) → Graph API → `wa_messages`.
Recepción: webhook valida `X-Hub-Signature-256`, upsert por `wa_message_id`, **siempre 200**;
orden: registrar → `last_inbound_at` → interruptor → gate `es_test` → ALTA/BAIXA →
confirmación de albarán (`conf:<enlace>:ok|dif`) → respuesta a oferta (diálogo sí → kg con tope →
precio) → intake. Recordatorio de intake a los 10 min por `pg_cron` → `pg_net` →
`intake-recordatorios` (secreto `x-recordatorios-secret`). Un rechazo de Meta se registra con
`status='error'` (§8ter).

## 6. Datos maestros

Catálogos por migración (`20260721120300_seed_catalogos.sql`); fichas por
`scripts/import-ara.ts` (CSV en `scripts/data/`, nunca en git; idempotente; cabecera desplazada,
teléfonos en texto libre). 🔴 **Los datos importados se borraron el 16-09-2026**: en la base
quedan 6 productores + 8 entidades de prueba, la ficha «Compte de proves de l'arnes»
(`TEST-PENDENT-ARNES`, **no aprobar nunca**: sostiene 73 checks) y
`tecnologia@espigoladors.com` en la whitelist de correo. Las cifras históricas de este documento
describen el import, no la base de hoy. El trigger del NIF rechazará filas del CSV con NIF
inválido o repetido (deuda 144).

## 6bis. Intake conversacional (detalle en `context/06bis-…md`)

17 pasos (`_shared/camposOferta.ts`, compartidos con el panel vía `GET crear-oferta/campos`):
familia → producte → varietat → producte_al_camp → kg → format_entrega → caixes → retorn →
transport → ubicacio → disponible_fins → horari → modalitat (lista, «Totes») → preu_minim →
cost_kg → causa → observacions; condiciones en lista (`condicions`), textos ca/es en el propio
descriptor (`tests/camposOferta.test.ts` vigila el castellano y los 72/20 caracteres de Meta).
Arranca con guía Sí/Ara no; listas de 9 + «Més…»; 3 fallos → aviso y repite; `Stop` cancela;
texto libre ≤400; ubicación por Maps o `location`; convenio comprobado al final. Bot en catalán.

## 6ter. Paneles y procesos (detalle, por fecha y fase, en `context/06ter-…md`)

| Panel | Rutas | Qué ve |
| --- | --- | --- |
| Equip | `/equip/tauler · canalitzacio[/:id] · ofertes[/:id] · espigolades · aprovacions · missatgeria · albarans · productes · tancament · entitats[/nova · /:orgId] · convenis · documents · diagnostics · plans · configuracio` | Todo; badges de `pendents_equip()` |
| Productor | `/productor/inici · ofertes · ofertes/nova · ofertes/:id · documents` | Sus ofertas, embudo agregado, alta con el cuestionario del intake |
| Receptor | `/receptor/mercat · interessos · historic · impacte · documents` | Ofertas compatibles (RLS con `modalitat_receptor_compat`), interés, histórico |
| Organització | `/organitzacio · perfil-recepcio · diagnostic · pla` | Ficha propia por secciones (el equipo no la ve) |

Lo que manda hoy, en una línea cada uno:
- **El modelo del proceso** (`lib/procesOferta.ts`, `seguentPas.ts`, `components/proces/`):
  etapas publicada → assignada → recollida → confirmada → tancada; «lo que te toca» en `aviso`,
  lo demás neutro; **estados simples** para los paneles externos (`BadgeEstat`).
- **Validación**: una oferta de productor nace `pendent_validacio` (interruptor
  `validacio_ofertes`); el equipo valida o rechaza. Modalidad múltiple; franja de recogida.
- **Avisos** (`avisos` + `enviar-avis`, campana y badges); D1 tras aprobar (las partes se ven);
  editar oferta por `crear-oferta/editar` con D4 (revalidación).
- **La recogida la cierra el receptor y la valida el admin** (17-10-2026): el receptor declara
  kg (coincideix/menys/més), el admin valida desde Aprovacions › «Recollides per validar» y
  solo entonces se emiten ENT/OPE y REC con los kg reales y se concilia; con incidencia,
  motivo obligatorio. El job de la hora ya no emite: avisa.
- **Destino final de los kilos** (`excedente_destins`, `DestiFinal`): `cerrada` = todo con
  destino; `no_colocada` = falta decir qué pasó; `cancelada` = error o incidencia con motivo.
- **Ficha de la operación** (`operacio_detall`), ofertas «per a tu», «No m'interessa».
- **Certificado revisado antes de firmarse** (`revisio_estat`; en real exige revisión y
  super_admin). **Convenio único de col·laboració** por papel. Filtros comunes (`lib/filtres.ts`,
  `BarraFiltres`). Ficha de la organización con listas cerradas, `tipus_activitat`, contactos,
  NIF válido y único, razón social obligatoria, «afegir paper». Tablero con indicadores por
  periodo; foto de la oferta por WhatsApp y correo. Diagnòstic operatiu v2 (ficha viva, sin
  plan automático) y perfil de recepción; Pla de Prevenció como **expediente**; «El meu impacte».
- **Gestión autónoma del super_admin** (27-10-2026, publicado `3907281`): convenio
  **declarado**, interés asistido con hora, `registrar_recollida_assistida`, mensajes de cada
  paso para copiar (`missatgesOferta.ts`, `MissatgesDelPunt`) con las notificaciones apagadas;
  **Ciclo guiado** `/equip/canalitzacio/:id`: 17 pasos en 6 fases (`passosCanalitzacio.ts`,
  `components/equip/fases/`) sobre las RPC reales (`tests/e2e/paritat-assistida.e2e.ts`).
- Otros: «Productes» con icono propio y coste de referencia; espigoladas (alta manual y
  conversión desde oferta); documentación de la organización (archivo previo, convenio en papel);
  Els meus documents con «Pendent de tu» (firmar y confirmar desde el panel, diálogo
  `DialegFirmaConveni`); verificación pública del sello (`/verificar/:codi`); doble rol = todos
  los paneles en el menú, el activo se deriva de la URL, `useOrganitzacio(tipus)` y `key` por
  tipo; vocabulario («oferta», «Coberta», «Excedents disponibles», «Entitats»/«ofertant»/
  «receptor», «certificat d'aprofitament alimentari»); el ofertante no ve el código `E-…`.
- **Ficha única «Entitat» (1C, D1+D8)**: `lib/campsFitxa.ts` es **la única definición de campos**
  (tabla, bloque, quién ve y edita; `tests/campsFitxa.test.ts` exige toda columna clasificada y
  `edita: tots` = lista blanca de las RPC del actor, leída del SQL). `EntitatDetall`
  (`/equip/entitats/:orgId`) pinta una ficha por organización —Identitat · Rols · Contacte i accés ·
  Adreça · Com a ofertant · Com a receptor · Diagnòstic · Documentació · Gestió interna— y guarda
  **solo lo que cambia**, en las dos fichas si el campo es común. `PerfilOrganitzacio` pinta los
  mismos bloques con `veu: tots` por sus RPC (P5). Listado `Entitats` sobre
  `v_entitats_llistat`, **solo activas por defecto** (P10), filtro de papel por `?rol=`.
- **«Nova entitat» en dos pasos (1B)**: `/equip/entitats/nova` (`NovaEntitat`, `lib/novaEntitat.ts`).
  1 «Qui és?»: `cerca_entitats` al teclear → una inactiva se activa (NIF y razón social si faltan), una
  activa abre su ficha, al que le falta un papel se le añade; 2 «És nova» → `crear_entitat()` con
  `CLAUS_ALTA` de `campsFitxa` (paridad con el SQL en `tests/campsFitxa.test.ts`). `components/fitxa/`,
  `hooks/useEsborrarFitxa`. Retirados `RecordDetail`, `crudCampos`, `FitxaRegistre`,
  `ProducersList`, `EntitiesList`.
- **«Dona-li accés» (1D)**: el alta del equipo es sin cuenta; el acceso se da en la ficha
  (`fitxa/AccesEntitat`, `lib/accesEntitat.ts`: estado, dar, reenviar y desactivar, con motivo) o con
  la casilla de «Nova entitat» (si falla, el alta se queda). Retirados `DialegAltaAssistida` y el modo
  `assistit` de `FormulariAlta`.

## 6quater. Parte pública y accesos (detalle en `context/06quater-…md`)

`SessioProvider → RouterProvider`; `ArrelApp` desvía `PASSWORD_RECOVERY` a `/restablir`;
`RequireSessio` monta `AppContextProvider` solo con sesión. **El contexto falla cerrado** (un
error no concede nada; pantalla «No s'ha pogut carregar»); `carregant` solo en la primera carga;
`SIGNED_IN` no recarga si es el mismo usuario. Rutas: `/` landing · `/login` (usuarios, con
accesos de prueba tras `VITE_ACCESSOS_TEST` y `AccesAmbCodi`) · `/admin` (equipo, no enlazado)
· `/registre` (uno o los dos papeles) · `/restablir` · `/privacitat` · `/confirmar/:token` ·
`/signar/:token` · `/factura/:token` · `/verificar/:codi` · `/panell` (raíz por rol) ·
`/sense-acces`. `RoleGuard` redirige a `/panell`. Redirecciones de 1C: `/equip/productors[/nou]`
→ `/equip/entitats[/nova]?rol=ofertant`; `/equip/productors/:id` y un id de ficha en
`/equip/entitats/:id` → la organización. Aprovacions: cuatro colas (registros,
convenios por contrasignar, intereses, recogidas por validar); aprobar un alta manda el acceso
por correo (`enviar-acceso`, casilla «usuari de prova» antes).

## 7. Convenciones (detalle en `context/07-convenciones.md`)

- Teléfonos E.164 sin `+`; endpoint de Meta con versión del entorno (`v23.0`).
- Interfaz bilingüe ca/es por claves (`src/lib/i18n.tsx`, defecto `ca`); comentarios en
  castellano; WhatsApp en catalán. Singular `<clau>_1` con `n`. **Una clave compuesta desde un
  valor de la base se declara en `tests/i18n.test.ts`**; `tests/cobertura.test.ts` vigila menú,
  rutas y claves literales.
- 🔴 **Borrar una ficha = borrar todo lo suyo y nunca dejar huérfanos**, salvo lo fiscal, que
  bloquea: solo `borrar_ficha_completa()`.
- Secretos nunca en el código. **Sin servicios externos nuevos**: npm dentro del stack y lo que
  da Supabase. **Los módulos hoja de `_shared/` se importan desde `src/`, no se copian**
  (`tests/puresa.test.ts`); las copias antiguas (`modalitats`, `franja`, `textosRgpd`,
  `expedient`) se quedan con su test de paridad.
- Agentes `.claude/agents/`: `dades` → `servidor` ∥ `interficie`, ficheros disjuntos, sin
  worktrees; los compartidos (`config.toml`, `types.ts`, `nav.ts`, router, `i18n.tsx`,
  `_shared/*.ts` salvo `pdf/`, este documento) los toca la sesión que orquesta. Opus a esfuerzo alto.
- `docs/`, `scripts/data/`, `.claude/settings.local.json`, `.claude/launch.json` y
  `supabase/.local-dump/` nunca entran en git.
- **Claves nuevas de Supabase** (`sb_publishable_…`/`sb_secret_…`); las legacy están
  deshabilitadas (401). Rol ≠ clave.
- `sendWhatsApp()` y los clientes de `src/lib` nunca lanzan. El tipo de una fila vive junto a su
  `select`; **la lista de columnas de un `.select()` va en un solo literal**.
- Migraciones `AAAAMMDDHHMMSS_desc.sql`, nunca editar una aplicada; **su número es el del
  fichero** (`aplicar-migracion.ts` lo registra así; `apply_migration` del MCP no se usa).
  Compatibles hacia atrás (el frontend vigente sigue sirviéndose). Última: `20270501500000`.
- **Una sola rama en git (`main`) y en Supabase** (branching desactivado: las Edge Functions
  **no se despliegan con el push**).
- El CLI dentro del sandbox necesita `HOME` escribible y `api.supabase.com` permitido; `db push`
  no pasa (conexión Postgres directa).

## 8. Reglas de negocio (detalle en `context/08-…md`)

- **Interruptores de notificaciones** (Configuració › Notificacions, solo super_admin):
  general `notificacions_actives`, `email_activo`, `whatsapp_activo`; canal efectivo = general
  **y** canal; apagar el general apaga los dos, encenderlo no los enciende. Cortan **toda**
  comunicación operativa (un solo punto por canal: `sendEmail()` y `enviar()`, que devuelven
  `ok:false` 503 `email_desactivat`/`notificacions_desactivades`/`whatsapp_desactivat`, nunca un
  simulado); no cortan lo **transaccional** (`enviar-acceso`, `recuperar-password`, con
  `{transaccional:true}`). El correo de `donar-acces` **no** lo es: apagado → 409 sin crear nada. La interfaz esconde el apartado de un canal apagado (Missatgeria) y
  deja gris lo que envía (`BotoAmbMotiu`, `motiuCanal()`). En producción los tres encendidos.
- `WHATSAPP_ENVIO_REAL` (secreto; `"true"` exacto o simula) y `RESEND_ENVIO_REAL` (ídem).
- **Reglas de envío** en `whatsapp-send`: `exigirEquipo` 401 → campos 400 → interruptor 503 →
  gate `es_test` 403 `no_test_user` → `meta_test_recipients` 403 → contacto 404 → ventana 24 h
  409 `window_closed` (texto) / opt-in 403 `no_opt_in` (plantilla); BAIXA corta todo
  (403 `opt_out`).
- **Modo test** (`app_settings.test_mode`, fail-safe activado): con él solo reciben las fichas
  `es_test`; aplicado en los quince puntos de envío **y en las dos puertas de salida** (`enviar()`,
  `sendEmail()`); `esCuentaPermitida` para acceso y recuperación (pasa el equipo). Documentos
  `modo='prueba'` → `destinatariosPrueba()` aunque el modo test esté apagado. Whitelists:
  con filas, solo a quien esté; vacías, no restringen.
- Proceso de canalización: intake → distribución → confirmación → cierre. Valor = kg × coste
  por kilo de la canalización (nunca `productos.eur_kg` para lo fiscal).

## 8bis. Canal preferente

El **correo es el canal por defecto**; WhatsApp solo cuando se puede (`_shared/canal.ts`, puro):
interruptor apagado → correo; móvil y ventana abierta → WhatsApp texto; móvil y opt-in →
plantilla; si no, correo; sin ninguno, `cap`. `canal_preferido` de la organización se respeta
si es viable (`preferenciaRespetada`). Lo decide el servidor (`priorizar-entidades` devuelve
`canal`, `motiu_canal`…); `enviar-acceso` acepta `canal:'auto'`.

## 8ter. Cuando Meta rechaza

Se registra `wa_messages.status='error'` (wamid sintético `err-…`). `scripts/diagnostico-whatsapp.ts`
distingue: `190` token caducado (nuevo secreto + redesplegar); `100/33` token sin acceso al
`phone_id`; `131030` destinatario fuera de los ≤5 de test; `131047` ventana cerrada.

## 9. Seguridad (detalle en `context/09-…md`)

- 🔴 **Cortina de contraseña delante de toda la web** (Vercel middleware `middleware.js`,
  generado de `cortina/` con `scripts/construir-cortina.mjs`; cookie `redestina_cortina` 7 días;
  solo `HASH_TOKEN` en git; `scripts/cortina-hash.mjs` para cambiarla; libres solo
  `logo-email.png`, el sello, favicon y `sw.js`; `/__cortina/surt` borra la cookie). Los enlaces
  de correo y `/verificar` piden la contraseña primero.
- Todo dato exige sesión de Supabase Auth; `anon` sin privilegios. Login con
  `signInWithPassword` (`FormulariAcces`); recuperación por `recuperar-password` +
  `admin.generateLink` + Resend; `enable_signup=false` y el **mailer nativo apagado** (nunca
  `resetPasswordForEmail`, `inviteUserByEmail` ni magic links nativos). Resend con dominio
  `espigoladors.com` verificado; `plantillaEmail()` en `_shared/resend.ts` es el único maquetado
  (cabecera clara con `logo-email.png`; `textoAHtml` escapa).
- `enviar-acceso`: enlace por correo, **solo el código de 6 cifras por WhatsApp** (canjeado en
  `/login` con `verifyOtp`). `registro` público: crea cuenta + ficha + membresía **pendiente**,
  deduplica por correo/teléfono exactos (principales deniegan `409`, secundarias → revisión),
  anti-abuso proporcionado, no manda correo (aprobar sí). RGPD: privacidad obligatoria + dos
  consentimientos (`consentiments`, huella del texto del servidor).
- `donar-acces` (1D, JWT + `pot_aprovar`; sustituye a `alta-assistida`): cuenta si no la hay →
  `concedir_acces_org` → enlace `recovery` por correo; si falla, `revertir_acces_org`. Correo apagado
  409; modo test, solo `es_test`. Sin consentimientos (deuda 152).
- Firma por enlace: el servidor compone y hashea el texto (`409 document_canviat`); tres vías
  —correo, asistida (segundo factor solo si la persona pide el código), panel— y el PDF las
  distingue; mínimos `MIN_NOM`/`MIN_DNI` en cliente y servidor. Confirmación de albarán:
  `sha256_texto` del acta del servidor; D3 también en la API.
- Cuentas de prueba: 5 organizaciones `TEST-*` y 7 cuentas (`crear-usuarios-prueba.ts`), 5 de
  WhatsApp sobre fichas reales del equipo (`crear-usuarios-whatsapp.ts`, una cuenta un papel desde
  el escenario demo), `hola+pendent-arnes@` (**pendiente, no aprobar**) y `hola+senserol-arnes@`.
  Credenciales en `scripts/data/cuentas-prueba.json`; las del bundle de `/login` solo con
  `VITE_ACCESSOS_TEST`.
- ⚠️ **Nunca `supabase config push`** (apagaría el login por email y subiría el Auth local); los
  flags de Auth van por Management API.

## 10. Variables de entorno

Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_ACCESSOS_TEST` (de build).
Edge Functions: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_API_VERSION`, `WHATSAPP_ENVIO_REAL`, `ALLOWED_ORIGIN` (varios
orígenes, `*` dentro de uno; **redesplegar al cambiarlo**), `RECORDATORIOS_SECRET`,
`DOCUMENTOS_SECRET` (y en `app_config`), `RESEND_API_KEY`, `RESEND_ENVIO_REAL`, `RESEND_FROM`,
`APP_URL`, `SB_SECRET_KEY`, `URL_PUBLICA_STORAGE`, `ANTIABUS_*` y `MAILPIT_URL` (solo clon). Auth:
`site_url` y `uri_allow_list` por Management API (matcher de GoTrue con `/**`; el de las
funciones sin). Scripts: `SUPABASE_URL`, `SB_SECRET_KEY`.

## 10bis · 10ter. Nombres retirados

`pdApp-wp` → `P0MA` → `Redestina` (10-09-2026). No crear repos con los nombres viejos (rompería
las redirecciones). `Poma` es la manzana del catálogo: sustituciones sensibles a mayúsculas. El
próximo cambio de dominio exige 308. Verificar CORS leyendo la cabecera
`Access-Control-Allow-Origin` del preflight, no el código de estado.

## 11. Comandos (detalle en `context/11-comandos.md`)

```bash
npm run dev            # contra PRODUCCIÓN (.env.local)      npm run dev:local   # contra el clon
npm run build          # tsc strict + vite                  npm run check       # tipos + lint + vitest + deno check
npm test               # vitest run                         npm run lint
deno run -A scripts/comprobar-rls.ts          # arnés (contra lo que diga SUPABASE_URL)
eval "$(bash scripts/local/entorno-local.sh)" # variables del CLON para los scripts (nunca source .env.local)
supabase migration up                          # aplicar migraciones al clon (NUNCA --linked; nunca db reset --linked)
bash scripts/local/funciones-local.sh          # Edge Functions del clon (log en scripts/data/funciones-local.log)
E2E_CLON=1 E2E_ESCRIU=1 npx playwright test tests/e2e/<f>   # E2E contra el clon (PW_CHROMIUM_PATH si hace falta)
git config core.hooksPath .githooks            # una vez por clon
```

- **Clon local** (Docker, todo con «Redestina»): API `127.0.0.1:55321`, Postgres `55322`
  (`postgres/postgres`), Studio `55323`. Se arranca y para con la skill `supabase-local`; se monta
  o refresca con `scripts/local/` (volcar → preparar-entorno → cargar-local → copiar-storage); el
  volcado tiene que tener al menos las migraciones del clon. Correo y WhatsApp simulados; jobs
  contra las funciones locales; `roles_activos` y `test_mode` encendidos. El servidor de funciones
  se cae por memoria (`exit 137`) generando varios PDF a la vez: relanzarlo.
- **Producción, con token temporal**: `bash scripts/sesion-supabase-temporal.sh` en la terminal
  del usuario (PAT `Redestina - Admin - Producción`); dentro, `deno run -A
  scripts/aplicar-migracion.ts <f> [--dry-run]`, `supabase functions deploy <f>
  [--no-verify-jwt según config.toml]`, `secrets set`, Management API. El asistente **no pide ni
  lee el token** y sus herramientas no heredan la variable; en la app de escritorio los comandos
  van en el panel de terminal, una sola pestaña, scripts por fase en `scripts/data/` con log.
- **Publicar**: skill `/publicar`, orden **base de datos → Edge Functions → frontend** (`git push`
  el último). Tras redesplegar `generar-documento`, emitir un documento de prueba
  (`emitir_documento_prova()`: 6 páginas, ~123.600 bytes). Tocar `_shared/` obliga a redesplegar
  todas las que lo importan. Logs remotos por el Management API de analítica
  (`function_logs`, `edge_logs`, con `iso_timestamp_*`).
- Fixtures: `crear-usuarios-prueba.ts` → `crear-usuarios-whatsapp.ts` →
  `crear-datos-documentales-prueba.ts` → `crear-respuestas-prueba.ts`; `escenari-demo.ts`
  (consume numeración); `prueba-numeracion.ts`; `limpiar-e2e.ts`.
- Emergencias: `scripts/roles-activos.ts off`; `update app_settings set value='false' where
  key='whatsapp_activo'`.

## 12. Checkpoints y deuda técnica (cuerpo completo en `context/12-…md`)

**Checkpoints de negocio (no código)**: 2 plantillas propias en Meta y número de producción
(flags `PLANTILLES_CA_APROVADES`, `PLANTILLA_OFERTA_APROVADA`); 3 opt-in real; 4 formato legal
del albarán; 5 reexportar `prod_actius.csv`; 6 paso a producción de Meta; 7 apagar
`VITE_ACCESSOS_TEST`; 8 avisar a mano la validación de altas; 9 checklist de ficha antes de
aprobar; 10 **datos reales de la Fundación** en `parametros_documentales` (desde Configuració ›
Fundació); 11 textos legales de las plantillas; 12 casar `municipio_ine` de las ubicaciones.

**Deuda abierta (62 vivas; la siguiente entrada nueva es la 153; los números no se renumeran ni
se reutilizan)**. Casi todas son **decisiones con precio conocido, espera de material o
interruptores** (clasificadas en §12bis). Defectos o trabajo real pendiente: **5** (listados
filtran en cliente, aceptado por volumen) · **85** (prueba E2E del CT, ya posible) · **126**
(`documentos_objeto_existe` no conoce `cierre_periodo`) · **127** (el correo del resumen sigue
ofreciendo la factura) · **128** (canalización conciliada sin coste no se puede valorar después)
· **135** (D3 residual en snapshots y `v_albaranes_bandeja`) · **136** (sin code splitting,
chunk de 1,65 MB) · **138** (CR sin rectificar ni «enviat» desde la interfaz; CT sin «enviat») ·
**139** (verificar el REC con varias modalidades) · **140** (`borrar_ficha_completa` no conoce
los expedientes) · **142** (consentimientos sin exportación; la pantalla la dio 1C) · **143**
(entrantes con WhatsApp apagado no los ve nadie) · **144** (el trigger del NIF rechaza filas del
import) · **146** (`organizacion_contactos` sin uso, pendiente de borrar) · **149**
(dos vistas sin consumidor desde 1C) · **151** (rama muerta `alta_assistida` en `registro/alta.ts`)
· **152** (privacidad en el primer acceso de «Dona-li accés», P3: condición para apagar el modo test).
Decisiones de negocio pendientes: **131** (D3 en la capa REST de `excedentes`), **132** (el
`tecnic` escribe directo en `canalizaciones`/`excedentes`), **133·134** (frenos de
`recuperar-password` y `registro`), **137** (privilegios por defecto de funciones), **69**
(backfill de `data_hora_recollida`), **141** (sin freno de 48 h, decidido), **148** (la entidad
inactiva sigue viendo las ofertas que ya se le enviaron). Resto: 4, 10, 12,
17, 21, 24, 26, 27, 30, 34, 37, 54, 55, 66, 67, 70, 71, 72, 76, 77, 80, 81, 83, 84, 91, 92, 93,
95, 97, 98, 109, 110, 111, 113, 114, 115, 116.

**§12bis** (decisiones con precio, material de terceros, interruptores, decisiones de negocio) y
**§12ter** (86 cerradas, indexadas porque 48 números se citan desde código que no se puede
editar) viven en sus ficheros de `context/`.

## 13. Al terminar cualquier cambio

1. **`npm run check`** en verde (tipos de app y pruebas, `lint`, `vitest run`, `deno check` de
   scripts y funciones, `deno test` del PDF). **Referencia: 1.587 pruebas de Vitest en 67
   ficheros (1 saltada a propósito) + 9 de Deno.**
2. `npm run build` si toca `src/`.
3. `deno run -A scripts/comprobar-rls.ts` si toca datos, políticas o roles.
   **Referencia: clon 1.677/1.677 y 29 sin datos (tras 1D, +36); producción 1.683/1.683 y 23
   (la diferencia son datos). «Sin fallos de permisos».** Una
   cifra que sube o baja sin checks nuevos es cambio de **datos**, no de permisos; la cuenta
   `pendent-arnes` aprobada por error da cuatro FALLA de «ve 1 fila». `prueba-numeracion.ts` si
   toca la numeración.
4. E2E de lo tocado contra el clon (`tests/e2e/*.e2e.ts`; `ajuda.ts` da `sql()`, `sqlCom()`,
   `compte()`, `motiuSaltClon()`).
5. Publicar con `/publicar` (base → funciones → frontend).
6. Estilos solo con tokens; un token nuevo va a `tokens.json`, `index.css` y `preview.html`.
7. **Actualizar este fichero (≤ 48 KB) y el `context/<sección>.md` que toque**; §1bis si cambia
   el alcance; la deuda: lo resuelto se tacha, lo nuevo se anota con el número siguiente.
8. Commit en castellano, con el qué y el porqué. Pre-commit: tipos + vitest + deno check.
