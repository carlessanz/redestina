-- La facturación del productor, SOLO por rango (16-11-2026, petición de Carles).
--
-- A4 (20270521100000, P2) dejó dos columnas: la cifra (`facturacio_anual_eur`) «o» el rango
-- (`facturacio_rang`). En la Operativa salían las dos juntas y se contradecían (5.000 € con el rango
-- «100k-500k» en una ficha de prueba de producción). El rango ya dice lo que hace falta: la cifra
-- sale de la interfaz (ficha, «La meva organització», diagnóstico y su PDF) y de la base:
--
--   1. Si una ficha tiene la cifra y no el rango, el rango se deduce de la cifra (en producción, 0
--      filas el 16-11-2026: las 2 que tenían cifra ya tenían rango). Después, la cifra se vacía.
--   2. `actualitzar_fitxa_productor` deja de aceptar la clave. Ignora las que no conoce, así que el
--      frontend publicado, que aún la manda, sigue guardando lo demás (compatibilidad hacia atrás).
--   3. Un trigger la mantiene vacía pase lo que pase (el equipo escribe la ficha directo, y el
--      frontend publicado podría mandarla durante la ventana base → frontend).
--   4. La columna se queda, vacía, hasta su `drop` (deuda 179): el frontend publicado la sigue
--      leyendo en su `select` y `diagnostic_datos()` la devuelve (siempre nula).

-- 1. Rango desde la cifra donde falte, y la cifra fuera.
update public.productores set facturacio_rang = case
    when facturacio_anual_eur < 100000 then '<100k'
    when facturacio_anual_eur < 500000 then '100k-500k'
    when facturacio_anual_eur < 2000000 then '500k-2M'
    else '>2M' end
  where facturacio_anual_eur is not null and facturacio_rang is null;
update public.productores set facturacio_anual_eur = null where facturacio_anual_eur is not null;

-- 2. La RPC del titular, sin la cifra (misma firma; el resto, idéntico a 20270521100000).
create or replace function public.actualitzar_fitxa_productor(p_id uuid, p_dades jsonb)
returns productores
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p productores;
  d jsonb := coalesce(p_dades, '{}'::jsonb);
  txt text;
  k text;
begin
  if not public.soc_titular('productor', p_id) then
    raise exception 'Nomes el titular pot editar les dades' using errcode = '42501';
  end if;
  select * into p from productores where id = p_id for update;

  txt := nullif(trim(d->>'tipo_empresa'), '');
  if not tipus_empresa_valid(txt, p.tipo_empresa) then
    raise exception 'tipus d''empresa desconegut: %', txt using errcode = '22023';
  end if;
  if d ? 'municipio_ine' and nullif(d->>'municipio_ine', '') is not null
     and not exists (select 1 from municipios where codi_ine = d->>'municipio_ine') then
    raise exception 'municipi desconegut' using errcode = '22023';
  end if;
  -- El área es la comarca: una de la lista, o la que ya tenía (un valor antiguo del import,
  -- como «Terres Ebre», se conserva mientras no se cambie; mismo criterio que tipo_empresa).
  if d ? 'area_geografica' and nullif(btrim(d->>'area_geografica'), '') is not null
     and btrim(d->>'area_geografica') is distinct from p.area_geografica
     and not exists (select 1 from municipios where comarca = btrim(d->>'area_geografica')) then
    raise exception 'comarca_desconeguda' using errcode = '22023';
  end if;
  if d ? 'ubicacio' and char_length(btrim(coalesce(d->>'ubicacio', ''))) > 120 then
    raise exception 'ubicacio_massa_llarga' using errcode = '22023';
  end if;
  if d ? 'tipus_activitat' and not public.tipus_activitat_valid(d->'tipus_activitat', 'productor') then
    raise exception 'tipus_activitat_desconegut' using errcode = '22023';
  end if;
  -- A4: las listas llegan como array (o null); los mapas por producto, como objeto (o null).
  -- Los valores de lista los vigilan los CHECK de la tabla; la coherencia entre productos,
  -- el trigger `productores_operativa`.
  foreach k in array array['productos_habituales', 'productes_principals', 'envasos_habituals',
                           'canals_comercials', 'tipologia_clients', 'suport_interes'] loop
    if d ? k and jsonb_typeof(d->k) not in ('array', 'null') then
      raise exception 'operativa_invalida: %', k using errcode = '22023';
    end if;
  end loop;
  foreach k in array array['varietats', 'volum_produccio', 'temporada'] loop
    if d ? k and jsonb_typeof(d->k) not in ('object', 'null') then
      raise exception 'operativa_invalida: %', k using errcode = '22023';
    end if;
  end loop;
  foreach k in array array['volum_comercialitzat_kg'] loop
    if d ? k and jsonb_typeof(d->k) not in ('number', 'null') then
      raise exception 'operativa_invalida: %', k using errcode = '22023';
    end if;
  end loop;

  -- Solo las claves que llegan: una clave ausente no toca la columna. `name` no se vacía
  -- nunca (es el nombre con el que se identifica la ficha en todo el circuito).
  update productores set
    name          = case when d ? 'name' then coalesce(nullif(trim(d->>'name'), ''), name) else name end,
    empresa       = case when d ? 'empresa' then nullif(trim(d->>'empresa'), '') else empresa end,
    razon_social  = case when d ? 'razon_social' then nullif(trim(d->>'razon_social'), '') else razon_social end,
    tipo_empresa  = case when d ? 'tipo_empresa' then txt else tipo_empresa end,
    email         = case when d ? 'email' then nullif(trim(d->>'email'), '') else email end,
    phone         = case when d ? 'phone' then nullif(trim(d->>'phone'), '') else phone end,
    telefono_alt  = case when d ? 'telefono_alt' then nullif(trim(d->>'telefono_alt'), '') else telefono_alt end,
    nif           = case when d ? 'nif' then nullif(upper(trim(d->>'nif')), '') else nif end,
    direccion     = case when d ? 'direccion' then nullif(trim(d->>'direccion'), '') else direccion end,
    codigo_postal = case when d ? 'codigo_postal' then nullif(trim(d->>'codigo_postal'), '') else codigo_postal end,
    municipio_ine = case when d ? 'municipio_ine' then nullif(d->>'municipio_ine', '') else municipio_ine end,
    -- 20270505100000: la ubicación (un lugar que no es municipio) y el área, editables.
    ubicacio      = case when d ? 'ubicacio' then nullif(btrim(d->>'ubicacio'), '') else ubicacio end,
    area_geografica = case when d ? 'area_geografica' then nullif(btrim(d->>'area_geografica'), '') else area_geografica end,
    tipus_activitat = case when d ? 'tipus_activitat'
      then coalesce(array(select jsonb_array_elements_text(d->'tipus_activitat')), '{}') else tipus_activitat end,
    -- 20270517100000 (Taula mestra, Fundació 09-11): datos fiscales y de facturación.
    regim_iva     = case when d ? 'regim_iva' then nullif(btrim(d->>'regim_iva'), '') else regim_iva end,
    domicili_fiscal    = case when d ? 'domicili_fiscal' then nullif(btrim(d->>'domicili_fiscal'), '') else domicili_fiscal end,
    codi_postal_fiscal = case when d ? 'codi_postal_fiscal' then nullif(btrim(d->>'codi_postal_fiscal'), '') else codi_postal_fiscal end,
    poblacio_fiscal    = case when d ? 'poblacio_fiscal' then nullif(btrim(d->>'poblacio_fiscal'), '') else poblacio_fiscal end,
    contacte_facturacio_nom   = case when d ? 'contacte_facturacio_nom' then nullif(btrim(d->>'contacte_facturacio_nom'), '') else contacte_facturacio_nom end,
    contacte_facturacio_email = case when d ? 'contacte_facturacio_email' then nullif(lower(btrim(d->>'contacte_facturacio_email')), '') else contacte_facturacio_email end,
    -- 20270521100000 (A4, D5): la Operativa del productor.
    productos_habituales = case when d ? 'productos_habituales'
      then nullif(array(select jsonb_array_elements_text(case when jsonb_typeof(d->'productos_habituales') = 'array' then d->'productos_habituales' else '[]'::jsonb end)), '{}'::text[])
      else productos_habituales end,
    productes_principals = case when d ? 'productes_principals'
      then nullif(array(select jsonb_array_elements_text(case when jsonb_typeof(d->'productes_principals') = 'array' then d->'productes_principals' else '[]'::jsonb end)), '{}'::text[])
      else productes_principals end,
    varietats       = case when d ? 'varietats' then nullif(d->'varietats', 'null'::jsonb) else varietats end,
    volum_produccio = case when d ? 'volum_produccio' then nullif(d->'volum_produccio', 'null'::jsonb) else volum_produccio end,
    temporada       = case when d ? 'temporada' then nullif(d->'temporada', 'null'::jsonb) else temporada end,
    envasos_habituals = case when d ? 'envasos_habituals'
      then nullif(array(select jsonb_array_elements_text(case when jsonb_typeof(d->'envasos_habituals') = 'array' then d->'envasos_habituals' else '[]'::jsonb end)), '{}'::text[])
      else envasos_habituals end,
    canals_comercials = case when d ? 'canals_comercials'
      then nullif(array(select jsonb_array_elements_text(case when jsonb_typeof(d->'canals_comercials') = 'array' then d->'canals_comercials' else '[]'::jsonb end)), '{}'::text[])
      else canals_comercials end,
    tipologia_clients = case when d ? 'tipologia_clients'
      then nullif(array(select jsonb_array_elements_text(case when jsonb_typeof(d->'tipologia_clients') = 'array' then d->'tipologia_clients' else '[]'::jsonb end)), '{}'::text[])
      else tipologia_clients end,
    facturacio_rang      = case when d ? 'facturacio_rang' then nullif(btrim(d->>'facturacio_rang'), '') else facturacio_rang end,
    volum_comercialitzat_kg = case when d ? 'volum_comercialitzat_kg' then (d->>'volum_comercialitzat_kg')::numeric else volum_comercialitzat_kg end,
    suport_interes = case when d ? 'suport_interes'
      then nullif(array(select jsonb_array_elements_text(case when jsonb_typeof(d->'suport_interes') = 'array' then d->'suport_interes' else '[]'::jsonb end)), '{}'::text[])
      else suport_interes end
  where id = p_id
  returning * into p;
  return p;
end;
$$;

revoke execute on function public.actualitzar_fitxa_productor(uuid, jsonb) from public, anon;
grant execute on function public.actualitzar_fitxa_productor(uuid, jsonb) to authenticated, service_role;

-- 3. La cifra, siempre vacía.
create or replace function public.trg_productores_sense_facturacio_eur()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.facturacio_anual_eur := null;
  return new;
end;
$$;
revoke execute on function public.trg_productores_sense_facturacio_eur() from public, anon, authenticated;

drop trigger if exists trg_productores_sense_facturacio_eur on public.productores;
create trigger trg_productores_sense_facturacio_eur
  before insert or update of facturacio_anual_eur on public.productores
  for each row when (new.facturacio_anual_eur is not null)
  execute function public.trg_productores_sense_facturacio_eur();

-- 4. Lo que queda de ella.
comment on column public.productores.facturacio_anual_eur is
  'RETIRADA (16-11-2026): la facturación va solo por rango (facturacio_rang). Siempre nula (trigger); drop pendiente, deuda 179.';
comment on column public.productores.facturacio_rang is
  'Facturación anual por rango (A4, 2.1; P2). Desde el 16-11-2026, la única: la cifra exacta se retiró.';
