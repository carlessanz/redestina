-- Traspaso de acciones del equipo: rastro FILA A FILA del autor original (09-11-2026).
--
-- Hasta ahora `equip_moure_accions()` movía las columnas de autoría de una cuenta a otra y apuntaba
-- en `equip_traspassos` solo los recuentos por tabla. Tras el traspaso, «esta firma asistida la
-- condujo X» se perdía: la fila decía el destino y nada más.
--
-- Por qué importa poco y por qué se guarda igual: la autoría de las cuentas del equipo NO tiene
-- efectos fiscales (los documentos salen a nombre de la Fundació —apoderada, firma y sello de
-- `parametros_documentales`— o de la contraparte; el 182 no mira usuarios; ningún PDF imprime al
-- gestor). Pero algunas filas son EVIDENCIA de un acto (`evidencias.asistido_por`: quién estaba
-- en una firma asistida) y conviene poder decir quién fue de verdad.
--
-- Qué cambia:
--   · tabla nueva `equip_traspassos_files`: una fila por fila movida (tabla, columna, clave
--     primaria en jsonb), colgando de su `equip_traspassos`. El autor original es el `origen_*`
--     del traspaso; si una fila se traspasa dos veces, la cadena se lee por `at`.
--   · `equip_moure_accions()` (interna) la rellena en la misma sentencia que mueve (CTE con
--     `returning`), así que no hay ventana entre mover y apuntar.
--   · `equip_autoria_fila(taula, id)`: la cadena de autores de una fila (solo super_admin).
--
-- Compatible hacia atrás: misma firma de `equip_moure_accions()` y mismo resultado.

-- 1. La tabla -------------------------------------------------------------------------------

create table if not exists public.equip_traspassos_files (
  traspas_id uuid not null references public.equip_traspassos (id) on delete cascade,
  taula      text not null,
  columna    text not null,
  fila       jsonb not null,
  primary key (traspas_id, taula, columna, fila)
);
create index if not exists equip_traspassos_files_fila on public.equip_traspassos_files (taula, fila);

comment on table public.equip_traspassos_files is
  'Rastro por fila de cada traspaso de acciones del equipo: qué fila (`fila` = su clave primaria en jsonb) de qué tabla y columna se movió en el traspaso `traspas_id`, cuyo `origen_*` es el autor original. Solo inserción, por `equip_moure_accions()`. Lectura: super_admin.';

alter table public.equip_traspassos_files enable row level security;
revoke all on public.equip_traspassos_files from anon;
revoke insert, update, delete, truncate on public.equip_traspassos_files from authenticated;
grant select on public.equip_traspassos_files to authenticated;
drop policy if exists equip_traspassos_files_llegir on public.equip_traspassos_files;
create policy equip_traspassos_files_llegir on public.equip_traspassos_files
  for select to authenticated
  using ((select public.es_super_admin()));

-- 2. Mover y apuntar en la misma sentencia ---------------------------------------------------

create or replace function public.equip_moure_accions(p_origen uuid, p_desti uuid, p_motiu text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  n       bigint;
  v_pk    text;
  v_id    uuid;
  v_det   jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_oe    text;
  v_de    text;
  v_pe    text;
begin
  select u.email::text into v_oe from auth.users u where u.id = p_origen;
  select u.email::text into v_de from auth.users u where u.id = p_desti;
  select pe.email into v_pe from public.perfiles pe where pe.id = auth.uid();

  -- El traspaso existe antes que sus filas (FK); el total y el detalle se completan al final.
  insert into public.equip_traspassos (origen_id, origen_email, desti_id, desti_email, motiu, total, detall, per, per_email)
  values (p_origen, v_oe, p_desti, v_de, p_motiu, 0, '[]'::jsonb, auth.uid(), v_pe)
  returning id into v_id;

  -- La marca que dejan pasar los triggers de inmutabilidad (20270514100000 §2): solo mientras dura esto.
  perform set_config('redestina.traspas_autoria', 'on', true);
  for r in select * from public.equip_columnes_autoria() order by 1, 2 loop
    -- La clave primaria de la tabla, como `jsonb_build_object('col', t.col, …)`.
    select string_agg(format('%L, t.%I', a.attname, a.attname), ', ' order by k.ord)
      into v_pk
      from pg_index i
      cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
     where i.indrelid = format('public.%I', r.taula)::regclass and i.indisprimary;
    if v_pk is null then
      raise exception 'equip_moure_accions: la taula % no té clau primària', r.taula using errcode = '55000';
    end if;

    execute format(
      'with m as (update public.%I t set %I = $1 where t.%I = $2 returning jsonb_build_object(%s) as fila)
       insert into public.equip_traspassos_files (traspas_id, taula, columna, fila)
       select $3, %L, %L, m.fila from m',
      r.taula, r.columna, r.columna, v_pk, r.taula, r.columna)
      using p_desti, p_origen, v_id;
    get diagnostics n = row_count;
    if n > 0 then
      v_det := v_det || jsonb_build_object('taula', r.taula, 'columna', r.columna, 'n', n);
      v_total := v_total + n;
    end if;
  end loop;
  perform set_config('redestina.traspas_autoria', 'off', true);

  update public.equip_traspassos set total = v_total, detall = v_det where id = v_id;

  return jsonb_build_object('total', v_total, 'detall', v_det, 'traspas_id', v_id);
end;
$$;
revoke execute on function public.equip_moure_accions(uuid, uuid, text) from public, anon, authenticated;

comment on function public.equip_moure_accions(uuid, uuid, text) is
  'INTERNA: mueve todas las columnas de autoría de una cuenta a otra con la marca de traspaso puesta, y lo registra en equip_traspassos (recuentos) y equip_traspassos_files (fila a fila, con el autor original). Sin EXECUTE para sesiones; la llaman las RPC `equip_*` ya autorizadas.';

-- 3. Quién hizo de verdad una fila ------------------------------------------------------------

create or replace function public.equip_autoria_fila(p_taula text, p_id text)
returns table (at timestamptz, columna text, origen_email text, desti_email text, motiu text, per_email text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin consulta l''autoria original.' using errcode = '42501';
  end if;
  -- `p_id`: el valor de la clave primaria cuando es de una sola columna (lo normal: `id`).
  return query
    select tr.at, f.columna, tr.origen_email, tr.desti_email, tr.motiu, tr.per_email
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
  'La cadena de traspasos de autoría de una fila (tabla + valor de su clave primaria simple), del más antiguo al más reciente: el primer `origen_email` es quien lo hizo. Solo super_admin (42501).';
