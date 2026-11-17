-- =============================================================================
-- Punto 3, fase B (fila 3.6 del Excel de revisión de la Fundació, 17-11-2026): causas y
-- subcausas, un solo catálogo para la oferta y para el Diagnòstic operatiu.
-- =============================================================================
--
-- Lo que pide la fila 3.6:
--   · el desplegable de causas de la oferta pasa a ser el MISMO catálogo del diagnóstico,
--     organizado en 7 categorías con sus subcausas;
--   · la oferta lleva UNA causa principal eligiendo una SUBCAUSA (obligatoria en el panel): la
--     causa sale de la subcausa;
--   · «Excedent», «Canalització» y «Maquila» dejan de ser causas.
--
-- Lo que hace esta migración:
--   1. `causas` gana `activa` y `orden`. Se insertan C1–C7 (activas, en orden) y las 8 de
--      siempre (CE, CL, CN, EX, FC, GD, MQ, PR) quedan `activa = false` SIN BORRARSE: las citan
--      ofertas, diagnósticos, albaranes y la carga del ARA. Lo ya guardado conserva su causa
--      vieja y se sigue leyendo con su nombre; no hay remapeo de datos. A qué causa nueva
--      corresponden «Final de cultiu» y «Gestió deficient» está PENDIENTE DE DECIDIR (Fundació).
--   2. Tabla nueva `subcausas` (codigo `C<n>.<m>`, causa, nombres ca/es, orden, activa). Catálogo:
--      SELECT para `authenticated`, ninguna escritura, `anon` nada.
--   3. `excedentes.subcausa_codigo` (nullable: lo antiguo y lo que llega por WhatsApp, que solo
--      pregunta la categoría). El trigger `excedentes_subcausa` deriva `causa_codigo` (y el texto
--      `causa`) de la subcausa y rechaza una subcausa inactiva o incoherente con la causa.
--   4. `editar_oferta()` acepta `subcausa_codigo` (el equipo completa la de una oferta de
--      WhatsApp). Activa y existente, o 22023 `subcausa_invalida`.
--   5. `diagnostic_excedents.subcausas text[]` (varias, opcionales, de la misma causa). La RPC
--      `desar_excedents_diagnostic()` las valida y solo deja CREAR un excedente con una causa
--      activa (uno guardado con causa vieja se conserva). `diagnostic_excedents_json()` las
--      devuelve con su nombre (resumen y PDF).
--
-- Compatible hacia atrás: columnas nuevas nulas o con default; las funciones redefinidas
-- conservan firma, `returns` y claves, y solo AÑADEN la clave `subcausas`. El panel publicado
-- sigue leyendo `causas` (ahora le salen las 7 categorías) hasta que se publique el frontend.
-- Idempotente: se puede aplicar dos veces.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. `causas`: activa y orden; las 7 categorías nuevas; las 8 de antes, inactivas
-- ---------------------------------------------------------------------------
alter table public.causas add column if not exists activa boolean not null default true;
alter table public.causas add column if not exists orden smallint;
comment on column public.causas.activa is
  'Se ofrece para elegir (fase B del punto 3, 20270529100000). Una inactiva se sigue leyendo con su nombre donde ya estaba guardada.';
comment on column public.causas.orden is
  'Orden en los selectores (C1…C7). Las inactivas, sin orden.';

insert into public.causas (codigo, nombre, nombre_es, activa, orden) values
  ('C1', 'Oferta i planificació',               'Oferta y planificación',               true, 1),
  ('C2', 'Demanda i comercialització',          'Demanda y comercialización',           true, 2),
  ('C3', 'Preu i rendibilitat',                 'Precio y rentabilidad',                true, 3),
  ('C4', 'Qualitat i requisits comercials',     'Calidad y requisitos comerciales',     true, 4),
  ('C5', 'Capacitat operativa',                 'Capacidad operativa',                  true, 5),
  ('C6', 'Logística i conservació',             'Logística y conservación',             true, 6),
  ('C7', 'Factors externs i sanitaris',         'Factores externos y sanitarios',       true, 7)
on conflict (codigo) do update
   set nombre = excluded.nombre, nombre_es = excluded.nombre_es,
       activa = excluded.activa, orden = excluded.orden;

-- Las de siempre: no se borran (las citan ofertas, diagnósticos y albaranes), solo dejan de
-- ofrecerse. «Excedent», «Canalització» y «Maquila» porque la Fundació dice que no son causas;
-- el resto porque el catálogo nuevo las sustituye.
update public.causas
   set activa = false, orden = null
 where codigo in ('CE', 'CL', 'CN', 'EX', 'FC', 'GD', 'MQ', 'PR')
   and (activa or orden is not null);

-- ---------------------------------------------------------------------------
-- 2. `subcausas`
-- ---------------------------------------------------------------------------
create table if not exists public.subcausas (
  codigo        text primary key,
  causa_codigo  text not null references public.causas(codigo),
  nombre        text not null,
  nombre_es     text not null,
  orden         smallint not null,
  activa        boolean not null default true,
  constraint subcausas_codigo check (codigo like causa_codigo || '.%'),
  constraint subcausas_noms check (btrim(nombre) <> '' and btrim(nombre_es) <> '')
);
comment on table public.subcausas is
  'Subcausas del catálogo de causas (fase B del punto 3, 20270529100000): una oferta elige UNA (la causa sale de ella, trigger excedentes_subcausa) y un excedente del diagnóstico, varias de su causa. Catálogo: SELECT para authenticated, sin escritura.';
create index if not exists subcausas_causa_idx on public.subcausas (causa_codigo, orden);

alter table public.subcausas enable row level security;
revoke all on public.subcausas from anon, authenticated;
grant select on public.subcausas to authenticated;
grant all on public.subcausas to service_role;

drop policy if exists "subcausas: lectura" on public.subcausas;
create policy "subcausas: lectura" on public.subcausas
  for select to authenticated
  using (true);

insert into public.subcausas (codigo, causa_codigo, nombre, nombre_es, orden) values
  ('C1.1', 'C1', 'Excés de producció o compra', 'Exceso de producción o compra', 1),
  ('C1.2', 'C1', 'Previsió de demanda incorrecta', 'Previsión de demanda incorrecta', 2),
  ('C1.3', 'C1', 'Desajust entre producció, compres i vendes', 'Desajuste entre producción, compras y ventas', 3),
  ('C2.1', 'C2', 'Manca de compradors o demanda', 'Falta de compradores o demanda', 1),
  ('C2.2', 'C2', 'Cancel·lació o modificació de comandes', 'Cancelación o modificación de pedidos', 2),
  ('C2.3', 'C2', 'Manca de canals comercials alternatius', 'Falta de canales comerciales alternativos', 3),
  ('C3.1', 'C3', 'Preu de venda insuficient', 'Precio de venta insuficiente', 1),
  ('C3.2', 'C3', 'Costos de recol·lecció, manipulació o comercialització superiors al valor recuperable',
                 'Costes de recolección, manipulación o comercialización superiores al valor recuperable', 2),
  ('C4.1', 'C4', 'Criteris estètics o de calibre', 'Criterios estéticos o de calibre', 1),
  ('C4.2', 'C4', 'Qualitat o especificacions no acceptades pel comprador', 'Calidad o especificaciones no aceptadas por el comprador', 2),
  ('C4.3', 'C4', 'Producte malmès o deteriorat', 'Producto dañado o deteriorado', 3),
  ('C5.1', 'C5', 'Manca de personal', 'Falta de personal', 1),
  ('C5.2', 'C5', 'Manca de capacitat de recol·lecció, manipulació o preparació', 'Falta de capacidad de recolección, manipulación o preparación', 2),
  ('C5.3', 'C5', 'Instal·lacions o equipament insuficients', 'Instalaciones o equipamiento insuficientes', 3),
  ('C6.1', 'C6', 'Manca de transport o dificultats de recollida/entrega', 'Falta de transporte o dificultades de recogida/entrega', 1),
  ('C6.2', 'C6', 'Manca d''espai d''emmagatzematge', 'Falta de espacio de almacenamiento', 2),
  ('C6.3', 'C6', 'Problemes de conservació o vida útil insuficient', 'Problemas de conservación o vida útil insuficiente', 3),
  ('C7.1', 'C7', 'Condicions meteorològiques adverses', 'Condiciones meteorológicas adversas', 1),
  ('C7.2', 'C7', 'Plagues o malalties', 'Plagas o enfermedades', 2),
  ('C7.3', 'C7', 'Problemes de salubritat o seguretat alimentària', 'Problemas de salubridad o seguridad alimentaria', 3)
on conflict (codigo) do update
   set causa_codigo = excluded.causa_codigo, nombre = excluded.nombre,
       nombre_es = excluded.nombre_es, orden = excluded.orden;

-- ---------------------------------------------------------------------------
-- 3. La oferta: `excedentes.subcausa_codigo` y el trigger que deriva la causa
-- ---------------------------------------------------------------------------
-- `excedentes` tiene GRANT de tabla (SELECT/UPDATE para `authenticated`, sin INSERT): la
-- columna nueva hereda el mismo permiso. El trigger es la red para cualquier escritura (la del
-- panel por `crear-oferta`, la del equipo por `editar_oferta()` o la directa del técnico).
alter table public.excedentes add column if not exists subcausa_codigo text references public.subcausas(codigo);
comment on column public.excedentes.subcausa_codigo is
  'Subcausa de la oferta (fase B del punto 3, 20270529100000). Obligatoria en el alta del panel (crear-oferta); nula en lo antiguo y en lo que llega por WhatsApp (solo pregunta la categoría; la completa el equipo). La causa (causa_codigo y el texto causa) la deriva el trigger excedentes_subcausa.';
create index if not exists excedentes_subcausa_idx on public.excedentes (subcausa_codigo) where subcausa_codigo is not null;

create or replace function public.trg_excedentes_subcausa()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  s     subcausas%rowtype;
  v_nom text;
begin
  -- En un UPDATE, solo si cambia lo que decide: editar los kilos no vuelve a validar nada.
  if tg_op = 'UPDATE'
     and new.subcausa_codigo is not distinct from old.subcausa_codigo
     and new.causa_codigo is not distinct from old.causa_codigo then
    return new;
  end if;
  -- Sin subcausa (lo antiguo, WhatsApp): la causa es la que venga, como siempre.
  if new.subcausa_codigo is null then
    return new;
  end if;

  select * into s from subcausas where codigo = new.subcausa_codigo;
  if not found then
    raise exception 'subcausa_invalida: %', new.subcausa_codigo using errcode = '22023';
  end if;
  -- Una inactiva no se ELIGE; la que ya estaba guardada se conserva.
  if not s.activa and (tg_op = 'INSERT' or new.subcausa_codigo is distinct from old.subcausa_codigo) then
    raise exception 'subcausa_inactiva: %', new.subcausa_codigo using errcode = '22023';
  end if;
  -- Una causa que llega EXPLÍCITA y no es la de la subcausa. Cambiar solo la subcausa (el
  -- equipo completa la de una oferta de WhatsApp) no es incoherente: la causa se recalcula.
  if new.causa_codigo is not null and new.causa_codigo <> s.causa_codigo
     and (tg_op = 'INSERT' or new.causa_codigo is distinct from old.causa_codigo) then
    raise exception 'subcausa_incoherent: % no és de la causa %', new.subcausa_codigo, new.causa_codigo
      using errcode = '22023';
  end if;

  new.causa_codigo := s.causa_codigo;
  select c.nombre into v_nom from causas c where c.codigo = s.causa_codigo;
  new.causa := coalesce(v_nom, new.causa);
  return new;
end;
$function$;
revoke execute on function public.trg_excedentes_subcausa() from public, anon, authenticated;
comment on function public.trg_excedentes_subcausa() is
  'Trigger de excedentes (fase B del punto 3): con subcausa, deriva causa_codigo y el texto causa (nombre catalán de la categoría). 22023: subcausa_invalida, subcausa_inactiva (al elegirla), subcausa_incoherent (causa explícita distinta).';

drop trigger if exists excedentes_subcausa on public.excedentes;
create trigger excedentes_subcausa
  before insert or update of subcausa_codigo, causa_codigo on public.excedentes
  for each row execute function public.trg_excedentes_subcausa();

-- ---------------------------------------------------------------------------
-- 4. `editar_oferta()`: + `subcausa_codigo`
-- ---------------------------------------------------------------------------
-- Misma firma y mismo cuerpo que `20270410100000`; solo se añade la clave. La causa la deriva
-- el trigger. Cambiar la subcausa no revalida (no decide a quién le sirve la oferta, D4).
create or replace function public.editar_oferta(
  p_id uuid, p_canvis jsonb, p_texto text, p_actor uuid
)
returns excedentes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ex        excedentes;
  nou       excedentes;
  v_intern  boolean;
  v_prod    boolean;
  cubierto  numeric;
  v_mods    text[];
  v_sub     text;
  revalidar boolean := false;
  clau      text;
  permeses  text[] := array['kg_total', 'modalitats', 'preu_minim', 'coste_kg', 'disponible_hasta',
                            'hora_recollida_inici', 'hora_recollida_fi', 'horari_recollida',
                            'observacions', 'variedad', 'num_caixes', 'subcausa_codigo'];
begin
  if p_actor is null then
    raise exception 'Cal actor' using errcode = '42501';
  end if;
  select * into ex from excedentes where id = p_id for update;
  if ex.id is null then
    raise exception 'Oferta inexistent' using errcode = '22023';
  end if;

  v_intern := exists (select 1 from usuario_roles ur where ur.user_id = p_actor);
  v_prod := exists (select 1 from membresias m
                     where m.user_id = p_actor and m.activo and m.productor_id = ex.productor_id);
  if not v_intern and not v_prod then
    raise exception 'No pots editar aquesta oferta' using errcode = '42501';
  end if;
  if ex.estado not in ('pendent_validacio', 'publicada', 'parcial', 'bloqueada') then
    raise exception 'oferta_no_editable: una oferta % no es pot editar', ex.estado using errcode = '22023';
  end if;

  for clau in select jsonb_object_keys(p_canvis) loop
    if not (clau = any(permeses)) then
      raise exception 'camp_no_editable: %', clau using errcode = '22023';
    end if;
  end loop;

  select coalesce(sum(kg_confirmados), 0) into cubierto from canalizaciones where excedente_id = ex.id;
  if p_canvis ? 'kg_total' then
    if (p_canvis->>'kg_total')::numeric is null or (p_canvis->>'kg_total')::numeric <= 0 then
      raise exception 'kg_invalids' using errcode = '22023';
    end if;
    if (p_canvis->>'kg_total')::numeric < cubierto then
      raise exception 'kg_menys_canalitzats: ja n''hi ha % kg canalitzats', cubierto using errcode = '22023';
    end if;
  end if;
  if p_canvis ? 'modalitats' then
    select array_agg(m order by array_position(array['donacio','venda','maquila'], m))
      into v_mods
      from (select distinct jsonb_array_elements_text(p_canvis->'modalitats') m) s;
    if v_mods is null or cardinality(v_mods) = 0 then
      raise exception 'modalitats_buides' using errcode = '22023';
    end if;
    -- Una entrega ya aprobada en una modalidad no puede quedar fuera de la oferta.
    if exists (select 1 from canalizaciones c where c.excedente_id = ex.id
                and c.valorizacion is not null and not (c.valorizacion = any(v_mods))) then
      raise exception 'modalitat_amb_canalitzacions' using errcode = '22023';
    end if;
  end if;
  -- La subcausa (fase B del punto 3): una del catálogo y activa; no se vacía.
  if p_canvis ? 'subcausa_codigo' then
    v_sub := nullif(btrim(p_canvis->>'subcausa_codigo'), '');
    if v_sub is null or not exists (select 1 from subcausas s where s.codigo = v_sub and s.activa) then
      raise exception 'subcausa_invalida: %', coalesce(v_sub, '(buida)') using errcode = '22023';
    end if;
  end if;

  update excedentes e set
    kg_total             = case when p_canvis ? 'kg_total' then (p_canvis->>'kg_total')::numeric else e.kg_total end,
    modalitats           = case when p_canvis ? 'modalitats' then v_mods else e.modalitats end,
    modalitat            = case when p_canvis ? 'modalitats' then v_mods[1] else e.modalitat end,
    preu_minim           = case when p_canvis ? 'preu_minim' then nullif(p_canvis->>'preu_minim', '')::numeric else e.preu_minim end,
    coste_kg             = case when p_canvis ? 'coste_kg' then nullif(p_canvis->>'coste_kg', '')::numeric else e.coste_kg end,
    disponible_hasta     = case when p_canvis ? 'disponible_hasta' then nullif(p_canvis->>'disponible_hasta', '')::date else e.disponible_hasta end,
    hora_recollida_inici = case when p_canvis ? 'hora_recollida_inici' then nullif(p_canvis->>'hora_recollida_inici', '')::time else e.hora_recollida_inici end,
    hora_recollida_fi    = case when p_canvis ? 'hora_recollida_fi' then nullif(p_canvis->>'hora_recollida_fi', '')::time else e.hora_recollida_fi end,
    horari_recollida     = case when p_canvis ? 'horari_recollida' then nullif(p_canvis->>'horari_recollida', '') else e.horari_recollida end,
    observacions         = case when p_canvis ? 'observacions' then nullif(p_canvis->>'observacions', '') else e.observacions end,
    variedad             = case when p_canvis ? 'variedad' then nullif(p_canvis->>'variedad', '') else e.variedad end,
    num_caixes           = case when p_canvis ? 'num_caixes' then nullif(p_canvis->>'num_caixes', '')::integer else e.num_caixes end,
    subcausa_codigo      = case when p_canvis ? 'subcausa_codigo' then v_sub else e.subcausa_codigo end,
    texto_oferta         = coalesce(nullif(p_texto, ''), e.texto_oferta)
  where e.id = ex.id
  returning * into nou;

  -- D4: el productor cambia lo que decide a quién le sirve la oferta → vuelve a validación,
  -- si la validación está encendida y la oferta ya estaba fuera. El equipo no revalida: es
  -- quien valida.
  if not v_intern and public.validacio_ofertes_activa()
     and ex.estado in ('publicada', 'parcial', 'bloqueada')
     and (nou.kg_total is distinct from ex.kg_total
          or nou.modalitats is distinct from ex.modalitats) then
    revalidar := true;
    update excedentes set estado = 'pendent_validacio', validada_at = null, validada_per = null
     where id = ex.id
    returning * into nou;
  end if;

  -- Cubierto o no, con los kg nuevos.
  if not revalidar and nou.estado in ('publicada', 'parcial', 'bloqueada') and cubierto > 0 then
    update excedentes set estado = case
             when coalesce(nou.kg_total, 0) > 0 and cubierto >= nou.kg_total then 'bloqueada'
             else 'parcial' end
     where id = ex.id
    returning * into nou;
  end if;

  insert into excedentes_canvis (excedente_id, user_id, abans, despres, revalidar)
  values (ex.id, p_actor,
          (select jsonb_object_agg(k, to_jsonb(ex) -> k) from jsonb_object_keys(p_canvis) k),
          (select jsonb_object_agg(k, to_jsonb(nou) -> k) from jsonb_object_keys(p_canvis) k),
          revalidar);
  return nou;
end;
$$;
revoke execute on function public.editar_oferta(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant  execute on function public.editar_oferta(uuid, jsonb, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. El diagnóstico: `diagnostic_excedents.subcausas`
-- ---------------------------------------------------------------------------
alter table public.diagnostic_excedents add column if not exists subcausas text[] not null default '{}'::text[];
comment on column public.diagnostic_excedents.subcausas is
  'Subcausas del excedente (fase B del punto 3, 20270529100000): varias, opcionales, todas de causa_codi. Las valida desar_excedents_diagnostic(); orden del catálogo.';

-- 5.1 El JSON de lectura: + `subcausas: [{codi, nom: {ca, es}}]` en cada causa (orden del catálogo).
create or replace function public.diagnostic_excedents_json(p_productor uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with pri as (
    select u.producte, u.ordre
      from productores p, unnest(coalesce(p.productes_principals, '{}'::text[])) with ordinality as u(producte, ordre)
     where p.id = p_productor
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'producte',       dp.producte,
           'principal',      pri.ordre is not null,
           'ordre',          pri.ordre,
           'sense_excedent', dp.sense_excedent,
           'observacions',   dp.observacions,
           'causes', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id',            de.id,
                      'causa',         de.causa_codi,
                      'causa_nom',     jsonb_build_object(
                                         'ca', coalesce(c.nombre, de.causa_codi),
                                         'es', coalesce(c.nombre_es, c.nombre, de.causa_codi)),
                      'subcausas', (
                        select coalesce(jsonb_agg(jsonb_build_object(
                                 'codi', s.codigo,
                                 'nom',  jsonb_build_object('ca', s.nombre, 'es', coalesce(s.nombre_es, s.nombre)))
                               order by s.orden, s.codigo), '[]'::jsonb)
                          from subcausas s
                         where s.codigo = any (de.subcausas)),
                      'frequencia',    de.frequencia,
                      'volum_kg',      de.volum_kg,
                      'gestio_actual', to_jsonb(coalesce(de.gestio_actual, '{}'::text[])),
                      'destins',       to_jsonb(coalesce(de.destins_interes, '{}'::text[])),
                      'detall',        de.detall,
                      'accions', (
                        select coalesce(jsonb_agg(jsonb_build_object(
                                 'id',             a.id,
                                 'desti',          a.desti,
                                 'descripcio',     a.descripcio,
                                 'estat',          a.estat,
                                 'notes',          a.notes,
                                 'feta_at',        a.feta_at,
                                 'actualitzat_at', a.actualitzat_at)
                               order by array_position(array['donacio', 'venda', 'maquila'], a.desti)), '[]'::jsonb)
                          from diagnostic_accions a
                         where a.excedent_id = de.id))
                    order by de.causa_codi), '[]'::jsonb)
               from diagnostic_excedents de
               left join causas c on c.codigo = de.causa_codi
              where de.productor_id = dp.productor_id and de.producte = dp.producte))
         order by pri.ordre nulls last, dp.producte), '[]'::jsonb)
    from diagnostic_productes dp
    left join pri on pri.producte = dp.producte
   where dp.productor_id = p_productor;
$function$;
revoke execute on function public.diagnostic_excedents_json(uuid) from public, anon, authenticated;
grant execute on function public.diagnostic_excedents_json(uuid) to service_role;
comment on function public.diagnostic_excedents_json(uuid) is
  'Interna (A3; subcausas desde 20270529100000): los bloques de excedentes de un productor en JSON (productos → causas (+subcausas) → acciones). Sin EXECUTE para sesiones: la llaman diagnostic_datos() y expedient_datos(), que ya han autorizado.';

-- 5.2 Guardar: el cuerpo de `20270522100000` + la causa activa al crear y las subcausas.
create or replace function public.desar_excedents_diagnostic(
  p_productor uuid, p_productes jsonb, p_notes text default null::text, p_idioma text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  c_freq    constant text[] := array['puntual', 'estacional', 'mensual', 'setmanal', 'varies_setmana'];
  c_gestio  constant text[] := array['venda_alternativa', 'donacio', 'transformacio', 'altres_aprofitaments', 'residu', 'altres'];
  c_destins constant text[] := array['donacio', 'venda', 'maquila'];
  v_pri     text[];
  b         jsonb;
  c         jsonb;
  a         jsonb;
  v_prod    text;
  v_prods   text[] := '{}';
  v_sense   boolean;
  v_obs     text;
  v_causa   text;
  v_causes  text[];
  v_freq    text;
  v_volum   numeric;
  v_gestio  text[];
  v_destins text[];
  v_detall  text;
  v_desti   text;
  v_desc    text;
  v_accions text[];
  v_subs    text[];
  v_guard   text[];
  v_existeix boolean;
  v_exc     uuid;
  v_x       text;
  v_falten  text[];
  d         diagnostics%rowtype;
begin
  -- D5: el diagnóstico lo conduce el equipo. `auth.uid() is null` = `service_role`.
  -- El permiso va ANTES que la existencia (§4bis): un uuid inventado da 42501 a un externo.
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'El diagnostic l''actualitza l''equip de Redestina' using errcode = '42501';
  end if;
  -- Bloquea la ficha (sin chocar con las FK que la citan) para serializar dos guardados.
  select coalesce(pr.productes_principals, '{}'::text[]) into v_pri
    from productores pr where pr.id = p_productor
    for no key update;
  if not found then
    raise exception 'fitxa_inexistent' using errcode = '22023';
  end if;
  if p_idioma is not null and p_idioma not in ('ca', 'es') then
    raise exception 'idioma_desconegut: %', p_idioma using errcode = '22023';
  end if;
  if p_productes is null or jsonb_typeof(p_productes) <> 'array' then
    raise exception 'productes_no_llista: p_productes ha de ser una llista de blocs' using errcode = '22023';
  end if;

  for b in select e from jsonb_array_elements(p_productes) as x(e) loop
    if jsonb_typeof(b) <> 'object' then
      raise exception 'productes_no_llista: cada bloc ha de ser un objecte' using errcode = '22023';
    end if;
    v_prod := nullif(btrim(b ->> 'producte'), '');
    if v_prod is null then
      raise exception 'productes_no_llista: un bloc sense producte' using errcode = '22023';
    end if;
    if v_prod = any (v_prods) then
      raise exception 'producte_repetit: %', v_prod using errcode = '22023';
    end if;
    -- Un bloque NUEVO solo de un principal de hoy; uno que ya existe se puede conservar (a).
    if not (v_prod = any (v_pri))
       and not exists (select 1 from diagnostic_productes dp
                        where dp.productor_id = p_productor and dp.producte = v_prod) then
      raise exception 'producte_fora_principals: %', v_prod using errcode = '22023';
    end if;
    v_prods := v_prods || v_prod;

    if coalesce(jsonb_typeof(b -> 'sense_excedent'), 'null') not in ('boolean', 'null') then
      raise exception 'productes_no_llista: sense_excedent ha de ser true/false (%)', v_prod using errcode = '22023';
    end if;
    v_sense := coalesce((b ->> 'sense_excedent')::boolean, false);
    v_obs := nullif(btrim(b ->> 'observacions'), '');
    if char_length(v_obs) > 2000 then
      raise exception 'text_massa_llarg: observacions de % (maxim 2000)', v_prod using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(b -> 'causes'), 'null') not in ('array', 'null') then
      raise exception 'productes_no_llista: causes ha de ser una llista (%)', v_prod using errcode = '22023';
    end if;
    if v_sense and jsonb_array_length(coalesce(nullif(b -> 'causes', 'null'::jsonb), '[]'::jsonb)) > 0 then
      raise exception 'sense_excedent_amb_causes: %', v_prod using errcode = '22023';
    end if;

    insert into diagnostic_productes (productor_id, producte, sense_excedent, observacions)
    values (p_productor, v_prod, v_sense, v_obs)
    on conflict (productor_id, producte) do update
       set sense_excedent = excluded.sense_excedent,
           observacions   = excluded.observacions;

    v_causes := '{}';
    for c in select e from jsonb_array_elements(coalesce(nullif(b -> 'causes', 'null'::jsonb), '[]'::jsonb)) as x(e) loop
      if jsonb_typeof(c) <> 'object' then
        raise exception 'productes_no_llista: cada causa ha de ser un objecte (%)', v_prod using errcode = '22023';
      end if;
      v_causa := nullif(btrim(c ->> 'causa'), '');
      if v_causa is null or not exists (select 1 from causas ca where ca.codigo = v_causa) then
        raise exception 'causa_desconeguda: %', coalesce(v_causa, '(buida)') using errcode = '22023';
      end if;
      if v_causa = any (v_causes) then
        raise exception 'causa_repetida: %:%', v_prod, v_causa using errcode = '22023';
      end if;
      v_causes := v_causes || v_causa;

      -- Fase B del punto 3: una causa inactiva no se ELIGE (no crea un excedente nuevo); el
      -- excedente que ya la tenía se conserva y se puede seguir editando.
      select true, de.subcausas into v_existeix, v_guard
        from diagnostic_excedents de
       where de.productor_id = p_productor and de.producte = v_prod and de.causa_codi = v_causa;
      v_existeix := coalesce(v_existeix, false);
      v_guard := coalesce(v_guard, '{}'::text[]);
      if not v_existeix and not exists (select 1 from causas ca where ca.codigo = v_causa and ca.activa) then
        raise exception 'causa_inactiva: %', v_causa using errcode = '22023';
      end if;

      -- Las subcausas: de ESTA causa y del catálogo; una inactiva solo si ya estaba guardada.
      if coalesce(jsonb_typeof(c -> 'subcausas'), 'null') not in ('array', 'null') then
        raise exception 'productes_no_llista: subcausas ha de ser una llista (%:%)', v_prod, v_causa using errcode = '22023';
      end if;
      select coalesce(array_agg(distinct btrim(e)), '{}'::text[]) into v_subs
        from jsonb_array_elements_text(coalesce(nullif(c -> 'subcausas', 'null'::jsonb), '[]'::jsonb)) as x(e)
       where btrim(e) <> '';
      select sc into v_x from unnest(v_subs) as sc
       where not exists (select 1 from subcausas s where s.codigo = sc) limit 1;
      if found then
        raise exception 'subcausa_desconeguda: %', v_x using errcode = '22023';
      end if;
      select sc into v_x from unnest(v_subs) as sc
       where exists (select 1 from subcausas s where s.codigo = sc and s.causa_codigo <> v_causa) limit 1;
      if found then
        raise exception 'subcausa_incoherent: %:%', v_causa, v_x using errcode = '22023';
      end if;
      select sc into v_x from unnest(v_subs) as sc
       where exists (select 1 from subcausas s where s.codigo = sc and not s.activa)
         and not (sc = any (v_guard)) limit 1;
      if found then
        raise exception 'subcausa_inactiva: %', v_x using errcode = '22023';
      end if;
      select coalesce(array_agg(s.codigo order by s.orden, s.codigo), '{}'::text[]) into v_subs
        from subcausas s where s.codigo = any (v_subs);

      v_freq := nullif(btrim(c ->> 'frequencia'), '');
      if v_freq is not null and not (v_freq = any (c_freq)) then
        raise exception 'frequencia_desconeguda: %', v_freq using errcode = '22023';
      end if;

      -- P7: kilos libres ≥ 0. Número, o texto numérico (coma o punto); vacío = sin contestar.
      case coalesce(jsonb_typeof(c -> 'volum_kg'), 'null')
        when 'null' then
          v_volum := null;
        when 'number' then
          v_volum := (c ->> 'volum_kg')::numeric;
        when 'string' then
          v_x := btrim(c ->> 'volum_kg');
          if v_x = '' then
            v_volum := null;
          elsif v_x ~ '^-?[0-9]+([.,][0-9]+)?$' then
            v_volum := replace(v_x, ',', '.')::numeric;
          else
            raise exception 'volum_negatiu: el volum de %:% ha de ser un nombre >= 0', v_prod, v_causa using errcode = '22023';
          end if;
        else
          raise exception 'volum_negatiu: el volum de %:% ha de ser un nombre >= 0', v_prod, v_causa using errcode = '22023';
      end case;
      if v_volum < 0 then
        raise exception 'volum_negatiu: %:%', v_prod, v_causa using errcode = '22023';
      end if;

      if coalesce(jsonb_typeof(c -> 'gestio_actual'), 'null') not in ('array', 'null') then
        raise exception 'productes_no_llista: gestio_actual ha de ser una llista (%:%)', v_prod, v_causa using errcode = '22023';
      end if;
      select array_agg(s.v order by s.i) into v_gestio
        from (select btrim(e) as v, min(i) as i
                from jsonb_array_elements_text(coalesce(nullif(c -> 'gestio_actual', 'null'::jsonb), '[]'::jsonb))
                     with ordinality as x(e, i)
               where btrim(e) <> ''
               group by btrim(e)) s;
      select g into v_x from unnest(coalesce(v_gestio, '{}'::text[])) as g where not (g = any (c_gestio)) limit 1;
      if found then
        raise exception 'gestio_desconeguda: %', v_x using errcode = '22023';
      end if;

      if coalesce(jsonb_typeof(c -> 'destins'), 'null') not in ('array', 'null') then
        raise exception 'productes_no_llista: destins ha de ser una llista (%:%)', v_prod, v_causa using errcode = '22023';
      end if;
      select coalesce(array_agg(s.v order by array_position(c_destins, s.v)), '{}'::text[]) into v_destins
        from (select distinct btrim(e) as v
                from jsonb_array_elements_text(coalesce(nullif(c -> 'destins', 'null'::jsonb), '[]'::jsonb)) as x(e)
               where btrim(e) <> '') s;
      select dd into v_x from unnest(v_destins) as dd where not (dd = any (c_destins)) limit 1;
      if found then
        raise exception 'desti_desconegut: %', v_x using errcode = '22023';
      end if;

      v_detall := nullif(btrim(c ->> 'detall'), '');
      if char_length(v_detall) > 500 then
        raise exception 'text_massa_llarg: detall de %:% (maxim 500)', v_prod, v_causa using errcode = '22023';
      end if;

      insert into diagnostic_excedents (productor_id, producte, causa_codi, subcausas, frequencia, volum_kg,
                                        gestio_actual, destins_interes, detall)
      values (p_productor, v_prod, v_causa, v_subs, v_freq, v_volum, v_gestio, v_destins, v_detall)
      on conflict (productor_id, producte, causa_codi) do update
         set subcausas       = excluded.subcausas,
             frequencia      = excluded.frequencia,
             volum_kg        = excluded.volum_kg,
             gestio_actual   = excluded.gestio_actual,
             destins_interes = excluded.destins_interes,
             detall          = excluded.detall
      returning id into v_exc;

      -- Una acción por destino marcado (b). La de texto vacío no existe.
      if coalesce(jsonb_typeof(c -> 'accions'), 'null') not in ('array', 'null') then
        raise exception 'productes_no_llista: accions ha de ser una llista (%:%)', v_prod, v_causa using errcode = '22023';
      end if;
      v_accions := '{}';
      for a in select e from jsonb_array_elements(coalesce(nullif(c -> 'accions', 'null'::jsonb), '[]'::jsonb)) as x(e) loop
        if jsonb_typeof(a) <> 'object' then
          raise exception 'productes_no_llista: cada accio ha de ser un objecte (%:%)', v_prod, v_causa using errcode = '22023';
        end if;
        v_desc := nullif(btrim(a ->> 'descripcio'), '');
        if v_desc is null then
          continue;
        end if;
        v_desti := nullif(btrim(a ->> 'desti'), '');
        if v_desti is null or not (v_desti = any (c_destins)) then
          raise exception 'desti_desconegut: %', coalesce(v_desti, '(buit)') using errcode = '22023';
        end if;
        if not (v_desti = any (v_destins)) then
          raise exception 'accio_fora_destins: %:%:%', v_prod, v_causa, v_desti using errcode = '22023';
        end if;
        if v_desti = any (v_accions) then
          raise exception 'accio_repetida: %:%:%', v_prod, v_causa, v_desti using errcode = '22023';
        end if;
        if char_length(v_desc) > 2000 then
          raise exception 'text_massa_llarg: accio de %:%:% (maxim 2000)', v_prod, v_causa, v_desti using errcode = '22023';
        end if;
        v_accions := v_accions || v_desti;

        insert into diagnostic_accions (excedent_id, desti, descripcio)
        values (v_exc, v_desti, v_desc)
        on conflict (excedent_id, desti) do update
           set descripcio = excluded.descripcio;
      end loop;
      delete from diagnostic_accions da
       where da.excedent_id = v_exc and not (da.desti = any (v_accions));
    end loop;

    delete from diagnostic_excedents de
     where de.productor_id = p_productor and de.producte = v_prod
       and not (de.causa_codi = any (v_causes));
  end loop;

  -- Lo que no ha llegado, fuera (en cascada: excedentes y acciones).
  delete from diagnostic_productes dp
   where dp.productor_id = p_productor and not (dp.producte = any (v_prods));

  -- La cabecera. `diagnostic_falten_productor` es invoker: aquí corre como el propietario.
  v_falten := public.diagnostic_falten_productor(p_productor);
  insert into diagnostics (productor_id, respostes, sobre, complet, falten, notes, idioma,
                           actualitzat_at, actualitzat_per)
  values (p_productor, '{}'::jsonb, '{"respostes": []}'::jsonb, cardinality(v_falten) = 0, v_falten,
          nullif(btrim(p_notes), ''), p_idioma, now(), auth.uid())
  on conflict (productor_id) do update
     set complet         = excluded.complet,
         falten          = excluded.falten,
         notes           = excluded.notes,
         idioma          = coalesce(excluded.idioma, diagnostics.idioma),
         actualitzat_at  = excluded.actualitzat_at,
         actualitzat_per = excluded.actualitzat_per
  returning * into d;

  return jsonb_build_object(
    'diagnostic_id', d.id,
    'complet',       d.complet,
    'falten',        to_jsonb(v_falten),
    'productes_n',   (select count(*) from diagnostic_productes dp where dp.productor_id = p_productor),
    'excedents_n',   (select count(*) from diagnostic_excedents de where de.productor_id = p_productor),
    'accions_n',     (select count(*) from diagnostic_accions da
                        join diagnostic_excedents de on de.id = da.excedent_id
                       where de.productor_id = p_productor));
end;
$function$;
revoke execute on function public.desar_excedents_diagnostic(uuid, jsonb, text, text) from public, anon;
grant execute on function public.desar_excedents_diagnostic(uuid, jsonb, text, text) to authenticated, service_role;
comment on function public.desar_excedents_diagnostic(uuid, jsonb, text, text) is
  'Guarda los excedentes del diagnóstico de un productor (A3; subcausas desde 20270529100000) y la cabecera de diagnostics (notas, idioma, complet, falten). Reemplaza el conjunto conservando id/estado/notas/feta_* por (producte, causa, desti). Solo el equipo: 42501 a cualquier externo (D5), antes que la existencia. 22023: fitxa_inexistent, idioma_desconegut, productes_no_llista, producte_repetit, producte_fora_principals (solo al crear un bloque), sense_excedent_amb_causes, causa_desconeguda, causa_repetida, causa_inactiva (solo al crear el excedente), subcausa_desconeguda, subcausa_incoherent, subcausa_inactiva (salvo ya guardada), frequencia_desconeguda, volum_negatiu, gestio_desconeguda, desti_desconegut, accio_fora_destins, accio_repetida, text_massa_llarg. Devuelve {diagnostic_id, complet, falten, productes_n, excedents_n, accions_n}.';
