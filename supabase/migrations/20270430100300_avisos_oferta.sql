-- Los avisos de una oferta en una sola llamada (27-10-2026, fase 4 del plan de gestión autónoma).
--
-- Para enseñar en cada paso el mensaje que la plataforma mandó —o habría mandado con las
-- notificaciones encendidas— hacen falta los avisos de la oferta, de sus respuestas y de sus
-- canalizaciones (`avisos.objecte_tipo` = `excedente` · `oferta_resposta` · `canalizacion`).
-- Desde el cliente eran tres consultas con un `in` cada una.
--
-- ⚠️ `security invoker`, sin guarda de rol, y es deliberado: la RLS de `avisos` ya dice lo que
--    hay que decir —el equipo lo ve todo; una organización, solo lo suyo—, así que la misma
--    función sirve al panel del equipo (copiar) y a los de ofertante y receptor (leer el texto
--    íntegro de lo que se les dirigió). Una `definer` solo podría ampliar el alcance.

create or replace function public.avisos_de_oferta(p_excedente uuid)
returns setof avisos
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select a.*
    from avisos a
   where (a.objecte_tipo = 'excedente' and a.objecte_id = p_excedente)
      or (a.objecte_tipo = 'oferta_resposta'
          and a.objecte_id in (select r.id from oferta_respuestas r where r.excedente_id = p_excedente))
      or (a.objecte_tipo = 'canalizacion'
          and a.objecte_id in (select c.id from canalizaciones c where c.excedente_id = p_excedente))
   order by a.created_at;
$$;

revoke execute on function public.avisos_de_oferta(uuid) from public, anon;
grant execute on function public.avisos_de_oferta(uuid) to authenticated, service_role;

comment on function public.avisos_de_oferta(uuid) is
  'Los avisos de una oferta, sus respuestas y sus canalizaciones, con la RLS de quien pregunta (20270430100300).';

-- Cuántos avisos de cada oferta NO salieron (`canal_enviat = 'cap'`): el índice del ciclo
-- guiado lo enseña como «Missatges per enviar», para saber a quién hay que avisar a mano.
-- Una llamada para todas las ofertas, no una por fila. `security invoker`, como la de arriba:
-- la RLS de `avisos` decide qué cuenta cada cual (el equipo, todo).

create or replace function public.avisos_sense_enviar_per_oferta()
returns table (excedente_id uuid, n integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with a as (
    select coalesce(
             case when av.objecte_tipo = 'excedente' then av.objecte_id end,
             r.excedente_id,
             c.excedente_id) as excedente_id
      from avisos av
      left join oferta_respuestas r on av.objecte_tipo = 'oferta_resposta' and r.id = av.objecte_id
      left join canalizaciones c on av.objecte_tipo = 'canalizacion' and c.id = av.objecte_id
     where av.canal_enviat = 'cap'
  )
  select excedente_id, count(*)::int
    from a
   where excedente_id is not null
   group by excedente_id;
$$;

revoke execute on function public.avisos_sense_enviar_per_oferta() from public, anon;
grant execute on function public.avisos_sense_enviar_per_oferta() to authenticated, service_role;

comment on function public.avisos_sense_enviar_per_oferta() is
  'Avisos que no salieron (canal_enviat = cap), por oferta, con la RLS de quien pregunta (20270430100300).';
