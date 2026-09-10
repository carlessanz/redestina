-- Las columnas que la fase 3 añade a las dos tablas del dominio que ya existían.
--
-- QUÉ CAMBIA DE FONDO. Hasta hoy una `canalización` era «tantos kilos a esta entidad».
-- A partir de aquí es también **una operación con valorización propia** (donación, venta
-- o maquila), **con su coste por kilo congelado** y **con unos kilos conciliados** que son
-- los únicos que cuentan para los indicadores y para el certificado. Esos tres datos son
-- lo que separa un registro operativo de un registro con efectos fiscales.
--
-- POR QUÉ LA VALORIZACIÓN VIVE EN LA CANALIZACIÓN Y NO SOLO EN EL EXCEDENTE. Hoy
-- `excedentes.modalitat` es una sola por oferta; el funcional pide que un mismo registro
-- pueda repartirse en varias operaciones con valorización distinta (parte donada, parte
-- vendida). El trigger de abajo copia la modalitat del excedente como **valor por
-- defecto**, así que nada de lo que existe cambia de comportamiento, y el día que el
-- panel deje elegir otra, el dato ya tiene sitio.
--
-- POR QUÉ `coste_kg` SE COPIA Y NO SE CONSULTA. Si el valor de una donación se calculara
-- leyendo `costes_producto` en el momento del cierre, cambiar un coste en 2027
-- reescribiría el valor de certificados ya emitidos en 2026. Se copia al nacer la
-- canalización y se **congela** al conciliar (`conciliar_albaran`, 20261012100500).
--
-- ⚠️ SI NO HAY COSTE, `coste_kg` QUEDA `null`, Y ESO ES EL DISEÑO, NO UN OLVIDO
--    (decisión D del plan): `productos.eur_kg` vale 1 €/kg plano para los 90 productos,
--    así que usarlo de defecto daría siempre una cifra plausible y el cierre no se
--    bloquearía nunca. Un `null` aquí es lo que aparece en la bandeja como «falta el
--    coste de 2026 para Tomàquet» y lo que impide emitir un certificado.

-- ---------------------------------------------------------------------------
-- 1. canalizaciones: valorización, coste, lote y conciliación
-- ---------------------------------------------------------------------------
alter table canalizaciones
  add column if not exists valorizacion             text,
  add column if not exists coste_kg                 numeric,
  add column if not exists nota_lote                text,
  add column if not exists codigo_lote              text,
  add column if not exists kg_conciliados           numeric,
  add column if not exists conciliada_at            timestamptz,
  add column if not exists conciliada_por           uuid references auth.users(id) on delete set null,
  add column if not exists motivo_conciliacion      text,
  -- Una conciliación hecha DESPUÉS de cerrar el ejercicio al que pertenece. El cierre de
  -- prueba las incluye y el real no (fase 4): sin la marca, no se podrían distinguir.
  add column if not exists conciliacion_retroactiva boolean not null default false;

alter table canalizaciones drop constraint if exists canalizaciones_valorizacion_check;
alter table canalizaciones add constraint canalizaciones_valorizacion_check
  check (valorizacion is null or valorizacion in ('donacio', 'venda', 'maquila'));

alter table canalizaciones drop constraint if exists canalizaciones_coste_kg_check;
alter table canalizaciones add constraint canalizaciones_coste_kg_check
  check (coste_kg is null or coste_kg > 0);

comment on column canalizaciones.valorizacion is
  'donacio | venda | maquila. Por defecto la modalitat del excedente; puede variar por lote.';
comment on column canalizaciones.coste_kg is
  'Coste por kilo copiado de costes_producto al nacer y congelado al conciliar. null = bloquea el cierre.';
comment on column canalizaciones.kg_conciliados is
  'Kilos VALIDADOS. Los únicos que cuentan para indicadores y certificados (D13). Los escribe conciliar_albaran().';
comment on column canalizaciones.codigo_lote is
  'Identificador del lote en la entrega. Sale impreso en el ENT como origen del producto (D3).';

-- El `estado` de una canalización no tenía check: admitía cualquier texto. Ahora es una
-- máquina de estados de verdad, así que se cierra el vocabulario.
--
-- `not valid` + validación en dos pasos (§A del plan): la tabla puede tener filas en
-- producción con un valor que no esté en la lista, y una migración que reviente a mitad
-- del `db push` es mucho peor que un check sin validar. El `do` de abajo lo valida solo
-- si todo lo que hay encaja, y si no, deja el aviso con los valores ofensores.
alter table canalizaciones drop constraint if exists canalizaciones_estado_check;
alter table canalizaciones add constraint canalizaciones_estado_check
  check (estado in ('confirmada', 'entregada', 'conciliada', 'anulada')) not valid;

do $$
declare
  v_malos text;
begin
  select string_agg(distinct coalesce(estado, '(null)'), ', ')
    into v_malos
    from canalizaciones
   where estado is null
      or estado not in ('confirmada', 'entregada', 'conciliada', 'anulada');

  if v_malos is null then
    alter table canalizaciones validate constraint canalizaciones_estado_check;
    raise notice 'canalizaciones_estado_check validado.';
  else
    raise warning 'canalizaciones_estado_check queda SIN VALIDAR: hay estados fuera del vocabulario (%). Normalízalos y ejecuta: alter table canalizaciones validate constraint canalizaciones_estado_check;', v_malos;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. El trigger que rellena valorización y coste
-- ---------------------------------------------------------------------------
-- `before insert`, y no una llamada desde las RPC, por el mismo motivo que el trigger que
-- crea los albaranes (20261012100300): hoy `canalizaciones` se inserta por **dos**
-- caminos —la RPC `aprovar_resposta()` y las tres llamadas sueltas de `OfferDetail.tsx`
-- (deuda §12.19)— y un tercero está a punto de nacer (`repartir_espigolada`). Lo que se
-- pone en el trigger vale para los tres sin tocar ninguno.
--
-- Solo rellena lo que venga vacío: si quien inserta ya decidió la valorización (un lote
-- de venta dentro de una oferta de donación), no se le pisa.
create or replace function trg_canalizaciones_valoriza()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_producto  text;
  v_ejercicio int;
begin
  if new.valorizacion is null and new.excedente_id is not null then
    select e.modalitat into new.valorizacion from excedentes e where e.id = new.excedente_id;
  end if;

  if new.coste_kg is null and new.excedente_id is not null then
    -- El ejercicio es el de la RECOGIDA si ya se sabe, y si no el de hoy, siempre en hora
    -- de Madrid: una recogida del 31/12 a las 23:30 pertenece a ese ejercicio (§cierre).
    v_ejercicio := extract(year from (coalesce(new.data_hora_recollida, now())
                                       at time zone 'Europe/Madrid'))::int;
    select e.producto into v_producto from excedentes e where e.id = new.excedente_id;
    if v_producto is not null then
      select c.coste_kg into new.coste_kg
        from costes_producto c
       where c.producto = v_producto and c.ejercicio = v_ejercicio;
    end if;
    -- Si no hay coste del ejercicio, `coste_kg` se queda null A PROPÓSITO (ver cabecera).
  end if;

  return new;
end;
$$;

drop trigger if exists canalizaciones_valoriza on canalizaciones;
create trigger canalizaciones_valoriza
  before insert on canalizaciones
  for each row execute function trg_canalizaciones_valoriza();

-- ---------------------------------------------------------------------------
-- 3. Lo que se retira del uso, sin borrarlo (D9)
-- ---------------------------------------------------------------------------
-- Cuatro columnas que hacían de albarán con texto y booleanos. Se quedan: son el
-- histórico de lo que el equipo registró a mano antes de que existieran los albaranes de
-- verdad, y borrarlas perdería ese rastro sin ganar nada. El comentario es lo que impide
-- que alguien las vuelva a usar por descuido.
comment on column canalizaciones.albaran_aprofitat is
  'DEPRECATED (fase 3, D9). Texto libre del albarán de aprovechamiento. Sustituido por albaranes/albaran_lineas. Solo histórico.';
comment on column canalizaciones.albaran_entrada is
  'DEPRECATED (fase 3, D9). Texto libre del albarán de entrada. Sustituido por el REC. Solo histórico.';
comment on column canalizaciones.firmado_entidad is
  'DEPRECATED (fase 3, D9). Booleano de firma. Sustituido por evidencias del enlace de confirmación. Solo histórico.';
comment on column canalizaciones.firmado_productor is
  'DEPRECATED (fase 3, D9). Booleano de firma. Sustituido por evidencias del enlace de confirmación. Solo histórico.';

-- ---------------------------------------------------------------------------
-- 4. excedentes: de dónde viene el registro
-- ---------------------------------------------------------------------------
-- `origen` distingue lo que entra por WhatsApp, por el panel del productor, lo que teclea
-- el equipo en nombre de alguien (modelo asistido, §1bis) y lo que nace de una espigolada.
-- Sin él, una espigolada sería indistinguible de una oferta normal en cualquier indicador.
--
-- `default 'intake'` porque es lo que describe TODAS las filas que ya existen: hasta hoy
-- solo se podía crear un excedente por el intake conversacional o por el panel, y el panel
-- del productor es posterior a casi todas ellas.
alter table excedentes
  add column if not exists origen        text not null default 'intake',
  -- La FK a `espigoladas` NO se puede declarar aquí: esa tabla la crea la migración
  -- siguiente (20261012100200), que la añade con `alter table`. Es el orden correcto —el
  -- excedente es el que apunta a la espigolada, no al revés—, no un olvido.
  add column if not exists espigolada_id uuid,
  -- Identificador en el sistema de origen. Hoy solo lo usa la espigolada manual; el día
  -- que exista el módulo de espigolament podrá crear o actualizar el mismo registro por
  -- API sin duplicar kilos.
  add column if not exists ref_externa   text;

alter table excedentes drop constraint if exists excedentes_origen_check;
alter table excedentes add constraint excedentes_origen_check
  check (origen in ('intake', 'panel', 'asistido', 'espigolament'));

-- Anti-duplicado: dos importaciones del mismo evento externo no pueden crear dos
-- registros. Parcial porque casi todas las filas tienen `ref_externa` a null.
create unique index if not exists excedentes_ref_externa_uidx
  on excedentes (ref_externa) where ref_externa is not null;

create index if not exists excedentes_espigolada_idx
  on excedentes (espigolada_id) where espigolada_id is not null;

comment on column excedentes.origen is
  'intake | panel | asistido | espigolament. Default intake: es lo que describe las filas que ya existían.';
comment on column excedentes.ref_externa is
  'Id en el sistema de origen (futuro módulo de espigolament). Único cuando no es null: evita duplicar kilos.';

-- Verificación:
--   \d canalizaciones
--   select origen, count(*) from excedentes group by 1;
--   select conname, convalidated from pg_constraint where conname = 'canalizaciones_estado_check';
