-- `actualizar_meu_canal` tenía el GRANT de `service_role` y no lo podía usar.
--
-- Es la trampa que §4bis ya describe y que aun así se volvió a colar: **`auth.uid() is null`
-- significa `service_role`**, así que una guarda escrita como `soc_titular(...) or es_intern()`
-- lo deja fuera en silencio —`mi_rol()` devuelve null sin sesión— y la función responde
-- `42501` a quien la plataforma considera el rol más privilegiado que existe.
--
-- Se vio al verificar el despliegue, llamándola con la service key: el GRANT decía una cosa y
-- la función hacía otra. Un GRANT que no sirve para nada es peor que no tenerlo, porque el día
-- que una Edge Function la llame el fallo parecerá de permisos de datos y no lo será.
--
-- No abre nada: `service_role` tiene `BYPASSRLS` y puede escribir `organizaciones` con un
-- `update` directo. Lo único que cambia es que ahora puede hacerlo por el mismo camino que
-- todos, que es donde viven las comprobaciones de vocabulario.

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

  if p_canal is not null and p_canal not in ('whatsapp', 'email') then
    raise exception 'canal desconegut: %', p_canal using errcode = '22023';
  end if;

  -- El rol se comprueba solo cuando hay sesión de usuario. Mismo patrón que las RPC
  -- documentales y que `trg_membresias_control_aprovacio` (§4bis).
  if auth.uid() is not null
     and not (public.soc_titular(p_tipo, p_ficha) or (select public.es_intern())) then
    raise exception 'Nomes el titular pot editar les dades' using errcode = '42501';
  end if;

  o_id := public.organizacion_de(p_tipo, p_ficha);

  if o_id is null then
    raise exception 'la fitxa % no te organitzacio', p_ficha using errcode = '22023';
  end if;

  update organizaciones
     set canal_preferido = p_canal
   where id = o_id
  returning * into o;

  return o;
end;
$$;

revoke execute on function public.actualizar_meu_canal(text, uuid, text) from public, anon;
grant  execute on function public.actualizar_meu_canal(text, uuid, text) to authenticated, service_role;
