-- Ofertas multiproducto (proceso 3.3; fase 6 del plan de noviembre de 2026), 3 de 7: el VACIADO
-- (`reiniciar_dades_operatives`, fase 6 de noviembre, 20270611100000) conoce las dos tablas nuevas.
--
-- Regla de §7: «tabla operativa nueva → `v_ordre` del vaciado». `sollicituds_recollida` y
-- `disponibilitats` van DESPUÉS de `oferta_respuestas`, `canalizaciones` y `excedentes` (que las
-- apuntan con `on delete set null`: borrarlas antes convertiría el borrado en UPDATE de filas con
-- triggers de control) y ANTES que `entidades` y `productores` (a las que apuntan en cascada).
-- Así también se cuentan en el inventario (`taules`) y entran en la comprobación final de que no
-- queda ninguna fila.
--
-- `borrar_ficha_completa()` no cambia: `borrar_una_fitxa()` borra antes las respuestas, las
-- canalizaciones y las ofertas de la ficha, y la cabecera y las solicitudes caen en cascada con la
-- ficha del productor (`disponibilitats.productor_id`) o de la entidad
-- (`sollicituds_recollida.entidad_id`). Lo prueba `scripts/sql/prova-multiproducte.sql`.
--
-- El cuerpo es el de 20270611100000 sin más cambio que las dos entradas de `v_ordre`
-- (`create or replace` con la misma firma: conserva los privilegios; se repiten por claridad).

create or replace function public.reiniciar_dades_operatives(p_executar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  -- El ORDEN de borrado: lo que apunta antes que lo apuntado, y siempre antes de que una FK con
  -- `on delete set null` convierta el borrado en un UPDATE que dispararía triggers de control
  -- (`convenios_control`, `respuestas_control_aprovacio`…). Las tablas que caen en cascada se
  -- listan igualmente para contarlas.
  v_ordre text[] := array[
    -- firmas y regeneraciones (apuntan a documentos y evidencias)
    'firmes_document', 'regeneracions_documents',
    -- cierres y certificados (apuntan a albaranes, canalizaciones, excedentes, documentos externos)
    'cierre_donante_lineas', 'cierre_periodo_lineas', 'cierre_receptor_lineas',
    'cierres_periodo', 'cierres_donante', 'cierres_ejercicio', 'cierres_receptor',
    -- documentos (su trigger borra los enlaces de firma de documento)
    'documento_envios', 'documentos',
    -- albaranes
    'albaran_lineas', 'albaranes',
    -- convenios ANTES que sus enlaces (`enlace_id` es set null)
    'convenios',
    -- consentimientos de organización (ver abajo) van aquí, antes que enlaces y organizaciones
    'evidencias', 'enlaces_token',
    'documentos_externos',
    -- ofertas y todo lo que cuelga (respuestas ANTES que canalizaciones: `canalizacion_id` set null)
    'oferta_respuestas', 'canalizaciones_preu_hist', 'canalizaciones',
    'excedente_destins', 'excedentes_canvis', 'intake_sessions', 'excedentes', 'espigoladas',
    -- 20270620100200 (fase 6, 3.3): los grupos multiproducto, después de lo que los apunta
    'sollicituds_recollida', 'disponibilitats',
    -- plan de prevención: expedientes (restrict a las fichas) antes que planes y diagnósticos
    'pla_accions', 'pla_objectius', 'pla_processos', 'pla_quantificacio', 'pla_seguiments',
    'pla_verificacions', 'pla_visites', 'expedients_prevencion', 'planes_prevencion',
    'diagnostic_accions', 'diagnostic_excedents', 'diagnostic_productes', 'diagnostics',
    -- operativa de las fichas, CRM e historiales
    'productor_ubicaciones', 'avisos', 'notes_internes', 'organizacion_contactos',
    'fitxa_estat_hist', 'importacions_entitats_files', 'importacions_entitats',
    'equip_traspassos_files', 'equip_traspassos',
    -- las fichas y sus identidades
    'membresias', 'productores', 'entidades', 'organizaciones',
    -- mensajería (los contactos de la whitelist de Meta se quedan; ver abajo)
    'wa_messages'
  ];
  v_t          text;
  v_n          bigint;
  v_taules     jsonb := '{}'::jsonb;
  v_esborrat   jsonb := '{}'::jsonb;
  v_conserva   jsonb;
  v_bloquejos  jsonb := '[]'::jsonb;
  v_reals      jsonb;
  v_orgs       jsonb;
  v_comptes    jsonb;
  v_fitxers    jsonb;
  v_storage_ok boolean := true;
  v_cua        bigint := 0;
  v_series     bigint;
  v_provis     boolean;
  v_detall     text;
  v_resultat   jsonb;
begin
  -- Solo el servidor: el EXECUTE está revocado a `authenticated`; esto es la segunda red.
  if auth.uid() is not null then
    raise exception 'Nomes el servidor reinicia les dades operatives' using errcode = '42501';
  end if;

  -- ── Inventario: cuántas filas por tabla ────────────────────────────────────────────────────
  foreach v_t in array v_ordre loop
    execute format('select count(*) from public.%I', v_t) into v_n;
    v_taules := v_taules || jsonb_build_object(v_t, v_n);
  end loop;
  select count(*) into v_n from consentiments where organizacion_id is not null;
  v_taules := v_taules || jsonb_build_object('consentiments (de organitzacio)', v_n);
  select count(*) into v_n from wa_contacts c
   where not exists (select 1 from meta_test_recipients m where m.phone = c.phone);
  v_taules := v_taules || jsonb_build_object('wa_contacts (fora de meta_test_recipients)', v_n);

  select count(*) into v_series from series_documentales where ultimo <> 0;

  v_conserva := jsonb_build_object(
    'auth.users',            (select count(*) from auth.users),
    'perfiles',              (select count(*) from perfiles),
    'usuario_roles',         (select count(*) from usuario_roles),
    'consentiments (de compte)', (select count(*) from consentiments where organizacion_id is null),
    'wa_contacts (meta_test_recipients)',
                             (select count(*) from wa_contacts c
                               where exists (select 1 from meta_test_recipients m where m.phone = c.phone)),
    'meta_test_recipients',  (select count(*) from meta_test_recipients),
    'email_test_recipients', (select count(*) from email_test_recipients),
    'series_documentales (files)', (select count(*) from series_documentales),
    'series_a_zero',         v_series);

  -- ── Organizaciones (con nombre, NIF y papeles) ──────────────────────────────────────────────
  select coalesce(jsonb_agg(x order by x->>'nom'), '[]'::jsonb) into v_orgs
    from (
      select jsonb_build_object(
               'id',        o.id,
               'nom',       coalesce(nullif(btrim(p.empresa), ''), nullif(btrim(e.nombre), ''),
                                     nullif(btrim(p.name), ''), '(sense nom)'),
               'nif',       coalesce(p.nif, e.nif),
               'papers',    to_jsonb(array_remove(array[
                              case when p.id is not null then 'productor' end,
                              case when e.id is not null then 'entitat' end], null)),
               'es_test',   coalesce(p.es_test, false) or coalesce(e.es_test, false),
               'estat_crm', coalesce(p.estat_crm, e.estat_crm),
               'importada', coalesce(p.ref_externa, e.ref_externa) is not null) as x
        from organizaciones o
        left join lateral (select * from productores pp where pp.organizacion_id = o.id
                            order by pp.created_at limit 1) p on true
        left join lateral (select * from entidades ee where ee.organizacion_id = o.id
                            order by ee.created_at limit 1) e on true
    ) s;

  -- ── Cuentas externas (sin rol de plataforma): ninguna se borra, todas se quedan sin organización
  select coalesce(jsonb_agg(jsonb_build_object(
           'email',      pf.email,
           'nom',        pf.nombre,
           'membresies', (select count(*) from membresias m where m.user_id = pf.id))
           order by pf.email), '[]'::jsonb)
    into v_comptes
    from perfiles pf
   where not exists (select 1 from usuario_roles r where r.user_id = pf.id);

  -- ── Ficheros de Storage: los dos buckets operativos enteros ─────────────────────────────────
  -- Todo lo que hay en `documentos` (PDF, adjuntos, firmas subidas, trazos) y en `fotos-ofertes`
  -- es de lo que se borra. Se excluyen la firma y el sello de la Fundació si vivieran ahí.
  -- Si `storage.objects` no se puede leer (privilegios del entorno), se cae a las rutas que la
  -- base conoce y el script completa con la API de Storage.
  begin
    select jsonb_build_object(
             'documentos',    count(*) filter (where so.bucket_id = 'documentos'),
             'fotos-ofertes', count(*) filter (where so.bucket_id = 'fotos-ofertes'),
             'font',          'storage.objects')
      into v_fitxers
      from storage.objects so
     where so.bucket_id in ('documentos', 'fotos-ofertes')
       and so.name not in (select r from parametros_documentales pd,
                                  unnest(array[pd.firma_ruta, pd.sello_ruta]) r
                            where r is not null);
  exception when insufficient_privilege or undefined_table then
    v_storage_ok := false;
    select jsonb_build_object(
             'documentos',
               (select count(*) from (
                  select ruta from documentos where ruta is not null
                  union select ruta from documentos_externos where ruta is not null
                  union select trazo_firma_ruta from evidencias where trazo_firma_ruta is not null
                  union select fitxer_ruta from firmes_document where fitxer_ruta is not null) r),
             'fotos-ofertes',
               (select count(distinct f) from excedentes, unnest(coalesce(fotos, '{}'::text[])) f
                 where f is not null and f <> ''),
             'font', 'rutes de la base (storage.objects no es pot llegir)')
      into v_fitxers;
  end;

  -- ── Bloqueos: lo que hace que NO se pueda vaciar ────────────────────────────────────────────
  select coalesce((select pd.datos_provisionales from parametros_documentales pd where pd.id = 1), false)
    into v_provis;
  if not v_provis then
    v_bloquejos := v_bloquejos || jsonb_build_object(
      'codi', 'dades_fundacio_definitives', 'n', 1,
      'detall', 'parametros_documentales.datos_provisionales = false: el que s''ha emes pot tenir valor legal');
  end if;

  select (select count(*) from documentos where modo = 'real' and tipo in ('CD', 'CT', 'CR', 'RES'))
       + (select count(*) from cierres_ejercicio where modo = 'real')
       + (select count(*) from cierres_periodo   where modo = 'real')
       + (select count(*) from cierres_receptor  where modo = 'real')
    into v_n;
  if v_n > 0 then
    v_bloquejos := v_bloquejos || jsonb_build_object(
      'codi', 'certificats_reals', 'n', v_n,
      'detall', 'certificats, resums o tancaments en modo real');
  end if;

  v_reals := jsonb_strip_nulls(jsonb_build_object(
    'ofertes',      nullif((select count(*) from excedentes x join productores p on p.id = x.productor_id
                             where not p.es_test), 0),
    'espigolades',  nullif((select count(*) from espigoladas x join productores p on p.id = x.productor_id
                             where not p.es_test), 0),
    'canalitzacions', nullif((select count(*) from canalizaciones x join entidades e on e.id = x.entidad_id
                             where not e.es_test), 0),
    'respostes',    nullif((select count(*) from oferta_respuestas x join entidades e on e.id = x.entidad_id
                             where not e.es_test), 0),
    'convenis',     nullif((select count(*) from convenios x
                              left join productores p on p.id = x.productor_id
                              left join entidades e on e.id = x.entidad_id
                             where x.numero_completo is not null
                               and not coalesce(p.es_test, e.es_test, false)), 0),
    'plans',        nullif((select count(*) from planes_prevencion x
                              left join productores p on p.id = x.productor_id
                              left join entidades e on e.id = x.entidad_id
                             where x.numero_completo is not null
                               and not coalesce(p.es_test, e.es_test, false)), 0),
    'expedients',   nullif((select count(*) from expedients_prevencion x
                              left join productores p on p.id = x.productor_id
                              left join entidades e on e.id = x.entidad_id
                             where x.numero_completo is not null
                               and not coalesce(p.es_test, e.es_test, false)), 0),
    'tancaments',   nullif((select count(*) from cierres_donante x join productores p on p.id = x.productor_id
                             where not p.es_test)
                         + (select count(*) from cierres_periodo x join productores p on p.id = x.productor_id
                             where not p.es_test)
                         + (select count(*) from cierres_receptor x join entidades e on e.id = x.entidad_id
                             where not e.es_test), 0)));
  if v_reals <> '{}'::jsonb then
    select string_agg(k || ': ' || v, ', ' order by k) into v_detall from jsonb_each_text(v_reals) as t(k, v);
    v_bloquejos := v_bloquejos || jsonb_build_object(
      'codi', 'operativa_fitxes_reals',
      'n', (select sum(v::bigint) from jsonb_each_text(v_reals) as t(k, v)),
      'detall', 'operativa o documents amb numero de fitxes que no son es_test (' || v_detall || ')');
  end if;

  v_resultat := jsonb_build_object(
    'executat',        false,
    'pot_executar',    jsonb_array_length(v_bloquejos) = 0,
    'bloquejos',       v_bloquejos,
    'taules',          v_taules,
    'conserva',        v_conserva,
    'fitxers',         v_fitxers,
    'organitzacions',  v_orgs,
    'comptes_externs_sense_organitzacio', v_comptes);

  if not coalesce(p_executar, false) then
    return v_resultat;
  end if;

  -- ═══ A partir de aquí, el vaciado ═════════════════════════════════════════════════════════
  if jsonb_array_length(v_bloquejos) > 0 then
    raise exception 'hi_ha_dades_reals: %',
      (select string_agg(b->>'codi', ', ') from jsonb_array_elements(v_bloquejos) b)
      using errcode = '22023',
            detail = v_bloquejos::text,
            hint = 'Mira l''inventari amb --dry-run: no s''ha esborrat res.';
  end if;

  -- La marca que abre los cuatro triggers de inmutabilidad, local a esta transacción.
  perform set_config('redestina.reinicio_dades', 'on', true);

  -- (1) Los ficheros, a la cola ANTES de borrar las filas (después ya no se sabría su ruta).
  --     Las fotos de las ofertas las añade además el trigger `excedentes_fotos_orfes`.
  if v_storage_ok then
    insert into fitxers_orfes (bucket, ruta, origen)
    select so.bucket_id, so.name, 'reinici_dades'
      from storage.objects so
     where so.bucket_id in ('documentos', 'fotos-ofertes')
       and so.name not in (select r from parametros_documentales pd,
                                  unnest(array[pd.firma_ruta, pd.sello_ruta]) r
                            where r is not null)
    on conflict (bucket, ruta) do nothing;
  else
    insert into fitxers_orfes (bucket, ruta, origen)
    select 'documentos', r, 'reinici_dades'
      from (select ruta as r from documentos where ruta is not null
            union select ruta from documentos_externos where ruta is not null
            union select trazo_firma_ruta from evidencias where trazo_firma_ruta is not null
            union select fitxer_ruta from firmes_document where fitxer_ruta is not null) x
    on conflict (bucket, ruta) do nothing;
  end if;

  -- (2) Las filas, en orden. Los consentimientos de organización justo antes de los enlaces
  --     (los de `consentiment_rgpd` apuntan a ellos) y de las organizaciones.
  foreach v_t in array v_ordre loop
    if v_t = 'evidencias' then
      delete from consentiments where organizacion_id is not null;
      get diagnostics v_n = row_count;
      v_esborrat := v_esborrat || jsonb_build_object('consentiments (de organitzacio)', v_n);
    end if;
    -- `where true`: PostgREST carga `pg-safeupdate`, que rechaza un DELETE sin WHERE (21000)
    -- también dentro de una función llamada por RPC.
    execute format('delete from public.%I where true', v_t);
    get diagnostics v_n = row_count;
    v_esborrat := v_esborrat || jsonb_build_object(v_t, v_n);
  end loop;

  delete from wa_contacts c
   where not exists (select 1 from meta_test_recipients m where m.phone = c.phone);
  get diagnostics v_n = row_count;
  v_esborrat := v_esborrat || jsonb_build_object('wa_contacts (fora de meta_test_recipients)', v_n);

  -- (3) Antes de reiniciar la numeración: no puede quedar NINGUNA fila de las tablas vaciadas
  --     (en especial, ninguna con número). Si algo quedara, se aborta todo.
  foreach v_t in array v_ordre loop
    execute format('select count(*) from public.%I', v_t) into v_n;
    if v_n > 0 then
      raise exception 'reinici_incomplet: queden % files a %', v_n, v_t using errcode = '23000';
    end if;
  end loop;

  -- (4) La numeración vuelve a empezar: ya no queda ninguna fila a la que pertenezca un número.
  update series_documentales set ultimo = 0 where ultimo <> 0;
  get diagnostics v_n = row_count;
  v_esborrat := v_esborrat || jsonb_build_object('series_documentales (a zero)', v_n);

  select count(*) into v_cua from fitxers_orfes;

  raise log 'reiniciar_dades_operatives: buidat (% organitzacions, % fitxers a la cua)',
    jsonb_array_length(v_orgs), v_cua;

  return v_resultat || jsonb_build_object(
    'executat',          true,
    'esborrat',          v_esborrat,
    'fitxers_a_la_cua',  v_cua);
end;
$function$;

revoke execute on function public.reiniciar_dades_operatives(boolean) from public, anon, authenticated;
grant execute on function public.reiniciar_dades_operatives(boolean) to service_role;
