-- `fixar_fotos_oferta()` comprobaba primero si la oferta existía y DESPUÉS el permiso, así
-- que a cualquier cuenta le decía «oferta inexistent» o «no pots» según existiera el id: una
-- forma de averiguar qué ofertas hay. Ahora el permiso va primero, como en el resto de RPC
-- (§4bis): quien no es el equipo ni el productor de esa oferta recibe 42501 exista o no.

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
  if auth.uid() is not null
     and not (public.es_intern() or (v_prod is not null and v_prod in (select public.mis_productores()))) then
    raise exception 'Nomes el productor de l''oferta o l''equip' using errcode = '42501';
  end if;
  if v_prod is null then
    raise exception 'oferta inexistent' using errcode = '22023';
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
