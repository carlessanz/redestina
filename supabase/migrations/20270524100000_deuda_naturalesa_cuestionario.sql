-- Deuda 174 a 178 (10-11-2026), tras el Plan 2 y con la decisión de la Fundació sobre P8.
--
-- 1. P8 CONFIRMADA por la Fundació: una empresa no recibe donaciones; las donaciones son para las
--    entidades sociales. La regla ya estaba en `modalitat_naturalesa_compat`; aquí solo deja de ser
--    provisional (comentario). Sigue surtiendo efecto solo con la naturalesa CONFIRMADA.
-- 2. Deuda 178: `animal` admite también COMPRA (`venda`). Antes solo donación, así que una empresa
--    confirmada de tipo animal (una granja que compra para pienso) no veía nada. Una entidad social
--    de tipo animal gana la compra, como ya la tenían `social` y `transformador`.
-- 3. Deuda 177: NIF F (cooperativas), H y V (otros, entre ellos las SAT) sin forma jurídica que lo
--    diga ya tienen sugerencia: entidad social si la ficha receptora es de tipo `social`, empresa en
--    cualquier otro caso. Sigue siendo SUGERIDA: la confirma una persona. `naturalesa_suggerida`
--    gana un tercer argumento opcional (`p_tipo_receptor`); con dos argumentos responde igual que
--    antes salvo para F·H·V, que pasan a `empresa`.
-- 4. Deuda 174 y 175: se retiran el historial del diagnóstico y el motor antiguo del cuestionario y
--    del plan básico, sin camino en pantalla desde A1 (D4) y A3:
--      · tablas `diagnostics_historial`, `questionaris_diagnostic`, `regles_pla`, `mesures_prevencio`;
--      · funciones del cuestionario (`desar_diagnostic`, `questionari_vigent`, `publicar_questionari`,
--        `questionari_problemes`, `questionari_valid`, `diagnostic_falten`, `diagnostic_compon_sobre`,
--        `compondre_respostes`, `pregunta_aplica`, `avaluar_regla` y los dos triggers) y del plan
--        básico (`generar_pla_des_de_diagnostic`, `guardar_plan_basico`, `emitir_plan_basico`,
--        `plan_emet_document`, `plan_datos`, `desar_mesures_pla`, `fixar_nivell_pla`).
--    Se CONSERVAN: `planes_prevencion` (los planes emitidos y su `questionari_id`, ya sin FK),
--    `mesures_pla_forma` (la usa el CHECK de `planes_prevencion.mesures`), `puc_gestionar_pla`, los
--    documentos PLA (su PDF sale del snapshot congelado en `documentos.datos`) y la columna
--    `diagnostics.questionari_id` (sin FK). Lo que leía la tabla del cuestionario
--    (`diagnostic_estat`, `diagnostic_datos`, `diagnostics_equip`, `expedient_datos`) lo lee ahora
--    de la foto que `diagnostics.sobre` guardó al contestar (`titol`, `versio_questionari`); ya no hay
--    cuestionario vigente, así que `provisional` es siempre `false`.
--    ⚠️ El historial guarda una fila por cada borrador del plan básico de una entidad que el
--    backfill de A1 copió: el script de publicación lo vuelca a `scripts/data/` antes de aplicar.
--
-- COMPATIBLE con el frontend publicado: ninguna pantalla llama ya a lo que se borra (A3 retiró la
-- última, Configuració › Diagnòstic); las cuatro funciones reescritas mantienen firma, `returns` y
-- claves. Idempotente.

-- ---------------------------------------------------------------------------
-- 1. P8, confirmada
-- ---------------------------------------------------------------------------
comment on table public.modalitat_naturalesa_compat is
  'P8 (confirmada por la Fundació el 10-11-2026): qué modalidades admite cada naturalesa CONFIRMADA, '
  'ADEMÁS de la matriz por tipo (modalitat_receptor_compat). Entitat social: las tres. Empresa: venda '
  'y maquila, NUNCA donación (las donaciones son para las entidades sociales).';

-- ---------------------------------------------------------------------------
-- 2. Deuda 178: `animal` admite compra
-- ---------------------------------------------------------------------------
insert into public.modalitat_receptor_compat (modalitat, tipo_receptor) values ('venda', 'animal')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Deuda 177: sugerencia para F·H·V
-- ---------------------------------------------------------------------------
drop function if exists public.naturalesa_suggerida(text, text);
create or replace function public.naturalesa_suggerida(
  p_nif text, p_forma text default null, p_tipo_receptor text default null)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  n text := upper(regexp_replace(coalesce(p_nif, ''), '[\s.\-]', '', 'g'));
  f text := lower(btrim(coalesce(p_forma, '')));
begin
  if n ~ '^[GRPQS][0-9]{7}[0-9A-J]$' then
    return 'entitat_social';
  end if;
  if n ~ '^[ABCDEJNUW][0-9]{7}[0-9A-J]$' or n ~ '^[0-9]{8}[A-Z]$' or n ~ '^[XYZKLM][0-9]{7}[A-Z]$' then
    return 'empresa';
  end if;
  if f in ('fundacio', 'associacio') then
    return 'entitat_social';
  end if;
  if f in ('sl', 'sa', 'autonom', 'sc', 'cb', 'sat') then
    return 'empresa';
  end if;
  -- Deuda 177: cooperativas (F), comunidades (H) y otros (V, las SAT). Una receptora social
  -- (una cooperativa de iniciativa social que reparte alimentos) se sugiere social; lo demás, empresa.
  if n ~ '^[FHV][0-9]{7}[0-9A-J]$' then
    return case when lower(btrim(coalesce(p_tipo_receptor, ''))) = 'social'
                then 'entitat_social' else 'empresa' end;
  end if;
  return null;
end;
$$;
revoke execute on function public.naturalesa_suggerida(text, text, text) from public, anon;
grant execute on function public.naturalesa_suggerida(text, text, text) to authenticated, service_role;

create or replace function public.refresca_naturalesa_suggerida(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n text;
begin
  select public.naturalesa_suggerida(
           coalesce(nullif(btrim(e.nif), ''), nullif(btrim(p.nif), '')),
           coalesce(nullif(btrim(e.tipo_entidad), ''), nullif(btrim(p.tipo_empresa), '')),
           e.tipo_receptor)
    into v_n
    from public.organizaciones o
    left join public.entidades e on e.organizacion_id = o.id
    left join public.productores p on p.organizacion_id = o.id
   where o.id = p_org;

  update public.organizaciones
     set naturalesa = v_n,
         naturalesa_origen = case when v_n is null then null else 'suggerida' end
   where id = p_org
     and naturalesa_origen is distinct from 'confirmada'
     and (naturalesa is distinct from v_n
          or naturalesa_origen is distinct from case when v_n is null then null else 'suggerida' end);
end;
$$;
revoke execute on function public.refresca_naturalesa_suggerida(uuid) from public, anon, authenticated;
grant execute on function public.refresca_naturalesa_suggerida(uuid) to service_role;

-- La ficha receptora recalcula también cuando cambia su tipo (decide F·H·V).
drop trigger if exists trg_entidades_naturalesa on public.entidades;
create trigger trg_entidades_naturalesa
  after insert or update of nif, tipo_entidad, tipo_receptor, organizacion_id on public.entidades
  for each row execute function public.trg_fitxa_naturalesa();

-- Recalcular lo no confirmado (solo cambia lo que era F·H·V sin forma).
select public.refresca_naturalesa_suggerida(o.id)
  from public.organizaciones o
 where o.naturalesa_origen is distinct from 'confirmada';

-- ---------------------------------------------------------------------------
-- 4. Deuda 174 y 175: fuera el motor antiguo del cuestionario y del plan básico
-- ---------------------------------------------------------------------------
-- 4a. Lo vivo que leía `questionaris_diagnostic` pasa a leer la foto de `diagnostics.sobre`.
CREATE OR REPLACE FUNCTION public.diagnostic_estat(p_tipo_org text, p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d        diagnostics%rowtype;
  v_falten text[] := '{}';
  v_estat  text;
  v_nom    text;
  v_exc    int := 0;
  v_pend   int := 0;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  -- El productor sigue leyendo el suyo: la guarda es la de siempre.
  if not public.puc_gestionar_pla(p_tipo_org, p_org) then
    raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
  end if;

  if p_tipo_org = 'productor' then
    select * into d from diagnostics where productor_id = p_org;
    v_falten := public.diagnostic_falten_productor(p_org);
    select count(*) into v_exc from diagnostic_excedents de where de.productor_id = p_org;
    select count(*) into v_pend
      from diagnostic_accions da join diagnostic_excedents de on de.id = da.excedent_id
     where de.productor_id = p_org and da.estat in ('pendent', 'en_curs');
  end if;

  v_estat := case
    when p_tipo_org <> 'productor' then 'sense_questionari'
    when d.id is null then 'sense_comencar'
    when cardinality(v_falten) > 0 then 'incomplet'
    else 'complet'
  end;

  if d.actualitzat_per is not null then
    select nullif(btrim(p.nombre), '') into v_nom
      from perfiles p where p.id = d.actualitzat_per;
  end if;

  return jsonb_build_object(
    'estat',                 v_estat,
    'diagnostic_id',         d.id,
    'pla_esborrany',         null,
    'pla_vigent',            null,
    'numero',                null,
    'versio',                null,
    'emes_at',               null,
    'nivell',                null,
    'idioma',                case when d.id is not null then coalesce(d.idioma, 'ca') end,
    'falten',                to_jsonb(v_falten),
    'te_mesures',            false,
    'mesures_n',             0,
    'mesures_editades',      false,
    'questionari_id',        d.questionari_id,
    'versio_questionari',    case when (d.sobre ->> 'versio_questionari') ~ '^[0-9]+$'
                                  then (d.sobre ->> 'versio_questionari')::int end,
    'darrera_actualitzacio', d.actualitzat_at,
    'actualitzat_at',        d.actualitzat_at,
    'actualitzat_per_nom',   v_nom,
    'provisional',           false,
    'excedents_n',           v_exc,
    'accions_pendents',      v_pend);
end;
$function$;
CREATE OR REPLACE FUNCTION public.diagnostic_datos(p_tipo_org text, p_org uuid, p_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d        diagnostics%rowtype;
  v_org    jsonb;
  v_op     jsonb;
  v_nom    text;
  v_falten text[];
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
  if d.actualitzat_per is not null then
    select nullif(btrim(p.nombre), '') into v_nom
      from perfiles p where p.id = d.actualitzat_per;
  end if;
  v_falten := public.diagnostic_falten_productor(p_org);

  return jsonb_build_object(
    'diagnostic_id',       d.id,
    'organitzacio',        v_org,
    'operativa',           v_op,
    -- El cuestionario con el que se contestó un diagnóstico de antes de A3: sale de la foto que
    -- `diagnostics.sobre` guardó al contestarlo (la tabla del cuestionario ya no existe).
    'questionari',         case when d.sobre ? 'titol' then
                             jsonb_build_object(
                               'titol', d.sobre -> 'titol',
                               'versio', case when (d.sobre ->> 'versio_questionari') ~ '^[0-9]+$'
                                              then (d.sobre ->> 'versio_questionari')::int end,
                               'provisional', coalesce((d.sobre ->> 'questionari_provisional')::boolean, false))
                           end,
    'respostes',           coalesce(d.sobre -> 'respostes', '[]'::jsonb),
    'excedents',           public.diagnostic_excedents_json(p_org),
    'notes',               d.notes,
    'complet',             d.id is not null and cardinality(v_falten) = 0,
    'falten',              to_jsonb(v_falten),
    'actualitzat_at',      d.actualitzat_at,
    'actualitzat_per_nom', v_nom,
    'provisional',         false);
end;
$function$;
CREATE OR REPLACE FUNCTION public.diagnostics_equip()
 RETURNS TABLE(tipo_org text, org_id uuid, nom text, es_test boolean, estat text, falten_n integer, mesures_n integer, pla_esborrany uuid, pla_vigent uuid, numero text, versio integer, emes_at timestamp with time zone, versio_questionari integer, provisional boolean, darrera_actualitzacio timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
-- Todas las referencias van cualificadas; el pragma cubre la que se cuele (20270328101700).
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Els diagnostics de la base son de l''equip' using errcode = '42501';
  end if;

  return query
  with base as (
    select 'productor'::text as b_tipo, pr.id as b_org, coalesce(pr.empresa, pr.name) as b_nom,
           pr.es_test as b_test, dg.id as d_id, dg.actualitzat_at as d_at,
           case when (dg.sobre ->> 'versio_questionari') ~ '^[0-9]+$'
                then (dg.sobre ->> 'versio_questionari')::int end as q_versio,
           false as q_provisional,
           case when dg.id is not null
                then coalesce(cardinality(public.diagnostic_falten_productor(pr.id)), 0)
                else 0 end as n_falten
      from productores pr
      left join diagnostics dg on dg.productor_id = pr.id
  )
  select
    b.b_tipo,
    b.b_org,
    b.b_nom,
    b.b_test,
    case
      when b.d_id is null then 'sense_comencar'
      when b.n_falten > 0 then 'incomplet'
      else 'complet'
    end,
    b.n_falten,
    0,
    null::uuid,
    null::uuid,
    null::text,
    null::integer,
    null::timestamptz,
    b.q_versio,
    b.q_provisional,
    b.d_at
  from base b
  order by b.b_nom;
end;
$function$;
CREATE OR REPLACE FUNCTION public.expedient_datos(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ex    expedients_prevencion;
  par   parametros_documentales%rowtype;
  v_org jsonb;
  pl    planes_prevencion%rowtype;
  dg    diagnostics%rowtype;
  v_exc jsonb := '[]'::jsonb;
  v_out jsonb;
begin
  select * into ex from expedients_prevencion where id = p_id;
  if ex.id is null then
    raise exception 'expedient_inexistent' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;
  select jsonb_build_object('tipus', 'productor', 'nom', coalesce(pr.empresa, pr.name),
                            'rao_social', pr.razon_social, 'nif', pr.nif, 'poblacio', pr.poblacion,
                            'comarca', pr.area_geografica, 'email', pr.email)
    into v_org from productores pr where pr.id = ex.productor_id;
  if ex.pla_id is not null then
    select * into pl from planes_prevencion where id = ex.pla_id;
  end if;
  if ex.diagnostic_id is not null then
    select * into dg from diagnostics where id = ex.diagnostic_id;
  end if;
  if dg.id is null and ex.productor_id is not null then
    select * into dg from diagnostics where productor_id = ex.productor_id;
  end if;
  if ex.productor_id is not null then
    v_exc := public.diagnostic_excedents_json(ex.productor_id);
  end if;

  v_out := jsonb_build_object(
    'format', 'expedient',
    'tipus', 'PLA',
    'nivell', ex.nivell,
    'estat', ex.estat,
    'numero', ex.numero_completo,
    'versio', ex.versio_document,
    'exercici', ex.ejercicio,
    'data_generacio', now(),
    'data_inici', ex.data_inici,
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'organitzacio', v_org,
    'tecnic', (select coalesce(p.nombre, p.email) from perfiles p where p.id = ex.tecnic_id),
    'objectius_estrategics', to_jsonb(ex.objectius_estrategics),
    'context', ex.context,
    'equip', ex.equip,
    'mesures_pla_basic', case when pl.id is not null
                              then coalesce(pl.mesures -> 'llista', '[]'::jsonb)
                              else '[]'::jsonb end,
    'visites', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.data)
                           from pla_visites v where v.expedient_id = p_id), '[]'::jsonb),
    'processos', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.ordre, v.created_at)
                             from pla_processos v where v.expedient_id = p_id), '[]'::jsonb),
    'quantificacio', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.mes, v.producte)
                                 from pla_quantificacio v where v.expedient_id = p_id), '[]'::jsonb),
    'objectius', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.created_at)
                             from pla_objectius v where v.expedient_id = p_id), '[]'::jsonb),
    'accions', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.data_objectiu nulls last, v.created_at)
                           from pla_accions v where v.expedient_id = p_id), '[]'::jsonb),
    'seguiments', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.trimestre)
                              from pla_seguiments v where v.expedient_id = p_id), '[]'::jsonb),
    'verificacions', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' - 'verificat_per' order by v."any")
                                 from pla_verificacions v where v.expedient_id = p_id), '[]'::jsonb));

  if dg.id is not null or jsonb_array_length(v_exc) > 0 then
    v_out := v_out || jsonb_build_object('diagnostic', jsonb_build_object(
      'respostes',      coalesce(dg.sobre -> 'respostes', '[]'::jsonb),
      'excedents',      v_exc,
      'actualitzat_at', dg.actualitzat_at,
      'provisional',    false));
  end if;
  return v_out;
end;
$function$;

-- 4b. Las funciones retiradas (antes que las tablas: una lleva el tipo de fila de una de ellas).
drop function if exists public.desar_diagnostic(text, uuid, jsonb, text, text);
drop function if exists public.diagnostic_compon_sobre(public.questionaris_diagnostic, uuid, jsonb, text);
drop function if exists public.compondre_respostes(jsonb, jsonb);
drop function if exists public.diagnostic_falten(jsonb, jsonb);
drop function if exists public.pregunta_aplica(jsonb, jsonb);
drop function if exists public.questionari_vigent(text);
drop function if exists public.publicar_questionari(text, jsonb, jsonb, boolean, boolean);
drop function if exists public.generar_pla_des_de_diagnostic(text, uuid, boolean);
drop function if exists public.guardar_plan_basico(text, uuid, jsonb, text, text);
drop function if exists public.emitir_plan_basico(uuid);
drop function if exists public.plan_emet_document(uuid);
drop function if exists public.plan_datos(uuid);
drop function if exists public.desar_mesures_pla(uuid, jsonb, text);
drop function if exists public.fixar_nivell_pla(uuid, text);
drop function if exists public.avaluar_regla(text, jsonb, jsonb);

-- 4c. Las FK hacia el cuestionario: las columnas se quedan como dato histórico.
alter table public.planes_prevencion drop constraint if exists planes_questionari_fk;
alter table public.diagnostics drop constraint if exists diagnostics_questionari_id_fkey;

-- 4d. Las tablas (sus triggers y políticas se van con ellas).
drop table if exists public.diagnostics_historial;
drop table if exists public.regles_pla;
drop table if exists public.mesures_prevencio;
drop table if exists public.questionaris_diagnostic;

-- 4e. Lo que quedaba solo para el CHECK de la tabla del cuestionario y para sus triggers.
drop function if exists public.questionari_valid(jsonb);
drop function if exists public.questionari_problemes(jsonb);
drop function if exists public.trg_questionaris_inmutables();
drop function if exists public.trg_questionaris_no_esborrar();
