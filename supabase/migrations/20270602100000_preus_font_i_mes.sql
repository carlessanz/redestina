-- Punto 3, fase D — ajuste del 17-11-2026 (decisiones de Carles): de qué fuente y de qué MES sale
-- cada precio de referencia, y un precio por mes que no se mueve día a día.
--
--   1. Gencat MANDA. Si tiene el mes de un producto, ese es el precio. Si no lo tiene (va con unos
--      dos meses de retraso, o el producto no tiene precio ese mes), se propone el ÚLTIMO precio de
--      Gencat de ese producto anterior al mes, y Mercabarna no se mira. Validado así, se queda así:
--      cuando Gencat publique después el mes, lo validado no se actualiza.
--   2. Mercabarna solo para los productos que Gencat no tiene: UN valor por mes, el ÚLTIMO día
--      capturado de ese mes (no la media), y solo con el mes ya cerrado (hora de Madrid), para que
--      no cambie cada día. `dies` sigue diciendo cuántos días se capturaron (informativo).
--   3. El mes de origen: `preus_referencia.font_mes` (nuevo) guarda de qué mes sale el valor
--      (p. ej. octubre validado con el Gencat de septiembre). Null en lo validado antes = el
--      propio mes. La canalización lo hereda en `preu_mes_font`, que pasa a ser «el mes del que
--      sale el precio» (lo que imprimen el REC y el certificado: «Gencat, …, setembre 2026»).
--
-- Cambian `preus_fonts_mes` y `preus_calcula_mes`/`preus_proposta_mes` (columnas nuevas al final:
-- drop + create) y, con la misma firma, `preus_desa_mes`, `valoracio_canalitzacio`,
-- `preus_vigents_oferta`, `preus_ajusta_canalitzacions`, `trg_preus_referencia_aplica` y el
-- historial. Ningún precio validado cambia (en producción no había ninguno).

-- ---------------------------------------------------------------------------
-- 1. El mes de origen del precio validado (+ historial)
-- ---------------------------------------------------------------------------
alter table public.preus_referencia add column if not exists font_mes date;
alter table public.preus_referencia_hist add column if not exists font_mes date;
comment on column public.preus_referencia.font_mes is
  'Mes (día 1) del que sale el valor: el propio mes, o el último publicado por Gencat si aún no tenía este. Null = el propio mes (antes de 20270602100000) o precio manual.';

create or replace function public.trg_preus_referencia_hist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into preus_referencia_hist (producto, exercici, mes, eur_kg, font, font_nom, font_dies, font_mes,
                                     proposta_eur_kg, carrega_id, motiu, validat_per, validat_at,
                                     substituit_per, motiu_canvi)
  values (old.producto, old.exercici, old.mes, old.eur_kg, old.font, old.font_nom, old.font_dies, old.font_mes,
          old.proposta_eur_kg, old.carrega_id, old.motiu, old.validat_per, old.validat_at,
          auth.uid(), case when tg_op = 'DELETE' then '[esborrat]' else new.motiu end);
  return coalesce(new, old);
end;
$$;
revoke execute on function public.trg_preus_referencia_hist() from public, anon, authenticated;

drop trigger if exists preus_referencia_hist_upd on public.preus_referencia;
create trigger preus_referencia_hist_upd
  after update of eur_kg, font, font_mes on public.preus_referencia
  for each row
  when (old.eur_kg is distinct from new.eur_kg or old.font is distinct from new.font
        or old.font_mes is distinct from new.font_mes)
  execute function public.trg_preus_referencia_hist();

-- ---------------------------------------------------------------------------
-- 2. Lo que dicen las fuentes de un mes (interna), ahora con el mes de origen
-- ---------------------------------------------------------------------------
drop function if exists public.preus_proposta_mes(integer, integer);
drop function if exists public.preus_calcula_mes(integer, integer);
drop function if exists public.preus_fonts_mes(integer, integer);

create function public.preus_fonts_mes(p_exercici integer, p_mes integer)
returns table(producto text, font text, eur_kg numeric, noms text, dies integer, carrega_id uuid, mes_font date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with g_obs as (
    -- De cada fila de Gencat y cada mes HASTA el pedido, el valor de la carga más reciente no
    -- descartada que lo trae (un fichero nuevo puede revisar meses anteriores).
    select distinct on (o.codi_font, o.nom_font, o.exercici, o.mes)
           o.codi_font, o.nom_font, o.exercici, o.mes, o.eur_kg, o.carrega_id
      from preus_observats o
      join preus_carregues c on c.id = o.carrega_id
     where c.font = 'gencat' and c.estat <> 'descartada'
       and o.eur_kg is not null and o.eur_kg > 0
       and (o.exercici < p_exercici or (o.exercici = p_exercici and o.mes <= p_mes))
     order by o.codi_font, o.nom_font, o.exercici, o.mes, c.created_at desc, o.id desc
  ),
  g_eq as (
    select pf.producto, go.exercici, go.mes, go.eur_kg, go.nom_font, go.carrega_id
      from productes_fonts pf
      join g_obs go
        on case when pf.codi_font is not null then pf.codi_font = go.codi_font
                else upper(pf.nom_font) = upper(go.nom_font) end
     where pf.font = 'gencat'
  ),
  g_darrer as (
    -- El mes pedido si Gencat lo tiene; si no, el último anterior con valor.
    select producto, max(exercici * 12 + mes) as clau from g_eq group by producto
  ),
  g as (
    select e.producto, 'gencat'::text as font, round(avg(e.eur_kg), 4) as eur_kg,
           string_agg(distinct e.nom_font, ' · ') as noms, null::integer as dies,
           (array_agg(e.carrega_id))[1] as carrega_id,
           make_date(min(e.exercici), min(e.mes), 1) as mes_font
      from g_eq e
      join g_darrer d on d.producto = e.producto and e.exercici * 12 + e.mes = d.clau
     group by e.producto
  ),
  m_obs as (
    select pf.producto, coalesce(o.dia, 0) as dia, o.eur_kg, o.nom_font
      from productes_fonts pf
      join preus_observats o on o.font = 'mercabarna' and upper(o.nom_font) = upper(pf.nom_font)
      join preus_carregues c on c.id = o.carrega_id and c.estat <> 'descartada'
     where pf.font = 'mercabarna'
       and o.exercici = p_exercici and o.mes = p_mes and o.eur_kg is not null and o.eur_kg > 0
       -- Solo meses cerrados: un precio por mes, que no cambia cada día.
       and make_date(p_exercici, p_mes, 1) < date_trunc('month', (now() at time zone 'Europe/Madrid'))::date
  ),
  m_dies as (
    select producto, max(dia) as darrer, count(distinct dia)::integer as dies from m_obs group by producto
  ),
  m as (
    -- El ÚLTIMO día capturado del mes (varias equivalencias ese día = media).
    select o.producto, 'mercabarna'::text as font, round(avg(o.eur_kg), 4) as eur_kg,
           string_agg(distinct o.nom_font, ' · ') as noms, d.dies, null::uuid as carrega_id,
           make_date(p_exercici, p_mes, 1) as mes_font
      from m_obs o
      join m_dies d on d.producto = o.producto and o.dia = d.darrer
     group by o.producto, d.dies
  )
  select * from g
  union all
  select * from m;
$$;
revoke execute on function public.preus_fonts_mes(integer, integer) from public, anon, authenticated;
grant execute on function public.preus_fonts_mes(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. La propuesta de un mes para todo el catálogo (interna) y su lectura (equipo)
-- ---------------------------------------------------------------------------
create function public.preus_calcula_mes(p_exercici integer, p_mes integer)
returns table(
  producto text, familia text, preu_manual boolean, equivalencies integer,
  gencat_eur_kg numeric, gencat_nom text, gencat_carrega uuid,
  mercabarna_eur_kg numeric, mercabarna_nom text, mercabarna_dies integer,
  manual_eur_kg numeric,
  proposta_font text, proposta_eur_kg numeric,
  validat_eur_kg numeric, validat_font text, validat_nom text, validat_dies integer,
  validat_motiu text, validat_at timestamptz, validat_proposta numeric,
  anterior_eur_kg numeric, anterior_exercici integer, anterior_mes integer,
  gencat_mes date, proposta_mes_font date, validat_font_mes date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with f as (select * from public.preus_fonts_mes(p_exercici, p_mes)),
  q as (
    select p.nombre, p.familia, p.preu_manual,
           (select count(*)::integer from productes_fonts pf where pf.producto = p.nombre) as equivalencies,
           g.eur_kg as g_eur, g.noms as g_noms, g.carrega_id as g_carrega, g.mes_font as g_mes,
           m.eur_kg as m_eur, m.noms as m_noms, m.dies as m_dies, m.mes_font as m_mes,
           cp.coste_kg as manual_eur,
           case when p.preu_manual then case when cp.coste_kg is not null then 'manual' end
                when g.eur_kg is not null then 'gencat'
                when m.eur_kg is not null then 'mercabarna'
                when cp.coste_kg is not null then 'manual' end as pf_font,
           r.eur_kg as r_eur, r.font as r_font, r.font_nom as r_nom, r.font_dies as r_dies, r.motiu as r_motiu,
           r.validat_at as r_at, r.proposta_eur_kg as r_prop,
           case when r.font in ('gencat', 'mercabarna')
                then coalesce(r.font_mes, make_date(r.exercici, r.mes, 1)) end as r_mes,
           a.eur_kg as a_eur, a.exercici as a_e, a.mes as a_m
      from productos p
      left join f g on g.producto = p.nombre and g.font = 'gencat'
      left join f m on m.producto = p.nombre and m.font = 'mercabarna'
      left join costes_producto cp on cp.producto = p.nombre
      left join preus_referencia r on r.producto = p.nombre and r.exercici = p_exercici and r.mes = p_mes
      left join lateral (
        select ra.eur_kg, ra.exercici, ra.mes
          from preus_referencia ra
         where ra.producto = p.nombre
           and (ra.exercici < p_exercici or (ra.exercici = p_exercici and ra.mes < p_mes))
         order by ra.exercici desc, ra.mes desc
         limit 1) a on true
     where p.nombre <> 'RETORN'
  )
  select q.nombre, q.familia, q.preu_manual, q.equivalencies,
         q.g_eur, q.g_noms, q.g_carrega,
         q.m_eur, q.m_noms, q.m_dies,
         q.manual_eur,
         q.pf_font,
         case q.pf_font when 'gencat' then q.g_eur when 'mercabarna' then q.m_eur when 'manual' then q.manual_eur end,
         q.r_eur, q.r_font, q.r_nom, q.r_dies, q.r_motiu, q.r_at, q.r_prop,
         q.a_eur, q.a_e, q.a_m,
         q.g_mes,
         case q.pf_font when 'gencat' then q.g_mes when 'mercabarna' then q.m_mes end,
         q.r_mes
    from q
   order by q.familia nulls last, q.nombre;
$$;
revoke execute on function public.preus_calcula_mes(integer, integer) from public, anon, authenticated;
grant execute on function public.preus_calcula_mes(integer, integer) to service_role;

create function public.preus_proposta_mes(p_exercici integer, p_mes integer)
returns table(
  producto text, familia text, preu_manual boolean, equivalencies integer,
  gencat_eur_kg numeric, gencat_nom text, gencat_carrega uuid,
  mercabarna_eur_kg numeric, mercabarna_nom text, mercabarna_dies integer,
  manual_eur_kg numeric,
  proposta_font text, proposta_eur_kg numeric,
  validat_eur_kg numeric, validat_font text, validat_nom text, validat_dies integer,
  validat_motiu text, validat_at timestamptz, validat_proposta numeric,
  anterior_eur_kg numeric, anterior_exercici integer, anterior_mes integer,
  gencat_mes date, proposta_mes_font date, validat_font_mes date)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta els preus de referencia' using errcode = '42501';
  end if;
  if p_mes is null or p_mes not between 1 and 12 or p_exercici is null or p_exercici not between 2000 and 2100 then
    raise exception 'mes_invalid' using errcode = '22023';
  end if;
  return query select * from public.preus_calcula_mes(p_exercici, p_mes);
end;
$$;
revoke execute on function public.preus_proposta_mes(integer, integer) from public, anon;
grant execute on function public.preus_proposta_mes(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Guardar un mes: ahora también el mes de origen
-- ---------------------------------------------------------------------------
create or replace function public.preus_desa_mes(p_exercici integer, p_mes integer, p_canvis jsonb,
                                                 p_nomes_canvis boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  c jsonb;
  v_canvis jsonb := coalesce(p_canvis, '[]'::jsonb);
  v_font text;
  v_preu numeric;
  v_motiu text;
  v_nom text;
  v_dies integer;
  v_carrega uuid;
  v_proposta numeric;
  v_mesf date;
  n_nous integer := 0;
  n_canvis integer := 0;
  n_sense integer := 0;
  v_falta text;
begin
  perform public.preus_comprova_mes(p_exercici, p_mes);
  if jsonb_typeof(v_canvis) <> 'array' then
    raise exception 'canvis_invalids' using errcode = '22023';
  end if;
  select x->>'producto' into v_falta
    from jsonb_array_elements(v_canvis) x
   where not exists (select 1 from productos p where p.nombre = x->>'producto')
   limit 1;
  if found then
    raise exception 'producte_inexistent' using errcode = '22023', detail = coalesce(v_falta, '');
  end if;

  for r in select * from public.preus_calcula_mes(p_exercici, p_mes) loop
    select x into c from jsonb_array_elements(v_canvis) x where x->>'producto' = r.producto limit 1;
    if c is not null then
      v_font := coalesce(nullif(c->>'font', ''), r.proposta_font);
      if v_font is null or v_font not in ('gencat', 'mercabarna', 'manual') then
        raise exception 'font_invalida' using errcode = '22023', detail = r.producto;
      end if;
      v_proposta := case v_font when 'gencat' then r.gencat_eur_kg
                                when 'mercabarna' then r.mercabarna_eur_kg
                                else r.manual_eur_kg end;
      v_preu := coalesce((c->>'eur_kg')::numeric, v_proposta);
      if v_preu is null or v_preu <= 0 then
        raise exception 'preu_invalid' using errcode = '22023', detail = r.producto;
      end if;
      v_motiu := nullif(btrim(coalesce(c->>'motiu', '')), '');
      if v_motiu is null and (r.validat_eur_kg is not null
                              or v_font is distinct from r.proposta_font
                              or round(v_preu, 4) is distinct from round(r.proposta_eur_kg, 4)) then
        raise exception 'motiu_obligatori' using errcode = '22023', detail = r.producto;
      end if;
      v_nom := case v_font when 'gencat' then r.gencat_nom when 'mercabarna' then r.mercabarna_nom end;
      v_dies := case v_font when 'mercabarna' then r.mercabarna_dies end;
      v_carrega := case v_font when 'gencat' then r.gencat_carrega end;
      v_mesf := case v_font when 'gencat' then r.gencat_mes
                            when 'mercabarna' then make_date(p_exercici, p_mes, 1) end;
      insert into preus_referencia (producto, exercici, mes, eur_kg, font, font_nom, font_dies, font_mes,
                                    proposta_eur_kg, carrega_id, motiu, validat_per, validat_at)
      values (r.producto, p_exercici, p_mes, round(v_preu, 4), v_font, v_nom, v_dies, v_mesf,
              v_proposta, v_carrega, v_motiu, auth.uid(), now())
      on conflict (producto, exercici, mes) do update
         set eur_kg = excluded.eur_kg, font = excluded.font, font_nom = excluded.font_nom,
             font_dies = excluded.font_dies, font_mes = excluded.font_mes,
             proposta_eur_kg = excluded.proposta_eur_kg,
             carrega_id = excluded.carrega_id, motiu = excluded.motiu,
             validat_per = excluded.validat_per, validat_at = excluded.validat_at;
      if r.validat_eur_kg is null then n_nous := n_nous + 1; else n_canvis := n_canvis + 1; end if;
    elsif not p_nomes_canvis and r.validat_eur_kg is null then
      if r.proposta_eur_kg is null then
        n_sense := n_sense + 1;
      else
        insert into preus_referencia (producto, exercici, mes, eur_kg, font, font_nom, font_dies, font_mes,
                                      proposta_eur_kg, carrega_id, motiu, validat_per, validat_at)
        values (r.producto, p_exercici, p_mes, round(r.proposta_eur_kg, 4), r.proposta_font,
                case r.proposta_font when 'gencat' then r.gencat_nom when 'mercabarna' then r.mercabarna_nom end,
                case r.proposta_font when 'mercabarna' then r.mercabarna_dies end,
                r.proposta_mes_font,
                r.proposta_eur_kg,
                case r.proposta_font when 'gencat' then r.gencat_carrega end,
                null, auth.uid(), now())
        on conflict (producto, exercici, mes) do nothing;
        n_nous := n_nous + 1;
      end if;
    end if;
  end loop;

  -- Las cargas que han dado precio a este mes quedan revisadas.
  update preus_carregues pc
     set estat = 'validada', revisada_per = auth.uid(), revisada_at = now()
   where pc.estat = 'pendent'
     and (pc.id in (select pr.carrega_id from preus_referencia pr
                     where pr.exercici = p_exercici and pr.mes = p_mes and pr.carrega_id is not null)
          or (pc.font = 'mercabarna'
              and pc.data_font >= make_date(p_exercici, p_mes, 1)
              and pc.data_font < (make_date(p_exercici, p_mes, 1) + interval '1 month')::date
              and exists (select 1 from preus_referencia pr
                           where pr.exercici = p_exercici and pr.mes = p_mes and pr.font = 'mercabarna')));

  return jsonb_build_object('validats', n_nous, 'canviats', n_canvis, 'sense_preu', n_sense);
end;
$$;
revoke execute on function public.preus_desa_mes(integer, integer, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.preus_desa_mes(integer, integer, jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. La canalización hereda el mes de ORIGEN del precio (`preu_mes_font`)
-- ---------------------------------------------------------------------------
create or replace function public.valoracio_canalitzacio(p_excedente uuid, p_mes date)
returns table(coste_kg numeric, font text, mes_font date, dies integer, provisional boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod  text;
  v_decl  numeric;
  r       record;
  v_mesf  date;
  v_dies  integer;
begin
  select e.producto, e.coste_kg into v_prod, v_decl from excedentes e where e.id = p_excedente;
  if v_decl is not null then
    return query select v_decl, 'declarat'::text, null::date, null::integer, false;
    return;
  end if;
  select * into r from public.preu_referencia_de(v_prod, coalesce(p_mes, current_date)) limit 1;
  if not found or r.eur_kg is null then
    return query select null::numeric, null::text, null::date, null::integer, true;
    return;
  end if;
  if r.exercici is not null then
    select coalesce(pr.font_mes, make_date(pr.exercici, pr.mes, 1)), pr.font_dies into v_mesf, v_dies
      from preus_referencia pr
     where pr.producto = v_prod and pr.exercici = r.exercici and pr.mes = r.mes;
  end if;
  return query select r.eur_kg, r.font, v_mesf, v_dies, r.provisional;
end;
$$;
revoke execute on function public.valoracio_canalitzacio(uuid, date) from public, anon, authenticated;
grant execute on function public.valoracio_canalitzacio(uuid, date) to service_role;

-- La propuesta de la oferta: el mes que se enseña es también el de origen.
create or replace function public.preus_vigents_oferta(p_data date default null)
returns table(producto text, eur_kg numeric, font text, mes_font date, provisional boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.nombre, r.eur_kg, r.font,
         case when r.exercici is not null then
           coalesce((select pr.font_mes from preus_referencia pr
                      where pr.producto = p.nombre and pr.exercici = r.exercici and pr.mes = r.mes),
                    make_date(r.exercici, r.mes, 1)) end,
         r.provisional
    from productos p
    cross join lateral public.preu_referencia_de(
      p.nombre, coalesce(p_data, (now() at time zone 'Europe/Madrid')::date)) r
   where r.eur_kg is not null;
$$;
revoke execute on function public.preus_vigents_oferta(date) from public, anon, authenticated;
grant execute on function public.preus_vigents_oferta(date) to service_role;

-- Ajustar un producto-mes al validarlo: el valor, la fuente y el mes de ORIGEN de esa fila.
create or replace function public.preus_ajusta_canalitzacions(p_producto text, p_exercici integer, p_mes integer)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mes  date := make_date(p_exercici, p_mes, 1);
  v_mesf date;
  r      preus_referencia%rowtype;
  v_ids  uuid[];
begin
  select * into r from preus_referencia
   where producto = p_producto and exercici = p_exercici and mes = p_mes;
  if r.producto is null then
    return '{}'::uuid[];
  end if;
  v_mesf := coalesce(r.font_mes, v_mes);

  perform set_config('redestina.ajust_preus', 'on', true);
  perform set_config('redestina.motiu_preu_detall',
                     p_producto || ' ' || to_char(v_mes, 'MM/YYYY') || coalesce(' · ' || r.motiu, ''), true);

  -- Primero las provisionales (motivo «mes validat»); luego las que ya venían de este mes y
  -- cambian porque el equipo ha revalidado el precio («mes revalidat»).
  perform set_config('redestina.motiu_preu', 'mes_validat', true);
  with u as (
    update canalizaciones c
       set coste_kg = r.eur_kg, preu_font = r.font, preu_mes_font = v_mesf,
           preu_font_dies = r.font_dies, preu_provisional = false
      from excedentes e
     where e.id = c.excedente_id and e.producto = p_producto
       and c.preu_mes_albara = v_mes and c.estado <> 'anulada'
       and c.preu_certificat is null
       and c.preu_provisional
       and coalesce(c.preu_font, '') not in ('declarat', 'fixat', 'historic')
    returning c.id)
  select coalesce(array_agg(u.id), '{}'::uuid[]) into v_ids from u;

  -- Las no provisionales de este mes del albarán con una fuente de referencia vienen de la fila
  -- validada de este mes (`preu_mes_font` no nulo); el manual vigente de un `preu_manual` sin
  -- validar no (`preu_mes_font` nulo), como antes.
  perform set_config('redestina.motiu_preu', 'mes_revalidat', true);
  with u as (
    update canalizaciones c
       set coste_kg = r.eur_kg, preu_font = r.font, preu_mes_font = v_mesf, preu_font_dies = r.font_dies
      from excedentes e
     where e.id = c.excedente_id and e.producto = p_producto
       and c.preu_mes_albara = v_mes and c.estado <> 'anulada'
       and c.preu_certificat is null
       and not c.preu_provisional
       and c.preu_font in ('gencat', 'mercabarna', 'manual')
       and c.preu_mes_font is not null
       and (c.coste_kg is distinct from r.eur_kg or c.preu_font is distinct from r.font
            or c.preu_font_dies is distinct from r.font_dies or c.preu_mes_font is distinct from v_mesf)
    returning c.id)
  select v_ids || coalesce(array_agg(u.id), '{}'::uuid[]) into v_ids from u;

  perform set_config('redestina.motiu_preu', '', true);
  perform set_config('redestina.motiu_preu_detall', '', true);
  perform set_config('redestina.ajust_preus', 'off', true);
  return v_ids;
end;
$$;
revoke execute on function public.preus_ajusta_canalitzacions(text, integer, integer) from public, anon, authenticated;
grant execute on function public.preus_ajusta_canalitzacions(text, integer, integer) to service_role;

create or replace function public.trg_preus_referencia_aplica()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  x     record;
  v_ids uuid[] := '{}'::uuid[];
begin
  if tg_op = 'INSERT' then
    for x in select distinct n.producto, n.exercici, n.mes from preus_nous n loop
      v_ids := v_ids || public.preus_ajusta_canalitzacions(x.producto, x.exercici, x.mes);
    end loop;
  else
    for x in
      select distinct n.producto, n.exercici, n.mes
        from preus_nous n
        join preus_vells o on o.producto = n.producto and o.exercici = n.exercici and o.mes = n.mes
       where o.eur_kg is distinct from n.eur_kg or o.font is distinct from n.font
          or o.font_dies is distinct from n.font_dies or o.font_mes is distinct from n.font_mes
    loop
      v_ids := v_ids || public.preus_ajusta_canalitzacions(x.producto, x.exercici, x.mes);
    end loop;
  end if;
  perform public.preus_recalcula_certificats(v_ids);
  return null;
end;
$$;
revoke execute on function public.trg_preus_referencia_aplica() from public, anon, authenticated;

comment on column public.canalizaciones.preu_mes_font is
  'Mes (día 1) del que SALE el precio usado: el del albarán, el último publicado por Gencat si aún no tenía ese, o el último validado si es provisional (20270602100000).';
