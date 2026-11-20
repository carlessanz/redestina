-- «Espigolada» como opción del alta de oferta (20-11-2026, petición de Carles).
--
-- Junto a donación, venta y maquila, el alta del panel ofrece «Espigolada»: el producto sigue en
-- el campo y lo cosecha una jornada de voluntarios. No es una MODALIDAD (no entra en
-- `modalitat`/`modalitats` ni en `modalitat_receptor_compat`): una espigolada se reparte
-- después, en donación, con `repartir_espigolada()`. Es una petición de DESTINO, y se guarda
-- aparte:
--
--   · Si la crea el EQUIPO (alta asistida), `crear-oferta` la convierte en el acto con
--     `crear_espigolada(p_excedente => …)`: la oferta pasa a `borrador`/`espigolament` y la
--     jornada nace `oberta`, pendiente de espigolar. La marca queda como rastro.
--   · Si la crea la PRODUCTORA, la oferta queda con la marca y **nunca sale al Mercat sola**:
--     va a validación aunque `validacio_ofertes` esté apagada, y el equipo la convierte con
--     «Converteix en espigolada» (o la valida y publica, si decide otra cosa).
--
-- `producte_al_camp` acompaña siempre a la marca (lo fija `crear-oferta`): es la condición de
-- `crear_espigolada()` para convertir.

alter table public.excedentes
  add column if not exists espigolada_demanada boolean not null default false;

comment on column public.excedentes.espigolada_demanada is
  'Quien dio de alta la oferta eligió «Espigolada» (20270614100000). Con origen panel/intake la oferta va siempre a validación; el equipo la convierte con crear_espigolada().';

-- La validación: igual que antes, y además siempre que se pida una espigolada.
create or replace function public.trg_excedentes_validacio()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.estado = 'publicada'
     and (tg_op = 'INSERT' or old.estado = 'esborrany')
     and coalesce(new.origen, 'intake') in ('intake', 'panel')
     and (public.validacio_ofertes_activa() or coalesce(new.espigolada_demanada, false)) then
    new.estado := 'pendent_validacio';
  end if;
  return new;
end;
$function$;
