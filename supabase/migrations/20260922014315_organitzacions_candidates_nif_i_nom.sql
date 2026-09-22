-- D3 del plan de organización unificada (`3. Claude Code/2026-09-22-plan-organizacion-unificada.md`):
-- el NIF exacto y el nombre por similitud alta se suman al correo y al teléfono como señales de
-- que dos fichas son la misma organización.
--
-- ⚠️ EL NOMBRE POR SIMILITUD NO SE HIZO COMO SE PIDIÓ AL PRINCIPIO, Y ES DELIBERADO. Medido
-- contra los nombres reales de hoy (22-09-2026) antes de escribir una sola línea: la similitud
-- por trigramas (`pg_trgm`) no separa bien «organizaciones distintas que comparten palabras
-- genéricas» de «la misma organización escrita distinto» en este idioma —nombres de empresa
-- catalanes/castellanos comparten sufijos legales (SL, SCP), palabras de sector (Cooperativa,
-- Càritas) y, en los datos de prueba, la propia palabra «Prova»—. Con umbral bajo, pares que NO
-- son la misma organización puntuaban IGUAL o MÁS que el único caso real medido:
--
--   Cooperativa Agrícola de Reus  / …de Tarragona     → 0.615  (organizaciones DISTINTAS)
--   Mas de Prova SCP              / Horta de Prova SL → 0.400  (organizaciones DISTINTAS)
--   Carles Sanz Cardelus          / Organització Carles Sanz → 0.387  (el caso real: SÍ es la misma)
--
-- Un aviso con ese comportamiento sería el ruido que `AGENTS.md §4` lleva desde el principio
-- advirtiendo que hay que evitar: «se prefiere dejar dos filas separadas a arriesgar una fusión
-- mala». Por eso el nombre solo cuenta con similitud **≥ 0,65**, que en la misma medición separa
-- limpiamente las variantes de formato de un mismo nombre («Cal Ferrer SL» / «Cal Ferrer, S.L.»,
-- 0,706; «Cooperativa Agrícola de Reus» / «...Agricola Reus», 0,897 —falta el acento y cambia el
-- orden— ) de las organizaciones distintas del rango 0,3–0,5 de arriba.
--
-- ⚠️ EL NIF, EN CAMBIO, SÍ ES UNA SEÑAL FUERTE, y no se usaba en absoluto hasta hoy: dos fichas
-- con el mismo NIF son, salvo error de tecleo, la misma entidad legal —al revés que el nombre, no
-- hace falta ninguna calibración—. Es justo lo que habría detectado el caso real de arriba: las
-- dos fichas de Carles Sanz comparten NIF aunque su nombre no se parezca lo bastante.
--
-- QUÉ CAMBIA EN EL CONTRATO: `motiu text` pasa a `motius text[]` (uno o más de
-- `email`/`telefon`/`nif`/`nom_semblant`), y se añade `similitud numeric`, que solo lleva valor
-- cuando `nom_semblant` está entre los motivos —el resto de señales no se miden en escala, son
-- sí/no—. `create or replace` no puede cambiar `returns table` (mismo caso que `resolver_enlace`,
-- §4bis): hace falta `drop` primero.

drop function if exists public.organitzacions_candidates(text, uuid);

-- `pg_trgm` da `similarity()`; `unaccent` quita los acentos antes de comparar, para que
-- «Múrcia»/«Murcia» o «Agrícola»/«Agricola» no penalicen por algo que no es una discrepancia de
-- fondo. Las dos son de PostgreSQL, no un servicio externo (§7).
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- El umbral se fija aquí, no en cada llamada: es una constante de dominio, no un parámetro que
-- quien llama deba conocer o pueda equivocar.
create function public.organitzacions_candidates(p_tipo text, p_ficha uuid)
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
  -- Umbral de similitud del nombre: ver la cabecera del fichero para la medición que lo fija.
  llindar_nom constant numeric := 0.65;
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

  -- Sin ningún dato utilizable no hay con qué comparar.
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
           -- El máximo, no cualquiera: si la organización tiene las dos fichas, se compara con
           -- la que más se parezca, que es la que de verdad importaría al equipo.
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
         -- Un array de motivos, no una frase por combinación: con tres señales fuertes más el
         -- nombre, enumerar cada combinación a mano (`email_i_nif`, `telefon_i_nif`...) habría
         -- sido ocho frases para mantener en vez de cuatro. El frontend une las etiquetas.
         array_remove(array[
           case when c.per_email then 'email' end,
           case when c.per_tel   then 'telefon' end,
           case when c.per_nif   then 'nif' end,
           case when c.sim_nom is not null and c.sim_nom >= llindar_nom then 'nom_semblant' end
         ], null),
         -- Solo lleva valor cuando el nombre cuenta de verdad (cruza el umbral): mostrar «3 %»
         -- de un candidato que solo coincidió por NIF confundiría más de lo que informa. Sin el
         -- `case`, `sim_nom` viaja siempre que hay algún nombre que comparar, cruce o no el
         -- umbral, y `round(numeric, int)` exige el cast desde `real` (`similarity()` no lo da).
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

revoke execute on function public.organitzacions_candidates(text, uuid) from public, anon;
grant  execute on function public.organitzacions_candidates(text, uuid) to authenticated, service_role;

comment on function public.organitzacions_candidates(text, uuid) is
  'Organizaciones que podrían ser la misma que esta ficha: correo, teléfono o NIF exactos, o '
  'nombre con similitud >= 0.65 (umbral medido, ver cabecera de la migración). Nunca fusiona '
  'sola: solo sugiere, para que el equipo decida con enllacar_organitzacio(). '
  'D3 del plan de organización unificada, 22-09-2026.';
