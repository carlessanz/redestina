-- canalitzacions_actives(): tres hechos más, para que el índice diga la fase BUENA (28-09-2026).
--
-- EL DEFECTO. El índice de la pantalla guiada (`/equip/canalitzacio`) calcula la fase con
-- `escalaCanal`, igual que la ficha, pero con un resumen que no traía los albaranes de
-- salida. Así, un lote con sus ENT emitidos, confirmados y conciliados salía en el índice
-- como «Lliurament · Emet els albarans de sortida», mientras su ficha decía, bien, que
-- tocaba el cierre anual (E-260914-MAS-TOM-1, la espigolada). `ents_pendents` no bastaba:
-- cuenta los emitidos o entregados, y con él «no emitido todavía» y «todo conciliado»
-- valen igual, 0.
--
-- LO QUE SE AÑADE, al final de la fila (el cliente ignora lo que no conoce):
--   · `origen`          — una espigolada no recorre distribución ni aprobación.
--   · `sortida_estado`  — el estado del albarán de salida (ENT/OPE) MENOS avanzado, que es
--                         lo que `avancSortides()` mira en la ficha. Null si no hay ninguno.
--   · `tot_conciliat`   — todas las canalizaciones del lote conciliadas; null si no hay.
--
-- `returns table` cambia, así que hay que borrarla y recrearla (`create or replace` no
-- cambia el tipo de retorno) y REPETIR el revoke/grant, como con `resolver_enlace` (§4bis).

drop function if exists public.canalitzacions_actives(int);

create function public.canalitzacions_actives(p_limit int default 200)
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
  created_at     timestamptz,
  origen         text,
  sortida_estado text,
  tot_conciliat  boolean
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
         ex.created_at,
         ex.origen,
         (select al.estado from albaranes al
           where al.tipo in ('ENT', 'OPE')
             and al.canalizacion_id in (select c3.id from canalizaciones c3 where c3.excedente_id = ex.id)
             and al.estado not in ('anulado', 'rectificado')
           order by case al.estado when 'borrador' then 0 when 'emitido' then 1
                                   when 'entregado' then 2 when 'confirmado' then 3
                                   else 4 end
           limit 1),
         (select bool_and(c4.kg_conciliados is not null) from canalizaciones c4
           where c4.excedente_id = ex.id)
    from excedentes ex
    left join productores p on p.id = ex.productor_id
   where ex.estado not in ('cancelada', 'no_colocada')
   order by ex.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

comment on function public.canalitzacions_actives(int) is
  'Els lots en curs per a l''index de la pantalla guiada. Retorna FETS, no el pas: el pas el calcula passosCanalitzacio.ts al client.';

revoke execute on function public.canalitzacions_actives(int) from public, anon;
grant  execute on function public.canalitzacions_actives(int) to authenticated, service_role;
