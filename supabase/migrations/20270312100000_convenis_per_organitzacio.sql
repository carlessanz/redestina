-- El convenio es de la ORGANIZACIÓN, no de cada una de sus fichas.
--
-- EL PROBLEMA (deuda §12.79), que resultó ser cierto solo a medias. La entrada dice que «una
-- organización con doble rol necesita dos convenios, uno por ficha». Mirando la matriz
-- `convenios_exigidos`, eso depende de la valorización:
--
--   donacio · entrega → don_gen      donacio · recibe → don_rec     ← DOS TIPOS distintos
--   venda   · entrega → com          venda   · recibe → com         ← EL MISMO tipo
--   maquila · entrega → com          maquila · recibe → com         ← EL MISMO tipo
--
-- En **donación no hay redundancia**: son dos acuerdos distintos para dos papeles distintos, y
-- una organización que dona y recibe firma los dos con razón. La redundancia está en **venta y
-- maquila**, donde las dos partes necesitan el MISMO tipo `com`: con el índice por ficha
-- —`(coalesce(productor_id, entidad_id), tipo) where vigent`— una organización de doble rol
-- acababa firmando **dos veces el mismo acuerdo**, uno colgando de cada ficha.
--
-- Y la campaña los contaba dos veces: `v_campanya_convenis` agrupa por `tipo_org`, así que esa
-- organización aparecía en la fila de productores y en la de entidades.
--
-- ⚠️ SE HACE AHORA PORQUE HOY SALE GRATIS. **En producción hay CERO convenios**, así que no se
--    migra ningún documento firmado: cambiar la clave no toca nada que alguien haya aceptado.
--    El día que haya cientos, esto sería una migración de documentos legales.
--
-- 🟠 **Y lleva dentro una decisión de negocio que hay que confirmar con la Fundació**: se asume
--    que el **convenio comercial `com` es UNO por organización** y cubre sus operaciones de
--    compra y de venta, no uno por papel. Es la lectura natural de «conveni de col·laboració
--    comercial», y es coherente con que la matriz pida el mismo tipo a las dos partes — pero
--    es una lectura, no un hecho. Si la asesoría dice que son dos acuerdos distintos, se
--    revierte quitando este índice y reponiendo el anterior: dos líneas, y sin datos que
--    rehacer mientras no se firme nada. Va con los textos de los convenios, que tampoco están
--    validados (deuda §12.77).
--
-- QUÉ **NO** SE QUITA. `productor_id` y `entidad_id` se quedan, y no por compatibilidad: dicen
-- **con qué papel** se firmó, y `datos_org` congela los datos de esa ficha concreta. Eso es
-- información que el documento necesita y que la organización sola no da.

alter table convenios add column if not exists organizacion_id uuid references organizaciones(id);

comment on column convenios.organizacion_id is
  'La organización que firma. `productor_id`/`entidad_id` siguen diciendo CON QUÉ PAPEL, que '
  'es lo que congela `datos_org`; esto dice QUIÉN, para que un mismo tipo de convenio no se '
  'firme dos veces (deuda §12.79).';

-- Relleno desde la ficha. Idempotente.
update convenios c
   set organizacion_id = coalesce(
         (select p.organizacion_id from productores p where p.id = c.productor_id),
         (select e.organizacion_id from entidades   e where e.id = c.entidad_id))
 where c.organizacion_id is null;

create index if not exists convenios_organizacion_idx on convenios (organizacion_id);

-- ---------------------------------------------------------------------------
-- La clave: un convenio vigente de cada tipo por ORGANIZACIÓN
-- ---------------------------------------------------------------------------
-- Sustituye al de por ficha. El anterior se queda sin efecto práctico —una organización tiene
-- como mucho una ficha de cada tipo (`20270310100000`)— pero se retira igual para que no haya
-- dos reglas diciendo cosas parecidas y nadie sepa cuál manda.
drop index if exists convenis_vigent_uidx;
drop index if exists convenios_vigent_uidx;

create unique index if not exists convenios_vigent_per_organitzacio_uidx
  on convenios (organizacion_id, tipo) where estado = 'vigent';

-- ---------------------------------------------------------------------------
-- `convenio_vigente()` pregunta por la organización
-- ---------------------------------------------------------------------------
-- Misma firma —la llaman `exigir_convenio()`, `aprovar_resposta()`, `repartir_espigolada()` y
-- `src/lib/convenis.ts`— y mismo significado para donación, donde los tipos ya eran distintos.
-- Lo que cambia es venta y maquila: el `com` que firmó la organización con su ficha de
-- productor **también la cubre** como compradora, que es justo lo que la deuda pedía.
create or replace function public.convenio_vigente(
  p_tipo_org     text,
  p_org          uuid,
  p_valorizacion text,
  p_parte        text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_org is null then false
    when not exists (select 1 from convenios_exigidos ce
                      where ce.valorizacion = p_valorizacion and ce.parte = p_parte)
      then true
    else not exists (
      -- Falta alguno de los exigidos → no está cubierta.
      select 1
        from convenios_exigidos ce
       where ce.valorizacion = p_valorizacion
         and ce.parte        = p_parte
         and not exists (
           select 1 from convenios c
            where c.estado = 'vigent'
              and c.tipo   = ce.tipo_convenio
              -- Por organización: se resuelve la de la ficha que llega, y así un convenio
              -- firmado con el otro papel de la MISMA organización también cuenta.
              and c.organizacion_id = public.organizacion_de(p_tipo_org, p_org)))
  end;
$$;

revoke execute on function public.convenio_vigente(text, uuid, text, text) from public, anon;
grant  execute on function public.convenio_vigente(text, uuid, text, text) to authenticated, service_role;
