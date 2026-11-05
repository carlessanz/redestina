-- El certificado de transacción (CT) se retira (05-11-2026).
--
-- Decisión de Carles del 05-11-2026 (plan «Certificat de donació según el modelo de
-- Tabaquet»): el CT —venta y maquila, sin importes, fase 5 (20270301100100)— sale de la
-- interfaz y **no se emiten nuevos**. Lo ya emitido se conserva y se sigue pudiendo
-- descargar (las filas `cierres_donante.tipo = 'transaccio'`, sus líneas y sus
-- `documentos` no se tocan; en línea con D20).
--
--   · `emitir_certificado_transaccion(p_cd)`, `emitir_certificados_transaccion_cierre(p_cierre)`
--     y `rectificar_certificado_transaccion(p_cd, p_motivo)` responden
--     `22023 certificat_transaccio_retirat` DESPUÉS de la guarda de permiso, que sigue
--     primero (§4bis: el permiso antes que la existencia; el arnés mide las dos cosas).
--     La rectificación también se retira: produce un documento nuevo, y desde hoy nada
--     recalcula una fila de transacción, así que «rectificar» solo podría reimprimir lo
--     mismo con otro número de versión. Un CT emitido con un error se corrige fuera.
--
--   · `calcular_cierre_transacciones(p_cierre)` deja de crear y recalcular filas: tras la
--     guarda devuelve `{retirat: true, generadors: 0, linies: 0}`. No lanza porque la
--     llaman `congelar_un_cierre()` y `congelar_ejercicio()` (el job de fin de año), que
--     no deben caer por esto.
--
--   · `calcular_cierre(p_cierre)` ya no la llama: `transaccions` vuelve `null`.
--
-- Mismas firmas → `create or replace` (conserva los ACL).

-- ---------------------------------------------------------------------------
-- 1. Emitir, emitir en bloque y rectificar: retirados
-- ---------------------------------------------------------------------------
create or replace function public.emitir_certificado_transaccion(p_cd uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un certificat' using errcode = '42501';
  end if;
  raise exception 'certificat_transaccio_retirat: el certificat de transaccio ja no s''emet; els emesos es conserven'
    using errcode = '22023';
end;
$$;

create or replace function public.emitir_certificados_transaccion_cierre(p_cierre uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet certificats' using errcode = '42501';
  end if;
  raise exception 'certificat_transaccio_retirat: el certificat de transaccio ja no s''emet; els emesos es conserven'
    using errcode = '22023';
end;
$$;

create or replace function public.rectificar_certificado_transaccion(p_cd uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar rectifica un certificat' using errcode = '42501';
  end if;
  raise exception 'certificat_transaccio_retirat: el certificat de transaccio ja no es rectifica; els emesos es conserven'
    using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. El cálculo de transacciones: ya no escribe
-- ---------------------------------------------------------------------------
create or replace function public.calcular_cierre_transacciones(p_cierre uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar calcula un tancament' using errcode = '42501';
  end if;
  -- No crea ni recalcula filas `tipo = 'transaccio'`: el CT está retirado
  -- (20270509100400). Las que existen se quedan como estaban, con sus documentos.
  return jsonb_build_object('tancament', p_cierre, 'retirat', true,
                            'generadors', 0, 'linies', 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. calcular_cierre: solo la donación
-- ---------------------------------------------------------------------------
create or replace function public.calcular_cierre(p_cierre uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ce      cierres_ejercicio%rowtype;
  v_don   int;
  v_lin   int;
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
    -- El CT está retirado (20270509100400): la clave se queda, vacía, para quien la lea.
    'transaccions', null);
end;
$$;

-- Los ACL no cambian con `create or replace`; se repiten para que el fichero se lea solo.
revoke execute on function public.emitir_certificado_transaccion(uuid) from public, anon;
grant  execute on function public.emitir_certificado_transaccion(uuid) to authenticated, service_role;
revoke execute on function public.emitir_certificados_transaccion_cierre(uuid) from public, anon;
grant  execute on function public.emitir_certificados_transaccion_cierre(uuid) to authenticated, service_role;
revoke execute on function public.rectificar_certificado_transaccion(uuid, text) from public, anon;
grant  execute on function public.rectificar_certificado_transaccion(uuid, text) to authenticated, service_role;
revoke execute on function public.calcular_cierre_transacciones(uuid) from public, anon;
grant  execute on function public.calcular_cierre_transacciones(uuid) to authenticated, service_role;
revoke execute on function public.calcular_cierre(uuid) from public, anon;
grant  execute on function public.calcular_cierre(uuid) to authenticated, service_role;
