-- Plan 1, rebanada 1F: CRM mínimo, notas internas (D4).
--
-- Un hilo cronológico por organización —fecha, canal, quién y qué— que SOLO ve el equipo: las
-- llamadas, visitas y mensajes que el equipo de dinamización tiene con cada entidad. Sin
-- «próxima acción» ni cola de pendientes (D4).
--
--   1. `notes_internes`: solo se añaden filas. No hay UPDATE para nadie (una nota no se
--      corrige: se escribe otra) y borrar es del super_admin, por RPC.
--   2. RLS: lectura `es_intern()`; escritura SOLO por RPC. Un externo que pregunta recibe
--      0 filas, sin error: no puede saber ni que la tabla tiene algo suyo.
--   3. `afegir_nota_interna()` (`es_intern()` con sesión) y `esborrar_nota_interna()`
--      (`es_super_admin()`).
--   4. `v_entitats_llistat` suma `darrer_contacte_at` y `darrer_contacte_canal` (la nota más
--      reciente) para la columna «Darrer contacte» del listado.
--
-- 🔴 Las notas internas NUNCA salen por ningún canal (AGENTS §8): ni correo, ni WhatsApp, ni
--    documento, ni la ficha del actor. Ninguna Edge Function ni plantilla las lee.
--
-- Compatible hacia atrás: tabla y funciones nuevas; la vista solo añade columnas al final.

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
-- `on delete cascade` a la organización: cuando `borrar_ficha_completa()` retira una
-- organización vacía, sus notas se van con ella (§7: nunca huérfanos). El autor, `set null`:
-- una nota no desaparece porque se borre la cuenta de quien la escribió.
create table if not exists public.notes_internes (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  data            timestamptz not null default now(),
  canal           text not null check (canal in ('telefon', 'whatsapp', 'email', 'visita', 'reunio', 'altres')),
  autor           uuid references public.perfiles(id) on delete set null,
  text            text not null check (char_length(btrim(text)) between 1 and 2000),
  created_at      timestamptz not null default now()
);
create index if not exists notes_internes_org_data on public.notes_internes (organizacion_id, data desc, created_at desc);

comment on table public.notes_internes is
  'Plan 1, 1F (D4): notas internas del equipo sobre una organización (fecha, canal, autor, texto). Solo inserción por `afegir_nota_interna()`; borrar, `esborrar_nota_interna()` (super_admin). Lectura: equipo. Nunca salen por ningún canal.';

-- Dos capas (§4): `anon` nada; `authenticated` SELECT y nada más, y la política deja leer
-- solo al equipo. Sin GRANT de escritura: hasta el equipo pasa por la RPC.
alter table public.notes_internes enable row level security;
revoke all on public.notes_internes from anon;
revoke all on public.notes_internes from authenticated;
grant select on public.notes_internes to authenticated;
grant all on public.notes_internes to service_role;
drop policy if exists notes_internes_llegir on public.notes_internes;
create policy notes_internes_llegir on public.notes_internes
  for select to authenticated
  using ((select public.es_intern()));

-- ---------------------------------------------------------------------------
-- 2. `afegir_nota_interna()` — el equipo, con sesión
-- ---------------------------------------------------------------------------
-- El autor es siempre quien llama (`auth.uid()`): no se puede firmar una nota en nombre de
-- otro. `p_data` es cuándo fue el contacto (por defecto, ahora); no se admite una fecha de
-- más allá de mañana (un margen por la zona horaria del navegador).
--
-- Errores (22023 con el código en el mensaje): `canal_nota_desconegut`, `nota_buida`,
-- `nota_massa_llarga` (> 2.000), `nota_futura`, `organitzacio_inexistent`. El permiso se
-- comprueba ANTES que la existencia (§4bis).
create or replace function public.afegir_nota_interna(
  p_org   uuid,
  p_canal text,
  p_text  text,
  p_data  timestamptz default now()
) returns public.notes_internes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_text text := btrim(coalesce(p_text, ''));
  v_nota notes_internes;
begin
  if auth.uid() is null or not public.es_intern() then
    raise exception 'Nomes l''equip escriu notes internes' using errcode = '42501';
  end if;
  if p_canal is null or p_canal not in ('telefon', 'whatsapp', 'email', 'visita', 'reunio', 'altres') then
    raise exception 'canal_nota_desconegut: %', p_canal using errcode = '22023';
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
  if not exists (select 1 from organizaciones where id = p_org) then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;

  insert into notes_internes (organizacion_id, data, canal, autor, text)
  values (p_org, coalesce(p_data, now()), p_canal, auth.uid(), v_text)
  returning * into v_nota;
  return v_nota;
end;
$$;

comment on function public.afegir_nota_interna(uuid, text, text, timestamptz) is
  'Plan 1, 1F. es_intern() con sesión: añade una nota interna a una organización; el autor es auth.uid(); texto de 1 a 2.000 caracteres.';

-- ---------------------------------------------------------------------------
-- 3. `esborrar_nota_interna()` — solo el super_admin
-- ---------------------------------------------------------------------------
create or replace function public.esborrar_nota_interna(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.es_super_admin() then
    raise exception 'Nomes el super_admin esborra notes internes' using errcode = '42501';
  end if;
  delete from notes_internes where id = p_id;
  if not found then
    raise exception 'nota_inexistent' using errcode = '22023';
  end if;
end;
$$;

comment on function public.esborrar_nota_interna(uuid) is
  'Plan 1, 1F. es_super_admin(): borra una nota interna (las notas no se editan).';

revoke execute on function public.afegir_nota_interna(uuid, text, text, timestamptz) from public, anon, service_role;
revoke execute on function public.esborrar_nota_interna(uuid) from public, anon, service_role;
grant execute on function public.afegir_nota_interna(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.esborrar_nota_interna(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. `v_entitats_llistat` + último contacto
-- ---------------------------------------------------------------------------
-- La misma vista de 1C (20270501200000) con dos columnas AL FINAL (`create or replace view`
-- no admite otra cosa). Sigue `security_invoker`: la subconsulta lee `notes_internes` con la
-- RLS de quien consulta, así que a un actor le sale null —no sabe ni que hay notas—.
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
         dc.canal as darrer_contacte_canal
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
   -- Una organización sin ninguna ficha (un resto de un borrado parcial) no es una entidad.
   where v.productor_id is not null or v.entidad_id is not null;

comment on view public.v_entitats_llistat is
  'El listado «Entitats» del equipo (1C, 20270501200000; 1F, 20270502100000): una fila por organización, con rol, estado, cuenta, convenio por papel, última actividad y último contacto (nota interna más reciente). `security_invoker`.';

revoke all on public.v_entitats_llistat from anon;
grant select on public.v_entitats_llistat to authenticated, service_role;
