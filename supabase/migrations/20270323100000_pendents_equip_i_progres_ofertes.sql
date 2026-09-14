-- Que la aplicación explique el proceso: la cola de trabajo del equipo y el progreso de
-- una oferta vistos desde el panel de quien la publicó.
--
-- Dos preguntas que hoy no tienen respuesta en la base, y por eso el frontend las
-- improvisa o no las hace:
--
--   1. «¿QUÉ LE TOCA AL EQUIPO?» — `AppShell` hace hoy CINCO consultas sueltas para
--      pintar los badges del menú, cada pantalla cuenta lo suyo por su cuenta, y no hay
--      ningún sitio donde se vea el trabajo pendiente entero. Varias de esas colas ni
--      siquiera se cuentan en ninguna parte (albaranes en borrador, REC por conciliar,
--      productos sin coste del ejercicio, el cierre abierto con sus bloqueos, los
--      documentos que no se pudieron generar): están en la base y nadie las mira hasta
--      que alguien entra a la pantalla correspondiente. `pendents_equip()` las agrega en
--      una sola llamada.
--
--   2. «¿CUÁNTAS ENTIDADES SE HAN INTERESADO POR MI OFERTA?» — el productor publica y
--      hoy no ve absolutamente nada hasta que el equipo aprueba y aparece una
--      canalización. `progres_meves_ofertes()` le da las tres cifras del embudo por
--      oferta: a cuántas se envió, cuántas dijeron que sí y cuántas esperan aprobación.
--
-- ⚠️ QUÉ **NO** DEVUELVE `progres_meves_ofertes()`, Y POR QUÉ ES EL PUNTO DE LA FUNCIÓN.
--    Ni `entidad_id`, ni nombre, ni teléfono, ni el precio ofrecido: solo cuántas. Es la
--    decisión del cliente —«cuántas, sin nombres»— y el motivo es que quién quiere el
--    producto es información de la otra parte y de la coordinación, no del donante: un
--    productor que viera los nombres podría saltarse al equipo, y una entidad que
--    manifiesta interés no ha consentido que su nombre viaje al generador. Por eso la
--    función es un PUENTE con un tipo de retorno de cuatro columnas numéricas, y no una
--    política de lectura sobre `oferta_respuestas`: una política deja la fila entera al
--    alcance de un `select *`, y aquí lo que se concede es exactamente el agregado.
--
-- ⚠️ ESO NO LO CIERRA ESTA MIGRACIÓN POR SÍ SOLA, y conviene decirlo aquí para que quede
--    escrito donde se leerá: desde `20260730098000` la política de SELECT de
--    `oferta_respuestas` incluye la rama
--    `excedente_id in (select excedents_dels_meus_productors())`, así que un productor con
--    sesión YA puede leer por PostgREST las respuestas a sus ofertas **con `entidad_id` y
--    `telefono`**. Comprobado contra producción el 14-09-2026 con la cuenta de TEST-PROD-1:
--    devuelve tres filas con su `entidad_id`. Ninguna pantalla del panel de productor las
--    pide —solo `OfferDetail` (equipo), `Interessos` y `Mercat` (receptor, por su propia
--    ficha)—, pero el dato está concedido. Retirar esa rama es una decisión aparte, con su
--    propia migración, porque cambia una política vigente y no una función nueva; mientras
--    no se tome, esta función es el camino que el panel debe usar, no la única puerta.

-- ---------------------------------------------------------------------------
-- 1. pendents_equip(): la cola de trabajo consolidada
-- ---------------------------------------------------------------------------
-- DEVUELVE SIEMPRE UNA FILA POR COLA (doce), aunque `n = 0`. Es deliberado: el tablero
-- se pinta a partir de `cua`, no de la posición ni de la presencia de la fila, así que
-- una cola vacía tiene que llegar como «0» y no como ausencia. Si se filtrara por
-- `n > 0`, el frontend tendría que saberse de memoria la lista completa para poder
-- pintar los ceros, que es justo el conocimiento que esta función viene a centralizar.
--
-- `security invoker` a propósito, mismo criterio que `missatges_sense_contestar()`
-- (20270306100000): no hay nada que saltarse. Todas las tablas que agrega ya las lee el
-- equipo con sus propias políticas, y lo que devuelve es un recuento de lo que quien
-- pregunta podía leer de todos modos. Una `definer` aquí ampliaría el alcance sin
-- ningún motivo — y haría que un externo recibiera cifras de datos que no ve.
--
-- ⚠️ El matiz de `security invoker` que no es obvio: las dos colas que se calculan con un
--    `not exists` —`ofertes_sense_enviar` y `costos`— cuentan al REVÉS que las demás. En
--    un `count` normal, una fila invisible para quien pregunta resta; en una negación,
--    suma (si no veo la respuesta, la oferta parece sin enviar). No tiene consecuencia
--    porque la guarda deja pasar solo al equipo y a `service_role`, que lo ven todo, pero
--    es la razón por la que esta función no puede abrirse a nadie más «total, son solo
--    cifras»: a un externo le mentiría, no le ocultaría.
--
-- ⚠️ LA GUARDA VA CON `auth.uid() is not null and not es_intern()`, no con `es_intern()`
--    a secas. Escrita a secas dejaría fuera a `service_role`, que no tiene `auth.uid()`
--    y para el que `es_intern()` es falso: la función respondería 42501 a la propia
--    plataforma (§4bis; le pasó a `datos_182` y a `actualizar_meu_canal`).
--
-- ⚠️ Las fechas se cortan en hora de MADRID, no con `current_date`. La sesión de
--    PostgREST va en UTC, así que entre las 00:00 y las 02:00 de Madrid `current_date`
--    sigue siendo el día anterior y una oferta caducada ayer no aparecería como vencida
--    hasta las dos de la mañana. Es la convención del proyecto (§7) y la que usa
--    `cierre_base`.
create or replace function public.pendents_equip()
returns table (cua text, n int, ref uuid, detall jsonb)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la cua de treball' using errcode = '42501';
  end if;

  return query
  with param as (
    select extract(year from (now() at time zone 'Europe/Madrid'))::int as any_curs,
           (now() at time zone 'Europe/Madrid')::date                   as avui
  ),
  -- El cierre al que apunta `ref`: el más reciente de los abiertos. Se calcula una vez y
  -- se reutiliza para el id y para el detalle, así que los dos hablan del mismo cierre
  -- aunque hubiera varios ensayos abiertos a la vez (que es posible: solo el cierre REAL
  -- es único por ejercicio).
  tanc as (
    select ci.id, ci.ejercicio, ci.modo, ci.estado
      from cierres_ejercicio ci
     where ci.estado in ('obert', 'provisional')
     order by ci.abierto_at desc, ci.created_at desc
     limit 1
  ),
  cues as (
    -- Altas del registro público esperando validación (cola «Registres pendents»).
    -- ⚠️ Las columnas del CTE NO se llaman `cua`, `n`, `ref` ni `detall`: esos cuatro
    --    nombres son los parámetros OUT de la función, y en plpgsql un identificador que
    --    coincide con una variable se sustituye por ella. `return query` casa por
    --    POSICIÓN, así que llamarlas distinto no cuesta nada y elimina la ambigüedad.
    select 1 as ordre, 'registres'::text as clau,
           (select count(*) from membresias m where m.aprovacio = 'pendent')::int as quants,
           null::uuid as objecte, null::jsonb as extra
    union all
    -- Convenios firmados por la organización y pendientes de la contrafirma de la
    -- Fundación: `firmat` es el estado en el que la pelota está en nuestro tejado.
    select 2, 'convenis_contrasignar',
           (select count(*) from convenios cv where cv.estado = 'firmat')::int, null, null
    union all
    -- Respuestas aceptadas esperando aprobación (la cola que ya existe en Aprovacions).
    select 3, 'respostes',
           (select count(*) from oferta_respuestas r
             where r.estado = 'acceptada' and r.aprovacio = 'pendent')::int, null, null
    union all
    -- Mensajes entrantes posteriores al último saliente, sumados por teléfono. Se apoya
    -- en `missatges_sense_contestar()` (20270306100000) en vez de repetir su consulta:
    -- una segunda definición de «sin contestar» que se desincronizara de la primera
    -- haría que el badge del menú y el de la mensajería dijeran cosas distintas.
    select 4, 'missatges',
           (select coalesce(sum(ms.pendents), 0)::int from missatges_sense_contestar() ms),
           null, null
    union all
    -- Publicadas y sin una sola fila en `oferta_respuestas`: nadie las ha recibido
    -- todavía. Es la cola que hoy no cuenta nadie y la que más se parece a trabajo
    -- olvidado —una oferta publicada que no se envía se muere sola en la lista—.
    select 5, 'ofertes_sense_enviar',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and not exists (select 1 from oferta_respuestas r
                                where r.excedente_id = e.id))::int, null, null
    union all
    -- Activas con la fecha de disponibilidad ya pasada. NO es lo mismo que lo que marca
    -- el job de vencidas (`marcar_excedentes_vencidos()`, que espera 24 h y kg sin
    -- cubrir): esto avisa antes y para que alguien decida, no para cerrar nada.
    select 6, 'ofertes_vencudes',
           (select count(*) from excedentes e, param p
             where e.estado in ('publicada', 'parcial')
               and e.disponible_hasta < p.avui)::int, null, null
    union all
    -- Albaranes en borrador: existen, no tienen número y no valen para nada hasta que
    -- alguien los emita.
    select 7, 'albarans_esborrany',
           (select count(*) from albaranes a where a.estado = 'borrador')::int, null, null
    union all
    -- REC entregados o confirmados: son los que esperan la conciliación, que es lo que
    -- fija los kilos oficiales. Sin ella no hay certificado (D13).
    select 8, 'albarans_conciliar',
           (select count(*) from albaranes a
             where a.tipo = 'REC' and a.estado in ('entregado', 'confirmado'))::int,
           null, null
    union all
    -- Informativa, y por eso va aparte de la anterior: un albarán entregado espera a la
    -- OTRA parte, no al equipo. Sale en el tablero para que se pueda llamar por teléfono
    -- si lleva días ahí, no porque haya nada que pulsar.
    select 9, 'albarans_esperant',
           (select count(*) from albaranes a where a.estado = 'entregado')::int, null, null
    union all
    -- Productos distintos con movimiento este año y sin coste por kilo del ejercicio.
    -- Es la cola que bloquea el cierre en diciembre y que, si no se mira hasta entonces,
    -- se descubre con el año cerrado: `cierre_base` deja esas canalizaciones con
    -- `coste_kg` nulo y el bloqueo `sense_cost` impide emitir el certificado.
    select 10, 'costos',
           (select count(distinct e.producto)
              from canalizaciones c
              join excedentes e on e.id = c.excedente_id
              cross join param p
             where extract(year from (c.created_at at time zone 'Europe/Madrid'))::int
                   = p.any_curs
               and e.producto is not null
               and not exists (select 1 from costes_producto cp
                                where cp.producto = e.producto
                                  and cp.ejercicio = p.any_curs))::int, null, null
    union all
    -- El cierre abierto. Es la única cola con `ref` y `detall`: `n` sola no dice nada
    -- útil (siempre será 0 o 1), y lo que el equipo necesita saber es de qué ejercicio
    -- es, si es el ensayo o el real, y cuántos donantes tienen algún bloqueo que impida
    -- emitirles el certificado.
    select 11, 'tancament',
           (select count(*) from cierres_ejercicio ci
             where ci.estado in ('obert', 'provisional'))::int,
           (select t.id from tanc t),
           (select jsonb_build_object(
                     'ejercicio',   t.ejercicio,
                     'modo',        t.modo,
                     'estado',      t.estado,
                     -- `bloqueos` es `[{codigo, detall, bloqueja}]`: solo cuentan los que
                     -- llevan `bloqueja = true` (`sense_conciliar`, `sense_cost`,
                     -- `dades_fiscals`); `sense_rec` y `certificat_desactualitzat` avisan
                     -- y no bloquean. El `case` sobre `jsonb_typeof` no es adorno: si
                     -- alguna fila trajera algo que no sea un array, `jsonb_array_elements`
                     -- reventaría la consulta entera y con ella las once colas restantes.
                     'bloquejats',
                     (select count(*) from cierres_donante d
                       where d.cierre_id = t.id
                         and exists (
                           select 1
                             from jsonb_array_elements(
                                    case when jsonb_typeof(d.bloqueos) = 'array'
                                         then d.bloqueos else '[]'::jsonb end) b
                            where coalesce((b ->> 'bloqueja')::boolean, false))))
              from tanc t)
    union all
    -- Documentos cuyo PDF no se pudo generar, incluidos los «encallats» que el job da
    -- por perdidos al agotar los topes (20270302100000). Es el único aviso que tiene el
    -- equipo de que un certificado emitido no tiene fichero detrás.
    select 12, 'documents_error',
           (select count(*) from documentos d where d.estado = 'error')::int, null, null
  )
  select q.clau, q.quants, q.objecte, q.extra from cues q order by q.ordre;
end;
$$;

comment on function public.pendents_equip() is
  'Cola de trabajo consolidada del equipo: una fila por cola (doce), siempre, aunque n = 0. '
  'security invoker: agrega solo lo que quien pregunta ya puede leer.';

revoke execute on function public.pendents_equip() from public, anon;
grant  execute on function public.pendents_equip() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. progres_meves_ofertes(): el embudo de MIS ofertas, sin nombres
-- ---------------------------------------------------------------------------
-- Puente `security definer` sobre las organizaciones productoras de la cuenta, igual que
-- `pendents_meus()` (20270318100000): resuelve con `mis_productores()` y devuelve solo el
-- agregado. Es `definer` y no `invoker` para que el contrato no dependa de cómo esté
-- escrita hoy la política de `oferta_respuestas` — si mañana se le retira al productor la
-- rama de lectura (ver la cabecera), esta función tiene que seguir dando exactamente lo
-- mismo.
--
-- SOLO OFERTAS ACTIVAS (`borrador`, `publicada`, `parcial`, `bloqueada`). Una oferta
-- `cerrada`, `cancelada` o `no_colocada` ya no tiene embudo que seguir, y arrastrar el
-- histórico convertiría la consulta del panel en una que crece sin techo.
--
-- LAS OFERTAS SIN NINGUNA RESPUESTA SALEN IGUAL, con las tres cifras a cero (`left join`).
-- Es la información más útil de las cuatro: «publicada y todavía no enviada a nadie».
--
-- ⚠️ SIN SESIÓN LEVANTA 42501, y aquí sí es la forma correcta —al revés que en la función
--    de arriba—. Esta no tiene ningún caso de uso para `service_role`: es literalmente
--    «lo mío», y sin `auth.uid()` `mis_productores()` no devuelve nada, así que la
--    alternativa sería responder cero filas y hacer pasar por «no tienes ofertas» lo que
--    en realidad es «no has dicho quién eres». Por eso tampoco lleva GRANT para
--    `service_role`: un GRANT que siempre fallaría es peor que no tenerlo (§4bis).
create or replace function public.progres_meves_ofertes()
returns table (
  excedente_id    uuid,
  n_enviades      int,
  n_interessades  int,
  n_per_aprovar   int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Cal una sessio per consultar el progres de les teves ofertes'
      using errcode = '42501';
  end if;

  return query
  select e.id,
         -- `count(r.id)` y no `count(*)`: con `left join`, una oferta sin respuestas
         -- produce una fila con `r` a null y `count(*)` diría 1.
         count(r.id)::int,
         count(r.id) filter (where r.estado = 'acceptada')::int,
         count(r.id) filter (where r.estado = 'acceptada'
                               and r.aprovacio = 'pendent')::int
    from excedentes e
    left join oferta_respuestas r on r.excedente_id = e.id
   where e.productor_id in (select public.mis_productores())
     and e.estado in ('borrador', 'publicada', 'parcial', 'bloqueada')
   group by e.id;
end;
$$;

comment on function public.progres_meves_ofertes() is
  'Cuantas entidades han recibido, aceptado y esperan aprobacion en cada oferta activa de '
  'mis organizaciones productoras. NUNCA devuelve entidad_id, nombre ni telefono: la '
  'decision es «cuantas, sin nombres».';

revoke execute on function public.progres_meves_ofertes() from public, anon;
grant  execute on function public.progres_meves_ofertes() to authenticated;

-- ---------------------------------------------------------------------------
-- Verificación (manual, tras aplicar)
-- ---------------------------------------------------------------------------
--   select has_function_privilege('authenticated','public.pendents_equip()','EXECUTE');          -- t
--   select has_function_privilege('service_role','public.pendents_equip()','EXECUTE');           -- t
--   select has_function_privilege('anon','public.pendents_equip()','EXECUTE');                   -- f
--   select has_function_privilege('authenticated','public.progres_meves_ofertes()','EXECUTE');   -- t
--   select has_function_privilege('service_role','public.progres_meves_ofertes()','EXECUTE');    -- f
--   select has_function_privilege('anon','public.progres_meves_ofertes()','EXECUTE');            -- f
--
--   -- Con la service key (sin auth.uid()): la guarda de pendents_equip NO debe cortar.
--   --   Doce filas, una por cola.
--   select cua, n, ref, detall from public.pendents_equip();
--   select count(*) from public.pendents_equip();                                                -- 12
--
--   -- Y progres_meves_ofertes con la service key SÍ debe cortar, con 42501.
--   select * from public.progres_meves_ofertes();
