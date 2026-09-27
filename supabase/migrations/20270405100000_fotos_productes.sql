-- La FOTO DEL PRODUCTO del catálogo (27-09-2026): una por producto, que gestiona el
-- super_admin desde la pantalla «Productes» (antes «Costos per quilo») y que hace de
-- RESPALDO cuando una oferta no trae fotos propias (`excedentes.foto_producte`,
-- 20270405100100).
--
-- DÓNDE: un bucket PROPIO, `fotos-productes`, separado de `fotos-ofertes` a propósito. Las
-- de oferta son del productor —se ven si se ve la oferta, y pueden enseñar su finca—; estas
-- son del catálogo, sin dueño, y las ve cualquiera con sesión. Mezclarlas obligaría a que
-- una política decidiera por la carpeta qué regla aplicar, que es justo el tipo de política
-- que un día alguien simplifica y abre de más.
--
-- ⚠️ PRIVADO igualmente, como todo en este proyecto (§2): nada se sirve sin sesión. Se lee
--    con URL firmada (`createSignedUrls`), igual que las de oferta.
--
-- DOS ficheros por producto: la foto GRANDE (1000×750, 4:3, la del detalle y la del Mercat)
-- y la MINIATURA (240×240, la de las listas). Una sola foto obligaría a bajar 100 KB para
-- pintar un cuadrado de 40 px, noventa veces seguidas en la lista del catálogo.
--
-- QUIÉN:
--   · Ve: cualquier `authenticated` — el receptor la necesita en el Mercat como respaldo.
--   · Sube y borra: SOLO el super_admin (decisión del 27-09-2026). Sin UPDATE: una foto no se
--     sobrescribe, se sube otra con otro nombre y se retira la vieja.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-productes', 'fotos-productes', false, 2097152,
        array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

alter table productos
  add column if not exists foto        text,
  add column if not exists foto_mini   text,
  add column if not exists foto_credit jsonb;

comment on column productos.foto is
  'Ruta de la foto grande (1000x750) en el bucket fotos-productes. Null = icono genérico.';
comment on column productos.foto_mini is
  'Ruta de la miniatura (240x240) en fotos-productes. Va siempre con `foto`.';
comment on column productos.foto_credit is
  'Procedencia de la foto: {autor, llicencia, font_url, titol}. Aunque sea CC0 se guarda.';

-- Las dos rutas van juntas o ninguna: una miniatura sin foto grande pintaría una cosa en la
-- lista y otra (el icono) en el detalle.
alter table productos drop constraint if exists productos_foto_parella;
alter table productos add constraint productos_foto_parella
  check ((foto is null) = (foto_mini is null));

drop policy if exists "fotos-productes: veure" on storage.objects;
create policy "fotos-productes: veure" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos-productes');

drop policy if exists "fotos-productes: pujar" on storage.objects;
create policy "fotos-productes: pujar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-productes' and (select public.es_super_admin()));

drop policy if exists "fotos-productes: esborrar" on storage.objects;
create policy "fotos-productes: esborrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-productes' and (select public.es_super_admin()));

-- Fijar (o quitar, con las dos rutas a null) la foto de un producto. `authenticated` no
-- tiene UPDATE sobre `productos`, así que es la única puerta.
--
-- ⚠️ El permiso va ANTES que la existencia (lección de 20270404100100): si no, la respuesta
--    diría a cualquiera qué productos hay. Aquí el catálogo ya lo puede leer todo el mundo,
--    pero la regla se mantiene para que no haya dos maneras de escribir una guarda.
--
-- Devuelve las rutas ANTERIORES: los ficheros viejos los retira el cliente, porque SQL no
-- puede borrar objetos de Storage (el mismo reparto que `borrar_ficha_completa()`).
create or replace function public.fixar_foto_producte(
  p_producto  text,
  p_foto      text,
  p_foto_mini text,
  p_credit    jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ant productos%rowtype;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin gestiona les fotos dels productes' using errcode = '42501';
  end if;
  select * into v_ant from productos where nombre = p_producto for update;
  if v_ant.nombre is null then
    raise exception 'producte_inexistent' using errcode = '22023';
  end if;
  if (p_foto is null) <> (p_foto_mini is null) then
    raise exception 'foto_sense_miniatura' using errcode = '22023';
  end if;
  update productos
     set foto        = p_foto,
         foto_mini   = p_foto_mini,
         foto_credit = case when p_foto is null then null else p_credit end
   where nombre = p_producto;
  return jsonb_build_object('foto', v_ant.foto, 'foto_mini', v_ant.foto_mini);
end;
$$;

revoke execute on function public.fixar_foto_producte(text, text, text, jsonb) from public, anon;
grant execute on function public.fixar_foto_producte(text, text, text, jsonb) to authenticated;
