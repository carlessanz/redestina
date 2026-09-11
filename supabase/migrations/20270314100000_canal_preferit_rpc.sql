-- Escribir el canal preferido de la organización: la RPC que falta para que §12.22 sea usable.
--
-- `20270310100000` creó la columna `organizaciones.canal_preferido` y **ninguna forma de
-- escribirla**: la tabla no tiene GRANT de INSERT ni de UPDATE para nadie, como el resto del
-- circuito documental. Eso es deliberado —la superficie de escritura son las RPC `security
-- definer`— pero deja el campo muerto hasta que exista su RPC. Esta es.
--
-- POR QUÉ NO ES UNA COLUMNA MÁS DE `actualizar_mi_productor`. Porque **no es de la ficha**: una
-- organización con ficha de productor y de entidad tiene UN canal preferido, no uno por papel.
-- Meterlo en las dos RPC de ficha crearía dos escrituras que pueden discrepar sobre el mismo
-- dato, que es exactamente lo que la tabla `organizaciones` existe para evitar.
--
-- ⚠️ **Aquí SÍ pasa el equipo, y en `actualizar_mi_productor` no.** No es una inconsistencia:
--    sobre `productores` y `entidades` el equipo tiene GRANT de UPDATE y edita desde la ficha
--    (`RecordDetail`), así que no necesita la RPC. Sobre `organizaciones` **no tiene ninguno**,
--    así que sin esta salida no habría forma de fijar el canal en nombre de nadie — y el modelo
--    es asistido (§1bis): el equipo opera por las organizaciones que llaman por teléfono.

create or replace function public.actualizar_meu_canal(
  p_tipo  text,
  p_ficha uuid,
  p_canal text default null
)
returns organizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o_id uuid;
  o    organizaciones;
begin
  if p_tipo not in ('productor', 'entidad') then
    raise exception 'tipus desconegut: %', p_tipo using errcode = '22023';
  end if;

  -- El vocabulario lo impone el `check` de la columna, pero fallar aquí da un mensaje que se
  -- puede enseñar en vez de un `23514` con el nombre de la restricción.
  if p_canal is not null and p_canal not in ('whatsapp', 'email') then
    raise exception 'canal desconegut: %', p_canal using errcode = '22023';
  end if;

  if not (public.soc_titular(p_tipo, p_ficha) or (select public.es_intern())) then
    raise exception 'Nomes el titular pot editar les dades' using errcode = '42501';
  end if;

  o_id := public.organizacion_de(p_tipo, p_ficha);

  -- ⚠️ No puede ser null desde `20270313100000` (trigger + `not null`), y aun así se comprueba:
  -- si algún día alguien desactiva el trigger o restaura una tabla a medias, el fallo tiene que
  -- salir aquí y no como un `update` de cero filas que devuelve éxito.
  if o_id is null then
    raise exception 'la fitxa % no te organitzacio', p_ficha using errcode = '22023';
  end if;

  update organizaciones
     set canal_preferido = p_canal          -- null = volver a deducirlo (`_shared/canal.ts`)
   where id = o_id
  returning * into o;

  return o;
end;
$$;

revoke execute on function public.actualizar_meu_canal(text, uuid, text) from public, anon;
grant  execute on function public.actualizar_meu_canal(text, uuid, text) to authenticated, service_role;

comment on function public.actualizar_meu_canal(text, uuid, text) is
  'Fija `organizaciones.canal_preferido` desde el panel. Es la unica escritura de esa tabla: no '
  'tiene GRANT de UPDATE para nadie. `p_canal` null significa volver a deducir el canal con la '
  'politica de `_shared/canal.ts` (deuda §12.22).';
