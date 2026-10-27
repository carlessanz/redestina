-- ---------------------------------------------------------------------------
-- `reiniciar_cierre_prueba()` deja cada serie de prueba en el último número que sigue vivo
-- ---------------------------------------------------------------------------
-- Deuda §12.145 (27-10-2026). `20270322100000` ya lo dejó escrito en su cabecera («LO QUE
-- ESTO NO ARREGLA»): la función resetea las series por EJERCICIO, no por cierre, y como el
-- índice único parcial de `cierres_ejercicio` solo cubre `modo = 'real'`, puede haber varios
-- cierres de prueba del mismo año. Reiniciar uno ponía `P-RES`, `P-CD` y `P-CT` a 0 aunque
-- el otro conservara sus documentos, y la siguiente emisión en ese otro cierre volvía a
-- pedir `P-CD-2026-0001` y moría con `23505 documentos_numero_version_uidx`.
--
-- Ya es alcanzable en producción: hay DOS cierres de prueba de 2026 (`42e45d82…`, con
-- `P-CD-2026-0001` emitido el 21-09, y `a4723ddf…`, vacío). Pulsar «Reinicia la prova» en el
-- vacío habría dejado la serie en 0 y el primero ya no podría emitir su siguiente
-- certificado. Lo destapó `tests/e2e/certificats.e2e.ts` en el clon.
--
-- QUÉ CAMBIA: el `update` de las series ya no escribe 0, escribe el número más alto que
-- sigue existiendo en `documentos` para esa serie y ese ejercicio después del `delete` (0 si
-- no queda ninguno, que es el caso de siempre con un solo cierre de prueba). Así el contador
-- nunca queda por debajo de un documento vivo, y con un solo cierre el resultado es el mismo
-- de antes. Los números se leen del final de `numero_completo` (`P-CD-2026-0007` → 7), la
-- misma forma que compone `formato_numero()`.
--
-- ⚠️ `reiniciar_periodes_prova()` y `reiniciar_recepcions_prova()` NO tienen el problema:
--    borran TODOS los documentos de prueba de su ejercicio, no los de un objeto, así que su
--    0 es exacto. No se tocan.
-- ⚠️ Por si alguna serie de prueba ya hubiera quedado por debajo (no es el caso en
--    producción el 27-10-2026: `P-CD` 2026 está en 1), el final realinea los contadores de
--    las series de prueba al máximo vivo. Solo sube, nunca baja, y no toca ninguna serie legal.
-- ⚠️ `create or replace` reescribe todos los atributos: se repiten `volatile`,
--    `security definer` y `set search_path`, y los privilegios.
-- ---------------------------------------------------------------------------

create or replace function public.reiniciar_cierre_prueba(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ce      cierres_ejercicio%rowtype;
  v_docs  int;
  v_enl   int;
  v_don   int;
  v_lin   int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar reinicia una prova' using errcode = '42501';
  end if;

  select * into ce from cierres_ejercicio where id = p_cierre for update;
  if ce.id is null then
    raise exception 'Aquest tancament no existeix' using errcode = '22023';
  end if;
  if ce.modo <> 'prueba' then
    raise exception 'Nomes es reinicia un tancament de PROVA' using errcode = '42501';
  end if;

  perform set_config('redestina.reinicio_prueba', 'on', true);

  -- `documento_envios` cae por cascada; el trigger comprueba además que `modo = 'prueba'`.
  -- Sin filtro por `tipo`: entran los RES, los CD y los CT de este cierre.
  delete from documentos
   where objeto_tipo = 'cierre_donante'
     and objeto_id in (select id from cierres_donante where cierre_id = p_cierre);
  get diagnostics v_docs = row_count;

  -- `evidencias` cae por cascada del enlace.
  delete from enlaces_token
   where objeto_tipo = 'cierre_donante'
     and objeto_id in (select id from cierres_donante where cierre_id = p_cierre);
  get diagnostics v_enl = row_count;

  delete from cierre_donante_lineas
   where cierre_donante_id in (select id from cierres_donante where cierre_id = p_cierre);
  get diagnostics v_lin = row_count;

  delete from cierres_donante where cierre_id = p_cierre;
  get diagnostics v_don = row_count;

  -- El último número que SIGUE VIVO en cada serie (de otro cierre de prueba del mismo
  -- año), o 0 si no queda ninguno. Nunca por debajo de un documento vivo: eso es lo que
  -- choca con el índice único `(numero_completo, version)` en la siguiente emisión.
  update series_documentales s
     set ultimo = coalesce((
           select max((regexp_match(d.numero_completo, '(\d+)$'))[1]::int)
             from documentos d
            where d.serie = s.serie and d.ejercicio = s.ejercicio), 0)
   where s.ejercicio = ce.ejercicio and s.serie in ('P-RES', 'P-CD', 'P-CT');

  update cierres_ejercicio
     set estado = 'obert', calculado_at = null, provisional_at = null,
         cerrado_at = null, declarado_at = null
   where id = p_cierre;

  return jsonb_build_object('tancament', p_cierre, 'documents', v_docs, 'enllacos', v_enl,
                            'donants', v_don, 'linies', v_lin,
                            'canalitzacions', (select count(*) from canalizaciones),
                            'albarans', (select count(*) from albaranes));
end;
$$;

comment on function public.reiniciar_cierre_prueba(uuid) is
  'Repite el ensayo de un cierre de PRUEBA: borra sus lineas, donantes, documentos (RES, CD y CT) y enlaces, y deja los contadores P-RES, P-CD y P-CT del ejercicio en el ultimo numero que siga vivo de otro cierre de prueba (0 si no queda ninguno). No toca ninguna canalizacion ni ningun albaran.';

revoke execute on function public.reiniciar_cierre_prueba(uuid) from public, anon;
grant  execute on function public.reiniciar_cierre_prueba(uuid) to authenticated, service_role;

-- Realineación de lo que ya hubiera quedado por debajo (solo series de prueba, solo sube).
update series_documentales s
   set ultimo = m.maxim
  from (select serie, ejercicio, max((regexp_match(numero_completo, '(\d+)$'))[1]::int) as maxim
          from documentos
         where serie = 'PROVA' or serie like 'P-%'
         group by serie, ejercicio) m
 where m.serie = s.serie and m.ejercicio = s.ejercicio and m.maxim > s.ultimo;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
--   -- Ninguna serie (de prueba o legal) por debajo de sus documentos vivos: 0 filas.
--   select s.serie, s.ejercicio, s.ultimo, m.maxim from series_documentales s
--     join (select serie, ejercicio, max((regexp_match(numero_completo, '(\d+)$'))[1]::int) maxim
--             from documentos group by 1, 2) m using (serie, ejercicio)
--    where m.maxim > s.ultimo;
