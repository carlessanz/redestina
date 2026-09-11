-- Enlazar una ficha con la organización que ya consta. Etapa 3 de la brecha 2 (§12.28).
--
-- ⚠️ LO PRIMERO, PORQUE CAMBIA EL DISEÑO: **enlazar no es rellenar un hueco, es FUSIONAR.**
-- `registro` cree que en el caso «papel nuevo» deja la ficha con `organizacion_id` NULL —así
-- lo dicen su comentario y §9— y **eso ya no puede pasar**: desde `20270313100000` la columna
-- es `not null` y el trigger `*_estrena_organizacion` le pone una organización propia en el
-- BEFORE INSERT. Comprobado insertando con NULL: sale con organización.
--
-- O sea que hoy el caso «papel nuevo» produce exactamente el duplicado que la detección venía
-- a evitar —dos identidades para la misma organización—, solo que **con una nota que lo dice**.
-- Enlazar es, por tanto, mover la ficha a la organización buena y **vaciar la que deja atrás**.
-- No se arregla quitando el `not null`: la invariante «toda ficha tiene organización» es lo que
-- impide que el agujero vuelva en silencio (§4). Se arregla aquí.
--
-- QUÉ VIAJA CON LA FICHA. Sus **convenios**, y solo los suyos: si la organización de origen
-- tuviera además la otra ficha, los convenios de esa se quedan donde están. Por eso el filtro
-- es por `productor_id`/`entidad_id` y no por `organizacion_id`.

-- ---------------------------------------------------------------------------
-- Quién podría ser: las organizaciones que coinciden con esta ficha
-- ---------------------------------------------------------------------------
-- Se calcula **al vuelo** y no se lee la nota que dejó `registro`: la nota es texto, envejece,
-- y solo existe para las altas posteriores a la etapa 2. Con esto, cualquier ficha —incluidas
-- las 464 que ya estaban— se puede revisar.
--
-- El criterio es el MISMO de la etapa 1 y del registro: **correo o teléfono exactos**, el
-- teléfono por sus últimas 9 cifras, y **nunca el parecido del nombre** — juntar dos
-- organizaciones distintas es mezclar los kilos y el certificado fiscal de dos donantes.
create or replace function public.organitzacions_candidates(p_tipo text, p_ficha uuid)
returns table (
  organitzacio  uuid,
  nom           text,
  nif           text,
  email         text,
  telefon       text,
  poblacio      text,
  es_generadora boolean,
  es_receptora  boolean,
  motiu         text,
  enllacable    boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  meu_email text;
  meu_tel9  text;
  meva_org  uuid;
begin
  if p_tipo not in ('productor', 'entidad') then
    raise exception 'tipus desconegut: %', p_tipo using errcode = '22023';
  end if;

  -- `auth.uid() is null` es `service_role` (§4bis): el rol solo se comprueba con sesión.
  if auth.uid() is not null and not (select public.es_intern()) then
    raise exception 'Nomes l''equip pot veure les organitzacions candidates' using errcode = '42501';
  end if;

  if p_tipo = 'productor' then
    select nullif(lower(trim(p.email)), ''),
           case when length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) end,
           p.organizacion_id
      into meu_email, meu_tel9, meva_org
      from productores p where p.id = p_ficha;
  else
    select nullif(lower(trim(e.email)), ''),
           case when length(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g'), 9) end,
           e.organizacion_id
      into meu_email, meu_tel9, meva_org
      from entidades e where e.id = p_ficha;
  end if;

  if meva_org is null then
    raise exception 'la fitxa % no existeix', p_ficha using errcode = '22023';
  end if;

  -- Sin correo ni teléfono utilizable no hay con qué comparar, y el nombre no vale.
  if meu_email is null and meu_tel9 is null then
    return;
  end if;

  return query
  with fitxes as (
    select p.organizacion_id as org,
           nullif(lower(trim(p.email)), '') as email,
           case when length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) end as tel9
      from productores p
     where not (p_tipo = 'productor' and p.id = p_ficha)
    union all
    select e.organizacion_id,
           nullif(lower(trim(e.email)), ''),
           case when length(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g'), 9) end
      from entidades e
     where not (p_tipo = 'entidad' and e.id = p_ficha)
  ),
  coincidents as (
    select f.org,
           bool_or(meu_email is not null and f.email = meu_email) as per_email,
           bool_or(meu_tel9  is not null and f.tel9  = meu_tel9)  as per_tel
      from fitxes f
     where f.org <> meva_org
       and ((meu_email is not null and f.email = meu_email)
         or (meu_tel9  is not null and f.tel9  = meu_tel9))
     group by f.org
  )
  select v.id, v.nombre, v.nif, v.email, v.telefono, v.poblacion,
         v.es_generadora, v.es_receptora,
         case when c.per_email and c.per_tel then 'email_i_telefon'
              when c.per_email                then 'email'
              else                                 'telefon' end,
         -- ⚠️ Si la candidata YA tiene ficha de este tipo, esto no es un papel nuevo: es un
         -- duplicado, y el índice único lo rechazaría. Se devuelve igual, marcado, para que
         -- el equipo lo vea en vez de preguntarse por qué no sale nada.
         case when p_tipo = 'productor' then v.productor_id is null
              else                           v.entidad_id  is null end
    from coincidents c
    join v_organizaciones v on v.id = c.org
   order by (case when c.per_email and c.per_tel then 0
                  when c.per_email               then 1
                  else                                2 end), v.nombre;
end;
$$;

revoke execute on function public.organitzacions_candidates(text, uuid) from public, anon;
grant  execute on function public.organitzacions_candidates(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enlazar (o separar): mover la ficha de una organización a otra
-- ---------------------------------------------------------------------------
-- `p_organitzacio` NULL significa **separar**: la ficha estrena organización propia. Es el
-- deshacer, y existe porque sin él la fusión no tendría vuelta atrás —la organización de
-- origen se borra al quedarse vacía, y no hay ninguna otra forma de crear una—. No lleva
-- `default`: separar por descuido al olvidar un argumento sería justo el accidente que evita.
create or replace function public.enllacar_organitzacio(
  p_tipo         text,
  p_ficha        uuid,
  p_organitzacio uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  origen   uuid;
  desti    uuid;
  convenis int := 0;
  buidada  boolean := false;
  xoc      text;
begin
  if p_tipo not in ('productor', 'entidad') then
    raise exception 'tipus desconegut: %', p_tipo using errcode = '22023';
  end if;

  if auth.uid() is not null and not (select public.pot_aprovar()) then
    raise exception 'Nomes qui pot aprovar pot enllacar organitzacions' using errcode = '42501';
  end if;

  -- Se bloquea la ficha, no la organización: es la fila que cambia de dueño, y dos enlaces
  -- simultáneos de la misma ficha se serializan aquí.
  if p_tipo = 'productor' then
    select p.organizacion_id into origen from productores p where p.id = p_ficha for update;
  else
    select e.organizacion_id into origen from entidades e where e.id = p_ficha for update;
  end if;
  if origen is null then
    raise exception 'la fitxa % no existeix', p_ficha using errcode = '22023';
  end if;

  if p_organitzacio is null then
    insert into organizaciones (creada_por) values (auth.uid()) returning id into desti;
  else
    select o.id into desti from organizaciones o where o.id = p_organitzacio for update;
    if desti is null then
      raise exception 'l''organitzacio % no existeix', p_organitzacio using errcode = '22023';
    end if;
  end if;

  if desti = origen then
    raise exception 'la fitxa ja es d''aquesta organitzacio' using errcode = '22023';
  end if;

  -- Una organización tiene como mucho UNA ficha de cada tipo (`20270310100000`). Se comprueba
  -- aquí para dar el motivo en vez de dejar salir un `23505` con el nombre de un índice.
  if p_tipo = 'productor' and exists (select 1 from productores p where p.organizacion_id = desti) then
    raise exception 'aquesta organitzacio ja te fitxa de productor: aixo seria un duplicat, no un paper nou'
      using errcode = '22023';
  end if;
  if p_tipo = 'entidad' and exists (select 1 from entidades e where e.organizacion_id = desti) then
    raise exception 'aquesta organitzacio ja te fitxa d''entitat: aixo seria un duplicat, no un paper nou'
      using errcode = '22023';
  end if;

  -- Y como mucho un convenio vigente de cada tipo por organización (`20270312100000`). Si las
  -- dos traen el mismo, no lo decide esta función: hay que resolver uno antes, que es un acto
  -- con su propia RPC y su rastro.
  select string_agg(distinct c.tipo, ', ') into xoc
    from convenios c
   where c.estado = 'vigent'
     and ((p_tipo = 'productor' and c.productor_id = p_ficha)
       or (p_tipo = 'entidad'   and c.entidad_id  = p_ficha))
     and exists (select 1 from convenios d
                  where d.organizacion_id = desti and d.tipo = c.tipo and d.estado = 'vigent');
  if xoc is not null then
    raise exception 'les dues organitzacions tenen conveni vigent del mateix tipus (%): cal resoldre''n un abans', xoc
      using errcode = '22023';
  end if;

  -- Los convenios DE ESTA FICHA, no los de la organización: si el origen tuviera además la
  -- otra ficha, los suyos se quedan donde están.
  update convenios c
     set organizacion_id = desti
   where (p_tipo = 'productor' and c.productor_id = p_ficha)
      or (p_tipo = 'entidad'   and c.entidad_id  = p_ficha);
  get diagnostics convenis = row_count;

  if p_tipo = 'productor' then
    update productores set organizacion_id = desti where id = p_ficha;
  else
    update entidades   set organizacion_id = desti where id = p_ficha;
  end if;

  -- La organización que se queda sin nada se retira, pero no se tira lo que llevara encima:
  -- una preferencia de canal o una nota del equipo se trasladan si el destino no dice nada.
  -- ⚠️ Si algo siguiera apuntando a ella, la FK lo impediría; por eso se comprueban las tres.
  if not exists (select 1 from productores p where p.organizacion_id = origen)
     and not exists (select 1 from entidades e where e.organizacion_id = origen)
     and not exists (select 1 from convenios c where c.organizacion_id = origen) then
    update organizaciones d
       set canal_preferido = coalesce(d.canal_preferido, o.canal_preferido),
           notas = case when o.notas is null then d.notas
                        when d.notas is null then o.notas
                        else d.notas || E'\n' || o.notas end
      from organizaciones o
     where d.id = desti and o.id = origen;
    delete from organizaciones where id = origen;
    buidada := true;
  end if;

  return jsonb_build_object(
    'organitzacio',         desti,
    'organitzacio_anterior', origen,
    'convenis_moguts',      convenis,
    'organitzacio_buidada', buidada
  );
end;
$$;

revoke execute on function public.enllacar_organitzacio(text, uuid, uuid) from public, anon;
grant  execute on function public.enllacar_organitzacio(text, uuid, uuid) to authenticated, service_role;

comment on function public.enllacar_organitzacio(text, uuid, uuid) is
  'Mueve una ficha a otra organizacion y vacia la que deja atras (con sus convenios). '
  '`p_organitzacio` NULL la separa en una organizacion nueva, que es el deshacer. '
  'Etapa 3 de la brecha 2 (deuda §12.28).';
