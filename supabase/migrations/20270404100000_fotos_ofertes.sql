-- La FOTO del producto (revisión funcional del 23-09-2026: «es uno de los primeros criterios
-- que utilizará un posible receptor para valorar el excedente»).
--
-- DÓNDE: un bucket PRIVADO propio, `fotos-ofertes`. Nada público: el proyecto sirve datos
-- 100 % autenticados (§2) y una foto de producto puede enseñar una finca identificable.
-- Se leen con URLs firmadas (`createSignedUrls`), y lo que autoriza la firma son las
-- políticas de abajo.
--
-- ⚠️ ES LA PRIMERA VEZ QUE `storage.objects` TIENE POLÍTICAS, y es a propósito: los buckets
--    del circuito documental (`documentos`, `activos`) siguen SIN NINGUNA —se leen por la
--    Edge Function `descargar-documento`, §4—, porque un documento legal necesita la lógica de
--    `puede_ver_documento()`. Una foto de producto no: se ve si se ve la oferta, y eso ya lo
--    dice la RLS de `excedentes`. Las tres políticas solo tocan `bucket_id = 'fotos-ofertes'`.
--
-- QUIÉN:
--   · Sube: el productor, SOLO en su carpeta (`<productor_id>/…`), y el equipo (alta asistida).
--   · Ve: el equipo; el productor, las de su carpeta; y cualquiera que pueda ver una oferta
--     que la cite en `excedentes.fotos` — o sea, el receptor, las de las ofertas de su Mercat.
--     El `exists` sobre `excedentes` se evalúa con la RLS de quien pregunta: esa es la regla.
--   · Borra: el productor en su carpeta y el equipo (quitar una foto antes de publicar).
--
-- ⚠️ La foto llega YA SIN EXIF: el navegador la recomprime (`src/lib/fotos.ts`), y eso borra
--    los metadatos — incluida la posición GPS, que identificaría la finca (D3).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-ofertes', 'fotos-ofertes', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

alter table excedentes
  add column if not exists fotos text[] not null default '{}';

alter table excedentes drop constraint if exists excedentes_fotos_max;
alter table excedentes add constraint excedentes_fotos_max check (cardinality(fotos) <= 3);

comment on column excedentes.fotos is
  'Rutas en el bucket fotos-ofertes (<productor_id>/<uuid>.jpg), como mucho 3; la primera es la principal.';

drop policy if exists "fotos-ofertes: pujar" on storage.objects;
create policy "fotos-ofertes: pujar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fotos-ofertes'
    and (
      (select public.es_intern())
      or (storage.foldername(name))[1] in (select p::text from public.mis_productores() p)
    )
  );

drop policy if exists "fotos-ofertes: veure" on storage.objects;
create policy "fotos-ofertes: veure" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fotos-ofertes'
    and (
      (select public.es_intern())
      or (storage.foldername(name))[1] in (select p::text from public.mis_productores() p)
      or exists (select 1 from public.excedentes e where storage.objects.name = any (e.fotos))
    )
  );

drop policy if exists "fotos-ofertes: esborrar" on storage.objects;
create policy "fotos-ofertes: esborrar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fotos-ofertes'
    and (
      (select public.es_intern())
      or (storage.foldername(name))[1] in (select p::text from public.mis_productores() p)
    )
  );

-- Cambiar las fotos de una oferta YA PUBLICADA. El productor no tiene UPDATE sobre
-- `excedentes` (solo el equipo), así que va por RPC: el dueño de la oferta o el equipo, y
-- solo rutas de la carpeta de ESE productor (una oferta no puede citar la foto de otro).
create or replace function public.fixar_fotos_oferta(p_excedente uuid, p_fotos text[])
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod uuid;
  v_f text;
  v_res text[];
begin
  select productor_id into v_prod from excedentes where id = p_excedente;
  if v_prod is null then
    raise exception 'oferta inexistent' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not (public.es_intern() or v_prod in (select public.mis_productores())) then
    raise exception 'Nomes el productor de l''oferta o l''equip' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_fotos, '{}')) > 3 then
    raise exception 'massa_fotos' using errcode = '22023';
  end if;
  foreach v_f in array coalesce(p_fotos, '{}') loop
    if split_part(v_f, '/', 1) <> v_prod::text then
      raise exception 'foto_aliena' using errcode = '22023';
    end if;
  end loop;
  update excedentes set fotos = coalesce(p_fotos, '{}') where id = p_excedente
  returning fotos into v_res;
  return v_res;
end;
$$;

revoke execute on function public.fixar_fotos_oferta(uuid, text[]) from public, anon;
grant execute on function public.fixar_fotos_oferta(uuid, text[]) to authenticated;
