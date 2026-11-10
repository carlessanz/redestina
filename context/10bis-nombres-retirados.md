# AGENTS.md §10bis — 10bis. Nombres retirados y lo que dejaron aprendido

> Detalle de la sección 10bis de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §10bis» del código apuntan aquí.

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

1. **`project_id` y los contenedores locales** (ya no aplica, se anota como historia). Cuando este
   proyecto todavía levantaba Supabase local, cambiar `project_id` sin un `supabase stop` previo
   dejaba doce contenedores huérfanos, porque el CLI filtra por el nombre nuevo. Desde el
   14-09-2026 no hay stack local (§7), así que el aviso se queda solo como lección.
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

5. ~~**El proyecto de Supabase sigue llamándose `pdApp-wp` en el dashboard.**~~ — **falso, y
   la corrección enseña más que el dato.** Escrito el 14-09-2026 leyendo
   `supabase/.temp/linked-project.json`, que trae `"name": "pdApp-wp"`. **El proyecto se llama
   `Redestina`**, y se comprueba preguntando al remoto en vez de a un fichero local:
   ```bash
   TOKEN="$SUPABASE_ACCESS_TOKEN"   # dentro de la sesión temporal (§11)
   curl -sS -H "Authorization: Bearer $TOKEN" \
     https://api.supabase.com/v1/projects/uxppvaldhptdomvdhsmn   # → "name": "Redestina"
   ```
   ⚠️ **`linked-project.json` es una CACHÉ del momento en que se enlazó** (aquí, el 17-07-2026,
   cuando el proyecto sí se llamaba así), no un espejo del remoto: `link` lo escribió una vez y
   nadie lo ha vuelto a tocar desde entonces. El `ref` que guarda sí es estable y por eso el
   fichero sirve; el `name` lleva casi dos meses caducado. La lección vale para los cuatro
   ficheros de `supabase/.temp/`: **dicen cómo era el remoto cuando se enlazó, no cómo es**.

~~⚠️ El rebranding es textual, no visual: falta el logo.~~ — **resuelto (10-09-2026)** con el
sistema de diseño (§2bis): logo nuevo en seis variantes, iconos de la PWA, favicon y `logo-email.png`
regenerados. Deuda 41 cerrada. Los PDF de
`docs/nuevas-funcionalidades/` cambiaron de nombre pero no de contenido: son binarios y por dentro
siguen diciendo POMA.


**Pantallas retiradas por el Plan 2** (10-11-2026). A1: `PlaPrevencio`, «Prepara el pla», «Emet el pla» (el plan
básico; el plan es el expediente). **A3** (`20270522100000`): la pestaña **Configuració › Diagnòstic**
(`EditorDiagnostic`, «Qüestionari», claves `cfgd.*`) y las preguntas del motor genérico en el formulario del
diagnóstico (`Pregunta`, `ControlFitxaViva`, el prefill): el cuestionario del productor quedó `vigente=false` sin v4 y
el diagnóstico son la Operativa y las tablas de excedentes. Las funciones del motor siguen en la base sin pantalla
(deuda 175).
