-- Alta de cuentas del EQUIPO desde la app (deuda 169).
--
-- Hasta ahora una cuenta nueva del equipo se daba de alta a mano (Admin API + insert en
-- `usuario_roles` con la service key). A partir de aquí el Superadmin lo hace desde
-- Configuració › Equip: la Edge Function `alta-equip` crea la cuenta con la Admin API (el trigger
-- `on_auth_user_created` le crea el perfil) y llama a esta RPC con la service key para darle el rol
-- y dejar el apunte en el historial.
--
--   1. `equip_rols_hist.accio` admite 'alta' (la cuenta entra en el equipo con su primer rol).
--   2. `alta_membre_equip(p_user, p_rol, p_autor)`: solo `service_role` (sin EXECUTE para ninguna
--      sesión: quien decide si el autor puede es la Edge Function con `exigirEquipo` + super_admin,
--      y la RPC lo vuelve a comprobar con `p_autor`, porque con la service key `auth.uid()` es nulo).
--
-- `equip_auditoria()` no traduce acciones: devuelve `accio` tal cual (también 'alta'); la etiqueta
-- la pone la interfaz (`ACCIONS_HIST` + clave `eq.h_alta`).

-- 1. El CHECK del historial --------------------------------------------------------------------
-- La tabla tiene datos, pero el CHECK nuevo es más amplio que el viejo: todo lo que hay cumple.
-- Aun así, `not valid` + `validate` (§7), para no bloquear la tabla mientras se comprueba.

alter table public.equip_rols_hist drop constraint if exists equip_rols_hist_accio_check;
alter table public.equip_rols_hist
  add constraint equip_rols_hist_accio_check
  check (accio in ('rol', 'activa', 'desactiva', 'edita', 'esborra', 'traspas', 'alta')) not valid;
alter table public.equip_rols_hist validate constraint equip_rols_hist_accio_check;

comment on column public.equip_rols_hist.accio is
  'Qué se hizo: alta (la cuenta entra en el equipo, por alta_membre_equip), rol (cambio de rol), activa, desactiva, edita, esborra (cuenta borrada) o traspas (solo sus acciones).';

-- 2. La RPC ------------------------------------------------------------------------------------

drop function if exists public.alta_membre_equip(uuid, text, uuid);
create function public.alta_membre_equip(p_user uuid, p_rol text, p_autor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email     text;
  v_per_email text;
begin
  -- Solo `service_role` (la Edge Function `alta-equip`). Sin EXECUTE para `authenticated` ya no
  -- entra ninguna sesión; esta guarda es la segunda capa por si alguien lo concede sin querer.
  if auth.uid() is not null then
    raise exception 'Només el servidor dona d''alta comptes de l''equip.' using errcode = '42501';
  end if;

  -- El permiso va antes que la existencia: quien la pide debe ser super_admin ACTIVO.
  if p_autor is null or not exists (
       select 1
         from public.usuario_roles r
         join public.perfiles p on p.id = r.user_id
        where r.user_id = p_autor and r.rol = 'super_admin' and p.activo
     ) then
    raise exception 'Només el super_admin dona d''alta comptes de l''equip.' using errcode = '42501';
  end if;

  if p_rol is null or p_rol not in ('super_admin', 'admin') then
    raise exception 'rol_invalid' using errcode = '22023';
  end if;

  -- Serializa con `canviar_rol_equip` y las RPC `equip_*` (mismo candado).
  perform pg_advisory_xact_lock(hashtext('equip_rols'));

  if p_user is null or not exists (select 1 from public.perfiles p where p.id = p_user) then
    raise exception 'compte_inexistent' using errcode = '22023';
  end if;

  if exists (select 1 from public.usuario_roles r where r.user_id = p_user) then
    raise exception 'compte_equip' using errcode = '22023';
  end if;

  -- Una cuenta del equipo no tiene organizaciones (§4). El trigger `usuario_roles_no_membre`
  -- lo impediría igualmente; se comprueba antes con el MISMO código para un error limpio.
  if exists (select 1 from public.membresias m where m.user_id = p_user and m.activo) then
    raise exception 'te_membresies' using errcode = '22023';
  end if;

  insert into public.usuario_roles (user_id, rol, otorgado_por) values (p_user, p_rol, p_autor);

  select u.email::text into v_email from auth.users u where u.id = p_user;
  select pe.email into v_per_email from public.perfiles pe where pe.id = p_autor;

  -- `nom` y `per_nom` los rellena el trigger `equip_rols_hist_noms`.
  insert into public.equip_rols_hist (user_id, email, rol_abans, rol_despres, accio, per, per_email)
  values (p_user, v_email, null, p_rol, 'alta', p_autor, v_per_email);

  return jsonb_build_object('user_id', p_user, 'email', v_email, 'rol', p_rol);
end;
$$;

revoke execute on function public.alta_membre_equip(uuid, text, uuid) from public, anon, authenticated;

comment on function public.alta_membre_equip(uuid, text, uuid) is
  'Da de alta en el EQUIPO una cuenta ya creada (Admin API; perfil por on_auth_user_created): inserta usuario_roles (otorgado_por = p_autor) y un apunte accio=''alta'' en equip_rols_hist. Solo service_role (Edge Function alta-equip). 42501: sesión o p_autor que no es super_admin activo. 22023: rol_invalid, compte_inexistent, compte_equip, te_membresies. Devuelve {user_id, email, rol}.';
