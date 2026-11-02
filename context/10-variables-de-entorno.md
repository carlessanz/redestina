# AGENTS.md §10 — 10. Variables de entorno

> Detalle de la sección 10 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §10» del código apuntan aquí.

## 10. Variables de entorno

**Frontend** (`.env.local`, ignorado por git; plantilla en `.env.local.example`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`)
- `VITE_ACCESSOS_TEST` — `"true"` enseña en `/login` los accesos de un clic a las cuentas de prueba
  (§6quater). **Es una variable de build**: cambiarla exige recompilar y volver a desplegar, no basta
  con editarla en Vercel. Con cualquier otro valor —o ausente— el módulo con las contraseñas se cae
  del bundle. Hoy vale `true` en tu `.env.local` y en Vercel producción.

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
  Permite ensayar el circuito entero sin salir a la red y sin `RESEND_API_KEY`: la
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
- `URL_PUBLICA_STORAGE` — **solo en el clon local** (`supabase/.env.funciones-local`, §11): el
  origen público con el que `descargar-documento` y `enlace-publico` reescriben las URLs firmadas,
  que dentro de Docker salen con `http://kong:8000`. En producción no existe y no se crea.
- `SUPABASE_URL` (la inyecta Supabase automáticamente)

**Redirect URLs de Auth** (Management API, no config push): `site_url` = APP_URL y `uri_allow_list`
incluye `localhost:5173`, el dominio de producción y el comodín de los despliegues de Vercel, todos
sobre `redestina`.
⚠️ **Son dos matchers distintos**: el de las Edge Functions convierte `*` en `[A-Za-z0-9-]+` y compara
orígenes completos (sin `/**`); el de GoTrue es glob y **sí** necesita el `/**` final. No copiar el
mismo literal a los dos sitios.

**Scripts**: `SUPABASE_URL` y `SB_SECRET_KEY` en el entorno.

