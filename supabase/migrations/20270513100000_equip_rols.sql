-- Gestión de las cuentas del EQUIPO (09-11-2026): quién tiene rol de plataforma y cambiarlo.
--
-- Hasta ahora `usuario_roles` solo se tocaba a mano (SQL con la service key), así que subir a
-- alguien a super_admin exigía una sesión con token. Esta migración da al super_admin las dos
-- puertas que faltaban, y solo esas:
--
--   · `equip_membres()`  — el equipo (cuentas con rol, no los usuarios de las organizaciones),
--     con su rol efectivo, último acceso, desde cuándo y quién se lo dio.
--   · `canviar_rol_equip(usuari, rol)` — fija el rol: `super_admin` · `admin` · `tecnic`, o
--     `cap` para sacar la cuenta del equipo (conserva sus membresías de organización).
--
-- Decisiones (el porqué, para quien toque esto después):
--   · SOLO `es_super_admin()`. Dar o quitar acceso total al equipo no se amplía en silencio al
--     `admin`, igual que borrar una ficha o importar entidades.
--   · Una cuenta queda con UNA sola fila en `usuario_roles`. La PK es `(user_id, rol)`, así que
--     hasta hoy podía haber dos (admin + super_admin) y «subir» dejaba la vieja puesta; aquí se
--     normaliza al cambiar: se borran todas y se inserta la nueva.
--   · No te puedes cambiar el rol a ti mismo (`no_et_pots_canviar`) y nunca se deja el equipo sin
--     ningún super_admin activo (`ultim_super_admin`): las dos cosas dejarían la plataforma sin
--     nadie que pueda corregirlo desde la interfaz.
--   · NO da de alta cuentas ni convierte una cuenta externa en equipo (`no_es_de_lequip`): lo
--     primero es de `crear-usuario`, y lo segundo da acceso a TODOS los datos y merece su
--     propia puerta, no un efecto lateral de esta.
--   · Cada cambio deja una fila en `equip_rols_hist` (solo inserción, por la RPC; lectura
--     super_admin): quién, a quién y de qué a qué. Se guarda el correo, no solo el id, porque
--     al sacar a alguien del equipo o borrar la cuenta el id ya no dice nada.
--   · Compatible hacia atrás: no cambia nada de lo que usan el frontend ni las funciones
--     publicadas (`mi_rol()`, `es_super_admin()`, `pot_aprovar()` siguen leyendo `usuario_roles`).

-- 1. El historial -------------------------------------------------------------------------

create table if not exists public.equip_rols_hist (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  email       text,
  rol_abans   text check (rol_abans in ('super_admin', 'admin', 'tecnic')),
  rol_despres text check (rol_despres in ('super_admin', 'admin', 'tecnic')),
  per         uuid references public.perfiles(id) on delete set null,
  per_email   text,
  at          timestamptz not null default now()
);
create index if not exists equip_rols_hist_at on public.equip_rols_hist (at desc);

comment on table public.equip_rols_hist is
  'Cada cambio de rol de una cuenta del equipo (`rol_despres` null = sacada del equipo). Solo inserción, por `canviar_rol_equip()`. Lectura: super_admin.';

-- Dos capas (§4): `authenticated` SELECT y nada más; la política deja leer solo al super_admin.
alter table public.equip_rols_hist enable row level security;
revoke all on public.equip_rols_hist from anon;
revoke insert, update, delete, truncate on public.equip_rols_hist from authenticated;
grant select on public.equip_rols_hist to authenticated;
drop policy if exists equip_rols_hist_llegir on public.equip_rols_hist;
create policy equip_rols_hist_llegir on public.equip_rols_hist
  for select to authenticated
  using ((select public.es_super_admin()));

-- 2. El listado ---------------------------------------------------------------------------

create or replace function public.equip_membres()
returns table (
  user_id      uuid,
  email        text,
  nom          text,
  rol          text,
  actiu        boolean,
  ultim_acces  timestamptz,
  des_de       timestamptz,
  otorgat_per  text,
  es_tu        boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin veu l''equip.' using errcode = '42501';
  end if;

  -- El rol efectivo es el más alto (como `mi_rol()`); `des_de` y `otorgat_per` son los de esa fila.
  return query
  select distinct on (u.id)
         u.id,
         u.email::text,
         p.nombre,
         r.rol,
         coalesce(p.activo, true),
         u.last_sign_in_at,
         r.created_at,
         (select o.email::text from auth.users o where o.id = r.otorgado_por),
         u.id = auth.uid()
    from public.usuario_roles r
    join auth.users u on u.id = r.user_id
    left join public.perfiles p on p.id = u.id
   order by u.id,
            case r.rol when 'super_admin' then 1 when 'admin' then 2 else 3 end;
end;
$$;

revoke execute on function public.equip_membres() from public, anon;
grant execute on function public.equip_membres() to authenticated;

comment on function public.equip_membres() is
  'El equipo: una fila por cuenta con rol de plataforma (rol efectivo = el más alto). Solo super_admin (42501).';

-- 3. El cambio ----------------------------------------------------------------------------

create or replace function public.canviar_rol_equip(p_user uuid, p_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_abans   text;
  v_files   int;
  v_email   text;
  v_per     text;
  v_altres  int;
begin
  -- El permiso va antes que la existencia (un uuid inventado da 42501 a quien no puede).
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin canvia els rols de l''equip.' using errcode = '42501';
  end if;

  if p_rol is null or p_rol not in ('super_admin', 'admin', 'tecnic', 'cap') then
    raise exception 'rol_invalid' using errcode = '22023';
  end if;

  -- Serializa los cambios: dos a la vez podrían dejar el equipo sin super_admin cada uno por su lado.
  perform pg_advisory_xact_lock(hashtext('equip_rols'));

  if p_user is not distinct from auth.uid() then
    raise exception 'no_et_pots_canviar' using errcode = '22023';
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception 'usuari_inexistent' using errcode = '22023';
  end if;

  select r.rol, count(*) over ()
    into v_abans, v_files
    from public.usuario_roles r
   where r.user_id = p_user
   order by case r.rol when 'super_admin' then 1 when 'admin' then 2 else 3 end
   limit 1;
  if v_abans is null then
    raise exception 'no_es_de_lequip' using errcode = '22023';
  end if;

  -- Sin cambio real (mismo rol y una sola fila): no se escribe nada ni se ensucia el historial.
  if p_rol = v_abans and v_files = 1 then
    return jsonb_build_object('user_id', p_user, 'email', v_email, 'rol_abans', v_abans,
                              'rol_despres', v_abans, 'canviat', false);
  end if;

  -- Nunca el equipo sin un super_admin activo.
  if v_abans = 'super_admin' and p_rol <> 'super_admin' then
    select count(*) into v_altres
      from public.usuario_roles r
      join public.perfiles p on p.id = r.user_id
     where r.rol = 'super_admin' and p.activo and r.user_id <> p_user;
    if v_altres = 0 then
      raise exception 'ultim_super_admin' using errcode = '22023';
    end if;
  end if;

  delete from public.usuario_roles where user_id = p_user;
  if p_rol <> 'cap' then
    insert into public.usuario_roles (user_id, rol, otorgado_por) values (p_user, p_rol, auth.uid());
  end if;

  select pe.email into v_per from public.perfiles pe where pe.id = auth.uid();
  insert into public.equip_rols_hist (user_id, email, rol_abans, rol_despres, per, per_email)
  values (p_user, v_email, v_abans, case when p_rol = 'cap' then null else p_rol end, auth.uid(), v_per);

  return jsonb_build_object('user_id', p_user, 'email', v_email, 'rol_abans', v_abans,
                            'rol_despres', case when p_rol = 'cap' then null else p_rol end,
                            'canviat', true);
end;
$$;

revoke execute on function public.canviar_rol_equip(uuid, text) from public, anon;
grant execute on function public.canviar_rol_equip(uuid, text) to authenticated;

comment on function public.canviar_rol_equip(uuid, text) is
  'Fija el rol de una cuenta del EQUIPO: super_admin | admin | tecnic | cap (la saca del equipo). Solo super_admin; no a uno mismo; nunca deja el equipo sin super_admin; no añade cuentas nuevas. 22023: rol_invalid, no_et_pots_canviar, usuari_inexistent, no_es_de_lequip, ultim_super_admin.';
