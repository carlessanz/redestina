-- Contar los mensajes sin contestar en la base, no en el navegador.
--
-- EL PROBLEMA (deuda §12.5). Tres sitios —`ProducersList`, `ContactList` y `AppShell`— hacían
-- `select contact_phone, direction, created_at from wa_messages` **sin filtro ni paginación**
-- para calcular un puñado de números: cuántos mensajes ha escrito cada contacto después de la
-- última respuesta del equipo. `AppShell` lo hacía **en cada login** de una cuenta con panel de
-- equipo, solo para pintar el badge del menú.
--
-- El cálculo es de una línea de SQL y la tabla crece sin techo: es el sitio del proyecto donde
-- más claro está que el trabajo tiene que bajar a la base. La función `countUnanswered()` de
-- `src/lib/mensajes.ts` se queda como respaldo y como especificación legible de la regla — y
-- tiene sus propias pruebas—, pero deja de ser el camino normal.
--
-- LA REGLA, que es la misma que implementaba el cliente: por cada teléfono, los mensajes
-- `inbound` **estrictamente posteriores** al último `outbound`. Sin ningún `outbound`, cuentan
-- todos los entrantes. El `>` estricto importa: un entrante y un saliente con exactamente la
-- misma marca de tiempo no cuenta como pendiente, igual que antes.
--
-- SEGURIDAD. `security invoker` a propósito: no hay nada que saltarse. `wa_messages` ya tiene
-- `grant select` para `authenticated` y sus políticas deciden qué filas se ven; una función
-- `definer` aquí ampliaría el alcance sin motivo. Lo que devuelve es un agregado de lo que
-- quien pregunta ya podía leer.

create or replace function public.missatges_sense_contestar()
returns table (contact_phone text, pendents bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ultim_sortint as (
    select m.contact_phone, max(m.created_at) as quan
      from wa_messages m
     where m.direction = 'outbound'
     group by m.contact_phone
  )
  select m.contact_phone, count(*)::bigint
    from wa_messages m
    left join ultim_sortint u on u.contact_phone = m.contact_phone
   where m.direction = 'inbound'
     and (u.quan is null or m.created_at > u.quan)
   group by m.contact_phone;
$$;

comment on function public.missatges_sense_contestar() is
  'Mensajes entrantes posteriores al último saliente, por teléfono. Sustituye a traerse la '
  'tabla `wa_messages` entera al navegador para contarlos (deuda §12.5). `security invoker`: '
  'agrega solo lo que quien pregunta ya puede leer.';

revoke execute on function public.missatges_sense_contestar() from public, anon;
grant  execute on function public.missatges_sense_contestar() to authenticated, service_role;

-- El índice que hace que esto valga la pena. Sin él, las dos mitades de la consulta son dos
-- recorridos completos de la tabla; con él, el agregado por teléfono sale del índice.
-- ⚠️ `(contact_phone, created_at)` ya existe desde la fase 1; lo que falta es tener `direction`
-- dentro para no ir a la fila. Se crea `if not exists` por si alguien lo añadió a mano.
create index if not exists wa_messages_pendents_idx
  on wa_messages (contact_phone, direction, created_at);
