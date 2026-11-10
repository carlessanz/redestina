-- Deuda §12.140 (10-11-2026): borrar una ficha con expedientes de prevención.
--
-- La FK `expedients_prevencion.productor_id/entidad_id` es `restrict` a propósito (un expediente con
-- su PDF emitido es documentación), pero ni `bloqueigs_esborrat_fitxa()` ni `borrar_una_fitxa()` lo
-- conocían: borrar una ficha con expediente acababa en un `23503` en vez de dar el motivo.
--   · `bloqueigs_esborrat_fitxa()`: código nuevo `expedients` (los que tienen número) y la red de
--     `documents` cubre ahora los PDF de `expedient` y de `cierre_receptor`; `tancaments` cuenta
--     también los certificados de recepción (red: en la práctica ya bloquea `ofertes_rebudes`).
--   · `borrar_una_fitxa()`: arrastra los expedientes SIN número, con sus evidencias
--     (`documentos_externos` polimórficos, cuyas rutas salen en `fitxers_orfes`) y sus pestañas.
-- Misma firma y mismo `returns`: compatible con el frontend publicado (que ya pinta cualquier código
-- como `rec.block_<codi>`; el texto nuevo llega con el frontend). Idempotente.

CREATE OR REPLACE FUNCTION public.bloqueigs_esborrat_fitxa(p_tipo text, p_ficha uuid)
 RETURNS TABLE(codi text, n bigint, detall text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Los tres nombres de salida (`codi`, `n`, `detall`) son a la vez variables de plpgsql y
-- columnas del `return query`. Se declara qué gana —va ANTES del `declare`, es donde lo
-- lee plpgsql— en vez de confiar en que toda referencia quede calificada: aquí ninguna
-- variable se llama como una columna, así que `use_column` no puede sorprender.
#variable_conflict use_column
declare
  v_prod uuid := case when p_tipo = 'productor' then p_ficha end;
  v_ent  uuid := case when p_tipo = 'entidad'   then p_ficha end;
begin
  -- Consultar los bloqueos es una pregunta del equipo: enseña cuántos documentos y
  -- cierres tiene una organización. `service_role` entra igual (§4bis).
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'no_autoritzat: nomes l''equip pot consultar els bloquejos d''una fitxa'
      using errcode = '42501';
  end if;

  if p_tipo not in ('productor', 'entidad') then
    raise exception 'tipus_desconegut: % (ha de ser productor o entidad)', p_tipo
      using errcode = '22023';
  end if;

  return query
  with
  -- Los excedentes, las canalizaciones y los albaranes que cuelgan de esta ficha. Un
  -- albarán **no tiene FK a la ficha**: se resuelve por el registro (REC de donación), por
  -- la jornada (REC de espigolada) o por la canalización (ENT y OPE).
  exc as (
    select id from excedentes where v_prod is not null and productor_id = v_prod
  ),
  esp as (
    select id from espigoladas where v_prod is not null and productor_id = v_prod
  ),
  cana as (
    select c.id from canalizaciones c
     where (v_ent  is not null and c.entidad_id = v_ent)
        or (v_prod is not null and c.excedente_id in (select id from exc))
  ),
  alb as (
    select a.id, a.estado from albaranes a
     where a.excedente_id    in (select id from exc)
        or a.espigolada_id   in (select id from esp)
        or a.canalizacion_id in (select id from cana)
  ),
  conv as (
    select c.id, c.numero_completo from convenios c
     where (v_prod is not null and c.productor_id = v_prod)
        or (v_ent  is not null and c.entidad_id   = v_ent)
  ),
  pla as (
    select p.id, p.numero_completo from planes_prevencion p
     where (v_prod is not null and p.productor_id = v_prod)
        or (v_ent  is not null and p.entidad_id   = v_ent)
  ),
  cie as (
    select id from cierres_donante where v_prod is not null and productor_id = v_prod
  ),
  cip as (
    select id from cierres_periodo where v_prod is not null and productor_id = v_prod
  ),
  -- Los certificados de recepción de esta receptora (deuda §12.140, 10-11-2026). En la práctica
  -- ya los cubre `ofertes_rebudes` (un CR sale de lo que recibió), pero sin esta red un CR sin
  -- canalizaciones vivas chocaría con la FK `no action` en vez de dar el motivo.
  cir as (
    select id from cierres_receptor where v_ent is not null and entidad_id = v_ent
  ),
  -- Los expedientes de prevención (deuda §12.140). La FK es `restrict` a propósito: un
  -- expediente con número es documentación y bloquea; uno sin número se borra con la ficha.
  exp as (
    select x.id, x.numero_completo from expedients_prevencion x
     where (v_prod is not null and x.productor_id = v_prod)
        or (v_ent  is not null and x.entidad_id   = v_ent)
  ),
  motius as (
    -- (0) Las OFERTAS (04-11-2026, decisión de Carles). Hasta hoy se arrastraban con la
    --     ficha; desde esta migración bloquean, como lo fiscal: una oferta es la historia
    --     operativa de la organización —y, si se canalizó, también la de otra—, y lo que se
    --     hace con una entidad que ya ha operado es DESACTIVARLA, no borrarla. El borrado
    --     queda para lo que se dio de alta por error y nunca operó.
    --       · productor → `ofertes`: cualquier excedente suyo, en cualquier estado (también
    --         `cancelada` y `borrador`: la regla es «ha ofrecido algo», no «sigue abierta»).
    --       · entidad   → `ofertes_rebudes`: las ofertas distintas en las que ha participado,
    --         por una respuesta (se le envió, mostró interés o la declinó) o por una
    --         canalización. Borrarla se llevaba esas filas y le cambiaba la historia de la
    --         oferta al productor.
    select 'ofertes' as codi,
           count(*)  as n,
           'Te ' || count(*) || ' oferta(es) (desactiva-la en lloc d''esborrar-la)' as detall
      from exc
    union all
    select 'ofertes_rebudes', count(*),
           'Ha participat en ' || count(*) || ' oferta(es) d''altres (desactiva-la en lloc d''esborrar-la)'
      from (
        select r.excedente_id from oferta_respuestas r
         where v_ent is not null and r.entidad_id = v_ent
        union
        select c.excedente_id from canalizaciones c
         where v_ent is not null and c.entidad_id = v_ent
      ) t
    union all
    -- (a) Albaranes que ya no son borrador. El umbral es exactamente el de
    --     `albaranes_no_esborrar`: un borrador no tiene número y no documenta nada, así
    --     que se arrastra; cualquier otro estado es un hecho con número de serie.
    --     ⚠️ No vale bloquear con «tiene algún albarán» a secas: el trigger
    --     `canalizaciones_crea_albaranes` crea uno en borrador con CADA canalización, así
    --     que eso haría indeleble cualquier ficha que haya canalizado una vez.
    select 'albarans',
           count(*),
           'Te ' || count(*) || ' albara(ns) emesos, entregats o conciliats' as detall
      from alb where estado <> 'borrador'
    union all
    -- (b) Cierres anuales y certificados a demanda de este donante.
    select 'tancaments', count(*),
           'Te ' || count(*) || ' tancament(s) o certificat(s) a demanda'
      from (select id from cie union all select id from cip union all select id from cir) t
    union all
    -- (c) Líneas de cierre que citan esta ficha o una de sus canalizaciones. Es la
    --     evidencia fiscal que hoy se quedaba apuntando a nadie por el `set null`.
    select 'linies_tancament', count(*),
           'Apareix a ' || count(*) || ' linia(es) de tancament d''un altre donant'
      from (
        select l.id from cierre_donante_lineas l
         where (v_ent is not null and l.entidad_id = v_ent)
            or l.canalizacion_id in (select id from cana)
        union all
        select l.id from cierre_periodo_lineas l
         where (v_ent is not null and l.entidad_id = v_ent)
            or l.canalizacion_id in (select id from cana)
      ) t
    union all
    -- (d) Convenios y planes con número: los congela su propio trigger, y la CASCADE de la
    --     ficha se estrellaría contra él a mitad del borrado.
    select 'convenis', count(*),
           'Te ' || count(*) || ' conveni(s) amb numero'
      from conv where numero_completo is not null
    union all
    select 'plans', count(*),
           'Te ' || count(*) || ' pla(ns) de prevencio amb numero'
      from pla where numero_completo is not null
    union all
    select 'expedients', count(*),
           'Te ' || count(*) || ' expedient(s) de prevencio amb numero'
      from exp where numero_completo is not null
    union all
    -- (e) Cualquier documento emitido cuyo objeto sea de esta ficha. Es la red que cubre
    --     los seis `objeto_tipo` a la vez: un documento no se puede borrar (su trigger lo
    --     impide y la serie no puede tener huecos), así que si existe, la ficha se queda.
    select 'documents', count(*),
           'Te ' || count(*) || ' document(s) emesos (no s''esborren mai)'
      from documentos d
     where (d.objeto_tipo = 'albaran'        and d.objeto_id in (select id from alb))
        or (d.objeto_tipo = 'espigolada'     and d.objeto_id in (select id from esp))
        or (d.objeto_tipo = 'convenio'       and d.objeto_id in (select id from conv))
        or (d.objeto_tipo = 'plan'           and d.objeto_id in (select id from pla))
        or (d.objeto_tipo = 'cierre_donante' and d.objeto_id in (select id from cie))
        or (d.objeto_tipo = 'cierre_periodo' and d.objeto_id in (select id from cip))
        or (d.objeto_tipo = 'cierre_receptor' and d.objeto_id in (select id from cir))
        or (d.objeto_tipo = 'expedient'      and d.objeto_id in (select id from exp))
  )
  select m.codi, m.n, m.detall from motius m where m.n > 0;
end;
$function$;

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
      or (de.objeto_tipo = 'expedient' and de.objeto_id = any(v_exps));

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
    delete from organizaciones where id = v_org;
    v_org_fora := true;
  end if;

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
