-- `updated_at` deja de mentir en tres tablas. Cierra la deuda §12.100.
--
-- QUÉ PASABA. `app_settings`, `app_config`, `intake_sessions` y `perfiles` tienen una
-- columna `updated_at timestamptz not null default now()` y **ningún trigger**, así que
-- ese `default` solo actúa en el `insert`: un `update` la deja intacta. La columna no
-- dice cuándo se cambió la fila, dice cuándo se creó, que es justo lo contrario de lo que
-- su nombre promete. Se vio el 14-09-2026 apagando y encendiendo `whatsapp_activo` en
-- producción: los dos cambios dejaron el `updated_at` del `insert` de su migración.
--
-- POR QUÉ IMPORTA MÁS EN UNAS QUE EN OTRAS:
--
--   · **`perfiles`** es la que de verdad importa. Tiene `grant update (nombre, telefono,
--     idioma, vista_defecto)` para los propios usuarios (`20260730090000:134`): la gente
--     edita su ficha desde el panel y la columna no se mueve nunca.
--   · **`app_settings`** guarda los interruptores del proyecto —`test_mode`,
--     `roles_activos`, `whatsapp_activo`—, y apagar WhatsApp es exactamente el tipo de
--     cosa que hay que poder fechar: «¿desde cuándo no sale nada?». Hoy la respuesta que
--     da esa columna es «desde siempre».
--   · **`app_config`** guarda secretos que rota el equipo (`recordatorios_secret`,
--     `documentos_secret`); saber cuándo se rotó el último es media respuesta cuando algo
--     deja de autenticarse.
--
-- NO EXISTÍA NINGÚN `set_updated_at()` QUE REUTILIZAR, y conviene decir por qué no se
-- reutilizó lo que sí hay: las tres tablas que mantienen la columna
-- (`costes_producto`, `convenios`, `planes_prevencion`) lo hacen con un
-- `new.updated_at := now()` escrito a mano **dentro de su trigger de control**
-- (`20261012100000`, `20270111100000`, `20270301100000`), que además valida transiciones
-- de estado e inmutabilidad. Esos triggers no se tocan: su mitad de `updated_at` ya
-- funciona y meter un segundo trigger encima solo añadiría un orden de ejecución que hoy
-- no hace falta razonar.
--
-- 🔴 **`intake_sessions` SE QUEDA FUERA, Y NO ES UN OLVIDO.** Es la única de las cuatro
--    cuyo `updated_at` **no es la fecha de modificación de la fila**: es un dato de
--    negocio —«la última vez que esta persona dijo algo»— y hay código vivo que lo lee
--    como tal:
--
--      · `intake-recordatorios` busca sesiones con `updated_at` entre 10 min y 12 h y, al
--        marcar el aviso, **escribe solo `recordatorio_enviado_at` a propósito**: su
--        propio comentario dice «no toca updated_at (si no, la ventana de 10 min se
--        reiniciaría)». Con un trigger genérico, ese `update` del sistema movería la
--        marca y la sesión parecería recién activa.
--      · `intake.ts` descarta la sesión a las 12 h contando desde `updated_at`. Una
--        sesión muerta volvería a parecer viva cada vez que el cron la tocara.
--      · `atendreElDialeg()` (`_shared/respuestas.ts`, deuda §12.16) desempata quién
--        contesta un mensaje comparando `intake_sessions.updated_at` con
--        `oferta_respuestas.enviado_at`. Si el recordatorio adelanta esa marca, el
--        sistema cree que el intake «habló después» que la oferta y **secuestra la
--        respuesta** de una organización con doble rol.
--
--    O sea que el trigger genérico no solo no arreglaría nada ahí: rompería tres
--    comportamientos, y los tres en silencio. Su `updated_at` ya lo mantiene `guardar()`
--    en cada interacción real, que es quien sabe qué cuenta como actividad.
--
-- ⚠️ EL TRIGGER ESCRIBE UNA COLUMNA QUE QUIEN HACE EL `UPDATE` NO PUEDE TOCAR, y eso es
--    lo que lo hace funcionar en `perfiles`: el privilegio se comprueba sobre las
--    columnas de la sentencia, no sobre las que modifica un trigger `before`. Un usuario
--    con `grant update (nombre, telefono, idioma, vista_defecto)` sigue sin poder
--    escribir `updated_at` a mano —ni falsearla— y aun así la columna se actualiza.
--
-- ⚠️ Y PISA LO QUE ESCRIBA EL CLIENTE, también a propósito. `src/lib/settings.ts`,
--    `scripts/set-config.ts` y `scripts/roles-activos.ts` mandan hoy un
--    `updated_at: new Date().toISOString()` con el reloj de la máquina de quien ejecuta.
--    A partir de aquí manda `now()` del servidor: una sola fuente de tiempo y no
--    falsificable. Los tres siguen funcionando sin cambios.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- No es `security definer` —no lee ninguna tabla, solo toca NEW—, pero el `search_path`
-- se fija igual: así `now()` se resuelve en `pg_catalog` pase lo que pase.
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger genérico BEFORE UPDATE: pone updated_at = now() del servidor. No usar en intake_sessions (su updated_at es actividad de la persona, no mtime de la fila).';

-- `create function` concede EXECUTE a PUBLIC. Se quita: una función que devuelve
-- `trigger` no se puede llamar directamente, y el privilegio solo se comprueba al CREAR
-- el trigger (que hace el propietario en una migración), no al dispararlo.
revoke execute on function public.set_updated_at() from public, anon;

-- ---------------------------------------------------------------------------
-- Los tres triggers
-- ---------------------------------------------------------------------------
-- `drop … if exists` primero: ninguna de las tres tiene hoy trigger alguno (comprobado
-- contra producción el 14-09-2026, `pg_trigger` vacío para las cuatro tablas), pero así
-- la migración es idempotente y no duplica nada si se reaplica.
drop trigger if exists app_settings_updated_at on app_settings;
create trigger app_settings_updated_at
  before update on app_settings
  for each row execute function public.set_updated_at();

drop trigger if exists app_config_updated_at on app_config;
create trigger app_config_updated_at
  before update on app_config
  for each row execute function public.set_updated_at();

drop trigger if exists perfiles_updated_at on perfiles;
create trigger perfiles_updated_at
  before update on perfiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
-- 1. Los tres triggers existen y `intake_sessions` sigue sin ninguno:
--
--   select c.relname, t.tgname
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where not t.tgisinternal
--      and c.relname in ('app_settings','app_config','perfiles','intake_sessions');
--   -- 3 filas, ninguna de intake_sessions
--
-- 2. Que la columna se mueve de verdad (sin cambiar el valor del interruptor):
--
--   select key, value, updated_at from app_settings where key = 'whatsapp_activo';
--   update app_settings set value = value where key = 'whatsapp_activo';
--   select key, value, updated_at from app_settings where key = 'whatsapp_activo';
--   -- el updated_at es posterior; el value, el mismo
--
-- 3. Que un usuario externo la mueve sin poder escribirla (con su sesión, por PostgREST):
--
--   update perfiles set telefono = telefono where id = auth.uid();
--   -- ok, y updated_at pasa a ahora
--   update perfiles set updated_at = '2000-01-01' where id = auth.uid();
--   -- 42501 permission denied for column updated_at
