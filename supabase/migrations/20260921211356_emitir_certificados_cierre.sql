-- Emitir de golpe todos los certificados de donación de un cierre (21-09-2026).
--
-- QUÉ ES. Retirada la exigencia de factura (20260921211329), emitir los certificados de un
-- ejercicio pasa a ser una tanda: el equipo ya no tiene que esperar a que cada donante
-- mande su papel. Esto es el botón «emet-los tots» pedido por el cliente, en una sola
-- transacción y con un informe de qué se emitió y qué se saltó y por qué.
--
-- 🔴 NO LA LLAMAN `cerrar_cierre()` NI `congelar_un_cierre()` / `congelar_ejercicio()`, Y
--    ES A PROPÓSITO. Es tentador meterla dentro del congelador —«ya que cerramos, emitimos
--    todo»— y sería un error caro: el job de `pg_cron` corre a las **23:59 del 31 de
--    diciembre**, sin sesión de nadie, así que `auth.uid()` es NULL y emitiría N documentos
--    con efecto fiscal, con `documentos.emitido_por` nulo, mandando N correos a N donantes
--    reales, sin que nadie esté mirando. Emitir un certificado es un acto del equipo, y
--    tiene que tener una persona detrás. Por eso esta función **se pide expresamente desde
--    el panel, sobre un cierre YA cerrado**, y el congelador se queda emitiendo solo
--    resúmenes, como hasta ahora.
--
-- EL PATRÓN DEL BUCLE es el de `congelar_un_cierre()` (20270301100100:644): un
-- `begin … exception when others` por donante, para que el fallo de uno no tumbe la tanda
-- entera. Y eso hace además algo que no es obvio: el subbloque abre un savepoint, así que
-- un fallo **después** de `siguiente_numero()` devuelve el número a la serie. No quedan
-- huecos, que es la garantía sobre la que descansa toda la numeración (§4).

create or replace function public.emitir_certificados_cierre(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ce        cierres_ejercicio%rowtype;
  par       parametros_documentales%rowtype;
  cd        record;
  v_bloq    text;
  v_emesos  int := 0;
  v_ja      int := 0;
  v_saltats jsonb := '[]'::jsonb;
  v_donant  text;
begin
  -- ⚠️ EL ORDEN DE ESTAS CINCO GUARDAS NO ES NEGOCIABLE. El arnés llama con un uuid
  --    inexistente para medir la guarda de ROL, y espera que después caiga con un error de
  --    NEGOCIO (22023). Si `datos_provisionales` se comprobara antes que la existencia del
  --    cierre, ese check pasaría a devolver 42501 y estaría midiendo otra cosa.

  -- (1) Rol. El idioma de siempre: `service_role` (sin `auth.uid()`) no se queda fuera.
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet certificats' using errcode = '42501';
  end if;

  -- (2) El cierre existe. `for update`: durante la tanda nadie lo cierra ni lo declara.
  select * into ce from cierres_ejercicio where id = p_cierre for update;
  if ce.id is null then
    raise exception 'Aquest tancament no existeix' using errcode = '22023';
  end if;

  -- (3) Solo sobre un ejercicio cerrado. Emitir en bloque sobre un cierre `obert` sería
  --     certificar una cifra que el siguiente `calcular_cierre()` puede cambiar; y sobre
  --     uno `declarat`, emitir después del 182, que ya rechaza `emitir_certificado()` uno
  --     a uno (D10). Los dos casos caen aquí con el mismo mensaje.
  if ce.estado <> 'tancat' then
    raise exception 'Nomes s''emeten en bloc els certificats d''un tancament tancat: tanca l''exercici primer (estat actual: %)',
      ce.estado using errcode = '22023';
  end if;

  -- (4) Y calculado: sin cálculo no hay acumulado que certificar.
  if ce.calculado_at is null then
    raise exception 'Aquest tancament no s''ha calculat encara' using errcode = '22023';
  end if;

  -- (5) Datos de la Fundación de verdad. **Fuera del bucle a propósito**: dentro daría N
  --     donantes saltados con el mismo motivo y un informe que parece un problema de datos
  --     de los donantes cuando el problema es de Configuració.
  select * into par from parametros_documentales where id = 1;
  if coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  -- Los que ya tienen certificado no son un error ni un salto: son trabajo hecho. Se
  -- cuentan aparte para que el informe no los mezcle con los que no se han podido emitir.
  select count(*) into v_ja
    from cierres_donante
   where cierre_id = p_cierre and tipo = 'donacio' and certificado_numero is not null;

  for cd in select * from cierres_donante
             where cierre_id = p_cierre
               and tipo = 'donacio'
               and certificado_numero is null
             order by created_at
  loop
    v_donant := coalesce(cd.datos_fiscales->>'raó_social',
                         (select coalesce(p.empresa, p.name) from productores p
                           where p.id = cd.productor_id),
                         cd.productor_id::text);

    -- (a) Algún bloqueo que bloquea de verdad. Mismo criterio que `emitir_certificado()`.
    select string_agg(b->>'detall', '; ') into v_bloq
      from jsonb_array_elements(cd.bloqueos) b where (b->>'bloqueja')::boolean;
    if v_bloq is not null then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'bloquejat', 'motiu', v_bloq);
      continue;
    end if;

    -- (b) Sin kilos o sin valor: un certificado de 0 no tiene sentido.
    if cd.kg_total <= 0 or cd.valor_total <= 0 then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'sense_kg',
        'motiu', 'Sense quilos o sense valor (' || round(cd.kg_total, 1)::text || ' kg, '
                 || round(cd.valor_total, 2)::text || ' EUR)');
      continue;
    end if;

    -- (c) El resto lo decide `emitir_certificado()`, que es la única definición de «cómo
    --     se emite un certificado». Aquí no se duplica ni una guarda suya: si añade una
    --     mañana, esta tanda la respeta sola. `null` en el motivo porque desde el
    --     21-09-2026 ese parámetro se ignora (20260921211329).
    begin
      perform public.emitir_certificado(cd.id, null);
      v_emesos := v_emesos + 1;
    exception when others then
      -- El savepoint del subbloque devuelve a la serie el número que se hubiera
      -- consumido, así que un fallo aquí no deja hueco en CD / P-CD.
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'error', 'motiu', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'tancament', p_cierre,
    'exercici',  ce.ejercicio,
    'mode',      ce.modo,
    'emesos',    v_emesos,
    'ja_tenien', v_ja,
    'saltats',   v_saltats);
end;
$$;

comment on function public.emitir_certificados_cierre(uuid) is
  'Emite todos los certificados de donación pendientes de un cierre ya cerrado. La llama el panel, NUNCA el job de congelación: un certificado necesita una persona detrás.';

-- ---------------------------------------------------------------------------
-- EXECUTE
-- ---------------------------------------------------------------------------
-- ⚠️ Función NUEVA: `create function` concede EXECUTE a PUBLIC. Sin este revoke, `anon`
--    podría emitir todos los certificados de un ejercicio sin ni siquiera tener sesión.
revoke execute on function public.emitir_certificados_cierre(uuid) from public, anon;
grant  execute on function public.emitir_certificados_cierre(uuid) to authenticated, service_role;

-- Verificación (sobre un cierre de PRUEBA ya cerrado):
--   select emitir_certificados_cierre('<cierre>');
--     -> {"emesos": n, "ja_tenien": m, "saltats": [{"cd": …, "donant": …, "codi": …}]}
--   select emitir_certificados_cierre('00000000-0000-0000-0000-000000000000');  -- 22023
