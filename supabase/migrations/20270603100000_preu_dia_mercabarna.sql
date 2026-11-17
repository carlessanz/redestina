-- La propuesta del alta de oferta para los productos SOLO de Mercabarna: el precio del día
-- (17-11-2026, petición del cliente).
--
-- Por qué: Mercabarna da UN valor por mes, el del último día capturado, y solo con el mes
-- cerrado (20270602100000). Durante el mes en curso un producto que solo está en Mercabarna no
-- tiene precio validado, y el alta de oferta no proponía nada (o el de un mes anterior). Ahora
-- se le propone el precio del último día capturado (hoy, o el último anterior), marcado como
-- provisional y con su fecha.
--
-- Qué NO cambia: la tabla de precios de referencia (mensual), la valoración de las
-- canalizaciones (`preu_referencia_de`, precio del mes del albarán) y los productos con Gencat
-- o con precio manual. La propuesta no se guarda en la oferta si el productor no la cambia
-- (`costADeclarar`): la donación sigue tomando el precio validado del mes de su albarán.
--
-- Orden de la propuesta (`preu_proposta_oferta`):
--   1. el precio validado del mes de hoy (si lo hay, manda siempre);
--   2. solo Mercabarna (sin equivalencia de Gencat con datos y sin `preu_manual`): el precio
--      del último día capturado hasta hoy (varias equivalencias ese día = media), provisional;
--   3. lo de antes: el último validado (provisional) o el coste manual.

-- ---------------------------------------------------------------------------
-- 1. El precio del día de Mercabarna de un producto (interna)
-- ---------------------------------------------------------------------------
create or replace function public.preu_dia_mercabarna(p_producto text, p_data date)
returns table(eur_kg numeric, dia date, noms text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with obs as (
    select make_date(o.exercici, o.mes, o.dia) as dia, o.eur_kg, o.nom_font
      from productes_fonts pf
      join preus_observats o on o.font = 'mercabarna' and upper(o.nom_font) = upper(pf.nom_font)
      join preus_carregues c on c.id = o.carrega_id and c.estat <> 'descartada'
     where pf.producto = p_producto and pf.font = 'mercabarna'
       and o.dia is not null and o.eur_kg is not null and o.eur_kg > 0
       and make_date(o.exercici, o.mes, o.dia) <= p_data
  )
  select round(avg(o.eur_kg), 4), o.dia, string_agg(distinct o.nom_font, ' · ')
    from obs o
   where o.dia = (select max(dia) from obs)
   group by o.dia;
$$;
revoke execute on function public.preu_dia_mercabarna(text, date) from public, anon, authenticated;
grant execute on function public.preu_dia_mercabarna(text, date) to service_role;

-- ---------------------------------------------------------------------------
-- 2. La propuesta de un producto en el alta de oferta (interna; formulario y bot)
-- ---------------------------------------------------------------------------
create or replace function public.preu_proposta_oferta(p_producto text, p_data date)
returns table(eur_kg numeric, font text, mes_font date, provisional boolean, dia date)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  v_hi_ha boolean;
  v_manual boolean;
  v_gencat boolean;
  d       record;
begin
  if p_producto is null or p_data is null then
    return;
  end if;
  select * into r from public.preu_referencia_de(p_producto, p_data) limit 1;
  v_hi_ha := found;

  -- 1. El validado del mes de hoy manda.
  if v_hi_ha and r.origen = 'validat' then
    return query
      select r.eur_kg, r.font,
             coalesce((select pr.font_mes from preus_referencia pr
                        where pr.producto = p_producto and pr.exercici = r.exercici and pr.mes = r.mes),
                      make_date(r.exercici, r.mes, 1)),
             false, null::date;
    return;
  end if;

  -- 2. Solo Mercabarna: el precio del día.
  select coalesce(p.preu_manual, false) into v_manual from productos p where p.nombre = p_producto;
  select exists (
    select 1
      from productes_fonts pf
      join preus_observats o on o.font = 'gencat'
                            and case when pf.codi_font is not null then pf.codi_font = o.codi_font
                                     else upper(pf.nom_font) = upper(o.nom_font) end
      join preus_carregues c on c.id = o.carrega_id and c.estat <> 'descartada'
     where pf.producto = p_producto and pf.font = 'gencat' and o.eur_kg is not null and o.eur_kg > 0
  ) into v_gencat;
  if not coalesce(v_manual, false) and not v_gencat then
    select * into d from public.preu_dia_mercabarna(p_producto, p_data) limit 1;
    if found and d.eur_kg is not null then
      return query select d.eur_kg, 'mercabarna'::text, date_trunc('month', d.dia)::date, true, d.dia;
      return;
    end if;
  end if;

  -- 3. Como antes: el último validado (provisional) o el coste manual.
  if v_hi_ha and r.eur_kg is not null then
    return query
      select r.eur_kg, r.font,
             case when r.exercici is not null then
               coalesce((select pr.font_mes from preus_referencia pr
                          where pr.producto = p_producto and pr.exercici = r.exercici and pr.mes = r.mes),
                        make_date(r.exercici, r.mes, 1)) end,
             r.provisional, null::date;
  end if;
end;
$$;
revoke execute on function public.preu_proposta_oferta(text, date) from public, anon, authenticated;
grant execute on function public.preu_proposta_oferta(text, date) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Lo que `crear-oferta/campos` pega a cada producto: ahora con el día (columna nueva al final)
-- ---------------------------------------------------------------------------
drop function if exists public.preus_vigents_oferta(date);
create function public.preus_vigents_oferta(p_data date default null)
returns table(producto text, eur_kg numeric, font text, mes_font date, provisional boolean, dia date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.nombre, r.eur_kg, r.font, r.mes_font, r.provisional, r.dia
    from productos p
    cross join lateral public.preu_proposta_oferta(
      p.nombre, coalesce(p_data, (now() at time zone 'Europe/Madrid')::date)) r
   where r.eur_kg is not null;
$$;
revoke execute on function public.preus_vigents_oferta(date) from public, anon, authenticated;
grant execute on function public.preus_vigents_oferta(date) to service_role;
