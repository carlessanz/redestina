-- Gestión completa de las cuentas del EQUIPO (09-11-2026): editar, activar, desactivar, borrar y
-- traspasar sus acciones a otra cuenta. Sigue a `20270513100000` (ver y cambiar el rol).
--
-- Lo que pidió Carles, y lo que se descubrió al hacerlo:
--
--   1. Las cuentas del equipo NO son de ninguna organización: ni tienen ofertas ni pueden
--      tenerlas. Tienen su rol y hacen trámites. → dos triggers (§1): una membresía activa no se
--      puede crear a una cuenta con rol de equipo, ni un rol a una cuenta con membresía activa.
--      No se toca lo que ya exista (un trigger solo mira lo que entra).
--
--   2. Al desactivar o borrar a alguien, sus acciones (el convenio que contrafirmó, los
--      documentos que emitió, las notas, las aprobaciones…) se pueden pasar a otra cuenta del
--      equipo. «Sus acciones» son TODAS las columnas de autoría, y esta migración las localiza
--      por el CATÁLOGO —cualquier FK de `public` a `auth.users`/`perfiles` con `on delete set
--      null`, más dos columnas sin FK— en vez de enumerarlas: una tabla nueva con su
--      `creado_por` entra sola (`equip_columnes_autoria()`).
--
--   3. 🔴 HALLAZGO: HOY NO SE PUEDE BORRAR NINGUNA CUENTA que haya emitido un documento, un
--      albarán o firmado un convenio. El `on delete set null` de `documentos.emitido_por` dispara
--      el UPDATE, y `trg_documentos_inmutable` (igual que `albaranes` y `convenios`) lo rechaza
--      («Un document emes no es pot modificar»). Y mover la autoría a otra cuenta lo rechazan los
--      mismos tres. La inmutabilidad protege el CONTENIDO de lo emitido, no quién lo hizo (el
--      PDF ya lleva impreso lo que lleva), así que los diez triggers de inmutabilidad/control
--      reciben una guarda: `redestina.traspas_autoria = 'on'`, que solo ponen las RPC de esta
--      migración dentro de su transacción (`set_config(..., true)`) y apagan al acabar. Lo demás
--      sigue exactamente igual de inmutable. Cada traspaso o borrado deja huella en
--      `equip_traspassos` (de quién a quién, cuántas filas de qué tabla), así que «antes lo hizo X»
--      no se pierde.
--
-- Todas las RPC son `es_super_admin()` (el permiso va antes que la existencia), ninguna actúa
-- sobre uno mismo (activar/desactivar/borrar: `no_et_pots_tocar`), y ninguna deja el equipo sin
-- un super_admin activo (`ultim_super_admin`). Borrar a quien tiene acciones EXIGE destino
-- (`cal_desti`): se probó dejarlas a NULL y un convenio «declarado» lo rechaza por CHECK. Compatible hacia atrás: solo añade, y
-- `equip_membres()` gana dos columnas (el frontend publicado lee por nombre).

-- 1. Las cuentas del equipo no tienen organización -----------------------------------------

create or replace function public.trg_membresia_no_equip()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.activo, true)
     and exists (select 1 from public.usuario_roles r where r.user_id = new.user_id) then
    raise exception 'compte_equip' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_membresia_no_equip() from public, anon, authenticated;

drop trigger if exists membresias_no_equip on public.membresias;
create trigger membresias_no_equip
  before insert or update of activo, user_id on public.membresias
  for each row execute function public.trg_membresia_no_equip();

create or replace function public.trg_rol_no_membre()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.membresias m where m.user_id = new.user_id and m.activo) then
    raise exception 'te_membresies' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_rol_no_membre() from public, anon, authenticated;

drop trigger if exists usuario_roles_no_membre on public.usuario_roles;
create trigger usuario_roles_no_membre
  before insert on public.usuario_roles
  for each row execute function public.trg_rol_no_membre();

-- 2. La inmutabilidad deja mover QUIÉN, solo dentro de las RPC de esta migración ------------
-- Se parchea cada función con la guarda exacta (no se reescribe a mano: se parte de la
-- definición vigente) y se verifica que quedó puesta.

do $$
declare
  f   text;
  def text;
  nou text;
begin
  foreach f in array array[
    'trg_albaranes_inmutable', 'trg_canalizaciones_protegeix_recollida', 'trg_cierres_donante_tipo',
    'trg_convenios_control', 'trg_costes_producto_hist', 'trg_documentos_inmutable',
    'trg_membresias_control_aprovacio', 'trg_planes_control', 'trg_plantillas_inmutables',
    'trg_questionaris_inmutables'
  ] loop
    def := pg_get_functiondef(('public.' || f)::regproc);
    if def like '%redestina.traspas_autoria%' then
      continue;  -- ya parcheada (migración re-ejecutada)
    end if;
    nou := regexp_replace(
      def, E'\nbegin\n',
      E'\nbegin\n  -- Traspaso o borrado de una cuenta del equipo (20270514100000): solo cambia QUIEN, y solo las RPC\n  -- `equip_*` ponen esta marca dentro de su transaccion.\n  if tg_op = ''UPDATE'' and coalesce(current_setting(''redestina.traspas_autoria'', true), '''') = ''on'' then\n    return new;\n  end if;\n',
      'i');
    if nou = def then
      raise exception 'No se pudo parchear % (no tiene un begin a inicio de linea)', f;
    end if;
    execute nou;
    if pg_get_functiondef(('public.' || f)::regproc) not like '%redestina.traspas_autoria%' then
      raise exception 'La guarda no quedo en %', f;
    end if;
  end loop;
end;
$$;

-- 3. Qué columnas son «una acción de alguien» ----------------------------------------------

create or replace function public.equip_columnes_autoria()
returns table (taula text, columna text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cl.relname::text, a.attname::text
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f'
     and c.confrelid in ('auth.users'::regclass, 'public.perfiles'::regclass)
     and c.confdeltype = 'n'                       -- SET NULL: quien lo hizo, no de quien es
     and n.nspname = 'public' and cl.relkind = 'r'
     and cl.relname not like 'equip\_%'            -- el historial del propio equipo no se reescribe
  union all
  values ('excedente_destins'::text, 'registrat_per'::text), ('excedentes_canvis', 'revisat_per');
$$;
revoke execute on function public.equip_columnes_autoria() from public, anon, authenticated;

comment on function public.equip_columnes_autoria() is
  'Las columnas de autoría: FK de `public` a auth.users/perfiles con ON DELETE SET NULL (+ excedente_destins.registrat_per y excedentes_canvis.revisat_per, sin FK). Interna: sin EXECUTE para sesiones.';

-- 4. Historial ampliado y registro de traspasos ---------------------------------------------

alter table public.equip_rols_hist
  add column if not exists accio text not null default 'rol'
    check (accio in ('rol', 'activa', 'desactiva', 'edita', 'esborra', 'traspas')),
  add column if not exists detall jsonb;

comment on column public.equip_rols_hist.accio is
  'Qué se hizo: rol (cambio de rol), activa, desactiva, edita, esborra (cuenta borrada) o traspas (solo sus acciones).';

create table if not exists public.equip_traspassos (
  id           uuid primary key default gen_random_uuid(),
  origen_id    uuid not null,
  origen_email text,
  desti_id     uuid not null,
  desti_email  text,
  motiu        text not null check (motiu in ('traspas', 'desactiva', 'esborra')),
  total        int  not null,
  detall       jsonb not null,
  per          uuid,
  per_email    text,
  at           timestamptz not null default now()
);
create index if not exists equip_traspassos_at on public.equip_traspassos (at desc);

comment on table public.equip_traspassos is
  'Cada traspaso de acciones entre cuentas del equipo: de quién a quién, cuántas filas de qué tabla (`detall` = [{taula, columna, n}]). Sin FK a propósito: sobrevive al borrado de las cuentas. Solo inserción, por las RPC `equip_*`. Lectura: super_admin.';

alter table public.equip_traspassos enable row level security;
revoke all on public.equip_traspassos from anon;
revoke insert, update, delete, truncate on public.equip_traspassos from authenticated;
grant select on public.equip_traspassos to authenticated;
drop policy if exists equip_traspassos_llegir on public.equip_traspassos;
create policy equip_traspassos_llegir on public.equip_traspassos
  for select to authenticated
  using ((select public.es_super_admin()));

-- 5. Lo que ha hecho una cuenta -------------------------------------------------------------

create or replace function public.equip_total_accions(p_user uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  n       bigint;
  v_total bigint := 0;
begin
  for r in select * from public.equip_columnes_autoria() loop
    execute format('select count(*) from public.%I where %I = $1', r.taula, r.columna) into n using p_user;
    v_total := v_total + n;
  end loop;
  return v_total;
end;
$$;
revoke execute on function public.equip_total_accions(uuid) from public, anon, authenticated;

create or replace function public.equip_accions(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  n       bigint;
  v_acc   jsonb := '[]'::jsonb;
  v_total bigint := 0;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin veu les accions d''un compte.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'usuari_inexistent' using errcode = '22023';
  end if;

  for r in select * from public.equip_columnes_autoria() order by 1, 2 loop
    execute format('select count(*) from public.%I where %I = $1', r.taula, r.columna) into n using p_user;
    if n > 0 then
      v_acc := v_acc || jsonb_build_object('taula', r.taula, 'columna', r.columna, 'n', n);
      v_total := v_total + n;
    end if;
  end loop;

  return jsonb_build_object(
    'accions', v_acc,
    'total', v_total,
    'membresies', (select count(*) from public.membresias m where m.user_id = p_user),
    'es_equip', exists (select 1 from public.usuario_roles ur where ur.user_id = p_user));
end;
$$;
revoke execute on function public.equip_accions(uuid) from public, anon;
grant execute on function public.equip_accions(uuid) to authenticated;

comment on function public.equip_accions(p_user uuid) is
  'Lo que ha hecho una cuenta: {accions:[{taula,columna,n}], total, membresies, es_equip}. Solo super_admin (42501).';

-- 6. Mover las acciones (interna) ------------------------------------------------------------

create or replace function public.equip_moure_accions(p_origen uuid, p_desti uuid, p_motiu text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  n       bigint;
  v_det   jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_oe    text;
  v_de    text;
  v_pe    text;
begin
  select u.email::text into v_oe from auth.users u where u.id = p_origen;
  select u.email::text into v_de from auth.users u where u.id = p_desti;
  select pe.email into v_pe from public.perfiles pe where pe.id = auth.uid();

  -- La marca que dejan pasar los triggers de inmutabilidad (§2): solo mientras dura esto.
  perform set_config('redestina.traspas_autoria', 'on', true);
  for r in select * from public.equip_columnes_autoria() order by 1, 2 loop
    execute format('update public.%I set %I = $1 where %I = $2', r.taula, r.columna, r.columna)
      using p_desti, p_origen;
    get diagnostics n = row_count;
    if n > 0 then
      v_det := v_det || jsonb_build_object('taula', r.taula, 'columna', r.columna, 'n', n);
      v_total := v_total + n;
    end if;
  end loop;
  perform set_config('redestina.traspas_autoria', 'off', true);

  insert into public.equip_traspassos (origen_id, origen_email, desti_id, desti_email, motiu, total, detall, per, per_email)
  values (p_origen, v_oe, p_desti, v_de, p_motiu, v_total, v_det, auth.uid(), v_pe);

  return jsonb_build_object('total', v_total, 'detall', v_det);
end;
$$;
revoke execute on function public.equip_moure_accions(uuid, uuid, text) from public, anon, authenticated;

comment on function public.equip_moure_accions(uuid, uuid, text) is
  'INTERNA: mueve todas las columnas de autoría de una cuenta a otra con la marca de traspaso puesta, y lo registra en equip_traspassos. Sin EXECUTE para sesiones; la llaman las RPC `equip_*` ya autorizadas.';

-- 7. Validaciones comunes (interna) ---------------------------------------------------------
-- Una sola puerta para «esta cuenta es del equipo» y «este destino vale».

create or replace function public.equip_valida_desti(p_origen uuid, p_desti uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_desti is not distinct from p_origen then
    raise exception 'desti_igual' using errcode = '22023';
  end if;
  if not exists (
       select 1 from public.usuario_roles r join public.perfiles p on p.id = r.user_id
        where r.user_id = p_desti and p.activo) then
    raise exception 'desti_no_equip' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.equip_valida_desti(uuid, uuid) from public, anon, authenticated;

-- 8. Traspasar sin más ----------------------------------------------------------------------

create or replace function public.traspassar_accions_equip(p_origen uuid, p_desti uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res   jsonb;
  v_email text;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin traspassa accions.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('equip_rols'));
  select u.email::text into v_email from auth.users u where u.id = p_origen;
  if not found then
    raise exception 'usuari_inexistent' using errcode = '22023';
  end if;
  if not exists (select 1 from public.usuario_roles r where r.user_id = p_origen) then
    raise exception 'no_es_de_lequip' using errcode = '22023';
  end if;
  perform public.equip_valida_desti(p_origen, p_desti);

  v_res := public.equip_moure_accions(p_origen, p_desti, 'traspas');

  insert into public.equip_rols_hist (user_id, email, accio, detall, per, per_email)
  values (p_origen, v_email, 'traspas', v_res || jsonb_build_object('desti_email', (select u.email::text from auth.users u where u.id = p_desti)),
          auth.uid(), (select pe.email from public.perfiles pe where pe.id = auth.uid()));
  return v_res;
end;
$$;
revoke execute on function public.traspassar_accions_equip(uuid, uuid) from public, anon;
grant execute on function public.traspassar_accions_equip(uuid, uuid) to authenticated;

comment on function public.traspassar_accions_equip(uuid, uuid) is
  'Pasa todas las acciones de una cuenta del equipo a otra (activa, del equipo). Solo super_admin. 22023: usuari_inexistent, no_es_de_lequip, desti_igual, desti_no_equip.';

-- 9. Activar y desactivar ---------------------------------------------------------------------

create or replace function public.activar_membre_equip(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email  text;
  v_activo boolean;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin activa comptes de l''equip.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('equip_rols'));
  if p_user is not distinct from auth.uid() then
    raise exception 'no_et_pots_tocar' using errcode = '22023';
  end if;
  select u.email::text into v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception 'usuari_inexistent' using errcode = '22023';
  end if;
  if not exists (select 1 from public.usuario_roles r where r.user_id = p_user) then
    raise exception 'no_es_de_lequip' using errcode = '22023';
  end if;

  select p.activo into v_activo from public.perfiles p where p.id = p_user;
  if coalesce(v_activo, false) then
    return jsonb_build_object('user_id', p_user, 'email', v_email, 'canviat', false);
  end if;

  update public.perfiles set activo = true, updated_at = now() where id = p_user;
  insert into public.equip_rols_hist (user_id, email, accio, per, per_email)
  values (p_user, v_email, 'activa', auth.uid(), (select pe.email from public.perfiles pe where pe.id = auth.uid()));
  return jsonb_build_object('user_id', p_user, 'email', v_email, 'canviat', true);
end;
$$;
revoke execute on function public.activar_membre_equip(uuid) from public, anon;
grant execute on function public.activar_membre_equip(uuid) to authenticated;

comment on function public.activar_membre_equip(uuid) is
  'Reactiva una cuenta del equipo (`perfiles.activo`). Solo super_admin; no a uno mismo. 22023: no_et_pots_tocar, usuari_inexistent, no_es_de_lequip.';

create or replace function public.desactivar_membre_equip(p_user uuid, p_desti uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email  text;
  v_rol    text;
  v_activo boolean;
  v_altres int;
  v_mov    jsonb := jsonb_build_object('total', 0, 'detall', '[]'::jsonb);
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin desactiva comptes de l''equip.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('equip_rols'));
  if p_user is not distinct from auth.uid() then
    raise exception 'no_et_pots_tocar' using errcode = '22023';
  end if;
  select u.email::text into v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception 'usuari_inexistent' using errcode = '22023';
  end if;
  select r.rol into v_rol from public.usuario_roles r where r.user_id = p_user
   order by case r.rol when 'super_admin' then 1 when 'admin' then 2 else 3 end limit 1;
  if v_rol is null then
    raise exception 'no_es_de_lequip' using errcode = '22023';
  end if;
  select coalesce(p.activo, false) into v_activo from public.perfiles p where p.id = p_user;

  -- Nunca el equipo sin un super_admin activo.
  if v_rol = 'super_admin' and v_activo then
    select count(*) into v_altres from public.usuario_roles r join public.perfiles p on p.id = r.user_id
     where r.rol = 'super_admin' and p.activo and r.user_id <> p_user;
    if v_altres = 0 then
      raise exception 'ultim_super_admin' using errcode = '22023';
    end if;
  end if;

  if p_desti is not null then
    perform public.equip_valida_desti(p_user, p_desti);
    v_mov := public.equip_moure_accions(p_user, p_desti, 'desactiva');
  end if;

  if v_activo then
    update public.perfiles set activo = false, updated_at = now() where id = p_user;
    -- Fuera las sesiones abiertas: con el perfil inactivo ya no ve nada, pero así tampoco renueva.
    begin
      delete from auth.sessions where user_id = p_user;
    exception when insufficient_privilege then
      null;
    end;
  end if;

  insert into public.equip_rols_hist (user_id, email, rol_abans, rol_despres, accio, detall, per, per_email)
  values (p_user, v_email, v_rol, v_rol, 'desactiva',
          jsonb_build_object('ja_inactiu', not v_activo, 'traspassades', v_mov -> 'total',
                             'desti_email', (select u.email::text from auth.users u where u.id = p_desti)),
          auth.uid(), (select pe.email from public.perfiles pe where pe.id = auth.uid()));
  return jsonb_build_object('user_id', p_user, 'email', v_email, 'canviat', v_activo,
                            'traspassades', v_mov -> 'total');
end;
$$;
revoke execute on function public.desactivar_membre_equip(uuid, uuid) from public, anon;
grant execute on function public.desactivar_membre_equip(uuid, uuid) to authenticated;

comment on function public.desactivar_membre_equip(uuid, uuid) is
  'Desactiva una cuenta del equipo (`perfiles.activo = false`: pierde todos los permisos y se cierran sus sesiones) y, con `p_desti`, pasa antes sus acciones a otra cuenta activa del equipo. Solo super_admin; no a uno mismo; nunca deja el equipo sin super_admin activo. 22023: no_et_pots_tocar, usuari_inexistent, no_es_de_lequip, ultim_super_admin, desti_igual, desti_no_equip.';

-- 10. Editar ------------------------------------------------------------------------------------

create or replace function public.editar_membre_equip(p_user uuid, p_nom text, p_telefon text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nom    text := nullif(btrim(p_nom), '');
  v_tel    text := nullif(regexp_replace(coalesce(p_telefon, ''), '[\s+()\-]', '', 'g'), '');
  v_email  text;
  v_abans  record;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin edita comptes de l''equip.' using errcode = '42501';
  end if;
  if v_nom is not null and char_length(v_nom) > 120 then
    raise exception 'nom_massa_llarg' using errcode = '22023';
  end if;
  -- E.164 sin «+» (§7): 8 a 15 cifras, sin cero inicial.
  if v_tel is not null and v_tel !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'telefon_invalid' using errcode = '22023';
  end if;
  select u.email::text into v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception 'usuari_inexistent' using errcode = '22023';
  end if;
  if not exists (select 1 from public.usuario_roles r where r.user_id = p_user) then
    raise exception 'no_es_de_lequip' using errcode = '22023';
  end if;

  select p.nombre, p.telefono into v_abans from public.perfiles p where p.id = p_user;
  if v_abans.nombre is not distinct from v_nom and v_abans.telefono is not distinct from v_tel then
    return jsonb_build_object('user_id', p_user, 'email', v_email, 'canviat', false);
  end if;

  update public.perfiles set nombre = v_nom, telefono = v_tel, updated_at = now() where id = p_user;
  insert into public.equip_rols_hist (user_id, email, accio, detall, per, per_email)
  values (p_user, v_email, 'edita',
          jsonb_build_object('nom', v_abans.nombre is distinct from v_nom, 'telefon', v_abans.telefono is distinct from v_tel),
          auth.uid(), (select pe.email from public.perfiles pe where pe.id = auth.uid()));
  return jsonb_build_object('user_id', p_user, 'email', v_email, 'canviat', true);
end;
$$;
revoke execute on function public.editar_membre_equip(uuid, text, text) from public, anon;
grant execute on function public.editar_membre_equip(uuid, text, text) to authenticated;

comment on function public.editar_membre_equip(uuid, text, text) is
  'Edita nombre y teléfono (E.164 sin +) de una cuenta del equipo. El correo NO: es el de acceso y se cambia por la Admin API. Solo super_admin (también a uno mismo). 22023: nom_massa_llarg, telefon_invalid, usuari_inexistent, no_es_de_lequip.';

-- 11. Borrar -------------------------------------------------------------------------------------

create or replace function public.esborrar_membre_equip(p_user uuid, p_desti uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email  text;
  v_rol    text;
  v_activo boolean;
  v_altres int;
  v_mov    jsonb := jsonb_build_object('total', 0, 'detall', '[]'::jsonb);
  v_desti  text;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin esborra comptes de l''equip.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('equip_rols'));
  if p_user is not distinct from auth.uid() then
    raise exception 'no_et_pots_tocar' using errcode = '22023';
  end if;
  select u.email::text into v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception 'usuari_inexistent' using errcode = '22023';
  end if;
  select r.rol into v_rol from public.usuario_roles r where r.user_id = p_user
   order by case r.rol when 'super_admin' then 1 when 'admin' then 2 else 3 end limit 1;
  if v_rol is null then
    raise exception 'no_es_de_lequip' using errcode = '22023';
  end if;
  select coalesce(p.activo, false) into v_activo from public.perfiles p where p.id = p_user;

  if v_rol = 'super_admin' and v_activo then
    select count(*) into v_altres from public.usuario_roles r join public.perfiles p on p.id = r.user_id
     where r.rol = 'super_admin' and p.activo and r.user_id <> p_user;
    if v_altres = 0 then
      raise exception 'ultim_super_admin' using errcode = '22023';
    end if;
  end if;

  -- 🔴 Sin destino solo se borra a quien no ha hecho nada: dejar las autorías a NULL rompe reglas
  -- de negocio (un convenio «declarado» exige constar quién lo declaró: `convenios_numero_segons_estat`)
  -- y deja lo emitido sin responsable. Lo comprobado en el clon antes de decidirlo.
  if p_desti is null and public.equip_total_accions(p_user) > 0 then
    raise exception 'cal_desti' using errcode = '22023';
  end if;

  if p_desti is not null then
    perform public.equip_valida_desti(p_user, p_desti);
    v_mov := public.equip_moure_accions(p_user, p_desti, 'esborra');
    select u.email::text into v_desti from auth.users u where u.id = p_desti;
  end if;

  -- El apunte va ANTES: después de borrar ya no hay a quién describir (por eso lleva el correo).
  insert into public.equip_rols_hist (user_id, email, rol_abans, rol_despres, accio, detall, per, per_email)
  values (p_user, v_email, v_rol, null, 'esborra',
          jsonb_build_object('traspassades', v_mov -> 'total', 'desti_email', v_desti),
          auth.uid(), (select pe.email from public.perfiles pe where pe.id = auth.uid()));

  -- Ya no queda nada con su nombre (o nunca hubo): el SET NULL de las FK no toca ninguna fila.
  -- La marca es por si una tabla nueva con autoría llegara sin pasar por `equip_columnes_autoria()`.
  perform set_config('redestina.traspas_autoria', 'on', true);
  delete from auth.users where id = p_user;
  perform set_config('redestina.traspas_autoria', 'off', true);

  return jsonb_build_object('user_id', p_user, 'email', v_email, 'rol', v_rol,
                            'traspassades', v_mov -> 'total');
end;
$$;
revoke execute on function public.esborrar_membre_equip(uuid, uuid) from public, anon;
grant execute on function public.esborrar_membre_equip(uuid, uuid) to authenticated;

comment on function public.esborrar_membre_equip(uuid, uuid) is
  'Borra una cuenta del equipo (auth.users; perfil, rol y sesiones en cascada) y, con `p_desti`, pasa antes sus acciones a otra cuenta activa del equipo; sin destino solo si no ha hecho nada (`cal_desti`: dejar las autorías a NULL rompe reglas de negocio). Solo super_admin; no a uno mismo; nunca deja el equipo sin super_admin activo. Irreversible. 22023: no_et_pots_tocar, usuari_inexistent, no_es_de_lequip, ultim_super_admin, cal_desti, desti_igual, desti_no_equip.';

-- 12. El listado gana teléfono y membresías (por si alguna cuenta antigua las tiene) -------------

drop function if exists public.equip_membres();

create function public.equip_membres()
returns table (
  user_id      uuid,
  email        text,
  nom          text,
  rol          text,
  actiu        boolean,
  ultim_acces  timestamptz,
  des_de       timestamptz,
  otorgat_per  text,
  es_tu        boolean,
  telefon      text,
  membresies   int
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
         u.id = auth.uid(),
         p.telefono,
         (select count(*)::int from public.membresias m where m.user_id = u.id and m.activo)
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
  'El equipo: una fila por cuenta con rol de plataforma (rol efectivo = el más alto), con teléfono y cuántas membresías de organización tiene aún (debería ser 0). Solo super_admin (42501).';
