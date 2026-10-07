-- `planes_prevencion` aprende dos cosas: **de qué cuestionario salió** y **qué medidas
-- propone**.
--
-- Hasta hoy un plan era un sobre de respuestas y un PDF. Le faltaba justamente lo que le
-- da valor a la organización que lo recibe: la lista de medidas concretas. Y le faltaba
-- la trazabilidad de la otra punta: con qué versión del cuestionario se hizo.
--
-- 🔴 LAS MEDIDAS SE GUARDAN **COPIADAS**, no referenciadas. `mesures.llista` lleva el
--    título y la descripción enteros dentro de cada elemento, en el idioma del plan, y no
--    solo el `codi`. Es el mismo principio que `documentos.datos`, que `convenios.datos_org`
--    y que las respuestas autocontenidas (20270405100000): un plan de hace cinco años no
--    puede depender de que el catálogo siga vivo, ni de que su redacción no haya cambiado,
--    ni de que quien lo lee pueda leer `mesures_prevencio` — que es de equipo. Con solo el
--    código, retirar una medida convertiría un plan emitido en una lista de huecos.
--
-- ⚠️ EL `codi` SE GUARDA IGUALMENTE, y no es redundante: es lo que permite decir «esta
--    organización ya tenía la medida X el año pasado» cuando llegue el plan personalizado
--    y su histórico. La copia es para leer; el código, para contar.

-- ---------------------------------------------------------------------------
-- 1. La forma del sobre de medidas
-- ---------------------------------------------------------------------------
-- Como `questionari_valid()`: IMMUTABLE y sin `security definer`, que son las dos
-- condiciones para poder usarla en un CHECK. Impone la FORMA, nunca el contenido — qué
-- medidas hay lo deciden las reglas, no el esquema.
create or replace function public.mesures_pla_forma(p_mesures jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  m jsonb;
begin
  if p_mesures is null or jsonb_typeof(p_mesures) <> 'object' then
    return false;
  end if;

  if p_mesures ? 'editat' and jsonb_typeof(p_mesures -> 'editat') not in ('boolean', 'null') then
    return false;
  end if;
  if p_mesures ? 'regles_aplicades'
     and jsonb_typeof(p_mesures -> 'regles_aplicades') not in ('array', 'null') then
    return false;
  end if;
  if jsonb_typeof(coalesce(p_mesures -> 'llista', '[]'::jsonb)) <> 'array' then
    return false;
  end if;

  for m in select value from jsonb_array_elements(coalesce(p_mesures -> 'llista', '[]'::jsonb)) loop
    if jsonb_typeof(m) <> 'object'
    or jsonb_typeof(m -> 'codi')        <> 'string'
    or jsonb_typeof(m -> 'titol')       <> 'string'
    or jsonb_typeof(m -> 'descripcio')  <> 'string'
    or jsonb_typeof(m -> 'obligatoria') <> 'boolean'
    or coalesce(m ->> 'bloc', '') not in
       ('planificacio', 'collita', 'conservacio', 'canalitzacio', 'seguiment')
    or coalesce(m ->> 'origen', '') not in ('regla', 'manual') then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

comment on function public.mesures_pla_forma(jsonb) is
  'La forma de planes_prevencion.mesures: {generat_at, regles_aplicades[], editat, observacions, llista:[{codi,bloc,titol,descripcio,obligatoria,origen}]}. Solo la forma.';

revoke execute on function public.mesures_pla_forma(jsonb) from public, anon;
grant  execute on function public.mesures_pla_forma(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Las dos columnas
-- ---------------------------------------------------------------------------
alter table planes_prevencion
  add column if not exists questionari_id uuid,
  add column if not exists mesures jsonb not null default '{}'::jsonb;

comment on column planes_prevencion.questionari_id is
  'Con qué versión del cuestionario se hizo este diagnóstico. NULL en los planes anteriores a 20270405100000 (versio_questionari = 0).';
comment on column planes_prevencion.mesures is
  'Las medidas propuestas, COPIADAS (título y descripción dentro, en el idioma del plan). Ver la cabecera: no se referencian, se copian.';

-- La FK y el CHECK van `not valid` + `validate`, que es la regla de §7 para una tabla con
-- datos. Aquí los dos son **demostrablemente ciertos** antes de validarlos —la columna
-- nueva vale NULL en todas las filas y `mesures` vale `{}`, que `mesures_pla_forma()`
-- acepta—, pero el orden se respeta igual: una validación que se da por hecha es la que
-- un día falla en producción con la tabla bloqueada.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'planes_questionari_fk'
                    and conrelid = 'public.planes_prevencion'::regclass) then
    alter table planes_prevencion
      add constraint planes_questionari_fk
      foreign key (questionari_id) references questionaris_diagnostic(id)
      on delete restrict not valid;
    alter table planes_prevencion validate constraint planes_questionari_fk;
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'planes_mesures_forma'
                    and conrelid = 'public.planes_prevencion'::regclass) then
    alter table planes_prevencion
      add constraint planes_mesures_forma check (public.mesures_pla_forma(mesures)) not valid;
    alter table planes_prevencion validate constraint planes_mesures_forma;
  end if;
end;
$$;

create index if not exists planes_questionari_idx
  on planes_prevencion (questionari_id) where questionari_id is not null;

-- ---------------------------------------------------------------------------
-- 3. El control de inmutabilidad, con las dos columnas dentro
-- ---------------------------------------------------------------------------
-- Se recrea entero (`create or replace`, el trigger sigue enganchado). Las dos columnas
-- nuevas entran en la lista congelada por el mismo motivo que las demás: un plan emitido
-- es un documento entregado, y cambiarle las medidas después haría que el PDF y la fila
-- dijeran cosas distintas sobre el mismo papel.
--
-- ⚠️ `mesures` sí se puede mover mientras el plan es `esborrany` —es justo lo que hacen
--    `generar_pla_des_de_diagnostic()` y `desar_mesures_pla()`—: la congelación empieza
--    en `emes`, como todo lo demás de esta tabla.
create or replace function trg_planes_control()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.estado in ('emes', 'substituit') then
    if new.tipo_org        is distinct from old.tipo_org
    or new.productor_id    is distinct from old.productor_id
    or new.entidad_id      is distinct from old.entidad_id
    or new.nivel           is distinct from old.nivel
    or new.respuestas      is distinct from old.respuestas
    or new.questionari_id  is distinct from old.questionari_id
    or new.mesures         is distinct from old.mesures
    or new.version         is distinct from old.version
    or new.idioma          is distinct from old.idioma
    or new.serie           is distinct from old.serie
    or new.ejercicio       is distinct from old.ejercicio
    or new.numero          is distinct from old.numero
    or new.numero_completo is distinct from old.numero_completo
    or new.emitido_at      is distinct from old.emitido_at then
      raise exception 'Un pla emes no es pot modificar (%). Fes un diagnostic nou.',
        coalesce(old.numero_completo, old.id::text) using errcode = '42501';
    end if;
  end if;

  if new.estado is distinct from old.estado
     and not (
          (old.estado = 'esborrany' and new.estado = 'emes')
       or (old.estado = 'emes'      and new.estado = 'substituit')) then
    raise exception 'Transicio d''estat no permesa en un pla: % -> %', old.estado, new.estado
      using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- El trigger ya existe desde 20270301100000 y sigue apuntando a esta función; se vuelve a
-- declarar por si algún entorno lo hubiera perdido.
drop trigger if exists planes_control on planes_prevencion;
create trigger planes_control
  before insert or update on planes_prevencion
  for each row execute function trg_planes_control();

-- ---------------------------------------------------------------------------
-- 4. Ahora sí: los triggers del cuestionario
-- ---------------------------------------------------------------------------
-- Las dos funciones las creó 20270405100000, pero consultan `planes_prevencion.questionari_id`
-- y esa columna no existía hasta tres líneas más arriba. Enganchar allí el trigger habría
-- hecho que el primer `update` sobre un cuestionario fallara con `42703`. Es el mismo
-- motivo por el que la FK de `documentos.plantilla_id` vive en su propio fichero.
drop trigger if exists questionaris_inmutables on questionaris_diagnostic;
create trigger questionaris_inmutables
  before update on questionaris_diagnostic
  for each row execute function trg_questionaris_inmutables();

drop trigger if exists questionaris_no_esborrar on questionaris_diagnostic;
create trigger questionaris_no_esborrar
  before delete on questionaris_diagnostic
  for each row execute function trg_questionaris_no_esborrar();

-- Verificación:
--   select column_name from information_schema.columns
--    where table_name = 'planes_prevencion' and column_name in ('questionari_id','mesures');
--   select public.mesures_pla_forma('{}'::jsonb);                                  -- t
--   select public.mesures_pla_forma('{"llista":[{"codi":"x"}]}'::jsonb);            -- f
