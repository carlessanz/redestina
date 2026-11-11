-- Deuda menor (11-11-2026): borrar una ficha ya no deja ficheros ni filas huérfanas.
--
-- Hasta hoy `borrar_una_fitxa()`:
--   · no borraba el ARCHIVO PREVIO de la ficha (`documentos_externos` con objeto_tipo
--     'productor'/'entidad') ni los PDF subidos de sus convenios sin número (objeto_tipo 'convenio');
--   · no borraba los enlaces de la ORGANIZACIÓN retirada (`enlaces_token` 'organizacion': la
--     petición del consentimiento RGPD);
--   · devolvía las rutas de Storage en `fitxers_orfes`, pero nadie las leía: los ficheros se
--     quedaban en el bucket para siempre (y la base no los puede borrar: `protect_objects_delete`).
--
-- Ahora:
--   1. tabla `fitxers_orfes`: la cola de rutas a borrar de Storage, sin acceso desde el panel;
--      la vacía el job diario `recordatorios-documentales` (con `service_role`);
--   2. `borrar_una_fitxa()` borra el archivo previo, los documentos de sus convenios y, si
--      retira la organización, sus enlaces; mete todas las rutas (y los trazos de firma de los
--      enlaces que se van) en la cola;
--   3. limpieza de lo que ya había quedado huérfano: enlaces de organizaciones que ya no
--      existen y `documentos_externos` cuyo objeto ya no existe (sus ficheros, a la cola).
--
-- Misma firma y mismo `returns` que `20270525100000`: compatible con el frontend publicado.
-- `bloqueigs_esborrat_fitxa()` no cambia: nada de esto es fiscal ni bloquea.

-- 1. La cola ---------------------------------------------------------------------------------
create table if not exists public.fitxers_orfes (
  id         bigserial primary key,
  bucket     text not null default 'documentos',
  ruta       text not null,
  origen     text,
  created_at timestamptz not null default now(),
  unique (bucket, ruta)
);
comment on table public.fitxers_orfes is
  'Rutas de Storage que se han quedado sin fila (borrado de una ficha, limpieza). Las borra el job diario recordatorios-documentales; la base no puede borrar objetos de Storage. Sin acceso desde el panel.';
alter table public.fitxers_orfes enable row level security;
revoke all on public.fitxers_orfes from public, anon, authenticated;
revoke all on sequence public.fitxers_orfes_id_seq from public, anon, authenticated;

-- 2. El borrado de una ficha ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.borrar_una_fitxa(p_tipo text, p_ficha uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_prod    uuid := case when p_tipo = 'productor' then p_ficha end;
  v_ent     uuid := case when p_tipo = 'entidad'   then p_ficha end;
  v_org     uuid;
  v_nom     text;
  v_tel     text;
  v_correu  text; -- 👈 nuevo: el correo de la ficha, para poder purgar la whitelist
  v_albs    uuid[];
  v_convs   uuid[];
  v_exps    uuid[];
  v_fitxers text[];
  v_tracos  text[]; -- los trazos de firma de los enlaces que se borran (Storage, `evidencies/`)
  v_org_fora boolean := false;
  v_n       jsonb := '{}'::jsonb;
  c         int;
begin
  if p_tipo = 'productor' then
    select p.organizacion_id, coalesce(nullif(p.empresa, ''), p.name), p.phone, p.email
      into v_org, v_nom, v_tel, v_correu -- 👈 captura v_correu junto a v_nom/v_tel
      from productores p where p.id = p_ficha;
  else
    select e.organizacion_id, e.nombre, e.telefono, e.email
      into v_org, v_nom, v_tel, v_correu -- 👈 idem para entidades
      from entidades e where e.id = p_ficha;
  end if;

  -- `found` y no «el nombre es null»: una ficha puede tener el nombre vacío, pero si el
  -- `select` no ha traído fila es que no existe.
  if not found then
    raise exception 'fitxa_no_trobada: no hi ha cap % amb id %', p_tipo, p_ficha
      using errcode = '22023';
  end if;

  -- Los albaranes de esta ficha (todos en borrador: el paso 1 de la RPC ya lo garantizó).
  select coalesce(array_agg(a.id), '{}'::uuid[])
    into v_albs
    from albaranes a
   where a.excedente_id in (select id from excedentes where v_prod is not null and productor_id = v_prod)
      or a.espigolada_id in (select id from espigoladas where v_prod is not null and productor_id = v_prod)
      or a.canalizacion_id in (
           select c2.id from canalizaciones c2
            where (v_ent is not null and c2.entidad_id = v_ent)
               or (v_prod is not null and c2.excedente_id in
                     (select id from excedentes where productor_id = v_prod)));

  select coalesce(array_agg(c2.id), '{}'::uuid[])
    into v_convs
    from convenios c2
   where (v_prod is not null and c2.productor_id = v_prod)
      or (v_ent  is not null and c2.entidad_id   = v_ent);

  -- Los expedientes de prevención SIN número (deuda §12.140): los numerados bloquean en el paso 1.
  select coalesce(array_agg(x.id), '{}'::uuid[])
    into v_exps
    from expedients_prevencion x
   where ((v_prod is not null and x.productor_id = v_prod)
       or (v_ent  is not null and x.entidad_id   = v_ent))
     and x.numero_completo is null;

  -- Los ficheros que quedarán sin dueño en Storage. Se anotan ANTES de borrar la fila,
  -- que es la única oportunidad de saber su ruta. También las evidencias de los expedientes.
  select coalesce(array_agg(de.ruta), '{}'::text[])
    into v_fitxers
    from documentos_externos de
   where (de.objeto_tipo = 'albaran'   and de.objeto_id = any(v_albs))
      or (de.objeto_tipo = 'expedient' and de.objeto_id = any(v_exps))
      -- 20270526100000: el archivo previo de la ficha y los PDF subidos de sus convenios sin
      -- número (los convenios se van en CASCADE con la ficha; sus ficheros no se iban).
      or (de.objeto_tipo = p_tipo      and de.objeto_id = p_ficha)
      or (de.objeto_tipo = 'convenio'  and de.objeto_id = any(v_convs));

  -- Y los trazos de firma de los enlaces de esos albaranes y convenios: `evidencias` cae en
  -- CASCADE con el enlace, pero el PNG del trazo vive en Storage y nadie lo borraba.
  select coalesce(array_agg(ev.trazo_firma_ruta), '{}'::text[])
    into v_tracos
    from evidencias ev join enlaces_token et on et.id = ev.enlace_id
   where ev.trazo_firma_ruta is not null
     and ((et.objeto_tipo = 'albaran'  and et.objeto_id = any(v_albs))
       or (et.objeto_tipo = 'convenio' and et.objeto_id = any(v_convs)));
  v_fitxers := v_fitxers || v_tracos;

  -- (1) Lo que cuelga de los albaranes en borrador. `documentos_externos` y
  --     `enlaces_token` son POLIMÓRFICAS y no tienen FK, así que nadie las arrastraría:
  --     son exactamente el tipo de huérfano que la regla de §7 prohíbe.
  delete from documentos_externos where objeto_tipo = 'albaran' and objeto_id = any(v_albs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('documents_externs', c);

  delete from enlaces_token where objeto_tipo = 'albaran' and objeto_id = any(v_albs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('enllacos_albara', c);

  -- (2) Los albaranes en borrador. `albaran_lineas` va en cascada; `albaranes_no_esborrar`
  --     es la red: si aquí se colara uno con número, aborta la transacción entera.
  delete from albaranes where id = any(v_albs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('albarans_esborrany', c);

  if p_tipo = 'productor' then
    -- (3) Las sesiones de intake ANTES que los excedentes: `intake_sessions.excedente_id`
    --     es `NO ACTION` y rechazaría el borrado del excedente.
    delete from intake_sessions s
     where s.productor_id = v_prod
        or s.excedente_id in (select id from excedentes where productor_id = v_prod)
        -- Por teléfono, con las últimas 9 cifras (§7: los móviles se guardan con y sin
        -- prefijo). ⚠️ El `length(...) >= 9` NO es decoración: sin él, una ficha con un
        -- teléfono a medias («612») compararía sus 3 cifras contra el final de CUALQUIER
        -- número y se llevaría por delante la sesión de intake de otro productor.
        or (s.telefono is not null
            and length(regexp_replace(coalesce(v_tel, ''), '\D', '', 'g')) >= 9
            and right(regexp_replace(s.telefono, '\D', '', 'g'), 9)
              = right(regexp_replace(v_tel, '\D', '', 'g'), 9));
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('sessions_intake', c);

    -- (4) Las respuestas a sus ofertas. Caerían solas por la CASCADE de
    --     `oferta_respuestas.excedente_id`, pero se borran explícitamente para poder
    --     contarlas: un borrado que no dice cuánto se llevó no es auditable.
    delete from oferta_respuestas
     where excedente_id in (select id from excedentes where productor_id = v_prod);
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('respostes', c);

    -- (5) Las canalizaciones de sus ofertas. ⚠️ Aquí se pierde el reparto de esas ofertas
    --     tal como lo vio la entidad receptora; es operativo y va con la ficha, pero
    --     conviene saber que el receptor deja de ver esas entregas en su histórico.
    delete from canalizaciones
     where excedente_id in (select id from excedentes where productor_id = v_prod);
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('canalitzacions', c);

    delete from excedentes where productor_id = v_prod;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('ofertes', c);

    -- (6) Las jornadas de espigueo, ya sin registros ni REC.
    delete from espigoladas where productor_id = v_prod;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('espigolades', c);

    -- (7) Las fincas. Después de excedentes y espigoladas, que las referencian.
    delete from productor_ubicaciones where productor_id = v_prod;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('ubicacions', c);
  else
    delete from oferta_respuestas where entidad_id = v_ent;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('respostes', c);

    delete from canalizaciones where entidad_id = v_ent;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('canalitzacions', c);
  end if;

  -- (8) Los enlaces de firma de sus convenios. Los convenios se van en CASCADE con la
  --     ficha, pero sus enlaces son polimórficos y se quedarían señalando a la nada.
  --     `evidencias` cae en cascada desde el enlace.
  delete from enlaces_token where objeto_tipo = 'convenio' and objeto_id = any(v_convs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('enllacos_conveni', c);

  -- (8bis) Los expedientes de prevención sin número (deuda §12.140). Sus evidencias son
  --        `documentos_externos` polimórficos (nadie las arrastraría) y sus pestañas `pla_*` caen
  --        en CASCADE. Sin este paso, la FK `restrict` abortaba el borrado con un 23503.
  delete from documentos_externos where objeto_tipo = 'expedient' and objeto_id = any(v_exps);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('evidencies_expedient', c);
  delete from expedients_prevencion where id = any(v_exps);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('expedients', c);

  -- (8ter) 20270526100000: el archivo previo de la ficha (certificados y planes previos,
  --        otros) y los PDF subidos de sus convenios sin número. Polimórficos: nadie los
  --        arrastraba y se quedaban apuntando a una ficha que ya no existe.
  delete from documentos_externos where objeto_tipo = p_tipo and objeto_id = p_ficha;
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('arxiu_fitxa', c);
  delete from documentos_externos where objeto_tipo = 'convenio' and objeto_id = any(v_convs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('documents_conveni', c);

  -- (9) La ficha. Arrastra en CASCADE `convenios` (sin número), `membresias` —o sea que
  --     las cuentas de esa organización se quedan sin panel, que es lo que el panel avisa
  --     antes de preguntar— y `planes_prevencion` (sin número).
  if p_tipo = 'productor' then
    delete from productores where id = v_prod;
  else
    delete from entidades where id = v_ent;
  end if;
  get diagnostics c = row_count;
  if c = 0 then
    raise exception 'fitxa_no_trobada: no hi ha cap % amb id %', p_tipo, p_ficha
      using errcode = '22023';
  end if;

  -- (9bis) 👈 nuevo: la whitelist de correo de prueba (deuda §12.33). Solo coincidencia
  --        EXACTA con el correo que tenía la ficha, capturado arriba antes de borrarla —
  --        nunca toca `tecnologia@espigoladors.com`, que no cuelga de ninguna ficha.
  if v_correu is not null then
    delete from email_test_recipients where email = v_correu;
    get diagnostics c = row_count;
    v_n := v_n || jsonb_build_object('whitelist_correu', c);
  end if;

  -- (10) La organización, si se ha quedado sin ninguna ficha. Es el paso que hasta hoy se
  --      hacía «a mano» después de cada purga —las dos del 16-09-2026 tuvieron que
  --      retirarlas en un paso aparte— y el que convierte el borrado en completo: una
  --      organización sin fichas no la ve nadie y no la limpia nadie.
  if v_org is not null
     and not exists (select 1 from productores where organizacion_id = v_org)
     and not exists (select 1 from entidades   where organizacion_id = v_org)
     -- Un convenio que siguiera colgando de la organización la retiene: antes que borrar
     -- un documento de colaboración por el camino, se deja la organización y se dice.
     and not exists (select 1 from convenios   where organizacion_id = v_org) then
    -- 20270526100000: sus enlaces (la petición del consentimiento RGPD por correo) se iban
    -- quedando apuntando a la nada. El consentimiento dado sigue en `consentiments`
    -- (`enlace_id` pasa a null; la organización ya pasaba a null): es el registro legal.
    select coalesce(array_agg(ev.trazo_firma_ruta), '{}'::text[])
      into v_tracos
      from evidencias ev join enlaces_token et on et.id = ev.enlace_id
     where ev.trazo_firma_ruta is not null and et.objeto_tipo = 'organizacion' and et.objeto_id = v_org;
    v_fitxers := v_fitxers || v_tracos;
    delete from enlaces_token where objeto_tipo = 'organizacion' and objeto_id = v_org;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('enllacos_organitzacio', c);
    delete from organizaciones where id = v_org;
    v_org_fora := true;
  end if;

  -- (11) 20270526100000: los ficheros a la cola de Storage. La base no puede borrar un objeto
  --      (`storage.protect_objects_delete`); los borra el job diario `recordatorios-documentales`.
  --      Antes las rutas solo salían en `fitxers_orfes` del resultado y nadie las miraba.
  insert into fitxers_orfes (bucket, ruta, origen)
  select 'documentos', r, 'esborrat_fitxa:' || p_tipo
    from unnest(v_fitxers) r where r is not null and r <> ''
  on conflict (bucket, ruta) do nothing;

  return jsonb_build_object(
    'tipus',                 p_tipo,
    'id',                    p_ficha,
    'nom',                   v_nom,
    'organizacion_id',       v_org,
    'organitzacio_retirada', v_org_fora,
    'esborrat',              v_n,
    'fitxers_orfes',         to_jsonb(coalesce(v_fitxers, '{}'::text[]))
  );
end;
$function$;

-- 3. Lo que ya estaba huérfano -------------------------------------------------------------------
-- Los trazos de firma de los enlaces de organizaciones que ya no existen, a la cola; y los enlaces.
insert into public.fitxers_orfes (bucket, ruta, origen)
select 'documentos', ev.trazo_firma_ruta, 'neteja:enllac_organitzacio'
  from public.evidencias ev join public.enlaces_token et on et.id = ev.enlace_id
 where ev.trazo_firma_ruta is not null and et.objeto_tipo = 'organizacion'
   and not exists (select 1 from public.organizaciones o where o.id = et.objeto_id)
on conflict (bucket, ruta) do nothing;
delete from public.enlaces_token et
 where et.objeto_tipo = 'organizacion'
   and not exists (select 1 from public.organizaciones o where o.id = et.objeto_id);

-- Los documentos externos cuyo objeto ya no existe: su fichero a la cola y la fila fuera.
with orfes as (
  select de.id, de.ruta from public.documentos_externos de
   where (de.objeto_tipo = 'productor'      and not exists (select 1 from public.productores x where x.id = de.objeto_id))
      or (de.objeto_tipo = 'entidad'        and not exists (select 1 from public.entidades x where x.id = de.objeto_id))
      or (de.objeto_tipo = 'convenio'       and not exists (select 1 from public.convenios x where x.id = de.objeto_id))
      or (de.objeto_tipo = 'albaran'        and not exists (select 1 from public.albaranes x where x.id = de.objeto_id))
      or (de.objeto_tipo = 'expedient'      and not exists (select 1 from public.expedients_prevencion x where x.id = de.objeto_id))
      or (de.objeto_tipo = 'cierre_donante' and not exists (select 1 from public.cierres_donante x where x.id = de.objeto_id))
), cua as (
  insert into public.fitxers_orfes (bucket, ruta, origen)
  select 'documentos', ruta, 'neteja:document_extern' from orfes where ruta is not null and ruta <> ''
  on conflict (bucket, ruta) do nothing
)
delete from public.documentos_externos de using orfes where de.id = orfes.id;
