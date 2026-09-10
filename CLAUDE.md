# CLAUDE.md

Contexto para Claude Code en este repositorio.

Todo el contexto del proyecto —arquitectura, modelo de datos, flujos, convenciones,
reglas de negocio, seguridad, comandos y deuda técnica— vive en un único documento
canónico, que se importa aquí:

@AGENTS.md

## Visión funcional del producto

**Redestina** es un **servicio** de la Fundació Espigoladors apoyado por tecnología, que actúa como
**ERP del servicio**: canaliza excedentes agrícolas por cinco líneas —donación social (core),
salida comercial, transformación por maquila, espigueo y diagnóstico/prevención— con un equipo de
dinamización que opera de forma **asistida** en nombre de las organizaciones. Lo construido hoy es
un **subconjunto** de esa visión (Fase 1 WhatsApp + Redestina núcleo: intake, priorización, canalización
y cierre básico, más —desde el 31-07-2026— **parte pública, registro self-service validado por el
equipo y accesos separados** para usuarios y equipo); falta el grueso del modelo objetivo
(organización multirol, convenios, demandas, conciliación real, certificados, diagnóstico/planes).

- **Versión reducida + correspondencia objetivo↔construido:** `AGENTS.md §1bis` (se importa arriba;
  es la fuente mantenida de este resumen).
- **Funcional completo adaptado** (con estado de implementación por sección): `docs/Documento
  funcional Redestina 2026 — adaptado.md`.
- **Funcional original** (visión de negocio íntegra): `docs/Documento funcional Redestina 2026.md`.

Ambos documentos de `docs/` están **fuera de git** (§7). Para el detalle de negocio mandan esos
funcionales; para el **estado real construido**, manda `AGENTS.md`.

## Rama de trabajo

**Trabaja sobre `main`,** que es la rama por defecto del repo. No crees ramas nuevas por
tarea ni con nombres generados. (Hubo una convención anterior de trabajar en `dev`; se
retiró el 10-09-2026 al reintegrar esa rama en `main`.)

## Regla permanente

**Cada modificación debe dejar `AGENTS.md` al día en el mismo cambio.** Al importarse
desde aquí, mantener ese fichero actualizado mantiene actualizado también este.
No dupliques contenido en `CLAUDE.md`: se desincronizaría.

Actualiza `AGENTS.md` cuando cambie cualquiera de estas cosas:

- estructura de ficheros o responsabilidades de los componentes
- esquema de la base de datos, políticas RLS o migraciones
- contratos de las Edge Functions (`whatsapp-send`, `whatsapp-webhook`, `registro`…)
- **el mapa de rutas**, sobre todo qué es público y qué no (`AGENTS.md §6quater`)
- convenciones, reglas de negocio o postura de seguridad
- variables de entorno o comandos
- deuda técnica: lo que se resuelva se tacha, lo que se introduzca se anota

## Antes de dar por terminado un cambio

1. `npm run build` (corre `tsc` en modo `strict`).
2. `deno run -A scripts/comprobar-rls.ts` si el cambio toca datos, políticas o roles: comprueba los
   permisos de verdad, contra la base y con sesiones reales. Hoy está en **56/57** (el único rojo es
   conocido y correcto: un receptor comercial sin ninguna oferta de `venda` publicada).
3. `AGENTS.md` actualizado.
4. Commit en castellano.
5. Para **publicar en producción**, el skill `/publicar`: hace el commit, el push, el redespliegue
   de las Edge Functions que lo necesiten y verifica dominio, CORS y permisos. Detalle en
   `AGENTS.md` §11.

## Carpeta del proyecto de consultoría (fuera del repo)

La documentación del proyecto vive en `/Users/carlessanz/Documents/Claude/Projects/Redestina/`,
accesible desde Claude Code por `additionalDirectories` en `.claude/settings.local.json`.
Está organizada así: raíz = documentos vigentes (funcional v3, automatización, guía técnica,
manual, flujo), `1. Fuentes/` = memoria de subvención, feedback de la Fundación, datos ARA y
diseño, `2. Contexto/` = histórico (no se toca) y **`3. Claude Code/`** = todo lo que genera
Claude: lo que escribe este repo y las salidas de Cowork (`3. Claude Code/diseño/` es el origen
de `design/tokens.json` y `design/DESIGN.md`).

- **Lee** de la raíz y de `1. Fuentes/` cuando haga falta el funcional vigente, la memoria de
  subvención o el feedback de la Fundación. Las copias de `docs/` del repo pueden ir por detrás.
- **Escribe únicamente en `3. Claude Code/`**: informes de estado, análisis, resúmenes de cambios,
  propuestas. Markdown, un documento por tema, nombre `AAAA-MM-DD-tema.md`, y añade la fila
  correspondiente al `README.md` de esa carpeta.
- **Nunca copies allí** `Usuarios y accesos`, `usuarios-test.md`, `.env*`, `scripts/data/` ni nada
  con credenciales o datos personales: esa carpeta puede subirse al Project de Claude.
- No escribas en la raíz, `1. Fuentes/` ni `2. Contexto/`.
