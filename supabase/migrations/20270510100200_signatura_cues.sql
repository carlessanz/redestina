-- Circuito de firma unificado (05-11-2026) · 3/3: las colas.
--
-- Se aplica JUSTO ANTES del frontend que las pinta (las dos migraciones anteriores ya son
-- compatibles con el panel publicado; esta añade filas que el panel viejo no sabe pintar).
--
--   · `pendents_meus()` gana la rama `firma_document` (objeto `documento`).
--   · `pendents_equip()` gana la cola 17.ª, `signatures_per_tancar`.
--
-- Las dos son COPIA ÍNTEGRA de la definición vigente (20270414100000 y 20270428100000) con
-- la rama nueva; `create or replace` conserva `returns table` (sin cambiar columnas) y los
-- GRANT, que de todos modos se repiten abajo.

-- ---------------------------------------------------------------------------
-- 1. pendents_meus()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pendents_meus()
 RETURNS TABLE(proposito text, objeto_tipo text, objeto_id uuid, tipo_org text, org_id uuid, rol_parte text, numero text, etiqueta text, tipus text, estat_objecte text, motiu text, ejercicio integer, enlace_id uuid, enlace_estado_efectivo text, enlace_caduca_at timestamp with time zone, enlace_canal text, enlace_created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;

  return query
  with meves as (
    select m.productor_id, m.entidad_id
      from membresias m
      join perfiles p on p.id = m.user_id
     where m.user_id = v_user and m.activo and p.activo
  ),
  pendents as (
    -- Convenios: `pendent_firma` y `retornat` son los dos estados en los que la pelota
    -- está en el tejado de la organización (mismo criterio que `conveni_pendent`).
    select 'firma_convenio'::text          as proposito,
           'convenio'::text                as objeto_tipo,
           c.id                            as objeto_id,
           c.tipo_org                      as tipo_org,
           coalesce(c.productor_id, c.entidad_id) as org_id,
           null::text                      as rol_parte,
           c.numero_completo               as numero,
           null::text                      as etiqueta,
           c.tipo                          as tipus,
           c.estado                        as estat_objecte,
           c.motivo_devolucion             as motiu,
           c.ejercicio                     as ejercicio
      from convenios c
     where c.estado in ('pendent_firma', 'retornat')
       and (c.productor_id in (select productor_id from meves where productor_id is not null)
         or c.entidad_id   in (select entidad_id   from meves where entidad_id   is not null))
    union all
    -- Albaranes entregados y sin confirmar. La parte se resuelve como en
    -- `marcar_entregado()`: REC y OPE los entrega el generador, ENT y OPE los recibe la
    -- entidad. En un OPE donde la cuenta tenga las dos fichas salen dos filas, y es lo
    -- correcto: son dos confirmaciones distintas.
    select 'confirmacion_albaran'::text,
           'albaran'::text,
           a.id,
           part.tipo_org,
           part.org_id,
           part.rol,
           a.numero_completo,
           (select string_agg(distinct l.producto, ', ') from albaran_lineas l where l.albaran_id = a.id),
           a.tipo,
           a.estado,
           null::text,
           a.ejercicio
      from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
      left join excedentes     e on e.id = a.excedente_id
      left join espigoladas   es on es.id = a.espigolada_id
      cross join lateral (
        select 'productor'::text as tipo_org,
               coalesce(e.productor_id, es.productor_id) as org_id,
               'entrega'::text as rol
         where a.tipo in ('REC', 'OPE')
           and coalesce(e.productor_id, es.productor_id)
               in (select productor_id from meves where productor_id is not null)
        union all
        select 'entidad', c.entidad_id, 'recibe'
         where a.tipo in ('ENT', 'OPE')
           and c.entidad_id in (select entidad_id from meves where entidad_id is not null)
      ) part
     where a.estado = 'entregado'
       and not exists (
         select 1 from enlaces_token t
          where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
            and t.proposito = 'confirmacion_albaran' and t.usado_at is not null
            and (t.rol_parte is null or t.rol_parte = part.rol))
    union all
    -- NUEVA (20270510100200). Documentos que esta organización tiene que FIRMAR: CD, CR, REC y
    -- ENT vigentes, de modo real, cuya parte firmante (`document_part_signant`) es una ficha
    -- mía y sin ninguna firma viva (una rechazada no cuenta: vuelve a estar pendiente, y
    -- `motiu` dice por qué). El CONV NO entra: el convenio se firma por su propio circuito
    -- (rama `firma_convenio` de arriba) y subir un PDF firmado encima es cosa del equipo; si
    -- entrara, cada convenio ya firmado volvería a salir «pendent de tu».
    -- Como el convenio, sale a cualquier miembro activo (titular u operador): el panel
    -- decide qué botón ve cada uno («Només la persona titular…» para el operador).
    -- `etiqueta`: el ejercicio (cierre anual), el periodo dd/mm/aaaa – dd/mm/aaaa (a
    -- demanda y recepción) o los productos (albarán). `estat_objecte`: el estado de dominio.
    -- `url_path` no viaja: el enlace del panel lo acuña el diálogo (`acunar_enllac_propi`).
    select 'firma_document'::text,
           'documento'::text,
           d.id,
           ps.tipo_org,
           ps.org_id,
           null::text,
           d.numero_completo,
           case d.objeto_tipo
             when 'cierre_donante' then d.ejercicio::text
             when 'cierre_periodo' then (
               select to_char(cp.periodo_desde, 'DD/MM/YYYY') || ' – ' || to_char(cp.periodo_hasta, 'DD/MM/YYYY')
                 from cierres_periodo cp where cp.id = d.objeto_id)
             when 'cierre_receptor' then (
               select to_char(cr.periodo_desde, 'DD/MM/YYYY') || ' – ' || to_char(cr.periodo_hasta, 'DD/MM/YYYY')
                 from cierres_receptor cr where cr.id = d.objeto_id)
             when 'albaran' then (
               select string_agg(distinct l.producto, ', ') from albaran_lineas l where l.albaran_id = d.objeto_id)
           end,
           d.tipo,
           case d.objeto_tipo
             when 'cierre_donante'  then (select cd.estado from cierres_donante  cd where cd.id = d.objeto_id)
             when 'cierre_periodo'  then (select cp.estado from cierres_periodo  cp where cp.id = d.objeto_id)
             when 'cierre_receptor' then (select cr.estado from cierres_receptor cr where cr.id = d.objeto_id)
             when 'albaran'         then (select al.estado from albaranes        al where al.id = d.objeto_id)
           end,
           (select f.motiu_rebuig from firmes_document f
             where f.documento_id = d.id and f.estat = 'rebutjat'
             order by f.rebutjat_at desc limit 1),
           d.ejercicio
      from documentos d
      cross join lateral public.document_part_signant(d.id) ps
     where d.vigente
       and d.modo = 'real'
       and d.tipo in ('CD', 'CR', 'REC', 'ENT')
       and d.id in (select public.documents_meus(v_user))
       and ((ps.tipo_org = 'productor'
             and ps.org_id in (select productor_id from meves where productor_id is not null))
         or (ps.tipo_org = 'entidad'
             and ps.org_id in (select entidad_id from meves where entidad_id is not null)))
       and not exists (select 1 from firmes_document f
                        where f.documento_id = d.id and f.estat <> 'rebutjat')
  )
  select p.proposito, p.objeto_tipo, p.objeto_id, p.tipo_org, p.org_id, p.rol_parte,
         p.numero, p.etiqueta, p.tipus, p.estat_objecte, p.motiu, p.ejercicio,
         en.id, en.estado_efectivo, en.caduca_at, en.canal, en.created_at
    from pendents p
    left join lateral (
      select e.id,
             case
               when e.estado <> 'activo'   then e.estado
               when e.usado_at is not null then 'usado'
               when e.caduca_at < now()    then 'caducado'
               else 'activo'
             end as estado_efectivo,
             e.caduca_at, e.canal, e.created_at
        from enlaces_token e
       where e.objeto_tipo = p.objeto_tipo
         and e.objeto_id   = p.objeto_id
         and e.proposito   = p.proposito
         and (p.rol_parte is null or e.rol_parte is null or e.rol_parte = p.rol_parte)
       order by e.created_at desc
       limit 1
    ) en on true
   order by p.objeto_tipo, p.ejercicio desc nulls last, p.numero nulls last;
end;
$function$;

revoke execute on function public.pendents_meus() from public, anon;
grant  execute on function public.pendents_meus() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. pendents_equip(): 17 colas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pendents_equip()
 RETURNS TABLE(cua text, n integer, ref uuid, detall jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la cua de treball' using errcode = '42501';
  end if;

  return query
  with param as (
    select extract(year from (now() at time zone 'Europe/Madrid'))::int as any_curs,
           (now() at time zone 'Europe/Madrid')::date                   as avui
  ),
  tanc as (
    select ci.id, ci.ejercicio, ci.modo, ci.estado
      from cierres_ejercicio ci
     where ci.estado in ('obert', 'provisional')
     order by ci.abierto_at desc, ci.created_at desc
     limit 1
  ),
  -- Canalizaciones cuya recogida es ya trabajo del EQUIPO (20270427100000): no anuladas, sin
  -- registrar por el receptor, y con la recogida pasada —que es justo cuando
  -- `programar_albarans_recollida()` le pide al receptor que la registre; si no tiene panel,
  -- la registra el equipo con `confirmar_recollida()`— o, sin hora acordada (a esas el job no
  -- les avisa nunca), con más de 2 días.
  canal_equip as (
    select c.id, c.excedente_id
      from canalizaciones c
     where c.estado <> 'anulada'
       and c.recollida_registrada_at is null
       and c.recollida_validada_at is null
       -- 20270428100000: una que un admin acaba de retornar espera otra vez al receptor.
       and (c.recollida_retornada_at is null or c.recollida_retornada_at < now() - interval '2 days')
       and (c.data_hora_recollida <= now()
            or (c.data_hora_recollida is null and c.created_at < now() - interval '2 days'))
  ),
  cues as (
    -- ⚠️ Las columnas del CTE NO se llaman `cua`, `n`, `ref` ni `detall`: esos cuatro
    --    nombres son los parámetros OUT de la función, y en plpgsql un identificador que
    --    coincide con una variable se sustituye por ella. `return query` casa por
    --    POSICIÓN, así que llamarlas distinto no cuesta nada y elimina la ambigüedad.
    select 1::numeric as ordre, 'registres'::text as clau,
           (select count(*) from membresias m where m.aprovacio = 'pendent')::int as quants,
           null::uuid as objecte, null::jsonb as extra
    union all
    select 2, 'convenis_contrasignar',
           (select count(*) from convenios cv where cv.estado = 'firmat')::int, null, null
    union all
    -- NUEVA (05-10-2026). Ofertas que esperan a que el equipo las valide antes de salir al
    -- Mercat (`excedentes_validacio`). Va entre los convenios y las respuestas porque es lo
    -- primero que le pasa a una oferta, y el orden de esta lista es el orden del proceso.
    -- Es la cifra del badge de «Ofertes»: no baja al entrar en la sección, solo al validar o
    -- rechazar, porque la oferta se queda parada hasta que alguien decide.
    select 2.5, 'ofertes_per_validar',
           (select count(*) from excedentes e where e.estado = 'pendent_validacio')::int,
           null, null
    union all
    select 3, 'respostes',
           (select count(*) from oferta_respuestas r
             where r.estado = 'acceptada' and r.aprovacio = 'pendent')::int, null, null
    union all
    -- NUEVA (20270428100000). Recogidas que el receptor ha registrado y que un admin tiene
    -- que validar (o retornar): hasta entonces no se emite ningún albarán. Va justo después
    -- de las respuestas porque es el paso siguiente del proceso de una entrega.
    select 3.5, 'recollides_per_validar',
           (select count(*) from canalizaciones c
             where c.estado <> 'anulada'
               and c.recollida_registrada_at is not null
               and c.recollida_validada_at is null)::int, null, null
    union all
    -- NUEVA (20270510100200). Firmas que una contraparte ha SUBIDO (vía `pujat`) y que el
    -- super_admin tiene que revisar: cerrar (`tancar_signatura`) o rechazar con motivo
    -- (`rebutjar_signatura`). Va tras las recogidas por validar: es la misma clase de cola
    -- de aprobación. Las de canvas y las que sube el super_admin nacen cerradas y no cuentan.
    select 3.7, 'signatures_per_tancar',
           (select count(*) from firmes_document f where f.estat = 'signat')::int, null, null
    union all
    select 4, 'missatges',
           (select coalesce(sum(ms.pendents), 0)::int from missatges_sense_contestar() ms),
           null, null
    union all
    select 5, 'ofertes_sense_enviar',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and not exists (select 1 from oferta_respuestas r
                                where r.excedente_id = e.id))::int, null, null
    union all
    -- NUEVA (11-10-2026, fase 2 de la revisión del 08-10-2026): ofertas que el PRODUCTOR ha
    -- editado y que el equipo no ha revisado. «Si se modifica una oferta ya publicada,
    -- REDESTINA debería recibir una notificación para revisar si afecta a la canalización.»
    -- Los cambios del propio equipo no cuentan: ya los sabe quien los hizo.
    select 5.5, 'ofertes_modificades',
           (select count(distinct x.excedente_id) from excedentes_canvis x
             where x.revisat_at is null
               and not exists (select 1 from usuario_roles ur where ur.user_id = x.user_id))::int,
           null, null
    union all
    -- «Ofertes sense destí registrat» (revisión del 08-10-2026, fase 1). La clave no cambia
    -- —la usan el badge, el tablero y sus pruebas—, cambia lo que cuenta: ya no «vencidas con
    -- kg sin cubrir» sino ofertas a las que les falta decir qué pasó con algún kilo. Una
    -- `no_colocada` (la «Sense sortida» de la interfaz) cuenta aunque su fecha sea futura: la
    -- marcó el equipo a mano y el destino sigue faltando.
    select 6, 'ofertes_vencudes',
           (select count(*) from excedentes e, param p
             where (e.estado = 'no_colocada'
                    or (e.estado in ('publicada', 'parcial') and e.disponible_hasta < p.avui))
               and (select dx.kg_sense_desti from public.desti_excedent(e.id) dx) > 0)::int,
           null, null
    union all
    -- CAMBIA (20270427100000). Con la recogida registrada por el receptor, cada operación
    -- asignada es un borrador que ESPERA AL RECEPTOR: contarlos todos inflaría la cola con
    -- trabajo que no es del equipo. Cuenta solo:
    --   (a) los de espigolada (REC con `espigolada_id`, o ENT/OPE de un registro de
    --       espigolada): los emite siempre el equipo, el job no los toca;
    --   (b) ENT/OPE cuya canalización está en `canal_equip` (recogida pasada sin registrar, o
    --       sin hora y con más de 2 días);
    --   (c) los REC de una oferta (sin espigolada) solo si alguna de sus canalizaciones está
    --       en `canal_equip`: el REC se emite cuando se registra la última salida;
    --   (d) cualquier otro borrador que no cuelgue ni de una canalización ni de una
    --       espigolada (no hay receptor que lo vaya a cerrar).
    select 7, 'albarans_esborrany',
           (select count(*) from albaranes a
              left join excedentes ex on ex.id = a.excedente_id
             where a.estado = 'borrador'
               and (
                 -- (a)
                 (a.tipo = 'REC' and a.espigolada_id is not null)
                 or (a.tipo in ('ENT', 'OPE') and ex.espigolada_id is not null)
                 -- (b)
                 or (a.tipo in ('ENT', 'OPE') and ex.espigolada_id is null
                     and a.canalizacion_id in (select ce.id from canal_equip ce))
                 -- (c)
                 or (a.tipo = 'REC' and a.espigolada_id is null and a.excedente_id is not null
                     and exists (select 1 from canal_equip ce where ce.excedente_id = a.excedente_id))
                 -- (d)
                 or (a.tipo in ('ENT', 'OPE') and a.canalizacion_id is null
                     and coalesce(ex.espigolada_id is null, true))
                 or (a.tipo = 'REC' and a.espigolada_id is null and a.excedente_id is null)
               ))::int, null, null
    union all
    -- CAMBIA (20270427100000). Lo que tiene que conciliar el equipo:
    --   · los REC entregados o confirmados (como siempre);
    --   · los ENT/OPE confirmados SIN REC vivo (venta o maquila; la rama 3 de
    --     `conciliacions_automatiques()`, que en una espigolada mira el REC de la jornada):
    --     con incidencia de recogida el job no los cierra, y hasta hoy no subían el contador;
    --   · los ENT/OPE confirmados con incidencia de recogida cuyo REC ya está conciliado (la
    --     rama 2 del job los salta y nadie más los cuenta).
    select 8, 'albarans_conciliar',
           (select count(*) from albaranes a
              left join excedentes ex on ex.id = a.excedente_id
              left join canalizaciones c on c.id = a.canalizacion_id
             where (a.tipo = 'REC' and a.estado in ('entregado', 'confirmado'))
                or (a.tipo in ('ENT', 'OPE') and a.estado = 'confirmado'
                    -- 20270428100000: lo que espera la validación de un admin ya cuenta
                    -- en `recollides_per_validar`; contarlo aquí también sería doble.
                    and not coalesce(c.recollida_registrada_at is not null
                                     and c.recollida_validada_at is null, false)
                    and not exists (
                      select 1 from albaranes r
                       where r.tipo = 'REC' and r.estado not in ('anulado', 'rectificado')
                         and (r.excedente_id = a.excedente_id
                              or (ex.espigolada_id is not null and r.espigolada_id = ex.espigolada_id))))
                or (a.tipo in ('ENT', 'OPE') and a.estado = 'confirmado'
                    and c.incidencia_recollida is not null
                    and c.recollida_validada_at is null
                    and c.recollida_registrada_at is null
                    -- ⚠️ Sin `albarans_germans_rec()`: es interna (sin EXECUTE para
                    --    `authenticated`) y esta función es `security invoker`. Misma
                    --    condición, escrita aquí: el REC del excedente o de su jornada.
                    and exists (
                      select 1 from albaranes r
                       where r.tipo = 'REC' and r.estado = 'conciliado'
                         and (r.excedente_id = a.excedente_id
                              or (ex.espigolada_id is not null and r.espigolada_id = ex.espigolada_id)))))::int,
           null, null
    union all
    select 9, 'albarans_esperant',
           (select count(*) from albaranes a where a.estado = 'entregado')::int, null, null
    union all
    select 10, 'costos',
           (select count(distinct e.producto)
              from canalizaciones c
              join excedentes e on e.id = c.excedente_id
              cross join param p
             where extract(year from (c.created_at at time zone 'Europe/Madrid'))::int
                   = p.any_curs
               and e.producto is not null
               and c.coste_kg is null
               and not exists (select 1 from costes_producto cp
                                where cp.producto = e.producto))::int, null, null
    union all
    select 11, 'tancament',
           (select count(*) from cierres_ejercicio ci
             where ci.estado in ('obert', 'provisional'))::int,
           (select t.id from tanc t),
           (select jsonb_build_object(
                     'ejercicio',   t.ejercicio,
                     'modo',        t.modo,
                     'estado',      t.estado,
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
    select 12, 'documents_error',
           (select count(*) from documentos d where d.estado = 'error')::int, null, null
    union all
    -- NUEVA (F3). Ofertas publicadas que declaran producto sin cosechar y todavía no son
    -- una jornada. Es trabajo de campo pendiente: alguien tiene que organizar el espigueo.
    --
    -- ⚠️ `estado = 'publicada'` y no también `'parcial'`, y las dos mitades encajan a
    --    propósito: una oferta con alguna canalización ya no es convertible
    --    —`crear_espigolada()` se niega con `ja_te_canalitzacions`—, así que contarla aquí
    --    sería ofrecer un botón que la base va a rechazar. La cola cuenta exactamente lo
    --    que se puede convertir.
    --
    -- ⚠️ Y `espigolada_id is null` y no `oferta_origen_id`: lo que hay que mirar es si la
    --    oferta YA es parte de una jornada, venga de donde venga. Preguntarlo por el enlace
    --    inverso dejaría fuera cualquier otro camino que la ate a una espigolada, que es
    --    justo el estado que hace imposible convertirla.
    select 13, 'espigolades_per_convertir',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and e.producte_al_camp
               and e.espigolada_id is null)::int, null, null
  )
  select q.clau, q.quants, q.objecte, q.extra from cues q order by q.ordre;
end;
$function$;

comment on function public.pendents_equip() is
  'Cola de trabajo consolidada del equipo: una fila por cola (diecisiete), siempre, aunque n = 0. security invoker: agrega solo lo que quien pregunta ya puede leer. recollides_per_validar (20270428100000); signatures_per_tancar, nueva en 20270510100200 (firmas subidas que revisa el super_admin).';
revoke execute on function public.pendents_equip() from public, anon;
grant  execute on function public.pendents_equip() to authenticated, service_role;
