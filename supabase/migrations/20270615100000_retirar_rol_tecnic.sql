-- Se retira el rol `tecnic` (25-11-2026, proceso 0.1 del plan de diciembre).
--
-- El equipo queda con DOS perfiles internos:
--   · Superadmin  (`super_admin`): configuración general, gestión de usuarios y la firma
--                  institucional (lo que estampa la firma de la apoderada en un documento real).
--   · Dinamitzador (`admin`, el valor interno NO se renombra): todo lo operativo —fichas,
--                  ofertas, convenios, certificados, albaranes— y la firma de los albaranes.
--
-- Qué hace esta migración, y solo esto:
--   1. Cada cuenta `tecnic` pasa a `admin`. Si ya tenía también la fila `admin` (la PK es
--      `(user_id, rol)`), se borra la de `tecnic`; si no, se convierte. Cada cambio deja su
--      fila en `equip_rols_hist` (`accio = 'rol'`, `per` nulo = la plataforma) con el motivo en
--      `detall`. Nunca toca una cuenta que no sea `tecnic`.
--   2. El CHECK de `usuario_roles.rol` queda en `('super_admin', 'admin')`.
--   3. `canviar_rol_equip()` rechaza `tecnic` con el mismo error que cualquier rol desconocido
--      (`22023 rol_invalid`). Misma firma: `create or replace` basta.
--
-- Qué NO hace, a propósito:
--   · `es_intern()` y `pot_aprovar()` se quedan como están. Sin `tecnic`, las dos devuelven lo
--     mismo para cualquier cuenta (equipo = admin o super_admin), y las ~46 RPC guardadas con
--     `pot_aprovar()` pasan a estar abiertas al Dinamitzador sin reescribir ninguna.
--   · El CHECK de `equip_rols_hist` conserva `tecnic`: es historia, y lo que pasó se queda.
--   · Las listas `('super_admin', 'admin', 'tecnic')` de `es_intern()`, `diagnostic_datos()`,
--     `puede_ver_documento()` y `puc_veure_document_extern()` se dejan: con el CHECK nuevo nadie
--     puede tener ya esa fila, así que sobran sin hacer daño.

-- 1. Las cuentas -------------------------------------------------------------------------

do $$
declare
  r       record;
  v_email text;
  v_nom   text;
begin
  for r in
    select t.user_id,
           exists (select 1 from public.usuario_roles a
                    where a.user_id = t.user_id and a.rol = 'admin')        as te_admin,
           exists (select 1 from public.usuario_roles s
                    where s.user_id = t.user_id and s.rol = 'super_admin')  as te_super
      from public.usuario_roles t
     where t.rol = 'tecnic'
  loop
    if r.te_admin or r.te_super then
      -- Ya tenía un rol más alto: la fila `tecnic` sobraba.
      delete from public.usuario_roles where user_id = r.user_id and rol = 'tecnic';
    else
      update public.usuario_roles set rol = 'admin' where user_id = r.user_id and rol = 'tecnic';
    end if;

    -- El rastro solo cuando el rol efectivo cambia (el más alto: un super_admin con una fila
    -- `tecnic` olvidada sigue siendo super_admin y no hay nada que contar).
    if not r.te_super and not r.te_admin then
      select u.email::text into v_email from auth.users u where u.id = r.user_id;
      select pe.nombre into v_nom from public.perfiles pe where pe.id = r.user_id;
      insert into public.equip_rols_hist (user_id, email, nom, rol_abans, rol_despres, accio, detall)
      values (r.user_id, v_email, v_nom, 'tecnic', 'admin', 'rol',
              jsonb_build_object('motiu', 'retirada del rol tècnic (plan DIC 26)',
                                 'migracio', '20270615100000'));
    end if;
  end loop;
end;
$$;

-- 2. El CHECK ------------------------------------------------------------------------------
-- La tabla tiene datos: `not valid` + `validate` (tras el paso 1 no queda ningún `tecnic`).

alter table public.usuario_roles drop constraint if exists usuario_roles_rol_check;
alter table public.usuario_roles
  add constraint usuario_roles_rol_check check (rol in ('super_admin', 'admin')) not valid;
alter table public.usuario_roles validate constraint usuario_roles_rol_check;

-- 3. canviar_rol_equip ----------------------------------------------------------------------
-- La última definición es la de 20270513100000; cambia solo la lista de roles aceptados.

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

  -- `tecnic` ya no existe (20270615100000): es un rol desconocido más.
  if p_rol is null or p_rol not in ('super_admin', 'admin', 'cap') then
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
  'Fija el rol de una cuenta del EQUIPO: super_admin | admin (Dinamitzador) | cap (la saca del equipo). `tecnic` se retiró en 20270615100000. Solo super_admin; no a uno mismo; nunca deja el equipo sin super_admin; no añade cuentas nuevas. 22023: rol_invalid, no_et_pots_canviar, usuari_inexistent, no_es_de_lequip, ultim_super_admin.';

comment on column public.usuario_roles.rol is
  'Rol de plataforma: super_admin (Superadmin) o admin (Dinamitzador). `tecnic` se retiró en 20270615100000; `equip_rols_hist` lo conserva como historia.';
