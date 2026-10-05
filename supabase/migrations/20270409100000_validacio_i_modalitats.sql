-- Rebanada 1 de la reunión de seguimiento del 05-10-2026 (plan de ejecución en
-- `3. Claude Code/2026-10-05-plan-ejecucion-reunion-seguimiento.md`):
--
--   1. «Pendent de validació»: una oferta nueva no sale al Mercat hasta que el equipo la
--      valida. Interruptor en `app_settings.validacio_ofertes` (encendido de fábrica).
--   2. Modalidad MÚLTIPLE: el productor marca donació, venda y/o maquila; la definitiva de
--      cada entrega la elige quien la recibe y la confirma el equipo (decisión D2).
--   3. La FRANJA de recogida: dos horas en vez de texto libre.
--
-- Todo es AÑADIR (§11): `modalitat` y `horari_recollida` se quedan y se siguen escribiendo,
-- porque el frontend de antes se sigue sirviendo mientras se publica y hay consumidores que
-- todavía leen una sola modalidad.

-- ---------------------------------------------------------------------------
-- 1. Columnas y estado
-- ---------------------------------------------------------------------------
alter table excedentes drop constraint if exists excedentes_estado_check;
alter table excedentes add constraint excedentes_estado_check
  check (estado in (
    'borrador', 'pendent_validacio', 'publicada', 'parcial', 'bloqueada', 'cerrada',
    'no_colocada', 'cancelada'
  ));

alter table excedentes
  add column if not exists modalitats text[],
  add column if not exists hora_recollida_inici time,
  add column if not exists hora_recollida_fi time,
  add column if not exists validada_at timestamptz,
  add column if not exists validada_per uuid references auth.users(id) on delete set null;

alter table excedentes drop constraint if exists excedentes_modalitats_check;
alter table excedentes add constraint excedentes_modalitats_check
  check (modalitats is null
         or (cardinality(modalitats) > 0
             and modalitats <@ array['donacio', 'venda', 'maquila']::text[]));

alter table excedentes drop constraint if exists excedentes_franja_check;
alter table excedentes add constraint excedentes_franja_check
  check ((hora_recollida_inici is null and hora_recollida_fi is null)
         or (hora_recollida_inici is not null and hora_recollida_fi is not null
             and hora_recollida_fi > hora_recollida_inici));

comment on column excedentes.modalitats is
  'Las modalidades en que se ofrece (donacio/venda/maquila), en orden canónico. `modalitat` guarda la primera, la principal. La de cada entrega va en canalizaciones.valorizacion.';
comment on column excedentes.hora_recollida_inici is
  'Inicio de la franja de recogida que da el productor. Quien recoge elige la hora dentro de ella.';

update excedentes set modalitats = array[modalitat]
 where modalitats is null and modalitat is not null;

create index if not exists excedentes_modalitats_gin on excedentes using gin (modalitats);

alter table oferta_respuestas
  add column if not exists modalitat text
    check (modalitat is null or modalitat in ('donacio', 'venda', 'maquila'));
comment on column oferta_respuestas.modalitat is
  'La modalidad que pide quien muestra interés (05-10-2026). La confirma o cambia el equipo al aprobar.';

-- ---------------------------------------------------------------------------
-- 2. `modalitat` y `modalitats` dicen siempre lo mismo
-- ---------------------------------------------------------------------------
-- Las ofertas entran por cuatro caminos (panel, WhatsApp, espigolada, fixtures) y no todos
-- conocen la columna nueva. Este trigger es lo que garantiza que las dos coinciden: si llega
-- solo `modalitat`, la lista es esa; si llega la lista, `modalitat` es su primera en orden
-- canónico (la donación, si está: es la línea core del servicio).
create or replace function trg_excedentes_modalitats()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.modalitat is distinct from old.modalitat
     and new.modalitats is not distinct from old.modalitats then
    -- Alguien cambió la modalidad «a la antigua»: la lista la sigue.
    new.modalitats := case when new.modalitat is null then null else array[new.modalitat] end;
  end if;

  if new.modalitats is null or cardinality(new.modalitats) = 0 then
    new.modalitats := case when new.modalitat is null then null else array[new.modalitat] end;
  else
    new.modalitats := array(
      select m from unnest(array['donacio', 'venda', 'maquila']) with ordinality as o(m, i)
       where m = any(new.modalitats) order by i
    );
    new.modalitat := new.modalitats[1];
  end if;
  return new;
end;
$$;

drop trigger if exists excedentes_modalitats on excedentes;
create trigger excedentes_modalitats
  before insert or update of modalitat, modalitats on excedentes
  for each row execute function trg_excedentes_modalitats();

-- ---------------------------------------------------------------------------
-- 3. La validación previa
-- ---------------------------------------------------------------------------
insert into app_settings (key, value) values ('validacio_ofertes', 'true')
on conflict (key) do nothing;

-- Fail-safe hacia VALIDAR: si la fila falta o no se puede leer, la oferta espera. Publicar
-- algo que nadie ha mirado es peor que hacer esperar una hora a una que estaba bien.
create or replace function public.validacio_ofertes_activa()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select value from app_settings where key = 'validacio_ofertes') <> 'false', true);
$$;
revoke execute on function public.validacio_ofertes_activa() from public, anon;
grant  execute on function public.validacio_ofertes_activa() to authenticated, service_role;

-- La regla vive AQUÍ y no en `crearExcedente()`: las ofertas del productor entran por el
-- panel (`crear-oferta`) y por WhatsApp (`intake`), y las dos escriben `publicada`. Las del
-- equipo (`asistido`) y las de una espigolada no esperan: ya las ha mirado alguien del equipo.
create or replace function trg_excedentes_validacio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.estado = 'publicada'
     and coalesce(new.origen, 'intake') in ('intake', 'panel')
     and public.validacio_ofertes_activa() then
    new.estado := 'pendent_validacio';
  end if;
  return new;
end;
$$;

drop trigger if exists excedentes_validacio on excedentes;
create trigger excedentes_validacio
  before insert on excedentes
  for each row execute function trg_excedentes_validacio();

create or replace function public.validar_oferta(p_id uuid)
returns excedentes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ex excedentes;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden validar una oferta' using errcode = '42501';
  end if;
  select * into ex from excedentes where id = p_id for update;
  if ex.id is null or ex.estado <> 'pendent_validacio' then
    raise exception 'Aquesta oferta no esta pendent de validacio (estat %)',
      coalesce(ex.estado, 'inexistent') using errcode = '22023';
  end if;
  update excedentes
     set estado = 'publicada', validada_at = now(), validada_per = auth.uid()
   where id = ex.id
  returning * into ex;
  return ex;
end;
$$;

create or replace function public.rebutjar_oferta(p_id uuid, p_motiu text)
returns excedentes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ex excedentes;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden rebutjar una oferta' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motiu), '') = '' then
    raise exception 'Rebutjar una oferta necessita motiu' using errcode = '22023';
  end if;
  select * into ex from excedentes where id = p_id for update;
  if ex.id is null or ex.estado <> 'pendent_validacio' then
    raise exception 'Aquesta oferta no esta pendent de validacio (estat %)',
      coalesce(ex.estado, 'inexistent') using errcode = '22023';
  end if;
  update excedentes
     set estado = 'cancelada', motivo_no_colocada = p_motiu,
         validada_at = now(), validada_per = auth.uid()
   where id = ex.id
  returning * into ex;
  return ex;
end;
$$;

revoke execute on function public.validar_oferta(uuid) from public, anon;
grant  execute on function public.validar_oferta(uuid) to authenticated, service_role;
revoke execute on function public.rebutjar_oferta(uuid, text) from public, anon;
grant  execute on function public.rebutjar_oferta(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. RLS: el receptor ve las ofertas que se le pueden ofrecer en ALGUNA de sus modalidades
-- ---------------------------------------------------------------------------
-- Mismo molde sin correlación que `20270304100400`; cambia `modalitat in (…)` por un
-- solapamiento de listas. `pendent_validacio` no entra en la rama del receptor porque esa
-- rama solo admite `publicada`/`parcial`: es lo que hace invisible una oferta sin validar.
drop policy if exists "excedentes: lectura per rol" on excedentes;
create policy "excedentes: lectura per rol"
  on excedentes for select to authenticated
  using (
       (select public.es_intern())
    or productor_id in (select public.mis_productores())
    or (estado in ('publicada', 'parcial')
        and modalitats && array(select public.modalitats_compatibles_meves()))
    or id in (select public.excedents_amb_interes_meu())
    or id in (select public.excedents_de_les_meves_canalitzacions())
  );

-- ---------------------------------------------------------------------------
-- 5. El interés lleva su modalidad
-- ---------------------------------------------------------------------------
-- Firma nueva (p_modalitat), así que hay que retirar la de cinco argumentos: si no,
-- convivirían dos y cualquier llamada de cinco sería ambigua (42725). Con el default a null,
-- una llamada de cinco del frontend anterior resuelve a esta.
drop function if exists public.manifestar_interes(uuid, uuid, numeric, numeric, integer);

create or replace function public.manifestar_interes(
  p_excedente uuid, p_entidad uuid, p_kg numeric,
  p_preu numeric default null, p_caixes integer default null,
  p_modalitat text default null
)
returns oferta_respuestas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex     excedentes;
  fila   oferta_respuestas;
  tel    text;
  v_mods text[];
  v_cand text[];
  v_mod  text;
begin
  if p_entidad not in (select public.mis_entidades()) then
    raise exception 'No pertanys a aquesta entitat' using errcode = '42501';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null or ex.estado not in ('publicada', 'parcial') then
    raise exception 'Aquesta oferta ja no esta disponible' using errcode = '22023';
  end if;

  -- Las modalidades de la oferta que ESTA entidad puede recibir.
  v_mods := coalesce(ex.modalitats, array[ex.modalitat]);
  select coalesce(array_agg(c.modalitat), '{}') into v_cand
    from entidades e
    join modalitat_receptor_compat c on c.tipo_receptor = e.tipo_receptor
   where e.id = p_entidad and c.modalitat = any(v_mods);

  if cardinality(v_cand) = 0 then
    raise exception 'Aquesta oferta no encaixa amb el tipus de receptor' using errcode = '22023';
  end if;
  if p_modalitat is not null then
    if not (p_modalitat = any(v_cand)) then
      raise exception 'Aquesta oferta no encaixa amb el tipus de receptor' using errcode = '22023';
    end if;
    v_mod := p_modalitat;
  elsif cardinality(v_cand) = 1 then
    v_mod := v_cand[1];
  else
    raise exception 'cal_modalitat: tria com vols rebre-la' using errcode = '22023';
  end if;

  perform public.exigir_convenio('entidad', p_entidad, v_mod, 'recibe');

  if p_kg is null or p_kg <= 0 then
    raise exception 'Cal indicar quants kg' using errcode = '22023';
  end if;

  if ex.kg_total is not null and p_kg > ex.kg_total then
    raise exception 'kg_maxim: com a maxim % kg', ex.kg_total using errcode = '22023';
  end if;

  if v_mod in ('venda', 'maquila') and ex.preu_minim is not null
     and (p_preu is null or p_preu < ex.preu_minim) then
    raise exception 'El preu ha de ser com a minim % EUR/kg', ex.preu_minim using errcode = '22023';
  end if;

  select telefono into tel from entidades where id = p_entidad;

  insert into oferta_respuestas (
    excedente_id, entidad_id, telefono, canal, estado,
    kg_solicitados, caixes_solicitades, preu_ofert, respondido_at, modalitat
  ) values (
    p_excedente, p_entidad, tel, 'panel', 'acceptada',
    p_kg, p_caixes, case when v_mod = 'donacio' then null else p_preu end, now(), v_mod
  )
  on conflict (excedente_id, entidad_id) do update
     set estado             = 'acceptada',
         canal              = 'panel',
         kg_solicitados     = excluded.kg_solicitados,
         caixes_solicitades = excluded.caixes_solicitades,
         preu_ofert         = excluded.preu_ofert,
         modalitat          = excluded.modalitat,
         respondido_at      = now()
   where oferta_respuestas.aprovacio = 'pendent'   -- lo ya resuelto no se toca
  returning * into fila;

  if fila.id is null then
    raise exception 'Aquesta resposta ja esta resolta' using errcode = '22023';
  end if;
  return fila;
end;
$$;
revoke execute on function public.manifestar_interes(uuid, uuid, numeric, numeric, integer, text) from public, anon;
grant  execute on function public.manifestar_interes(uuid, uuid, numeric, numeric, integer, text) to authenticated, service_role;

-- La versión del equipo, con el mismo cambio. Sin `exigir_convenio`, como antes: el equipo
-- resuelve el convenio en la fase 4 del ciclo guiado, con la persona delante (§6ter). Y si
-- la entidad puede recibirla de varias maneras y nadie lo ha dicho, se deja sin modalidad:
-- la decide quien aprueba.
drop function if exists public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, integer);

create or replace function public.manifestar_interes_assistit(
  p_excedente uuid, p_entidad uuid, p_kg numeric,
  p_preu numeric default null, p_caixes integer default null,
  p_modalitat text default null
)
returns oferta_respuestas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex     excedentes;
  fila   oferta_respuestas;
  tel    text;
  v_mods text[];
  v_cand text[];
  v_mod  text;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot registrar un interes assistit' using errcode = '42501';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null or ex.estado not in ('publicada', 'parcial') then
    raise exception 'Aquesta oferta ja no esta disponible' using errcode = '22023';
  end if;

  v_mods := coalesce(ex.modalitats, array[ex.modalitat]);
  select coalesce(array_agg(c.modalitat), '{}') into v_cand
    from entidades e
    join modalitat_receptor_compat c on c.tipo_receptor = e.tipo_receptor
   where e.id = p_entidad and c.modalitat = any(v_mods);

  if cardinality(v_cand) = 0
     or (p_modalitat is not null and not (p_modalitat = any(v_cand))) then
    raise exception 'Aquesta oferta no encaixa amb el tipus de receptor' using errcode = '22023';
  end if;
  v_mod := coalesce(p_modalitat, case when cardinality(v_cand) = 1 then v_cand[1] end);

  if p_kg is null or p_kg <= 0 then
    raise exception 'Cal indicar quants kg' using errcode = '22023';
  end if;

  if coalesce(v_mod, '') in ('venda', 'maquila') and ex.preu_minim is not null
     and (p_preu is null or p_preu < ex.preu_minim) then
    raise exception 'El preu ha de ser com a minim % EUR/kg', ex.preu_minim using errcode = '22023';
  end if;

  select telefono into tel from entidades where id = p_entidad;

  insert into oferta_respuestas (
    excedente_id, entidad_id, telefono, canal, estado,
    kg_solicitados, caixes_solicitades, preu_ofert, respondido_at, modalitat
  ) values (
    p_excedente, p_entidad, tel, 'asistido', 'acceptada',
    p_kg, p_caixes, case when v_mod = 'donacio' then null else p_preu end, now(), v_mod
  )
  on conflict (excedente_id, entidad_id) do update
     set estado             = 'acceptada',
         canal              = 'asistido',
         kg_solicitados     = excluded.kg_solicitados,
         caixes_solicitades = excluded.caixes_solicitades,
         preu_ofert         = excluded.preu_ofert,
         modalitat          = excluded.modalitat,
         respondido_at      = now()
   where oferta_respuestas.aprovacio = 'pendent'
  returning * into fila;

  if fila.id is null then
    raise exception 'Aquesta resposta ja esta resolta' using errcode = '22023';
  end if;
  return fila;
end;
$$;
revoke execute on function public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, integer, text) from public, anon;
grant  execute on function public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, integer, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Aprobar fija la modalidad de la entrega
-- ---------------------------------------------------------------------------
-- La de la respuesta, o la que diga el equipo (`p_modalitat`), o la única de la oferta. Si
-- la oferta tiene varias y nadie la ha dicho —una respuesta por WhatsApp a una oferta
-- «donació o venda»—, se niega con `cal_modalitat` y la pantalla la pide. Queda escrita en
-- `canalizaciones.valorizacion`, que es la que decide el albarán (ENT u OPE) y el cierre.
drop function if exists public.aprovar_resposta(uuid, numeric, numeric, text);

create or replace function public.aprovar_resposta(
  p_resposta uuid,
  p_kg       numeric default null,
  p_preu     numeric default null,
  p_motiu    text default null,
  p_modalitat text default null
)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        oferta_respuestas;
  ex       excedentes;
  c        canalizaciones;
  kg       numeric;
  cubierto numeric;
  v_mods   text[];
  v_val    text;
  v_aviso  text;
begin
  if not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden aprovar' using errcode = '42501';
  end if;

  select * into r from oferta_respuestas where id = p_resposta for update;
  if r.id is null or r.estado <> 'acceptada' or r.aprovacio <> 'pendent' then
    raise exception 'Aquesta resposta no es pot aprovar' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = r.excedente_id for update;
  kg := coalesce(p_kg, r.kg_solicitados);
  if kg is null or kg <= 0 then
    raise exception 'Cal indicar els kg a canalitzar' using errcode = '22023';
  end if;

  v_mods := coalesce(ex.modalitats, array[coalesce(ex.modalitat, 'donacio')]);
  v_val := coalesce(p_modalitat, r.modalitat,
                    case when cardinality(v_mods) = 1 then v_mods[1] end);
  if v_val is null then
    raise exception 'cal_modalitat: tria la modalitat d''aquesta entrega' using errcode = '22023';
  end if;
  if not (v_val = any(v_mods)) then
    raise exception 'Aquesta oferta no s''ofereix en modalitat %', v_val using errcode = '22023';
  end if;

  v_aviso := public.exigir_convenio('productor', ex.productor_id, v_val, 'entrega');
  if v_aviso is not null then raise notice '%', v_aviso; end if;
  v_aviso := public.exigir_convenio('entidad', r.entidad_id, v_val, 'recibe');
  if v_aviso is not null then raise notice '%', v_aviso; end if;

  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, estado, valorizacion)
  values (r.excedente_id, r.entidad_id, kg, 'confirmada', v_val)
  returning * into c;

  update oferta_respuestas
     set aprovacio       = 'aprovada',
         aprovat_at      = now(),
         motiu_aprovacio = p_motiu,
         canalizacion_id = c.id,
         kg_solicitados  = kg,
         modalitat       = v_val,
         preu_ofert      = case when v_val = 'donacio' then null
                                else coalesce(p_preu, r.preu_ofert) end
   where id = r.id;

  select coalesce(sum(kg_confirmados), 0) into cubierto
    from canalizaciones where excedente_id = ex.id;

  update excedentes
     set estado = case
           when coalesce(ex.kg_total, 0) > 0 and cubierto >= ex.kg_total then 'bloqueada'
           else 'parcial'
         end
   where id = ex.id and estado in ('publicada', 'parcial');

  return c;
end;
$$;
revoke execute on function public.aprovar_resposta(uuid, numeric, numeric, text, text) from public, anon;
grant  execute on function public.aprovar_resposta(uuid, numeric, numeric, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Lo que ya existía y tiene que conocer el estado nuevo
-- ---------------------------------------------------------------------------
-- El productor puede cancelar también la que espera validación.
create or replace function public.cancelar_meva_oferta(p_excedente uuid, p_motiu text)
returns excedentes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex excedentes;
begin
  select * into ex from excedentes where id = p_excedente;
  if ex.id is null or ex.productor_id not in (select public.mis_productores()) then
    raise exception 'Aquesta oferta no es teva' using errcode = '42501';
  end if;
  if ex.estado not in ('borrador', 'pendent_validacio', 'publicada', 'parcial') then
    raise exception 'Aquesta oferta ja no es pot cancel·lar' using errcode = '22023';
  end if;
  update excedentes
     set estado = 'cancelada',
         motivo_no_colocada = coalesce(p_motiu, motivo_no_colocada)
   where id = p_excedente
  returning * into ex;
  return ex;
end;
$$;

-- Una oferta que ha caducado sin que nadie la validara no «se ha quedado sin salida»: no
-- ha llegado a salir. Se cancela con su motivo, y no se cuenta como `no_colocada`.
create or replace function public.marcar_excedentes_vencidos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  afectados integer;
  sense_validar integer;
begin
  update excedentes e
     set estado = 'cancelada',
         motivo_no_colocada = coalesce(e.motivo_no_colocada, 'no validada a temps')
   where e.estado = 'pendent_validacio'
     and e.disponible_hasta is not null
     and e.disponible_hasta < current_date - 1;
  get diagnostics sense_validar = row_count;

  with vencidos as (
    select e.id
      from excedentes e
      left join canalizaciones c on c.excedente_id = e.id
     where e.estado in ('borrador', 'publicada', 'parcial')
       and e.disponible_hasta is not null
       and e.disponible_hasta < current_date - 1
     group by e.id, e.kg_total
     having coalesce(e.kg_total, 0) - coalesce(sum(c.kg_confirmados), 0) > 0
  )
  update excedentes e
     set estado = 'no_colocada',
         motivo_no_colocada = coalesce(e.motivo_no_colocada, 'vencida sin cubrir')
    from vencidos v
   where e.id = v.id;

  get diagnostics afectados = row_count;
  raise notice 'marcar_excedentes_vencidos: % no_colocada, % cancelades sense validar',
    afectados, sense_validar;
  return afectados + sense_validar;
end;
$$;

-- La cola del equipo gana `ofertes_per_validar`.
CREATE OR REPLACE FUNCTION public.pendents_equip()
 RETURNS TABLE(cua text, n integer, ref uuid, detall jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la cua de treball' using errcode = '42501';
  end if;

  return query
  with param as (
    select extract(year from (now() at time zone 'Europe/Madrid'))::int as any_curs,
           (now() at time zone 'Europe/Madrid')::date                   as avui
  ),
  tanc as (
    select ci.id, ci.ejercicio, ci.modo, ci.estado
      from cierres_ejercicio ci
     where ci.estado in ('obert', 'provisional')
     order by ci.abierto_at desc, ci.created_at desc
     limit 1
  ),
  cues as (
    -- ⚠️ Las columnas del CTE NO se llaman `cua`, `n`, `ref` ni `detall`: esos cuatro
    --    nombres son los parámetros OUT de la función, y en plpgsql un identificador que
    --    coincide con una variable se sustituye por ella. `return query` casa por
    --    POSICIÓN, así que llamarlas distinto no cuesta nada y elimina la ambigüedad.
    select 1::numeric as ordre, 'registres'::text as clau,
           (select count(*) from membresias m where m.aprovacio = 'pendent')::int as quants,
           null::uuid as objecte, null::jsonb as extra
    union all
    select 2, 'convenis_contrasignar',
           (select count(*) from convenios cv where cv.estado = 'firmat')::int, null, null
    union all
    -- NUEVA (05-10-2026). Ofertas que esperan a que el equipo las valide antes de salir al
    -- Mercat (`excedentes_validacio`). Va entre los convenios y las respuestas porque es lo
    -- primero que le pasa a una oferta, y el orden de esta lista es el orden del proceso.
    -- Es la cifra del badge de «Ofertes»: no baja al entrar en la sección, solo al validar o
    -- rechazar, porque la oferta se queda parada hasta que alguien decide.
    select 2.5, 'ofertes_per_validar',
           (select count(*) from excedentes e where e.estado = 'pendent_validacio')::int,
           null, null
    union all
    select 3, 'respostes',
           (select count(*) from oferta_respuestas r
             where r.estado = 'acceptada' and r.aprovacio = 'pendent')::int, null, null
    union all
    select 4, 'missatges',
           (select coalesce(sum(ms.pendents), 0)::int from missatges_sense_contestar() ms),
           null, null
    union all
    select 5, 'ofertes_sense_enviar',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and not exists (select 1 from oferta_respuestas r
                                where r.excedente_id = e.id))::int, null, null
    union all
    select 6, 'ofertes_vencudes',
           (select count(*) from excedentes e, param p
             where e.estado in ('publicada', 'parcial')
               and e.disponible_hasta < p.avui)::int, null, null
    union all
    select 7, 'albarans_esborrany',
           (select count(*) from albaranes a where a.estado = 'borrador')::int, null, null
    union all
    select 8, 'albarans_conciliar',
           (select count(*) from albaranes a
             where a.tipo = 'REC' and a.estado in ('entregado', 'confirmado'))::int,
           null, null
    union all
    select 9, 'albarans_esperant',
           (select count(*) from albaranes a where a.estado = 'entregado')::int, null, null
    union all
    select 10, 'costos',
           (select count(distinct e.producto)
              from canalizaciones c
              join excedentes e on e.id = c.excedente_id
              cross join param p
             where extract(year from (c.created_at at time zone 'Europe/Madrid'))::int
                   = p.any_curs
               and e.producto is not null
               and c.coste_kg is null
               and not exists (select 1 from costes_producto cp
                                where cp.producto = e.producto))::int, null, null
    union all
    select 11, 'tancament',
           (select count(*) from cierres_ejercicio ci
             where ci.estado in ('obert', 'provisional'))::int,
           (select t.id from tanc t),
           (select jsonb_build_object(
                     'ejercicio',   t.ejercicio,
                     'modo',        t.modo,
                     'estado',      t.estado,
                     'bloquejats',
                     (select count(*) from cierres_donante d
                       where d.cierre_id = t.id
                         and exists (
                           select 1
                             from jsonb_array_elements(
                                    case when jsonb_typeof(d.bloqueos) = 'array'
                                         then d.bloqueos else '[]'::jsonb end) b
                            where coalesce((b ->> 'bloqueja')::boolean, false))))
              from tanc t)
    union all
    select 12, 'documents_error',
           (select count(*) from documentos d where d.estado = 'error')::int, null, null
    union all
    -- NUEVA (F3). Ofertas publicadas que declaran producto sin cosechar y todavía no son
    -- una jornada. Es trabajo de campo pendiente: alguien tiene que organizar el espigueo.
    --
    -- ⚠️ `estado = 'publicada'` y no también `'parcial'`, y las dos mitades encajan a
    --    propósito: una oferta con alguna canalización ya no es convertible
    --    —`crear_espigolada()` se niega con `ja_te_canalitzacions`—, así que contarla aquí
    --    sería ofrecer un botón que la base va a rechazar. La cola cuenta exactamente lo
    --    que se puede convertir.
    --
    -- ⚠️ Y `espigolada_id is null` y no `oferta_origen_id`: lo que hay que mirar es si la
    --    oferta YA es parte de una jornada, venga de donde venga. Preguntarlo por el enlace
    --    inverso dejaría fuera cualquier otro camino que la ate a una espigolada, que es
    --    justo el estado que hace imposible convertirla.
    select 13, 'espigolades_per_convertir',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and e.producte_al_camp
               and e.espigolada_id is null)::int, null, null
  )
  select q.clau, q.quants, q.objecte, q.extra from cues q order by q.ordre;
end;
$function$

;
