-- Plan 2 · A4 (10-11-2026): Operativa preregistrada, actividad y comercialización, y la base
-- de la precarga de la oferta. Filas 2.1, 2.2, 2.5 y 2.6 de la Taula mestra (versión limpia de
-- Sebas, 09-11) y decisión D5 (el productor edita su Operativa).
--
-- T4 · UN SOLO ORIGEN POR DATO OPERATIVO. Los datos de Operativa son COLUMNAS de `productores` y
-- de `productor_ubicaciones`. Los editan, con los mismos componentes y sobre la misma fila:
--   · el equipo, en la pestaña «Operativa» de la ficha (UPDATE directo, política `edicio intern`);
--   · el equipo, en la sección 1 «Operativa» del formulario del diagnóstico (ídem);
--   · el productor, en «La meva organització» (`actualitzar_fitxa_productor`, lista blanca).
-- El diagnóstico ya no guarda copia: `desar_diagnostic` deja de derivar `productos_habituales` y
-- `temporada` (desde aquí son origen), y el cuestionario pasa a la v3 sin las preguntas que se
-- han ido a la ficha.
--
-- Compatible hacia atrás con el frontend publicado: solo AÑADE columnas; la lista blanca de
-- `actualitzar_fitxa_productor` crece sin cambiar firma; `desar_diagnostic` y
-- `diagnostic_datos` mantienen firma y claves (la segunda añade `operativa`).
--
-- Idempotente: se puede aplicar dos veces.

-- ---------------------------------------------------------------------------
-- 1. Columnas de `productores` (2.1 actividad y comercialización, 2.2 productos)
-- ---------------------------------------------------------------------------
alter table public.productores
  add column if not exists productes_principals    text[],
  add column if not exists varietats               jsonb,
  add column if not exists volum_produccio         jsonb,
  add column if not exists envasos_habituals       text[],
  add column if not exists canals_comercials       text[],
  add column if not exists tipologia_clients       text[],
  add column if not exists facturacio_anual_eur    numeric,
  add column if not exists facturacio_rang         text,
  add column if not exists volum_comercialitzat_kg numeric,
  add column if not exists suport_interes          text[];

-- Las listas cerradas, como CHECK (el frontend las tiene en `campsFitxa.ts`, mismo orden).
alter table public.productores drop constraint if exists productores_envasos_habituals;
alter table public.productores add constraint productores_envasos_habituals
  check (envasos_habituals <@ array['caixes', 'palets', 'granel', 'sacs', 'altres']);
alter table public.productores drop constraint if exists productores_canals_comercials;
alter table public.productores add constraint productores_canals_comercials
  check (canals_comercials <@ array['mercats_majoristes', 'distribucio_gran_superficie', 'comerc_minorista',
    'restauracio_catering', 'industria_alimentaria', 'venda_directa', 'cooperatives_productors', 'altres']);
alter table public.productores drop constraint if exists productores_tipologia_clients;
alter table public.productores add constraint productores_tipologia_clients
  check (tipologia_clients <@ array['majoristes_distribuidors', 'comercos_botigues', 'supermercats_cadenes',
    'restaurants_catering', 'industria_transformadora', 'consumidors_finals', 'administracions', 'altres']);
-- P2: cifra O rango cerrado (dos columnas; se rellena una, lo dice la ayuda, no se impone).
alter table public.productores drop constraint if exists productores_facturacio_rang;
alter table public.productores add constraint productores_facturacio_rang
  check (facturacio_rang in ('<100k', '100k-500k', '500k-2M', '>2M'));
alter table public.productores drop constraint if exists productores_facturacio_anual_eur;
alter table public.productores add constraint productores_facturacio_anual_eur
  check (facturacio_anual_eur >= 0);
alter table public.productores drop constraint if exists productores_volum_comercialitzat_kg;
alter table public.productores add constraint productores_volum_comercialitzat_kg
  check (volum_comercialitzat_kg >= 0);
-- P6: «En què us agradaria que REDESTINA us ajudés?» se conserva como campo opcional de
-- Operativa, con los mismos valores que la pregunta `suport` del cuestionario v2.
alter table public.productores drop constraint if exists productores_suport_interes;
alter table public.productores add constraint productores_suport_interes
  check (suport_interes <@ array['compradors', 'donacions', 'transformacio', 'logistica', 'prevencio', 'anticipar', 'altres']);

comment on column public.productores.productes_principals is
  'Productos principales (A4, 2.2): subconjunto de productos_habituales (lo poda trg_productores_operativa). Recomendación ≤5, no tope.';
comment on column public.productores.varietats is
  'Variedades por producto habitual (A4): {producte: [text]}. Claves fuera de productos_habituales se podan.';
comment on column public.productores.volum_produccio is
  'Volumen anual por producto principal (A4): {producte: kg}. Misma forma que temporada ({producte: [mes]}).';
comment on column public.productores.envasos_habituals is
  'Envases y formatos habituales (A4, 2.5): caixes · palets · granel · sacs · altres. Propone format_entrega en la oferta nueva.';
comment on column public.productores.canals_comercials is 'Canales comerciales (A4, 2.1), lista cerrada.';
comment on column public.productores.tipologia_clients is 'Tipología de clientes (A4, 2.1), lista cerrada.';
comment on column public.productores.facturacio_anual_eur is 'Facturación anual aproximada en euros (A4, 2.1; P2: esta o el rango).';
comment on column public.productores.facturacio_rang is 'Facturación anual por rango (A4, 2.1; P2: este o la cifra).';
comment on column public.productores.volum_comercialitzat_kg is 'Volumen anual comercializado, kg/año (A4, 2.1).';
comment on column public.productores.suport_interes is 'En qué quiere que le ayude Redestina (A4, P6): opcional.';

-- ---------------------------------------------------------------------------
-- 2. La coherencia de los productos: un trigger que NORMALIZA (y poda), no que rechaza
-- ---------------------------------------------------------------------------
-- Principales ⊆ habituales; variedades solo de habituales; volumen y temporada solo de
-- principales. Se PODA en vez de rechazar porque quien quita un producto habitual (la ficha,
-- el importador B4, que reescribe `productos_habituales`) no tiene por qué saber qué colgaba
-- de él: rechazar dejaría una importación entera parada por un principal huérfano. Lo que sí
-- se rechaza (22023 `operativa_invalida`) es la FORMA equivocada: eso es un error de llamada.
create or replace function public.trg_productores_operativa()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  hab  text[];
  pri  text[];
  k    text;
  v    jsonb;
  acc  jsonb;
  arr  jsonb;
begin
  -- Productos habituales: sin espacios sobrantes, sin vacíos, sin repetidos (en su orden).
  select array_agg(x order by i) into hab
    from (select btrim(p) as x, min(i) as i
            from unnest(coalesce(new.productos_habituales, '{}'::text[])) with ordinality as u(p, i)
           where btrim(p) <> ''
           group by btrim(p)) s;
  new.productos_habituales := hab;

  select array_agg(x order by i) into pri
    from (select btrim(p) as x, min(i) as i
            from unnest(coalesce(new.productes_principals, '{}'::text[])) with ordinality as u(p, i)
           where btrim(p) = any (coalesce(hab, '{}'::text[]))
           group by btrim(p)) s;
  new.productes_principals := pri;

  -- Variedades: {producte: [text]} de productos habituales.
  if new.varietats is not null then
    if jsonb_typeof(new.varietats) <> 'object' then
      raise exception 'operativa_invalida: varietats' using errcode = '22023';
    end if;
    acc := '{}'::jsonb;
    for k, v in select * from jsonb_each(new.varietats) loop
      if jsonb_typeof(v) <> 'array' then
        raise exception 'operativa_invalida: varietats' using errcode = '22023';
      end if;
      if not (k = any (coalesce(hab, '{}'::text[]))) then continue; end if;
      select coalesce(jsonb_agg(x order by i), '[]'::jsonb) into arr
        from (select left(btrim(e), 80) as x, min(i) as i
                from jsonb_array_elements_text(v) with ordinality as a(e, i)
               where btrim(e) <> ''
               group by left(btrim(e), 80)) s;
      if jsonb_array_length(arr) > 0 then acc := acc || jsonb_build_object(k, arr); end if;
    end loop;
    new.varietats := nullif(acc, '{}'::jsonb);
  end if;

  -- Volumen por principal: {producte: kg ≥ 0}.
  if new.volum_produccio is not null then
    if jsonb_typeof(new.volum_produccio) <> 'object' then
      raise exception 'operativa_invalida: volum_produccio' using errcode = '22023';
    end if;
    acc := '{}'::jsonb;
    for k, v in select * from jsonb_each(new.volum_produccio) loop
      if jsonb_typeof(v) = 'null' then continue; end if;
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 then
        raise exception 'operativa_invalida: volum_produccio' using errcode = '22023';
      end if;
      if k = any (coalesce(pri, '{}'::text[])) then acc := acc || jsonb_build_object(k, v); end if;
    end loop;
    new.volum_produccio := nullif(acc, '{}'::jsonb);
  end if;

  -- Temporada por principal: {producte: [mes 1..12]}.
  if new.temporada is not null then
    if jsonb_typeof(new.temporada) <> 'object' then
      raise exception 'operativa_invalida: temporada' using errcode = '22023';
    end if;
    acc := '{}'::jsonb;
    for k, v in select * from jsonb_each(new.temporada) loop
      if jsonb_typeof(v) <> 'array' or exists (
           select 1 from jsonb_array_elements(v) m
            where jsonb_typeof(m) <> 'number' or (m #>> '{}')::numeric not in (1,2,3,4,5,6,7,8,9,10,11,12)) then
        raise exception 'operativa_invalida: temporada' using errcode = '22023';
      end if;
      if not (k = any (coalesce(pri, '{}'::text[]))) then continue; end if;
      select coalesce(jsonb_agg(distinct (m #>> '{}')::int), '[]'::jsonb) into arr from jsonb_array_elements(v) m;
      if jsonb_array_length(arr) > 0 then
        acc := acc || jsonb_build_object(k, (select jsonb_agg(x order by x::int) from jsonb_array_elements(arr) x));
      end if;
    end loop;
    new.temporada := nullif(acc, '{}'::jsonb);
  end if;

  return new;
end;
$function$;
revoke execute on function public.trg_productores_operativa() from public, anon, authenticated;

drop trigger if exists productores_operativa on public.productores;
create trigger productores_operativa
  before insert or update of productos_habituales, productes_principals, varietats, volum_produccio, temporada
  on public.productores
  for each row execute function public.trg_productores_operativa();

-- ---------------------------------------------------------------------------
-- 3. Lugares de recogida: días, franjas y UN lugar principal (2.5)
-- ---------------------------------------------------------------------------
-- Franjas `[{inici:'08:00', fi:'12:00'}]`: como mucho cuatro, horas bien formadas, el final
-- después del inicio. IMMUTABLE y sin `security definer`: va en un CHECK.
create or replace function public.franges_valides(p jsonb)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select p is null or (
    jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 4
    and not exists (
      select 1 from jsonb_array_elements(p) f
       where jsonb_typeof(f) <> 'object'
          or coalesce(f ->> 'inici', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or coalesce(f ->> 'fi', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or (f ->> 'inici') >= (f ->> 'fi')));
$function$;
revoke execute on function public.franges_valides(jsonb) from public, anon;
grant execute on function public.franges_valides(jsonb) to authenticated, service_role;

alter table public.productor_ubicaciones
  add column if not exists dies_setmana int[],
  add column if not exists franges      jsonb;
alter table public.productor_ubicaciones drop constraint if exists productor_ubicaciones_dies_setmana;
alter table public.productor_ubicaciones add constraint productor_ubicaciones_dies_setmana
  check (dies_setmana <@ array[1, 2, 3, 4, 5, 6, 7]);
alter table public.productor_ubicaciones drop constraint if exists productor_ubicaciones_franges;
alter table public.productor_ubicaciones add constraint productor_ubicaciones_franges
  check (public.franges_valides(franges));
comment on column public.productor_ubicaciones.dies_setmana is
  'Días de la semana en que se puede recoger (A4, 2.5): 1 = dilluns … 7 = diumenge.';
comment on column public.productor_ubicaciones.franges is
  'Franjas horarias de recogida (A4, 2.5): [{inici:''HH:MM'', fi:''HH:MM''}], ≤4. La primera del lugar principal propone el horario de la oferta nueva.';

-- Un solo principal por productor. Antes de crear el índice, se deja uno donde hubiera varios
-- (el primero por alias) y `null` pasa a `false`.
update public.productor_ubicaciones set es_principal = false where es_principal is null;
update public.productor_ubicaciones pu set es_principal = false
 where pu.es_principal
   and exists (select 1 from public.productor_ubicaciones o
                where o.productor_id = pu.productor_id and o.es_principal
                  and (coalesce(o.alias, ''), o.id) < (coalesce(pu.alias, ''), pu.id));
create unique index if not exists productor_ubicaciones_un_principal
  on public.productor_ubicaciones (productor_id) where es_principal;

-- El primer lugar de un productor nace principal; si se borra el principal, lo pasa a ser el
-- primero que quede (por alias). Así la oferta nueva tiene siempre de dónde proponer.
create or replace function public.trg_ubicacio_principal()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.productor_id is not null and coalesce(new.es_principal, false) = false
       and not exists (select 1 from productor_ubicaciones
                        where productor_id = new.productor_id and es_principal) then
      new.es_principal := true;
    end if;
    return new;
  end if;
  -- DELETE (after, por fila): al final de la sentencia; si se borran todos, no queda a quién.
  if old.es_principal and old.productor_id is not null
     and not exists (select 1 from productor_ubicaciones
                      where productor_id = old.productor_id and es_principal) then
    update productor_ubicaciones set es_principal = true
     where id = (select id from productor_ubicaciones
                  where productor_id = old.productor_id
                  order by coalesce(alias, ''), id limit 1);
  end if;
  return old;
end;
$function$;
revoke execute on function public.trg_ubicacio_principal() from public, anon, authenticated;

drop trigger if exists ubicacio_principal_alta on public.productor_ubicaciones;
create trigger ubicacio_principal_alta
  before insert on public.productor_ubicaciones
  for each row execute function public.trg_ubicacio_principal();
drop trigger if exists ubicacio_principal_baixa on public.productor_ubicaciones;
create trigger ubicacio_principal_baixa
  after delete on public.productor_ubicaciones
  for each row execute function public.trg_ubicacio_principal();

-- Productores que ya tenían lugares y ningún principal: el primero por alias.
update public.productor_ubicaciones pu set es_principal = true
 where pu.id in (
   select distinct on (productor_id) id
     from public.productor_ubicaciones
    where productor_id is not null
      and productor_id not in (select productor_id from public.productor_ubicaciones
                                where es_principal and productor_id is not null)
    order by productor_id, coalesce(alias, ''), id);

-- RPC: marcar el lugar principal (desmarca los demás en la misma transacción).
-- El permiso va antes que la existencia (§4bis): quien no tiene ninguna ficha de productor
-- recibe 42501 aunque el uuid no exista; el titular con un uuid inventado, 22023.
create or replace function public.fixar_lloc_principal(p_lloc uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_prod uuid;
begin
  if auth.uid() is not null and not public.es_intern()
     and not exists (select 1 from public.mis_productores()) then
    raise exception 'Nomes l''equip o el productor poden triar el lloc principal' using errcode = '42501';
  end if;
  select productor_id into v_prod from productor_ubicaciones where id = p_lloc;
  if v_prod is null then
    raise exception 'lloc_inexistent' using errcode = '22023';
  end if;
  if auth.uid() is not null and not public.es_intern()
     and not (v_prod in (select public.mis_productores())) then
    raise exception 'Aquest lloc no es teu' using errcode = '42501';
  end if;
  update productor_ubicaciones set es_principal = false
   where productor_id = v_prod and es_principal and id <> p_lloc;
  update productor_ubicaciones set es_principal = true where id = p_lloc and not es_principal;
end;
$function$;
revoke execute on function public.fixar_lloc_principal(uuid) from public, anon;
grant execute on function public.fixar_lloc_principal(uuid) to authenticated, service_role;
comment on function public.fixar_lloc_principal(uuid) is
  'Marca el lugar de recogida principal de un productor (A4) y desmarca los demás. Equipo o cuenta del productor (mis_productores); 42501 a los demás (antes que la existencia), 22023 lloc_inexistent.';

-- ---------------------------------------------------------------------------
-- 4. Lista blanca del actor (D5: el productor edita su Operativa)
-- ---------------------------------------------------------------------------
-- ⚠️ `tests/campsFitxa.test.ts` lee las claves `d ? '…'` de la ÚLTIMA definición de esta
--    función y las compara con `campsFitxa.ts` (`edita: 'tots'`). Misma firma que la vigente.
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
  foreach k in array array['facturacio_anual_eur', 'volum_comercialitzat_kg'] loop
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
    facturacio_anual_eur = case when d ? 'facturacio_anual_eur' then (d->>'facturacio_anual_eur')::numeric else facturacio_anual_eur end,
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

-- ---------------------------------------------------------------------------
-- 5. El cuestionario v3: sin las preguntas que ahora son la Operativa de la ficha
-- ---------------------------------------------------------------------------
-- Se publica una versión nueva (el cuestionario citado no se edita: trigger
-- `questionaris_inmutables`). Salen familias, productos, principales, volumen, temporada y
-- lugares (a la ficha), `suport` (a `suport_interes`, P6) y la logística (`logistica_modes`,
-- `condicions_logistiques`: la fila 2.5 dice «no afegir ara» transporte ni condiciones). Lo
-- demás (excedentes, previsión, gestión actual, causas, salidas) sigue igual hasta A3.
do $$
declare
  v2 questionaris_diagnostic%rowtype;
begin
  if exists (select 1 from questionaris_diagnostic where tipo_org = 'productor' and versio = 3) then
    return;
  end if;
  select * into v2 from questionaris_diagnostic where tipo_org = 'productor' and versio = 2;
  if v2.id is null then
    return;
  end if;
  update questionaris_diagnostic set vigente = false where tipo_org = 'productor' and vigente;
  insert into questionaris_diagnostic (tipo_org, versio, provisional, vigente, titol, preguntes)
  select 'productor', 3, v2.provisional, true, v2.titol,
         (select jsonb_agg(e order by i)
            from jsonb_array_elements(v2.preguntes) with ordinality as x(e, i)
           where e ->> 'id' not in ('families', 'productes', 'productes_principals', 'volum_producte',
                                    'temporada', 'ubicacions', 'logistica_modes', 'condicions_logistiques',
                                    'suport'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Lo que el diagnóstico tenía y la ficha no: a la ficha (solo huecos)
-- ---------------------------------------------------------------------------
-- `productos_habituales` y `temporada` ya los derivaba `desar_diagnostic`. Principales, volumen
-- y `suport` vivían solo en las respuestas: pasan a la ficha donde esté vacío.
update public.productores pr set
  productes_principals = coalesce(pr.productes_principals,
    nullif(array(select jsonb_array_elements_text(d.respostes -> 'productes_principals')), '{}'::text[])),
  volum_produccio = coalesce(pr.volum_produccio,
    nullif((select jsonb_object_agg(k, v) from jsonb_each(d.respostes -> 'volum_producte') as e(k, v)
             where jsonb_typeof(v) = 'number'), '{}'::jsonb)),
  suport_interes = coalesce(pr.suport_interes,
    nullif(array(select s from jsonb_array_elements_text(d.respostes -> 'suport') s
                  where s in ('compradors', 'donacions', 'transformacio', 'logistica', 'prevencio', 'anticipar', 'altres')),
           '{}'::text[]))
  from public.diagnostics d
 where d.productor_id = pr.id
   and jsonb_typeof(d.respostes) = 'object'
   and (jsonb_typeof(d.respostes -> 'productes_principals') = 'array'
     or jsonb_typeof(d.respostes -> 'volum_producte') = 'object'
     or jsonb_typeof(d.respostes -> 'suport') = 'array');

-- ---------------------------------------------------------------------------
-- 7. `desar_diagnostic` deja de derivar a la ficha (T4: la ficha es el origen)
-- ---------------------------------------------------------------------------
-- Idéntica a la de A1 (20270520100000) salvo el final: ya no escribe `productos_habituales`
-- ni `temporada`. Misma firma y mismas claves de vuelta.
create or replace function public.desar_diagnostic(p_tipo_org text, p_org uuid, p_respostes jsonb,
  p_notes text default null::text, p_idioma text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  q        questionaris_diagnostic%rowtype;
  d        diagnostics%rowtype;
  pr       jsonb;
  v_sobre  jsonb;
  v_falten text[];
  v_val    jsonb;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  -- D5: el diagnóstico lo conduce el equipo. `auth.uid() is null` = `service_role`.
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'El diagnostic l''actualitza l''equip de Redestina' using errcode = '42501';
  end if;
  if p_tipo_org <> 'productor' then
    raise exception 'nomes_productors: el diagnostic operatiu es de les entitats productores'
      using errcode = '22023';
  end if;
  if p_respostes is null or jsonb_typeof(p_respostes) <> 'object' then
    raise exception 'Les respostes han de ser un objecte {pregunta_id: valor}' using errcode = '22023';
  end if;
  if p_idioma is not null and p_idioma not in ('ca', 'es') then
    raise exception 'Idioma desconegut: %', p_idioma using errcode = '22023';
  end if;
  if not exists (select 1 from productores where id = p_org) then
    raise exception 'fitxa_inexistent' using errcode = '22023';
  end if;

  select * into q from questionaris_diagnostic
   where tipo_org = p_tipo_org and vigente limit 1;
  if q.id is null then
    raise exception 'sense_questionari: no hi ha cap questionari vigent per a % ', p_tipo_org
      using errcode = '22023';
  end if;

  -- Lo que la base comprueba de los tipos nuevos: el máximo de productos y que los lugares
  -- sean de esta organización (si no, el diagnóstico citaría la finca de otro).
  for pr in select * from jsonb_array_elements(q.preguntes) loop
    v_val := p_respostes -> (pr ->> 'id');
    if v_val is null or jsonb_typeof(v_val) = 'null' then
      continue;
    end if;
    if pr ->> 'tipus' = 'productes' and pr ? 'max' and jsonb_typeof(v_val) = 'array'
       and jsonb_array_length(v_val) > (pr ->> 'max')::int then
      raise exception 'massa_productes: com a maxim % a "%"', pr ->> 'max', pr ->> 'id'
        using errcode = '22023';
    end if;
    if pr ->> 'tipus' = 'ubicacio' then
      if jsonb_typeof(v_val) <> 'array' or exists (
           select 1 from jsonb_array_elements_text(v_val) u
            where u !~ '^[0-9a-f-]{36}$'
               or not exists (select 1 from productor_ubicaciones pu
                               where pu.id = u::uuid and pu.productor_id = p_org)) then
        raise exception 'ubicacio_aliena: algun lloc no es d''aquesta organitzacio' using errcode = '22023';
      end if;
    end if;
  end loop;

  v_falten := public.diagnostic_falten(q.preguntes, p_respostes);
  v_sobre  := public.diagnostic_compon_sobre(q, p_org, p_respostes, p_notes);

  insert into diagnostics (
    productor_id, questionari_id, versio_questionari, respostes, sobre,
    complet, falten, notes, idioma, actualitzat_at, actualitzat_per)
  values (
    p_org, q.id, q.versio, p_respostes, v_sobre,
    coalesce(array_length(v_falten, 1), 0) = 0, v_falten, p_notes, p_idioma, now(), auth.uid())
  on conflict (productor_id) do update
     set questionari_id     = excluded.questionari_id,
         versio_questionari = excluded.versio_questionari,
         respostes          = excluded.respostes,
         sobre              = excluded.sobre,
         complet            = excluded.complet,
         falten             = excluded.falten,
         notes              = excluded.notes,
         idioma             = coalesce(excluded.idioma, diagnostics.idioma),
         actualitzat_at     = excluded.actualitzat_at,
         actualitzat_per    = excluded.actualitzat_per
  returning * into d;

  -- A4 (T4): ya NO se deriva nada a la ficha. Productos, principales, temporada y lugares
  -- son la Operativa de `productores` / `productor_ubicaciones`, y se editan allí.

  return jsonb_build_object(
    'pla',                     null,
    'diagnostic_id',           d.id,
    'questionari_id',          q.id,
    'versio_questionari',      q.versio,
    'questionari_provisional', q.provisional,
    'falten',                  to_jsonb(v_falten),
    'complet',                 d.complet,
    'mesures_editades',        false,
    'te_mesures',              false,
    'mesures_n',               0,
    'generacio',               null);
end;
$function$;
revoke execute on function public.desar_diagnostic(text, uuid, jsonb, text, text) from public, anon;
grant execute on function public.desar_diagnostic(text, uuid, jsonb, text, text) to authenticated, service_role;
comment on function public.desar_diagnostic(text, uuid, jsonb, text, text) is
  'Guarda (sobrescribe) el diagnóstico operativo de un productor en `diagnostics` (A1). Solo el equipo (42501 a cualquier externo, también sobre la suya: D5). Desde A4 no deriva nada a la ficha (la Operativa es el origen). 22023: tipo desconocido, nomes_productors, fitxa_inexistent, sense_questionari, massa_productes, ubicacio_aliena.';

-- ---------------------------------------------------------------------------
-- 8. `diagnostic_datos` añade la Operativa (lectura y, en A2, el PDF)
-- ---------------------------------------------------------------------------
-- Mismo cuerpo que la de A1 más la clave `operativa`, leída de la ficha en el momento: el
-- cuestionario v3 ya no la pregunta, así que sin esto el resumen la perdería.
create or replace function public.diagnostic_datos(p_tipo_org text, p_org uuid, p_user uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  q     questionaris_diagnostic%rowtype;
  d     diagnostics%rowtype;
  v_org jsonb;
  v_op  jsonb;
  v_nom text;
begin
  if auth.uid() is not null then
    if p_user is not null and p_user <> auth.uid() then
      raise exception 'No pots consultar el diagnostic com una altra persona' using errcode = '42501';
    end if;
    if not public.puc_gestionar_pla(p_tipo_org, p_org) then
      raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
    end if;
  else
    if p_user is null then
      raise exception 'falta_usuari: cal dir per a qui es la lectura' using errcode = '22023';
    end if;
    -- Lo mismo que `es_intern()` y `mis_productores()/mis_entidades()`, para `p_user`.
    if not (
         not public.roles_activos()
      or exists (select 1 from usuario_roles r join perfiles p on p.id = r.user_id
                  where r.user_id = p_user and p.activo
                    and r.rol in ('super_admin', 'admin', 'tecnic'))
      or exists (select 1 from membresias m join perfiles p on p.id = m.user_id
                  where m.user_id = p_user and m.activo and m.aprovacio = 'aprovada' and p.activo
                    and ((p_tipo_org = 'productor' and m.productor_id = p_org)
                      or (p_tipo_org <> 'productor' and m.entidad_id = p_org)))) then
      raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
    end if;
  end if;

  if p_tipo_org is distinct from 'productor' then
    raise exception 'nomes_productors: el diagnostic operatiu es de les entitats productores'
      using errcode = '22023';
  end if;
  select jsonb_build_object('nom', coalesce(pr.empresa, pr.name), 'nif', pr.nif, 'municipi', pr.poblacion),
         jsonb_build_object(
           'activitat',               to_jsonb(pr.tipus_activitat),
           'productes',               to_jsonb(pr.productos_habituales),
           'principals',              to_jsonb(pr.productes_principals),
           'varietats',               pr.varietats,
           'volum',                   pr.volum_produccio,
           'temporada',               pr.temporada,
           'envasos',                 to_jsonb(pr.envasos_habituals),
           'canals',                  to_jsonb(pr.canals_comercials),
           'clients',                 to_jsonb(pr.tipologia_clients),
           'facturacio_eur',          pr.facturacio_anual_eur,
           'facturacio_rang',         pr.facturacio_rang,
           'volum_comercialitzat_kg', pr.volum_comercialitzat_kg,
           'suport',                  to_jsonb(pr.suport_interes),
           'llocs', (select coalesce(jsonb_agg(jsonb_build_object(
                              'alias', u.alias, 'municipi', u.municipio, 'principal', coalesce(u.es_principal, false),
                              'dies', to_jsonb(u.dies_setmana), 'franges', u.franges, 'horari', u.horario)
                            order by coalesce(u.es_principal, false) desc, coalesce(u.alias, ''), u.id), '[]'::jsonb)
                       from productor_ubicaciones u where u.productor_id = pr.id))
    into v_org, v_op from productores pr where pr.id = p_org;
  if v_org is null then
    raise exception 'fitxa_inexistent' using errcode = '22023';
  end if;

  select * into d from diagnostics where productor_id = p_org;
  -- El cuestionario con el que se contestó; si no hay diagnóstico, el vigente.
  if d.questionari_id is not null then
    select * into q from questionaris_diagnostic where id = d.questionari_id;
  else
    select * into q from questionaris_diagnostic where tipo_org = 'productor' and vigente limit 1;
  end if;
  if d.actualitzat_per is not null then
    select nullif(btrim(p.nombre), '') into v_nom
      from perfiles p where p.id = d.actualitzat_per;
  end if;

  return jsonb_build_object(
    'diagnostic_id',       d.id,
    'organitzacio',        v_org,
    'operativa',           v_op,
    'questionari',         case when q.id is not null then
                             jsonb_build_object('titol', q.titol, 'versio', q.versio, 'provisional', q.provisional)
                           end,
    'respostes',           coalesce(d.sobre -> 'respostes', '[]'::jsonb),
    'notes',               d.notes,
    'complet',             coalesce(d.complet, false),
    'falten',              to_jsonb(coalesce(d.falten, '{}'::text[])),
    'actualitzat_at',      d.actualitzat_at,
    'actualitzat_per_nom', v_nom,
    'provisional',         coalesce(q.provisional, true));
end;
$function$;
revoke execute on function public.diagnostic_datos(text, uuid, uuid) from public, anon;
grant execute on function public.diagnostic_datos(text, uuid, uuid) to authenticated, service_role;
comment on function public.diagnostic_datos(text, uuid, uuid) is
  'El diagnóstico de un productor para leerlo (A1) y su Operativa de la ficha (A4, clave `operativa`): organitzacio, operativa, questionari, respostes (legibles, del sobre), notes, complet, falten, actualitzat_at/per_nom, provisional. Con sesión: puc_gestionar_pla(); con service_role: p_user obligatorio (22023 falta_usuari) y la misma comprobación para él. 42501 antes que 22023 nomes_productors / fitxa_inexistent.';
