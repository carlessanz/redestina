# AGENTS.md

Documento canónico de contexto para agentes de IA (Claude Code, Codex, Cursor…) que
trabajan en este repositorio. `CLAUDE.md` lo importa; **no dupliques contenido allí.**

> **Regla permanente:** toda modificación que cambie la arquitectura, el esquema de datos,
> los contratos de las Edge Functions, las convenciones o los comandos **debe actualizar
> este fichero en el mismo cambio.** Si el código y este documento discrepan, el documento
> está roto.

> 🔴 **Regla de tamaño (02-11-2026): este fichero se carga ENTERO en cada sesión y no puede pasar
> de 48 KB** (llegó a 681 KB y cada sesión se compactaba antes de empezar). Aquí vive **solo lo
> vigente, compacto**; el detalle, la historia y los porqués de cada § están en
> **`context/<sección>.md`** (bajo demanda, con la misma regla permanente; «AGENTS.md §N» vale para
> los dos). `tests/agentsMida.test.ts` falla si se pasa. **Lo histórico va al detalle, nunca aquí.**

Detalle por §: 1 `context/01-proyecto.md` · 1bis `context/01bis-vision-funcional.md` · 2 `context/02-stack.md` ·
2bis `context/02bis-sistema-de-diseno.md` · 3 `context/03-estructura.md` · 4 `context/04-modelo-de-datos.md` ·
4bis `context/04bis-identidad-roles-permisos.md` · 5 `context/05-flujos.md` · 6 `context/06-importacion-datos-maestros.md` ·
6bis `context/06bis-intake-conversacional.md` · 6ter `context/06ter-distribucion-cierre-panel.md` ·
6quater `context/06quater-parte-publica-registro.md` · 7 `context/07-convenciones.md` ·
8 `context/08-reglas-de-negocio.md` · 8bis `context/08bis-canal-preferente.md` · 8ter `context/08ter-cuando-meta-rechaza.md` ·
9 `context/09-seguridad-autenticacion.md` · 10 `context/10-variables-de-entorno.md` (+ `context/10bis-nombres-retirados.md`,
`context/10ter-rename-completado.md`) · 11 `context/11-comandos.md` · 12 `context/12-checkpoints-y-deuda.md` (+
`context/12bis-decisiones-con-precio.md`, `context/12ter-deuda-cerrada.md`) · 13 `context/13-al-terminar-un-cambio.md`.

---

## 1. Proyecto

**Redestina** (antes PDApp / P0MA) — plataforma de canalización de excedentes agrícolas de la
Fundació Espigoladors, con WhatsApp Cloud API como canal. Un productor ofrece un excedente, el
sistema lo convierte en una **oferta** con identificador propio, prioriza **entidades**
receptoras y registra las **canalizaciones** hasta el cierre con kg reales, albaranes y
certificados. Dos fases construidas: **1. infraestructura WhatsApp** y **2. Redestina**
(intake, priorización, canalización, cierre, sistema documental, paneles por rol).

- Meta en **pruebas** (`WHATSAPP_ENVIO_REAL=true`): solo entrega a los ≤5 de `meta_test_recipients`
  (el resto, `131030`). Mensajería siempre individual (la Cloud API no escribe en grupos).
- **Documentación fuera del repo**: `docs/` (ignorado; funcionales y credenciales) y la carpeta de
  Drive `…/03-Redestina/` (se escribe solo en `3. Claude Code/`, nunca datos personales; detalle en
  `CLAUDE.md`). Jerarquía: *Definición de producto v3* (porqué) › *funcional 2026 v3* (qué) › guía
  técnica (cómo).
- **Planes vivos** (`3. Claude Code/`): plan 1 CRM (**1E solo en el clon**, carga en producción antes del 31-12).
- Vocabulario: la tabla `excedentes` es la «oferta» de los textos («AFCV» en el funcional).

## 1bis. Visión funcional (objetivo ↔ construido)

Servicio apoyado por tecnología, **modelo asistido** (el equipo opera en nombre de las
organizaciones), ERP fuente única, **multirol real**, cinco líneas (donación —core—, salida
comercial, maquila, espigueo, diagnóstico/prevención). Flujo core: registrar → validar →
publicar → match asistido → recogida → albaranes → conciliación → certificados.

Construido ✅: usuario/membresías, convenios con firma por enlace, excedentes, canalizaciones
con conciliación, albaranes REC/ENT/OPE sin huecos, documentos externos, certificados CD/CR,
roles y RLS, registro self-service validado, i18n ca/es, responsive, comunicación WhatsApp+correo,
coste por kilo, PWA. Parcial 🟡: organización multirol (`organizaciones` es identidad común;
faltan `usuario`/`rol_organizacion` propios y campos propios), `interes`, `sugerencia_match` (no
persiste), plantillas en código, diagnóstico (ficha viva v2) y Pla de Prevenció (expediente
provisional), espigueo, catálogos, back office, parte pública, indicadores (`kpis_equip`,
`impacte_*`). Pendiente ⬜: `demanda`, `notificacion` con fallback, encuestas,
`historial_estado`, adjuntos de WhatsApp. **Lo que bloquea hoy es material de la fase 0**
(textos legales, datos fiscales, taras, cuestionario), no código.

## 2. Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | Vite 7 + React 19 + TypeScript 5.9 `strict` + Tailwind v4 + shadcn/ui + react-router v7 |
| Datos | Supabase (`@supabase/supabase-js` v2), Postgres con RLS + GRANT, Realtime |
| Backend | Edge Functions (Deno); correo por **Resend** |
| Scripts / pruebas | Deno 2.x; Vitest 4; Playwright (E2E); `deno test` para el PDF |
| Hosting | Vercel (proyecto `redestina`, dominio `redestina.carlessanz.com`) |

- Router como capa raíz con rutas públicas y privadas (§6quater). Sin librería de estado.
  `vercel.json` lleva el rewrite de SPA.
- **Contrato de alturas**: shell `h-dvh overflow-hidden`; `main` `min-h-0 flex-1` scrollea con
  `scrollbar-gutter: stable`; ninguna pantalla escribe `h-dvh`. Flags de ruta `fullBleed` y `ample` (Configuració: 2 columnas desde `xl`).
- **Barra inferior de móvil: cuatro entradas como máximo** (`barra: false`, `labelBarraKey`).
- **PWA sin service worker** (`selfDestroying`); `/version.json` + `useVersioNova` avisan de versión.
- **Siete reglas de móvil medidas** (en el detalle): controles ≥16 px, `Button` `whitespace-nowrap
  shrink-0`, `safe-area-inset`; **auditar `scrollWidth > clientWidth` en los hijos**.
- **Tablas**: sin scroll horizontal (secundarias `hidden md:table-cell`), acciones en `BotoIcona`
  (tooltip y `aria-label`); `colSpan` completo con `usePuntTall`.

## 2bis. Sistema de diseño

`design/tokens.json` (fuente única), `design/DESIGN.md` (uso), `design/preview.html` (muestra).
Reglas: **ningún hex ni clase de la paleta genérica de Tailwind**; solo las clases de
`src/index.css` (shadcn + extensión REDESTINA: `coral*`, `verde-claro/oscuro`, `exito`, `aviso`,
`error` y sus `-fondo`, `chart-1…5`, `font-titulos`, `text-nav` solo para la barra inferior).
`accent` no es el coral; el error es rojo; títulos en Sora; nombres de shadcn no se renombran;
`index.css` se deriva a mano de `tokens.json` (y los colores del correo viven en
`_shared/resend.ts`). Logo en seis variantes en `public/` (y el de la Fundació, `logo-espigoladors.svg`, que lleva el
CD); `logo-email.png` es el logo en color
(cabecera de correo clara); el sello `segell-redestina.svg` va sin texto. Ningún control de
formulario estilado a mano (`components/Casella`, `ui/input`, `components/Desplegable`, nunca
`<select>`; E2E con `tria()`); controles de 32 px en escritorio. Badge sobre fondo de
color = chip blanco, texto en color. `{n}` reservado a contadores (singular `<clau>_1`). Sin
modo oscuro. Dos h2 de la portada, en `coral-oscuro` por decisión del cliente.

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
  lib/ (módulos PUROS con test: importEntitats, normalitzaImport, procesOferta, passosCanalitzacio, seguentPas, validacio, format,
        cerca, filtres, missatgesOferta, destiFinal, registreRecollida, diagnostic, i18n…)
  types.ts · index.css
scripts/  comprobar-rls.ts (arnés) · aplicar-migracion.ts · local/ (clon) · import-ara-2026.ts + ara2026/ · crear-*.ts ·
          escenari-demo.ts · historial-migraciones.ts · huellas-funciones.ts · data/ (ignorado)
supabase/ config.toml · migrations/ · functions/ (_shared/ con pdf/, hojas de texto, gate, canal,
          autorizacion, resend, pujada; 24 funciones: whatsapp-*, crear-oferta, registro, donar-acces,
          enviar-*, *-documento, enlace-publico, priorizar-entidades, recordatorios-*… ; lista en `context/03`)
docs/ (ignorado por git)
```

## 4. Modelo de datos (detalle y porqués en `context/04-modelo-de-datos.md`)

**Mensajería**: `wa_contacts` (`phone` E.164 sin `+`, opt-in, `last_inbound_at` = ventana 24 h),
`wa_messages` (`wa_message_id` único: idempotencia; `raw` guarda opciones de los interactivos).
Sin FK con `productores`: unidas por teléfono.

**Fichas**: `productores` y `entidades` (dos tablas, con `es_test`, `activo`, `nif` validado por
trigger `*_nif` —`nif_invalid`/`nif_en_us`—, `razon_social`, `municipio_ine` → trigger rellena
`poblacion` (siempre un municipio; si no casa, a `ubicacio`) y `area_geografica` =
comarca (editable), `tipus_activitat[]`, `perfil_receptor` jsonb,
`tipo_receptor` social·animal·transformador·comercial, `modalitats_interes`, `ref_externa` =
origen de la importación, 1E y §6; registro en `importacions_entitats[_files]`, sin escritura directa), ambas colgando de
**`organizaciones`** (identidad común, `organizacion_id not null` por trigger; una ficha de cada
tipo por organización; solo guarda identidad y `canal_preferido`, escrito por
`actualizar_meu_canal()`). Vista `v_organizaciones` (`security_invoker`). `productor_ubicaciones`
(lugares de recogida). Fiscal (`20270517100000`): `regim_iva`, `*_fiscal` (si hay domicilio fiscal,
convenio y certificados lo usan: `dada_fiscal()`), `contacte_facturacio_*`; `data_alta` («Data d'alta a
l'organització», editable, trigger si falta) y `created_at` («Alta a la plataforma», solo lectura), equipo.

**Estado de las fichas** (1A; **B1 `20270518100000`**): `estat_crm` (potencial · en_desenvolupament ·
actiu · inactiu) **MANDA** y `activo = (estat_crm = 'actiu')` lo deriva `trg_fitxa_estat` (`update of
activo, estat_crm`; el `activo` legado se traduce) y `*_estat_alta`. Organización activa si lo está algún
papel (D7). Activar exige NIF válido y razón social (`falta_nif`·`nif_invalid`·`falta_rao_social`); todo
cambio va a `fitxa_estat_hist` (solo equipo). Nace: `crear_entitat` actiu, importador potencial, registro
en_desenvolupament (`aprovar_registre` intenta actiu). Una entidad inactiva no entra en el Mercat (`modalitats_compatibles_meves()`), ni en
`priorizar-entidades`, ni en los selectores, y `comprova_interes()` la rechaza (`entitat_inactiva`).
**Un contacto por ficha (D3)**: `organizacion_contactos` se conserva sin uso (deuda 146). **1C**: vista
`v_entitats_llistat` (`security_invoker`) para «Entitats». **1F + 1.5**: `notes_internes` (CRM) solo
por RPC; lectura `es_intern()` (externo: 0 filas); la vista suma el último contacto y los seguimientos.

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
`tipos_caja`, `municipios` (947, INE), `codis_postals`, `tipus_activitat`, `factors_impacte`,
`modalitat_receptor_compat` y `convenios_exigidos` (reglas **en tabla**), `convenis_equivalents`.
Whitelists `meta_test_recipients`, `email_test_recipients` (vacía = sin límite). `app_config`
(secretos de jobs, solo `service_role`) y `app_settings` (`test_mode` fail-safe cerrado;
`roles_activos`, `whatsapp_activo`, `email_activo`, `notificacions_actives` fail-safe abierto;
`validacio_ofertes`). `consentiments` (RGPD, solo inserción; sin cuenta, por enlace
`consentiment_rgpd`: el equipo lo pide, no lo marca).

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
columna nueva de `documentos` nace sin SELECT. **Circuito de firma (05-11-2026)**: la contraparte
firma CD·CR·REC·ENT (trazo en panel/enlace, o PDF firmado subido) y CONV (solo subido); una firma =
**versión n+1 `subtipo='signat'` con el mismo `sha256_datos`**; `firmes_document` (vía canvas·pujat·
correu; estat signat·tancat·rebutjat; sin DNI) lo registra, «pendent» lo deriva
`document_part_signant()` y lo sirven `v_signatura_document`/`v_signatures_bandeja`. Trazo y subida
del super_admin cierran al momento; la subida de la organización espera en «Signatures per tancar».
Un externo nunca firma en prueba. Nada se bloquea por la firma. El nombre de la Fundació sale del snapshot (`_shared/pdf/fundacio.ts`). **Lo emitido no se reescribe**; solo en
modo test el super_admin lo regenera con los datos de la Fundació de ahora (`regenerar_documents_fundacio`:
versión n+1, salta los firmados; Configuració › Fundació).

**Albaranes** (`albaranes`, `albaran_lineas`: REC entrada · ENT entrega · OPE venta/maquila;
solo `kg_validados` cuenta; **sin columna de importe**; nacen por trigger al crear la
canalización; estados borrador→emitido→entregado→confirmado→conciliado, anulado, rectificado
`R-`). PDF de una página (`albara1p`); el REC de donación imprime valor por kilo (decisión del
cliente). `documentos_externos` (albarán del productor, factura, fotos, archivo previo de la
ficha, evidencias de expediente). **Convenios** (`convenios`: tipos `col_productor`/
`col_receptor` desde el 11-10-2026, los anteriores `don_gen`/`don_rec`/`com` valen por
equivalencia; `origen` plataforma · paper · **declarat**; uno vigente por tipo; número al
firmar; `convenio_vigente()`/`exigir_convenio()`; **fecha de corte encendida** desde el
16-09-2026: sin convenio no se publica ni se muestra interés). **Certificado de donación** (05-11-2026, modelo Tabaquet; detalle en §4 del fichero):
🔴 **certificable = donación conciliada a entidad `social`** (`motiu_exclusio_certificat()`, único
criterio); el REC se reparte en proporción y se descarta lo no certificable. Ámbitos **ejercicio**
(`cierres_ejercicio`, `cierres_donante`, `datos_182()`), **intervalo** y **oferta** (`cierres_periodo`,
serie `CDP`); el anual sustituye a los parciales. **CT retirado**. **Certificado de recepción**
(`cierres_receptor`, serie `CR`, sin importes).
**Diagnóstico y plan**: `questionaris_diagnostic` (v2 productor; receptor retirado),
`mesures_prevencio`, `regles_pla`, `planes_prevencion` (sobre autocontenido),
`diagnostics_historial`, y el **expediente** `expedients_prevencion` + 7 hijas. Impacto:
`impacte_*` sobre kilos conciliados.

**Borrado de una ficha: una sola puerta, `borrar_ficha_completa()`** (`es_super_admin()`):
rechaza con `22023 bloqueig_esborrat: <codis>` si hay **ofertas** (`ofertes`·`ofertes_rebudes`),
documentos, albaranes o cierres; si no, arrastra lo operativo, borra la ficha, retira la
organización vacía y purga la whitelist. FK `NO ACTION` = última red; nunca un `.delete()` suelto
(§7). La ficha pregunta antes: con bloqueo propone **desactivar**; si no, pide escribir «esborrar».

🔴 **Una cuenta del equipo no tiene organizaciones** ni ofertas; **su autoría no es fiscal**. Desactivarla o borrarla **traspasa sus acciones** a otra cuenta activa con rastro por fila; borrar a quien ha hecho algo **exige destino** (`cal_desti`; detalle en `context/04`, «Gestión del equipo»).

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
- **`roles_activos` ENCENDIDO en producción** (fail-open; un entorno recreado nace apagado:
  `scripts/roles-activos.ts`). `hola@carlessanz.com` es `super_admin`; las otras dos del equipo, `admin`.
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
- Triggers de respaldo: `respuestas_control_aprovacio`, `membresias_control_aprovacio`,
  `canalizaciones_protegeix_recollida`, `documentos_inmutable`, `convenios_control`,
  `documentos_firma_substituida` (rechaza sola la firma que esperaba sobre una versión sustituida).
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

Catálogos por migración (`20260721120300_seed_catalogos.sql`). Fichas, dos vías (detalle en §6.1-6.2):
- **`scripts/import-ara-2026.ts`** (1E; núcleo `scripts/ara2026/nucli.ts`): ARA 2026 en CSV en
  `scripts/data/2026/` (nunca en git), por cabecera, **todo inactivo** (D2; `estatCrmDeHoja`), `ref_externa = ARA26:<hoja>:<línea>`,
  NIF inválido o repetido → sin NIF y nota, segunda pasada solo rellena huecos; fuera del clon solo
  `--dry-run` salvo `--produccio`. **El clon lleva las 721 importadas**; refrescarlo desde producción las quita.
- **Importador del panel** (`/equip/entitats/importa`, super_admin; `20270511100000` + B4 `20270519100000`; §6.2, §6.4):
  el navegador mapea por cabecera (`lib/importEntitats.ts`); la base revalida (`previsualitzar_importacio_entitats` →
  `importar_entitats`). Nueva = **`potencial`**. 🔴 **D11 (B4): idempotente y ACTUALIZA** — identidad **ID Redestina →
  NIF → `AIRTABLE:` → hash `IMP:`** (débil = «dubtosa»); con ID o NIF existente nunca crea; **celda vacía no toca, valor
  distinto sobrescribe**, salvo si es lo que ya vale la organización (`entitat_valors_org`: no pisa ni rellena ninguna
  ficha, P-B4-2); la Revisió enseña `canvis` (`abans → després`), guardados en `importacions_entitats_files.canvis`. ID
  inexistente/contradictorio con el NIF = error de fila. Nunca toca `activo`, `estat_crm`, `es_test`, `ref_externa`.
  «Data d'alta» `dd/mm/aaaa`·ISO·**solo año** (ofertant: 1 de enero + aviso, P-B4-1). Plantilla con desplegables (B2).
- **Exportación** (B3, `20270518110000`; §6.3): «Exporta a Excel», todo el equipo, filas visibles; `exportar_entitats`
  (sobre `entitat_valors_org`) → `lib/exportEntitats.ts`: columnas de la plantilla (con «ID Redestina» y «Data d'alta»,
  Z·AA), notas vacías, solo valores que el importador acepta; «Estat CRM» informativo (P9). **Exportar → reimportar =
  `sense_canvis`** (clon: 731/731).

🔴 **En producción, los datos importados del ARA se borraron el 16-09-2026**: quedan 6 productores + 8 entidades
de prueba, `TEST-PENDENT-ARNES` (**no aprobar nunca**: sostiene 73 checks) y `tecnologia@espigoladors.com`
en la whitelist de correo.

## 6bis. Intake conversacional (detalle en `context/06bis-…md`)

17 pasos (`_shared/camposOferta.ts`, compartidos con el panel vía `GET crear-oferta/campos`; textos
ca/es en el descriptor, `tests/camposOferta.test.ts`): familia → producte → varietat → producte_al_camp
→ kg → format_entrega → caixes → retorn → transport → ubicacio → disponible_fins → horari → modalitat →
preu_minim → cost_kg → causa → observacions. Guía Sí/Ara no; listas de 9 + «Més…»; 3 fallos → repite;
`Stop` cancela; texto ≤400; ubicación por Maps o `location`; convenio al final. Bot en catalán.

## 6ter. Paneles y procesos (detalle, por fecha y fase, en `context/06ter-…md`)

| Panel | Rutas | Qué ve |
| --- | --- | --- |
| Equip | `/equip/tauler · canalitzacio[/:id] · ofertes[/:id] · espigolades · aprovacions · missatgeria · albarans · productes · tancament · entitats[/nova · /importa · /:orgId] · convenis · documents · diagnostics · plans · configuracio` | Todo; badges de `pendents_equip()` |
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
- **Certificat de donació** (05-11): `DialegCertificatDonacio` (super_admin; ficha › Certificats y
  `/equip/ofertes/:id`): ámbito, fecha, anexo, «Excloses», revisión y envío manual; el ofertante, en
  «Els meus certificats» y en su oferta.
- **Circuito de firma (05-11)**: `DialegSignaDocument` («Signa aquí» / «Puja'l signat»; el equipo solo
  sube) y `AccionsSignatura`; **`accionsSignatura()` (`lib/signatures.ts`) decide el botón**.
  «Pendent de tu», Aprovacions › «Signatures per tancar» (super_admin), Documents › «Signatures»;
  «Envia per correu» con «Inclou l'enllaç per signar».
- **Configuració › Equip** (09-11, `SeccioEquip`): rol, editar, activar/desactivar y borrar con traspaso.
- **Importa des d'Excel** (`ImportaEntitats`, §6): Fitxer → Revisió («Canviarà» por fila, «dubtosa» con candidatos) →
  Resultat (CSV). **Convenio único de col·laboració** por papel. Filtros comunes (`lib/filtres.ts`). Diagnòstic
  operatiu v2, perfil de recepción y Pla de Prevenció como **expediente** (resto, `context/06ter`).
- **Gestión autónoma del super_admin**: convenio
  **declarado**, interés asistido con hora, `registrar_recollida_assistida`, mensajes de cada
  paso para copiar (`missatgesOferta.ts`, `MissatgesDelPunt`) con las notificaciones apagadas;
  **Ciclo guiado** `/equip/canalitzacio/:id`: 17 pasos en 6 fases (`passosCanalitzacio.ts`,
  `components/equip/fases/`) sobre las RPC reales (`tests/e2e/paritat-assistida.e2e.ts`).
- Otros: doble rol = todos los paneles, el activo por la URL (`useOrganitzacio(tipus)`); el
  ofertante no ve el `E-…`.
- **Ficha única «Entitat» (1C)**: `lib/campsFitxa.ts` es **la única definición de campos** (paridad con
  el SQL en `tests/campsFitxa.test.ts`); `EntitatDetall` en seis pestañas (`?pestanya=`), guarda solo lo
  que cambia; `PerfilOrganitzacio`, los mismos bloques por sus RPC.
- **Estado CRM (B1)**: «Estat i papers» (`BlocRols`): selector por papel (`fixar_estat_crm`) y badge
  (`lib/estatCrm.ts`); «Entitats» filtra por estado (con `?rol=`, el del papel) y abre con `actiu`.
- **Plan 1 sobre la ficha** (detalle en `context/06ter`): «Nova entitat» (1B, `cerca_entitats` → `crear_entitat`),
  «Dona-li accés» (1D, `fitxa/AccesEntitat`), «Gestió interna» (1F + 1.5, `fitxa/NotesInternes`) y, sin que la
  entidad entre, convenio por correo (`fitxa/ConveniFitxa`), RGPD, albarán por correo y correos con consentimiento.

## 6quater. Parte pública y accesos (detalle en `context/06quater-…md`)

`SessioProvider → RouterProvider`; `ArrelApp` desvía `PASSWORD_RECOVERY` a `/restablir`;
`RequireSessio` monta `AppContextProvider` solo con sesión; **el contexto falla cerrado**.
Rutas: `/` · `/login` (accesos de prueba tras `VITE_ACCESSOS_TEST`) · `/admin` (equipo) · `/registre`
· `/restablir` · `/privacitat` · `/confirmar/:token` · `/signar/:token` · `/signar-document/:token`
(firma de CD/CR/REC/ENT) · `/factura/:token` · `/consentiment/:token` · `/verificar/:codi` · `/panell`
(raíz por rol) · `/sense-acces`. `RoleGuard` redirige a `/panell`. Aprovacions: cinco colas
(registros, convenios por contrasignar, intereses, recogidas por validar, firmas por cerrar); aprobar
un alta manda el acceso por correo (`enviar-acceso`).

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
- **Ningún componente React se define dentro de otro** (el campo pierde el foco en cada tecla;
  `tests/componentsNiats.test.ts`).
- `sendWhatsApp()` y los clientes de `src/lib` nunca lanzan. El tipo de una fila vive junto a su
  `select`; **la lista de columnas de un `.select()` va en un solo literal**.
- Migraciones `AAAAMMDDHHMMSS_desc.sql`, nunca editar una aplicada; **su número es el del
  fichero** (`aplicar-migracion.ts` lo registra así; `apply_migration` del MCP no se usa).
  Compatibles hacia atrás con el frontend publicado. Última: `20270519100000`.
- **Una sola rama en git (`main`) y en Supabase** (branching desactivado: las Edge Functions
  **no se despliegan con el push**).
- El CLI dentro del sandbox necesita `HOME` escribible y `api.supabase.com` permitido; `db push`
  no pasa (conexión Postgres directa).

## 8. Reglas de negocio (detalle en `context/08-…md`)

- **Interruptores de notificaciones** (Configuració › Notificacions, solo super_admin):
  general `notificacions_actives`, `email_activo`, `whatsapp_activo`; canal efectivo = general
  **y** canal; apagar el general apaga los dos. 🔴 **Cortan lo AUTOMÁTICO** (triggers, jobs, avisos,
  el PDF al generarse; un solo punto por canal: `sendEmail()` y `enviar()`, 503
  `email_desactivat`/`notificacions_desactivades`/`whatsapp_desactivat`, nunca un simulado); **no**
  lo transaccional (`enviar-acceso`, `recuperar-password`: `{transaccional:true}`) **ni lo MANUAL**:
  una lista cerrada de botones del equipo sale si quien pulsa lo acepta (`acceptaEnviament`,
  `{manual:true}`, traza `<funció>:manual`; el modo test sigue): RGPD y convenio a firmar
  (`_shared/enviamentManual.ts`), «Reenvia», «Dona-li accés» y «Envia per correu» del albarán
  (`enviar-albara`), «Envia per correu» con «Inclou l'enllaç per signar» (`reenviar-documento
  {manual, amb_enllac_signatura}`); lo masivo, la oferta y el correo libre, no. La interfaz esconde el apartado de
  un canal apagado (Missatgeria; «Missatge» y «Correu» de Entitats) y deja gris lo demás
  (`BotoAmbMotiu`, `motiuCanal()`). **En producción, los tres apagados.**
- 🔴 **Las notas internas (`notes_internes`) nunca salen por ningún canal**: ni correo, WhatsApp,
  documento, aviso ni ficha del actor; ninguna Edge Function ni plantilla las lee.
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
- Proceso de canalización: intake → distribución → confirmación → cierre. Ranking: sin
  convenio, al final; `estat` solo excluye «No procedeix». Valor = kg × coste
  por kilo de la canalización (nunca `productos.eur_kg` para lo fiscal).

## 8bis. Canal preferente

El **correo es el canal por defecto**; WhatsApp solo cuando se puede (`_shared/canal.ts`, puro):
interruptor apagado → correo; móvil y ventana abierta → texto; móvil y opt-in → plantilla; si no,
correo; sin ninguno, `cap`. `canal_preferido` se respeta si es viable. Lo decide el servidor
(`priorizar-entidades` devuelve `canal`, `motiu_canal`); `enviar-acceso` acepta `canal:'auto'`.

## 8ter. Cuando Meta rechaza

`wa_messages.status='error'` (wamid `err-…`); `scripts/diagnostico-whatsapp.ts` distingue `190`
(token caducado), `100/33` (sin acceso al `phone_id`), `131030` (fuera de los ≤5 de test), `131047`.

## 9. Seguridad (detalle en `context/09-…md`)

- 🔴 **Cortina de contraseña** («pantalla de protección previa a la home»; `middleware.js` generado de
  `cortina/`; cookie 7 días). **Desde el 09-11-2026 el super_admin la enciende, apaga y cambia en
  Configuració › General** (`cortina_config`; contraseña en claro solo para él; RPC `cortina_config/activar`,
  Edge Function `cortina-config` calcula la huella; **nace APAGADA**). El middleware lee la Edge Function pública
  `cortina-estat` (caché 20 s, **fail-closed**: solo un `activa:false` explícito abre; `HASH_TOKEN` del repo =
  respaldo). Libres solo `logo-email.png`, sello, favicon y `sw.js`; con ella puesta, los enlaces de correo y
  `/verificar` piden la contraseña primero.
- Todo dato exige sesión de Supabase Auth; `anon` sin privilegios. Login `signInWithPassword`;
  recuperación por `recuperar-password` + `admin.generateLink` + Resend; `enable_signup=false` y el
  **mailer nativo apagado** (nunca `resetPasswordForEmail`, `inviteUserByEmail` ni magic links). Resend
  con `espigoladors.com`; `plantillaEmail()` (`_shared/resend.ts`) es el único maquetado.
- `enviar-acceso`: enlace por correo, **solo el código de 6 cifras por WhatsApp** (canjeado en
  `/login` con `verifyOtp`). `registro` público: crea cuenta + ficha + membresía **pendiente**,
  deduplica por correo/teléfono exactos (principales deniegan `409`, secundarias → revisión),
  anti-abuso proporcionado, no manda correo (aprobar sí). RGPD: privacidad obligatoria + dos
  consentimientos (`consentiments`, huella del texto del servidor).
- `donar-acces` (1D, JWT + `pot_aprovar`; sustituye a `alta-assistida`): cuenta si no la hay →
  `concedir_acces_org` → enlace `recovery` por correo; si falla, `revertir_acces_org`. Correo apagado
  409 salvo `manual` (§8); modo test, solo `es_test`. Sin consentimientos (deuda 152).
- **Firma electrónica simple en todos los documentos**: el servidor compone y hashea lo firmado
  (convenio: el texto; CD/CR/REC/ENT: `sha256_datos`; `409 document_canviat`), nombre, cargo y DNI
  (`MIN_NOM`/`MIN_DNI` de `lib/signatures.ts`), trazo PNG ≤1 MB en `evidencies/`, IP y UA en
  `evidencias`; tres vías —correo, asistida, panel— y el PDF las distingue. `pujar-document-signat`:
  formato por **bytes** (`_shared/pujada.ts`, también en `subir-documento-externo`), permiso antes de
  leer el fichero, se guarda tal cual. Confirmación de albarán: `sha256_texto` del acta; D3 en la API.
- Cuentas de prueba: 5 organizaciones `TEST-*`, 7 cuentas + 5 de WhatsApp, `hola+pendent-arnes@`
  (**pendiente, no aprobar**) y `hola+senserol-arnes@`; credenciales en `scripts/data/cuentas-prueba.json`
  (las del bundle de `/login`, solo con `VITE_ACCESSOS_TEST`; detalle en `context/09`).
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

`pdApp-wp` → `P0MA` → `Redestina` (10-09-2026); no reusar los nombres viejos. Un cambio de dominio
exige 308. CORS se verifica en la cabecera `Access-Control-Allow-Origin` del preflight, no en el estado.

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
  contra las funciones locales; `roles_activos` y `test_mode` encendidos (detalle y fallos conocidos en el
  fichero de §11).
- **Producción, con token temporal**: `bash scripts/sesion-supabase-temporal.sh` en la terminal del
  usuario (PAT `Redestina - Admin - Producción`); dentro, `aplicar-migracion.ts <f> [--dry-run]`,
  `functions deploy <f> [--no-verify-jwt según config.toml]`, `secrets set`, Management API. El
  asistente **no pide ni lee el token**; una sola pestaña, scripts por fase en `scripts/data/` con log.
- **Publicar**: skill `/publicar`, orden **base → Edge Functions → frontend** (`git push` el último).
  Tras redesplegar `generar-documento`, `emitir_documento_prova()`. Tocar `_shared/` obliga a
  redesplegar todas las que lo importan. Logs remotos por el Management API de analítica.
- Fixtures (orden, en el detalle) y emergencias: `scripts/roles-activos.ts off`; apagar `whatsapp_activo`.

## 12. Checkpoints y deuda técnica (cuerpo completo en `context/12-…md`)

**Checkpoints de negocio (no código)**: 2 plantillas de Meta y número de producción (flags
`PLANTILLES_CA_APROVADES`, `PLANTILLA_OFERTA_APROVADA`); 3 opt-in real; 4 formato legal del albarán;
5 reexportar `prod_actius.csv`; 6 Meta a producción; 7 apagar `VITE_ACCESSOS_TEST`; 8-9 validación de
altas y checklist de ficha; 10 **datos reales de la Fundación** en `parametros_documentales`
(Configuració › Fundació); 11 textos legales; 12 casar `municipio_ine` de las ubicaciones.

**Deuda abierta (78 vivas; la siguiente entrada nueva es la 174; los números no se renumeran ni
se reutilizan)**. Casi todas, **decisiones con precio, espera de material o interruptores** (§12bis). Defectos o trabajo real pendiente: **5** (filtros en
cliente, aceptado) · **126**
(`documentos_objeto_existe` no conoce `cierre_periodo`) · **127** (el correo del resumen sigue
ofreciendo la factura) · **128** (canalización conciliada sin coste no se puede valorar después)
· **135** (D3 residual en snapshots y `v_albaranes_bandeja`) · **136** (sin code
splitting) · **138** (CR sin rectificar ni «enviat») · **140** (`borrar_ficha_completa` no conoce
los expedientes) · **143**
(entrantes con WhatsApp apagado no los ve nadie) · **146** (`organizacion_contactos` sin uso) · **149**
(dos vistas sin uso desde 1C) · **151** (rama muerta `alta_assistida` en `registro/alta.ts`)
· **152** (privacidad en el primer acceso de «Dona-li accés»; P3)
· **153** (el ARA 2026 no crea `productor_ubicaciones`) · **154** (código muerto del CT) · **155**
(una rectificación reimprime la fecha de expedición) · **156** (selector de ámbito del certificado) ·
**157-164** (flecos de la firma) · **165-167** (flecos del importador) · **169** (alta de cuentas del equipo) · **170** (artículo) · **171** (importador sin datos fiscales) · **172** (`entidades.estat` sin uso; `drop` pendiente) · **173** (exportar >1.000 filas).
Decisiones de negocio pendientes: **131** (D3 en la capa REST de `excedentes`), **132** (el
`tecnic` escribe directo en `canalizaciones`/`excedentes`), **133·134** (frenos de
`recuperar-password` y `registro`), **137** (privilegios por defecto de funciones), **69**
(backfill de `data_hora_recollida`), **141** (sin freno de 48 h, decidido), **148** (la entidad
inactiva sigue viendo lo ya enviado). El resto (entradas 4–116), en §12bis.

**§12bis** y **§12ter** (90 cerradas, indexadas) viven en `context/`.

## 13. Al terminar cualquier cambio

1. **`npm run check`** en verde (tipos, `lint`, `vitest run`, `deno check`, `deno test` del PDF).
   **Referencia: 1.860 pruebas de Vitest en 81 ficheros (1 saltada a propósito) + 39 de Deno.**
2. `npm run build` si toca `src/`.
3. `deno run -A scripts/comprobar-rls.ts` si toca datos, políticas o roles.
   **Referencia: clon 2.385/2.385 y 38 sin datos; producción 2.364/2.364 y 32 «Sin fallos de
   permisos».** Una cifra que cambia sin checks nuevos es cambio de **datos**; `pendent-arnes`
   aprobada por error da cuatro FALLA. `prueba-numeracion.ts` si toca la numeración.
4. E2E de lo tocado contra el clon (`tests/e2e/*.e2e.ts`; helpers en `ajuda.ts`).
5. Publicar con `/publicar` (base → funciones → frontend).
6. Estilos solo con tokens; un token nuevo va a `tokens.json`, `index.css` y `preview.html`.
7. **Actualizar este fichero (≤ 48 KB) y el `context/<sección>.md` que toque**; §1bis si cambia
   el alcance; la deuda: lo resuelto se tacha, lo nuevo con el número siguiente.
8. Commit en castellano, con el qué y el porqué. Pre-commit: tipos + vitest + deno check.
