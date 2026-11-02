-- Plan 1 · rebanada 1B (02-11-2026): «Nova entitat» en dos pasos.
--
-- POR QUÉ. El paso 2 del alta crea una organización con UNO O LOS DOS papeles (ofertante,
-- receptor). Con escritura directa eso son dos INSERT y la organización que estrena el
-- trigger del primero: si el segundo falla (el correo ya lo tiene otra ficha, un NIF en uso),
-- queda media organización creada. P2 del plan: una RPC transaccional. Se usa para TODA alta
-- desde el panel, con uno o con dos papeles: un solo camino, y las reglas viven en el
-- servidor y no solo en la pantalla.
--
-- SOLO AÑADE (§7): una función nueva. El alta de un papel de 1C (escritura directa,
-- RLS `alta intern`) sigue funcionando para el frontend vigente hasta que se publique este.
--
-- Reglas del alta (decisiones de 1B, anotadas en AGENTS §4bis y context/04bis):
--   · La entidad NACE ACTIVA (`activo` default true), así que se le exige lo mismo que a
--     una que se activa (D2, P9): NIF presente y válido y razón social. El trigger
--     `trg_fitxa_estat()` solo mira los UPDATE de `activo`; aquí se comprueba al crear.
--   · El NIF repetido lo corta el trigger del NIF (`nif_en_us`) también al insertar.
--   · Un receptor necesita `tipo_receptor`: sin él no ve ninguna oferta en el Mercat
--     (`modalitat_receptor_compat`) y nada se lo diría.
--   · Las actividades se reparten por papel con el catálogo (`tipus_activitat.aplica`).
--   · Puede cualquiera del equipo (`es_intern()`), como el alta directa de hoy; activar una
--     ficha que ya existe sigue siendo de `pot_aprovar()` (1A).
--   · Deja rastro en `fitxa_estat_hist` (quién la creó activa), como un cambio de estado.

-- ⚠️ `tests/campsFitxa.test.ts` lee las claves `d->>'…'` / `d->'…'` de esta función y las
--    compara con `CLAUS_ALTA` de `src/lib/campsFitxa.ts`: si se añade un campo al alta en
--    un lado y no en el otro, la prueba falla.
create or replace function public.crear_entitat(p_dades jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d        jsonb := coalesce(p_dades, '{}'::jsonb);
  v_rols   text[];
  v_nom    text;
  v_rao    text;
  v_nif    text;
  v_te     text;
  v_pers   text;
  v_email  text;
  v_tel    text;
  v_dir    text;
  v_cp     text;
  v_mun    text;
  v_tr     text;
  v_test   boolean;
  v_act    text[];
  v_act_p  text[];
  v_act_e  text[];
  v_org    uuid;
  v_prod   uuid;
  v_ent    uuid;
begin
  if auth.uid() is null or not public.es_intern() then
    raise exception 'Nomes l''equip pot donar d''alta una entitat' using errcode = '42501';
  end if;

  -- Los papeles: uno o los dos.
  if jsonb_typeof(d->'rols') is distinct from 'array' then
    raise exception 'cal_paper: tria almenys un paper' using errcode = '22023';
  end if;
  v_rols := array(select distinct x from jsonb_array_elements_text(d->'rols') x);
  if cardinality(v_rols) = 0 then
    raise exception 'cal_paper: tria almenys un paper' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_rols) x where x not in ('productor', 'entidad')) then
    raise exception 'paper_desconegut' using errcode = '22023';
  end if;

  v_nom   := nullif(btrim(coalesce(d->>'nom_comercial', '')), '');
  v_rao   := nullif(btrim(coalesce(d->>'razon_social', '')), '');
  v_nif   := nullif(upper(regexp_replace(coalesce(d->>'nif', ''), '[\s.\-]', '', 'g')), '');
  v_te    := nullif(btrim(coalesce(d->>'tipus_empresa', '')), '');
  v_pers  := nullif(btrim(coalesce(d->>'persona_contacte', '')), '');
  v_email := nullif(lower(btrim(coalesce(d->>'email', ''))), '');
  v_tel   := nullif(regexp_replace(coalesce(d->>'telefon', ''), '\D', '', 'g'), '');
  v_dir   := nullif(btrim(coalesce(d->>'direccion', '')), '');
  v_cp    := nullif(btrim(coalesce(d->>'codigo_postal', '')), '');
  v_mun   := nullif(btrim(coalesce(d->>'municipio_ine', '')), '');
  v_tr    := nullif(btrim(coalesce(d->>'tipo_receptor', '')), '');
  v_test  := coalesce((d->>'es_test')::boolean, false);

  -- Lo que exige nacer activa (mismo orden y mismos códigos que el trigger de 1A).
  if v_nom is null then
    raise exception 'cal_nom_comercial: cal el nom comercial' using errcode = '22023';
  end if;
  if v_nif is null then
    raise exception 'falta_nif: cal el NIF per donar-la d''alta activa' using errcode = '22023';
  end if;
  if not public.nif_valid(v_nif) then
    raise exception 'nif_invalid: el NIF % no es valid', v_nif using errcode = '22023';
  end if;
  if v_rao is null then
    raise exception 'falta_rao_social: cal la rao social per donar-la d''alta activa' using errcode = '22023';
  end if;

  if not public.tipus_empresa_valid(v_te, null) then
    raise exception 'tipus d''entitat desconegut: %', v_te using errcode = '22023';
  end if;
  if v_mun is not null and not exists (select 1 from municipios where codi_ine = v_mun) then
    raise exception 'municipi desconegut' using errcode = '22023';
  end if;
  if 'entidad' = any(v_rols) then
    if v_tr is null then
      raise exception 'cal_tipus_receptor: tria el tipus de receptor' using errcode = '22023';
    end if;
    if v_tr not in ('social', 'animal', 'transformador', 'comercial') then
      raise exception 'tipo_receptor_desconegut' using errcode = '22023';
    end if;
  end if;

  -- Las actividades: cada una tiene que aplicar a alguno de los papeles elegidos, y cada
  -- ficha guarda las suyas (las `ambdos`, en las dos).
  if d ? 'tipus_activitat' and jsonb_typeof(d->'tipus_activitat') is distinct from 'array' then
    raise exception 'tipus_activitat_desconegut' using errcode = '22023';
  end if;
  v_act := array(select distinct x from jsonb_array_elements_text(coalesce(d->'tipus_activitat', '[]'::jsonb)) x);
  if exists (select 1 from unnest(v_act) x
              where not exists (select 1 from tipus_activitat ta
                                 where ta.codi = x
                                   and (ta.aplica = 'ambdos' or ta.aplica = any(v_rols)))) then
    raise exception 'tipus_activitat_desconegut' using errcode = '22023';
  end if;
  v_act_p := array(select ta.codi from tipus_activitat ta
                    where ta.codi = any(v_act) and ta.aplica in ('productor', 'ambdos') order by ta.ordre);
  v_act_e := array(select ta.codi from tipus_activitat ta
                    where ta.codi = any(v_act) and ta.aplica in ('entidad', 'ambdos') order by ta.ordre);

  -- Las fichas. La primera estrena la organización (trigger `*_estrena_organizacion`); la
  -- segunda se cuelga de ella, y el trigger del NIF deja compartirlo dentro de la misma.
  -- Un correo o teléfono que ya tiene otra ficha de productor (índices únicos) deshace todo.
  begin
    if 'productor' = any(v_rols) then
      insert into productores (name, empresa, razon_social, nif, tipo_empresa, tipus_activitat,
                               email, phone, direccion, codigo_postal, municipio_ine, es_test)
      values (coalesce(v_pers, v_nom), v_nom, v_rao, v_nif, v_te, v_act_p,
              v_email, v_tel, v_dir, v_cp, v_mun, v_test)
      returning id, organizacion_id into v_prod, v_org;
    end if;
    if 'entidad' = any(v_rols) then
      insert into entidades (nombre, razon_social, nif, tipo_entidad, tipus_activitat, contacto,
                             email, telefono, direccion, codigo_postal, municipio_ine, tipo_receptor,
                             es_test, organizacion_id)
      values (v_nom, v_rao, v_nif, v_te, v_act_e, v_pers,
              v_email, v_tel, v_dir, v_cp, v_mun, v_tr,
              v_test, v_org)
      returning id, organizacion_id into v_ent, v_org;
    end if;
  exception when unique_violation then
    raise exception 'dades_en_us: el correu o el telefon ja els te una altra fitxa' using errcode = '22023';
  end;

  -- Quién la dio de alta activa: el mismo rastro que un cambio de estado.
  if v_prod is not null then
    insert into fitxa_estat_hist (tipus, productor_id, activo, per) values ('productor', v_prod, true, auth.uid());
  end if;
  if v_ent is not null then
    insert into fitxa_estat_hist (tipus, entidad_id, activo, per) values ('entidad', v_ent, true, auth.uid());
  end if;

  return jsonb_build_object('organizacion_id', v_org, 'productor_id', v_prod, 'entidad_id', v_ent);
end;
$$;

-- Sin EXECUTE para `service_role` ni sin sesión: ningún job da de alta entidades (la
-- importación de 1E escribe con su propio script y entra inactiva).
revoke execute on function public.crear_entitat(jsonb) from public, anon, service_role;
grant execute on function public.crear_entitat(jsonb) to authenticated;

comment on function public.crear_entitat(jsonb) is
  '1B (20270501300000): alta de una entidad con uno o dos papeles en una transacción. Nace activa: exige NIF válido, razón social y, si es receptor, tipo_receptor. Solo equipo con sesión.';
