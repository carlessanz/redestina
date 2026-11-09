-- «Pantalla de protecció prèvia a la home» (la cortina de contraseña), 09-11-2026.
--
-- Hasta hoy la cortina estaba siempre puesta y su contraseña solo existía como huella en
-- `cortina/cortina.ts`. Ahora la enciende, la apaga y le cambia la contraseña el super_admin desde
-- Configuració › General, y la contraseña es VISIBLE para él (a petición de Carles).
--
-- Una sola fila (`id = 1`):
--   · `activa`      — nace APAGADA (decisión del cliente: de momento la web queda abierta).
--   · `contrasenya` — en claro, a propósito: el super_admin la tiene que poder ver y dar. Nadie más
--                     la lee: la tabla no tiene GRANT para `anon` ni `authenticated`; solo la
--                     devuelve `cortina_config()` (super_admin).
--   · `hash_token`  — SHA-256 del token PBKDF2 de la contraseña (`_shared/cortinaHash.ts`), lo
--                     único que necesita el middleware. Lo calcula la Edge Function `cortina-config`,
--                     nunca el cliente. Nula = vale la huella de respaldo del repo (`HASH_TOKEN`),
--                     que es la contraseña de antes de esta migración y que no se puede mostrar.
--   · `updated_by`  — el correo de quien hizo el último cambio, COPIADO como texto (sin FK: que
--                     borrar la cuenta del equipo no toque ni pierda este rastro).
--
-- El middleware lee `activa` y `hash_token` de la Edge Function pública `cortina-estat`, que entra
-- con `service_role`: no hace falta ningún privilegio para `anon`.

create table public.cortina_config (
  id integer primary key default 1 check (id = 1),
  activa boolean not null default false,
  contrasenya text check (contrasenya is null or char_length(contrasenya) between 8 and 100),
  hash_token text check (hash_token is null or hash_token ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now(),
  updated_by text,
  -- Contraseña y huella van siempre juntas (o ninguna: la de respaldo).
  constraint cortina_config_parella check ((contrasenya is null) = (hash_token is null))
);

alter table public.cortina_config enable row level security;
-- Una tabla nueva nace con SELECT para `authenticated`: aquí lleva una contraseña en claro.
revoke all on table public.cortina_config from public, anon, authenticated;

insert into public.cortina_config (id, activa) values (1, false);

comment on table public.cortina_config is
  'Cortina de contraseña (una fila). Contraseña en claro SOLO para el super_admin vía cortina_config().';

-- ── Lectura: super_admin ─────────────────────────────────────────────────────────────────────
create or replace function public.cortina_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare r public.cortina_config;
begin
  -- Sin sesión = service_role. El permiso se comprueba antes que nada.
  if auth.uid() is not null and not es_super_admin() then
    raise exception 'només super_admin' using errcode = '42501';
  end if;
  select * into r from public.cortina_config where id = 1;
  return jsonb_build_object(
    'activa', r.activa,
    'contrasenya', r.contrasenya,
    -- Sin contraseña propia, la vigente es la anterior a esta pantalla y no se puede mostrar.
    'propia', r.contrasenya is not null,
    'updated_at', r.updated_at,
    'updated_by', r.updated_by
  );
end $$;

-- ── Encender / apagar: super_admin ───────────────────────────────────────────────────────────
create or replace function public.cortina_activar(p_activa boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_email text;
begin
  if auth.uid() is not null and not es_super_admin() then
    raise exception 'només super_admin' using errcode = '42501';
  end if;
  if p_activa is null then
    raise exception 'parametre_invalid' using errcode = '22023';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  update public.cortina_config
     set activa = p_activa, updated_at = now(), updated_by = coalesce(v_email, 'servidor')
   where id = 1;
  return public.cortina_config();
end $$;

-- ── Contraseña nueva: solo la Edge Function `cortina-config`, que calcula la huella ──────────
create or replace function public.cortina_desar_contrasenya(p_contrasenya text, p_hash text, p_per text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_contrasenya is null or char_length(p_contrasenya) not between 8 and 100
     or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'parametre_invalid' using errcode = '22023';
  end if;
  update public.cortina_config
     set contrasenya = p_contrasenya, hash_token = p_hash,
         updated_at = now(), updated_by = coalesce(p_per, 'servidor')
   where id = 1;
end $$;

revoke execute on function public.cortina_config() from public, anon;
revoke execute on function public.cortina_activar(boolean) from public, anon;
revoke execute on function public.cortina_desar_contrasenya(text, text, text) from public, anon, authenticated;
grant execute on function public.cortina_config() to authenticated, service_role;
grant execute on function public.cortina_activar(boolean) to authenticated, service_role;
grant execute on function public.cortina_desar_contrasenya(text, text, text) to service_role;
