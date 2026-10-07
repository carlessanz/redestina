-- Deuda §12.33: borrar una ficha deja rastro en email_test_recipients.
--
-- QUÉ PASABA. `email_test_recipients` (§4) guarda un correo suelto SIN FK a ninguna ficha
-- — no puede tenerla, porque conserva a propósito `tecnologia@espigoladors.com` sin ficha
-- detrás (es el correo propietario de la cuenta de Resend, AGENTS §6). Como no hay FK,
-- borrar una ficha nunca arrastraba su fila de la whitelist: quedaba un correo suelto
-- apuntando a nadie, disciplina puramente manual. Volvió a pasar el 16-09-2026 con el
-- borrado de doble rol de Carles Sanz, exactamente como la deuda avisaba que podía repetirse.
--
-- QUÉ CAMBIA. `borrar_una_fitxa()` (definida en `20260921153439_borrar_ficha_completa.sql`)
-- ya captura `v_nom`/`v_tel` de la ficha ANTES de borrarla, en el mismo `select … into` de
-- arriba. Se añade `v_correu` al mismo select y, tras borrar la ficha (paso 9) y antes de
-- retirar la organización (paso 10), se borra de `email_test_recipients` la fila cuyo
-- `email` coincida EXACTO con el que tenía la ficha. Nunca toca `tecnologia@espigoladors.com`:
-- esa fila no cuelga de ninguna ficha desde el origen, así que ningún `v_correu` de una
-- ficha real puede coincidir con ella.
--
-- ⚠️ NO SE AÑADE FK. Seguiría sin poder tenerla por la misma razón de siempre (la fila del
-- owner de Resend). Lo que se cierra es la disciplina manual para el caso de ficha borrada
-- por `borrar_ficha_completa()`, que es la ÚNICA puerta de borrado (§7, deuda §12.108); un
-- `insert`/`update` manual en la whitelist sigue sin validación automática, como siempre.
--
-- ⚠️ `create or replace` reescribe TODOS los atributos de la función: se repiten `volatile`,
--    `security definer` y `set search_path`, como en `20270319100000` y `20270322100000`.
--    El cuerpo es el mismo que `20260921153439:240-410`, con los tres cambios señalados
--    abajo (👈): la declaración de `v_correu`, su captura en los dos `select` iniciales y
--    el nuevo paso de borrado.
create or replace function public.borrar_una_fitxa(
  p_tipo  text,
  p_ficha uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod    uuid := case when p_tipo = 'productor' then p_ficha end;
  v_ent     uuid := case when p_tipo = 'entidad'   then p_ficha end;
  v_org     uuid;
  v_nom     text;
  v_tel     text;
  v_correu  text; -- 👈 nuevo: el correo de la ficha, para poder purgar la whitelist
  v_albs    uuid[];
  v_convs   uuid[];
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

  -- Los ficheros que quedarán sin dueño en Storage. Se anotan ANTES de borrar la fila,
  -- que es la única oportunidad de saber su ruta.
  select coalesce(array_agg(de.ruta), '{}'::text[])
    into v_fitxers
    from documentos_externos de
   where de.objeto_tipo = 'albaran' and de.objeto_id = any(v_albs);

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
$$;

comment on function public.borrar_una_fitxa(text, uuid) is
  'INTERNA: borra una ficha y todo lo operativo suyo, incluida su fila de '
  'email_test_recipients si tenía una (deuda §12.33). No comprueba permiso ni bloqueos — lo '
  'hace borrar_ficha_completa() para las dos fichas a la vez, antes de tocar nada.';

-- Nadie la llama desde fuera: la superficie pública sigue siendo `borrar_ficha_completa()`.
-- Los GRANT no cambian (la signatura es la misma, no hay `drop`), pero se repiten para que
-- el fichero se lea solo, como en las migraciones que ya tocaron esta función antes.
revoke execute on function public.borrar_una_fitxa(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verificación (en una transacción con rollback, contra una ficha TEST-* con correo en
-- email_test_recipients):
--   begin;
--     select email from productores where id = '<id>';                     -- anotar el correo
--     select borrar_ficha_completa('productor', '<id>');
--     select * from email_test_recipients where email = '<el correo anotado>'; -- 0 filas
--     select * from email_test_recipients where email = 'tecnologia@espigoladors.com'; -- sigue
--   rollback;
-- ---------------------------------------------------------------------------
