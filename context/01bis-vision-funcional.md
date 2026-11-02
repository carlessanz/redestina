# AGENTS.md §1bis — 1bis. Visión funcional Redestina 2026 (modelo objetivo ↔ lo construido)

> Detalle de la sección 1bis de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §1bis» del código apuntan aquí.

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
(donante→Espigoladors y Espigoladors→entidad); numeración de serie sin huecos (en lo construido: `REC`/`ENT`/`OPE` y sus rectificativos `R-…`; «ALB/ALR» es la nomenclatura del funcional, no del código); kilos
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
| `organizacion` multirol única | `productores` + `entidades` (2 tablas) con `organizaciones` como identidad común (§4): doble rol se detecta por `organizacion_id`, no por teléfono; registro deduplica antes de crear (§12.28, cerrada). Falta el resto: `usuario`/`rol_organizacion` propios y una organización con campos suyos más allá de `canal_preferido` | 🟡 |
| `usuario` de organización | `perfiles` + `membresias` (vincula la cuenta con su ficha; §4bis) | ✅ |
| `rol_organizacion` | `membresias.rol_org` (titular/operador) + `usuario_roles` de plataforma | 🟡 |
| `convenio` de colaboración | `convenios` + `convenios_exigidos`, con firma por enlace, contrafirma, campaña y —desde el 22-09-2026— **registro del que se firmó en papel** antes de Redestina (§4) | ✅ |
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
| `diagnostico`/`plan_prevencion`/`plan_revision` | **Diagnòstic operatiu** del productor (v2, ficha viva con `diagnostics_historial`, 11-10-2026); el receptor ya no tiene diagnóstico, tiene «El meu perfil de recepció». El **Pla de Prevenció es un expediente** (`expedients_prevencion` + visitas, procesos, cuantificación, objetivos, acciones, seguimiento trimestral y verificación anual; PDF `PLA` versionado, 12-10-2026); estructura provisional hasta el modelo PPPMA | 🟡 |
| `derivacion_espigueo` | `espigoladas` con alta manual, **conversión desde una oferta «producte al camp»** y reparto en lotes | 🟡 |
| `historial_estado` | — | ⬜ |
| `webhook_log` | `wa_messages.raw` (jsonb) | 🟡 |
| catálogos (categorías/unidades/motivos/destinos) | `productos`/`causas`/`factores_conversion` y, desde el 11-10-2026, `destins_finals` (destino final de los kilos de una oferta, §6ter) | 🟡 |
| back office, cola de **aprobaciones**, Super Admin | `Aprovacions` con **tres colas** (registros, convenios por contrasignar, intereses), aprobando **desde la cola**; aprobar exige `pot_aprovar()` | 🟡 |
| **alta de organización** (onboarding) | **registro público self-service** (`/registre` → Edge Function `registro`) con validación del equipo (§9) | 🟡 |
| **roles y permisos** | RLS por rol y organización, encendida en producción (§4bis) | ✅ |
| parte pública / catálogo público | **landing pública** en `/` + `/login`, `/admin` y `/registre` (§6quater). Catálogo público de ofertas, no | 🟡 |
| **modelo asistido** | de facto: el equipo opera todo desde el panel | 🟡 |
| multiidioma `ca`/`es` | i18n propio (`src/lib/i18n.tsx`) | ✅ |
| móvil primero / responsive | responsive `md`, mensajería lista↔conversación | ✅ |
| módulo de comunicación WhatsApp | Fase 1 + intake/opt-in/gates/recordatorios | ✅/excede |
| valor económico | Coste por kilo que **declara el productor** en cada oferta (`excedentes.coste_kg`), partiendo del de **referencia** del producto (`costes_producto`, uno por producto, sin ejercicio, 27-09-2026); se congela en la canalización al conciliar; sin coste no hay cierre | ✅ |
| vistas/indicadores (`v_kpi_subvencion`…) | `kpis_equip()` con periodo (fase 8) e **impacto** ambiental/social/económico por organización y global (`impacte_*`, factores provisionales en `factors_impacte`, fase 10) | 🟡 |

**Brechas mayores pendientes** (orden aproximado de dependencia): ~~(1) roles y permisos~~
**resuelta** (§4bis) → **(2) organización unificada multirol + `usuario`** — 🟡 **en curso, y más
avanzada de lo que este párrafo llegó a decir**: la identidad existe y cada ficha cuelga de la
suya (`organizaciones` + `v_organizaciones`, §4), con el trigger que garantiza que las nuevas
también (`20270313100000`); los **convenios** ya son de la organización y no de la ficha
(§12.79); una cuenta tiene **una ficha de cada tipo** (§12.31); **el registro ya deduplica**
antes de crear (§12.28, cerrada `20270315100000` — hasta el 22-09-2026 este párrafo seguía
diciendo que faltaba); y **WhatsApp ya distingue las dos fichas por `organizacion_id`**, no por
teléfono (§12.16, cerrada). Lo que queda no es ningún consumidor concreto: es el resto del
modelo objetivo —`usuario`/`rol_organizacion` propios, una organización con campos suyos más
allá de `canal_preferido`, deduplicación que no dependa de correo/teléfono exactos—, sin
desglosar en deudas numeradas. Su plan vive en
`3. Claude Code/2026-09-22-plan-organizacion-unificada.md` (§1) → ~~(3) back office~~ y
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
**marcados como tales**, y el certificado se niega a emitirse mientras lo sean. Aparte de eso, la
brecha con más trabajo real por delante sigue siendo la **organización unificada multirol** — no
porque falte poco, sino porque lo que falta es una decisión de modelo de datos, no un consumidor
suelto (ver el plan citado arriba).

