-- Auditoría del equipo que sobrevive a traspasos y borrados (09-11-2026).
--
-- Lo que pidió Carles: «la auditoría debe mantener los nombres y el correo de las personas que han
-- hecho todo. Traspasar es solo para que las acciones las pueda seguir otra persona; la auditoría
-- mantiene la fecha, todos los movimientos y quién los hizo. Si esa persona se borra, debe quedar».
--
-- Cómo estaba: el traspaso reescribe las columnas de autoría (para que la nueva persona siga lo
-- pendiente) y, desde 20270515100000, deja fila a fila quién lo hizo originalmente
-- (`equip_traspassos_files` → `equip_traspassos.origen_*`). Pero de quien se borraba solo quedaba
-- el CORREO: su nombre vivía en `perfiles`, que se borra en cascada con la cuenta.
--
-- Qué cambia:
--   1. `equip_persones_arxiu`: la identidad (nombre, correo, teléfono, rol) de toda cuenta del
--      equipo que se borra, guardada justo antes de borrarla. Cualquier uuid que quede en una
--      tabla de auditoría (con o sin FK) se puede seguir resolviendo a una persona.
--   2. Nombres, además de correos, en `equip_rols_hist` (`nom`, `per_nom`) y en `equip_traspassos`
--      (`origen_nom`, `desti_nom`, `per_nom`). Los rellena un trigger BEFORE INSERT desde `perfiles`
--      (los apuntes se escriben antes de borrar: ver `esborrar_membre_equip`), así que ninguna de las
--      RPC `equip_*` cambia. Se completan los apuntes anteriores con lo que aún haya en `perfiles`.
--   3. `equip_auditoria()`: la auditoría completa (cambios de rol, altas y bajas, ediciones,
--      traspasos y borrados) con fecha, quién lo hizo y a quién, con nombre y correo, incluidas las
--      personas ya borradas. Solo super_admin.
--   4. `equip_autoria_fila()` gana los nombres.
--
-- El trigger de archivo va en `auth.users` (BEFORE DELETE): así guarda la identidad borre quien
-- borre (la RPC o un `delete` por SQL), y solo de las cuentas con rol de equipo.

-- 1. Archivo de personas borradas ---------------------------------------------------------------

create table if not exists public.equip_persones_arxiu (
  user_id      uuid primary key,
  email        text,
  nom          text,
  telefon      text,
  rol          text,
  alta_at      timestamptz,
  esborrat_at  timestamptz not null default now(),
  esborrat_per uuid,
  esborrat_per_email text
);

comment on table public.equip_persones_arxiu is
  'Identidad de cada cuenta del equipo borrada (nombre, correo, teléfono, rol), guardada por el trigger BEFORE DELETE de auth.users. Sin FK a propósito: es lo que queda cuando la cuenta ya no existe. Solo la escribe el trigger; lectura: super_admin.';

alter table public.equip_persones_arxiu enable row level security;
revoke all on public.equip_persones_arxiu from anon;
revoke insert, update, delete, truncate on public.equip_persones_arxiu from authenticated;
grant select on public.equip_persones_arxiu to authenticated;
drop policy if exists equip_persones_arxiu_llegir on public.equip_persones_arxiu;
create policy equip_persones_arxiu_llegir on public.equip_persones_arxiu
  for select to authenticated
  using ((select public.es_super_admin()));

create or replace function public.trg_equip_arxiva_persona()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text;
begin
  select r.rol into v_rol from public.usuario_roles r where r.user_id = old.id
   order by case r.rol when 'super_admin' then 1 when 'admin' then 2 else 3 end limit 1;
  if v_rol is null then
    return old;  -- solo las cuentas del equipo: las de las organizaciones tienen su propio circuito
  end if;
  insert into public.equip_persones_arxiu (user_id, email, nom, telefon, rol, alta_at, esborrat_per, esborrat_per_email)
  select old.id, old.email::text, p.nombre, p.telefono, v_rol, old.created_at,
         auth.uid(), (select pe.email from public.perfiles pe where pe.id = auth.uid())
    from (select 1) x left join public.perfiles p on p.id = old.id
  on conflict (user_id) do update
     set email = excluded.email, nom = excluded.nom, telefon = excluded.telefon, rol = excluded.rol,
         esborrat_at = now(), esborrat_per = excluded.esborrat_per, esborrat_per_email = excluded.esborrat_per_email;
  return old;
end;
$$;
revoke execute on function public.trg_equip_arxiva_persona() from public, anon, authenticated;

drop trigger if exists equip_arxiva_persona on auth.users;
create trigger equip_arxiva_persona
  before delete on auth.users
  for each row execute function public.trg_equip_arxiva_persona();

-- 2. Nombres en los apuntes --------------------------------------------------------------------

alter table public.equip_rols_hist
  add column if not exists nom text,
  add column if not exists per_nom text;
alter table public.equip_traspassos
  add column if not exists origen_nom text,
  add column if not exists desti_nom text,
  add column if not exists per_nom text;

comment on column public.equip_rols_hist.nom is 'Nombre de la cuenta afectada en el momento del apunte (sobrevive a su borrado).';
comment on column public.equip_traspassos.origen_nom is 'Nombre de quien hizo originalmente las acciones, en el momento del traspaso (sobrevive a su borrado).';

create or replace function public.trg_equip_noms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'equip_rols_hist' then
    new.nom := coalesce(new.nom, (select p.nombre from public.perfiles p where p.id = new.user_id));
    new.per_nom := coalesce(new.per_nom, (select p.nombre from public.perfiles p where p.id = new.per));
  else
    new.origen_nom := coalesce(new.origen_nom, (select p.nombre from public.perfiles p where p.id = new.origen_id));
    new.desti_nom := coalesce(new.desti_nom, (select p.nombre from public.perfiles p where p.id = new.desti_id));
    new.per_nom := coalesce(new.per_nom, (select p.nombre from public.perfiles p where p.id = new.per));
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_equip_noms() from public, anon, authenticated;

drop trigger if exists equip_rols_hist_noms on public.equip_rols_hist;
create trigger equip_rols_hist_noms before insert on public.equip_rols_hist
  for each row execute function public.trg_equip_noms();
drop trigger if exists equip_traspassos_noms on public.equip_traspassos;
create trigger equip_traspassos_noms before insert on public.equip_traspassos
  for each row execute function public.trg_equip_noms();

-- Lo anterior: con lo que aún haya en perfiles (lo de una cuenta ya borrada queda solo con correo).
update public.equip_rols_hist h set nom = p.nombre from public.perfiles p where p.id = h.user_id and h.nom is null;
update public.equip_rols_hist h set per_nom = p.nombre from public.perfiles p where p.id = h.per and h.per_nom is null;
update public.equip_traspassos t set origen_nom = p.nombre from public.perfiles p where p.id = t.origen_id and t.origen_nom is null;
update public.equip_traspassos t set desti_nom = p.nombre from public.perfiles p where p.id = t.desti_id and t.desti_nom is null;
update public.equip_traspassos t set per_nom = p.nombre from public.perfiles p where p.id = t.per and t.per_nom is null;

-- 3. La auditoría completa ----------------------------------------------------------------------

create or replace function public.equip_auditoria(p_user uuid default null, p_limit int default 200)
returns table (
  at          timestamptz,
  accio       text,
  user_id     uuid,
  email       text,
  nom         text,
  esborrat    boolean,
  rol_abans   text,
  rol_despres text,
  desti_email text,
  desti_nom   text,
  total       int,
  detall      jsonb,
  per_email   text,
  per_nom     text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin veu l''auditoria de l''equip.' using errcode = '42501';
  end if;
  return query
  with apunts as (
    -- Cambios de rol, altas y bajas, ediciones, borrados (y los traspasos sueltos, que se
    -- describen mejor desde `equip_traspassos`: se omiten aquí para no contarlos dos veces).
    select h.at, h.accio, h.user_id, h.email, h.nom, h.rol_abans, h.rol_despres,
           null::text as desti_email, null::text as desti_nom,
           nullif(coalesce(h.detall ->> 'traspassades', h.detall ->> 'total'), '')::int as total,
           h.detall, h.per_email, h.per_nom
      from public.equip_rols_hist h
     where h.accio <> 'traspas'
    union all
    select t.at, 'mou_accions', t.origen_id, t.origen_email, t.origen_nom, null, null,
           t.desti_email, t.desti_nom, t.total, t.detall || jsonb_build_object('motiu', t.motiu),
           t.per_email, t.per_nom
      from public.equip_traspassos t
  )
  select a.at, a.accio, a.user_id, a.email,
         coalesce(a.nom, pf.nombre, ar.nom),
         (u.id is null) as esborrat,
         a.rol_abans, a.rol_despres, a.desti_email, a.desti_nom, a.total, a.detall,
         a.per_email, a.per_nom
    from apunts a
    left join auth.users u on u.id = a.user_id
    left join public.perfiles pf on pf.id = a.user_id
    left join public.equip_persones_arxiu ar on ar.user_id = a.user_id
   where p_user is null or a.user_id = p_user
   order by a.at desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;
revoke execute on function public.equip_auditoria(uuid, int) from public, anon;
grant execute on function public.equip_auditoria(uuid, int) to authenticated;

comment on function public.equip_auditoria(uuid, int) is
  'Auditoría del equipo, de lo más reciente a lo más antiguo: cambios de rol, activar/desactivar, editar, borrar y cada traspaso de acciones (`mou_accions`, con origen, destino y recuento), con fecha y quién lo hizo, con nombre y correo, aunque la cuenta ya esté borrada (`esborrat`). `p_user` filtra por la cuenta afectada. Solo super_admin (42501).';

-- 4. La cadena de una fila, con nombres ---------------------------------------------------------

drop function if exists public.equip_autoria_fila(text, text);
create function public.equip_autoria_fila(p_taula text, p_id text)
returns table (at timestamptz, columna text, origen_email text, origen_nom text, desti_email text, desti_nom text,
               motiu text, per_email text, per_nom text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin consulta l''autoria original.' using errcode = '42501';
  end if;
  return query
    select tr.at, f.columna, tr.origen_email, tr.origen_nom, tr.desti_email, tr.desti_nom, tr.motiu, tr.per_email, tr.per_nom
      from public.equip_traspassos_files f
      join public.equip_traspassos tr on tr.id = f.traspas_id
     where f.taula = p_taula
       and (select count(*) from jsonb_object_keys(f.fila)) = 1
       and (select v from jsonb_each_text(f.fila) as e(k, v)) = p_id
     order by tr.at, f.columna;
end;
$$;
revoke execute on function public.equip_autoria_fila(text, text) from public, anon;
grant execute on function public.equip_autoria_fila(text, text) to authenticated;

comment on function public.equip_autoria_fila(text, text) is
  'La cadena de traspasos de autoría de una fila (tabla + valor de su clave primaria simple), del más antiguo al más reciente, con nombres y correos: el primer `origen_*` es quien la hizo. Solo super_admin (42501).';
