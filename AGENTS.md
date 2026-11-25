# AGENTS.md

Documento canónico de contexto para agentes de IA (Claude Code, Codex, Cursor…) que
trabajan en este repositorio. `CLAUDE.md` lo importa; **no dupliques contenido allí.**

> **Regla permanente:** toda modificación que cambie la arquitectura, el esquema de datos,
> los contratos de las Edge Functions, las convenciones o los comandos **debe actualizar
> este fichero en el mismo cambio.** Si el código y este documento discrepan, el documento
> está roto.

> 🔴 **Regla de tamaño (02-11-2026): este fichero se carga ENTERO en cada sesión y no puede pasar
> de 48 KB**. Aquí vive **solo lo
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
  (el resto, `131030`). Mensajería siempre individual.
- **Documentación fuera del repo**: `docs/` (ignorado; funcionales y credenciales) y la carpeta de
  Drive `…/03-Redestina/` (se escribe solo en `3. Claude Code/`, nunca datos personales; detalle en
  `CLAUDE.md`; jerarquía de documentos en `context/01`).
- **Planes vivos** (`3. Claude Code/`): **plan DIC 26** (`2026-11-25-plan-trabajo-dic-26.md`, fases 0-6); plan 1 CRM (1E solo en el clon).
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
persiste), plantillas en código, diagnóstico (**uno por productor, lo conduce el equipo**, A1) y Pla de
Prevenció (expediente provisional; el plan básico, retirado), espigueo, catálogos, back office, parte pública, indicadores (`kpis_equip`,
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
- **Contrato de alturas** (`context/02`): solo el shell es `h-dvh`; `main` scrollea; `fullBleed` (Mensajería).
- 🔴 **Un solo ancho**: el del shell, `w-[96%]` + `max(0.5rem, safe-area)`; ningún `max-w` de página. **Diálogos al 80 %** (`ui/dialog`; confirmar, `max-w-lg`).
- **Barra inferior de móvil: cuatro entradas como máximo** (`barra: false`, `labelBarraKey`).
- **PWA sin service worker** (`selfDestroying`); `/version.json` + `useVersioNova` avisan de versión.
- **Siete reglas de móvil** (en el detalle): controles ≥16 px, `Button` `whitespace-nowrap
  shrink-0`, `safe-area-inset`; **auditar `scrollWidth > clientWidth` en los hijos**.
- **Tablas**: sin scroll horizontal (secundarias `hidden md:table-cell`), acciones en `BotoIcona`
  (tooltip y `aria-label`); `colSpan` completo con `usePuntTall`. **Clicar la fila o el título abre
  el detalle** (`FilaClicable`/`TitolFila`, `to` u `onObre`; el icono se queda; los controles y los
  portales no la disparan); sin detalle o de selección, no (lista en el detalle).

## 2bis. Sistema de diseño

`design/tokens.json` (fuente única), `design/DESIGN.md` (uso), `design/preview.html` (muestra).
Reglas: **ningún hex ni clase de la paleta genérica de Tailwind**; solo las clases de
`src/index.css` (shadcn + extensión REDESTINA: `coral*`, `verde-claro/oscuro`, `exito`, `aviso`,
`error` y sus `-fondo`, `chart-1…5`, `font-titulos`, `text-nav` solo para la barra inferior).
`accent` no es el coral; el error es rojo; títulos en Sora; nombres de shadcn no se renombran;
`index.css` se deriva a mano de `tokens.json` (y los colores del correo viven en
`_shared/resend.ts`). Logo: seis variantes en `public/` (`context/02bis`). Ningún control de
formulario estilado a mano (`components/Casella`, `ui/input`, `components/Desplegable`, nunca
`<select>`; E2E con `tria()`); controles de 32 px en escritorio. Badge sobre fondo de
color = chip blanco, texto en color. `{n}` reservado a contadores (singular `<clau>_1`). Sin
modo oscuro (detalle de la portada en `context/02bis`).

## 3. Estructura (resumen; árbol completo en `context/03-estructura.md`)

```text
CLAUDE.md · AGENTS.md · context/        Contexto para agentes (este fichero + detalle por sección)
middleware.js · cortina/                La cortina de contraseña de Vercel (generado; §9)
design/                                 Sistema de diseño (§2bis)
tests/  (unit Vitest · pdf/ Deno · e2e/ Playwright)   .githooks/pre-commit · .github/workflows/
.claude/agents/ (dades, servidor, interficie) · .claude/skills/publicar/
src/
  App.tsx · router/index.tsx · layout/ (AppShell, AppSidebar, BottomNav, UserMenu)
  hooks/ (useSessio, useAppContext, useConveni, useMissatgesOferta, useOperativaPendent…)
  routes/ public/ · equip/ · productor/ · receptor/ · PerfilOrganitzacio · PerfilRecepcio · PlaOrganitzacio
  components/ (ui/ shadcn · documents/ · proces/ · equip/ (fases/, diálogos asistidos) · expedient/ · diagnostic/ …)
  lib/ (módulos PUROS con test: importEntitats, normalitzaImport, procesOferta, passosCanalitzacio, seguentPas, validacio, format,
        cerca, filtres, missatgesOferta, destiFinal, registreRecollida, diagnostic, i18n…)
  types.ts · index.css
scripts/  comprobar-rls.ts (arnés) · aplicar-migracion.ts · local/ (clon) · import-ara-2026.ts + ara2026/ · crear-*.ts ·
          escenari-demo.ts · historial-migraciones.ts · huellas-funciones.ts · data/ (ignorado)
supabase/ config.toml · migrations/ · functions/ (_shared/ con pdf/, hojas de texto, gate, canal,
          autorizacion, resend, pujada, operativaLlegible, preusFonts; 27 funciones: whatsapp-*, crear-oferta, registro, donar-acces, firma-equip,
          enviar-*, *-documento, diagnostic-pdf, enlace-publico, priorizar-entidades, recordatorios-*… ; lista en `context/03`)
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
`actualizar_meu_canal()`). Vista `v_organizaciones` (`security_invoker`). **Naturalesa (A5)**:
`organizaciones.naturalesa` (entitat_social·empresa) + `naturalesa_origen` (suggerida·confirmada); la sugiere un trigger
por el NIF (`naturalesa_suggerida()`, `context/04`) y **solo la confirmada surte efecto** (P8, §8; `naturalesaEfectiva()`). Regla en tabla `modalitat_naturalesa_compat`. `productor_ubicaciones`
(lugares; A4: `dies_setmana`, `franges` ≤4 y **un solo `es_principal`**, índice + trigger). **Operativa (A4, T4)**: producción y comercialización; `productores_operativa` **poda** lo que no cuelga. Fiscal: `regim_iva`, `*_fiscal` (si hay domicilio fiscal,
convenio y certificados lo usan: `dada_fiscal()`), `contacte_facturacio_*`; `data_alta` («Data d'alta a
l'organització», editable, trigger si falta) y `created_at` («Alta a la plataforma», solo lectura), equipo.

**Estado de las fichas** (1A; **B1**): `estat_crm` (potencial · en_desenvolupament ·
actiu · inactiu) **MANDA** y `activo = (estat_crm = 'actiu')` lo deriva `trg_fitxa_estat` (`update of
activo, estat_crm`; el `activo` legado se traduce) y `*_estat_alta`. Organización activa si lo está algún
papel (D7). Activar exige NIF válido y razón social (`falta_nif`·`nif_invalid`·`falta_rao_social`); todo
cambio va a `fitxa_estat_hist` (solo equipo). Nace: `crear_entitat` actiu, importador potencial, registro
en_desenvolupament (`aprovar_registre` intenta actiu). Una entidad inactiva no entra en el Mercat (`modalitats_compatibles_meves()`), ni en
`priorizar-entidades`, ni en los selectores, y `comprova_interes()` la rechaza (`entitat_inactiva`).
**Un contacto por ficha (D3)**: `organizacion_contactos` se conserva sin uso (deuda 146). **1C**: vista
`v_entitats_llistat` (`security_invoker`) para «Entitats». **1F + 1.5 + 1.2**: `notes_internes` (CRM = las
interacciones; tipo `prospeccio`, `resultat`, previsión `previsio_*` todo o nada) solo por RPC; lectura `es_intern()`
(externo: 0 filas); la vista suma el último contacto y los seguimientos.

**Ofertas**: `excedentes` (`id_excedente` `E-AAMMDD-XXX-YYY-N`; `estado` **esborrany** (sin `E-…` ni texto
hasta publicar; `dades_esborrany`; solo → publicada; borrar: `esborrar_esborrany_oferta`) · borrador (espigolada) · publicada ·
pendent_validacio · parcial · bloqueada · cerrada · no_colocada · cancelada; `modalitat` +
`modalitats[]`; `preu_minim`, `coste_kg`, `fotos[]`, `producte_al_camp`, `format_entrega`,
`transport_propi`, `municipi_ine`/`comarca` por trigger, franja `hora_recollida_*`,
`disponible_hasta`; `dies_recollida[]`, `gmaps_url` propio (envases: deuda 188); `hectarees`; `espigolada_demanada` (pide jornada: va a validación); `subcausa_codigo` → la causa, por trigger); `oferta_respuestas` (`estado` de la entidad × `aprovacio` del equipo, `proposada` = cambios del equipo que espera a la entidad, `proposta_*`;
`canal` whatsapp·email·panel·asistido·manual; `kg_solicitados/kg_aprovats`, `modalitat`,
`recollida_at`); `canalizaciones` (kg confirmados/reales/conciliados, `valorizacion`, `coste_kg` = **precio del mes
del albarán** (D2: `preu_*`, rastro `canalizaciones_preu_hist`; `context/04`), `data_hora_recollida`, `recollida_origen` (entitat_receptora·equip), columnas de la recogida protegidas por trigger);
`excedente_destins` + catálogo `destins_finals`; `excedentes_canvis`; `avisos` (lo que se le
cuenta a una organización; los crean triggers); `intake_sessions`; `espigoladas`.

**Catálogos**: `productos` (iconos en `public/icones-productes/`), `causas` (C1–C7; las 8 de antes, inactivas) + `subcausas` (`C<n>.<m>`),
`factores_conversion`, `costes_producto` (coste de **referencia**, uno por producto, +hist; un manual **no es oficial**: `criteri`+`font_origen`),
**precios de referencia por mes** (D1; `context/04`): `preus_referencia` (producto × año × mes
validado, +hist), `preus_carregues`/`preus_observats` (original en el bucket `preus-fonts`), `productes_fonts`,
`preus_fonts_estat`; `productos.preu_manual`/`nombre_es`. `preu_referencia_de()` (interna) valora las canalizaciones (D2).
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
sin borrado salvo `reiniciar_documentos_prova()` y `reiniciar_dades_operatives()`, §6), `documento_envios` (solo correo),
`plantillas_documento` (texto versionado en la base, congelado al emitir), `enlaces_token`
(firmar y confirmar sin cuenta: solo el hash; canales email·asistido·panel·whatsapp),
`evidencias`, `parametros_documentales` (fila única, **sembrada provisional**;
`datos_provisionales` bloquea el modo real), buckets `documentos`/`activos` sin políticas
(descarga por Edge Function) y `fotos-ofertes` con políticas propias (ruta y jobs, en `context/04`). **Cinco columnas fuera del GRANT
de SELECT**: `enlaces_token.token_hash/codigo_hash`, `evidencias.documento_identidad`,
`parametros_documentales.apoderada_dni`, `documentos.envio` → `select('*')` da `42501`; toda
columna nueva de `documentos` nace sin SELECT. **Firma** (`context/04`): la contraparte firma CD·CR·REC·ENT
(trazo o PDF subido) y CONV (subido); firma = **versión n+1 `subtipo='signat'`, mismo `sha256_datos`**, en
`firmes_document`; un externo nunca firma en prueba; nada se bloquea por la firma. **Lo emitido no se reescribe**; solo en
modo test el super_admin lo regenera con los datos de la Fundació de ahora (`regenerar_documents_fundacio`:
versión n+1, salta los firmados; Configuració › Fundació).

**Albaranes** (`albaranes`, `albaran_lineas`: REC · ENT · OPE solo heredado; solo `kg_validados` cuenta; sin importe;
borrador→emitido→entregado→confirmado→conciliado, anulado, `R-`). 🔴 **Un REC por recogida** (fase 3, `context/04`):
la donación nace con ENT y **su REC** (`canalizacion_id`) y `validar_recollida` los emite y concilia en un acto; el REC
heredado (uno por oferta) sigue su modelo sin mezclar. **Venta y maquila sin albarán**: validar las deja `conciliada`.
🔴 **Validar fija la fecha REAL** en `data_hora_recollida` (trigger, `20270613100000`): albarán, cierre y certificado, el mismo día.
PDF `albara1p`. `documentos_externos` (también de una canalización). **Convenios** (`convenios`: tipos `col_productor`/
`col_receptor` (los antiguos valen por equivalencia); `origen` plataforma · paper · **declarat**; uno vigente por tipo; número al
firmar; `convenio_vigente()`/`exigir_convenio()`; **fecha de corte encendida** desde el
16-09-2026: sin convenio no se publica ni se muestra interés). **Certificado de donación** (modelo Tabaquet; `context/04`):
🔴 **certificable = donación conciliada a entidad `social`** (`motiu_exclusio_certificat()`, único
criterio); reparto 1:1 por REC (heredado, en proporción) y se descarta lo no certificable. Ámbitos **ejercicio**
(`cierres_ejercicio`, `cierres_donante`, `datos_182()`), **intervalo** y **oferta** (`cierres_periodo`,
serie `CDP`); el anual sustituye a los parciales. **CT retirado**. **Certificado de recepción**
(`cierres_receptor`, serie `CR`, sin importes).
**Diagnóstico y plan** (A1, A3; `context/04`): **`diagnostics`, uno por productor que se sobrescribe** (D1: cabecera,
notas, `complet`/`falten`, `actualitzat_*`) y **excedentes en tablas propias** (A3, D7): `diagnostic_productes` →
`diagnostic_excedents` (principal × `causas.codigo`: frecuencia, kg —P7—, gestión actual, destinos = modalidades,
`detall`) → `diagnostic_accions` (una por destino, estado y nota que ve la organización). Solo lectura por RLS; escribe
el equipo por RPC (D5). Un principal que deja de serlo **conserva** su bloque, que no cuenta para `complet` (en vivo:
`diagnostic_falten_productor`). **Cuestionario y plan básico, fuera de la base** (174/175;
D4): quedan los emitidos; el plan es el **expediente** (`expedients_prevencion` + `diagnostic_id`). Impacto:
`impacte_*` sobre kilos conciliados.

**Borrado de una ficha: una sola puerta, `borrar_ficha_completa()`** (`es_super_admin()`; detalle en `context/04`):
`22023 bloqueig_esborrat: <codis>` si hay ofertas, documentos, albaranes, cierres o expedientes con número; si no,
arrastra lo operativo y retira la organización vacía (ficheros a `fitxers_orfes`). Nunca un `.delete()` suelto (§7);
con bloqueo, la ficha propone **desactivar**.

🔴 **Una cuenta del equipo no tiene organizaciones** ni ofertas; **su autoría no es fiscal**. Desactivarla o borrarla **traspasa sus acciones** a otra activa (rastro por fila); borrar a quien ha hecho algo **exige destino** (`cal_desti`).

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
  `mercat_vist_at`; **SELECT por columnas**: `firma_ruta` fuera), `usuario_roles` (**`super_admin` «Superadmin» >
  `admin` «Dinamitzador»**; `tecnic` retirado el 25-11, `20270615100000`; externos sin fila),
  `membresias` (cuenta ↔ ficha; `rol_org` titular/operador; eje `aprovacio` pendent · aprovada ·
  rebutjada × `activo`; **el rol no viaja en el JWT**: se consulta en cada política).
- 🔴 **Matriz 0.1 (DIC 26)**: configuración, equipo, whitelists, plantillas, invitar, importar y borrar → Superadmin; lo
  operativo → los dos (`pot_aprovar()` ≡ `es_intern()`). **Firma institucional = Superadmin**: `contrafirmar_convenio`
  siempre; CD/CR reales y sus rectificaciones; cerrar firmas de CONV/CD/CR. Las de albarán, los dos. **Firma propia**:
  `firma-equip` → `fixar_firma_equip()` (servidor); el albarán congela `albaranes.signant_equip` al emitir (`context/04bis`).
- **`roles_activos` ENCENDIDO en producción** (fail-open; un entorno recreado nace apagado:
  `scripts/roles-activos.ts`). `hola@carlessanz.com` es `super_admin`; las otras dos, `admin`.
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
- **Superficie de escritura de los paneles = RPC**, no políticas (familias y nombres exactos: `context/04bis`,
  «Familias de RPC»; `registrar_recollida` del receptor **solo declara**, `validar_recollida` del admin emite y concilia).
  **Asignación** (`context/04bis`): `assignar_directe` (nivel 1; venta: precio y aceptación),
  `modificar_assignacio`, `anular_assignacio` (motivo; aviso `assignacio_anulada`), `fixar_preu_acordat`. Estado de la
  oferta solo por `recalcula_estat_excedent()`; **las anuladas no cuentan**. **Propuesta** (fase 5): `proposar_canvis`
  (`pot_aprovar`) y `respondre_proposta` (la entidad o el equipo; aceptar aprueba, en venta vuelve a `pendent` por el precio).
- **Diagnóstico**: escribe solo `es_intern()` (`42501` también sobre lo suyo, D5): `desar_excedents_diagnostic`
  (reemplaza el conjunto, conserva acciones) y `fixar_estat_accio` (A3).
  Lectura: `diagnostic_estat`, `diagnostic_datos` (la usa `diagnostic-pdf`). `fixar_lloc_principal` (A4).
- **Entrades i sortides (6.7)**: `entrades_sortides(<9 filtros>, p_limit, p_offset)` y `…_resum(…, p_per)`, del equipo,
  solo lectura; la fila, solo en la interna `sortides_base()`; el estado, `estat_recollida_canalitzacio()` (con `operacio_detall`).
- **Interacciones (1.2)**: `afegir_nota_interna(…, previsión)`, `tancar_seguiment(p_id, p_resultat)`; lectura del equipo
  `interaccions_llistat(p_vista, <12 filtros>, p_limit, p_offset)` → `{total, files}` e `interaccions_opcions()`.
- **Precios (D1)**: `preus_proposta_mes`, `noms_fonts_preus` (equipo); validar mes/periodo, `fixar_preu_referencia`
  (motivo si difiere), equivalencias, `fixar_preu_manual`, `fixar_origen_cost_producte`, `crear_producte`, `marcar_carrega_preus` (`pot_aprovar`);
  `fixar_font_preus` (super_admin). Propuesta: Gencat (el mes o su último) → Mercabarna (último día, mes cerrado) → manual; `font_mes`: su mes; alta, solo Mercabarna: precio del día. **D2**: `preus_canalitzacions_mes`
  (equipo); nadie escribe `preu_*` ni el coste de una conciliada o certificada (`42501`, `canalizaciones_protegeix_preu`).
- **Naturalesa (A5)**: `fixar_naturalesa(p_org, p_naturalesa)` la deja **confirmada**; el equipo siempre, el titular solo
  mientras no lo esté (`42501 naturalesa_confirmada`). Nadie escribe `organizaciones` directo.
- Triggers de respaldo: `respuestas_control_aprovacio`, `membresias_control_aprovacio`,
  `canalizaciones_protegeix_recollida`, `documentos_inmutable`, `convenios_control`,
  `documentos_firma_substituida` (rechaza sola la firma que esperaba sobre una versión sustituida).
- **Edge Functions**: `service_role` ignora RLS, así que `_shared/autorizacion.ts`
  (`contextoUsuario`, `exigirEquipo`: `401`/`403`) se aplica en las que lo necesitan;
  `rolesActivos()` **falla cerrado** ante un error de lectura.
- **Verificación**: `scripts/comprobar-rls.ts` abre sesión real con cada cuenta de `scripts/data/cuentas-prueba.json`
  y comprueba la matriz (cuenta, tabla, operación); un `permitir` con uuid inventado solo acepta **errores de
  negocio** (`22023`, `PT4xx`, `235xx`; la clase `42` es FALLA). **Cualquier FALLA es una regresión.** Detalle en
  `context/04bis`. Emergencia: nivel 0 `roles_activos=false`; nivel 1 `scripts/sql/rls-emergencia.sql`.

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
  `--dry-run` salvo `--produccio` (el clon lleva las 721: `context/06`).
- **Importador del panel** (`/equip/entitats/importa`, super_admin; §6.2, §6.4): `lib/importEntitats.ts` →
  `previsualitzar_importacio_entitats` → `importar_entitats`; nueva = **`potencial`**. 🔴 **D11: idempotente y
  ACTUALIZA** (ID Redestina → NIF → `AIRTABLE:` → hash `IMP:`; con ID o NIF nunca crea; celda vacía no toca). Nunca
  toca `activo`, `estat_crm`, `es_test`, `ref_externa`. «Naturalesa» importada = confirmada.
- **Exportación** (B3; §6.3): `exportar_entitats` → `lib/exportEntitats.ts`, formato de la
  plantilla; **exportar → reimportar = `sense_canvis`**.

🔴 **Vaciado (fase 6, `context/06`)**: `reiniciar_dades_operatives(p_executar)` (solo `service_role`; con algo real se
niega: `22023 hi_ha_dades_reals`) vía `scripts/reiniciar-dades.ts` (dry-run por defecto) borra la operativa y **todas** las fichas, conserva
catálogos, configuración y cuentas, y reinicia las series; `scripts/sembrar-entitats-ficticies.ts` siembra las fichas
`es_test` (`context/09`).

## 6bis. Intake conversacional (detalle en `context/06bis-…md`)

21 pasos (`_shared/camposOferta.ts`, servidos por `GET crear-oferta/campos`; ca/es en el descriptor; la lista
con sus `soloPanel`/`oculto`, en `context/06bis`). `aplica()` en cascada; guía Sí/Ara no; listas de 9 + «Més…»;
3 fallos → repite; `Stop` cancela; texto ≤400; ubicación por Maps o `location` (P5); convenio al final.
La oferta del panel se **precarga** de la Operativa (`predeterminats`).

## 6ter. Paneles y procesos (detalle, por fecha y fase, en `context/06ter-…md`)

| Panel | Rutas | Qué ve |
| --- | --- | --- |
| Equip | `/equip/tauler · canalitzacio[/:id] · ofertes[/:id] · espigolades · aprovacions · missatgeria · albarans · entrades-sortides · productes · tancament · entitats[/nova · /importa · /:orgId] · interaccions · convenis · documents · diagnostics · plans · configuracio` | Todo; badges de `pendents_equip()` |
| Productor | `/productor/inici · ofertes · ofertes/nova · ofertes/:id · documents` | Sus ofertas, embudo, alta (descriptor del intake) |
| Receptor | `/receptor/mercat · interessos · historic · impacte · documents` | Ofertas compatibles (RLS con `modalitat_receptor_compat`), interés, histórico |
| Organització | `/organitzacio · perfil-recepcio · diagnostic · pla` | Ficha propia por secciones (el equipo no la ve) |

Lo que manda hoy, en una línea cada uno:
- **El modelo del proceso** (`lib/procesOferta.ts`, `seguentPas.ts`, `components/proces/`):
  etapas publicada → assignada → recollida → confirmada → tancada; «lo que te toca» en `aviso`,
  lo demás neutro; **estados simples** para los paneles externos (`BadgeEstat`).
- **Validación**: la oferta de productor nace `pendent_validacio` (`validacio_ofertes`); el equipo valida o rechaza.
- **Avisos** (`avisos` + `enviar-avis`, campana y badges); D1 tras aprobar (las partes se ven);
  editar oferta = formulario del alta (`DialegEdicioOferta`: todo salvo producto y entidad) → `crear-oferta/editar`,
  D4; esborranys `crear-oferta/esborrany`·`/publicar`; `FitxaOferta` (ficha, texto, «Comparteix»).
- **Recogida** (fase 3, `context/06ter`): el receptor declara o el equipo registra; validar emite y concilia el ENT y
  el REC de esa recogida (venta/maquila: sin albarán); el job solo avisa.
- **Destino final** (`DestiFinal`): `cerrada` = todo con destino; `no_colocada` = falta; `cancelada` = error con motivo.
- **Proposa canvis** (`?resposta=<id>`); contadores en vivo (`useComptadorsEnViu`); ficha de la operación
  (`operacio_detall`); **enlaces directos**: la URL abre el diálogo (`useDialegPerUrl`; `context/06ter`).
- **Firma**: `DialegSignaDocument` (**`accionsSignatura()` decide el botón**); `DialegCertificatDonacio`; `SeccioEquip`.
- **Importa des d'Excel** (`ImportaEntitats`, §6). **Convenio único de col·laboració** por papel. Filtros comunes
  (`lib/filtres.ts`, `lib/territori.ts`). **Diagnòstic**: lo contesta el equipo; la ficha y «El meu diagnòstic» lo leen (PDF);
  Pla = **expediente**.
- **Alta de oferta por bloques** (`FormulariNovaOferta`): opción **Espigolada** (el equipo: jornada `oberta` al acto); el lugar trae municipio, Maps, días y franja;
  disponible = hoy + 2; **causa por su subcausa** (`lib/causes.ts`).
- **Productes** (D1-D2, `context/06ter`): Catàleg (precio vigente: último mes validado, si no el manual) · Preus de referència · Càrregues.
- **Entrades i sortides** (6.7, `context/06ter`): una fila por salida (canalización), filtros, «Resum» agrupado
  (`?per=`) y Excel (`lib/sortides.ts`); la fila abre `FitxaOperacio` (`?canalitzacio=`).
- **Ofertes del equipo** (`context/06ter`): columnas Data (ordena) · Ofertant · Producte (+kg oferts) · Progrés · Estat,
  **sin receptores** (al detalle); Missatges: solo oferta y RECOLLIDA CONFIRMADA; pestañas Per validar · Actives · Esborranys ·
  **Històric** (servidor; `?tab=`); paso del proceso bajo el badge (`lib/llistatOfertes.ts`). Canalització, sin cerradas.
  **Selectores predictivos** (`SelectorEntitat`) y buscador en Aprovacions, Tancament y Plans; «Transformació en obrador» = `maquila`.
- **Equipo autónomo**: **asignación en un acto**, Modifica/Anul·la, recogida asistida, `MissatgesDelPunt`; convenio
  **declarado** (Superadmin); **Ciclo guiado** `/equip/canalitzacio/:id`. **Roles (0.1)**: aviso `AvisSignaturaInstitucional`
  donde el Dinamitzador no firma; «La meva signatura» en el menú de la cuenta (`DialegMevaSignatura`, `lib/firmaEquip.ts`).
- Doble rol: el panel activo, por la URL (`useOrganitzacio`); el ofertante no ve el `E-…`.
- **Ficha «Entitat» (1C)**: `lib/campsFitxa.ts` define los campos (paridad SQL); `EntitatDetall`, seis pestañas (`?pestanya=`), bloques
  `fitxa/Seccio`, aviso de cambios sin guardar (`useCanvisPendents`; también «La meva organització»).
- **Interaccions i seguiment** (1.2): `/equip/interaccions` lee las MISMAS filas de `notes_internes`
  (`?vista=pendents|historial|previsions`); `FormulariInteraccio` único (ficha y sección); «Fet» pide el resultado; la previsión **no crea oferta**.
- **Estado CRM (B1)**: «Estat i papers» (`BlocRols`, `lib/estatCrm.ts`); «Entitats» filtra (`?rol=`).
- **Naturalesa (A5)**: `SelectorNaturalesa` (equipo; el titular, una vez); P8 en el interés asistido.

## 6quater. Parte pública y accesos (detalle en `context/06quater-…md`)

`SessioProvider → RouterProvider`; `ArrelApp` desvía `PASSWORD_RECOVERY` a `/restablir`;
`RequireSessio` monta `AppContextProvider` solo con sesión; **el contexto falla cerrado**.
Rutas: `/` · `/login` (accesos de prueba tras `VITE_ACCESSOS_TEST`) · `/admin` (equipo) · `/registre`
· `/restablir` · `/privacitat` · `/confirmar/:token` · `/signar/:token` · `/signar-document/:token`
(firma de CD/CR/REC/ENT) · `/factura/:token` · `/consentiment/:token` · `/verificar/:codi` · `/panell`
(raíz por rol) · `/sense-acces`. `RoleGuard` avisa y lleva a `/panell`; la ruta pedida sobrevive al login (`lib/destiLogin.ts`). Aprovacions: seis colas
(registros, convenios, intereses, recogidas por validar y por registrar, firmas); aprobar
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
  Compatibles hacia atrás con el frontend publicado. Última: `20270616100100`. Tabla operativa nueva → `v_ordre` del vaciado (§6).
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
  `{manual:true}`, traza `<funció>:manual`; el modo test sigue; la tabla de botones, en `context/08`); lo masivo, la oferta y el correo libre, no. La interfaz
  esconde o deja gris lo de un canal apagado (`motiuCanal()`). **En producción, los tres apagados.** Automático también:
  el ENT/REC conciliado de una recogida **declarada por la entidad** sale por correo con su PDF (`_shared/envia-albara.ts`).
- 🔴 **Las notas internas (`notes_internes`) nunca salen por ningún canal**: ni correo, WhatsApp,
  documento, aviso ni ficha del actor; ninguna Edge Function ni plantilla las lee.
- `WHATSAPP_ENVIO_REAL` (secreto; `"true"` exacto o simula) y `RESEND_ENVIO_REAL` (ídem).
- **Reglas de envío** de `whatsapp-send` (orden de los códigos en `context/08`): equipo, interruptor, `es_test`,
  whitelist, ventana 24 h (texto) u opt-in (plantilla); BAIXA corta todo (403 `opt_out`).
- **Modo test** (`app_settings.test_mode`, fail-safe activado): con él solo reciben las fichas
  `es_test`; aplicado en los quince puntos de envío **y en las dos puertas de salida** (`enviar()`,
  `sendEmail()`); `esCuentaPermitida` para acceso y recuperación (pasa el equipo). Documentos
  `modo='prueba'` → `destinatariosPrueba()` aunque el modo test esté apagado. Whitelists:
  con filas, solo a quien esté; vacías, no restringen.
- 🔴 **P8 (confirmada por la Fundació, 10-11-2026)**: una **empresa** con la naturalesa confirmada solo recibe **compra
  y maquila**, nunca donación (Mercat, `comprova_interes()` y ranking de `priorizar-entidades`); una entidad social, las
  tres; sugerida o sin ella, **como antes**. `animal` admite donación y compra (178).
- **Diagnóstico = vocabulario de la oferta** (A3): causa = `causas.codigo`, destino = modalidad; cruza por
  `(productor, producto, causa)`. **Causas (fase B)**: 7 categorías; la oferta, UNA subcausa (la causa sale de ella);
  el diagnóstico, varias por causa, opcionales. EX, CN y MQ no son causas.
- Proceso de canalización: intake → distribución → confirmación → cierre. Ranking: sin
  convenio, al final; `estat` solo excluye «No procedeix». Valor = kg × coste
  por kilo de la canalización (nunca `productos.eur_kg` para lo fiscal).
- 🔴 **Precio del mes del albarán (D2, opción A)**: declarado en la oferta → definitivo; si no, `preu_referencia_de` del mes
  del REC; sin validar = **provisional**, se ajusta solo al validarlo (no lo certificado); con provisionales no se certifica.
  Validado con un Gencat anterior, **no se actualiza**.

## 8bis. Canal preferente

El **correo es el canal por defecto**; WhatsApp solo cuando se puede (`_shared/canal.ts`, puro):
interruptor apagado → correo; móvil y ventana abierta → texto; móvil y opt-in → plantilla; si no,
correo; sin ninguno, `cap`. `canal_preferido` se respeta si es viable. Lo decide el servidor
(`priorizar-entidades` devuelve `canal`, `motiu_canal`); `enviar-acceso` acepta `canal:'auto'`.

## 8ter. Cuando Meta rechaza

`wa_messages.status='error'` (wamid `err-…`); `scripts/diagnostico-whatsapp.ts` distingue los códigos (`context/08ter`).

## 9. Seguridad (detalle en `context/09-…md`)

- 🔴 **Cortina de contraseña** (`middleware.js` generado de `cortina/`; cookie 7 días): la enciende, apaga y
  cambia el super_admin en Configuració › General (`cortina_config`, `cortina-config`; **nace APAGADA**). El
  middleware lee `cortina-estat` (caché 20 s, **fail-closed**; `HASH_TOKEN` = respaldo). Detalle en `context/09`.
- Todo dato exige sesión de Supabase Auth; `anon` sin privilegios. Login `signInWithPassword`;
  recuperación por `recuperar-password` + `admin.generateLink` + Resend; `enable_signup=false` y el
  **mailer nativo apagado** (nunca `resetPasswordForEmail`, `inviteUserByEmail` ni magic links). Resend
  con `espigoladors.com`; `plantillaEmail()` (`_shared/resend.ts`) es el único maquetado.
- `enviar-acceso`: enlace por correo, **solo el código de 6 cifras por WhatsApp** (`verifyOtp`). `registro`
  público: cuenta + ficha + membresía **pendiente**, deduplicación y anti-abuso (`context/09`), sin correo (aprobar
  sí); RGPD: privacidad + dos consentimientos (`consentiments`).
- `donar-acces` (1D, **solo super_admin**): cuenta si falta → `concedir_acces_org` → enlace `recovery` (si falla,
  `revertir_acces_org`); correo apagado 409 salvo `manual`; modo test, solo `es_test`; deuda 152. **Crear o importar
  fichas no envía nada** (`correus-alta.e2e.ts`).
- **Firma electrónica simple en todos los documentos**: el servidor compone y hashea lo firmado
  (`409 document_canviat`), nombre, cargo y DNI, trazo PNG ≤1 MB, IP y UA en `evidencias`; vías correo,
  asistida y panel. `pujar-document-signat`: formato por **bytes** (`_shared/pujada.ts`), permiso antes de leer.
  **Firma propia del equipo** (`firma-equip`): PNG/JPG ≤1 MB en `activos/equip/<uid>/`, estampada en el albarán (`context/09`).
- Cuentas de prueba: 7 del arnés + la de doble rol; credenciales en `scripts/data/cuentas-prueba.json` (`context/09`).
- ⚠️ **Nunca `supabase config push`** (apagaría el login por email y subiría el Auth local); los
  flags de Auth van por Management API.

## 10. Variables de entorno

Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_ACCESSOS_TEST` (de build).
Edge Functions: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_API_VERSION`, `WHATSAPP_ENVIO_REAL`, `ALLOWED_ORIGIN` (varios
orígenes, `*` dentro de uno; **redesplegar al cambiarlo**), `RECORDATORIOS_SECRET`,
`DOCUMENTOS_SECRET` (y en `app_config`), `RESEND_API_KEY`, `RESEND_ENVIO_REAL`, `RESEND_FROM`,
`APP_URL`, `SB_SECRET_KEY`, `URL_PUBLICA_STORAGE`, `ANTIABUS_*` y `MAILPIT_URL` (solo clon). Auth:
`site_url` y `uri_allow_list` por Management API (`context/10`). Scripts: `SUPABASE_URL`, `SB_SECRET_KEY`.

## 10bis · 10ter. Nombres retirados

`pdApp-wp` → `P0MA` → `Redestina` (10-09-2026); no reusar nombres viejos (lista en el
detalle). Un cambio de dominio exige 308. CORS se verifica en la cabecera `Access-Control-Allow-Origin` del preflight, no en el estado.

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

- **Clon local** (Docker, «Redestina»): API `127.0.0.1:55321`, Postgres `55322` (`postgres/postgres`), Studio `55323`;
  skill `supabase-local`; se refresca con `scripts/local/`; correo y WhatsApp simulados (detalle y fallos: `context/11`).
- **Producción, con token temporal**: `bash scripts/sesion-supabase-temporal.sh` en la terminal del
  usuario (PAT `Redestina - Admin - Producción`); dentro, `aplicar-migracion.ts <f> [--dry-run]`,
  `functions deploy <f> [--no-verify-jwt según config.toml]`, `secrets set`, Management API. El
  asistente **no pide ni lee el token**; una sola pestaña, scripts por fase en `scripts/data/` con log.
- **Publicar**: skill `/publicar`, orden **base → Edge Functions → frontend** (`git push` el último).
  Tras redesplegar `generar-documento` (y `diagnostic-pdf`), `emitir_documento_prova()`. Tocar `_shared/` obliga a
  redesplegar todas las que lo importan (`context/11`). `preus-fonts` con `--no-verify-jwt`.
- Fixtures (orden, en el detalle) y emergencias: `scripts/roles-activos.ts off`; apagar `whatsapp_activo`.

## 12. Checkpoints y deuda técnica (cuerpo completo en `context/12-…md`)

**Checkpoints de negocio (no código)**: 2 plantillas de Meta y número de producción; 3 opt-in real; 4 formato legal del albarán;
5 reexportar `prod_actius.csv`; 6 Meta a producción; 7 apagar `VITE_ACCESSOS_TEST`; 8-9 validación de
altas y checklist de ficha; 10 **datos reales de la Fundación** en `parametros_documentales`
(Configuració › Fundació); 11 textos legales; 12 casar `municipio_ine` de las ubicaciones; 13 a qué causa nueva van FC y GD.

**Deuda abierta (98 vivas; siguiente: 206; los números no se reutilizan)**. Casi todas, decisiones con precio o a la espera (§12bis). Defectos o trabajo pendiente: **5** (filtros en cliente) · **126**
(`documentos_objeto_existe` no conoce `cierre_periodo`) · **127** (el resumen aún ofrece la factura) · **135** (D3 residual en snapshots y `v_albaranes_bandeja`) · **136** (sin code
splitting) · **138** (CR sin rectificar ni «enviat») · **143**
(entrantes con WhatsApp apagado: nadie los ve) · **146** (`organizacion_contactos` sin uso) · **149**
(dos vistas sin uso) · **151** (rama muerta en `registro/alta.ts`)
· **152** (privacidad en «Dona-li accés»)
· **153** (el ARA no crea ubicaciones) · **154** (código muerto del CT) · **155**
(rectificar reimprime la fecha) · **156** (selector de ámbito del certificado) ·
**157-164** (flecos de la firma) · **165-167** (flecos del importador) · **169** (alta del equipo) · **170** (artículo) · **171** (importador sin datos fiscales) · **172** (`entidades.estat`, `drop`) · **173** (exportar >1.000 filas) · **179** (`facturacio_anual_eur`, `drop`) · **181** (el texto no sigue al lugar) · **182** (fotos huérfanas al cancelar) · **183** (Mercabarna sin job) · **184-187** (flecos de D2) · **188** (envases: columnas sin uso) · **189** (E2E de precios provisionales) · **190** (anular en espigolada no reabre) · **191** (fixture de externos) · **192** (modelo heredado) · **193·195-202** (flecos de las fases 5 y 6) · **203** (validadas con fecha prevista) · **204** (`prova-importacio.sql` caso e) · **205** (PNG de firma huérfano al borrar una cuenta).
Decisiones de negocio pendientes (en `context/12`): **69**, **131**,
**133·134** (frenos), **137**, **141**, **148**. El resto (entradas 4–116), en §12bis.

**§12bis** y **§12ter** (100 cerradas, indexadas) viven en `context/`.

## 13. Al terminar cualquier cambio

1. **`npm run check`** en verde (tipos, `lint`, `vitest run`, `deno check`, `deno test` del PDF).
   **Referencia: 2.365 de Vitest (109 ficheros, 1 saltada) + 65 de Deno.**
2. `npm run build` si toca `src/`.
3. `deno run -A scripts/comprobar-rls.ts` si toca datos, políticas o roles.
   **Referencia: clon 2.508/2.508 y 41 sin datos (25-11); producción 2.301/2.301 y 142 (20-11-2026).** `prueba-numeracion.ts` si toca la numeración; `scripts/sql/prova-signatura-institucional.sql` si toca roles o firmas.
4. E2E de lo tocado contra el clon (`tests/e2e/*.e2e.ts`; el circuito: `circuit-tomaquet`).
5. Publicar con `/publicar` (base → funciones → frontend).
6. Estilos solo con tokens; un token nuevo va a `tokens.json`, `index.css` y `preview.html`.
7. **Actualizar este fichero (≤ 48 KB) y el `context/<sección>.md` que toque**; §1bis si cambia
   el alcance; la deuda: lo resuelto se tacha, lo nuevo con el número siguiente.
8. Commit en castellano, con el qué y el porqué. Pre-commit: tipos + vitest + deno check.
