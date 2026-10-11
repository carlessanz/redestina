-- Fase 10 de la revisión del 08-10-2026: «El meu impacte» e indicadores ambientales, sociales
-- y económicos.
--
-- Qué se mide (siempre con kilos OFICIALES —canalizaciones conciliadas, D13— y la fecha de
-- recogida en hora de Madrid, igual que `kpis_equip`):
--   · kg aprovechados, por modalidad; entregas; contrapartes;
--   · CO₂e evitado, agua y raciones, con FACTORES de una tabla editable por el super_admin;
--   · el valor en € (kg × coste por kilo congelado) SOLO para el equipo y el productor: al
--     receptor le expondría la valoración que declara el donante.
--
-- ⚠️ LOS FACTORES NACEN PROVISIONALES. Son órdenes de magnitud de la literatura (FAO 2013 para
--    el CO₂e del desperdicio alimentario; huella hídrica media de frutas y hortalizas; una
--    ración de 400 g) y la pantalla lo dice. La Fundació tiene que validarlos o sustituirlos.

create table public.factors_impacte (
  codi        text primary key check (codi in ('co2e_kg_per_kg', 'aigua_l_per_kg', 'racions_per_kg')),
  valor       numeric not null check (valor >= 0),
  unitat      text not null,
  nom_ca      text not null,
  nom_es      text not null,
  font        text,
  provisional boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

insert into public.factors_impacte (codi, valor, unitat, nom_ca, nom_es, font) values
  ('co2e_kg_per_kg', 2.5, 'kg CO₂e/kg', 'CO₂ equivalent evitat', 'CO₂ equivalente evitado',
   'PROVISIONAL — FAO (2013), petjada del malbaratament alimentari, mitjana global'),
  ('aigua_l_per_kg', 300, 'l/kg', 'Aigua estalviada', 'Agua ahorrada',
   'PROVISIONAL — petjada hídrica mitjana de fruita i hortalissa'),
  ('racions_per_kg', 2.5, 'racions/kg', 'Racions', 'Raciones',
   'PROVISIONAL — una ració de 400 g');

alter table public.factors_impacte enable row level security;
revoke all on public.factors_impacte from anon, authenticated;
grant select on public.factors_impacte to authenticated;
grant all on public.factors_impacte to service_role;
-- Son un catálogo: los lee cualquiera con sesión (el receptor los ve junto a su impacto).
create policy "factors_impacte: lectura" on public.factors_impacte
  for select to authenticated using (true);

-- El super_admin fija un factor (Configuració). Guarda antes que existencia: un código
-- inventado da 42501 a quien no puede, y 22023 a quien sí.
create or replace function public.fixar_factor_impacte(p_codi text, p_valor numeric,
  p_font text default null, p_provisional boolean default true)
 returns public.factors_impacte
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  f factors_impacte;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin fixa els factors d''impacte' using errcode = '42501';
  end if;
  if p_valor is null or p_valor < 0 then
    raise exception 'valor_invalid' using errcode = '22023';
  end if;
  update factors_impacte
     set valor = p_valor,
         font = coalesce(nullif(trim(p_font), ''), font),
         provisional = coalesce(p_provisional, true),
         updated_at = now(),
         updated_by = auth.uid()
   where codi = p_codi
  returning * into f;
  if f.codi is null then
    raise exception 'factor_inexistent: %', p_codi using errcode = '22023';
  end if;
  return f;
end;
$function$;
revoke execute on function public.fixar_factor_impacte(text, numeric, text, boolean) from public, anon;
grant execute on function public.fixar_factor_impacte(text, numeric, text, boolean) to authenticated, service_role;

-- El cálculo, uno solo para los tres ámbitos. `security invoker`: agrega solo lo que quien
-- pregunta ya puede leer (la RLS de `canalizaciones` y `excedentes`), y además filtra por
-- sus fichas. El ámbito global exige ser del equipo.
create or replace function public.impacte_calcula(p_ambit text, p_desde date, p_hasta date)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v       jsonb;
  f_co2   numeric;
  f_aigua numeric;
  f_rac   numeric;
  v_prov  boolean;
begin
  if p_ambit not in ('receptor', 'productor', 'global') then
    raise exception 'ambit_desconegut' using errcode = '22023';
  end if;
  if p_ambit = 'global' and auth.uid() is not null and not public.es_intern() then
    raise exception 'L''impacte de tota la plataforma es de l''equip' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'periode_invalid' using errcode = '22023';
  end if;

  select max(valor) filter (where codi = 'co2e_kg_per_kg'),
         max(valor) filter (where codi = 'aigua_l_per_kg'),
         max(valor) filter (where codi = 'racions_per_kg'),
         coalesce(bool_or(provisional), true)
    into f_co2, f_aigua, f_rac, v_prov
    from factors_impacte;

  with base as (
    select c.entidad_id, ex.productor_id, c.valorizacion, c.coste_kg,
           coalesce(c.kg_conciliados, c.kg_reales, c.kg_confirmados, 0) as kg,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at) at time zone 'Europe/Madrid')::date as dia
      from canalizaciones c
      join excedentes ex on ex.id = c.excedente_id
     where c.estado = 'conciliada'
       and (p_ambit = 'global'
            or (p_ambit = 'receptor'  and c.entidad_id  in (select public.mis_entidades()))
            or (p_ambit = 'productor' and ex.productor_id in (select public.mis_productores())))
  ), b as (
    select * from base where dia between p_desde and p_hasta
  ), t as (
    select coalesce(sum(kg), 0) as kg from b
  )
  select jsonb_build_object(
    'ambit', p_ambit, 'desde', p_desde, 'hasta', p_hasta,
    'kg_total', t.kg,
    'kg_donacio', coalesce((select sum(kg) from b where valorizacion = 'donacio'), 0),
    'kg_venda', coalesce((select sum(kg) from b where valorizacion = 'venda'), 0),
    'kg_maquila', coalesce((select sum(kg) from b where valorizacion = 'maquila'), 0),
    'entregues', (select count(*) from b),
    'n_productors', (select count(distinct productor_id) from b),
    'n_entitats', (select count(distinct entidad_id) from b),
    -- El valor en €, nunca al receptor (expondría el coste que declara el donante).
    'valor_eur', case when p_ambit = 'receptor' then null
                      else coalesce((select sum(kg * coste_kg) from b
                                      where valorizacion = 'donacio' and coste_kg is not null), 0) end,
    'co2e_kg', round(t.kg * coalesce(f_co2, 0), 1),
    'aigua_l', round(t.kg * coalesce(f_aigua, 0)),
    'racions', round(t.kg * coalesce(f_rac, 0)),
    'factors_provisionals', v_prov,
    'per_mes', coalesce((select jsonb_agg(jsonb_build_object('mes', m.mes, 'kg', m.kg) order by m.mes)
                           from (select to_char(dia, 'YYYY-MM') as mes, sum(kg) as kg from b group by 1) m),
                        '[]'::jsonb)
  ) into v
  from t;
  return v;
end;
$function$;
revoke execute on function public.impacte_calcula(text, date, date) from public, anon;
grant execute on function public.impacte_calcula(text, date, date) to authenticated, service_role;

create or replace function public.impacte_receptor(p_desde date, p_hasta date)
 returns jsonb language sql stable set search_path to 'public', 'pg_temp'
as $$ select public.impacte_calcula('receptor', p_desde, p_hasta) $$;
create or replace function public.impacte_productor(p_desde date, p_hasta date)
 returns jsonb language sql stable set search_path to 'public', 'pg_temp'
as $$ select public.impacte_calcula('productor', p_desde, p_hasta) $$;
create or replace function public.impacte_global(p_desde date, p_hasta date)
 returns jsonb language sql stable set search_path to 'public', 'pg_temp'
as $$ select public.impacte_calcula('global', p_desde, p_hasta) $$;

revoke execute on function public.impacte_receptor(date, date) from public, anon;
revoke execute on function public.impacte_productor(date, date) from public, anon;
revoke execute on function public.impacte_global(date, date) from public, anon;
grant execute on function public.impacte_receptor(date, date) to authenticated, service_role;
grant execute on function public.impacte_productor(date, date) to authenticated, service_role;
grant execute on function public.impacte_global(date, date) to authenticated, service_role;
