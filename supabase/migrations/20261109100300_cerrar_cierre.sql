-- Cerrar UN cierre desde el panel: el botón «Tanca l'exercici».
--
-- EL HUECO QUE CIERRA. `congelar_ejercicio(int)` (20261109100200) es del planificador y
-- lleva `revoke execute … from authenticated` a propósito, así que la pantalla
-- `/equip/tancament/:id` recibía un `42501` de la plataforma al pulsar el botón que la
-- propia cabecera de aquel fichero da por existente («El botón «Tanca» sigue existiendo
-- en el panel —el job es la red, no la única vía—»). No había ninguna RPC que moviera la
-- cabecera a `tancat`.
--
-- POR QUÉ UNA RPC NUEVA Y NO UN GRANT SOBRE `congelar_ejercicio`. No son la misma
-- operación: el job congela **todos** los cierres `obert`/`provisional` de un ejercicio
-- —que pueden ser varios ensayos y el real— y la pantalla quiere cerrar **uno**, el que
-- tiene delante, por su uuid. Conceder EXECUTE al job convertiría un botón sobre un
-- cierre de prueba en un cierre de todo el año, incluido el real. Se separa, pues, en:
--
--   congelar_un_cierre(uuid)  -> el trabajo, interno, sin comprobar rol (service_role)
--   cerrar_cierre(uuid)       -> lo que llama el panel: comprueba rol y delega
--   congelar_ejercicio(int)   -> recreada para que el bucle llame al mismo trabajo
--
-- Así hay **una sola implementación** de «qué significa congelar un cierre». Antes de
-- esto la habría copiada dos veces, que es como se consigue que el botón y el job acaben
-- congelando cosas distintas.
--
-- ⚠️ POR QUÉ CERRAR UN CIERRE **REAL** EXIGE `es_super_admin()` Y NO `pot_aprovar()`.
--    Simetría con `abrir_cierre`, y por un motivo más fuerte que la simetría: cerrar no es
--    el reverso de abrir, es el acto **irreversible**. Abrir un cierre real consume la
--    serie del año; cerrarlo emite los **resúmenes definitivos** —el papel con el que se
--    le pide al donante su factura—, congela el cálculo y deja el ejercicio en un estado
--    del que `calcular_cierre()` ya no puede sacarlo: a partir de ahí toda corrección pasa
--    por `rectificar_certificado()`, que numera una rectificativa. O sea que el error de
--    un clic no se deshace, se documenta. Un cierre en modo **prueba** no tiene ninguna de
--    esas consecuencias (series `P-*`, destinatarios forzados al equipo, y
--    `reiniciar_cierre_prueba()` lo borra entero), así que ahí basta `pot_aprovar()`:
--    exigir el super_admin para un ensayo solo conseguiría que el ensayo no se hiciera.

-- ---------------------------------------------------------------------------
-- 1. congelar_un_cierre(): el trabajo, sin comprobación de rol
-- ---------------------------------------------------------------------------
-- Interna: la llaman `cerrar_cierre()` (que ya ha comprobado quién eres) y
-- `congelar_ejercicio()` (que corre sin sesión desde `pg_cron`). `authenticated` no la ve.
-- No valida el estado: eso lo hace cada llamante, porque el job **filtra** por estado y el
-- panel tiene que **explicar** por qué no puede.
create or replace function public.congelar_un_cierre(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd         record;
  v_res      int := 0;
  v_saltados int := 0;
  v_errores  jsonb := '[]'::jsonb;
begin
  perform public.calcular_cierre(p_cierre);

  for cd in select * from cierres_donante where cierre_id = p_cierre order by created_at loop
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
   where id = p_cierre;

  return jsonb_build_object('tancament', p_cierre, 'resums_definitius', v_res,
                            'donants_bloquejats', v_saltados, 'errors', v_errores);
end;
$$;

comment on function public.congelar_un_cierre(uuid) is
  'Interna: recalcula un cierre, emite sus resúmenes definitivos y lo pasa a tancat. No comprueba rol ni estado.';

-- ---------------------------------------------------------------------------
-- 2. cerrar_cierre(): lo que llama el panel
-- ---------------------------------------------------------------------------
create or replace function public.cerrar_cierre(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ce  cierres_ejercicio%rowtype;
  res jsonb;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar tanca un exercici' using errcode = '42501';
  end if;

  -- `for update`: entre la comprobación del estado y el `update` de dentro no puede
  -- colarse el job de fin de año ni un segundo clic.
  select * into ce from cierres_ejercicio where id = p_cierre for update;
  if ce.id is null then
    raise exception 'Aquest tancament no existeix' using errcode = '22023';
  end if;

  -- Ver la advertencia de la cabecera: el real lo cierra el super_admin.
  if ce.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin tanca el tancament real' using errcode = '42501';
  end if;

  if ce.estado not in ('obert', 'provisional') then
    raise exception 'Un tancament % ja no es pot tancar', ce.estado using errcode = '22023';
  end if;

  res := public.congelar_un_cierre(p_cierre);
  return res || jsonb_build_object('exercici', ce.ejercicio, 'mode', ce.modo);
end;
$$;

comment on function public.cerrar_cierre(uuid) is
  'Cierra UN cierre: recalcula, emite los resúmenes definitivos y lo pasa a tancat. Real -> super_admin.';

-- ---------------------------------------------------------------------------
-- 3. congelar_ejercicio(): misma firma y mismo contrato, un solo cuerpo
-- ---------------------------------------------------------------------------
-- `create or replace` conserva la firma y los GRANT de 20261109100200 (service_role, y
-- nadie más). Lo único que cambia es que el bucle delega en `congelar_un_cierre()` en vez
-- de repetir su cuerpo. La agenda de `pg_cron` no se toca: apunta al nombre, no al cuerpo.
create or replace function public.congelar_ejercicio(p_ejercicio int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ej       int;
  ce         record;
  r          jsonb;
  v_cierres  int := 0;
  v_res      int := 0;
  v_saltados int := 0;
  v_errores  jsonb := '[]'::jsonb;
begin
  v_ej := coalesce(p_ejercicio,
                   extract(year from (now() at time zone 'Europe/Madrid'))::int);

  for ce in select * from cierres_ejercicio
             where ejercicio = v_ej and estado in ('obert', 'provisional')
             order by modo, created_at
  loop
    r := public.congelar_un_cierre(ce.id);
    v_cierres  := v_cierres + 1;
    v_res      := v_res + coalesce((r->>'resums_definitius')::int, 0);
    v_saltados := v_saltados + coalesce((r->>'donants_bloquejats')::int, 0);
    v_errores  := v_errores || coalesce(r->'errors', '[]'::jsonb);
  end loop;

  return jsonb_build_object('exercici', v_ej, 'tancaments', v_cierres,
                            'resums_definitius', v_res, 'donants_bloquejats', v_saltados,
                            'errors', v_errores);
end;
$$;

comment on function public.congelar_ejercicio(int) is
  'Congela los cierres abiertos del ejercicio: recalcula, emite resúmenes definitivos y pasa a tancat. Cron en UTC.';

-- ---------------------------------------------------------------------------
-- 4. EXECUTE
-- ---------------------------------------------------------------------------
-- ⚠️ `create or replace` NO devuelve el EXECUTE a PUBLIC (eso solo pasa al crear), pero
--    `congelar_un_cierre` es nueva y sí lo trae.
revoke execute on function public.congelar_un_cierre(uuid) from public, anon, authenticated;
grant  execute on function public.congelar_un_cierre(uuid) to service_role;

revoke execute on function public.congelar_ejercicio(int)  from public, anon, authenticated;
grant  execute on function public.congelar_ejercicio(int)  to service_role;

revoke execute on function public.cerrar_cierre(uuid) from public, anon;
grant  execute on function public.cerrar_cierre(uuid) to authenticated, service_role;

-- Verificación:
--   select cerrar_cierre('<id d''un tancament de prova>');   -- {'tancament': …, 'mode': 'prueba'}
--   select cerrar_cierre('<el mateix>');                     -- 22023: ja no es pot tancar
--   -- amb una sessio externa: 42501
