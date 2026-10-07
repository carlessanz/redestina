-- El albarán de OPERACIÓN (venta o maquila) lo confirman LAS DOS PARTES, no la primera.
--
-- Hasta hoy `registrar_confirmacion()` pasaba el albarán a `confirmado` con el PRIMER enlace
-- usado, fuera de quien fuera. En un OPE `marcar_entregado()` crea DOS enlaces —el generador
-- (`rol_parte = 'entrega'`) y la entidad (`rol_parte = 'recibe'`)— y el segundo recibía
-- PT409 («aquest albara ja no admet confirmacio») porque el albarán ya no estaba en
-- `emitido`/`entregado`. Consecuencias: la confirmación de la segunda parte no se podía dar
-- nunca, y la rama «OPE con ≥2 enlaces usados» de `conciliacions_automatiques()` era
-- inalcanzable (la retoca la migración siguiente).
--
-- La regla nueva, en `registrar_confirmacion()`:
--
--   (1) Si es un OPE y queda OTRO enlace de confirmación del mismo albarán, de la OTRA parte,
--       sin usar, activo y sin caducar, el albarán NO pasa a `confirmado`: se queda
--       `entregado` y se registra lo que dice esta parte. Cuando confirma la última parte,
--       `confirmado` + `confirmado_at`. Con un solo enlace —la otra ficha no tiene correo y
--       nadie ha acuñado uno asistido— se confirma como antes.
--       ⚠️ Un enlace de la otra parte CADUCADO o REVOCADO no espera: si nadie va a confirmar
--          por ahí, quedarse en `entregado` para siempre sería peor. El equipo acuña uno
--          asistido ANTES de que confirme la primera parte si quiere las dos firmas.
--
--   (2) Los kilos confirmados (`albaran_lineas.kg_confirmados`) los fija la parte que
--       RECIBE. Es la regla más conservadora: es quien pesa lo que de verdad llegó, y lo que
--       declara quien entrega es lo que dice haber cargado, que en una discrepancia no puede
--       ganar. Concretamente:
--         · `recibe` escribe siempre (y pisa lo que hubiera dejado `entrega`);
--         · `entrega` escribe solo si `recibe` todavía no ha confirmado — así, si `recibe`
--           no confirma nunca (sin correo), quedan los kilos de `entrega` y no un hueco.
--       Los kilos de las dos partes quedan íntegros en `evidencias.payload`: nada se pierde,
--       solo se decide cuál es la cifra de la línea.
--       En REC y ENT no cambia nada: hay una sola parte y escribe siempre.
--
--   (3) Un RECHAZO de cualquiera de las dos partes se conserva: `rechazo` se queda con el más
--       grave de los dos (`total` > `parcial` > `cap`) y los motivos se encadenan. Las
--       incidencias, si las dos son listas, se concatenan; si no, como antes.
--
--   (4) Una parte NO confirma dos veces. Si la misma parte (`rol_parte`) ya usó un enlace de
--       este albarán, PT409. Hace falta porque el albarán sigue `entregado` tras la primera
--       confirmación, y el panel podría acuñarle a esa parte un enlace nuevo.
--
-- Y `pendents_meus()` deja de ofrecer «confirma» a la parte que ya confirmó (mismo motivo).
--
-- No cambia: la evidencia por enlace (una fila de `evidencias` por confirmación), quién puede
-- llamarla (solo `service_role`), los SQLSTATE PT404/PT409/PT410 que `enlace-publico` traduce,
-- `asistido_por` leído de la fila del enlace, y el tipo de retorno (`albaranes`).
-- ⚠️ `enlace-publico` devuelve `estado` de la fila: tras la primera de dos confirmaciones de
--    un OPE ahora dice `entregado` y `confirmado_at` null, que es la verdad.

create or replace function public.registrar_confirmacion(p_enlace uuid, p_payload jsonb,
                                                         p_evidencia jsonb default null::jsonb)
returns albaranes
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  en          enlaces_token%rowtype;
  a           albaranes%rowtype;
  k           jsonb;
  v_rechazo   text;
  v_payload   jsonb;
  v_motivo    text;
  v_inc       jsonb;
  v_previa    boolean;   -- ¿otra parte de este albarán ya confirmó?
  v_recibe_ya boolean;   -- ¿la parte que RECIBE ya confirmó?
  v_espera    boolean;   -- ¿queda otra parte por confirmar?
  v_escribe   boolean;   -- ¿esta confirmación fija los kilos de las líneas?
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor registra una confirmacio' using errcode = '42501';
  end if;

  select * into en from enlaces_token where id = p_enlace for update;
  if en.id is null or en.proposito <> 'confirmacion_albaran' then
    raise exception 'Enllac desconegut' using errcode = 'PT404';
  end if;
  if en.usado_at is not null or en.estado in ('usado', 'revocado') then
    raise exception 'Aquest enllac ja s''ha fet servir' using errcode = 'PT409';
  end if;
  if en.caduca_at < now() or en.estado = 'caducado' then
    raise exception 'Aquest enllac ha caducat' using errcode = 'PT410';
  end if;

  select * into a from albaranes where id = en.objeto_id for update;
  if a.id is null or a.estado not in ('emitido', 'entregado') then
    raise exception 'Aquest albara ja no admet confirmacio' using errcode = 'PT409';
  end if;

  -- (4) Esta parte ya confirmó con otro enlace. Con `rol_parte` null (enlaces anteriores a
  --     20270304100200) no se puede saber de qué parte era, y no se bloquea.
  if en.rol_parte is not null and exists (
       select 1 from enlaces_token t
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
          and t.proposito = 'confirmacion_albaran'
          and t.id <> en.id and t.usado_at is not null
          and t.rol_parte = en.rol_parte) then
    raise exception 'Aquesta part ja ha confirmat l''albara' using errcode = 'PT409';
  end if;

  select exists (
           select 1 from enlaces_token t
            where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
              and t.proposito = 'confirmacion_albaran'
              and t.id <> en.id and t.usado_at is not null),
         exists (
           select 1 from enlaces_token t
            where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
              and t.proposito = 'confirmacion_albaran'
              and t.id <> en.id and t.usado_at is not null
              and t.rol_parte = 'recibe')
    into v_previa, v_recibe_ya;

  -- (1) ¿Queda la OTRA parte? Solo en OPE, y solo con un enlace vivo de verdad. «Otra»
  --     significa otro `rol_parte`; si alguno es null (enlace antiguo) cuenta como otra.
  v_espera := a.tipo = 'OPE' and exists (
    select 1 from enlaces_token t
     where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
       and t.proposito = 'confirmacion_albaran'
       and t.id <> en.id
       and t.usado_at is null and t.estado = 'activo' and t.caduca_at >= now()
       and (en.rol_parte is null or t.rol_parte is null or t.rol_parte <> en.rol_parte));

  -- (2) Los kilos: `entrega` no pisa lo que ya dijo `recibe`.
  v_escribe := not (a.tipo = 'OPE' and en.rol_parte = 'entrega' and v_recibe_ya);

  if v_escribe then
    -- Los kilos que dice haber recibido, línea a línea.
    for k in select * from jsonb_array_elements(coalesce(p_payload->'kg_confirmados', '[]'::jsonb)) loop
      update albaran_lineas
         set kg_confirmados = (k->>'kg')::numeric
       where id = (k->>'linea_id')::uuid and albaran_id = a.id;
    end loop;
  end if;

  v_rechazo := coalesce(p_payload->>'rechazo', 'cap');
  if v_rechazo <> 'cap' and coalesce(btrim(p_payload->>'motivo_rechazo'), '') = '' then
    raise exception 'Un rebuig total o parcial necessita motiu' using errcode = '22023';
  end if;

  -- (3) El rechazo más grave de las dos partes, y los dos motivos. Con una sola
  --     confirmación (`a.rechazo = 'cap'`, `a.motivo_rechazo` null) el resultado es
  --     exactamente el de antes.
  v_rechazo := case
                 when 'total'   in (a.rechazo, v_rechazo) then 'total'
                 when 'parcial' in (a.rechazo, v_rechazo) then 'parcial'
                 else 'cap'
               end;
  v_motivo := case
                when coalesce(btrim(p_payload->>'motivo_rechazo'), '') = '' then a.motivo_rechazo
                when coalesce(btrim(a.motivo_rechazo), '') = '' then p_payload->>'motivo_rechazo'
                else a.motivo_rechazo || ' · ' || (p_payload->>'motivo_rechazo')
              end;
  v_inc := case
             when v_previa and jsonb_typeof(a.incidencias) = 'array'
                  and jsonb_typeof(p_payload->'incidencias') = 'array'
               then a.incidencias || (p_payload->'incidencias')
             else coalesce(p_payload->'incidencias', a.incidencias)
           end;

  if v_espera then
    -- Falta la otra parte: el albarán sigue `entregado` y sin `confirmado_at`.
    update albaranes
       set incidencias    = v_inc,
           rechazo        = v_rechazo,
           motivo_rechazo = v_motivo
     where id = a.id
    returning * into a;
  else
    update albaranes
       set estado         = 'confirmado',
           confirmado_at  = now(),
           incidencias    = v_inc,
           rechazo        = v_rechazo,
           motivo_rechazo = v_motivo
     where id = a.id
    returning * into a;
  end if;

  if a.canalizacion_id is not null and (p_payload->>'caixes_retornades') is not null then
    update canalizaciones
       set caixes_retornades = (p_payload->>'caixes_retornades')::int
     where id = a.canalizacion_id;
  end if;

  -- Lo respondido, más lo que el servidor sabe y el navegador no puede afirmar.
  v_payload := coalesce(p_payload, '{}'::jsonb);
  if jsonb_typeof(p_evidencia->'payload') = 'object' then
    v_payload := v_payload || (p_evidencia->'payload');
  end if;

  -- La evidencia: es lo que hace que la confirmación valga algo. Una por enlace, también
  -- en el OPE: cada parte deja la suya, con sus kilos aunque no sean los de la línea.
  insert into evidencias (enlace_id, tipo, nombre, cargo, ip, user_agent, sha256_texto,
                          payload, asistido_por)
  values (en.id, 'confirmacion',
          p_evidencia->>'nombre', p_evidencia->>'cargo',
          (p_evidencia->>'ip')::inet, p_evidencia->>'user_agent',
          p_evidencia->>'sha256_texto',
          v_payload,
          -- Manda la fila del enlace sobre el cuerpo de la petición, y solo si es
          -- asistido: en `email` y en `panel` esta columna tiene que quedar NULL.
          case when en.canal = 'asistido'
               then coalesce(en.creado_por,
                             nullif(p_evidencia->>'asistido_por', '')::uuid)
               end);

  update enlaces_token set usado_at = now(), estado = 'usado' where id = en.id;

  return a;
end;
$function$;

revoke execute on function public.registrar_confirmacion(uuid, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.registrar_confirmacion(uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- pendents_meus(): la parte que ya confirmó un OPE no lo tiene pendiente.
-- ---------------------------------------------------------------------------
-- Es la definición vigente (20270318100000) con UNA condición más en la rama de albaranes:
-- `not exists` un enlace YA USADO de esta misma parte. Antes no hacía falta, porque la
-- primera confirmación sacaba el albarán de `entregado`; ahora un OPE sigue `entregado`
-- hasta que confirma la otra parte, y sin esta condición el panel le volvería a ofrecer
-- «confirma» a quien ya lo hizo (y `registrar_confirmacion()` se lo rechazaría con PT409).
-- Un enlace antiguo sin `rol_parte` cuenta para cualquier parte, como en el `lateral` de abajo.
CREATE OR REPLACE FUNCTION public.pendents_meus()
 RETURNS TABLE(proposito text, objeto_tipo text, objeto_id uuid, tipo_org text, org_id uuid, rol_parte text, numero text, etiqueta text, tipus text, estat_objecte text, motiu text, ejercicio integer, enlace_id uuid, enlace_estado_efectivo text, enlace_caduca_at timestamp with time zone, enlace_canal text, enlace_created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;

  return query
  with meves as (
    select m.productor_id, m.entidad_id
      from membresias m
      join perfiles p on p.id = m.user_id
     where m.user_id = v_user and m.activo and p.activo
  ),
  pendents as (
    -- Convenios: `pendent_firma` y `retornat` son los dos estados en los que la pelota
    -- está en el tejado de la organización (mismo criterio que `conveni_pendent`).
    select 'firma_convenio'::text          as proposito,
           'convenio'::text                as objeto_tipo,
           c.id                            as objeto_id,
           c.tipo_org                      as tipo_org,
           coalesce(c.productor_id, c.entidad_id) as org_id,
           null::text                      as rol_parte,
           c.numero_completo               as numero,
           null::text                      as etiqueta,
           c.tipo                          as tipus,
           c.estado                        as estat_objecte,
           c.motivo_devolucion             as motiu,
           c.ejercicio                     as ejercicio
      from convenios c
     where c.estado in ('pendent_firma', 'retornat')
       and (c.productor_id in (select productor_id from meves where productor_id is not null)
         or c.entidad_id   in (select entidad_id   from meves where entidad_id   is not null))
    union all
    -- Albaranes entregados y sin confirmar. La parte se resuelve como en
    -- `marcar_entregado()`: REC y OPE los entrega el generador, ENT y OPE los recibe la
    -- entidad. En un OPE donde la cuenta tenga las dos fichas salen dos filas, y es lo
    -- correcto: son dos confirmaciones distintas.
    select 'confirmacion_albaran'::text,
           'albaran'::text,
           a.id,
           part.tipo_org,
           part.org_id,
           part.rol,
           a.numero_completo,
           (select string_agg(distinct l.producto, ', ') from albaran_lineas l where l.albaran_id = a.id),
           a.tipo,
           a.estado,
           null::text,
           a.ejercicio
      from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
      left join excedentes     e on e.id = a.excedente_id
      left join espigoladas   es on es.id = a.espigolada_id
      cross join lateral (
        select 'productor'::text as tipo_org,
               coalesce(e.productor_id, es.productor_id) as org_id,
               'entrega'::text as rol
         where a.tipo in ('REC', 'OPE')
           and coalesce(e.productor_id, es.productor_id)
               in (select productor_id from meves where productor_id is not null)
        union all
        select 'entidad', c.entidad_id, 'recibe'
         where a.tipo in ('ENT', 'OPE')
           and c.entidad_id in (select entidad_id from meves where entidad_id is not null)
      ) part
     where a.estado = 'entregado'
       and not exists (
         select 1 from enlaces_token t
          where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
            and t.proposito = 'confirmacion_albaran' and t.usado_at is not null
            and (t.rol_parte is null or t.rol_parte = part.rol))
  )
  select p.proposito, p.objeto_tipo, p.objeto_id, p.tipo_org, p.org_id, p.rol_parte,
         p.numero, p.etiqueta, p.tipus, p.estat_objecte, p.motiu, p.ejercicio,
         en.id, en.estado_efectivo, en.caduca_at, en.canal, en.created_at
    from pendents p
    left join lateral (
      select e.id,
             case
               when e.estado <> 'activo'   then e.estado
               when e.usado_at is not null then 'usado'
               when e.caduca_at < now()    then 'caducado'
               else 'activo'
             end as estado_efectivo,
             e.caduca_at, e.canal, e.created_at
        from enlaces_token e
       where e.objeto_tipo = p.objeto_tipo
         and e.objeto_id   = p.objeto_id
         and e.proposito   = p.proposito
         and (p.rol_parte is null or e.rol_parte is null or e.rol_parte = p.rol_parte)
       order by e.created_at desc
       limit 1
    ) en on true
   order by p.objeto_tipo, p.ejercicio desc nulls last, p.numero nulls last;
end;
$function$;

revoke execute on function public.pendents_meus() from public, anon;
grant  execute on function public.pendents_meus() to authenticated, service_role;
