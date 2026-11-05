-- Importador de entidades desde Excel (super_admin): idempotente y sin duplicados.
--
-- POR QUÉ. El equipo tiene sus organizaciones en hojas de cálculo (Airtable, el ARA, listas
-- propias). El navegador lee el Excel y manda las filas ya mapeadas a un contrato fijo
-- (jsonb); **la base revalida todo y nunca se fía del cliente**: recalcula la identidad de
-- cada fila al importar (no la que enseñó la previsualización), descarta lo que no cumple
-- las listas cerradas y deja constancia de cada fila en un registro.
--
-- Qué hace esta migración:
--   0. Factoriza el núcleo del alta de `crear_entitat()` en `alta_fitxa_interna()` (interna,
--      sin EXECUTE para nadie): inserta las fichas de uno o dos papeles en UNA organización,
--      activas o inactivas, y deja el rastro en `fitxa_estat_hist`. `crear_entitat()` se
--      comporta exactamente igual que antes (mismas validaciones, mismos errores, mismo
--      resultado); la importación usa el mismo núcleo para crear inactivas.
--   1. Dos tablas de registro: `importacions_entitats` (una por lote) e
--      `importacions_entitats_files` (una por fila). Lectura del equipo; nadie escribe directo.
--   2. Las funciones internas de la importación (`importacio_*`).
--   3. Dos RPC del super_admin: `previsualitzar_importacio_entitats(p_files)` (no escribe)
--      e `importar_entitats(p_fitxer, p_files)`. Las dos pasan por el MISMO código
--      (`importacio_processa`), así que la previsualización dice exactamente lo que hará la
--      importación con la base en el mismo estado.
--
-- Reglas de identidad (en este orden; una coincidencia «débil» nunca une sola):
--   1. NIF válido en `productores` o `entidades` → su organización.
--   2. `airtable_id` → `ref_externa = 'AIRTABLE:<id>'`.
--   3. Sin NIF → `ref_externa = 'IMP:<sha256(nom normalitzat | municipio_ine)>'`.
--   4. Si nada de eso: correo exacto, teléfono por las últimas 9 cifras o nombre con
--      similitud ≥ 0,65 → fila «dubtosa» con candidatos; la decide la persona (`decisio`).
--
-- Lo que nunca hace: pisar un valor (solo rellena huecos), tocar `activo`, `es_test` ni
-- `ref_externa` de una ficha existente, ni dar de alta una ficha activa. SOLO AÑADE (§7).

-- ---------------------------------------------------------------------------
-- 0. El núcleo del alta, compartido
-- ---------------------------------------------------------------------------
-- `p_productor` / `p_entitat`: las columnas de la ficha (nombres reales de la tabla), ya
-- normalizadas y validadas por quien llama. `p_org` null = organización nueva (la estrena el
-- trigger de la primera ficha); con valor, las fichas cuelgan de ella (añadir un papel).
create or replace function public.alta_fitxa_interna(
  p_rols      text[],
  p_org       uuid,
  p_activo    boolean,
  p_productor jsonb,
  p_entitat   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p      jsonb := coalesce(p_productor, '{}'::jsonb);
  e      jsonb := coalesce(p_entitat, '{}'::jsonb);
  v_org  uuid := p_org;
  v_prod uuid;
  v_ent  uuid;
begin
  if p_activo is null or p_rols is null or cardinality(p_rols) = 0 then
    raise exception 'alta_fitxa_interna: falten arguments' using errcode = '22023';
  end if;

  -- Un correo o teléfono que ya tiene otra ficha de productor (índices únicos) deshace todo.
  begin
    if 'productor' = any(p_rols) then
      insert into productores (name, empresa, razon_social, nif, tipo_empresa, tipus_activitat,
                               email, phone, telefono_alt, direccion, codigo_postal, municipio_ine,
                               ubicacio, area_geografica, comentario, ref_externa, es_test, activo,
                               organizacion_id)
      values (p->>'name', p->>'empresa', p->>'razon_social', p->>'nif', p->>'tipo_empresa',
              public.importacio_text_array(p->'tipus_activitat'),
              p->>'email', p->>'phone', p->>'telefono_alt', p->>'direccion', p->>'codigo_postal',
              p->>'municipio_ine', p->>'ubicacio', p->>'area_geografica', p->>'comentario',
              p->>'ref_externa', coalesce((p->>'es_test')::boolean, false), p_activo, v_org)
      returning id, organizacion_id into v_prod, v_org;
    end if;
    if 'entidad' = any(p_rols) then
      insert into entidades (nombre, razon_social, nif, tipo_entidad, tipus_activitat, contacto,
                             email, email2, telefono, telefono2, direccion, codigo_postal,
                             municipio_ine, ubicacio, area_geografica, tipo_receptor,
                             modalitats_interes, comentarios, ref_externa, es_test, activo,
                             organizacion_id)
      values (e->>'nombre', e->>'razon_social', e->>'nif', e->>'tipo_entidad',
              public.importacio_text_array(e->'tipus_activitat'), e->>'contacto',
              e->>'email', e->>'email2', e->>'telefono', e->>'telefono2', e->>'direccion',
              e->>'codigo_postal', e->>'municipio_ine', e->>'ubicacio', e->>'area_geografica',
              e->>'tipo_receptor', public.importacio_text_array(e->'modalitats_interes'),
              e->>'comentarios', e->>'ref_externa', coalesce((e->>'es_test')::boolean, false),
              p_activo, v_org)
      returning id, organizacion_id into v_ent, v_org;
    end if;
  exception when unique_violation then
    raise exception 'dades_en_us: el correu o el telefon ja els te una altra fitxa' using errcode = '22023';
  end;

  -- Quién la dio de alta y en qué estado: el mismo rastro que un cambio de estado.
  if v_prod is not null then
    insert into fitxa_estat_hist (tipus, productor_id, activo, per) values ('productor', v_prod, p_activo, auth.uid());
  end if;
  if v_ent is not null then
    insert into fitxa_estat_hist (tipus, entidad_id, activo, per) values ('entidad', v_ent, p_activo, auth.uid());
  end if;

  return jsonb_build_object('organizacion_id', v_org, 'productor_id', v_prod, 'entidad_id', v_ent);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2a. Ayudantes puros de la importación (internos, sin EXECUTE para nadie)
-- ---------------------------------------------------------------------------

-- Un texto del jsonb, sin espacios alrededor; vacío = null.
create or replace function public.importacio_txt(p_f jsonb, p_k text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(p_f->>p_k), '');
$$;

-- Un array jsonb como text[]; cualquier otra cosa (null, escalar) = '{}'.
create or replace function public.importacio_text_array(p_j jsonb)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(p_j) = 'array'
              then array(select jsonb_array_elements_text(p_j))
              else '{}'::text[] end;
$$;

-- Un array jsonb solo si tiene algo (si no, null: así `jsonb_strip_nulls` lo quita).
create or replace function public.importacio_si_ple(p_j jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(p_j) = 'array' and jsonb_array_length(p_j) > 0 then p_j end;
$$;

-- El nombre normalizado de la clave `IMP:`: minúsculas, sin acentos, sin signos, y los
-- separadores (espacios, guion, barra, guion bajo) reducidos a un espacio
-- («Cal Pep, S.L.» y «cal pep  SL» → «cal pep sl»; «Can Roca-Vell» → «can roca vell»).
create or replace function public.importacio_nom_normalitzat(p_nom text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(lower(unaccent(coalesce(p_nom, ''))), '[^a-z0-9\s/_-]', '', 'g'),
           '[\s/_-]+', ' ', 'g')), '');
$$;

-- Las claves de teléfono de unos campos: las últimas 9 cifras del campo entero y de cada trozo
-- separado por / , ; | (un `telefono_alt` puede llevar dos números). Como `registro`.
create or replace function public.importacio_claus_telefon(p_camps text[])
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct right(dg, 9)), '{}'::text[])
    from (
      select regexp_replace(x, '\D', '', 'g') as dg
        from unnest(p_camps) as t(c), regexp_split_to_table(coalesce(t.c, ''), '[/,;|]') as x
      union all
      select regexp_replace(coalesce(t.c, ''), '\D', '', 'g')
        from unnest(p_camps) as t(c)
    ) s
   where length(dg) >= 9;
$$;

-- ¿Valor vacío? null, cadena en blanco o array vacío.
create or replace function public.importacio_buit(p_j jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_j is null
      or jsonb_typeof(p_j) = 'null'
      or (jsonb_typeof(p_j) = 'string' and btrim(p_j #>> '{}') = '')
      or (jsonb_typeof(p_j) = 'array' and jsonb_array_length(p_j) = 0);
$$;

-- ¿El valor de la ficha y el del fichero dicen lo mismo? Cada tipo con su normalización:
-- conjuntos para los arrays, minúsculas para el correo, cifras para el teléfono, el NIF sin
-- separadores y el resto sin mayúsculas, acentos ni espacios dobles.
create or replace function public.importacio_igual(p_col text, p_a jsonb, p_b jsonb)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p_a) = 'array' or jsonb_typeof(p_b) = 'array' then
      coalesce((select array_agg(distinct x order by x)
                  from jsonb_array_elements_text(case when jsonb_typeof(p_a) = 'array' then p_a else jsonb_build_array(p_a) end) x), '{}')
      = coalesce((select array_agg(distinct x order by x)
                  from jsonb_array_elements_text(case when jsonb_typeof(p_b) = 'array' then p_b else jsonb_build_array(p_b) end) x), '{}')
    when p_col in ('email', 'email2') then
      lower(btrim(p_a #>> '{}')) = lower(btrim(p_b #>> '{}'))
    when p_col in ('phone', 'telefono', 'telefono2', 'telefono3', 'telefono_alt') then
      regexp_replace(p_a #>> '{}', '\D', '', 'g') = regexp_replace(p_b #>> '{}', '\D', '', 'g')
      or (length(regexp_replace(p_a #>> '{}', '\D', '', 'g')) >= 9
          and right(regexp_replace(p_a #>> '{}', '\D', '', 'g'), 9) = right(regexp_replace(p_b #>> '{}', '\D', '', 'g'), 9))
    when p_col = 'nif' then
      upper(regexp_replace(p_a #>> '{}', '[\s.\-]', '', 'g')) = upper(regexp_replace(p_b #>> '{}', '[\s.\-]', '', 'g'))
    else
      lower(unaccent(regexp_replace(btrim(p_a #>> '{}'), '\s+', ' ', 'g')))
      = lower(unaccent(regexp_replace(btrim(p_b #>> '{}'), '\s+', ' ', 'g')))
  end;
$$;

-- Cómo se enseña un valor en un conflicto (arrays separados por comas; el municipio, por nombre).
create or replace function public.importacio_mostra(p_col text, p_j jsonb)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p_j) = 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(p_j) x)
    when p_col = 'municipio_ine' then
      coalesce((select public.nom_municipi_llegible(m.nom) from municipios m where m.codi_ine = p_j #>> '{}'), p_j #>> '{}')
    else p_j #>> '{}'
  end;
$$;

-- La clave del contrato de la fila (la que la interfaz traduce) de cada columna real.
create or replace function public.importacio_camp(p_col text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_col
    when 'name' then 'persona_contacte'
    when 'contacto' then 'persona_contacte'
    when 'empresa' then 'nom_comercial'
    when 'nombre' then 'nom_comercial'
    when 'tipo_empresa' then 'tipus_empresa'
    when 'tipo_entidad' then 'tipus_empresa'
    when 'phone' then 'telefon'
    when 'telefono' then 'telefon'
    when 'telefono_alt' then 'telefon2'
    when 'telefono2' then 'telefon2'
    when 'municipio_ine' then 'municipi'
    when 'ubicacio' then 'municipi'
    when 'comentario' then 'nota'
    when 'comentarios' then 'nota'
    else p_col
  end;
$$;

-- El bloque de nota que se añade a `comentario`/`comentarios`: solo las líneas que el texto
-- actual todavía no contiene (así una reimportación no repite nada, aunque cambie la fecha).
create or replace function public.importacio_bloc_nota(p_actual text, p_nota text, p_linies text[], p_data text, p_fila int)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when count(*) = 0 then null
              else '[Importació ' || p_data || ' · fila ' || p_fila || ']' || E'\n'
                   || string_agg(l, E'\n' order by o) end
    from (
      select l, min(o) as o
        from unnest(array[p_nota] || coalesce(p_linies, '{}'::text[])) with ordinality as t(l, o)
       where l is not null and btrim(l) <> ''
         and (p_actual is null or strpos(p_actual, l) = 0)
       group by l
    ) s;
$$;

-- Compara lo deseado con la ficha: rellena los huecos (`patch`) y anota las diferencias.
create or replace function public.importacio_compara(p_taula text, p_actual jsonb, p_desitjat jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_patch jsonb  := '{}'::jsonb;
  v_om    text[] := '{}';
  v_cf    jsonb  := '[]'::jsonb;
  k       text;
  v       jsonb;
begin
  for k, v in select key, value from jsonb_each(coalesce(p_desitjat, '{}'::jsonb)) loop
    if public.importacio_buit(v) then
      continue;
    end if;
    if public.importacio_buit(p_actual->k) then
      v_patch := v_patch || jsonb_build_object(k, v);
      v_om := array_append(v_om, p_taula || '.' || k);
    elsif not public.importacio_igual(k, p_actual->k, v) then
      v_cf := v_cf || jsonb_build_array(jsonb_build_object(
        'taula', p_taula, 'columna', k, 'camp', public.importacio_camp(k),
        'actual', public.importacio_mostra(k, p_actual->k),
        'fitxer', public.importacio_mostra(k, v)));
    end if;
  end loop;
  return jsonb_build_object('patch', v_patch, 'omplira', to_jsonb(v_om), 'conflictes', v_cf);
end;
$$;

-- Escribe un `patch` (solo columnas de la lista cerrada de la importación) en una ficha.
-- Solo las columnas del patch entran en el SET: los triggers `update of …` ven lo que toca.
create or replace function public.importacio_actualitza(p_taula text, p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_permeses text[];
  v_set      text;
begin
  if p_taula = 'productores' then
    v_permeses := array['name', 'empresa', 'razon_social', 'nif', 'tipo_empresa', 'tipus_activitat', 'email',
                        'phone', 'telefono_alt', 'direccion', 'codigo_postal', 'municipio_ine', 'ubicacio',
                        'area_geografica', 'comentario'];
  elsif p_taula = 'entidades' then
    v_permeses := array['nombre', 'razon_social', 'nif', 'tipo_entidad', 'tipus_activitat', 'contacto', 'email',
                        'email2', 'telefono', 'telefono2', 'direccion', 'codigo_postal', 'municipio_ine',
                        'ubicacio', 'area_geografica', 'tipo_receptor', 'modalitats_interes', 'comentarios'];
  else
    raise exception 'importacio_actualitza: taula desconeguda %', p_taula using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where not k = any(v_permeses)) then
    raise exception 'importacio_actualitza: columna fora de la llista' using errcode = '22023';
  end if;
  select string_agg(format('%I = r.%I', k, k), ', ') into v_set from jsonb_object_keys(p_patch) k;
  if v_set is null then
    return;
  end if;
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2',
                 p_taula, v_set, p_taula)
    using p_patch, p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2b. Normalizar una fila del contrato
-- ---------------------------------------------------------------------------
-- Devuelve la fila con los valores ya limpios, sus `avisos` (se descartó o se movió algo) y
-- sus `errors` (la fila no se puede importar), las líneas que irán a la nota (`linies`) y
-- las claves de identidad (`ref_hash`, `ref_nova`, `emails`, `tels9`, `nom_trgm`).
-- `p_munis`: {texto: codi_ine|null} ya resuelto por `municipi_de_text()` para los textos del
-- lote (una vez por texto distinto, no una por fila: recorre los 947 municipios).
create or replace function public.importacio_normalitza_fila(p_f jsonb, p_munis jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_av      text[] := '{}';
  v_er      text[] := '{}';
  v_lin     text[] := '{}';
  v_rols    text[] := '{}';
  v_nom     text;
  v_rao     text;
  v_brut    text;
  v_nif     text;
  v_te      text;
  v_in      text[];
  v_act     text[] := '{}';
  v_act_p   text[];
  v_act_e   text[];
  v_pers    text;
  v_email   text;
  v_email2  text;
  v_tel     text;
  v_tel2    text;
  v_dir     text;
  v_cp      text;
  v_mun     text;
  v_ine     text;
  v_ubi     text;
  v_area    text;
  v_comarca text;
  v_tr      text;
  v_mod     text[] := '{}';
  v_at      text;
  v_nota    text;
  v_dec     text;
  v_norm    text;
  v_hash    text;
  x         text;
begin
  -- Papeles: uno o los dos.
  if jsonb_typeof(p_f->'rols') = 'array' then
    v_rols := array(select distinct lower(btrim(r)) from jsonb_array_elements_text(p_f->'rols') r
                     where btrim(r) <> '' order by 1);
  end if;
  if cardinality(v_rols) = 0 then
    v_er := array_append(v_er, 'cal_paper');
  elsif exists (select 1 from unnest(v_rols) r where r not in ('productor', 'entidad')) then
    v_er := array_append(v_er, 'paper_desconegut');
  end if;

  v_nom := public.importacio_txt(p_f, 'nom_comercial');
  if v_nom is null then
    v_er := array_append(v_er, 'cal_nom_comercial');
  end if;
  v_rao  := public.importacio_txt(p_f, 'razon_social');
  v_pers := public.importacio_txt(p_f, 'persona_contacte');
  v_dir  := public.importacio_txt(p_f, 'direccion');
  v_at   := public.importacio_txt(p_f, 'airtable_id');
  v_nota := public.importacio_txt(p_f, 'nota');
  v_dec  := lower(public.importacio_txt(p_f, 'decisio'));

  -- NIF: inválido → la ficha entra sin NIF y el valor original va a la nota.
  v_brut := public.importacio_txt(p_f, 'nif');
  v_nif  := nullif(upper(regexp_replace(coalesce(v_brut, ''), '[\s.\-]', '', 'g')), '');
  if v_nif is null then
    v_av := array_append(v_av, 'sense_nif');
  elsif not public.nif_valid(v_nif) then
    v_av  := array_append(v_av, 'nif_invalid');
    v_lin := array_append(v_lin, 'NIF no vàlid al fitxer: ' || v_brut);
    v_nif := null;
  end if;

  -- Correos.
  v_brut := public.importacio_txt(p_f, 'email');
  if v_brut is not null then
    v_email := lower(v_brut);
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_av := array_append(v_av, 'correu_invalid');
      v_lin := array_append(v_lin, 'Correu no vàlid al fitxer: ' || v_brut);
      v_email := null;
    end if;
  end if;
  v_brut := public.importacio_txt(p_f, 'email2');
  if v_brut is not null then
    v_email2 := lower(v_brut);
    if v_email2 !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_av := array_append(v_av, 'correu2_invalid');
      v_lin := array_append(v_lin, 'Correu secundari no vàlid al fitxer: ' || v_brut);
      v_email2 := null;
    elsif v_email2 = v_email then
      v_email2 := null;
    end if;
  end if;

  -- Teléfonos: solo cifras, entre 9 y 15 (E.164).
  v_brut := public.importacio_txt(p_f, 'telefon');
  if v_brut is not null then
    v_tel := regexp_replace(v_brut, '\D', '', 'g');
    if length(v_tel) not between 9 and 15 then
      v_av := array_append(v_av, 'telefon_invalid');
      v_lin := array_append(v_lin, 'Telèfon no vàlid al fitxer: ' || v_brut);
      v_tel := null;
    end if;
  end if;
  v_brut := public.importacio_txt(p_f, 'telefon2');
  if v_brut is not null then
    v_tel2 := regexp_replace(v_brut, '\D', '', 'g');
    if length(v_tel2) not between 9 and 15 then
      v_av := array_append(v_av, 'telefon2_invalid');
      v_lin := array_append(v_lin, 'Telèfon secundari no vàlid al fitxer: ' || v_brut);
      v_tel2 := null;
    elsif v_tel2 = v_tel then
      v_tel2 := null;
    end if;
  end if;

  -- Código postal: cinco cifras o nada.
  v_cp := public.importacio_txt(p_f, 'codigo_postal');
  if v_cp is not null and v_cp !~ '^\d{5}$' then
    v_av := array_append(v_av, 'codi_postal_invalid');
    v_cp := null;
  end if;

  -- Listas cerradas: el valor que no casa se descarta con aviso, no es error.
  v_te := lower(public.importacio_txt(p_f, 'tipus_empresa'));
  if v_te is not null and not public.tipus_empresa_valid(v_te, null) then
    v_av := array_append(v_av, 'tipus_empresa_desconegut');
    v_te := null;
  end if;

  v_in := case jsonb_typeof(p_f->'tipus_activitat')
            when 'array'  then array(select lower(btrim(y)) from jsonb_array_elements_text(p_f->'tipus_activitat') y)
            when 'string' then array(select lower(btrim(y)) from regexp_split_to_table(p_f->>'tipus_activitat', '[,;]') y)
            else '{}'::text[] end;
  foreach x in array v_in loop
    continue when x = '';
    if exists (select 1 from tipus_activitat ta
                where ta.codi = x and (ta.aplica = 'ambdos' or ta.aplica = any(v_rols))) then
      if not x = any(v_act) then
        v_act := array_append(v_act, x);
      end if;
    else
      v_av := array_append(v_av, 'tipus_activitat_desconegut:' || x);
    end if;
  end loop;
  v_act_p := array(select ta.codi from tipus_activitat ta
                    where ta.codi = any(v_act) and ta.aplica in ('productor', 'ambdos') order by ta.ordre);
  v_act_e := array(select ta.codi from tipus_activitat ta
                    where ta.codi = any(v_act) and ta.aplica in ('entidad', 'ambdos') order by ta.ordre);

  if 'entidad' = any(v_rols) then
    v_in := case jsonb_typeof(p_f->'modalitats_interes')
              when 'array'  then array(select lower(btrim(y)) from jsonb_array_elements_text(p_f->'modalitats_interes') y)
              when 'string' then array(select lower(btrim(y)) from regexp_split_to_table(p_f->>'modalitats_interes', '[,;]') y)
              else '{}'::text[] end;
    foreach x in array v_in loop
      continue when x = '';
      if x in ('donacio', 'venda', 'maquila') then
        if not x = any(v_mod) then
          v_mod := array_append(v_mod, x);
        end if;
      else
        v_av := array_append(v_av, 'modalitat_desconeguda:' || x);
      end if;
    end loop;

    v_tr := lower(public.importacio_txt(p_f, 'tipo_receptor'));
    if v_tr is null then
      v_av := array_append(v_av, 'sense_tipus_receptor');
    elsif v_tr not in ('social', 'animal', 'transformador', 'comercial') then
      v_av := array_append(v_av, 'tipus_receptor_desconegut');
      v_tr := null;
    end if;
  end if;

  -- Municipio: el código INE si existe; si no, el nombre; si no casa, a la ubicación.
  v_ine := public.importacio_txt(p_f, 'municipio_ine');
  if v_ine is not null and not exists (select 1 from municipios where codi_ine = v_ine) then
    v_av := array_append(v_av, 'municipi_ine_desconegut');
    v_ine := null;
  end if;
  v_mun := public.importacio_txt(p_f, 'municipi');
  if v_ine is null and v_mun is not null then
    v_ine := case when p_munis ? v_mun then p_munis->>v_mun else public.municipi_de_text(v_mun) end;
    if v_ine is null then
      v_av := array_append(v_av, 'municipi_no_trobat');
      v_ubi := left(v_mun, 120);
    end if;
  end if;

  -- Área (comarca): de la lista; si contradice al municipio, manda el municipio.
  v_area := public.importacio_txt(p_f, 'area_geografica');
  if v_area is not null then
    select c.comarca into v_comarca from (select distinct m.comarca from municipios m) c
     where c.comarca = v_area or lower(unaccent(c.comarca)) = lower(unaccent(v_area))
     order by (c.comarca = v_area) desc limit 1;
    if v_comarca is null then
      v_av := array_append(v_av, 'area_desconeguda');
      v_area := null;
    elsif v_ine is not null
          and v_comarca is distinct from (select m.comarca from municipios m where m.codi_ine = v_ine) then
      v_av := array_append(v_av, 'area_no_coincideix');
      v_area := null;
    else
      v_area := v_comarca;
    end if;
  end if;

  -- Las claves estables.
  v_norm := public.importacio_nom_normalitzat(v_nom);
  if v_norm is not null then
    v_hash := 'IMP:' || encode(sha256(convert_to(v_norm || '|' || coalesce(v_ine, ''), 'UTF8')), 'hex');
  end if;

  return jsonb_build_object(
    'fila', (p_f->>'fila')::int,
    'rols', to_jsonb(v_rols),
    'nom', v_nom, 'rao', v_rao, 'nif', v_nif, 'te', v_te,
    'act_p', to_jsonb(v_act_p), 'act_e', to_jsonb(v_act_e),
    'pers', v_pers, 'email', v_email, 'email2', v_email2, 'tel', v_tel, 'tel2', v_tel2,
    'dir', v_dir, 'cp', v_cp, 'ine', v_ine, 'ubi', v_ubi, 'area', v_area,
    'tr', v_tr, 'mod', to_jsonb(v_mod),
    'airtable', v_at, 'nota', v_nota, 'decisio', v_dec,
    'ref_hash', v_hash,
    'ref_nova', case when v_at is not null then 'AIRTABLE:' || v_at
                     when v_nif is not null then 'IMP:NIF:' || v_nif
                     else v_hash end,
    'emails', to_jsonb(array_remove(array[v_email, v_email2], null)),
    'tels9', to_jsonb(array(select right(t, 9) from unnest(array[v_tel, v_tel2]) t where t is not null)),
    'nom_trgm', nullif(lower(unaccent(coalesce(v_nom, ''))), ''),
    'linies', to_jsonb(v_lin),
    'avisos', to_jsonb(v_av),
    'errors', to_jsonb(v_er));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2c. Aplicar (o simular) una fila sobre su organización
-- ---------------------------------------------------------------------------
-- `p_org` null = organización nueva. Con `p_aplicar = false` no escribe nada y devuelve lo
-- mismo que haría. `p_ocupats`: correos (`E:`) y teléfonos (`T:`) que filas anteriores del
-- lote ya dan a un productor (son únicos en `productores`).
create or replace function public.importacio_aplica_fila(
  p_n        jsonb,
  p_org      uuid,
  p_aplicar  boolean,
  p_ocupats  text[],
  p_data     text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_fila     int := (p_n->>'fila')::int;
  v_rols     text[] := public.importacio_text_array(p_n->'rols');
  v_lin      text[] := public.importacio_text_array(p_n->'linies');
  p          productores%rowtype;
  e          entidades%rowtype;
  v_te_p     boolean := false;
  v_te_e     boolean := false;
  v_lin_x    text[];
  v_email_p  text := p_n->>'email';
  v_tel_p    text := p_n->>'tel';
  v_des      jsonb;
  v_germ     jsonb;
  v_cmp      jsonb;
  v_patch    jsonb;
  v_bloc     text;
  v_ref      text;
  v_nif_germ text;
  v_omplira  text[] := '{}';
  v_confl    jsonb := '[]'::jsonb;
  v_av       text[] := '{}';
  v_ocupa    text[] := '{}';
  v_crea     text[] := '{}';
  v_nou_p    jsonb;
  v_nou_e    jsonb;
  v_res      jsonb;
  v_org      uuid := p_org;
  v_prod     uuid;
  v_ent      uuid;
  v_accio    text;
begin
  if p_org is not null then
    select * into p from productores where organizacion_id = p_org;
    v_te_p := found;
    select * into e from entidades where organizacion_id = p_org;
    v_te_e := found;
    v_prod := p.id;
    v_ent  := e.id;
  end if;

  -- El NIF de la organización, si ya lo tiene una ficha: un papel nuevo no estrena otro.
  v_nif_germ := coalesce(
    case when v_te_p and nullif(p.nif, '') is not null and public.nif_valid(p.nif) then p.nif end,
    case when v_te_e and nullif(e.nif, '') is not null and public.nif_valid(e.nif) then e.nif end);
  if v_nif_germ is not null and p_n->>'nif' is not null and p_n->>'nif' <> v_nif_germ
     and ((('productor' = any(v_rols)) and not v_te_p) or (('entidad' = any(v_rols)) and not v_te_e)) then
    v_av  := array_append(v_av, 'nif_diferent_germana');
    v_lin := array_append(v_lin, 'NIF del fitxer, diferent del de la fitxa germana: ' || (p_n->>'nif'));
  end if;

  -- ── Productor ────────────────────────────────────────────────────────────
  if 'productor' = any(v_rols) then
    v_lin_x := v_lin;
    if not v_te_p and v_te_e then
      -- Papel nuevo: lo que falte, de la ficha hermana.
      v_email_p := coalesce(v_email_p, nullif(lower(btrim(e.email)), ''));
      v_tel_p   := coalesce(v_tel_p, nullif(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g'), ''));
    end if;
    -- `email` y `phone` son únicos en `productores`: si ya los usa otra ficha, a la nota.
    if v_email_p is not null and (not v_te_p or public.importacio_buit(to_jsonb(p.email)))
       and (('E:' || v_email_p) = any(p_ocupats)
            or exists (select 1 from productores x
                        where lower(btrim(x.email)) = v_email_p and x.id is distinct from p.id)) then
      v_av    := array_append(v_av, 'correu_en_us');
      v_lin_x := array_append(v_lin_x, 'Correu ja en ús en una altra fitxa: ' || v_email_p);
      v_email_p := null;
    end if;
    if v_tel_p is not null and (not v_te_p or public.importacio_buit(to_jsonb(p.phone)))
       and (('T:' || v_tel_p) = any(p_ocupats)
            or exists (select 1 from productores x
                        where (x.phone = v_tel_p or regexp_replace(coalesce(x.phone, ''), '\D', '', 'g') = v_tel_p)
                          and x.id is distinct from p.id)) then
      v_av    := array_append(v_av, 'telefon_en_us');
      v_lin_x := array_append(v_lin_x, 'Telèfon ja en ús en una altra fitxa: ' || v_tel_p);
      v_tel_p := null;
    end if;
    -- `productores` no tiene segundo correo.
    if p_n->>'email2' is not null then
      v_av    := array_append(v_av, 'correu2_a_nota');
      v_lin_x := array_append(v_lin_x, 'Correu secundari: ' || (p_n->>'email2'));
    end if;

    v_des := jsonb_strip_nulls(jsonb_build_object(
      'name', p_n->>'pers', 'empresa', p_n->>'nom', 'razon_social', p_n->>'rao', 'nif', p_n->>'nif',
      'tipo_empresa', p_n->>'te', 'tipus_activitat', public.importacio_si_ple(p_n->'act_p'),
      'email', v_email_p, 'phone', v_tel_p, 'telefono_alt', p_n->>'tel2',
      'direccion', p_n->>'dir', 'codigo_postal', p_n->>'cp', 'municipio_ine', p_n->>'ine',
      'ubicacio', p_n->>'ubi', 'area_geografica', p_n->>'area'));

    if v_te_p then
      -- Solo rellena huecos. `name` igual a `empresa` es el valor por defecto del alta (no
      -- había persona de contacto): cuenta como hueco.
      v_cmp := public.importacio_compara('productores',
                 to_jsonb(p) || case when lower(btrim(p.name)) = lower(btrim(coalesce(p.empresa, '')))
                                     then '{"name": null}'::jsonb else '{}'::jsonb end,
                 v_des);
      v_patch := v_cmp->'patch';
      v_omplira := v_omplira || public.importacio_text_array(v_cmp->'omplira');
      v_confl := v_confl || (v_cmp->'conflictes');
      v_bloc := public.importacio_bloc_nota(p.comentario, p_n->>'nota', v_lin_x, p_data, v_fila);
      if v_bloc is not null then
        v_patch := v_patch || jsonb_build_object('comentario', coalesce(p.comentario || E'\n\n', '') || v_bloc);
        v_omplira := array_append(v_omplira, 'productores.comentario');
      end if;
      if v_patch <> '{}'::jsonb and p_aplicar then
        perform public.importacio_actualitza('productores', p.id, v_patch);
      end if;
      if v_patch ? 'email' then v_ocupa := array_append(v_ocupa, 'E:' || (v_patch->>'email')); end if;
      if v_patch ? 'phone' then v_ocupa := array_append(v_ocupa, 'T:' || (v_patch->>'phone')); end if;
    else
      v_crea := array_append(v_crea, 'productor');
      v_germ := '{}'::jsonb;
      if v_te_e then
        v_germ := jsonb_strip_nulls(jsonb_build_object(
          'name', nullif(btrim(e.contacto), ''),
          'razon_social', nullif(btrim(e.razon_social), ''),
          'tipo_empresa', case when e.tipo_entidad is not null and public.tipus_empresa_valid(e.tipo_entidad, null)
                               then e.tipo_entidad end,
          'tipus_activitat', public.importacio_si_ple(to_jsonb(array(
             select ta.codi from tipus_activitat ta
              where ta.codi = any(e.tipus_activitat) and ta.aplica in ('productor', 'ambdos') order by ta.ordre))),
          'direccion', nullif(btrim(e.direccion), ''), 'codigo_postal', nullif(btrim(e.codigo_postal), ''),
          'municipio_ine', e.municipio_ine, 'ubicacio', nullif(btrim(e.ubicacio), ''),
          'area_geografica', nullif(btrim(e.area_geografica), '')));
      end if;
      v_ref := p_n->>'ref_nova';
      if v_ref is not null and exists (select 1 from productores where ref_externa = v_ref) then
        v_av := array_append(v_av, 'ref_externa_en_us');
        v_ref := null;
      end if;
      v_nou_p := v_germ || v_des || jsonb_strip_nulls(jsonb_build_object('nif', v_nif_germ));
      v_nou_p := v_nou_p || jsonb_build_object(
        'name', coalesce(v_nou_p->>'name', p_n->>'nom'),
        'ref_externa', v_ref,
        'es_test', case when v_te_e then e.es_test else false end,
        'comentario', public.importacio_bloc_nota(null, p_n->>'nota', v_lin_x, p_data, v_fila));
      if v_nou_p->>'email' is not null then v_ocupa := array_append(v_ocupa, 'E:' || (v_nou_p->>'email')); end if;
      if v_nou_p->>'phone' is not null then v_ocupa := array_append(v_ocupa, 'T:' || (v_nou_p->>'phone')); end if;
    end if;
  end if;

  -- ── Entidad (receptora) ──────────────────────────────────────────────────
  if 'entidad' = any(v_rols) then
    v_lin_x := v_lin;
    v_des := jsonb_strip_nulls(jsonb_build_object(
      'nombre', p_n->>'nom', 'razon_social', p_n->>'rao', 'nif', p_n->>'nif', 'tipo_entidad', p_n->>'te',
      'tipus_activitat', public.importacio_si_ple(p_n->'act_e'), 'contacto', p_n->>'pers',
      'email', p_n->>'email', 'email2', p_n->>'email2', 'telefono', p_n->>'tel', 'telefono2', p_n->>'tel2',
      'direccion', p_n->>'dir', 'codigo_postal', p_n->>'cp', 'municipio_ine', p_n->>'ine',
      'ubicacio', p_n->>'ubi', 'area_geografica', p_n->>'area',
      'tipo_receptor', p_n->>'tr', 'modalitats_interes', public.importacio_si_ple(p_n->'mod')));

    if v_te_e then
      v_cmp := public.importacio_compara('entidades', to_jsonb(e), v_des);
      v_patch := v_cmp->'patch';
      v_omplira := v_omplira || public.importacio_text_array(v_cmp->'omplira');
      v_confl := v_confl || (v_cmp->'conflictes');
      v_bloc := public.importacio_bloc_nota(e.comentarios, p_n->>'nota', v_lin_x, p_data, v_fila);
      if v_bloc is not null then
        v_patch := v_patch || jsonb_build_object('comentarios', coalesce(e.comentarios || E'\n\n', '') || v_bloc);
        v_omplira := array_append(v_omplira, 'entidades.comentarios');
      end if;
      if v_patch <> '{}'::jsonb and p_aplicar then
        perform public.importacio_actualitza('entidades', e.id, v_patch);
      end if;
    else
      v_crea := array_append(v_crea, 'entidad');
      v_germ := '{}'::jsonb;
      if v_te_p then
        v_germ := jsonb_strip_nulls(jsonb_build_object(
          'contacto', case when lower(btrim(p.name)) <> lower(btrim(coalesce(p.empresa, '')))
                           then nullif(btrim(p.name), '') end,
          'razon_social', nullif(btrim(p.razon_social), ''),
          'tipo_entidad', nullif(btrim(p.tipo_empresa), ''),
          'tipus_activitat', public.importacio_si_ple(to_jsonb(array(
             select ta.codi from tipus_activitat ta
              where ta.codi = any(p.tipus_activitat) and ta.aplica in ('entidad', 'ambdos') order by ta.ordre))),
          'email', nullif(lower(btrim(p.email)), ''),
          'telefono', nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), ''),
          'direccion', nullif(btrim(p.direccion), ''), 'codigo_postal', nullif(btrim(p.codigo_postal), ''),
          'municipio_ine', p.municipio_ine, 'ubicacio', nullif(btrim(p.ubicacio), ''),
          'area_geografica', nullif(btrim(p.area_geografica), '')));
      end if;
      v_ref := p_n->>'ref_nova';
      if v_ref is not null and exists (select 1 from entidades where ref_externa = v_ref) then
        v_av := array_append(v_av, 'ref_externa_en_us');
        v_ref := null;
      end if;
      v_nou_e := v_germ || v_des || jsonb_strip_nulls(jsonb_build_object('nif', v_nif_germ));
      v_nou_e := v_nou_e || jsonb_build_object(
        'ref_externa', v_ref,
        'es_test', case when v_te_p then p.es_test else false end,
        'comentarios', public.importacio_bloc_nota(null, p_n->>'nota', v_lin_x, p_data, v_fila));
    end if;
  end if;

  -- Las fichas nuevas, inactivas, en una sola llamada al núcleo del alta.
  if cardinality(v_crea) > 0 and p_aplicar then
    v_res  := public.alta_fitxa_interna(v_crea, p_org, false, v_nou_p, v_nou_e);
    v_org  := coalesce(v_org, (v_res->>'organizacion_id')::uuid);
    v_prod := coalesce(v_prod, (v_res->>'productor_id')::uuid);
    v_ent  := coalesce(v_ent, (v_res->>'entidad_id')::uuid);
  end if;

  v_accio := case
    when p_org is null then 'crear'
    when cardinality(v_crea) > 0 then 'afegir_paper'
    when cardinality(v_omplira) > 0 then 'actualitzar'
    else 'sense_canvis'
  end;

  return jsonb_build_object(
    'accio', v_accio,
    'organizacion_id', v_org, 'productor_id', v_prod, 'entidad_id', v_ent,
    'omplira', to_jsonb(v_omplira), 'conflictes', v_confl,
    'avisos', to_jsonb(v_av), 'ocupa', to_jsonb(v_ocupa));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2d. El lote entero: el MISMO código para previsualizar y para importar
-- ---------------------------------------------------------------------------
-- Fase 1 (sin escribir): normaliza, resuelve la identidad de TODAS las filas contra la base
-- tal como está al empezar, busca candidatos débiles y detecta repeticiones dentro del
-- fichero. Fase 2: fila a fila, en su propio savepoint, rellena, añade papel o crea.
--
-- ⚠️ RENDIMIENTO: `authenticated` tiene `statement_timeout = 8s` y el tope es de 1.000 filas.
--    Las claves de las fichas (correo, teléfono, NIF) y sus nombres se copian UNA vez a dos
--    tablas temporales con índice (btree y GIN de trigramas, operador `%`): sin índice, la
--    similitud de 1.000 filas × las fichas de la base pasaba de 4 s. Los acumuladores son
--    `jsonb[]` (un `jsonb || …` por fila copia el array entero cada vez).
create or replace function public.importacio_processa(p_files jsonb, p_aplicar boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_data     text := to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD');
  v_llindar  text := current_setting('pg_trgm.similarity_threshold', true);
  v_munis    jsonb;
  v_ns       jsonb;
  v_ident    jsonb;
  v_cands    jsonb;
  v_semb     jsonb;
  v_rows     jsonb[] := '{}';
  v_rows_j   jsonb;
  v_out      jsonb[] := '{}';
  v_k        text[] := '{}';   -- claves ya vistas en el lote …
  v_kf       int[]  := '{}';   -- … y la fila donde aparecieron
  v_ocupats  text[] := '{}';
  n          jsonb;
  r          jsonb;
  v_res      jsonb;
  v_c        jsonb;
  v_org      uuid;
  v_per      text;
  v_estat    text;
  v_accio    text;
  v_dec      text;
  v_av       text[];
  v_er       text[];
  v_keys     text[];
  v_dup      int;
  v_pos      int;
  v_rols_ex  text[];
  k          text;
begin
  -- La forma del lote: lo que no la cumple no es una fila con error, es un payload inválido.
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception 'dades_invalides: cal una llista de files' using errcode = '22023';
  end if;
  if jsonb_array_length(p_files) > 1000 then
    raise exception 'massa_files: com a molt 1000 files per importacio' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_files) x
              where jsonb_typeof(x) <> 'object'
                 or coalesce(x->>'fila', '') !~ '^[0-9]{1,7}$'
                 or (x->>'fila')::int < 1) then
    raise exception 'fila_invalida: cada fila necessita el seu numero (enter positiu)' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct (x->>'fila')::int) from jsonb_array_elements(p_files) x) then
    raise exception 'fila_repetida: dues files amb el mateix numero' using errcode = '22023';
  end if;

  -- Fase 1a: normalizar, en el orden de las filas del Excel (municipios, una vez por texto).
  select coalesce(jsonb_object_agg(t, public.municipi_de_text(t)), '{}'::jsonb) into v_munis
    from (select distinct btrim(x->>'municipi') as t from jsonb_array_elements(p_files) x
           where nullif(btrim(x->>'municipi'), '') is not null) s;
  select coalesce(jsonb_agg(public.importacio_normalitza_fila(x, v_munis) order by (x->>'fila')::int), '[]'::jsonb)
    into v_ns
    from jsonb_array_elements(p_files) x;

  -- Las claves y los nombres de las fichas que ya existen, una sola vez, con índice.
  if to_regclass('pg_temp.importacio_fx') is not null then drop table pg_temp.importacio_fx; end if;
  create temp table importacio_fx on commit drop as
    select s.org, s.clau
      from (
        select p.organizacion_id as org,
               unnest(array_remove(array[
                 'E:' || nullif(lower(btrim(p.email)), ''),
                 'N:' || nullif(upper(regexp_replace(coalesce(p.nif, ''), '[\s.\-]', '', 'g')), '')], null)
                 || array(select 'T:' || t from unnest(public.importacio_claus_telefon(array[p.phone, p.telefono_alt])) t)) as clau
          from productores p
        union all
        select e.organizacion_id,
               unnest(array_remove(array[
                 'E:' || nullif(lower(btrim(e.email)), ''),
                 'E:' || nullif(lower(btrim(e.email2)), ''),
                 'N:' || nullif(upper(regexp_replace(coalesce(e.nif, ''), '[\s.\-]', '', 'g')), '')], null)
                 || array(select 'T:' || t from unnest(public.importacio_claus_telefon(array[e.telefono, e.telefono2, e.telefono3])) t))
          from entidades e
      ) s;
  create index on pg_temp.importacio_fx (clau);
  analyze pg_temp.importacio_fx;

  if to_regclass('pg_temp.importacio_noms') is not null then drop table pg_temp.importacio_noms; end if;
  create temp table importacio_noms on commit drop as
    select s.org, s.nom
      from (
        select p.organizacion_id as org, nullif(lower(unaccent(btrim(coalesce(nullif(p.empresa, ''), p.name)))), '') as nom
          from productores p
        union all
        select e.organizacion_id, nullif(lower(unaccent(btrim(e.nombre))), '') from entidades e
      ) s
     where s.nom is not null;
  create index on pg_temp.importacio_noms using gin (nom gin_trgm_ops);
  analyze pg_temp.importacio_noms;
  -- El índice de trigramas responde a `%` con este umbral; el criterio (≥ 0,65, como
  -- `organitzacions_candidates`) se vuelve a comprobar con `similarity()`.
  perform set_config('pg_trgm.similarity_threshold', '0.6', true);

  -- Fase 1b: identidad fuerte (1. NIF, 2. Airtable, 3. ref `IMP:` sin NIF), toda de una vez.
  with rs as (
    select (x->>'fila')::int as fila, x->>'nif' as nif, x->>'airtable' as at, x->>'ref_hash' as hash
      from jsonb_array_elements(v_ns) x
     where jsonb_array_length(x->'errors') = 0
  )
  select coalesce(jsonb_object_agg(t.fila, jsonb_build_object('organizacion_id', t.org, 'per', t.per)), '{}'::jsonb)
    into v_ident
    from (
      select distinct on (rs.fila) rs.fila, c.org, c.per
        from rs
        cross join lateral (
          select fx.org, 'nif' as per, 1 as prio from pg_temp.importacio_fx fx
           where rs.nif is not null and fx.clau = 'N:' || rs.nif
          union all
          select p.organizacion_id, 'nif', 1 from productores p where rs.nif is not null and p.ref_externa = 'IMP:NIF:' || rs.nif
          union all
          select e.organizacion_id, 'nif', 1 from entidades e where rs.nif is not null and e.ref_externa = 'IMP:NIF:' || rs.nif
          union all
          select p.organizacion_id, 'airtable', 2 from productores p where rs.at is not null and p.ref_externa = 'AIRTABLE:' || rs.at
          union all
          select e.organizacion_id, 'airtable', 2 from entidades e where rs.at is not null and e.ref_externa = 'AIRTABLE:' || rs.at
          union all
          select p.organizacion_id, 'ref', 3 from productores p where rs.nif is null and rs.hash is not null and p.ref_externa = rs.hash
          union all
          select e.organizacion_id, 'ref', 3 from entidades e where rs.nif is null and rs.hash is not null and e.ref_externa = rs.hash
        ) c
       order by rs.fila, c.prio
    ) t;

  -- Fase 1c: candidatos débiles de las filas sin identidad fuerte (correo exacto, teléfono
  -- por las últimas 9 cifras, nombre con similitud ≥ 0,65).
  with rs as (
    select (x->>'fila')::int as fila,
           array(select 'E:' || y from jsonb_array_elements_text(x->'emails') y)
             || array(select 'T:' || y from jsonb_array_elements_text(x->'tels9') y) as claus,
           x->>'nom_trgm' as nom
      from jsonb_array_elements(v_ns) x
     where jsonb_array_length(x->'errors') = 0
       and not v_ident ? (x->>'fila')
  ),
  kc as (
    select rs.fila, fx.org,
           bool_or(left(fx.clau, 2) = 'E:') as per_correu,
           bool_or(left(fx.clau, 2) = 'T:') as per_tel
      from rs join pg_temp.importacio_fx fx on fx.clau = any(rs.claus)
     group by rs.fila, fx.org
  ),
  sn as (
    select rs.fila, nn.org, max(similarity(rs.nom, nn.nom)) as sim
      from rs join pg_temp.importacio_noms nn on rs.nom is not null and nn.nom % rs.nom
     group by rs.fila, nn.org
  ),
  m as (
    select coalesce(kc.fila, sn.fila) as fila, coalesce(kc.org, sn.org) as org,
           coalesce(kc.per_correu, false) as per_correu, coalesce(kc.per_tel, false) as per_tel,
           case when sn.sim >= 0.65 then sn.sim end as sim
      from kc full join sn on sn.fila = kc.fila and sn.org = kc.org
  ),
  ord as (
    select m.*, v.nombre, v.nif,
           row_number() over (partition by m.fila
                              order by (m.per_correu::int + m.per_tel::int) desc, coalesce(m.sim, 0) desc, v.nombre) as rn
      from m join v_organizaciones v on v.id = m.org
     where m.per_correu or m.per_tel or m.sim is not null
  )
  select coalesce(jsonb_object_agg(s.fila, s.cands), '{}'::jsonb) into v_cands
    from (
      select fila, jsonb_agg(jsonb_build_object(
               'organizacion_id', org, 'nom', nombre, 'nif', nif,
               'motiu', case when per_correu then 'correu' when per_tel then 'telefon' else 'nom' end,
               'motius', to_jsonb(array_remove(array[
                          case when per_correu then 'correu' end,
                          case when per_tel then 'telefon' end,
                          case when sim is not null then 'nom' end], null)),
               'similitud', round(sim::numeric, 2))
             order by rn) as cands
        from ord where rn <= 10
       group by fila
    ) s;

  -- Fase 1d: estado, decisión y repeticiones dentro del fichero (la segunda fila es la que falla).
  for n in select * from jsonb_array_elements(v_ns) loop
    v_er  := public.importacio_text_array(n->'errors');
    v_av  := public.importacio_text_array(n->'avisos');
    v_org := (v_ident->(n->>'fila')->>'organizacion_id')::uuid;
    v_per := v_ident->(n->>'fila')->>'per';
    v_c   := coalesce(v_cands->(n->>'fila'), '[]'::jsonb);
    v_estat := null;
    v_accio := null;

    if cardinality(v_er) = 0 then
      if v_org is not null then
        v_estat := 'existent';
        v_accio := 'pendent';
      elsif jsonb_array_length(v_c) > 0 then
        v_estat := 'dubtosa';
        v_dec := n->>'decisio';
        if v_dec is null or v_dec = 'ometre' then
          v_accio := 'ometre';
        elsif v_dec = 'crear' then
          v_accio := 'crear';
        elsif v_dec ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          if exists (select 1 from jsonb_array_elements(v_c) c where c->>'organizacion_id' = v_dec) then
            v_org := v_dec::uuid;
            v_per := 'decisio';
            v_accio := 'pendent';
          else
            v_er := array_append(v_er, 'decisio_no_candidata');
          end if;
        else
          v_er := array_append(v_er, 'decisio_invalida');
        end if;
      else
        v_estat := 'nova';
        v_accio := 'crear';
      end if;
    end if;

    if cardinality(v_er) = 0 then
      v_keys := array_remove(array[
        case when n->>'nif' is not null then 'NIF:' || (n->>'nif') end,
        case when n->>'airtable' is not null then 'AT:' || (n->>'airtable') end,
        case when n->>'nif' is null then n->>'ref_hash' end,
        case when v_org is not null then 'ORG:' || v_org end], null);
      v_dup := null;
      foreach k in array v_keys loop
        v_pos := array_position(v_k, k);
        if v_pos is not null then
          v_dup := least(coalesce(v_dup, v_kf[v_pos]), v_kf[v_pos]);
        end if;
      end loop;
      if v_dup is not null then
        v_er := array_append(v_er, 'repetit_al_fitxer:' || v_dup);
      else
        foreach k in array v_keys loop
          v_k  := array_append(v_k, k);
          v_kf := array_append(v_kf, (n->>'fila')::int);
        end loop;
      end if;
    end if;

    if cardinality(v_er) > 0 then
      v_estat := coalesce(case when v_estat = 'dubtosa' then 'dubtosa' end, 'error');
      v_accio := 'error';
    end if;

    v_rols_ex := '{}';
    if v_org is not null then
      v_rols_ex := array_remove(array[
        case when exists (select 1 from productores where organizacion_id = v_org) then 'productor' end,
        case when exists (select 1 from entidades where organizacion_id = v_org) then 'entidad' end], null);
    end if;

    v_rows := array_append(v_rows, jsonb_build_object(
      'fila', (n->>'fila')::int, 'n', n, 'estat', v_estat, 'accio', v_accio,
      'organizacion_id', v_org, 'identificada_per', v_per,
      'candidats', case when v_estat = 'dubtosa' then v_c else '[]'::jsonb end,
      'rols_existents', to_jsonb(v_rols_ex),
      'avisos', to_jsonb(v_av), 'errors', to_jsonb(v_er)));
  end loop;
  v_rows_j := to_jsonb(v_rows);

  -- Fase 1e: filas nuevas que comparten correo o teléfono con una fila ANTERIOR del mismo
  -- fichero. No se unen (nunca une sola): se avisa (`semblant_a_fila:<n>`).
  with c as (
    select (r2->>'fila')::int as fila, r2->>'accio' as accio, y as clau
      from jsonb_array_elements(v_rows_j) r2,
           lateral (select 'E:' || z from jsonb_array_elements_text(r2->'n'->'emails') z
                    union all
                    select 'T:' || z from jsonb_array_elements_text(r2->'n'->'tels9') z) as t(y)
     where r2->>'accio' <> 'error'
  )
  select coalesce(jsonb_object_agg(s.fila, s.files), '{}'::jsonb) into v_semb
    from (
      select a.fila, to_jsonb((array_agg(distinct b.fila order by b.fila))[1:3]) as files
        from c a join c b on b.clau = a.clau and b.fila < a.fila
       where a.accio = 'crear'
       group by a.fila
    ) s;

  -- Fase 2: fila a fila. Un error de una fila (savepoint) no aborta el lote; un 42501, sí.
  for r in select * from jsonb_array_elements(v_rows_j) loop
    v_av := public.importacio_text_array(r->'avisos')
            || array(select 'semblant_a_fila:' || f
                       from jsonb_array_elements_text(coalesce(v_semb->(r->>'fila'), '[]'::jsonb)) f);
    v_er := public.importacio_text_array(r->'errors');
    v_accio := r->>'accio';
    v_res := jsonb_build_object('organizacion_id', r->'organizacion_id', 'productor_id', null, 'entidad_id', null,
                                'omplira', '[]'::jsonb, 'conflictes', '[]'::jsonb);

    if v_accio in ('crear', 'pendent') then
      begin
        v_res := public.importacio_aplica_fila(r->'n', (r->>'organizacion_id')::uuid, p_aplicar, v_ocupats, v_data);
        v_accio := v_res->>'accio';
        v_av := v_av || public.importacio_text_array(v_res->'avisos');
        v_ocupats := v_ocupats || public.importacio_text_array(v_res->'ocupa');
      exception when others then
        if sqlstate = '42501' then
          raise;
        end if;
        v_accio := 'error';
        v_er := array_append(v_er, 'error_bd:' || sqlstate || ':' || sqlerrm);
        v_res := jsonb_build_object('organizacion_id', r->'organizacion_id', 'productor_id', null, 'entidad_id', null,
                                    'omplira', '[]'::jsonb, 'conflictes', '[]'::jsonb);
      end;
    end if;

    v_out := array_append(v_out, jsonb_build_object(
      'fila', (r->>'fila')::int,
      'estat', r->>'estat',
      'accio_prevista', v_accio,
      'accio', case v_accio
                 when 'crear' then 'creada'
                 when 'actualitzar' then 'actualitzada'
                 when 'afegir_paper' then 'paper_afegit'
                 when 'sense_canvis' then 'sense_canvis'
                 when 'ometre' then 'omesa'
                 else 'error' end,
      'identificada_per', r->'identificada_per',
      'organizacion_id', v_res->'organizacion_id',
      'productor_id', v_res->'productor_id',
      'entidad_id', v_res->'entidad_id',
      'rols_existents', r->'rols_existents',
      'candidats', r->'candidats',
      'omplira', coalesce(v_res->'omplira', '[]'::jsonb),
      'conflictes', coalesce(v_res->'conflictes', '[]'::jsonb),
      'avisos', to_jsonb(v_av),
      'errors', to_jsonb(v_er)));
  end loop;

  if to_regclass('pg_temp.importacio_fx') is not null then drop table pg_temp.importacio_fx; end if;
  if to_regclass('pg_temp.importacio_noms') is not null then drop table pg_temp.importacio_noms; end if;
  perform set_config('pg_trgm.similarity_threshold', coalesce(v_llindar, '0.3'), true);

  return to_jsonb(v_out);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Registro de las importaciones
-- ---------------------------------------------------------------------------
create table if not exists public.importacions_entitats (
  id            uuid primary key default gen_random_uuid(),
  fitxer_nom    text not null check (char_length(fitxer_nom) between 1 and 255),
  fitxer_sha256 text not null check (fitxer_sha256 ~ '^[0-9a-f]{64}$'),
  files_total   int  not null check (files_total >= 0),
  resum         jsonb not null default '{}'::jsonb,
  creat_per     uuid references auth.users(id) on delete set null,
  creat_at      timestamptz not null default now()
);
create index if not exists importacions_entitats_sha_idx on public.importacions_entitats (fitxer_sha256);

create table if not exists public.importacions_entitats_files (
  importacio_id   uuid not null references public.importacions_entitats(id) on delete cascade,
  fila            int  not null check (fila >= 1),
  accio           text not null check (accio in ('creada', 'actualitzada', 'paper_afegit', 'sense_canvis', 'omesa', 'error')),
  -- ON DELETE SET NULL: el registro no bloquea `borrar_ficha_completa()` (ni la retirada de
  -- la organización vacía); la fila del registro se queda, sin la ficha.
  organizacion_id uuid references public.organizaciones(id) on delete set null,
  productor_id    uuid references public.productores(id) on delete set null,
  entidad_id      uuid references public.entidades(id) on delete set null,
  camps_omplerts  text[] not null default '{}',
  conflictes      jsonb  not null default '[]'::jsonb,
  avisos          text[] not null default '{}',
  errors          text[] not null default '{}',
  primary key (importacio_id, fila)
);
create index if not exists importacions_entitats_files_org_idx  on public.importacions_entitats_files (organizacion_id) where organizacion_id is not null;
create index if not exists importacions_entitats_files_prod_idx on public.importacions_entitats_files (productor_id) where productor_id is not null;
create index if not exists importacions_entitats_files_ent_idx  on public.importacions_entitats_files (entidad_id) where entidad_id is not null;

alter table public.importacions_entitats enable row level security;
alter table public.importacions_entitats_files enable row level security;

-- Dos capas: GRANT explícito (solo SELECT, nadie escribe directo: todo entra por la RPC) y
-- política de lectura del equipo. `anon`, nada.
revoke all on table public.importacions_entitats from public, anon, authenticated;
revoke all on table public.importacions_entitats_files from public, anon, authenticated;
grant select on table public.importacions_entitats to authenticated;
grant select on table public.importacions_entitats_files to authenticated;

drop policy if exists "importacions_entitats: lectura equip" on public.importacions_entitats;
create policy "importacions_entitats: lectura equip" on public.importacions_entitats
  for select to authenticated using ((select public.es_intern()));
drop policy if exists "importacions_entitats_files: lectura equip" on public.importacions_entitats_files;
create policy "importacions_entitats_files: lectura equip" on public.importacions_entitats_files
  for select to authenticated using ((select public.es_intern()));

comment on table public.importacions_entitats is
  'Una fila por lote del importador de entidades (20270511100000): fichero, huella sha256, resumen y quién. Solo lo escribe importar_entitats(); lo lee el equipo.';
comment on table public.importacions_entitats_files is
  'Una fila por fila del Excel importada: acción (creada, actualitzada, paper_afegit, sense_canvis, omesa, error), fichas tocadas, campos rellenados, conflictos, avisos y errores.';

-- ---------------------------------------------------------------------------
-- 3. Las dos RPC del super_admin
-- ---------------------------------------------------------------------------
create or replace function public.previsualitzar_importacio_entitats(p_files jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes un super_admin pot importar entitats' using errcode = '42501';
  end if;

  v := public.importacio_processa(p_files, false);

  return jsonb_build_object(
    'files', (select coalesce(jsonb_agg(jsonb_build_object(
                'fila', r->'fila', 'estat', r->'estat', 'accio_prevista', r->'accio_prevista',
                'identificada_per', r->'identificada_per', 'organizacion_id', r->'organizacion_id',
                'rols_existents', r->'rols_existents', 'candidats', r->'candidats',
                'omplira', r->'omplira', 'conflictes', r->'conflictes',
                'avisos', r->'avisos', 'errors', r->'errors') order by (r->>'fila')::int), '[]'::jsonb)
                from jsonb_array_elements(v) r),
    'resum', (select jsonb_build_object(
                'total', count(*),
                'per_estat', jsonb_build_object(
                   'nova', count(*) filter (where r->>'estat' = 'nova'),
                   'existent', count(*) filter (where r->>'estat' = 'existent'),
                   'dubtosa', count(*) filter (where r->>'estat' = 'dubtosa'),
                   'error', count(*) filter (where r->>'estat' = 'error')),
                'per_accio', jsonb_build_object(
                   'crear', count(*) filter (where r->>'accio_prevista' = 'crear'),
                   'actualitzar', count(*) filter (where r->>'accio_prevista' = 'actualitzar'),
                   'afegir_paper', count(*) filter (where r->>'accio_prevista' = 'afegir_paper'),
                   'sense_canvis', count(*) filter (where r->>'accio_prevista' = 'sense_canvis'),
                   'ometre', count(*) filter (where r->>'accio_prevista' = 'ometre'),
                   'error', count(*) filter (where r->>'accio_prevista' = 'error')))
                from jsonb_array_elements(v) r));
end;
$$;

create or replace function public.importar_entitats(p_fitxer jsonb, p_files jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_nom   text;
  v_sha   text;
  v_ja    timestamptz;
  v_id    uuid;
  v       jsonb;
  v_resum jsonb;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes un super_admin pot importar entitats' using errcode = '42501';
  end if;

  if p_fitxer is null or jsonb_typeof(p_fitxer) <> 'object' then
    raise exception 'dades_invalides: cal el fitxer (nom i sha256)' using errcode = '22023';
  end if;
  v_nom := nullif(btrim(p_fitxer->>'nom'), '');
  v_sha := lower(nullif(btrim(p_fitxer->>'sha256'), ''));
  if v_nom is null or char_length(v_nom) > 255 or v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'dades_invalides: cal el fitxer (nom i sha256)' using errcode = '22023';
  end if;
  if jsonb_typeof(p_files) = 'array' and jsonb_array_length(p_files) = 0 then
    raise exception 'sense_files: el fitxer no te cap fila' using errcode = '22023';
  end if;

  -- Dos importaciones a la vez se serializan: la segunda ve lo que creó la primera.
  perform pg_advisory_xact_lock(hashtext('importar_entitats'));

  select max(creat_at) into v_ja from importacions_entitats where fitxer_sha256 = v_sha;

  -- Recalcula la identidad de cada fila: no se fía de la previsualización.
  v := public.importacio_processa(p_files, true);

  select jsonb_build_object(
           'creades', count(*) filter (where r->>'accio' = 'creada'),
           'actualitzades', count(*) filter (where r->>'accio' = 'actualitzada'),
           'paper_afegit', count(*) filter (where r->>'accio' = 'paper_afegit'),
           'sense_canvis', count(*) filter (where r->>'accio' = 'sense_canvis'),
           'omeses', count(*) filter (where r->>'accio' = 'omesa'),
           'errors', count(*) filter (where r->>'accio' = 'error'))
    into v_resum
    from jsonb_array_elements(v) r;

  insert into importacions_entitats (fitxer_nom, fitxer_sha256, files_total, resum, creat_per)
  values (v_nom, v_sha, jsonb_array_length(v), v_resum, auth.uid())
  returning id into v_id;

  insert into importacions_entitats_files (importacio_id, fila, accio, organizacion_id, productor_id, entidad_id,
                                           camps_omplerts, conflictes, avisos, errors)
  select v_id, (r->>'fila')::int, r->>'accio',
         (r->>'organizacion_id')::uuid, (r->>'productor_id')::uuid, (r->>'entidad_id')::uuid,
         public.importacio_text_array(r->'omplira'), coalesce(r->'conflictes', '[]'::jsonb),
         public.importacio_text_array(r->'avisos'), public.importacio_text_array(r->'errors')
    from jsonb_array_elements(v) r;

  return jsonb_build_object(
    'importacio_id', v_id,
    'ja_importat_at', v_ja,
    'resum', v_resum,
    'files', (select coalesce(jsonb_agg(jsonb_build_object(
                'fila', r->'fila', 'accio', r->'accio', 'organizacion_id', r->'organizacion_id',
                'productor_id', r->'productor_id', 'entidad_id', r->'entidad_id',
                'camps_omplerts', r->'omplira', 'conflictes', r->'conflictes',
                'avisos', r->'avisos', 'errors', r->'errors') order by (r->>'fila')::int), '[]'::jsonb)
                from jsonb_array_elements(v) r));
end;
$$;

-- ---------------------------------------------------------------------------
-- 0 (bis). `crear_entitat()` sobre el núcleo compartido — mismo comportamiento que antes
-- ---------------------------------------------------------------------------
-- ⚠️ `tests/campsFitxa.test.ts` lee las claves `d->>'…'` / `d->'…'` / `d ? '…'` de ESTA
--    función (la última definición) y las compara con `CLAUS_ALTA`: se mantienen todas aquí,
--    y el núcleo recibe las columnas ya resueltas (sin `d`).
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
  v_ubi    text;
  v_tr     text;
  v_test   boolean;
  v_act    text[];
  v_act_p  text[];
  v_act_e  text[];
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
  v_ubi   := nullif(btrim(coalesce(d->>'ubicacio', '')), '');
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
  if char_length(v_ubi) > 120 then
    raise exception 'ubicacio_massa_llarga' using errcode = '22023';
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

  -- Las fichas, activas, por el núcleo compartido con la importación: la primera estrena la
  -- organización, la segunda se cuelga de ella, y el rastro queda en `fitxa_estat_hist`.
  return public.alta_fitxa_interna(
    v_rols, null, true,
    jsonb_build_object(
      'name', coalesce(v_pers, v_nom), 'empresa', v_nom, 'razon_social', v_rao, 'nif', v_nif,
      'tipo_empresa', v_te, 'tipus_activitat', to_jsonb(v_act_p),
      'email', v_email, 'phone', v_tel, 'direccion', v_dir, 'codigo_postal', v_cp,
      'municipio_ine', v_mun, 'ubicacio', v_ubi, 'es_test', v_test),
    jsonb_build_object(
      'nombre', v_nom, 'razon_social', v_rao, 'nif', v_nif, 'tipo_entidad', v_te,
      'tipus_activitat', to_jsonb(v_act_e), 'contacto', v_pers,
      'email', v_email, 'telefono', v_tel, 'direccion', v_dir, 'codigo_postal', v_cp,
      'municipio_ine', v_mun, 'ubicacio', v_ubi, 'tipo_receptor', v_tr, 'es_test', v_test));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Permisos de las funciones
-- ---------------------------------------------------------------------------
-- Las RPC: con sesión, la guarda decide (super_admin); sin sesión, nada.
revoke execute on function public.previsualitzar_importacio_entitats(jsonb) from public, anon;
grant  execute on function public.previsualitzar_importacio_entitats(jsonb) to authenticated;
revoke execute on function public.importar_entitats(jsonb, jsonb) from public, anon;
grant  execute on function public.importar_entitats(jsonb, jsonb) to authenticated;

-- `crear_entitat`: como antes (sin `service_role` ni sin sesión).
revoke execute on function public.crear_entitat(jsonb) from public, anon, service_role;
grant  execute on function public.crear_entitat(jsonb) to authenticated;

-- Las internas: nadie las llama desde fuera (solo las RPC `security definer` de arriba).
revoke execute on function public.alta_fitxa_interna(text[], uuid, boolean, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_txt(jsonb, text) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_text_array(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_si_ple(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_nom_normalitzat(text) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_claus_telefon(text[]) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_buit(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_igual(text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_mostra(text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_camp(text) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_bloc_nota(text, text, text[], text, int) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_compara(text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_actualitza(text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_normalitza_fila(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_aplica_fila(jsonb, uuid, boolean, text[], text) from public, anon, authenticated, service_role;
revoke execute on function public.importacio_processa(jsonb, boolean) from public, anon, authenticated, service_role;

comment on function public.alta_fitxa_interna(text[], uuid, boolean, jsonb, jsonb) is
  '20270511100000: núcleo del alta compartido por crear_entitat() (activa) y la importación (inactiva). Inserta las fichas de los papeles en una organización (nueva o p_org), deja rastro en fitxa_estat_hist; unique_violation → 22023 dades_en_us. Interna: sin EXECUTE.';
comment on function public.crear_entitat(jsonb) is
  '1B (20270501300000; ubicacio desde 20270505100000; núcleo alta_fitxa_interna desde 20270511100000): alta de una entidad con uno o dos papeles en una transacción. Nace activa: exige NIF válido, razón social y, si es receptor, tipo_receptor. Solo equipo con sesión.';
comment on function public.previsualitzar_importacio_entitats(jsonb) is
  '20270511100000: previsualiza un lote del importador de entidades (≤1000 filas) sin escribir: estado, acción prevista, candidatos, huecos que se rellenarían, conflictos, avisos y errores por fila. Solo super_admin.';
comment on function public.importar_entitats(jsonb, jsonb) is
  '20270511100000: importa un lote de entidades (inactivas, solo rellena huecos, nunca une por coincidencia débil sin decisión). Recalcula la identidad, un savepoint por fila, deja el registro en importacions_entitats(_files). Solo super_admin.';
