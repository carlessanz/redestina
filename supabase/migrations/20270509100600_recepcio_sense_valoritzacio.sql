-- Certificado de recepción: una canalización sin modalidad NO es una donación (05-11-2026).
--
-- `cierre_base_recepcio()` (20270328101200) trataba `valorizacion` nula como donación
-- (`coalesce(c.valorizacion, 'donacio')`). El certificado de donación ya no lo hace
-- (20270509100000: `sense_valoritzacio` queda fuera), y el CR se alinea con el mismo
-- criterio sin cambiar nada más: la línea sin modalidad se queda FUERA del CR.
--
-- Por qué fuera y no «como compra»: quitar el `coalesce` a secas habría mandado esas
-- líneas a buscar un OPE (la rama `else`) y, peor, habría NOMBRADO al generador (la rama D3
-- es `case when val = 'donacio'`, y con null cae en el `else`). Si era una donación, eso
-- rompe D3. Y además el insert fallaría: `cierre_receptor_lineas.valorizacion` es
-- `not null`. En el clon no hay ninguna canalización conciliada sin modalidad.
--
-- Misma firma y mismas columnas: `create or replace` (conserva el ACL).

create or replace function public.cierre_base_recepcio(p_desde date, p_hasta date, p_modo text DEFAULT 'prueba'::text)
 RETURNS TABLE(canalizacion_id uuid, entidad_id uuid, valorizacion text, producto text, mes integer, kg_conciliados numeric, kg_neto numeric, retroactiva boolean, albaran_id uuid, albaran_tipo text, municipio text, comarca text, productor_id uuid, productor_nom text, productor_nif text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la base de calcul d''un certificat de recepcio'
      using errcode = '42501';
  end if;

  return query
  with ops as (
    select c.id                                   as can_id,
           c.entidad_id                           as ent_id,
           c.valorizacion                         as val,
           e.producto                             as prod,
           e.productor_id                         as prod_id,
           coalesce(e.ubicacion_id, esp.ubicacion_id) as ubi_id,
           c.kg_conciliados                       as kg_conc,
           c.conciliacion_retroactiva             as retro,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid')       as fecha_local
      from canalizaciones c
      join excedentes     e   on e.id = c.excedente_id
      left join espigoladas esp on esp.id = e.espigolada_id
     where c.estado = 'conciliada'
       and c.kg_conciliados is not null
       and c.entidad_id is not null
       -- Sin modalidad no se sabe si es donación (D3: no se nombra al generador) o compra
       -- (sí se nombra), ni qué albarán buscar; y `cierre_receptor_lineas.valorizacion` es
       -- `not null`. Fuera, en vez de suponer donación (20270509100600).
       and c.valorizacion is not null
       -- Misma regla que el resto del circuito: una conciliación hecha después de cerrar
       -- el ejercicio solo entra en los cierres de prueba.
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
  ),
  enrango as (
    select o.* from ops o
     where o.fecha_local >= p_desde::timestamp
       and o.fecha_local <  (p_hasta + 1)::timestamp
  ),
  amb_albara as (
    select o.*, r.alb_id, r.alb_tipo, r.alb_kg
      from enrango o
      left join lateral (
        select a.id as alb_id, a.tipo as alb_tipo, sum(l.kg_validados) as alb_kg
          from albaranes a
          join albaran_lineas l on l.albaran_id = a.id
         where a.estado = 'conciliado'
           and a.canalizacion_id = o.can_id
           and a.tipo = case when o.val = 'donacio' then 'ENT' else 'OPE' end
         group by a.id, a.tipo
         order by a.id
         limit 1
      ) r on true
  ),
  amb_origen as (
    select o.*,
           coalesce(ub.municipio, pr.poblacion)   as muni,
           ub.municipio_ine                       as muni_ine,
           coalesce(pr.empresa, pr.name)          as pr_nom,
           pr.nif                                 as pr_nif
      from amb_albara o
      left join productor_ubicaciones ub on ub.id = o.ubi_id
      left join productores           pr on pr.id = o.prod_id
  )
  select o.can_id,
         o.ent_id,
         o.val,
         o.prod,
         extract(month from o.fecha_local)::int,
         o.kg_conc,
         -- Los kilos OFICIALES son los del albarán conciliado (D13). El respaldo a
         -- `kg_conciliados` cubre la conciliación retroactiva, que es el único caso en que
         -- no hay albarán, y queda marcado en `retroactiva`.
         round(coalesce(o.alb_kg, o.kg_conc), 2),
         (o.retro or o.alb_id is null),
         o.alb_id,
         o.alb_tipo,
         o.muni,
         (select m.comarca
            from municipios m
           where (o.muni_ine is not null and m.codi_ine = o.muni_ine)
              or (o.muni_ine is null and o.muni is not null
                  and lower(m.nom) = lower(o.muni))
           limit 1),
         -- 🔴 D3: en donación, el generador NO SE NOMBRA. Se anula aquí, además de estar
         --    prohibido por el check de `cierre_receptor_lineas`: la función es
         --    `security definer` y lo que devuelva acaba en una tabla que la entidad lee
         --    por RLS, así que la primera defensa tiene que estar donde se compone el dato.
         case when o.val = 'donacio' then null else o.prod_id end,
         case when o.val = 'donacio' then null else o.pr_nom end,
         case when o.val = 'donacio' then null else o.pr_nif end
    from amb_origen o;
end;
$function$;

revoke execute on function public.cierre_base_recepcio(date, date, text) from public, anon;
grant  execute on function public.cierre_base_recepcio(date, date, text) to authenticated, service_role;
