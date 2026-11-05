-- El 182 solo lee certificados de DONACIÓN (05-11-2026).
--
-- `datos_182()` (20261109100100) leía todo `cierres_donante` con número del cierre, sin
-- mirar `tipo`. Desde la fase 5 (20270301100100) esa tabla también guarda los
-- certificados de transacción (`tipo = 'transaccio'`, venta y maquila, sin efecto
-- fiscal): un CT emitido habría llegado a la gestoría como una donación más del modelo
-- 182. Se añade `and cd.tipo = 'donacio'`. Nada más cambia (misma firma, mismas columnas).

create or replace function public.datos_182(p_cierre uuid)
returns table(nif text, razon_social text, codigo_postal text, provincia text,
              importe numeric, kg numeric, en_especie boolean, certificado_numero text,
              fecha date, modo text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- El idioma de siempre: con `es_intern()` a secas, `service_role` (sin `auth.uid()`)
  -- recibiría cero filas en silencio.
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta les dades del 182' using errcode = '42501';
  end if;

  return query
  select cd.datos_fiscales->>'nif',
         cd.datos_fiscales->>'raó_social',
         cd.datos_fiscales->>'codi_postal',
         coalesce(cd.datos_fiscales->>'provincia',
                  public.provincia_por_cp(cd.datos_fiscales->>'codi_postal')),
         cd.valor_total,
         cd.kg_total,
         true,
         cd.certificado_numero,
         (cd.certificado_at at time zone 'Europe/Madrid')::date,
         ce.modo
    from cierres_donante cd
    join cierres_ejercicio ce on ce.id = cd.cierre_id
   where cd.cierre_id = p_cierre
     and cd.tipo = 'donacio'
     and cd.certificado_numero is not null
   order by cd.datos_fiscales->>'raó_social';
end;
$$;

revoke execute on function public.datos_182(uuid) from public, anon;
grant  execute on function public.datos_182(uuid) to authenticated, service_role;
