-- Certificados de TRANSACCIÓN (CT) en el cierre: calcularlos siempre, emitirlos en bloque y
-- no declararlos en el 182.
--
-- Tres huecos del cierre anual, vistos en el clon el 07-10-2026:
--
--   (1) `calcular_cierre()` solo calculaba las filas `donacio`. Las de `transaccio` (venta y
--       maquila, el CT) solo las calculaba `congelar_un_cierre()` al CERRAR, así que hasta el
--       último momento el equipo no veía ni a los generadores con CT ni sus bloqueos. Ahora
--       `calcular_cierre()` llama también a `calcular_cierre_transacciones()`, que ya era
--       idempotente (borra y reinserta sus líneas) y tiene las mismas guardas (pot_aprovar,
--       cierre `obert`/`provisional`). El resumen que devuelve conserva todas sus claves de
--       antes y gana `transaccions` con el de la otra función.
--       ⚠️ `congelar_un_cierre()` sigue llamando a las dos: ahora el cálculo de
--          transacciones corre dos veces al cerrar. Es idempotente, y no se toca aquella
--          función por un recálculo de más en un acto que ocurre una vez al año.
--
--   (2) No había forma de emitir los CT de un cierre de golpe: `emitir_certificados_cierre()`
--       filtra `tipo = 'donacio'`. `emitir_certificados_transaccion_cierre()` es su espejo:
--       mismas cinco guardas EN EL MISMO ORDEN (el arnés llama con un uuid inexistente y
--       espera el 22023 de la segunda), recorre las filas `transaccio` sin número, salta las
--       bloqueadas y las de 0 kg con su código, y emite el resto con
--       `emitir_certificado_transaccion()` en subbloques (un fallo devuelve el número a la
--       serie y no tumba la tanda). Un CT no lleva importes, así que «sin valor» no es motivo
--       para saltarlo, al revés que en el CD. Devuelve `{emesos, ja_tenien, saltats}`.
--       🔴 Como la del CD, NO la llama `cerrar_cierre()` ni el job de fin de año.
--
--   (3) `marcar_declarado()` marcaba `declarat` TODAS las filas con número, CT incluidos.
--       El CT no va al modelo 182 (`datos_182()` solo lee donaciones), así que decir de él que
--       está «declarado» es falso. Ahora solo marca `tipo = 'donacio'`.

-- ---------------------------------------------------------------------------
-- (1) calcular_cierre(): también las transacciones
-- ---------------------------------------------------------------------------
create or replace function public.calcular_cierre(p_cierre uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  ce      cierres_ejercicio%rowtype;
  v_don   int;
  v_lin   int;
  v_tra   jsonb;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar calcula un tancament' using errcode = '42501';
  end if;

  select * into ce from cierres_ejercicio where id = p_cierre for update;
  if ce.id is null then
    raise exception 'Aquest tancament no existeix' using errcode = '22023';
  end if;
  if ce.estado not in ('obert', 'provisional') then
    raise exception 'Un tancament % ja no es recalcula', ce.estado using errcode = '22023';
  end if;

  insert into cierres_donante (cierre_id, productor_id, tipo)
  select p_cierre, d.productor_id, 'donacio'
    from (
      select productor_id from public.cierre_base(ce.ejercicio, ce.modo)
      union
      select productor_id from public.cierre_pendents(ce.ejercicio)
    ) d
  on conflict (cierre_id, productor_id, tipo) do nothing;

  delete from cierre_donante_lineas
   where cierre_donante_id in (select id from cierres_donante
                                where cierre_id = p_cierre and tipo = 'donacio');

  insert into cierre_donante_lineas (
    cierre_donante_id, canalizacion_id, albaran_rec_id, producto, mes,
    kg_neto, coste_kg, valor, entidad_id, retroactiva)
  select cd.id, b.canalizacion_id, b.albaran_rec_id, b.producto, b.mes,
         b.kg_neto, b.coste_kg, b.valor, b.entidad_id, b.retroactiva
    from public.cierre_base(ce.ejercicio, ce.modo) b
    join cierres_donante cd on cd.cierre_id = p_cierre and cd.tipo = 'donacio'
                           and cd.productor_id = b.productor_id;
  get diagnostics v_lin = row_count;

  update cierres_donante cd
     set kg_total     = (select coalesce(sum(l.kg_neto), 0) from cierre_donante_lineas l
                          where l.cierre_donante_id = cd.id),
         valor_total  = (select coalesce(sum(l.valor), 0) from cierre_donante_lineas l
                          where l.cierre_donante_id = cd.id),
         calculado_at = now(),
         datos_fiscales = jsonb_build_object(
           'raó_social', coalesce(pr.empresa, pr.name),
           'nif', pr.nif,
           'domicili', pr.direccion,
           'codi_postal', pr.codigo_postal,
           'poblacio', pr.poblacion,
           'provincia', public.provincia_por_cp(pr.codigo_postal),
           'email', pr.email),
         bloqueos = (
           select coalesce(jsonb_agg(x), '[]'::jsonb) from (
             select jsonb_build_object('codigo', 'sense_conciliar', 'bloqueja', true,
                      'detall', pe.canalizaciones::text || ' canalitzacions sense conciliar ('
                                || round(pe.kg, 1)::text || ' kg)') as x
               from public.cierre_pendents(ce.ejercicio) pe
              where pe.productor_id = cd.productor_id
             union all
             select jsonb_build_object('codigo', 'sense_cost', 'bloqueja', true,
                      'detall', 'Sense cost per quilo de ' || ce.ejercicio::text || ': '
                                || string_agg(distinct coalesce(l.producto, '(sense producte)'), ', '))
               from cierre_donante_lineas l
              where l.cierre_donante_id = cd.id and l.coste_kg is null
             having count(*) > 0
             union all
             select jsonb_build_object('codigo', 'dades_fiscals', 'bloqueja', true,
                      'detall', 'Falten dades fiscals: ' || array_to_string(array_remove(array[
                        case when coalesce(btrim(pr.nif), '') = '' then 'NIF' end,
                        case when coalesce(btrim(pr.direccion), '') = '' then 'domicili' end,
                        case when coalesce(btrim(pr.codigo_postal), '') = '' then 'codi postal' end,
                        case when coalesce(btrim(pr.poblacion), '') = '' then 'poblacio' end],
                        null), ', '))
              where coalesce(btrim(pr.nif), '') = ''
                 or coalesce(btrim(pr.direccion), '') = ''
                 or coalesce(btrim(pr.codigo_postal), '') = ''
                 or coalesce(btrim(pr.poblacion), '') = ''
             union all
             select jsonb_build_object('codigo', 'sense_rec', 'bloqueja', false,
                      'detall', count(*)::text || ' canalitzacions sense albara de recepcio conciliat')
               from cierre_donante_lineas l
              where l.cierre_donante_id = cd.id and l.albaran_rec_id is null
             having count(*) > 0
             union all
             select jsonb_build_object('codigo', 'certificat_desactualitzat', 'bloqueja', false,
                      'detall', 'El certificat ' || cd.certificado_numero
                                || ' es va emetre per un altre import: cal rectificar-lo')
              where cd.certificado_numero is not null
                and round(cd.valor_total, 2) <> round((select coalesce(sum(l.valor), 0)
                                                         from cierre_donante_lineas l
                                                        where l.cierre_donante_id = cd.id), 2)
           ) b(x))
    from productores pr
   where cd.cierre_id = p_cierre and cd.tipo = 'donacio' and pr.id = cd.productor_id;
  get diagnostics v_don = row_count;

  update cierres_ejercicio set calculado_at = now() where id = p_cierre;

  -- Las transacciones (CT), en la misma llamada. Misma transacción y mismo `for update`
  -- sobre el cierre, que ya tenemos tomado.
  v_tra := public.calcular_cierre_transacciones(p_cierre);

  return jsonb_build_object(
    'tancament', p_cierre, 'exercici', ce.ejercicio, 'mode', ce.modo,
    'donants', v_don, 'linies', v_lin,
    'kg_total', (select coalesce(sum(kg_total), 0) from cierres_donante
                  where cierre_id = p_cierre and tipo = 'donacio'),
    'valor_total', (select coalesce(sum(valor_total), 0) from cierres_donante
                     where cierre_id = p_cierre and tipo = 'donacio'),
    'bloquejats', (select count(*) from cierres_donante
                    where cierre_id = p_cierre and tipo = 'donacio'
                      and exists (select 1 from jsonb_array_elements(bloqueos) b
                                   where (b->>'bloqueja')::boolean)),
    'transaccions', v_tra);
end;
$function$;

revoke execute on function public.calcular_cierre(uuid) from public, anon;
grant  execute on function public.calcular_cierre(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (2) Emitir en bloque los CT de un cierre
-- ---------------------------------------------------------------------------
create or replace function public.emitir_certificados_transaccion_cierre(p_cierre uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  ce        cierres_ejercicio%rowtype;
  par       parametros_documentales%rowtype;
  cd        record;
  v_bloq    text;
  v_emesos  int := 0;
  v_ja      int := 0;
  v_saltats jsonb := '[]'::jsonb;
  v_gen     text;
begin
  -- ⚠️ El orden de las cinco guardas es el de `emitir_certificados_cierre()`, y por el
  --    mismo motivo: el arnés mide la de ROL con un uuid inexistente y espera el 22023 de
  --    la (2).

  -- (1) Rol.
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet certificats' using errcode = '42501';
  end if;

  -- (2) El cierre existe; `for update` durante la tanda.
  select * into ce from cierres_ejercicio where id = p_cierre for update;
  if ce.id is null then
    raise exception 'Aquest tancament no existeix' using errcode = '22023';
  end if;

  -- (3) Cerrado.
  if ce.estado <> 'tancat' then
    raise exception 'Nomes s''emeten en bloc els certificats d''un tancament tancat: tanca l''exercici primer (estat actual: %)',
      ce.estado using errcode = '22023';
  end if;

  -- (4) Calculado.
  if ce.calculado_at is null then
    raise exception 'Aquest tancament no s''ha calculat encara' using errcode = '22023';
  end if;

  -- (5) Datos de la Fundación, solo en modo real. Fuera del bucle.
  select * into par from parametros_documentales where id = 1;
  if ce.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat REAL. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  select count(*) into v_ja
    from cierres_donante
   where cierre_id = p_cierre and tipo = 'transaccio' and certificado_numero is not null;

  for cd in select * from cierres_donante
             where cierre_id = p_cierre
               and tipo = 'transaccio'
               and certificado_numero is null
             order by created_at
  loop
    v_gen := coalesce(cd.datos_fiscales->>'raó_social',
                      (select coalesce(p.empresa, p.name) from productores p
                        where p.id = cd.productor_id),
                      cd.productor_id::text);

    -- (a) Bloqueos que bloquean de verdad.
    select string_agg(b->>'detall', '; ') into v_bloq
      from jsonb_array_elements(cd.bloqueos) b where (b->>'bloqueja')::boolean;
    if v_bloq is not null then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'generador', v_gen, 'codi', 'bloquejat', 'motiu', v_bloq);
      continue;
    end if;

    -- (b) Sin kilos. El CT no lleva importe, así que el valor no cuenta aquí.
    if cd.kg_total <= 0 then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'generador', v_gen, 'codi', 'sense_kg',
        'motiu', 'Sense quilos (' || round(cd.kg_total, 1)::text || ' kg)');
      continue;
    end if;

    -- (c) El resto lo decide `emitir_certificado_transaccion()`.
    begin
      perform public.emitir_certificado_transaccion(cd.id);
      v_emesos := v_emesos + 1;
    exception when others then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'generador', v_gen, 'codi', 'error', 'motiu', sqlerrm);
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
$function$;

comment on function public.emitir_certificados_transaccion_cierre(uuid) is
  'Emite en bloque los certificados de transaccion (CT) de un cierre tancat. Espejo de emitir_certificados_cierre() (20270414100200).';
revoke execute on function public.emitir_certificados_transaccion_cierre(uuid) from public, anon;
grant  execute on function public.emitir_certificados_transaccion_cierre(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (3) marcar_declarado(): solo las donaciones van al 182
-- ---------------------------------------------------------------------------
create or replace function public.marcar_declarado(p_cierre uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_n int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar marca un exercici com a declarat' using errcode = '42501';
  end if;
  if not exists (select 1 from cierres_ejercicio
                  where id = p_cierre and estado in ('tancat', 'provisional')) then
    raise exception 'Nomes es declara un exercici tancat' using errcode = '22023';
  end if;

  -- El CT (`transaccio`) no va al modelo 182: no se marca como declarado.
  update cierres_donante set estado = 'declarat', declarado_at = now()
   where cierre_id = p_cierre and tipo = 'donacio' and certificado_numero is not null;
  get diagnostics v_n = row_count;

  update cierres_ejercicio set estado = 'declarat', declarado_at = now() where id = p_cierre;
  return jsonb_build_object('tancament', p_cierre, 'donants_declarats', v_n);
end;
$function$;

revoke execute on function public.marcar_declarado(uuid) from public, anon;
grant  execute on function public.marcar_declarado(uuid) to authenticated, service_role;
