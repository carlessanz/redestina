-- Borrar un coste por kilo deja rastro, como cambiarlo.
--
-- EL HUECO. `costes_producto_hist` guarda lo que se **sobrescribe** (el trigger
-- `costes_producto_hist` de 20261012100000), y `fijar_coste_producto` exige motivo. Pero
-- `borrar_coste_producto(text,int)` no recibía ninguno y el `delete` no dispara ese
-- trigger, así que la cifra que había desaparecía sin que quedara ni el valor ni quién ni
-- por qué — y es la operación **más** grave de las dos: sobrescribir deja el anterior en
-- el histórico; borrar, hasta ahora, no dejaba nada. La interfaz ya pedía el motivo en su
-- diálogo y lo único que hacía con él era escribirlo en la consola del navegador.
--
-- LA FIRMA CAMBIA. Se sustituye `borrar_coste_producto(text,int)` por
-- `borrar_coste_producto(text,int,text)`. Se **borra la anterior** en vez de dejar las dos
-- conviviendo: PostgREST resuelve por nombres de parámetro, y dos sobrecargas cuyo juego
-- de nombres es un subconjunto del otro dan `PGRST203` (ambigüedad) en la llamada de dos
-- argumentos. El motivo es obligatorio de hecho —no basta con que exista el parámetro—
-- por el mismo criterio que `costes_producto.motivo`: una cifra fiscal sin procedencia no
-- es defendible, y su desaparición tampoco.
--
-- SE REGISTRA COMO UN CAMBIO MÁS, con `vigente_hasta = now()`: la fila del histórico dice
-- qué valor estuvo vigente, desde cuándo y hasta cuándo, y el motivo lleva el prefijo
-- `[esborrat]` para poder distinguir en una sola lectura una sobrescritura de una
-- desaparición. No se añade ninguna columna: una tabla de histórico que crece una columna
-- por cada matiz acaba sin poder leerse.

drop function if exists public.borrar_coste_producto(text, int);

create or replace function public.borrar_coste_producto(
  p_producto  text,
  p_ejercicio int,
  p_motivo    text default null
) returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c costes_producto%rowtype;
  n int;
begin
  -- `es_super_admin()`, no `pot_aprovar()`: borrar una referencia económica es más grave
  -- que fijarla (20261012100000).
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin pot esborrar un cost per quilo' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Cal indicar per que s''esborra el cost per quilo (motiu)' using errcode = '22023';
  end if;

  select * into c from costes_producto
   where producto = p_producto and ejercicio = p_ejercicio
   for update;
  if c.producto is null then
    return 0;   -- Nada que borrar y nada que historiar: no es un error.
  end if;

  insert into costes_producto_hist (producto, ejercicio, coste_kg, motivo, fijado_por,
                                    vigente_desde, vigente_hasta)
  values (c.producto, c.ejercicio, c.coste_kg,
          '[esborrat] ' || btrim(p_motivo) ||
            ' (motiu original: ' || coalesce(c.motivo, '—') || ')',
          coalesce(auth.uid(), c.fijado_por), c.updated_at, now());

  delete from costes_producto where producto = p_producto and ejercicio = p_ejercicio;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.borrar_coste_producto(text, int, text) is
  'Borra un coste por kilo (solo super_admin) dejando la fila en costes_producto_hist con motivo [esborrat].';

revoke execute on function public.borrar_coste_producto(text, int, text) from public, anon;
grant  execute on function public.borrar_coste_producto(text, int, text) to authenticated, service_role;

-- Verificación:
--   select borrar_coste_producto('Tomàquet', 1999, 'exercici equivocat');  -- 1
--   select borrar_coste_producto('Tomàquet', 1999, '');                    -- 22023
--   select * from costes_producto_hist where ejercicio = 1999;             -- la fila [esborrat]
