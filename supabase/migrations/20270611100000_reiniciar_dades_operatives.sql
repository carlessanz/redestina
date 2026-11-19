-- Fase 6 de los puntos 4-6: DEJAR LA PLATAFORMA VACÍA DE DATOS OPERATIVOS antes del piloto.
--
-- La Fundació empieza el piloto en limpio: sin ofertas, sin albaranes, sin documentos, sin
-- convenios y sin ninguna de las fichas que hay hoy (en producción, las de prueba; en el clon,
-- además las 721 del ARA). Después, `scripts/sembrar-entitats-ficticies.ts` crea un juego
-- pequeño de organizaciones ficticias cuyo nombre dice el tipo.
--
-- 🔴 UNA SOLA PUERTA. Todo el vaciado pasa por `reiniciar_dades_operatives(p_executar)`, en
--    una transacción, y solo la ejecuta `service_role` (el script `scripts/reiniciar-dades.ts`).
--    Nunca `delete` sueltos desde un script, nunca `truncate`.
--
--    · `p_executar = false` (por defecto): NO escribe nada. Devuelve el inventario —cuántas filas
--      borraría por tabla, las organizaciones con nombre/NIF/papeles, las cuentas externas que se
--      quedarían sin organización (solo correo y nombre), los ficheros de Storage afectados y los
--      BLOQUEOS—.
--    · `p_executar = true`: si hay algún bloqueo, se niega (`22023 hi_ha_dades_reals`) sin tocar
--      nada. Si no, borra en orden de dependencias, pone los ficheros de Storage en la cola
--      `fitxers_orfes` (la base no puede borrarlos: los borra el script con la service key, o el
--      job diario `recordatorios-documentales` si el script no llega), reinicia las series y
--      devuelve el inventario con lo borrado.
--
-- QUÉ ES «REAL» (y por qué no basta con `documentos.modo`). El criterio que se pensó al planear la
-- fase —«todos los documentos en modo prueba»— no se cumple ni en el clon ni en producción, y no
-- por un fallo: los albaranes (REC/ENT/OPE), los convenios (CONV) y los planes (PLA) **siempre**
-- se emiten con `modo = 'real'`; el modo prueba solo existe para los certificados y los cierres.
-- Lo que de verdad impide que un documento emitido hasta hoy tenga valor legal es otra cosa:
-- `parametros_documentales.datos_provisionales = true` (los datos de la Fundació impresos dicen
-- «PROVISIONAL — pendent de…» y el CIF `G00000000` no es válido). Así que se niega si:
--   1. `dades_fundacio_definitives`: `datos_provisionales` ya es `false` (desde ese momento lo que
--      se emite puede tener valor legal);
--   2. `certificats_reals`: hay algún certificado o resumen (CD, CT, CR, RES) en modo real, o algún
--      cierre (`cierres_ejercicio`, `cierres_periodo`, `cierres_receptor`) en modo real;
--   3. `operativa_fitxes_reals`: hay operativa o un documento con número de una ficha que NO es
--      `es_test` (ofertas, espigoladas, canalizaciones, respuestas, convenios, planes y expedientes
--      con número, cierres). Las fichas importadas sin operativa (las del ARA) no bloquean: se
--      borran con todo lo suyo.
--
-- CÓMO SE SALTA LA INMUTABILIDAD (y solo aquí). Cuatro triggers prohíben el `delete` de lo que tiene
-- número: `documentos_no_esborrar`, `albaranes_no_esborrar`, `convenios_no_esborrar` y
-- `planes_no_esborrar`. Se les añade UNA excepción, la misma en los cuatro y por la función
-- `reinici_dades_permes()`: la marca de sesión `redestina.reinicio_dades = 'on'` **y**
-- `datos_provisionales = true`. La marca solo la fija esta función, con
-- `set_config(..., is_local => true)` (vale hasta el final de la transacción: no se puede dejar
-- encendida), y la segunda condición la vuelve a mirar el propio trigger: aunque alguien fijara la
-- marca a mano, con los datos de la Fundació definitivos nada con número se borra. La excepción de
-- siempre (`redestina.reinicio_prueba`, solo modo prueba, de `reiniciar_documentos_prova()`) sigue
-- igual.
--
-- EL NÚMERO PERTENECE A LA FILA. Reiniciar `series_documentales` a 0 solo es correcto si no queda
-- ninguna fila con número: la función borra todas las que lo tienen (documentos, albaranes,
-- convenios, planes, expedientes, cierres, ofertas) y, ANTES de reiniciar, comprueba que todas las
-- tablas vaciadas están a 0. Si algo quedara, se aborta todo (rollback).
--
-- QUÉ SE CONSERVA: catálogos (productos, causas, subcausas, municipios, códigos postales, tipos de
-- caja, costes y precios de referencia con sus cargas, factores, compatibilidades, destinos
-- finales), `app_settings`, `app_config`, `cortina_config`, whitelists (`meta_test_recipients`,
-- `email_test_recipients`), `parametros_documentales`, `plantillas_documento`, `usuario_roles` y
-- el historial del equipo (`equip_rols_hist`, `equip_persones_arxiu`), TODAS las cuentas
-- (`auth.users` y `perfiles`) con sus consentimientos de cuenta (los que no son de una
-- organización), y los contactos de WhatsApp de los números de `meta_test_recipients` (su opt-in y
-- su ventana de 24 h); sus mensajes, no.
--
-- NADA DE DATOS PERSONALES AQUÍ: esta migración no inserta ninguna fila.

-- ---------------------------------------------------------------------------
-- 1. La excepción de los cuatro triggers de inmutabilidad
-- ---------------------------------------------------------------------------
create or replace function public.reinici_dades_permes()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(current_setting('redestina.reinicio_dades', true), 'off') = 'on'
     and coalesce((select pd.datos_provisionales from parametros_documentales pd where pd.id = 1), false);
$$;

comment on function public.reinici_dades_permes() is
  'Interna (triggers): true solo dentro de reiniciar_dades_operatives() (marca local redestina.reinicio_dades) y con datos_provisionales = true. 20270611100000.';

revoke execute on function public.reinici_dades_permes() from public, anon, authenticated;

create or replace function public.trg_documentos_no_esborrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- El vaciado de antes del piloto (20270611100000): con su marca y los datos de la Fundació
  -- todavía provisionales, ningún documento emitido tiene valor legal y se puede borrar.
  if public.reinici_dades_permes() then
    return old;
  end if;
  if coalesce(current_setting('redestina.reinicio_prueba', true), 'off') <> 'on' then
    raise exception 'Els documents no s''esborren (%). Emet una versio que el substitueixi.',
      old.numero_completo using errcode = '42501';
  end if;
  -- Y ni siquiera con el interruptor puesto se borra un documento real.
  if old.modo <> 'prueba' then
    raise exception 'El reinici de proves nomes esborra documents en modo prueba (% es %)',
      old.numero_completo, old.modo using errcode = '42501';
  end if;
  return old;
end;
$$;

create or replace function public.trg_albaranes_no_esborrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.estado <> 'borrador' and not public.reinici_dades_permes() then
    raise exception 'Un albara amb numero no s''esborra (%): anul.la''l o rectifica''l.',
      old.numero_completo using errcode = '42501';
  end if;
  return old;
end;
$$;

create or replace function public.trg_convenios_no_esborrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.numero_completo is not null and not public.reinici_dades_permes() then
    raise exception 'El conveni % te numero: resol-lo o substitueix-lo, no l''esborris.',
      old.numero_completo using errcode = '42501';
  end if;
  return old;
end;
$$;

create or replace function public.trg_planes_no_esborrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.numero_completo is not null and not public.reinici_dades_permes() then
    raise exception 'El pla % te numero: substitueix-lo, no l''esborris.',
      old.numero_completo using errcode = '42501';
  end if;
  return old;
end;
$$;

-- `create or replace` conserva los privilegios, pero se repite por claridad (20270414100900).
revoke execute on function public.trg_documentos_no_esborrar() from public, anon, authenticated;
revoke execute on function public.trg_albaranes_no_esborrar()  from public, anon, authenticated;
revoke execute on function public.trg_convenios_no_esborrar()  from public, anon, authenticated;
revoke execute on function public.trg_planes_no_esborrar()     from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. La puerta: `reiniciar_dades_operatives(p_executar)`
-- ---------------------------------------------------------------------------
drop function if exists public.reiniciar_dades_operatives(boolean);

create function public.reiniciar_dades_operatives(p_executar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

comment on function public.reiniciar_dades_operatives(boolean) is
  'Vaciado de los datos operativos antes del piloto (20270611100000). Solo service_role (scripts/reiniciar-dades.ts). p_executar=false: inventario sin escribir; true: borra todo lo operativo y todas las fichas, encola los ficheros de Storage en fitxers_orfes y reinicia series_documentales. Se niega (22023 hi_ha_dades_reals) con datos de la Fundació definitivos, certificados reales u operativa de fichas no es_test.';

revoke execute on function public.reiniciar_dades_operatives(boolean) from public, anon, authenticated;
grant execute on function public.reiniciar_dades_operatives(boolean) to service_role;
