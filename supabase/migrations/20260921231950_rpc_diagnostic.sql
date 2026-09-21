-- Las RPC del diagnóstico: contestar el cuestionario, generar el plan **por reglas** y
-- emitirlo. Es la mitad ejecutable de 20270405100000–100300.
--
-- 🔴 LA GENERACIÓN DEL PLAN VA EN SQL, NO EN TYPESCRIPT, y no es una preferencia de
--    lenguaje. Las reglas viven en tabla (`regles_pla`), la evaluación es un join más un
--    `jsonb_agg`, y —lo que decide— **guardar el diagnóstico y generar su plan tienen que
--    ser la misma transacción**. Calculándolo fuera habría que sacar las respuestas,
--    evaluar y volver a entrar a escribir: entre las dos llamadas existe un instante con
--    un diagnóstico contestado y un plan que todavía dice otra cosa, y si la segunda falla
--    ese instante se queda para siempre. Es el mismo argumento por el que
--    `aprovar_resposta()` hace en una transacción lo que `OfferDetail` hacía en cuatro
--    llamadas sueltas (§12.19).
--
-- CÓMO SE ENCADENA:
--   desar_diagnostic()  →  (si no falta ninguna obligatoria)  generar_pla_des_de_diagnostic()
--                       →  [desar_mesures_pla() si alguien las ajusta a mà]
--                       →  emitir_plan_basico()  →  documento PLA  →  descarga
--
-- ⚠️ `guardar_plan_basico()` (20270301100200) SE QUEDA COMO ESTÁ y sigue funcionando. Es
--    la puerta de un plan **sin cuestionario** (`questionari_id` null), que es lo que hay
--    en los planes ya emitidos, y el arnés la llama. `desar_diagnostic()` es la puerta
--    nueva, y las dos escriben el mismo borrador único por organización.

-- ---------------------------------------------------------------------------
-- 1. Helpers puros: aplicar, faltar, aplanar, componer
-- ---------------------------------------------------------------------------
-- Los cuatro son IMMUTABLE y no tocan ninguna tabla: se pueden probar con un `select` y
-- no hay ninguna rama de permisos dentro. Todo lo que decide permisos vive más abajo.

-- ¿Esta pregunta aplica, dadas las respuestas? El `aplica_a` usa **la misma gramática**
-- que `regles_pla` (`avaluar_regla`, 20270405100100). Tener dos implementaciones de «¿se
-- cumple esto?» garantizaría que algún día una pregunta que la pantalla oculta contara
-- como obligatoria en el servidor.
--
-- ⚠️ Se evalúa UN nivel. Si la pregunta padre tampoco aplicaba, su respuesta no está, y
--    entonces `avaluar_regla` devuelve false para cualquier operador que no sea `buit`:
--    la hija tampoco aplica, que es el resultado correcto sin necesidad de recursión.
create or replace function public.pregunta_aplica(p_pregunta jsonb, p_respostes jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  c jsonb;
begin
  c := p_pregunta -> 'aplica_a';
  if c is null or jsonb_typeof(c) <> 'object' then
    return true;
  end if;
  return public.avaluar_regla(
    coalesce(c ->> 'operador', '='),
    c -> 'valor',
    coalesce(p_respostes, '{}'::jsonb) -> (c ->> 'pregunta'));
end;
$$;

comment on function public.pregunta_aplica(jsonb, jsonb) is
  'Si una pregunta condicional aplica, con la misma gramática que regles_pla. Un solo nivel: la hija de una padre que no aplica tampoco aplica.';

-- Qué obligatorias **que aplican** se han quedado sin contestar. Devuelve los ids, no un
-- booleano: la pantalla tiene que poder señalar cuáles.
create or replace function public.diagnostic_falten(p_preguntes jsonb, p_respostes jsonb)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_falten text[] := '{}';
  q jsonb;
  v jsonb;
begin
  for q in select * from jsonb_array_elements(coalesce(p_preguntes, '[]'::jsonb)) loop
    if coalesce((q -> 'obligatoria')::text, 'false') = 'true'
       and public.pregunta_aplica(q, p_respostes) then
      v := coalesce(p_respostes, '{}'::jsonb) -> (q ->> 'id');
      -- Mismo criterio de «vacío» que `avaluar_regla`: null, cadena en blanco y array
      -- vacío son lo mismo para quien mira un formulario.
      if public.avaluar_regla('buit', null::jsonb, v) then
        v_falten := v_falten || (q ->> 'id');
      end if;
    end if;
  end loop;
  return v_falten;
end;
$$;

comment on function public.diagnostic_falten(jsonb, jsonb) is
  'Ids de las preguntas obligatorias que aplican y están sin contestar. Vacío = el diagnóstico está completo.';

-- El mapa plano {pregunta_id: valor} a partir del sobre guardado. Se prefiere
-- `respostes_crues` —que es exactamente lo que tecleó la persona— y solo se deriva del
-- array cuando no está, que es el caso de un plan anterior a esta fase.
create or replace function public.respostes_planes(p_respuestas jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    case when jsonb_typeof(p_respuestas -> 'respostes_crues') = 'object'
         then p_respuestas -> 'respostes_crues' end,
    (select jsonb_object_agg(r ->> 'id', coalesce(r -> 'valor', 'null'::jsonb))
       from jsonb_array_elements(coalesce(p_respuestas -> 'respostes', '[]'::jsonb)) r
      where r ->> 'id' is not null),
    '{}'::jsonb);
$$;

comment on function public.respostes_planes(jsonb) is
  'El mapa {pregunta_id: valor} de un sobre de respuestas. Prefiere respostes_crues; lo deriva del array si no está.';

-- 🔴 LAS RESPUESTAS, AUTOCONTENIDAS. Cada elemento lleva el texto de la pregunta y el de
--    la opción elegida, en ca y es, dentro. Es el mismo principio de `documentos.datos`:
--    el PDF de un plan de hace cinco años no puede depender de que su cuestionario siga
--    vivo, ni vigente, ni legible para quien lo mira (la política de
--    `questionaris_diagnostic` solo deja ver el vigente, §20270405100000).
--
-- ⚠️ Las preguntas que NO aplican y las que no se contestaron **no entran**: el documento
--    dice lo que se dijo, no una lista de huecos. Lo que falta lo dice `falten`, que es
--    otra pregunta y tiene su función.
create or replace function public.compondre_respostes(p_preguntes jsonb, p_respostes jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_out jsonb := '[]'::jsonb;
  q     jsonb;
  o     jsonb;
  v     jsonb;
  v_el  jsonb;
  v_etq jsonb;
begin
  for q in select * from jsonb_array_elements(coalesce(p_preguntes, '[]'::jsonb)) loop
    if not public.pregunta_aplica(q, p_respostes) then
      continue;
    end if;
    v := coalesce(p_respostes, '{}'::jsonb) -> (q ->> 'id');
    if public.avaluar_regla('buit', null::jsonb, v) then
      continue;
    end if;

    v_el := jsonb_build_object(
      'id',       q ->> 'id',
      'tipus',    q ->> 'tipus',
      'seccio',   q ->> 'seccio',
      'pregunta', q -> 'etiqueta',
      'valor',    v);

    if q ->> 'tipus' = 'opcio' then
      select o2 -> 'etiqueta' into v_etq
        from jsonb_array_elements(coalesce(q -> 'opcions', '[]'::jsonb)) o2
       where to_jsonb(o2 ->> 'valor') = v
       limit 1;
      v_el := v_el || jsonb_build_object('etiqueta', v_etq);

    elsif q ->> 'tipus' = 'multi' then
      v_etq := '[]'::jsonb;
      for o in select * from jsonb_array_elements(coalesce(q -> 'opcions', '[]'::jsonb)) loop
        if jsonb_typeof(v) = 'array'
           and exists (select 1 from jsonb_array_elements(v) e where e = to_jsonb(o ->> 'valor')) then
          v_etq := v_etq || jsonb_build_array(o -> 'etiqueta');
        end if;
      end loop;
      v_el := v_el || jsonb_build_object('etiquetes', v_etq);

    elsif q ->> 'tipus' = 'boolea' then
      -- Un `true` impreso tal cual en un PDF no lo entiende nadie.
      v_el := v_el || jsonb_build_object('etiqueta',
        case when v = 'true'::jsonb
             then '{"ca":"Sí","es":"Sí"}'::jsonb
             else '{"ca":"No","es":"No"}'::jsonb end);
    end if;

    v_out := v_out || jsonb_build_array(v_el);
  end loop;

  return v_out;
end;
$$;

comment on function public.compondre_respostes(jsonb, jsonb) is
  'El array de respuestas AUTOCONTENIDO: cada una con el texto de su pregunta y de su opción en ca y es. Lo que no aplica o no se contestó, fuera.';

revoke execute on function public.pregunta_aplica(jsonb, jsonb)        from public, anon;
revoke execute on function public.diagnostic_falten(jsonb, jsonb)      from public, anon;
revoke execute on function public.respostes_planes(jsonb)              from public, anon;
revoke execute on function public.compondre_respostes(jsonb, jsonb)    from public, anon;
grant  execute on function public.pregunta_aplica(jsonb, jsonb)        to authenticated, service_role;
grant  execute on function public.diagnostic_falten(jsonb, jsonb)      to authenticated, service_role;
grant  execute on function public.respostes_planes(jsonb)              to authenticated, service_role;
grant  execute on function public.compondre_respostes(jsonb, jsonb)    to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. questionari_vigent(): el cuestionario que toca contestar
-- ---------------------------------------------------------------------------
-- `security invoker` a propósito: la política de la tabla ya dice exactamente lo que hay
-- que decir (`vigente or es_intern()`), así que una `definer` aquí solo podría ampliar el
-- alcance sin ningún motivo. Devuelve 0 o 1 fila.
-- ⚠️ `language plpgsql` y no `sql`, aunque el cuerpo sea una línea. Un `select *` dentro
--    de una función SQL se expande a la lista de columnas **al crearla**, así que el día
--    que alguien añada una columna a la tabla esta función empezaría a responder
--    `42804 structure of query does not match function result type`. En plpgsql la
--    consulta se replanifica cuando el esquema cambia y se adapta sola.
create or replace function public.questionari_vigent(p_tipo_org text)
returns setof questionaris_diagnostic
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
    select * from questionaris_diagnostic q
     where q.tipo_org = p_tipo_org and q.vigente
     limit 1;
end;
$$;

comment on function public.questionari_vigent(text) is
  'El cuestionario vigente de un tipo de organización. security invoker: la política de la tabla ya decide.';

revoke execute on function public.questionari_vigent(text) from public, anon;
grant  execute on function public.questionari_vigent(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. publicar_questionari(): la versión siguiente
-- ---------------------------------------------------------------------------
-- `pot_aprovar()`, igual que publicar el texto de una plantilla (20260928100100): decidir
-- qué se le pregunta a una organización es una decisión, no una tarea.
--
-- ⚠️ Devuelve además `regles_orfes`: las reglas activas de ese tipo que apuntan a una
--    pregunta que el cuestionario nuevo ya no tiene. **No bloquea la publicación** —una
--    regla huérfana simplemente no dispara (`avaluar_regla` devuelve false sin respuesta)—
--    pero quien publica tiene que verlo: si no, el plan siguiente saldría con menos
--    medidas y nadie sabría por qué.
create or replace function public.publicar_questionari(
  p_tipo_org    text,
  p_titol       jsonb,
  p_preguntes   jsonb,
  p_provisional boolean default true,
  p_vigent      boolean default true
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_problemes text[];
  v_versio    int;
  v_ids       text[];
  v_orfes     jsonb;
  q           questionaris_diagnostic%rowtype;
begin
  -- `auth.uid() is null` es `service_role` (script o Edge Function): decide él (§4bis).
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Publicar un questionari es del super_admin o de l''admin' using errcode = '42501';
  end if;
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;

  -- El mensaje legible, ANTES de que el CHECK de la tabla diga solo `23514`.
  v_problemes := public.questionari_problemes(p_preguntes);
  if coalesce(array_length(v_problemes, 1), 0) > 0 then
    raise exception 'El questionari no es valid: %', array_to_string(v_problemes, ' · ')
      using errcode = '22023';
  end if;

  select coalesce(max(versio), -1) + 1 into v_versio
    from questionaris_diagnostic where tipo_org = p_tipo_org;

  -- Retirar el anterior ANTES de insertar: el índice único parcial no deja dos vigentes,
  -- y el orden inverso fallaría con 23505.
  if p_vigent then
    update questionaris_diagnostic set vigente = false
     where tipo_org = p_tipo_org and vigente;
  end if;

  insert into questionaris_diagnostic (
    tipo_org, versio, provisional, vigente, titol, preguntes, created_by)
  values (
    p_tipo_org, v_versio, coalesce(p_provisional, true), coalesce(p_vigent, true),
    p_titol, p_preguntes, auth.uid())
  returning * into q;

  select array_agg(e ->> 'id') into v_ids
    from jsonb_array_elements(p_preguntes) e;

  select coalesce(jsonb_agg(jsonb_build_object(
           'regla', g.id, 'pregunta', g.pregunta_id, 'mesura', g.mesura_codi)), '[]'::jsonb)
    into v_orfes
    from regles_pla g
   where g.activa and g.tipo_org = p_tipo_org
     and g.pregunta_id is not null
     and not (g.pregunta_id = any (coalesce(v_ids, '{}'::text[])));

  return jsonb_build_object(
    'questionari', to_jsonb(q),
    'versio', q.versio,
    'vigent', q.vigente,
    'provisional', q.provisional,
    'regles_orfes', v_orfes);
end;
$$;

comment on function public.publicar_questionari(text, jsonb, jsonb, boolean, boolean) is
  'Publica la versión siguiente del cuestionario y retira la anterior. pot_aprovar(). Devuelve las reglas que se quedan huérfanas: no bloquea, avisa.';

revoke execute on function public.publicar_questionari(text, jsonb, jsonb, boolean, boolean) from public, anon;
grant  execute on function public.publicar_questionari(text, jsonb, jsonb, boolean, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. generar_pla_des_de_diagnostic(): las reglas, evaluadas
-- ---------------------------------------------------------------------------
-- 🔴 DESDUPLICA POR `codi`. Varias reglas pueden producir la misma medida —`conveni_donacio`
--    la disparan cuatro— y un plan que la repitiera cuatro veces sería ilegible. Gana la
--    que la deja **obligatoria** y, a igualdad, la de `prioritat` menor. Nunca al revés:
--    una medida obligatoria no la rebaja otra regla.
--
-- ⚠️ `22023 mesures_editades` si alguien ya ajustó la lista a mano y no viene `p_forcar`.
--    Regenerar en silencio se llevaría por delante el criterio del técnico que estuvo
--    delante de la persona, y eso no se nota hasta que se lee el PDF.
create or replace function public.generar_pla_des_de_diagnostic(
  p_tipo_org text,
  p_org      uuid,
  p_forcar   boolean default false
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  pl        planes_prevencion%rowtype;
  v_flat    jsonb;
  v_llista  jsonb;
  v_regles  jsonb;
  v_oblig   int;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  if not public.puc_gestionar_pla(p_tipo_org, p_org) then
    raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
  end if;

  -- `tipo_org` en el filtro no es redundante aunque el uuid ya sea único: hace que la
  -- consulta diga lo que quiere decir, y que un borrador del otro papel de la misma
  -- organización no se pueda colar nunca por un enlace mal hecho.
  select * into pl
    from planes_prevencion
   where estado = 'esborrany'
     and tipo_org = p_tipo_org
     and coalesce(productor_id, entidad_id) = p_org
   for update;

  if pl.id is null then
    raise exception 'sense_esborrany: aquesta organitzacio no te cap diagnostic obert'
      using errcode = '22023';
  end if;

  if coalesce((pl.mesures ->> 'editat')::boolean, false) and not coalesce(p_forcar, false) then
    raise exception 'mesures_editades: les mesures d''aquest pla s''han ajustat a ma. Torna-ho a generar amb forcar = true si vols descartar-ho.'
      using errcode = '22023';
  end if;

  v_flat := public.respostes_planes(pl.respuestas);

  with aplica as (
    select g.id as regla_id, g.mesura_codi, g.obligatoria, g.prioritat
      from regles_pla g
     where g.activa
       and g.tipo_org = pl.tipo_org
       and public.avaluar_regla(g.operador, g.valor, v_flat -> g.pregunta_id)
  ),
  triades as (
    select distinct on (a.mesura_codi)
           a.mesura_codi,
           (a.obligatoria or m.obligatoria_per_defecte) as obligatoria,
           m.bloc, m.ordre, m.titol, m.descripcio
      from aplica a
      join mesures_prevencio m
        on m.codi = a.mesura_codi and m.tipo_org = pl.tipo_org
     where m.activa
     order by a.mesura_codi, (a.obligatoria or m.obligatoria_per_defecte) desc, a.prioritat asc
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
                'codi',        t.mesura_codi,
                'bloc',        t.bloc,
                -- ⚠️ Resuelto AL IDIOMA DEL PLAN y copiado dentro (§20270405100200): el
                --    documento no puede depender del catálogo dentro de cinco años.
                'titol',       coalesce(t.titol      ->> pl.idioma, t.titol      ->> 'ca'),
                'descripcio',  coalesce(t.descripcio ->> pl.idioma, t.descripcio ->> 'ca'),
                'obligatoria', t.obligatoria,
                'origen',      'regla')
              order by t.ordre, t.mesura_codi)
             from triades t), '[]'::jsonb),
    coalesce((select jsonb_agg(a.regla_id) from aplica a), '[]'::jsonb),
    coalesce((select count(*) from triades t where t.obligatoria), 0)
  into v_llista, v_regles, v_oblig;

  update planes_prevencion
     set mesures = jsonb_build_object(
           'generat_at',       to_jsonb(now()),
           'regles_aplicades', v_regles,
           'editat',           false,
           'observacions',     pl.mesures -> 'observacions',
           'llista',           v_llista)
   where id = pl.id
  returning * into pl;

  return jsonb_build_object(
    'pla', pl.id,
    'mesures_n', jsonb_array_length(v_llista),
    'obligatories_n', v_oblig,
    'regles_aplicades_n', jsonb_array_length(v_regles));
end;
$$;

comment on function public.generar_pla_des_de_diagnostic(text, uuid, boolean) is
  'Evalúa regles_pla contra el diagnóstico abierto y escribe planes_prevencion.mesures. Desduplica por codi. 22023 mesures_editades si ya se ajustó a mano y no viene forcar.';

revoke execute on function public.generar_pla_des_de_diagnostic(text, uuid, boolean) from public, anon;
grant  execute on function public.generar_pla_des_de_diagnostic(text, uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. desar_diagnostic(): contestar, y de paso generar
-- ---------------------------------------------------------------------------
-- `p_respostes` es el mapa PLANO `{pregunta_id: valor}` —lo natural de un formulario—.
-- El array autocontenido lo compone el servidor: si lo compusiera el cliente, el texto de
-- la pregunta que queda congelado en el plan sería el que el navegador dijo haber
-- enseñado, no el que el cuestionario dice. Es el mismo criterio que `sha256_texto` en la
-- firma de un convenio (§9).
--
-- Guarda SIEMPRE, complete o no. Un diagnóstico de doce preguntas no se contesta de una
-- sentada, y perder lo tecleado porque falta una obligatoria sería la forma más segura de
-- que nadie lo termine. Lo que depende de estar completo es **generar el plan**.
create or replace function public.desar_diagnostic(
  p_tipo_org  text,
  p_org       uuid,
  p_respostes jsonb,
  p_notes     text default null,
  p_idioma    text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  q        questionaris_diagnostic%rowtype;
  pl       planes_prevencion%rowtype;
  v_sobre  jsonb;
  v_falten text[];
  v_gen    jsonb := null;
  v_editat boolean;
  v_pla    uuid;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  if not public.puc_gestionar_pla(p_tipo_org, p_org) then
    raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
  end if;
  if p_respostes is null or jsonb_typeof(p_respostes) <> 'object' then
    raise exception 'Les respostes han de ser un objecte {pregunta_id: valor}' using errcode = '22023';
  end if;
  if p_idioma is not null and p_idioma not in ('ca', 'es') then
    raise exception 'Idioma desconegut: %', p_idioma using errcode = '22023';
  end if;

  select * into q from questionaris_diagnostic
   where tipo_org = p_tipo_org and vigente limit 1;
  if q.id is null then
    raise exception 'sense_questionari: no hi ha cap questionari vigent per a % ', p_tipo_org
      using errcode = '22023';
  end if;

  v_falten := public.diagnostic_falten(q.preguntes, p_respostes);

  v_sobre := jsonb_build_object(
    'questionari',             'diagnostic_' || p_tipo_org,
    'questionari_id',          q.id,
    'versio_questionari',      q.versio,
    'questionari_provisional', q.provisional,
    'titol',                   q.titol,
    -- Lo que se dijo, con su texto dentro. Es lo que se imprime.
    'respostes',               public.compondre_respostes(q.preguntes, p_respostes),
    -- Y lo que se tecleó, tal cual, para poder volver a abrir el formulario exacto y para
    -- que las reglas se evalúen sobre el valor y no sobre su etiqueta.
    'respostes_crues',         p_respostes,
    'notes',                   to_jsonb(p_notes),
    'desat_at',                to_jsonb(now()));

  update planes_prevencion
     set respuestas     = v_sobre,
         questionari_id = q.id,
         idioma         = coalesce(p_idioma, idioma)
   where estado = 'esborrany'
     and tipo_org = p_tipo_org
     and coalesce(productor_id, entidad_id) = p_org
  returning * into pl;

  if pl.id is null then
    insert into planes_prevencion (
      tipo_org, productor_id, entidad_id, nivel, respuestas, questionari_id, idioma, creado_por)
    values (
      p_tipo_org,
      case when p_tipo_org = 'productor' then p_org end,
      case when p_tipo_org = 'entidad'   then p_org end,
      'basic', v_sobre, q.id, coalesce(p_idioma, 'ca'), auth.uid())
    returning * into pl;
  end if;

  v_editat := coalesce((pl.mesures ->> 'editat')::boolean, false);

  -- Se genera solo cuando el diagnóstico está completo, y **nunca por encima de una lista
  -- ajustada a mano**: ahí se devuelve `mesures_editades` y quien llama decide si fuerza.
  if coalesce(array_length(v_falten, 1), 0) = 0 and not v_editat then
    v_pla := pl.id;
    v_gen := public.generar_pla_des_de_diagnostic(p_tipo_org, p_org, false);
    -- Releer con una variable aparte y NO con `where id = pl.id`: ahí se estaría usando
    -- el destino del `into` como filtro, que funciona pero se lee al revés de como actúa.
    select * into pl from planes_prevencion where id = v_pla;
  end if;

  return jsonb_build_object(
    'pla',                     pl.id,
    'questionari_id',          q.id,
    'versio_questionari',      q.versio,
    'questionari_provisional', q.provisional,
    'falten',                  to_jsonb(v_falten),
    'complet',                 coalesce(array_length(v_falten, 1), 0) = 0,
    'mesures_editades',        v_editat,
    'te_mesures',              jsonb_array_length(coalesce(pl.mesures -> 'llista', '[]'::jsonb)) > 0,
    'mesures_n',               jsonb_array_length(coalesce(pl.mesures -> 'llista', '[]'::jsonb)),
    'generacio',               v_gen);
end;
$$;

comment on function public.desar_diagnostic(text, uuid, jsonb, text, text) is
  'Guarda el diagnóstico (siempre, completo o no), compone el sobre autocontenido y genera el plan si no falta ninguna obligatoria. puc_gestionar_pla().';

revoke execute on function public.desar_diagnostic(text, uuid, jsonb, text, text) from public, anon;
grant  execute on function public.desar_diagnostic(text, uuid, jsonb, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. desar_mesures_pla(): ajustar la lista a mano
-- ---------------------------------------------------------------------------
-- `p_mesures` es **el array** de medidas (la `llista`), no el sobre entero: el sobre lo
-- monta el servidor con su `generat_at`, su `editat` y sus reglas, que no son del cliente.
--
-- 🔴 DOS INVARIANTES QUE NO SE PUEDEN SALTAR:
--   1. **El texto de una medida del catálogo viene del catálogo.** Si el `codi` existe en
--      `mesures_prevencio`, su bloque, su título y su descripción se vuelven a leer de
--      ahí y se ignora lo que venga en el cuerpo. Sin esto, cualquiera podría reescribir
--      el contenido de una medida en un documento que luego se emite con el sello de la
--      Fundación.
--   2. **Una medida obligatoria que produjeron las reglas no se puede quitar.** Se
--      responde `22023 falten_obligatories` con los códigos. Ajustar el plan es quitar
--      recomendaciones que no encajan, no quitarse el registro de encima.
create or replace function public.desar_mesures_pla(
  p_plan         uuid,
  p_mesures      jsonb,
  p_observacions text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  pl        planes_prevencion%rowtype;
  m         jsonb;
  v_codi    text;
  v_cat     mesures_prevencio%rowtype;
  v_out     jsonb := '[]'::jsonb;
  v_codis   text[] := '{}';
  v_falten  text[];
  v_origen  text;
begin
  select * into pl from planes_prevencion where id = p_plan for update;
  if pl.id is null then
    raise exception 'Aquest pla no existeix' using errcode = '22023';
  end if;
  if not public.puc_gestionar_pla(pl.tipo_org, coalesce(pl.productor_id, pl.entidad_id)) then
    raise exception 'Aquest pla no es teu' using errcode = '42501';
  end if;
  if pl.estado <> 'esborrany' then
    raise exception 'Aquest pla ja esta emes (%): fes un diagnostic nou.',
      coalesce(pl.numero_completo, pl.id::text) using errcode = '22023';
  end if;
  if p_mesures is null or jsonb_typeof(p_mesures) <> 'array' then
    raise exception 'Les mesures han de ser un array' using errcode = '22023';
  end if;

  for m in select * from jsonb_array_elements(p_mesures) loop
    v_codi := m ->> 'codi';
    if v_codi is null then
      raise exception 'Cada mesura ha de portar un codi' using errcode = '22023';
    end if;
    if v_codi = any (v_codis) then
      raise exception 'La mesura "%" esta repetida', v_codi using errcode = '22023';
    end if;
    v_codis := v_codis || v_codi;

    -- ¿Venía de las reglas? Se conserva su origen; lo que se añade ahora es manual.
    v_origen := case when exists (
        select 1 from jsonb_array_elements(coalesce(pl.mesures -> 'llista', '[]'::jsonb)) e
         where e ->> 'codi' = v_codi and e ->> 'origen' = 'regla')
      then 'regla' else 'manual' end;

    select * into v_cat from mesures_prevencio
     where codi = v_codi and tipo_org = pl.tipo_org;

    if v_cat.codi is not null then
      -- Invariante 1: el texto sale del catálogo, nunca del cuerpo de la petición.
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'codi',        v_cat.codi,
        'bloc',        v_cat.bloc,
        'titol',       coalesce(v_cat.titol      ->> pl.idioma, v_cat.titol      ->> 'ca'),
        'descripcio',  coalesce(v_cat.descripcio ->> pl.idioma, v_cat.descripcio ->> 'ca'),
        -- Tampoco se puede rebajar por debajo de lo que el catálogo declara obligatorio.
        'obligatoria', coalesce((m ->> 'obligatoria')::boolean, false) or v_cat.obligatoria_per_defecte,
        'origen',      v_origen));
    else
      -- Una medida que no está en el catálogo: la escribe una persona y responde de ella.
      if m ->> 'titol' is null or m ->> 'descripcio' is null
         or coalesce(m ->> 'bloc', '') not in
            ('planificacio', 'collita', 'conservacio', 'canalitzacio', 'seguiment') then
        raise exception 'La mesura "%" no es del cataleg: necessita bloc, titol i descripcio', v_codi
          using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'codi',        v_codi,
        'bloc',        m ->> 'bloc',
        'titol',       m ->> 'titol',
        'descripcio',  m ->> 'descripcio',
        'obligatoria', coalesce((m ->> 'obligatoria')::boolean, false),
        'origen',      'manual'));
    end if;
  end loop;

  -- Invariante 2.
  select coalesce(array_agg(e ->> 'codi'), '{}'::text[]) into v_falten
    from jsonb_array_elements(coalesce(pl.mesures -> 'llista', '[]'::jsonb)) e
   where (e ->> 'obligatoria')::boolean
     and e ->> 'origen' = 'regla'
     and not ((e ->> 'codi') = any (v_codis));

  if coalesce(array_length(v_falten, 1), 0) > 0 then
    raise exception 'falten_obligatories: no es poden treure les mesures obligatories (%)',
      array_to_string(v_falten, ', ') using errcode = '22023';
  end if;

  update planes_prevencion
     set mesures = jsonb_build_object(
           'generat_at',       coalesce(pl.mesures -> 'generat_at', to_jsonb(now())),
           'regles_aplicades', coalesce(pl.mesures -> 'regles_aplicades', '[]'::jsonb),
           'editat',           true,
           'observacions',     coalesce(to_jsonb(p_observacions), pl.mesures -> 'observacions'),
           'llista',           v_out)
   where id = pl.id
  returning * into pl;

  return jsonb_build_object(
    'pla', pl.id,
    'mesures_n', jsonb_array_length(v_out),
    'editat', true);
end;
$$;

comment on function public.desar_mesures_pla(uuid, jsonb, text) is
  'Ajusta a mano la lista de medidas de un plan en borrador. El texto de una medida del catálogo se relee del catálogo; una obligatoria de regla no se puede quitar (22023 falten_obligatories).';

revoke execute on function public.desar_mesures_pla(uuid, jsonb, text) from public, anon;
grant  execute on function public.desar_mesures_pla(uuid, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. fixar_nivell_pla(): básico o personalizado
-- ---------------------------------------------------------------------------
-- ⚠️ Subir a `personalitzat` exige `pot_aprovar()`, bajar a `basic` no. El plan
--    personalizado es un servicio técnico de la Fundación, no una casilla: si una
--    organización pudiera declararlo desde su panel, estaría contratándose a sí misma un
--    servicio que nadie ha prestado. Lo contrario —renunciar— no tiene ese problema.
create or replace function public.fixar_nivell_pla(p_plan uuid, p_nivel text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  pl planes_prevencion%rowtype;
begin
  if p_nivel not in ('basic', 'personalitzat') then
    raise exception 'Nivell desconegut: %', p_nivel using errcode = '22023';
  end if;

  select * into pl from planes_prevencion where id = p_plan for update;
  if pl.id is null then
    raise exception 'Aquest pla no existeix' using errcode = '22023';
  end if;
  if not public.puc_gestionar_pla(pl.tipo_org, coalesce(pl.productor_id, pl.entidad_id)) then
    raise exception 'Aquest pla no es teu' using errcode = '42501';
  end if;
  if pl.estado <> 'esborrany' then
    raise exception 'Aquest pla ja esta emes (%)', coalesce(pl.numero_completo, pl.id::text)
      using errcode = '22023';
  end if;
  if p_nivel = 'personalitzat' and auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'El pla personalitzat el fixa l''equip' using errcode = '42501';
  end if;

  update planes_prevencion set nivel = p_nivel where id = p_plan returning * into pl;
  return jsonb_build_object('pla', pl.id, 'nivell', pl.nivel);
end;
$$;

comment on function public.fixar_nivell_pla(uuid, text) is
  'Fija el nivel de un plan en borrador. Subir a personalitzat es de pot_aprovar(): es un servicio técnico, no una casilla.';

revoke execute on function public.fixar_nivell_pla(uuid, text) from public, anon;
grant  execute on function public.fixar_nivell_pla(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. diagnostic_estat(): en qué punto está una organización
-- ---------------------------------------------------------------------------
-- Una sola llamada con todo lo que necesita la pantalla, como `pendents_equip()`. Los
-- estados son cinco y describen situaciones distintas de verdad:
--   sense_questionari · sense_comencar · incomplet · a_punt · emes
create or replace function public.diagnostic_estat(p_tipo_org text, p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q        questionaris_diagnostic%rowtype;
  pe       planes_prevencion%rowtype;
  pv       planes_prevencion%rowtype;
  v_falten text[] := '{}';
  v_estat  text;
  v_mes    int := 0;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  if not public.puc_gestionar_pla(p_tipo_org, p_org) then
    raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
  end if;

  select * into q  from questionaris_diagnostic where tipo_org = p_tipo_org and vigente limit 1;
  select * into pe from planes_prevencion
   where estado = 'esborrany'
     and tipo_org = p_tipo_org
     and coalesce(productor_id, entidad_id) = p_org;
  select * into pv from planes_prevencion
   where vigente
     and tipo_org = p_tipo_org
     and coalesce(productor_id, entidad_id) = p_org;

  if pe.id is not null then
    v_mes := jsonb_array_length(coalesce(pe.mesures -> 'llista', '[]'::jsonb));
    if q.id is not null then
      v_falten := public.diagnostic_falten(q.preguntes, public.respostes_planes(pe.respuestas));
    end if;
  end if;

  if q.id is null then
    v_estat := 'sense_questionari';
  elsif pe.id is null then
    v_estat := case when pv.id is not null then 'emes' else 'sense_comencar' end;
  elsif coalesce(array_length(v_falten, 1), 0) > 0 or v_mes = 0 then
    v_estat := 'incomplet';
  else
    v_estat := 'a_punt';
  end if;

  return jsonb_build_object(
    'estat',          v_estat,
    'pla_esborrany',  pe.id,
    'pla_vigent',     pv.id,
    'numero',         pv.numero_completo,
    'versio',         pv.version,
    'emes_at',        pv.emitido_at,
    'nivell',         coalesce(pe.nivel, pv.nivel),
    'idioma',         coalesce(pe.idioma, pv.idioma),
    'falten',         to_jsonb(v_falten),
    'te_mesures',     v_mes > 0,
    'mesures_n',      v_mes,
    'mesures_editades', coalesce((pe.mesures ->> 'editat')::boolean, false),
    'questionari_id', q.id,
    'versio_questionari', q.versio,
    -- Lo que decide si el PDF sale marcado como borrador. Ante la duda, `true`: decir que
    -- un documento está validado cuando no lo está es el único error caro.
    'provisional',    coalesce(q.provisional, true));
end;
$$;

comment on function public.diagnostic_estat(text, uuid) is
  'En qué punto está el diagnóstico de una organización: estat, borrador, plan vigente, qué falta y cuántas medidas. puc_gestionar_pla().';

revoke execute on function public.diagnostic_estat(text, uuid) from public, anon;
grant  execute on function public.diagnostic_estat(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. diagnostics_equip(): la misma pregunta, para toda la base
-- ---------------------------------------------------------------------------
-- `security invoker`, mismo criterio que `pendents_equip()` y `missatges_sense_contestar()`
-- (§4bis): agrega solo lo que quien pregunta ya puede leer. Una `definer` aquí cruzaría
-- fichas, planes y cuestionarios sin que ninguna RLS volviera a filtrar.
--
-- ⚠️ LA GUARDA VA CON `auth.uid() is not null and not es_intern()`, no con `es_intern()` a
--    secas: `service_role` no tiene `auth.uid()` y para él `es_intern()` es falso, así que
--    la forma corta le respondería 42501 a la propia plataforma (§4bis).
create or replace function public.diagnostics_equip()
returns table (
  tipo_org        text,
  org_id          uuid,
  nom             text,
  es_test         boolean,
  estat           text,
  falten_n        int,
  mesures_n       int,
  pla_esborrany   uuid,
  pla_vigent      uuid,
  numero          text,
  versio          int,
  emes_at         timestamptz,
  versio_questionari int,
  provisional     boolean
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
-- 🔴 EL PRAGMA DE ARRIBA NO ES ADORNO, y va en la PRIMERA línea del cuerpo porque ahí es
--    donde plpgsql lo lee. En PL/pgSQL los parámetros de un `returns table` son
--    VARIABLES, así que `tipo_org`, `estat`, `versio`, `numero` o `provisional` sin
--    cualificar dentro del cuerpo son ambiguos y la función responde
--    `42702 column reference is ambiguous` SIEMPRE — no una vez de cada diez: siempre.
--    Es exactamente lo que dejó `canalitzacions_actives()` inservible desde el día que se
--    creó sin que nada lo cazara (20270402100000). Aquí van las dos defensas: todas las
--    referencias del cuerpo están cualificadas por alias, Y este pragma hace que una que
--    se cuele en el futuro —dentro de una subconsulta anidada, que es donde se coló
--    aquella— resuelva a la columna en vez de romper.
--    ⚠️ Solo es seguro porque esta función NO lee ninguna de sus variables dentro de la
--    consulta. En una que sí lo hiciera, el pragma cambiaría el significado en silencio.
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Els diagnostics de la base son de l''equip' using errcode = '42501';
  end if;

  return query
  with fitxes as (
    select 'productor'::text as tipo_org, pr.id as org_id,
           coalesce(pr.empresa, pr.name) as nom, pr.es_test
      from productores pr
    union all
    select 'entidad'::text, en.id, en.nombre, en.es_test
      from entidades en
  ),
  q as (
    select qd.tipo_org, qd.id, qd.versio, qd.provisional, qd.preguntes
      from questionaris_diagnostic qd where qd.vigente
  )
  select
    f.tipo_org,
    f.org_id,
    f.nom,
    f.es_test,
    case
      when q.id is null then 'sense_questionari'
      when pe.id is null then case when pv.id is not null then 'emes' else 'sense_comencar' end
      when coalesce(array_length(
             public.diagnostic_falten(q.preguntes, public.respostes_planes(pe.respuestas)), 1), 0) > 0
           or jsonb_array_length(coalesce(pe.mesures -> 'llista', '[]'::jsonb)) = 0 then 'incomplet'
      else 'a_punt'
    end as estat,
    case when pe.id is null or q.id is null then 0
         else coalesce(array_length(
                public.diagnostic_falten(q.preguntes, public.respostes_planes(pe.respuestas)), 1), 0)
    end as falten_n,
    coalesce(jsonb_array_length(coalesce(pe.mesures -> 'llista', '[]'::jsonb)), 0) as mesures_n,
    pe.id, pv.id, pv.numero_completo, pv.version, pv.emitido_at,
    q.versio, q.provisional
  from fitxes f
  left join q on q.tipo_org = f.tipo_org
  left join planes_prevencion pe
    on pe.tipo_org = f.tipo_org
   and coalesce(pe.productor_id, pe.entidad_id) = f.org_id
   and pe.estado = 'esborrany'
  left join planes_prevencion pv
    on pv.tipo_org = f.tipo_org
   and coalesce(pv.productor_id, pv.entidad_id) = f.org_id
   and pv.vigente
  order by f.tipo_org, f.nom;
end;
$$;

comment on function public.diagnostics_equip() is
  'El estado del diagnóstico de todas las fichas, para la bandeja del equipo. security invoker: agrega solo lo que quien pregunta ya puede leer.';

revoke execute on function public.diagnostics_equip() from public, anon;
grant  execute on function public.diagnostics_equip() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. plan_datos(): el snapshot, ahora con las medidas
-- ---------------------------------------------------------------------------
-- Se recrea entera (20270301100200 §1) para añadir dos cosas que el PDF necesita y no
-- tenía: `mesures` —que es el contenido del plan— y `questionari_provisional`, que es lo
-- que hace que el documento **diga impreso** que se hizo con un cuestionario sin validar.
--
-- ⚠️ Se repiten todos los atributos (`stable security definer set search_path`): un
--    `create or replace` los reescribe, no los hereda (§4bis, `get_my_session_context`).
create or replace function public.plan_datos(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  pl  planes_prevencion%rowtype;
  par parametros_documentales%rowtype;
  v_org jsonb;
  v_prov boolean;
begin
  select * into pl from planes_prevencion where id = p_plan;
  if pl.id is null then
    raise exception 'Aquest pla no existeix' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  if pl.tipo_org = 'productor' then
    select jsonb_build_object('tipus', 'productor',
                              'nom', coalesce(pr.empresa, pr.name),
                              'nif', pr.nif, 'poblacio', pr.poblacion,
                              'comarca', pr.area_geografica, 'email', pr.email)
      into v_org from productores pr where pr.id = pl.productor_id;
  else
    select jsonb_build_object('tipus', 'entitat',
                              'nom', en.nombre,
                              'nif', en.nif, 'poblacio', en.poblacion,
                              'comarca', en.area_geografica, 'email', en.email)
      into v_org from entidades en where en.id = pl.entidad_id;
  end if;

  -- Del sobre congelado primero (es lo que valía cuando se contestó) y del cuestionario
  -- solo como respaldo. Al revés, un plan emitido cambiaría de «provisional» a validado
  -- el día que alguien tocara la tabla, que es justo lo que un snapshot evita.
  v_prov := coalesce(
    (pl.respuestas ->> 'questionari_provisional')::boolean,
    (select qd.provisional from questionaris_diagnostic qd where qd.id = pl.questionari_id),
    true);

  return jsonb_build_object(
    'tipus', 'PLA',
    'nivell', pl.nivel,
    'numero', pl.numero_completo,
    'versio', pl.version,
    'exercici', pl.ejercicio,
    'data_generacio', now(),
    'lloc', par.poblacion,
    'idioma', pl.idioma,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'organitzacio', v_org,
    -- El sobre del cuestionario, autocontenido (20270405100400 §1).
    'questionari', pl.respuestas,
    'questionari_id', pl.questionari_id,
    'questionari_versio', (pl.respuestas ->> 'versio_questionari')::int,
    -- 🔴 Que el PDF pueda decir que el cuestionario es texto de trabajo sin validar.
    'questionari_provisional', v_prov,
    -- Y el contenido del plan: las medidas, ya resueltas al idioma y copiadas.
    'mesures', coalesce(pl.mesures -> 'llista', '[]'::jsonb),
    'mesures_observacions', pl.mesures -> 'observacions');
end;
$$;

comment on function public.plan_datos(uuid) is
  'Snapshot congelado del plan: la organización, el cuestionario autocontenido y las medidas ya resueltas al idioma. Lleva questionari_provisional para que el PDF lo diga.';

revoke execute on function public.plan_datos(uuid) from public, anon;
grant  execute on function public.plan_datos(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. emitir_plan_basico(): ahora exige un diagnóstico completo
-- ---------------------------------------------------------------------------
-- Se recrea entera (20270301100200 §5). Lo que cambia son **dos guardas nuevas, y solo
-- cuando el plan tiene cuestionario**:
--   · no puede faltar ninguna obligatoria que aplique, y
--   · la lista de medidas no puede estar vacía.
--
-- ⚠️ `if pl.questionari_id is not null` no es una cortesía: los planes emitidos antes de
--    esta fase —y `guardar_plan_basico()`, que sigue existiendo— no tienen cuestionario,
--    y exigirles obligatorias de un cuestionario que no contestaron los dejaría sin poder
--    emitirse nunca. Es la misma forma que tiene `20260921214526` de no romper el pasado.
--
-- ⚠️ Un plan **sin ninguna medida** no es un plan de prevención: es una lista de
--    respuestas. Emitirlo con el sello de la Fundación afirmaría haber hecho un trabajo
--    que no se ha hecho.
create or replace function public.emitir_plan_basico(p_plan uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  pl        planes_prevencion%rowtype;
  q         questionaris_diagnostic%rowtype;
  v_falten  text[];
  v_org     uuid;
  v_ej      int;
  v_n       int;
  v_version int;
  v_prev    uuid;
  v_doc     uuid;
begin
  select * into pl from planes_prevencion where id = p_plan for update;
  if pl.id is null then
    raise exception 'Aquest pla no existeix' using errcode = '22023';
  end if;
  if not public.puc_gestionar_pla(pl.tipo_org, coalesce(pl.productor_id, pl.entidad_id)) then
    raise exception 'Aquest pla no es teu' using errcode = '42501';
  end if;
  if pl.estado <> 'esborrany' then
    raise exception 'Aquest pla ja esta emes (%)', coalesce(pl.numero_completo, pl.id::text)
      using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(pl.respuestas -> 'respostes', '[]'::jsonb)) = 0 then
    raise exception 'No es pot emetre un pla sense cap resposta' using errcode = '22023';
  end if;

  if pl.questionari_id is not null then
    select * into q from questionaris_diagnostic where id = pl.questionari_id;
    v_falten := public.diagnostic_falten(q.preguntes, public.respostes_planes(pl.respuestas));
    if coalesce(array_length(v_falten, 1), 0) > 0 then
      raise exception 'falten_obligatories: el diagnostic no esta complet (%)',
        array_to_string(v_falten, ', ') using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(pl.mesures -> 'llista', '[]'::jsonb)) = 0 then
      raise exception 'sense_mesures: un pla sense cap mesura no es un pla de prevencio'
        using errcode = '22023';
    end if;
  end if;

  v_org := coalesce(pl.productor_id, pl.entidad_id);
  v_ej  := extract(year from (now() at time zone 'Europe/Madrid'))::int;

  select coalesce(max(version), 0) + 1 into v_version
    from planes_prevencion
   where coalesce(productor_id, entidad_id) = v_org and estado <> 'esborrany';

  select id into v_prev
    from planes_prevencion
   where coalesce(productor_id, entidad_id) = v_org and vigente and id <> p_plan;

  if v_prev is not null then
    update planes_prevencion
       set vigente = false, estado = 'substituit'
     where id = v_prev;
  end if;

  v_n := public.siguiente_numero('PLA', v_ej);

  update planes_prevencion
     set serie           = 'PLA',
         ejercicio       = v_ej,
         numero          = v_n,
         numero_completo = public.formato_numero('PLA', v_ej, v_n),
         version         = v_version,
         estado          = 'emes',
         vigente         = true,
         emitido_at      = now(),
         emitido_por     = auth.uid()
   where id = p_plan
  returning * into pl;

  if v_prev is not null then
    update planes_prevencion set sustituido_por = p_plan where id = v_prev;
  end if;

  v_doc := public.plan_emet_document(p_plan);

  return jsonb_build_object(
    'pla', p_plan,
    'document', v_doc,
    'numero', pl.numero_completo,
    'versio', pl.version,
    'mesures_n', jsonb_array_length(coalesce(pl.mesures -> 'llista', '[]'::jsonb)),
    'substitueix', v_prev,
    'descarrega_immediata', true);
end;
$$;

comment on function public.emitir_plan_basico(uuid) is
  'Número, versión, documento y a descargar. Con cuestionario, exige que no falte ninguna obligatoria y que haya al menos una medida.';

revoke execute on function public.emitir_plan_basico(uuid) from public, anon;
grant  execute on function public.emitir_plan_basico(uuid) to authenticated, service_role;

-- Verificación:
--   select public.questionari_vigent('productor');
--   select public.desar_diagnostic('productor','<org>','{"registre_quantitats":false}'::jsonb);
--   select public.diagnostic_estat('productor','<org>');
--   select jsonb_pretty(mesures) from planes_prevencion where estado = 'esborrany';
--   select * from public.diagnostics_equip();
