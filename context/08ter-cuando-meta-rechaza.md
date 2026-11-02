# AGENTS.md §8ter — 8ter. Cuando Meta rechaza un envío

> Detalle de la sección 8ter de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §8ter» del código apuntan aquí.

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

