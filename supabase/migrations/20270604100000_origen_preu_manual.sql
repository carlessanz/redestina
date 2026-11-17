-- El ORIGEN de un precio manual (17-11-2026, petición del cliente).
--
-- Por qué: los productos sin fuente oficial (ni Gencat ni Mercabarna) llevan un precio fijado
-- por la Fundació (`productos.preu_manual` + `costes_producto`). Ese precio tiene que decir, en
-- todas partes donde se enseña, que NO es oficial, de qué fuente se ha tomado (si hay alguna) y
-- con qué criterio se decidió (producto parecido, mediana de la familia…). Hasta ahora eso solo
-- vivía, en texto libre, en `costes_producto.motivo`.
--
-- Qué añade:
--   · `costes_producto.criteri`: cómo se decidió el valor (lista cerrada);
--   · `costes_producto.font_origen`: qué fuente se usó, en texto («Préssec — Gencat, preus
--     percebuts pel pagès, setembre 2026»). Vacío = no hay fuente disponible;
--   · las dos, también en `costes_producto_hist` (el trigger guarda la fila anterior cuando
--     cambia el valor O su origen);
--   · `fixar_origen_cost_producte()`: el equipo que puede aprobar fija el origen sin tocar el
--     valor (el valor sigue con `fijar_coste_producto`, que no cambia de firma).
--
-- Qué NO cambia: el valor, cómo se valora una canalización ni los documentos emitidos.
-- Compatible hacia atrás: columnas nuevas, nulas, y una función nueva.

-- ---------------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------------
alter table public.costes_producto
  add column if not exists criteri text,
  add column if not exists font_origen text;

alter table public.costes_producto
  drop constraint if exists costes_producto_criteri_check;
alter table public.costes_producto
  add constraint costes_producto_criteri_check check (criteri is null or criteri in (
    'producte_semblant',  -- el precio oficial de un producto parecido
    'mediana_familia',    -- la mediana de los precios de su familia
    'mediana_global',     -- la mediana de todos los precios de referencia
    'font_externa',       -- una fuente externa no oficial (otro mercado, una tarifa…)
    'fixat_equip'         -- lo fija el equipo sin fuente
  ));

alter table public.costes_producto_hist
  add column if not exists criteri text,
  add column if not exists font_origen text;

comment on column public.costes_producto.criteri is
  'Cómo se decidió el precio manual (no oficial): producte_semblant · mediana_familia · mediana_global · font_externa · fixat_equip.';
comment on column public.costes_producto.font_origen is
  'Qué fuente se usó para el precio manual, en texto. NULL = no hay fuente disponible.';

-- ---------------------------------------------------------------------------
-- 2. El histórico guarda también el origen anterior
-- ---------------------------------------------------------------------------
create or replace function public.trg_costes_producto_hist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Traspaso o borrado de una cuenta del equipo (20270514100000): solo cambia QUIEN, y solo las RPC
  -- `equip_*` ponen esta marca dentro de su transaccion.
  if tg_op = 'UPDATE' and coalesce(current_setting('redestina.traspas_autoria', true), '') = 'on' then
    return new;
  end if;
  if new.motivo is null or btrim(new.motivo) = '' then
    raise exception 'Cal indicar d''on surt el cost per quilo (motiu)' using errcode = '22023';
  end if;

  -- 20270604100000: también cuando cambia el origen (criterio o fuente), no solo el valor.
  if tg_op = 'UPDATE' and (old.coste_kg is distinct from new.coste_kg
                           or old.criteri is distinct from new.criteri
                           or old.font_origen is distinct from new.font_origen) then
    insert into costes_producto_hist (producto, coste_kg, motivo, fijado_por,
                                      vigente_desde, vigente_hasta, criteri, font_origen)
    values (old.producto, old.coste_kg, old.motivo, old.fijado_por, old.updated_at, now(),
            old.criteri, old.font_origen);
  end if;

  new.updated_at := now();
  return new;
end;
$$;
-- Función de trigger: nadie la llama directamente (20270414100900).
revoke execute on function public.trg_costes_producto_hist() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Fijar el origen (admin o super_admin)
-- ---------------------------------------------------------------------------
create or replace function public.fixar_origen_cost_producte(
  p_producto text,
  p_criteri text,
  p_font_origen text default null
)
returns public.costes_producto
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f costes_producto%rowtype;
  v_font text := nullif(btrim(coalesce(p_font_origen, '')), '');
begin
  -- El permiso, antes que la existencia (§4bis).
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden fixar l''origen del preu' using errcode = '42501';
  end if;
  if p_criteri is null or p_criteri not in
     ('producte_semblant', 'mediana_familia', 'mediana_global', 'font_externa', 'fixat_equip') then
    raise exception 'criteri_invalid' using errcode = '22023';
  end if;
  if v_font is not null and length(v_font) > 300 then
    raise exception 'font_massa_llarga' using errcode = '22023';
  end if;
  -- Una fuente externa o un producto parecido sin decir cuál no explica nada.
  if v_font is null and p_criteri in ('producte_semblant', 'font_externa') then
    raise exception 'cal_font' using errcode = '22023';
  end if;

  update costes_producto
     set criteri = p_criteri,
         font_origen = v_font,
         fijado_por = coalesce(auth.uid(), fijado_por)
   where producto = p_producto
  returning * into f;
  if not found then
    raise exception 'sense_cost' using errcode = '22023';
  end if;
  return f;
end;
$$;
revoke execute on function public.fixar_origen_cost_producte(text, text, text) from public, anon;
grant execute on function public.fixar_origen_cost_producte(text, text, text) to authenticated, service_role;
