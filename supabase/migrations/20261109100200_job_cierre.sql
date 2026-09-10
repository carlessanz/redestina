-- El job que congela el ejercicio la noche del 31 de diciembre.
--
-- QUÉ HACE. A las 23:59 de Madrid del 31 de diciembre, para cada cierre `obert` o
-- `provisional` de ese ejercicio: recalcula, lo pasa a `tancat` y emite el **resumen
-- definitivo** de cada donante que no tenga bloqueos. A partir de ahí el cálculo ya no
-- cambia solo: cualquier conciliación posterior exige rectificar a mano y deja rastro.
--
-- POR QUÉ UN JOB Y NO UN BOTÓN. El corte es una fecha, no una decisión: una recogida del
-- 31 de diciembre a las 23:30 pertenece a ese ejercicio y una del 1 de enero al siguiente
-- (§3.5.2). Si el corte dependiera de cuándo alguien pulsa, dos donantes con la misma
-- entrega podrían caer en años distintos. El botón «Tanca» sigue existiendo en el panel
-- —el job es la red, no la única vía—.
--
-- ⚠️ LA AGENDA DE `pg_cron` VA EN UTC, NO EN HORA LOCAL. `59 22 31 12 *` son las 22:59
--    UTC del 31 de diciembre, que en Madrid (CET, UTC+1 en invierno) son **las 23:59 del
--    31 de diciembre**, que es lo que se quiere. Escribir `59 23 31 12 *` lo dispararía a
--    las 00:59 del 1 de enero, o sea **ya en el ejercicio siguiente**, y el cierre saldría
--    con un día de más y otro de menos. No es un detalle de estilo: es el único sitio del
--    proyecto donde una hora mal puesta cambia el contenido de un documento fiscal.
--    (Si algún día España deja de cambiar de hora y el invierno pasa a UTC+2, hay que
--    mover esto a `59 21 31 12 *`.)
--
-- EN 2026 SOLO HABRÁ CIERRES DE PRUEBA, así que lo que este job congelará esa noche son
-- ensayos. Es a propósito: el ensayo tiene que recorrer también este paso.

-- ---------------------------------------------------------------------------
-- 1. congelar_ejercicio()
-- ---------------------------------------------------------------------------
-- La ejecuta el planificador, sin sesión: `auth.uid()` es null y por tanto pasa las
-- comprobaciones de rol de las RPC, que están escritas como
-- `if auth.uid() is not null and not pot_aprovar()`. Es el mismo patrón que
-- `marcar_excedentes_vencidos()` y que los jobs documentales (20260928100700).
--
-- `p_ejercicio` es opcional para poder ensayarla en cualquier fecha:
--   select public.congelar_ejercicio(2026);
create or replace function public.congelar_ejercicio(p_ejercicio int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ej     int;
  ce       record;
  cd       record;
  v_cierres int := 0;
  v_res    int := 0;
  v_saltados int := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  v_ej := coalesce(p_ejercicio,
                   extract(year from (now() at time zone 'Europe/Madrid'))::int);

  for ce in select * from cierres_ejercicio
             where ejercicio = v_ej and estado in ('obert', 'provisional')
             order by modo, created_at
  loop
    perform public.calcular_cierre(ce.id);

    for cd in select * from cierres_donante where cierre_id = ce.id order by created_at loop
      -- Con bloqueos no se envía nada: un resumen definitivo con los kilos a medias le
      -- pediría al donante una factura por un importe que va a cambiar.
      if exists (select 1 from jsonb_array_elements(cd.bloqueos) b
                  where (b->>'bloqueja')::boolean)
         or cd.kg_total <= 0 then
        v_saltados := v_saltados + 1;
        continue;
      end if;

      -- Un fallo en un donante (una ficha sin correo, por ejemplo) no puede dejar sin
      -- cerrar a los demás: se anota y se sigue.
      begin
        perform public.emitir_resumen(cd.id, false);
        v_res := v_res + 1;
      exception when others then
        v_errores := v_errores || jsonb_build_object('donant', cd.id, 'error', sqlerrm);
      end;
    end loop;

    update cierres_ejercicio
       set estado = 'tancat', cerrado_at = now()
     where id = ce.id;
    v_cierres := v_cierres + 1;
  end loop;

  return jsonb_build_object('exercici', v_ej, 'tancaments', v_cierres,
                            'resums_definitius', v_res, 'donants_bloquejats', v_saltados,
                            'errors', v_errores);
end;
$$;

comment on function public.congelar_ejercicio(int) is
  'Congela los cierres abiertos del ejercicio: recalcula, emite resúmenes definitivos y pasa a tancat. Cron en UTC.';

revoke execute on function public.congelar_ejercicio(int) from public, anon, authenticated;
grant  execute on function public.congelar_ejercicio(int) to service_role;

-- ---------------------------------------------------------------------------
-- 2. La agenda (idempotente, como los otros jobs)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('congelar-ejercicio')
    where exists (select 1 from cron.job where jobname = 'congelar-ejercicio');
exception when others then null;
end $$;

-- 22:59 UTC del 31 de diciembre = 23:59 en Madrid (ver la advertencia de la cabecera).
select cron.schedule('congelar-ejercicio', '59 22 31 12 *',
                     'select public.congelar_ejercicio()');

-- Verificación:
--   select jobname, schedule, active from cron.job where jobname = 'congelar-ejercicio';
--   select public.congelar_ejercicio(2026);   -- ensayo en cualquier fecha
