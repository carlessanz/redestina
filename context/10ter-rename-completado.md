# AGENTS.md §10ter — 10ter. Cómo se completó el rename (10-09-2026)

> Detalle de la sección 10ter de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §10ter» del código apuntan aquí.

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
   TOKEN="$SUPABASE_ACCESS_TOKEN"   # dentro de la sesión temporal (§11)
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

