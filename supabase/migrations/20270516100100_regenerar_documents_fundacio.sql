-- Regenerar los documentos con los datos actuales de la Fundació, SOLO en modo test (09-11-2026).
--
-- Lo que pidió Carles: «vincular los datos de la Fundació de Configuració con la generación de
-- cualquier documento, de modo que si se modifican, el siguiente documento salga con lo nuevo; y
-- una opción, de momento en modo test, de regenerar los documentos ya emitidos, solo bajo
-- aceptación y avisando de que esto no se podrá hacer en producción. Solo el super_admin.»
--
-- Lo primero ya era así para los datos de texto: cada emisor (`albaran_datos`, `convenio_emet_document`,
-- `cierre_datos_certificado`, `recepcio_datos_certificat`, `plan_datos`…) copia `parametros_documentales`
-- al snapshot `documentos.datos` en el momento de emitir. Lo ya emitido, en cambio, es INMUTABLE
-- (`documentos_inmutable`): su snapshot no cambia nunca, y eso es lo correcto en producción (un
-- documento con valor legal no se reescribe). En la fase de pruebas, con los datos de la Fundació
-- todavía provisionales, interesa poder repintarlo todo cuando se carguen los reales.
--
-- Cómo se regenera sin tocar la inmutabilidad: como ya hace la firma (`document_emet_versio_signada`),
-- se EMITE LA VERSIÓN SIGUIENTE (mismo número, `version + 1`, la anterior queda `vigente = false` y
-- `sustituido_por`), con el snapshot de antes y solo los datos de la Fundació sustituidos por los de
-- ahora. El job de siempre genera el PDF. La versión anterior se conserva.
--
-- Reglas:
--   · Solo `es_super_admin()` (42501) y solo con `app_settings.test_mode` encendido
--     (`22023 nomes_en_mode_test`): el día que se lance y se apague el modo test, deja de existir.
--   · Hay que pasar `p_accepto = true` (la pantalla lo pide con un aviso); sin él, solo informa.
--   · Se saltan los documentos FIRMADOS (`subtipo = 'signat'` o con una firma en curso en
--     `firmes_document`): repintarlos cambiaría su huella y perderían la firma.
--   · Solo se regenera lo que cambia: si el snapshot ya tiene los datos de ahora, no se toca.
--   · Cada ejecución queda en `regeneracions_documents` (quién, cuándo, cuántos de qué tipo).
--   · Un CD antiguo sin plantilla congelada recibe la vigente de su idioma (el renderizador de hoy la exige;
--     sin ella el PDF acaba en error: visto en el clon con un CD de septiembre).

-- 1. Los datos de la Fundació de AHORA dentro de un snapshot de ANTES -----------------------------
-- Las claves varían por tipo (lo fijó cada emisor en su día): `raó_social`/`raso_social`/`razon_social`,
-- `cif`/`nif`, `domicili`/`domicilio`, `inscripcio`/`inscripcion`… Se sustituye cada clave que ya
-- esté, sin añadir ninguna; lo demás del snapshot (kg, fechas, partes, firmas) queda igual.

drop function if exists public.documento_datos_fundacio_actual(jsonb);
create or replace function public.documento_datos_fundacio_actual(p_datos jsonb, p_tipo text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  par     public.parametros_documentales%rowtype;
  d       jsonb := p_datos;
  f       jsonb;
  nf      jsonb;
  k       text;
  v       jsonb;
  v_nif   text;
  v_dom   text;
  p       text;
  pa      jsonb;
begin
  select * into par from public.parametros_documentales where id = 1;
  if par.id is null or d is null then
    return d;
  end if;
  v_dom := concat_ws(', ', nullif(par.domicilio, ''), nullif(par.codigo_postal, ''), nullif(par.poblacion, ''));

  -- 1a. `datos.fundacio`
  if jsonb_typeof(d -> 'fundacio') = 'object' then
    f := d -> 'fundacio';
    v_nif := coalesce(f ->> 'nif', f ->> 'cif');
    nf := f;
    for k in select jsonb_object_keys(f) loop
      v := case k
        when 'cif' then to_jsonb(par.cif)
        when 'nif' then to_jsonb(par.cif)
        when 'raó_social' then to_jsonb(par.razon_social)
        when 'raso_social' then to_jsonb(par.razon_social)
        when 'razon_social' then to_jsonb(par.razon_social)
        when 'domicili' then to_jsonb(par.domicilio)
        when 'domicilio' then to_jsonb(par.domicilio)
        when 'codi_postal' then to_jsonb(par.codigo_postal)
        when 'codigo_postal' then to_jsonb(par.codigo_postal)
        when 'poblacio' then to_jsonb(par.poblacion)
        when 'poblacion' then to_jsonb(par.poblacion)
        when 'inscripcio' then to_jsonb(par.inscripcion)
        when 'inscripcion' then to_jsonb(par.inscripcion)
        when 'apoderada_nom' then to_jsonb(par.apoderada_nombre)
        when 'apoderada_carrec' then to_jsonb(par.apoderada_cargo)
        when 'dades_provisionals' then to_jsonb(par.datos_provisionales)
        -- La firma y el sello solo van en el convenio contrafirmado (lo decide su emisor).
        when 'firma_ruta' then case when d ->> 'subtipus' = 'contrafirmat' then to_jsonb(par.firma_ruta) else f -> k end
        when 'segell_ruta' then case when d ->> 'subtipus' = 'contrafirmat' then to_jsonb(par.sello_ruta) else f -> k end
        else f -> k
      end;
      nf := jsonb_set(nf, array[k], coalesce(v, 'null'::jsonb));
    end loop;
    d := jsonb_set(d, '{fundacio}', nf);
  end if;

  -- 1b. Lo que algunos tipos llevan fuera de `fundacio`
  if d ? 'lloc' then
    d := jsonb_set(d, '{lloc}', coalesce(to_jsonb(par.poblacion), 'null'::jsonb));
  end if;
  if jsonb_typeof(d -> 'apoderada') = 'object' then
    if d -> 'apoderada' ? 'nom' then
      d := jsonb_set(d, '{apoderada,nom}', coalesce(to_jsonb(par.apoderada_nombre), 'null'::jsonb));
    end if;
    if d -> 'apoderada' ? 'carrec' then
      d := jsonb_set(d, '{apoderada,carrec}', coalesce(to_jsonb(par.apoderada_cargo), 'null'::jsonb));
    end if;
  end if;
  if d ? 'dades_provisionals' then
    d := jsonb_set(d, '{dades_provisionals}', to_jsonb(par.datos_provisionales));
  end if;

  -- 1c. Albaranes: la parte que ES la Fundació en `partes`: la que tiene su NIF de entonces, o, en
  -- los snapshots antiguos sin `fundacio`, la que le toca por tipo (REC: recibe; ENT: entrega; OPE: ninguna).
  if jsonb_typeof(d -> 'partes') = 'object' and (v_nif is not null or p_tipo in ('REC', 'ENT')) then
    for p in select jsonb_object_keys(d -> 'partes') loop
      pa := d -> 'partes' -> p;
      if jsonb_typeof(pa) = 'object'
         and ((v_nif is not null and pa ->> 'nif' = v_nif)
              or (v_nif is null and ((p_tipo = 'REC' and p = 'recibe') or (p_tipo = 'ENT' and p = 'entrega')))) then
        if pa ? 'razon_social' then pa := jsonb_set(pa, '{razon_social}', coalesce(to_jsonb(par.razon_social), 'null'::jsonb)); end if;
        if pa ? 'nif' then pa := jsonb_set(pa, '{nif}', coalesce(to_jsonb(par.cif), 'null'::jsonb)); end if;
        if pa ? 'domicilio' then pa := jsonb_set(pa, '{domicilio}', to_jsonb(v_dom)); end if;
        if pa ? 'inscripcion' then pa := jsonb_set(pa, '{inscripcion}', coalesce(to_jsonb(par.inscripcion), 'null'::jsonb)); end if;
        d := jsonb_set(d, array['partes', p], pa);
      end if;
    end loop;
  end if;

  return d;
end;
$$;
revoke execute on function public.documento_datos_fundacio_actual(jsonb, text) from public, anon, authenticated;

comment on function public.documento_datos_fundacio_actual(jsonb, text) is
  'INTERNA (20270516100100): devuelve el snapshot con los datos de la Fundació sustituidos por los de `parametros_documentales` de ahora (solo las claves que ya tenía; también `lloc`, `apoderada`, `dades_provisionals` y la parte de `partes` que es la Fundació). Sin EXECUTE para sesiones.';

-- 2. Registro de las regeneraciones ----------------------------------------------------------------

create table if not exists public.regeneracions_documents (
  id        uuid primary key default gen_random_uuid(),
  at        timestamptz not null default now(),
  per       uuid,
  per_email text,
  per_nom   text,
  total     int not null,
  signats   int not null,
  detall    jsonb not null
);

comment on table public.regeneracions_documents is
  'Cada regeneración de documentos con los datos actuales de la Fundació (`regenerar_documents_fundacio`, solo en modo test): quién, cuándo, cuántos por tipo (`detall` = [{tipo, n}]) y cuántos firmados se saltaron. Sin FK: sobrevive al borrado de la cuenta. Lectura: super_admin.';

alter table public.regeneracions_documents enable row level security;
revoke all on public.regeneracions_documents from anon;
revoke insert, update, delete, truncate on public.regeneracions_documents from authenticated;
grant select on public.regeneracions_documents to authenticated;
drop policy if exists regeneracions_documents_llegir on public.regeneracions_documents;
create policy regeneracions_documents_llegir on public.regeneracions_documents
  for select to authenticated
  using ((select public.es_super_admin()));

-- 3. La RPC ---------------------------------------------------------------------------------------

create or replace function public.regenerar_documents_fundacio(p_accepto boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_test    boolean;
  r         record;
  v_nou     jsonb;
  v_ver     int;
  v_id      uuid;
  v_total   int := 0;
  v_signats int := 0;
  v_per_tipus jsonb := '{}'::jsonb;
  v_det     jsonb;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Només el super_admin regenera documents.' using errcode = '42501';
  end if;

  v_test := coalesce((select s.value = 'true' from public.app_settings s where s.key = 'test_mode'), true);

  -- Firmados: se cuentan siempre, nunca se tocan.
  select count(*) into v_signats
    from public.documentos d
   where d.vigente
     and (d.subtipo = 'signat' or exists (select 1 from public.firmes_document fd where fd.documento_id = d.id));

  if not coalesce(p_accepto, false) then
    -- Solo informa: cuántos cambiarían, por tipo.
    select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'n', x.n) order by x.tipo), '[]'::jsonb), coalesce(sum(x.n), 0)
      into v_det, v_total
      from (select d.tipo, count(*)::int as n
              from public.documentos d
             where d.vigente
               and d.subtipo <> 'signat'
               and not exists (select 1 from public.firmes_document fd where fd.documento_id = d.id)
               and public.documento_datos_fundacio_actual(d.datos, d.tipo) is distinct from d.datos
             group by d.tipo) x;
    return jsonb_build_object('mode_test', v_test, 'executat', false, 'total', v_total,
                              'signats', v_signats, 'detall', v_det);
  end if;

  if not v_test then
    raise exception 'nomes_en_mode_test: amb el mode test apagat (producció) els documents emesos no es poden regenerar'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('regenerar_documents_fundacio'));

  for r in
    select d.*
      from public.documentos d
     where d.vigente
       and d.subtipo <> 'signat'
       and not exists (select 1 from public.firmes_document fd where fd.documento_id = d.id)
     order by d.tipo, d.numero_completo
     for update
  loop
    v_nou := public.documento_datos_fundacio_actual(r.datos, r.tipo);
    continue when v_nou is not distinct from r.datos;

    select coalesce(max(x.version), r.version) + 1 into v_ver
      from public.documentos x
     where x.numero_completo = r.numero_completo and x.tipo = r.tipo
       and x.objeto_tipo = r.objeto_tipo and x.objeto_id = r.objeto_id;

    update public.documentos set vigente = false where id = r.id;

    insert into public.documentos (
      tipo, subtipo, objeto_tipo, objeto_id,
      numero_completo, version, serie, ejercicio,
      modo, idioma, plantilla_id, datos, sha256_datos,
      ruta, estado, envio, emitido_por
    ) values (
      r.tipo, r.subtipo, r.objeto_tipo, r.objeto_id,
      r.numero_completo, v_ver, r.serie, r.ejercicio,
      r.modo, r.idioma,
      -- Un CD de antes del modelo del 05-11 no tiene plantilla congelada, y el renderizador de hoy la
      -- exige: se le da la vigente de su idioma, como hace hoy su emisor (`cierre_emet_document`).
      coalesce(r.plantilla_id,
               case when r.tipo = 'CD' then
                 (select p.id from public.plantillas_documento p
                   where p.tipo = r.tipo and p.idioma = r.idioma and p.variante is null and p.vigente limit 1)
               end),
      v_nou,
      encode(sha256(convert_to(v_nou::text, 'UTF8')), 'hex'),
      public.ruta_documento(r.objeto_tipo, r.objeto_id, r.tipo, r.numero_completo, v_ver, r.modo, r.ejercicio),
      'pendiente_fichero', null, auth.uid()
    ) returning id into v_id;

    update public.documentos set sustituido_por = v_id where id = r.id;

    v_total := v_total + 1;
    v_per_tipus := jsonb_set(v_per_tipus, array[r.tipo], to_jsonb(coalesce((v_per_tipus ->> r.tipo)::int, 0) + 1));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('tipo', e.key, 'n', e.value::int) order by e.key), '[]'::jsonb)
    into v_det from jsonb_each_text(v_per_tipus) e;

  insert into public.regeneracions_documents (per, per_email, per_nom, total, signats, detall)
  values (auth.uid(),
          (select pe.email from public.perfiles pe where pe.id = auth.uid()),
          (select pe.nombre from public.perfiles pe where pe.id = auth.uid()),
          v_total, v_signats, v_det);

  return jsonb_build_object('mode_test', true, 'executat', true, 'total', v_total,
                            'signats', v_signats, 'detall', v_det);
end;
$$;
revoke execute on function public.regenerar_documents_fundacio(boolean) from public, anon;
grant execute on function public.regenerar_documents_fundacio(boolean) to authenticated;

comment on function public.regenerar_documents_fundacio(boolean) is
  'Solo super_admin (42501) y solo con app_settings.test_mode encendido (22023 nomes_en_mode_test). Sin p_accepto: informa {mode_test, total, signats, detall:[{tipo,n}]} de lo que cambiaría. Con p_accepto = true: emite la versión siguiente (mismo número) de cada documento vigente NO firmado cuyo snapshot tenga datos de la Fundació distintos de los de ahora, con esos datos sustituidos; el job genera el PDF. La versión anterior se conserva. Queda en regeneracions_documents.';
