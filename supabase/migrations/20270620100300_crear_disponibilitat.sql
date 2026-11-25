-- Ofertas multiproducto (proceso 3.3; fase 6 del plan de noviembre de 2026), 4 de 7: el ALTA
-- (entrega 6a). Dos funciones:
--
-- 1. `crear_disponibilitat(p_productor, p_ofertes, p_esborrany, p_actor)` — SOLO `service_role`
--    (la llama `crear-oferta` con más de un producto, en el alta y al publicar un esborrany).
--
--    Por qué recibe las N filas ya compuestas y no las compone aquí: el `E-…` (`generarId()`), el
--    texto (`textoOfertaDeDades()`), la causa, el coste, la franja, el lugar… los calcula hoy
--    `_shared/oferta.ts` (`filaDeDades()`), y duplicarlo en SQL partiría en dos la regla de qué es
--    una oferta. Lo que la base añade es lo que el servidor NO puede hacer solo: que la cabecera y
--    las N ofertas nazcan en UNA transacción (todo o nada) y el código `D-…` de la cabecera.
--
--    Contrato:
--      · `p_ofertes jsonb`: array de ≥ 2 objetos; cada uno, las columnas de `excedentes` tal como
--        las inserta hoy `crearExcedente()` (`filaDeDades()` + `id_excedente`, `valor_eur`,
--        `texto_oferta`, `origen`). Se insertan SOLO las claves presentes (las ausentes toman su
--        `default`). No se aceptan: `id`, `productor_id`, `disponibilitat_id`, `estado` distinto de
--        `publicada`, ni las columnas que solo escriben otras puertas (validación, cierre, legado,
--        esborrany, generadas). Una clave desconocida o no permitida → `22023 columna_no_permesa: <k>`.
--      · `estado` se fuerza a `publicada` y la BASE decide si queda `pendent_validacio`
--        (`trg_excedentes_validacio`), igual que en el alta suelta.
--      · `p_esborrany uuid` (opcional): el esborrany que se publica. La PRIMERA oferta del array
--        reescribe esa fila (`estado = 'esborrany'` y del mismo productor; si no, `22023
--        esborrany_inexistent`); el resto se insertan. Es lo que hace hoy `crearExcedente()` con
--        `esborranyId`.
--      · `p_actor uuid` (opcional): quien da de alta (el `ctx.userId` de la Edge Function) →
--        `disponibilitats.created_by`.
--      · Devuelve `{disponibilitat_id, codi, ofertes: [{id, id_excedente, estado, producto}]}` en
--        el orden del array.
--      · Errores: `42501` con sesión (no es del panel); `22023`: `cal_dos_productes`,
--        `productor_inexistent`, `columna_no_permesa: <k>`, `estat_invalid`, `cal_id_excedent`,
--        `cal_producte`, `esborrany_inexistent`; `23505` si un `id_excedente` ya existe (el
--        servidor regenera los `E-…` y repite la llamada entera, como el reintento del alta).
--
-- 2. `ofertes_disponibilitat(p_disponibilitat)` — lectura de las ofertas de un grupo que la cuenta
--    puede ver, para el diálogo de solicitud del Mercat (`/receptor/mercat?disponibilitat=<id>`),
--    el bloque «Disponibilitat multiproducte» del detalle y el texto único. `security definer` con
--    la MISMA regla que «excedentes: lectura per rol» (equipo, productor propio, receptor:
--    publicada/parcial compatible, con interés propio o con canalización propia) y dos datos que la
--    RLS no da al receptor: `kg_lliures` (kg aún sin destino, `desti_excedent()`) y
--    `modalitats_meves` (las modalidades de la oferta que esa entidad puede recibir: compatibilidad
--    y P8; `null` para el equipo y el productor). Un uuid inventado o ajeno: 0 filas.

-- ---------------------------------------------------------------------------
-- 1. `crear_disponibilitat`
-- ---------------------------------------------------------------------------
create or replace function public.crear_disponibilitat(
  p_productor uuid,
  p_ofertes   jsonb,
  p_esborrany uuid default null,
  p_actor     uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Columnas que escriben otras puertas (o nadie): fuera de la lista blanca.
  v_prohibides text[] := array[
    'id', 'productor_id', 'disponibilitat_id', 'created_at', 'espigolada_id', 'ref_externa',
    'dades_esborrany', 'validada_at', 'validada_per', 'tancada_at', 'desti_reclamat_at',
    'motivo_no_colocada'];
  v_permeses   text[];
  v_nom        text;
  v_avui       date := (now() at time zone 'Europe/Madrid')::date;
  v_pref       text;
  v_codi       text;
  v_disp       uuid;
  v_item       jsonb;
  v_ord        bigint;
  v_k          text;
  v_cols       text;
  v_row        record;
  v_res        jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor crea una disponibilitat multiproducte' using errcode = '42501';
  end if;

  if p_ofertes is null or jsonb_typeof(p_ofertes) <> 'array' or jsonb_array_length(p_ofertes) < 2 then
    raise exception 'cal_dos_productes: una disponibilitat agrupa almenys dos productes'
      using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(p.empresa), ''), p.name) into v_nom
    from productores p where p.id = p_productor;
  if not found then
    raise exception 'productor_inexistent' using errcode = '22023';
  end if;

  select array_agg(a.attname::text) into v_permeses
    from pg_attribute a
   where a.attrelid = 'public.excedentes'::regclass
     and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and a.attname::text <> all (v_prohibides);

  -- Validación de TODAS las filas antes de escribir nada.
  for v_item, v_ord in select e, o from jsonb_array_elements(p_ofertes) with ordinality as t(e, o) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'columna_no_permesa: la fila % no es un objecte', v_ord using errcode = '22023';
    end if;
    for v_k in select jsonb_object_keys(v_item) loop
      if v_k = 'estado' then
        if v_item->>'estado' is distinct from 'publicada' then
          raise exception 'estat_invalid: una oferta nova neix publicada' using errcode = '22023';
        end if;
      elsif not (v_k = any (v_permeses)) then
        raise exception 'columna_no_permesa: %', v_k using errcode = '22023';
      end if;
    end loop;
    if coalesce(btrim(v_item->>'id_excedente'), '') = '' then
      raise exception 'cal_id_excedent' using errcode = '22023';
    end if;
    if coalesce(btrim(v_item->>'producto'), '') = '' then
      raise exception 'cal_producte' using errcode = '22023';
    end if;
  end loop;

  -- La cabecera: `D-AAMMDD-XXX-N` con el correlativo del día (atómico).
  v_pref := 'D-' || to_char(v_avui, 'YYMMDD') || '-' || public.siglas_oferta(v_nom);
  v_codi := v_pref || '-' || public.siguiente_numero(v_pref, extract(year from v_avui)::int);

  insert into disponibilitats (codi, productor_id, created_by)
  values (v_codi, p_productor, p_actor)
  returning id into v_disp;

  perform set_config('redestina.escriu_grup', 'on', true);

  for v_item, v_ord in select e, o from jsonb_array_elements(p_ofertes) with ordinality as t(e, o) loop
    v_item := (v_item - 'estado') || jsonb_build_object(
      'estado', 'publicada', 'productor_id', p_productor, 'disponibilitat_id', v_disp);
    select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(v_item) as k;

    if v_ord = 1 and p_esborrany is not null then
      -- Publicar el esborrany: la fila ya existe; `trg_excedentes_esborrany` vacía
      -- `dades_esborrany` al salir de ese estado.
      execute format(
        'update public.excedentes set (%1$s) = (select %1$s from jsonb_populate_record(null::public.excedentes, $1))
          where id = $2 and estado = ''esborrany'' and productor_id = $3
          returning id, id_excedente, estado, producto', v_cols)
        into v_row using v_item, p_esborrany, p_productor;
      if v_row.id is null then
        raise exception 'esborrany_inexistent' using errcode = '22023';
      end if;
    else
      execute format(
        'insert into public.excedentes (%1$s)
         select %1$s from jsonb_populate_record(null::public.excedentes, $1)
         returning id, id_excedente, estado, producto', v_cols)
        into v_row using v_item;
    end if;

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'id', v_row.id, 'id_excedente', v_row.id_excedente,
      'estado', v_row.estado, 'producto', v_row.producto));
  end loop;

  perform set_config('redestina.escriu_grup', 'off', true);

  return jsonb_build_object('disponibilitat_id', v_disp, 'codi', v_codi, 'ofertes', v_res);
end;
$$;

revoke execute on function public.crear_disponibilitat(uuid, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crear_disponibilitat(uuid, jsonb, uuid, uuid) to service_role;

comment on function public.crear_disponibilitat(uuid, jsonb, uuid, uuid) is
  'Fase 6a (3.3, 20270620100300): solo service_role (crear-oferta). Crea la cabecera D-AAMMDD-XXX-N '
  'y sus N≥2 ofertas (las filas que compone _shared/oferta.ts) en una transacción; la primera puede '
  'reescribir un esborrany (p_esborrany). Devuelve {disponibilitat_id, codi, ofertes[]}.';

-- ---------------------------------------------------------------------------
-- 2. `ofertes_disponibilitat`
-- ---------------------------------------------------------------------------
create or replace function public.ofertes_disponibilitat(p_disponibilitat uuid)
returns table (
  excedente_id         uuid,
  id_excedente         text,
  disponibilitat_id    uuid,
  productor_id         uuid,
  producto             text,
  variedad             text,
  kg_total             numeric,
  kg_lliures           numeric,
  estado               text,
  modalitat            text,
  modalitats           text[],
  modalitats_meves     text[],
  preu_minim           numeric,
  disponible_desde     date,
  disponible_hasta     date,
  hora_recollida_inici time,
  hora_recollida_fi    time,
  dies_recollida       smallint[],
  ubicacion_id         uuid,
  municipi_ine         text,
  comarca              text,
  gmaps_url            text,
  tipus_operacio       text,
  created_at           timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with jo as (
    select (select public.es_intern()) as intern,
           array(select public.modalitats_compatibles_meves()) as mods
  )
  select e.id, e.id_excedente, e.disponibilitat_id, e.productor_id, e.producto, e.variedad,
         e.kg_total, d.kg_sense_desti, e.estado, e.modalitat, e.modalitats,
         case when jo.intern or e.productor_id in (select public.mis_productores()) then null
              else array(select m from unnest(coalesce(e.modalitats, array[e.modalitat])) m
                          where m = any (jo.mods)) end,
         e.preu_minim, e.disponible_desde, e.disponible_hasta,
         e.hora_recollida_inici, e.hora_recollida_fi, e.dies_recollida,
         e.ubicacion_id, e.municipi_ine, e.comarca, e.gmaps_url, e.tipus_operacio, e.created_at
    from excedentes e
    cross join jo
    left join lateral public.desti_excedent(e.id) d on true
   where e.disponibilitat_id = p_disponibilitat
     and (jo.intern
          or e.productor_id in (select public.mis_productores())
          or (e.estado in ('publicada', 'parcial') and e.modalitats && jo.mods)
          or e.id in (select public.excedents_amb_interes_meu())
          or e.id in (select public.excedents_de_les_meves_canalitzacions()))
   order by e.created_at, e.id_excedente;
$$;

revoke execute on function public.ofertes_disponibilitat(uuid) from public, anon;
grant execute on function public.ofertes_disponibilitat(uuid) to authenticated, service_role;

comment on function public.ofertes_disponibilitat(uuid) is
  'Fase 6a (3.3, 20270620100300): las ofertas de una disponibilidad que la cuenta ve (misma regla '
  'que «excedentes: lectura per rol»), con kg_lliures (sin destino) y modalitats_meves (las que su '
  'entidad puede recibir; null para equipo y productor). Uuid ajeno o inventado: 0 filas.';
