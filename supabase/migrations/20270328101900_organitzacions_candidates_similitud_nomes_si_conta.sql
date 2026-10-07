-- Corrige un fallo de la migración anterior (organitzacions_candidates_nif_i_nom, aplicada
-- minutos antes, todavía sin commitear): `similitud` viajaba siempre que había algún nombre
-- con el que comparar, aunque no cruzara el umbral —probado con una ficha de prueba: un
-- candidato que solo coincidía por NIF salía con `similitud: 0.03`, un número que no informa de
-- nada y que confundiría más que ayudaría—. La intención escrita en la cabecera del fichero ya
-- decía «solo lleva valor cuando nom_semblant está entre los motivos»; el cuerpo no lo hacía.
-- No cambia el `returns table` (sigue `numeric`), así que `create or replace` basta.

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
  motius        text[],
  similitud     numeric,
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
  meu_nif   text;
  meu_nom   text;
  meva_org  uuid;
  llindar_nom constant numeric := 0.65;
begin
  if p_tipo not in ('productor', 'entidad') then
    raise exception 'tipus desconegut: %', p_tipo using errcode = '22023';
  end if;

  if auth.uid() is not null and not (select public.es_intern()) then
    raise exception 'Nomes l''equip pot veure les organitzacions candidates' using errcode = '42501';
  end if;

  if p_tipo = 'productor' then
    select nullif(lower(trim(p.email)), ''),
           case when length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) end,
           nullif(upper(regexp_replace(coalesce(p.nif, ''), '\s', '', 'g')), ''),
           nullif(lower(unaccent(trim(coalesce(nullif(p.empresa, ''), p.name)))), ''),
           p.organizacion_id
      into meu_email, meu_tel9, meu_nif, meu_nom, meva_org
      from productores p where p.id = p_ficha;
  else
    select nullif(lower(trim(e.email)), ''),
           case when length(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g'), 9) end,
           nullif(upper(regexp_replace(coalesce(e.nif, ''), '\s', '', 'g')), ''),
           nullif(lower(unaccent(trim(e.nombre))), ''),
           e.organizacion_id
      into meu_email, meu_tel9, meu_nif, meu_nom, meva_org
      from entidades e where e.id = p_ficha;
  end if;

  if meva_org is null then
    raise exception 'la fitxa % no existeix', p_ficha using errcode = '22023';
  end if;

  if meu_email is null and meu_tel9 is null and meu_nif is null and meu_nom is null then
    return;
  end if;

  return query
  with fitxes as (
    select p.organizacion_id as org,
           nullif(lower(trim(p.email)), '') as email,
           case when length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) end as tel9,
           nullif(upper(regexp_replace(coalesce(p.nif, ''), '\s', '', 'g')), '') as nif,
           nullif(lower(unaccent(trim(coalesce(nullif(p.empresa, ''), p.name)))), '') as nom
      from productores p
     where not (p_tipo = 'productor' and p.id = p_ficha)
    union all
    select e.organizacion_id,
           nullif(lower(trim(e.email)), ''),
           case when length(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g'), 9) end,
           nullif(upper(regexp_replace(coalesce(e.nif, ''), '\s', '', 'g')), ''),
           nullif(lower(unaccent(trim(e.nombre))), '')
      from entidades e
     where not (p_tipo = 'entidad' and e.id = p_ficha)
  ),
  coincidents as (
    select f.org,
           bool_or(meu_email is not null and f.email = meu_email) as per_email,
           bool_or(meu_tel9  is not null and f.tel9  = meu_tel9)  as per_tel,
           bool_or(meu_nif   is not null and f.nif   = meu_nif)   as per_nif,
           max(case when meu_nom is not null and f.nom is not null
                    then similarity(meu_nom, f.nom) end) as sim_nom
      from fitxes f
     where f.org <> meva_org
       and ((meu_email is not null and f.email = meu_email)
         or (meu_tel9  is not null and f.tel9  = meu_tel9)
         or (meu_nif   is not null and f.nif   = meu_nif)
         or (meu_nom   is not null and f.nom   is not null
             and similarity(meu_nom, f.nom) >= llindar_nom))
     group by f.org
  )
  select v.id, v.nombre, v.nif, v.email, v.telefono, v.poblacion,
         v.es_generadora, v.es_receptora,
         array_remove(array[
           case when c.per_email then 'email' end,
           case when c.per_tel   then 'telefon' end,
           case when c.per_nif   then 'nif' end,
           case when c.sim_nom is not null and c.sim_nom >= llindar_nom then 'nom_semblant' end
         ], null),
         -- Solo lleva valor cuando el nombre cuenta de verdad (cruza el umbral): mostrar «3 %»
         -- de un candidato que solo coincidió por NIF confundiría más de lo que informa.
         case when c.sim_nom is not null and c.sim_nom >= llindar_nom
              then round(c.sim_nom::numeric, 2) end,
         case when p_tipo = 'productor' then v.productor_id is null
              else                           v.entidad_id  is null end
    from coincidents c
    join v_organizaciones v on v.id = c.org
   order by (c.per_email::int + c.per_tel::int + c.per_nif::int) desc,
             coalesce(c.sim_nom, 0) desc,
             v.nombre;
end;
$$;

comment on function public.organitzacions_candidates(text, uuid) is
  'Organizaciones que podrían ser la misma que esta ficha: correo, teléfono o NIF exactos, o '
  'nombre con similitud >= 0.65 (umbral medido, ver cabecera de la migración anterior). Nunca '
  'fusiona sola: solo sugiere, para que el equipo decida con enllacar_organitzacio(). '
  'D3 del plan de organización unificada, 22-09-2026.';
