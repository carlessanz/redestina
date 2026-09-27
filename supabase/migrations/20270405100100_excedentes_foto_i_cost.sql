-- Dos cosas que decide el productor en SU oferta (27-09-2026):
--
-- 1. `foto_producte`: si la oferta no trae fotos, ¿se enseña la foto del producto del
--    catálogo (20270405100000)? Por defecto sí. Desmarcarla deja el icono genérico: el
--    productor puede preferir no enseñar nada antes que una foto que no es de su lote.
--
-- 2. `coste_kg`: el COSTE POR KILO que declara el productor para esta oferta. El de la
--    pantalla «Productes» (`costes_producto`) pasa a ser solo un VALOR DE REFERENCIA: se le
--    propone al dar de alta la oferta —por el panel y por WhatsApp— y lo mantiene o pone
--    otro. Es lo que valora la donación en el certificado, así que se pregunta en donació.
--    Null = no lo ha dicho, y entonces vale la referencia del producto
--    (`trg_canalizaciones_valoriza`, 20270405100200).
--
--    ⚠️ Columna en la OFERTA y no en la canalización: se declara al publicar, antes de que
--       exista ninguna canalización. La canalización lo COPIA al crearse y lo congela al
--       conciliar, como hasta ahora.

alter table excedentes
  add column if not exists foto_producte boolean not null default true,
  add column if not exists coste_kg numeric;

alter table excedentes drop constraint if exists excedentes_coste_kg_positiu;
alter table excedentes add constraint excedentes_coste_kg_positiu
  check (coste_kg is null or coste_kg > 0);

comment on column excedentes.foto_producte is
  'Sin fotos propias, enseñar la foto del producto del catálogo. False = icono genérico.';
comment on column excedentes.coste_kg is
  'Coste por kilo (€/kg) que declara el productor; null = el de referencia del producto.';

-- `fixar_fotos_oferta` gana el interruptor. Drop + create y no `create or replace`: con un
-- argumento más convivirían las dos firmas, y una llamada de dos argumentos sería ambigua
-- (42725, precedente de `crear_espigolada`).
--
-- ⚠️ Y `p_fotos` null pasa a significar «no tocar las fotos»: cambiar solo la casilla no
--    puede vaciar las fotos. Quien quiera quitarlas todas manda `'{}'`, como antes.
drop function if exists public.fixar_fotos_oferta(uuid, text[]);

create or replace function public.fixar_fotos_oferta(
  p_excedente     uuid,
  p_fotos         text[],
  p_foto_producte boolean default null
)
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
  update excedentes
     set fotos         = coalesce(p_fotos, fotos),
         foto_producte = coalesce(p_foto_producte, foto_producte)
   where id = p_excedente
  returning fotos into v_res;
  return v_res;
end;
$$;

revoke execute on function public.fixar_fotos_oferta(uuid, text[], boolean) from public, anon;
grant execute on function public.fixar_fotos_oferta(uuid, text[], boolean) to authenticated;
