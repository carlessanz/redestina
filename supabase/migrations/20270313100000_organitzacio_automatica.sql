-- Que cada ficha nueva tenga organización, sin que nadie se acuerde.
--
-- EL FALLO QUE ESTO ARREGLA, y es de la propia etapa 1. `20270310100000` rellenó
-- `organizacion_id` en las 464 fichas que había **en ese momento** y ahí se acabó: era una
-- operación de una sola vez. Cualquier ficha creada después —un alta desde `/registre`, una
-- que cree el equipo desde el panel, el fixture de pruebas— nacía **sin organización**.
--
-- Se detectó a los pocos minutos y por casualidad, al cambiar la clave de `convenios`: dos
-- convenios se quedaban sin `organizacion_id` porque sus fichas tampoco la tenían. En
-- producción habría pasado igual con el primer registro público, y **sin dar ningún error**:
-- la columna es nullable, así que la ficha se crea, funciona, y simplemente no pertenece a
-- ninguna organización. El síntoma habría aparecido semanas después, cuando algo preguntara
-- por su organización y no hubiera ninguna.
--
-- Es la diferencia entre migrar los datos y mantener la invariante. Un `update` de relleno
-- hace lo primero; hace falta un trigger para lo segundo.

create or replace function trg_ficha_estrena_organizacion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o uuid;
begin
  -- Si quien inserta ya dice a qué organización pertenece, se respeta: es el camino del
  -- registro público cuando detecta que la organización ya existe y solo estrena un papel.
  if new.organizacion_id is not null then
    return new;
  end if;
  insert into organizaciones default values returning id into o;
  new.organizacion_id := o;
  return new;
end;
$$;

drop trigger if exists productores_estrena_organizacion on productores;
create trigger productores_estrena_organizacion
  before insert on productores
  for each row execute function trg_ficha_estrena_organizacion();

drop trigger if exists entidades_estrena_organizacion on entidades;
create trigger entidades_estrena_organizacion
  before insert on entidades
  for each row execute function trg_ficha_estrena_organizacion();

-- ---------------------------------------------------------------------------
-- Y se repone lo que se quedó por el camino
-- ---------------------------------------------------------------------------
-- Idempotente, igual que el relleno original: solo toca lo que está a null. En producción
-- esto no encontrará nada (el trigger no existía, pero tampoco se ha creado ninguna ficha
-- desde la etapa 1); en local recoge las que crearon los fixtures entre una cosa y otra.
do $$
declare f record; o uuid; n int := 0;
begin
  for f in select id from productores where organizacion_id is null loop
    insert into organizaciones default values returning id into o;
    update productores set organizacion_id = o where id = f.id;
    n := n + 1;
  end loop;
  for f in select id from entidades where organizacion_id is null loop
    insert into organizaciones default values returning id into o;
    update entidades set organizacion_id = o where id = f.id;
    n := n + 1;
  end loop;
  if n > 0 then raise notice 'organizaciones repuestas: %', n; end if;
end $$;

-- Y los convenios que se quedaron sin ella por lo mismo.
update convenios c
   set organizacion_id = coalesce(
         (select p.organizacion_id from productores p where p.id = c.productor_id),
         (select e.organizacion_id from entidades   e where e.id = c.entidad_id))
 where c.organizacion_id is null;

-- ⚠️ Y ahora que no puede haber fichas sin organización, la columna deja de admitir nulos.
-- Esto es lo que convierte «se rellena» en «no puede faltar»: sin el `not null`, el día que
-- alguien inserte saltándose el trigger —un `alter table … disable trigger`, una restauración
-- parcial— el agujero vuelve en silencio. Con él, falla en el sitio y en el momento.
alter table productores alter column organizacion_id set not null;
alter table entidades   alter column organizacion_id set not null;
