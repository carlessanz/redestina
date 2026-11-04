-- La ficha del equipo, Gestió interna (04-11-2026, Taula mestra 1.5): el CRM completo y el
-- estado global de la entidad.
--
-- 1.5 pide registrar cada interacción con «data, canal, tipus, responsable, resultat/comentari,
-- propera acció i data», conservar el historial y «mostrar darrera interacció i seguiments
-- pendents». 1F (20270502100000) dejó fuera la próxima acción y la cola de pendientes (D4);
-- Carles la pide ahora. Sobre la misma tabla `notes_internes`, sin otra:
--
--   1. `notes_internes` + `tipus`, `responsable`, `propera_accio`, `propera_data` y el cierre
--      del seguimiento (`seguiment_fet_at`, `seguiment_fet_per`). La nota sigue sin editarse:
--      lo único que cambia después es que su seguimiento se da por hecho.
--   2. `afegir_nota_interna()` con los cuatro argumentos nuevos, todos con valor por defecto:
--      la llamada de 1F (cuatro argumentos con nombre) sigue valiendo.
--   3. `tancar_seguiment()` (`es_intern()` con sesión): da por hecho el seguimiento de una nota.
--   4. `activar_organitzacio()` (`pot_aprovar()` con sesión): el «Activa l'entitat» global,
--      pareja de `desactivar_organitzacio()` (1A). Activa todas sus fichas en una transacción;
--      las reglas (NIF válido, razón social) las sigue poniendo el trigger `trg_fitxa_estat`.
--   5. `v_entitats_llistat` + `seguiments_pendents` y `propera_seguiment` (al final).
--
-- 🔴 Las notas internas, y con ellas los seguimientos, NUNCA salen por ningún canal (AGENTS §8).
--
-- Compatible hacia atrás: columnas nuevas con valor por defecto, la RPC acepta la llamada
-- vieja y la vista solo añade columnas al final.

-- ---------------------------------------------------------------------------
-- 1. Las columnas
-- ---------------------------------------------------------------------------
alter table public.notes_internes
  add column if not exists tipus             text not null default 'seguiment',
  add column if not exists responsable       uuid references auth.users(id) on delete set null,
  add column if not exists propera_accio     text,
  add column if not exists propera_data      date,
  add column if not exists seguiment_fet_at  timestamptz,
  add column if not exists seguiment_fet_per uuid references auth.users(id) on delete set null;
-- Las dos a `auth.users` y no a `perfiles` A PROPÓSITO: con tres FK a `perfiles`, el
-- `autor:perfiles(nombre)` de la pantalla de 1F pasaría a ser ambiguo (PGRST201) y la versión
-- publicada dejaría de cargar las notas entre la migración y el frontend nuevo. Como
-- `usuario_roles.user_id`; el nombre se busca en `perfiles` (mismo id).

alter table public.notes_internes drop constraint if exists notes_internes_tipus_check;
alter table public.notes_internes add constraint notes_internes_tipus_check
  check (tipus in ('seguiment', 'captacio', 'operativa', 'incidencia', 'documentacio', 'altres'));
alter table public.notes_internes drop constraint if exists notes_internes_propera_check;
-- Una próxima acción va siempre con su fecha, y una fecha sola no es nada.
alter table public.notes_internes add constraint notes_internes_propera_check
  check ((propera_accio is null) = (propera_data is null)
         and (propera_accio is null or char_length(btrim(propera_accio)) between 1 and 500));
alter table public.notes_internes drop constraint if exists notes_internes_fet_check;
alter table public.notes_internes add constraint notes_internes_fet_check
  check (seguiment_fet_at is null or propera_accio is not null);

-- Las notas de antes (1F) eran del autor: su responsable es quien las escribió.
update public.notes_internes set responsable = autor where responsable is null and autor is not null;

create index if not exists notes_internes_pendents on public.notes_internes (organizacion_id, propera_data)
  where propera_accio is not null and seguiment_fet_at is null;

comment on column public.notes_internes.tipus is 'Taula mestra 1.5: de qué va la interacción (seguiment, captacio, operativa, incidencia, documentacio, altres).';
comment on column public.notes_internes.responsable is 'Quién del equipo lleva el seguimiento (por defecto, el autor).';
comment on column public.notes_internes.propera_accio is 'La próxima acción acordada; siempre con `propera_data`. Pendiente mientras `seguiment_fet_at` sea null.';
comment on column public.notes_internes.seguiment_fet_at is 'Cuándo se dio por hecho el seguimiento (`tancar_seguiment()`). Lo único de una nota que cambia después de escrita.';

-- ---------------------------------------------------------------------------
-- 2. `afegir_nota_interna()` con los campos de 1.5
-- ---------------------------------------------------------------------------
-- Cambia el número de argumentos: drop + create (§4bis). Los nuevos llevan valor por defecto,
-- así que la llamada de 1F (p_org, p_canal, p_text[, p_data]) resuelve igual.
--
-- Errores nuevos (22023): `tipus_nota_desconegut`, `responsable_no_equip` (el responsable ha
-- de tener un rol del equipo), `propera_accio_sense_data` / `propera_data_sense_accio`,
-- `propera_accio_massa_llarga` (> 500).
drop function if exists public.afegir_nota_interna(uuid, text, text, timestamptz);
create function public.afegir_nota_interna(
  p_org           uuid,
  p_canal         text,
  p_text          text,
  p_data          timestamptz default now(),
  p_tipus         text default 'seguiment',
  p_responsable   uuid default null,
  p_propera_accio text default null,
  p_propera_data  date default null
) returns public.notes_internes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_text   text := btrim(coalesce(p_text, ''));
  v_accio  text := nullif(btrim(coalesce(p_propera_accio, '')), '');
  v_resp   uuid := coalesce(p_responsable, auth.uid());
  v_nota   notes_internes;
begin
  if auth.uid() is null or not public.es_intern() then
    raise exception 'Nomes l''equip escriu notes internes' using errcode = '42501';
  end if;
  if p_canal is null or p_canal not in ('telefon', 'whatsapp', 'email', 'visita', 'reunio', 'altres') then
    raise exception 'canal_nota_desconegut: %', p_canal using errcode = '22023';
  end if;
  if coalesce(p_tipus, 'seguiment') not in ('seguiment', 'captacio', 'operativa', 'incidencia', 'documentacio', 'altres') then
    raise exception 'tipus_nota_desconegut: %', p_tipus using errcode = '22023';
  end if;
  if v_text = '' then
    raise exception 'nota_buida: la nota no pot ser buida' using errcode = '22023';
  end if;
  if char_length(v_text) > 2000 then
    raise exception 'nota_massa_llarga: maxim 2.000 caracters' using errcode = '22023';
  end if;
  if p_data is not null and p_data > now() + interval '1 day' then
    raise exception 'nota_futura: la data del contacte no pot ser futura' using errcode = '22023';
  end if;
  if v_accio is not null and p_propera_data is null then
    raise exception 'propera_accio_sense_data' using errcode = '22023';
  end if;
  if v_accio is null and p_propera_data is not null then
    raise exception 'propera_data_sense_accio' using errcode = '22023';
  end if;
  if char_length(coalesce(v_accio, '')) > 500 then
    raise exception 'propera_accio_massa_llarga: maxim 500 caracters' using errcode = '22023';
  end if;
  if not exists (select 1 from usuario_roles where user_id = v_resp) then
    raise exception 'responsable_no_equip' using errcode = '22023';
  end if;
  if not exists (select 1 from organizaciones where id = p_org) then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;

  insert into notes_internes (organizacion_id, data, canal, autor, text, tipus, responsable, propera_accio, propera_data)
  values (p_org, coalesce(p_data, now()), p_canal, auth.uid(), v_text, coalesce(p_tipus, 'seguiment'), v_resp,
          v_accio, p_propera_data)
  returning * into v_nota;
  return v_nota;
end;
$$;

comment on function public.afegir_nota_interna(uuid, text, text, timestamptz, text, uuid, text, date) is
  'Plan 1, 1F + Taula mestra 1.5 (20270504100000). es_intern() con sesión: añade una interacción (fecha, canal, tipo, responsable del equipo, texto) y, si la hay, la próxima acción con su fecha.';

-- ---------------------------------------------------------------------------
-- 3. `tancar_seguiment()` — el equipo da por hecha una próxima acción
-- ---------------------------------------------------------------------------
-- Idempotente: cerrar uno ya cerrado no cambia ni la fecha ni quién lo cerró.
create or replace function public.tancar_seguiment(p_id uuid)
returns public.notes_internes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nota notes_internes;
begin
  if auth.uid() is null or not public.es_intern() then
    raise exception 'Nomes l''equip tanca seguiments' using errcode = '42501';
  end if;
  select * into v_nota from notes_internes where id = p_id for update;
  if not found then
    raise exception 'nota_inexistent' using errcode = '22023';
  end if;
  if v_nota.propera_accio is null then
    raise exception 'nota_sense_seguiment' using errcode = '22023';
  end if;
  if v_nota.seguiment_fet_at is null then
    update notes_internes set seguiment_fet_at = now(), seguiment_fet_per = auth.uid()
     where id = p_id
    returning * into v_nota;
  end if;
  return v_nota;
end;
$$;

comment on function public.tancar_seguiment(uuid) is
  'Taula mestra 1.5 (20270504100000). es_intern() con sesión: da por hecha la próxima acción de una nota interna (idempotente).';

revoke execute on function public.afegir_nota_interna(uuid, text, text, timestamptz, text, uuid, text, date) from public, anon, service_role;
revoke execute on function public.tancar_seguiment(uuid) from public, anon, service_role;
grant execute on function public.afegir_nota_interna(uuid, text, text, timestamptz, text, uuid, text, date) to authenticated;
grant execute on function public.tancar_seguiment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. `activar_organitzacio()` — «Activa l'entitat», todos sus papeles a la vez
-- ---------------------------------------------------------------------------
-- La pareja de `desactivar_organitzacio()` (1A, D7). Si a una ficha le falta el NIF válido o la
-- razón social, el trigger corta TODO (una transacción): o se activan todas o ninguna.
create or replace function public.activar_organitzacio(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p int;
  v_e int;
begin
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes l''equip pot activar una organitzacio' using errcode = '42501';
  end if;
  if not exists (select 1 from organizaciones where id = p_org) then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;
  update productores set activo = true where organizacion_id = p_org and not activo;
  get diagnostics v_p = row_count;
  update entidades set activo = true where organizacion_id = p_org and not activo;
  get diagnostics v_e = row_count;
  return jsonb_build_object('organizacion_id', p_org, 'productors', v_p, 'entitats', v_e);
end;
$$;

comment on function public.activar_organitzacio(uuid) is
  '20270504100000. pot_aprovar() con sesión: activa todas las fichas de una organización (las reglas, el trigger trg_fitxa_estat).';

revoke execute on function public.activar_organitzacio(uuid) from public, anon, service_role;
grant execute on function public.activar_organitzacio(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. `v_entitats_llistat` + seguimientos pendientes
-- ---------------------------------------------------------------------------
-- La de 1F con dos columnas AL FINAL. `security_invoker`: a un actor la subconsulta le da 0
-- (no ve `notes_internes`).
create or replace view public.v_entitats_llistat
with (security_invoker = true) as
  select v.id,
         v.nom_comercial,
         v.razon_social,
         v.nif,
         v.persona_contacte,
         v.email,
         v.telefono,
         v.poblacion,
         v.comarca,
         v.municipio_ine,
         v.productor_id,
         v.entidad_id,
         v.es_generadora,
         v.es_receptora,
         v.productor_activo,
         v.entidad_activo,
         v.activa,
         v.tipo_receptor,
         v.tipus_activitat,
         v.te_compte,
         v.compte_estat,
         v.canal_preferido,
         v.created_at,
         (coalesce(p.es_test, false) or coalesce(e.es_test, false)) as es_test,
         exists (select 1 from public.membresias m
                  where m.aprovacio = 'rebutjada'
                    and ((p.id is not null and m.productor_id = p.id) or (e.id is not null and m.entidad_id = e.id))) as rebutjada,
         coalesce(e.modalitats_interes, '{}'::text[]) as modalitats_interes,
         e.prioritat,
         (p.id is not null and exists (select 1 from public.convenios c
                                        where c.estado = 'vigent' and c.productor_id = p.id)) as conveni_productor,
         (e.id is not null and exists (select 1 from public.convenios c
                                        where c.estado = 'vigent' and c.entidad_id = e.id)) as conveni_entitat,
         greatest(
           (select max(x.created_at) from public.excedentes x where p.id is not null and x.productor_id = p.id),
           (select max(r.created_at) from public.oferta_respuestas r where e.id is not null and r.entidad_id = e.id),
           (select max(c.created_at) from public.canalizaciones c where e.id is not null and c.entidad_id = e.id)
         ) as darrera_activitat,
         dc.data  as darrer_contacte_at,
         dc.canal as darrer_contacte_canal,
         coalesce(sp.n, 0)::int as seguiments_pendents,
         sp.propera as propera_seguiment
    from public.v_organizaciones v
    left join public.productores p on p.id = v.productor_id
    left join public.entidades   e on e.id = v.entidad_id
    left join lateral (
      select n.data, n.canal
        from public.notes_internes n
       where n.organizacion_id = v.id
       order by n.data desc, n.created_at desc
       limit 1
    ) dc on true
    left join lateral (
      select count(*) as n, min(n.propera_data) as propera
        from public.notes_internes n
       where n.organizacion_id = v.id
         and n.propera_accio is not null
         and n.seguiment_fet_at is null
    ) sp on true
   where v.productor_id is not null or v.entidad_id is not null;

comment on view public.v_entitats_llistat is
  'El listado «Entitats» del equipo (1C, 20270501200000; 1F, 20270502100000; 1.5, 20270504100000): una fila por organización, con rol, estado, cuenta, convenio por papel, última actividad, último contacto y seguimientos pendientes (cuántos y la fecha más próxima). `security_invoker`.';

revoke all on public.v_entitats_llistat from anon;
grant select on public.v_entitats_llistat to authenticated, service_role;
