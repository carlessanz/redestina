-- Plan 1, rebanada 1D: dar acceso a una entidad que ya existe (D5, P1).
--
-- Hasta hoy la única forma de que el equipo diera una cuenta era «Nova organització amb compte»
-- (`alta-assistida`), que SIEMPRE creaba una organización nueva. Desde 1B el alta es sin acceso
-- (`crear_entitat`), y el acceso se da después sobre la ficha existente con la Edge Function
-- `donar-acces`. Esta migración pone las cuatro piezas de base de datos de ese camino:
--
--   · `concedir_acces_org()`  — solo `service_role`: el paso transaccional de `donar-acces`
--                               (correo en la ficha, membresías titulares, perfil activo). Devuelve
--                               la FOTO de lo que había, para poder deshacerlo.
--   · `revertir_acces_org()`  — solo `service_role`: la compensación, si el correo no sale.
--   · `desactivar_acces_org()`— `pot_aprovar()`: quita el acceso a toda la organización.
--   · `estat_acces_org()`     — `es_intern()`: el estado de la cuenta para la ficha, ENMASCARADO
--                               (el correo de la cuenta como `···@domini`). El frontend no toca `auth`.
--
-- Compatible hacia atrás: solo añade funciones.

-- ---------------------------------------------------------------------------
-- 1. `concedir_acces_org()` — solo servidor
-- ---------------------------------------------------------------------------
-- Una transacción con las fichas bloqueadas (`for update`): vuelve a comprobar las reglas que
-- `donar-acces` ya miró antes de crear la cuenta (aquí son la autoridad; allí, solo para fallar
-- limpio), escribe el correo en las fichas activas si cambia —no hay dos correos—, crea o
-- reactiva la membresía TITULAR y APROBADA en cada ficha ACTIVA y activa el perfil.
--
-- Reglas (22023 con el código en el mensaje):
--   · `entitat_inactiva`     — ninguna ficha activa: no se da acceso a una organización apagada.
--   · `registre_pendent`     — hay un alta de `/registre` sin validar: eso se decide en Aprovacions.
--   · `compte_equip`         — la cuenta es del equipo: no se la hace titular de una organización.
--   · `compte_en_altra_org`  — la cuenta ya es de otra organización (viva o pendiente).
--   · `altre_compte_actiu`   — la organización ya tiene OTRA cuenta con acceso (D3: un contacto).
create or replace function public.concedir_acces_org(
  p_org   uuid,
  p_user  uuid,
  p_email text,
  p_per   uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_prods   uuid[];
  v_ents    uuid[];
  v_correus jsonb := '[]'::jsonb;
  v_noves   jsonb := '[]'::jsonb;
  v_reacts  jsonb := '[]'::jsonb;
  v_perfil  boolean;
  v_f       record;
  v_m       record;
  v_id      uuid;
begin
  -- Solo el servidor. El EXECUTE ya está revocado a `authenticated`; esto es la segunda red.
  if auth.uid() is not null then
    raise exception 'Nomes el servidor dona acces' using errcode = '42501';
  end if;
  if not exists (select 1 from organizaciones where id = p_org) then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'correu_invalid' using errcode = '22023';
  end if;

  -- Las fichas ACTIVAS, bloqueadas hasta el final de la transacción.
  select coalesce(array_agg(id), '{}') into v_prods
    from (select id from productores where organizacion_id = p_org and activo for update) x;
  select coalesce(array_agg(id), '{}') into v_ents
    from (select id from entidades where organizacion_id = p_org and activo for update) x;
  if cardinality(v_prods) + cardinality(v_ents) = 0 then
    raise exception 'entitat_inactiva' using errcode = '22023';
  end if;

  select activo into v_perfil from perfiles where id = p_user for update;
  if not found then
    raise exception 'perfil_inexistent' using errcode = '22023';
  end if;
  if exists (select 1 from usuario_roles where user_id = p_user) then
    raise exception 'compte_equip' using errcode = '22023';
  end if;

  -- Un alta pendiente de cualquier ficha de la organización (activa o no).
  if exists (
    select 1 from membresias m
     where m.aprovacio = 'pendent'
       and (m.productor_id in (select id from productores where organizacion_id = p_org)
            or m.entidad_id in (select id from entidades where organizacion_id = p_org))
  ) then
    raise exception 'registre_pendent' using errcode = '22023';
  end if;

  -- La cuenta, viva o pendiente en fichas de OTRA organización.
  if exists (
    select 1 from membresias m
      left join productores p on p.id = m.productor_id
      left join entidades   e on e.id = m.entidad_id
     where m.user_id = p_user
       and (m.activo or m.aprovacio = 'pendent')
       and coalesce(p.organizacion_id, e.organizacion_id) is distinct from p_org
  ) then
    raise exception 'compte_en_altra_org' using errcode = '22023';
  end if;

  -- Otra cuenta con acceso a esta organización.
  if exists (
    select 1 from membresias m
     where m.user_id <> p_user and m.activo and m.aprovacio = 'aprovada'
       and (m.productor_id = any (v_prods) or m.entidad_id = any (v_ents))
  ) then
    raise exception 'altre_compte_actiu' using errcode = '22023';
  end if;

  -- El correo en las fichas activas, si cambia. Se guarda el anterior para la foto.
  for v_f in
    select 'productores' as taula, id, email from productores where id = any (v_prods)
    union all
    select 'entidades', id, email from entidades where id = any (v_ents)
  loop
    if lower(btrim(coalesce(v_f.email, ''))) is distinct from v_email then
      v_correus := v_correus || jsonb_build_object('taula', v_f.taula, 'id', v_f.id, 'email', v_f.email);
      if v_f.taula = 'productores' then
        update productores set email = v_email where id = v_f.id;
      else
        update entidades set email = v_email where id = v_f.id;
      end if;
    end if;
  end loop;

  -- La membresía titular y aprobada en cada ficha activa: nueva, o reactivada (con su estado
  -- anterior en la foto). Una que ya está viva no se toca.
  for v_f in
    select 'productor' as tipo, id from unnest(v_prods) as id
    union all
    select 'entidad', id from unnest(v_ents) as id
  loop
    select * into v_m from membresias
     where user_id = p_user
       and (case when v_f.tipo = 'productor' then productor_id else entidad_id end) = v_f.id
     for update;
    if not found then
      insert into membresias (user_id, tipo, productor_id, entidad_id, rol_org, activo,
                              aprovacio, aprovat_at, aprovat_per)
      values (p_user, v_f.tipo,
              case when v_f.tipo = 'productor' then v_f.id end,
              case when v_f.tipo = 'entidad' then v_f.id end,
              'titular', true, 'aprovada', now(), p_per)
      returning id into v_id;
      v_noves := v_noves || to_jsonb(v_id);
    elsif not (v_m.activo and v_m.aprovacio = 'aprovada' and v_m.rol_org = 'titular') then
      v_reacts := v_reacts || jsonb_build_object(
        'id', v_m.id, 'activo', v_m.activo, 'aprovacio', v_m.aprovacio, 'rol_org', v_m.rol_org,
        'aprovat_at', v_m.aprovat_at, 'aprovat_per', v_m.aprovat_per);
      update membresias
         set activo = true, aprovacio = 'aprovada', rol_org = 'titular',
             aprovat_at = now(), aprovat_per = p_per
       where id = v_m.id;
    end if;
  end loop;

  if not v_perfil then
    update perfiles set activo = true where id = p_user;
  end if;

  return jsonb_build_object(
    'organizacion_id', p_org,
    'user_id', p_user,
    'correus', v_correus,
    'noves', v_noves,
    'reactivades', v_reacts,
    'perfil_activo', v_perfil,
    'canvis', jsonb_array_length(v_correus) + jsonb_array_length(v_noves)
              + jsonb_array_length(v_reacts) > 0 or not v_perfil
  );
end;
$$;

comment on function public.concedir_acces_org(uuid, uuid, text, uuid) is
  'Plan 1, 1D. Solo service_role (donar-acces): correo en las fichas activas, membresía titular '
  'aprobada en cada una y perfil activo, en una transacción. Devuelve la foto previa para '
  'revertir_acces_org(). 22023: entitat_inactiva, registre_pendent, compte_equip, '
  'compte_en_altra_org, altre_compte_actiu, correu_invalid.';

-- ---------------------------------------------------------------------------
-- 2. `revertir_acces_org()` — la compensación de `donar-acces`
-- ---------------------------------------------------------------------------
-- Deja las filas como dice la foto que devolvió `concedir_acces_org()`: borra las membresías que
-- creó, devuelve las reactivadas a su estado, repone los correos y el `activo` del perfil.
create or replace function public.revertir_acces_org(p_foto jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor reverteix un acces' using errcode = '42501';
  end if;
  if p_foto is null then
    return;
  end if;

  delete from membresias
   where id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p_foto->'noves', '[]')) x);

  for v in select * from jsonb_array_elements(coalesce(p_foto->'reactivades', '[]')) loop
    update membresias
       set activo      = (v->>'activo')::boolean,
           aprovacio   = v->>'aprovacio',
           rol_org     = v->>'rol_org',
           aprovat_at  = (v->>'aprovat_at')::timestamptz,
           aprovat_per = (v->>'aprovat_per')::uuid
     where id = (v->>'id')::uuid;
  end loop;

  for v in select * from jsonb_array_elements(coalesce(p_foto->'correus', '[]')) loop
    if v->>'taula' = 'productores' then
      update productores set email = v->>'email' where id = (v->>'id')::uuid;
    elsif v->>'taula' = 'entidades' then
      update entidades set email = v->>'email' where id = (v->>'id')::uuid;
    end if;
  end loop;

  if (p_foto->>'perfil_activo') = 'false' then
    update perfiles set activo = false where id = (p_foto->>'user_id')::uuid;
  end if;
end;
$$;

comment on function public.revertir_acces_org(jsonb) is
  'Plan 1, 1D. Solo service_role: deshace concedir_acces_org() a partir de su foto.';

-- ---------------------------------------------------------------------------
-- 3. `desactivar_acces_org()` — quitar el acceso
-- ---------------------------------------------------------------------------
-- `membresias.activo = false` en todas las fichas de la organización y `perfiles.activo = false`
-- en cada cuenta afectada que se quede sin otra membresía activa. Una cuenta del EQUIPO nunca se
-- desactiva desde aquí (no es suya de la organización). Reactivar = «Dona-li accés» otra vez.
-- Las altas pendientes no se tocan: son cosa de Aprovacions.
create or replace function public.desactivar_acces_org(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_users   uuid[];
  v_p       int;
begin
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden treure l''acces' using errcode = '42501';
  end if;
  if not exists (select 1 from organizaciones where id = p_org) then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;

  with tocades as (
    update membresias m set activo = false
     where m.activo
       and (m.productor_id in (select id from productores where organizacion_id = p_org)
            or m.entidad_id in (select id from entidades where organizacion_id = p_org))
    returning m.user_id
  )
  select coalesce(array_agg(distinct user_id), '{}') into v_users from tocades;

  update perfiles pf set activo = false
   where pf.id = any (v_users) and pf.activo
     and not exists (select 1 from usuario_roles r where r.user_id = pf.id)
     and not exists (select 1 from membresias m where m.user_id = pf.id and m.activo);
  get diagnostics v_p = row_count;

  return jsonb_build_object('organizacion_id', p_org, 'comptes', cardinality(v_users),
                            'comptes_desactivats', v_p);
end;
$$;

comment on function public.desactivar_acces_org(uuid) is
  'Plan 1, 1D. pot_aprovar(): quita el acceso de todas las cuentas a la organización y desactiva '
  'el perfil de las que se quedan sin ninguna membresía activa (nunca el de una cuenta del equipo).';

-- ---------------------------------------------------------------------------
-- 4. `estat_acces_org()` — el estado de la cuenta, enmascarado
-- ---------------------------------------------------------------------------
-- Para el bloque «Contacte i accés» de la ficha. Lee `auth.users` (último acceso) para que el
-- navegador no tenga que hacerlo, y devuelve el correo de la cuenta como `···@domini`
-- (`_shared/enmascarar.ts`): la ficha ya enseña el suyo, y la cuenta solo necesita decir si es
-- la misma. Una fila siempre.
--   estat: sense · pendent · enviat (acceso dado, nunca ha entrado) · actiu · desactivat
create or replace function public.estat_acces_org(p_org uuid)
returns table (
  estat           text,
  compte_email    text,
  enviat_at       timestamptz,
  darrer_acces_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid;
  v_actiu   boolean := false;
  v_pendent boolean := false;
  v_email   text;
  v_last    timestamptz;
  v_enviat  timestamptz;
begin
  if auth.uid() is null or not public.es_intern() then
    raise exception 'Nomes l''equip consulta l''acces d''una entitat' using errcode = '42501';
  end if;
  if not exists (select 1 from organizaciones where id = p_org) then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;

  -- La cuenta que cuenta: la viva primero; si no, la pendiente; si no, la última desactivada.
  select m.user_id, (m.activo and m.aprovacio = 'aprovada' and pf.activo), m.aprovacio = 'pendent'
    into v_user, v_actiu, v_pendent
    from membresias m
    join perfiles pf on pf.id = m.user_id
   where (m.productor_id in (select id from productores where organizacion_id = p_org)
          or m.entidad_id in (select id from entidades where organizacion_id = p_org))
     and m.aprovacio in ('aprovada', 'pendent')
   order by (m.activo and m.aprovacio = 'aprovada' and pf.activo) desc,
            (m.aprovacio = 'pendent') desc,
            coalesce(m.aprovat_at, m.created_at) desc
   limit 1;

  select max(d.created_at) into v_enviat
    from documento_envios d
   where d.objeto_tipo = 'organizacion' and d.objeto_id = p_org
     and d.proposito = 'acces_entitat' and d.estado in ('enviat', 'simulat');

  if v_user is null then
    return query select 'sense'::text, null::text, v_enviat, null::timestamptz;
    return;
  end if;

  select u.email, u.last_sign_in_at into v_email, v_last from auth.users u where u.id = v_user;

  return query select
    case
      when v_actiu and v_last is not null then 'actiu'
      when v_actiu then 'enviat'
      when v_pendent then 'pendent'
      else 'desactivat'
    end,
    case when v_email is null then null
         when position('@' in v_email) = 0 then '···'
         else '···' || lower(substring(v_email from '@.*$')) end,
    v_enviat,
    v_last;
end;
$$;

comment on function public.estat_acces_org(uuid) is
  'Plan 1, 1D. es_intern(): estado de la cuenta de una organización (sense · pendent · enviat · '
  'actiu · desactivat), con el correo de la cuenta enmascarado y el último acceso.';

-- ---------------------------------------------------------------------------
-- 5. Permisos
-- ---------------------------------------------------------------------------
revoke execute on function public.concedir_acces_org(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.revertir_acces_org(jsonb) from public, anon, authenticated;
grant execute on function public.concedir_acces_org(uuid, uuid, text, uuid) to service_role;
grant execute on function public.revertir_acces_org(jsonb) to service_role;

revoke execute on function public.desactivar_acces_org(uuid) from public, anon, service_role;
revoke execute on function public.estat_acces_org(uuid) from public, anon, service_role;
grant execute on function public.desactivar_acces_org(uuid) to authenticated;
grant execute on function public.estat_acces_org(uuid) to authenticated;
