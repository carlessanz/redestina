-- Fase 3 del plan de los puntos 4-6 (cambio C1): un REC POR RECOGIDA de donación — el esquema.
--
-- Hasta aquí el albarán de recepción (REC) era uno por oferta (`excedente_id`, sin
-- `canalizacion_id`) y esperaba a que se validaran TODAS las recogidas. Desde la fase 3 cada
-- canalización de donación tiene su propio REC, que nace en borrador junto con su ENT
-- (20270608100100) y se emite, confirma y concilia al validar ESA recogida (20270608100200).
--
-- Esta migración solo prepara la tabla:
--
--   1. `albaranes_pertenencia_check`: un REC sigue siendo de una oferta O de una espigolada (solo
--      una), y además PUEDE llevar `canalizacion_id`, pero solo si es de una oferta (un REC de
--      espigolada es de la jornada entera). ENT y OPE, como siempre: con canalización.
--   2. `albaranes_rec_excedente_uidx`: un REC por oferta SOLO para los heredados (sin
--      `canalizacion_id`). Y excluye `rectificado` y los rectificativos (`rectifica_a`): con el
--      índice anterior (todo menos `anulado`), `rectificar_albaran()` insertaba el R-REC mientras
--      el original seguía `conciliado` y chocaba con 23505 (riesgo §4.1 del diseño).
--   3. `albaranes_rec_canalizacion_uidx` (nuevo): un REC vivo por canalización, con la misma
--      condición.
--   4. `albaranes_rec_espigolada_uidx`: misma exclusión de `rectificado`/`rectifica_a` (el mismo
--      23505 al rectificar el REC de una jornada). La regla —uno por jornada— no cambia.
--
-- Que la canalización del REC sea de SU oferta no cabe en un CHECK (otra tabla): lo garantiza
-- que solo lo crea el trigger `canalizaciones_crea_albaranes` (con `excedente_id` de la propia
-- canalización) y `rectificar_albaran()` (que copia las dos columnas). `authenticated` no tiene
-- INSERT en `albaranes`.
--
-- Compatible hacia atrás: los datos actuales cumplen (ningún REC lleva canalización todavía).

-- ---------------------------------------------------------------------------
-- 1. Pertenencia
-- ---------------------------------------------------------------------------
-- Antes de validar, la comprobación de que nada la incumple (norma §7 sobre tablas con datos).
do $$
declare
  n int;
begin
  select count(*) into n from albaranes a
   where not (case a.tipo
                when 'REC' then (a.excedente_id is not null) <> (a.espigolada_id is not null)
                                and (a.canalizacion_id is null or a.excedente_id is not null)
                else a.canalizacion_id is not null
              end);
  if n > 0 then
    raise exception 'albaranes_pertenencia_check: % filas no cumplen la regla nueva', n;
  end if;
end $$;

alter table public.albaranes drop constraint if exists albaranes_pertenencia_check;
alter table public.albaranes add constraint albaranes_pertenencia_check check (
  case tipo
    -- REC: de una oferta o de una espigolada (solo una); con canalización solo si es de oferta.
    when 'REC' then (excedente_id is not null) <> (espigolada_id is not null)
                    and (canalizacion_id is null or excedente_id is not null)
    -- ENT y OPE: siempre de una canalización.
    else canalizacion_id is not null
  end) not valid;
alter table public.albaranes validate constraint albaranes_pertenencia_check;

-- ---------------------------------------------------------------------------
-- 2-4. Unicidad de los REC
-- ---------------------------------------------------------------------------
-- Comprobaciones previas: ningún duplicado con la condición nueva (que es MÁS estrecha que la
-- anterior en los heredados y en la jornada, así que no puede fallar; se deja por la norma).
do $$
declare
  n int;
begin
  select count(*) into n from (
    select excedente_id from albaranes
     where tipo = 'REC' and canalizacion_id is null and excedente_id is not null
       and estado not in ('anulado', 'rectificado') and rectifica_a is null
     group by excedente_id having count(*) > 1) x;
  if n > 0 then
    raise exception 'albaranes_rec_excedente_uidx: % ofertas con mas de un REC heredado vivo', n;
  end if;
end $$;

drop index if exists public.albaranes_rec_excedente_uidx;
create unique index albaranes_rec_excedente_uidx
  on public.albaranes (excedente_id)
  where tipo = 'REC' and canalizacion_id is null
    and estado not in ('anulado', 'rectificado') and rectifica_a is null;

comment on index public.albaranes_rec_excedente_uidx is
  'REC HEREDADO (uno por oferta, sin canalizacion_id): uno vivo por oferta. Sin rectificados ni rectificativos (20270608100000).';

create unique index if not exists albaranes_rec_canalizacion_uidx
  on public.albaranes (canalizacion_id)
  where tipo = 'REC' and canalizacion_id is not null
    and estado not in ('anulado', 'rectificado') and rectifica_a is null;

comment on index public.albaranes_rec_canalizacion_uidx is
  'REC POR RECOGIDA (fase 3 de los puntos 4-6): uno vivo por canalización de donación. Sin rectificados ni rectificativos (20270608100000).';

drop index if exists public.albaranes_rec_espigolada_uidx;
create unique index albaranes_rec_espigolada_uidx
  on public.albaranes (espigolada_id)
  where tipo = 'REC' and estado not in ('anulado', 'rectificado') and rectifica_a is null;

comment on index public.albaranes_rec_espigolada_uidx is
  'REC de una jornada de espigueo: uno vivo por jornada. Sin rectificados ni rectificativos (20270608100000).';

comment on column public.albaranes.canalizacion_id is
  'ENT/OPE: la canalización que documenta (siempre). REC: la recogida de donación que documenta (fase 3 de los puntos 4-6, 20270608100000); null en el REC heredado (uno por oferta) y en el de una espigolada.';
