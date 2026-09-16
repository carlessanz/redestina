-- ---------------------------------------------------------------------------
-- `convenios.organizacion_id` deja de nacer NULL: sin esto, el corte bloquea a TODOS
-- ---------------------------------------------------------------------------
-- 🔴 EL FALLO, Y CÓMO SE ENCONTRÓ. El 16-09-2026, al fijar `fecha_corte_convenios` para
-- que el panel empezara a exigir convenio de verdad (§8bis/D7), salió que `exigir_convenio`
-- rechazaba también a **Mas de Prova SCP, que tiene su convenio `vigent`**. La causa:
-- `convenio_vigente()` (`20270312100000:100`) busca el convenio por
-- `c.organizacion_id = organizacion_de(tipo_org, ficha)`, y **los cinco convenios de la
-- base tenían `organizacion_id` NULL**, el vigente incluido.
--
-- O sea que la función **no podía devolver `true` para nadie**: con el corte encendido, una
-- organización quedaba bloqueada para siempre aunque firmara. La cosa que el corte existe
-- para permitir —operar tras firmar— era justamente la que no llegaba nunca.
--
-- POR QUÉ NADIE LO VIO ANTES: con `fecha_corte_convenios` a NULL, `exigir_convenio` se
-- queda en el aviso y **no llega a consultar `convenio_vigente()`**. El defecto era
-- alcanzable solo desde el día en que alguien fijara la fecha, que es exactamente el día en
-- que más caro sale. Se apagó el corte mientras se escribía esto.
--
-- ⚠️ LA CAUSA DE FONDO ES UNA LECCIÓN QUE YA ESTABA ESCRITA Y NO SE APLICÓ AQUÍ.
--    `20270312100000` añadió la columna y la rellenó con un `update … where organizacion_id
--    is null`, y ahí se acabó. Pero **`preparar_convenio()` nunca la ha escrito** y no hay
--    ningún trigger, así que todo convenio creado después de esa migración nace nulo — los
--    cinco que hay, creados el 14 y el 16 de septiembre. Es palabra por palabra lo que
--    AGENTS §4 cuenta de `organizaciones`: «El relleno inicial no basta… Migrar los datos y
--    mantener la invariante son dos cosas distintas, y un `update` de relleno solo hace la
--    primera». Allí lo que la sostiene es el trigger `*_estrena_organizacion` **más** el
--    `not null`; aquí se hace igual, y por el mismo motivo.
--
-- POR QUÉ UN TRIGGER Y NO ARREGLAR `preparar_convenio()`: porque el trigger cubre **todos**
-- los caminos de inserción, incluido el que alguien escriba mañana. Arreglar solo la RPC
-- dejaría el mismo agujero esperando al siguiente insert.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Relleno de lo que hay
-- ---------------------------------------------------------------------------
-- ⚠️ Toca filas en estado `vigent`, que `convenios_control` protege — pero
--    `organizacion_id` NO está en su lista de campos congelados (`20270111100000:275-289`:
--    tipo, tipo_org, productor_id, entidad_id, plantilla_id, idioma, serie, ejercicio,
--    numero, numero_completo, datos_org, firmante, firmado_at, roles_com). Comprobado antes
--    de escribir esto, no después: si estuviera, este `update` fallaría con 42501 y haría
--    falta otra vía.
update convenios c
   set organizacion_id = public.organizacion_de(c.tipo_org, coalesce(c.productor_id, c.entidad_id))
 where c.organizacion_id is null;

-- ---------------------------------------------------------------------------
-- 2. Lo que mantiene la invariante a partir de ahora
-- ---------------------------------------------------------------------------
-- Se rellena en el INSERT y también cuando cambia la ficha a la que cuelga, que es lo que
-- hace `enllacar_organitzacio()` al fusionar dos organizaciones: si solo mirara el INSERT,
-- una fusión dejaría el convenio apuntando a la organización retirada.
create or replace function public.trg_convenios_organitzacio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.organizacion_id is null
     or (tg_op = 'UPDATE'
         and (new.productor_id is distinct from old.productor_id
           or new.entidad_id   is distinct from old.entidad_id)) then
    new.organizacion_id := public.organizacion_de(
      new.tipo_org, coalesce(new.productor_id, new.entidad_id));
  end if;
  return new;
end;
$$;

drop trigger if exists convenios_organitzacio on convenios;
-- ⚠️ Va ANTES que `convenios_control` por orden alfabético del nombre del trigger
--    (`convenios_control` < `convenios_organitzacio`), así que control se ejecuta primero y
--    ve el valor viejo. No importa: control no mira esta columna. Si algún día la mirara,
--    habría que renombrar uno de los dos, porque Postgres ordena los BEFORE por nombre.
create trigger convenios_organitzacio
  before insert or update on convenios
  for each row execute function public.trg_convenios_organitzacio();

-- ---------------------------------------------------------------------------
-- 3. Y que no se pueda volver a colar un nulo
-- ---------------------------------------------------------------------------
-- Es seguro: `convenios` exige productor_id **o** entidad_id (check excluyente), y las dos
-- tablas de fichas tienen `organizacion_id not null` desde `20270313100000`. Así que
-- `organizacion_de()` no puede devolver nulo para un convenio válido.
--
-- El `not null` es la mitad que convierte esto en invariante: el trigger RELLENA, la
-- restricción hace que **no se pueda saltar**. Con solo el trigger, un `alter` futuro que lo
-- desactivara volvería a dejar pasar nulos en silencio, que es como empezó todo.
alter table convenios alter column organizacion_id set not null;

comment on column convenios.organizacion_id is
  'La organización del convenio. La rellena el trigger convenios_organitzacio desde la ficha, y es NOT NULL desde 20270327100000: convenio_vigente() busca por esta columna, así que un nulo aquí bloquea a la organización aunque tenga el convenio firmado.';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
--   select count(*) from convenios where organizacion_id is null;   -- esperado: 0
--
-- Y lo que de verdad importa, que es que el corte vuelva a distinguir:
--   select public.convenio_vigente('productor',
--            (select id from productores where name = 'Mas de Prova SCP'),
--            'donacio', 'entrega');                                  -- esperado: true
--   select public.convenio_vigente('productor', '<ficha sense conveni>',
--            'donacio', 'entrega');                                  -- esperado: false
