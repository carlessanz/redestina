-- «Tipus d'operació» de una oferta (procesos 3.6, 3.5 C y 3.4 del cliente; fase 3 del plan de
-- noviembre de 2026).
--
-- «Una espigolada és una operació de donació i s'ha de gestionar amb les mateixes eines i el
-- mateix circuit que qualsevol altra oferta de donació. La diferència és el tipus d'operació
-- d'origen.» Así que la espigolada deja de ser un módulo aparte (tabla `espigoladas`, lotes,
-- REC de jornada) y pasa a ser una CLASIFICACIÓN de la oferta:
--
--   · `excedent`   — excedente ya cosechado (lo de siempre);
--   · `espigolada` — el producto sigue en el campo y lo cosecha una jornada de voluntarios.
--
-- La columna es GENERADA (nadie la escribe): sale de `espigolada_demanada` (la marca que pone el
-- alta o la edición, 20270614100000) y, para lo heredado, de `espigolada_id` (las ofertas que
-- nacieron o se convirtieron en una jornada del modelo anterior, que se quedan dormidas). Es la
-- que filtran Ofertes y Entrades i sortides (fase 4).
--
-- Y una regla que la acompaña: una oferta marcada como espigolada es una DONACIÓN con el producto
-- en el campo. Lo dice el check `excedentes_espigolada_donacio` (fuera del esborrany, que se guarda
-- a medias). `crear-oferta` ya la inserta así (`filaDeDades`); `editar_oferta` (20270617100300) la
-- fuerza al marcarla y rechaza con `22023 espigolada_no_donacio` lo que la rompería.
--
-- GRANT: `excedentes` tiene SELECT de TABLA para `authenticated` (no por columnas), así que la
-- columna nueva se lee sin tocar nada. La RLS de lectura no la mira: el Mercat sigue igual (una
-- espigolada en `{donacio}` publicada sale a quien recibe donaciones, como cualquier donación).

alter table public.excedentes
  add column if not exists tipus_operacio text
  generated always as (
    case when espigolada_demanada or espigolada_id is not null then 'espigolada' else 'excedent' end
  ) stored;

comment on column public.excedentes.tipus_operacio is
  'Tipus d''operació (20270617100000): ''espigolada'' si se pidió espigolada (espigolada_demanada) '
  'o viene de una jornada heredada (espigolada_id); si no, ''excedent''. Generada: nadie la escribe.';

-- El comentario de 20270614100000 hablaba de convertirla con `crear_espigolada()`: ya no.
comment on column public.excedentes.espigolada_demanada is
  'La oferta es una espigolada (20270614100000; desde 20270617100000, una DONACIÓN con el producto '
  'en el campo: check excedentes_espigolada_donacio). Con origen panel/intake va siempre a validación. '
  'De ella sale tipus_operacio.';

create index if not exists excedentes_tipus_operacio_idx
  on public.excedentes (tipus_operacio, estado);

-- La espigolada es una donación con el producto en el campo. `not valid` primero y se valida solo
-- si ninguna fila la incumple (en el clon y en producción, a 25-11-2026, todas la cumplen: las
-- ofertas con la marca nacieron con `filaDeDades`, que ya fija donación y campo). Si alguna la
-- incumpliera, el check se queda `not valid` (protege lo nuevo) y se avisa: se corrige a mano.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.excedentes'::regclass
                    and conname = 'excedentes_espigolada_donacio') then
    alter table public.excedentes
      add constraint excedentes_espigolada_donacio
      check (not espigolada_demanada
             or estado = 'esborrany'
             or (modalitat is not distinct from 'donacio'
                 and modalitats is not distinct from array['donacio']::text[]
                 and coalesce(producte_al_camp, false)))
      not valid;
  end if;
end;
$$;

do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from public.excedentes
   where espigolada_demanada
     and estado <> 'esborrany'
     and not (modalitat = 'donacio'
              and modalitats is not distinct from array['donacio']::text[]
              and coalesce(producte_al_camp, false));
  if v_n = 0 then
    alter table public.excedentes validate constraint excedentes_espigolada_donacio;
  else
    raise notice 'excedentes_espigolada_donacio queda NOT VALID: % ofertes amb espigolada_demanada no son donacio al camp', v_n;
  end if;
end;
$$;
