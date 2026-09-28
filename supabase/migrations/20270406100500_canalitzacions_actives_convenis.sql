-- canalitzacions_actives(): el convenio que toca y los envíos, como la ficha (28-09-2026).
--
-- Tras `20270406100400` el índice seguía discrepando de la ficha en dos casos, medidos lote a
-- lote en el navegador:
--   · Venta y maquila: el índice miraba CUALQUIER convenio del generador y daba por bueno un
--     `don_gen` vigente; la ficha, bien, pide el `com` que exige `convenios_exigidos`.
--   · Oferta enviada y sin respuesta: el índice no sabía de los envíos y decía «Envia
--     l'oferta»; la ficha dice «Recull l'interès».
-- Se añaden `n_respostes` y `n_per_aprovar_sense_conveni` (este último para que el índice no
-- tenga que suponer que la receptora tiene su convenio). Mismo drop + create + grant.

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
  tot_conciliat  boolean,
  n_respostes    int,
  n_per_aprovar_sense_conveni int
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
         -- El convenio que la modalidad EXIGE al generador (`convenios_exigidos`, parte
         -- `entrega`), igual que `canalitzacio_assistida()`: una venta o maquila pide `com`,
         -- y un `don_gen` vigente no la deja operar.
         (select c.estado from convenios c
            join convenios_exigidos ce
              on ce.tipo_convenio = c.tipo and ce.valorizacion = ex.modalitat
             and ce.parte = 'entrega'
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
           where c4.excedente_id = ex.id),
         -- Enviada a alguien: con respuestas, la distribución está hecha aunque nadie
         -- haya contestado todavía (la ficha dice «Recull l'interès»).
         (select count(*) from oferta_respuestas r2 where r2.excedente_id = ex.id)::int,
         -- Intereses por aprobar de una receptora SIN el convenio vigente que la modalidad
         -- le exige (parte `recibe`): `aprovar_resposta()` los rechazaría.
         (select count(*) from oferta_respuestas r3
           where r3.excedente_id = ex.id
             and r3.estado = 'acceptada' and r3.aprovacio = 'pendent'
             and not exists (
               select 1 from convenios c5
                 join convenios_exigidos ce5
                   on ce5.tipo_convenio = c5.tipo and ce5.valorizacion = ex.modalitat
                  and ce5.parte = 'recibe'
                where c5.entidad_id = r3.entidad_id and c5.estado = 'vigent'))::int
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
