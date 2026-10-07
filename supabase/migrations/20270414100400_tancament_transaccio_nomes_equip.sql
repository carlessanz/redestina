-- 🔴 La base de cálculo del CERTIFICADO DE TRANSACCIÓN la podía leer cualquier cuenta con
--    sesión, y su snapshot también. Es el mismo agujero que `20270303100500` cerró en la
--    familia de la donación, en la hermana que se quedó fuera.
--
-- QUÉ PASABA (medido en el clon local el 07-10-2026, con `set local role authenticated` y
-- los claims de la cuenta del Menjador Social de Prova, una RECEPTORA):
--
--   · `cierre_base_transaccion(2026, 'prueba')`  → 1 fila: productor_id, entidad_id,
--     producto, kg_neto, coste_kg y valor de una venta conciliada que no es suya.
--   · `cierre_pendents_transaccion(2026)`        → ejecutada (0 filas hoy por datos, no
--     por permisos).
--   · `cierre_datos_certificado_transaccion(…)`  → el snapshot entero del CT de Mas de
--     Prova: los datos fiscales del generador (`datos_fiscales`: NIF, domicilio) y sus
--     destinaciones con nombre.
--
-- Las tres son `security definer` y desde `20270301100100:764-765` tienen
-- `grant execute … to authenticated`, sin ninguna comprobación de rol por dentro. Cuando
-- `20270303100500` cerró `cierre_base_periodo()` y `cierre_base_recepcio()`, el CT se quedó
-- fuera: no estaba en la familia «de periodo» y el arnés no lo miraba.
--
-- EL ARREGLO, en dos tratamientos porque son dos clases de función:
--
--   1. `cierre_base_transaccion()` y `cierre_pendents_transaccion()` son CONSULTAS, como
--      `cierre_base()`: el equipo las puede leer (es lo que hace auditable la cifra de un
--      CT). Se queda el GRANT a `authenticated` y entra la MISMA guarda que en la familia
--      de la donación, con el mismo idioma:
--        `auth.uid() is not null and not es_intern()` → 42501
--      —no `es_intern()` a secas, que dejaría fuera a `service_role` (el job de fin de año,
--      los scripts) en silencio, el error de `datos_182()` (§4bis)—. Pasan a `plpgsql`
--      porque una función `language sql` no puede levantar una excepción condicional;
--      `create or replace` admite el cambio de lenguaje porque firma y retorno no cambian.
--      El cuerpo es literalmente el vigente (`20270301100100`), envuelto en `return query`.
--
--   2. `cierre_datos_certificado_transaccion()` es un SNAPSHOT para el renderizador, como
--      sus hermanas `cierre_datos_certificado()`, `cierre_datos_resumen()` y
--      `cierre_destinatario()`, que son solo de `service_role`. Recibe el mismo
--      tratamiento: `revoke … from authenticated`. Nadie con sesión de usuario la llama
--      (grep en `src/`, `scripts/` y `supabase/functions/`: cero llamadas); quien la usa son
--      `emitir_certificado_transaccion()` y `rectificar_certificado_transaccion()`, que
--      son `security definer` y la ejecutan como su propietario, así que el `revoke` no
--      les afecta.
--
-- ⚠️ Los llamadores internos de (1) —`calcular_cierre_transacciones()`,
--    `emitir_certificado_transaccion()`, `rectificar_certificado_transaccion()`— exigen ya
--    `pot_aprovar()` antes de llegar aquí, así que la guarda nueva nunca les corta: quien
--    pasa `pot_aprovar()` pasa `es_intern()`.

create or replace function public.cierre_base_transaccion(
  p_ejercicio int,
  p_modo      text default 'prueba'
)
returns table (
  canalizacion_id uuid,
  excedente_id    uuid,
  entidad_id      uuid,
  productor_id    uuid,
  producto        text,
  valorizacion    text,
  mes             int,
  kg_conciliados  numeric,
  coste_kg        numeric,
  retroactiva     boolean,
  albaran_ope_id  uuid,
  kg_neto         numeric,
  valor           numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la base de calcul d''un certificat de transaccio'
      using errcode = '42501';
  end if;

  return query
  with ops as (
    select c.id as canalizacion_id, c.excedente_id, c.entidad_id,
           e.productor_id, e.producto, c.valorizacion,
           c.kg_conciliados, c.coste_kg,
           c.conciliacion_retroactiva as retroactiva,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid') as fecha_local
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
     where c.valorizacion in ('venda', 'maquila')
       and c.estado = 'conciliada'
       and c.kg_conciliados is not null
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
  ),
  enrango as (
    select o.*, extract(month from o.fecha_local)::int as mes
      from ops o
     where extract(year from o.fecha_local)::int = p_ejercicio
  ),
  conope as (
    select o.*, r.albaran_id as albaran_ope_id, r.kg as ope_neto
      from enrango o
      left join lateral (
        select a.id as albaran_id, sum(l.kg_validados) as kg
          from albaranes a
          join albaran_lineas l on l.albaran_id = a.id
         where a.tipo = 'OPE' and a.estado = 'conciliado'
           and a.canalizacion_id = o.canalizacion_id
         group by a.id
         order by a.id
         limit 1
      ) r on true
  )
  select c.canalizacion_id, c.excedente_id, c.entidad_id, c.productor_id, c.producto,
         c.valorizacion, c.mes, c.kg_conciliados, c.coste_kg,
         (c.retroactiva or c.albaran_ope_id is null) as retroactiva,
         c.albaran_ope_id,
         round(coalesce(c.ope_neto, c.kg_conciliados), 2) as kg_neto,
         round(coalesce(c.ope_neto, c.kg_conciliados) * coalesce(c.coste_kg, 0), 2) as valor
    from conope c;
end;
$$;

comment on function public.cierre_base_transaccion(int, text) is
  'Base de cálculo del certificado de transacción: ventas y maquilas conciliadas del ejercicio (solo equipo; 42501 a una cuenta externa).';

create or replace function public.cierre_pendents_transaccion(p_ejercicio int)
returns table (productor_id uuid, canalizaciones int, kg numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta les transaccions pendents de conciliar'
      using errcode = '42501';
  end if;

  return query
  select e.productor_id, count(*)::int, coalesce(sum(c.kg_confirmados), 0)
    from canalizaciones c
    join excedentes e on e.id = c.excedente_id
   where c.valorizacion in ('venda', 'maquila')
     and c.estado in ('confirmada', 'entregada')
     and extract(year from (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
                              at time zone 'Europe/Madrid'))::int = p_ejercicio
   group by e.productor_id;
end;
$$;

comment on function public.cierre_pendents_transaccion(int) is
  'Ventas y maquilas del ejercicio sin conciliar (solo equipo; 42501 a una cuenta externa).';

-- `create or replace` conserva los privilegios, pero se repiten explícitos: que el diff
-- diga quién puede llamar a cada una.
revoke execute on function public.cierre_base_transaccion(int, text) from public, anon;
revoke execute on function public.cierre_pendents_transaccion(int) from public, anon;
grant execute on function public.cierre_base_transaccion(int, text) to authenticated, service_role;
grant execute on function public.cierre_pendents_transaccion(int) to authenticated, service_role;

-- (2) El snapshot del CT: solo `service_role`, como sus hermanas del CD.
revoke execute on function public.cierre_datos_certificado_transaccion(uuid)
  from public, anon, authenticated;
grant execute on function public.cierre_datos_certificado_transaccion(uuid) to service_role;

-- Verificación (clon local, `begin read only; set local role authenticated;` + claims):
--   receptora / productora:  select * from cierre_base_transaccion(2026);       -- 42501
--                            select * from cierre_pendents_transaccion(2026);   -- 42501
--                            select cierre_datos_certificado_transaccion(…);    -- 42501
--   técnico:                 las dos consultas, filas de siempre; el snapshot, 42501.
--   service_role:            las tres, como antes.
