-- ---------------------------------------------------------------------------
-- canalitzacions_actives(): la referencia ambigua que la dejaba INSERVIBLE
-- ---------------------------------------------------------------------------
-- 🔴 La función respondía `42702 column reference "excedente_id" is ambiguous` SIEMPRE:
--    no devolvió una fila ni una vez desde que se creó. El motivo es que en PL/pgSQL los
--    parámetros de un `returns table` son VARIABLES, así que `excedente_id` dentro del
--    cuerpo puede referirse a la columna de salida o a la de la tabla — y en
--
--      al.canalizacion_id in (select id from canalizaciones where excedente_id = ex.id)
--
--    esa referencia iba sin cualificar. Las demás del cuerpo sí lo estaban; esta se coló
--    porque está dentro de una subconsulta anidada, donde el alias no salta a la vista.
--
-- ⚠️ POR QUÉ NO LO CAZÓ NADA. El arnés la llama y la daba por buena: su rama `rpc` trataba
--    cualquier error que no fuera un rechazo como «la autorización dejó pasar y falló algo
--    posterior», que es cierto para los checks que llaman con un uuid inexistente y falso
--    para un error de programación. Se arregla en el mismo cambio (`errorsEsperats`).
--
-- ⚠️ Y `deno check` tampoco podía verlo: el SQL de una migración es una cadena para
--    TypeScript. Lo único que lo destapa es EJECUTAR la función contra la base, que es lo
--    que hizo el E2E de la pantalla guiada.
--
-- `create or replace` basta: el `returns table` no cambia, así que los GRANT se conservan.

create or replace function public.canalitzacions_actives(p_limit int default 200)
returns table (
  excedente_id   uuid,
  id_excedente   text,
  productor      text,
  estado         text,
  modalitat      text,
  kg_total       numeric,
  kg_canalitzats numeric,
  n_per_aprovar  int,
  rec_estado     text,
  ents_pendents  int,
  conveni_gen    text,
  created_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot llistar canalitzacions' using errcode = '42501';
  end if;

  return query
  select ex.id,
         ex.id_excedente,
         coalesce(p.empresa, p.name),
         ex.estado,
         ex.modalitat,
         ex.kg_total,
         coalesce((select sum(ca.kg_confirmados) from canalizaciones ca
                    where ca.excedente_id = ex.id), 0)::numeric,
         (select count(*) from oferta_respuestas r
           where r.excedente_id = ex.id
             and r.estado = 'acceptada' and r.aprovacio = 'pendent')::int,
         (select al.estado from albaranes al
           where al.tipo = 'REC'
             and (al.excedente_id = ex.id
                  or (ex.espigolada_id is not null and al.espigolada_id = ex.espigolada_id))
             and al.estado not in ('anulado', 'rectificado')
           order by al.created_at desc limit 1),
         (select count(*) from albaranes al
           where al.tipo in ('ENT', 'OPE')
             and al.canalizacion_id in (select c2.id from canalizaciones c2 where c2.excedente_id = ex.id)
             and al.estado in ('emitido', 'entregado'))::int,
         (select c.estado from convenios c
           where c.productor_id = ex.productor_id and c.estado <> 'substituit'
           order by case c.estado when 'vigent' then 0 when 'firmat' then 1
                                  when 'pendent_firma' then 2 else 3 end
           limit 1),
         ex.created_at
    from excedentes ex
    left join productores p on p.id = ex.productor_id
   where ex.estado not in ('cancelada', 'no_colocada')
   order by ex.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

comment on function public.canalitzacions_actives(int) is
  'Els lots en curs per a l''index de la pantalla guiada. Retorna FETS, no el pas: el pas el calcula passosCanalitzacio.ts al client.';
