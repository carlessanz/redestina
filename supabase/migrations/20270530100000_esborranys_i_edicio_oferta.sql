-- =============================================================================
-- Punto 3, fase C (filas 3.1.2 y 3.7 del Excel de revisión de la Fundació, 17-11-2026):
-- el ESBORRANY de una oferta en el servidor, la edición completa tras publicar y el mensaje
-- para compartir siempre al día.
-- =============================================================================
--
-- Lo que pide el Excel:
--   · 3.1.2 / 3.7.1: solo se publica y se comparte una oferta con la información mínima; las
--     incompletas quedan como esborrany y no se pueden compartir.
--   · 3.7.3 / 3.7.4: tras publicar se consulta y se edita todo menos el producto y la entidad;
--     los cambios actualizan la oferta y su mensaje, sin tocar la ficha de la entidad.
--
-- 🔴 DECISIÓN: UN ESTADO NUEVO, `esborrany`, Y NO `borrador`. El encargo decía que `borrador`
--    «existe pero no se usa», y no es así: `crear_espigolada()` pone en `borrador` la oferta que
--    se convierte en jornada de espigueo (la saca del Mercat mientras se cosecha; tiene REC,
--    intereses y canalizaciones), y lo leen `marcar_excedentes_vencidos()` (la pasa a
--    `no_colocada`), `progres_meves_ofertes()`, `cancelar_meva_oferta()`, el tablero, el listado
--    de ofertas activas y el ciclo guiado. Un esborrany ahí dentro heredaría todo eso. Con un
--    estado propio, todas las listas de estados que ya existen lo dejan FUERA sin tocarlas
--    (denegar por defecto), y solo hay que abrirle lo que sí le toca.
--
-- Lo que hace esta migración:
--   1. `excedentes.estado` admite `esborrany`; columna `dades_esborrany jsonb` con el
--      formulario tal cual (solo en esborrany: lo que las columnas no saben guardar —«al camp»
--      sin contestar, una franja a medias—). Un esborrany tiene productor y producto.
--   2. Transiciones (`excedentes_esborrany`): de esborrany solo se sale a `publicada` (y la
--      validación la puede convertir en `pendent_validacio`); a esborrany no se vuelve nunca.
--   3. `excedentes_validacio` también al PUBLICAR un esborrany (UPDATE de estado), con la
--      misma regla que el alta directa.
--   4. Un esborrany no recibe respuestas ni canalizaciones (`*_no_esborrany`).
--   5. Borrar una oferta deja sus fotos en `fitxers_orfes` (`excedentes_fotos_orfes`), si
--      ninguna otra las cita.
--   6. RPC `esborrar_esborrany_oferta(p_id)`: el productor, los suyos; el equipo, todos; solo
--      filas en `esborrany`.
--   7. Lo que contaba ofertas sin mirar el estado deja fuera los esborranys: `kpis_equip()`
--      (ofertes noves, kg oferts), `canalitzacions_actives()` (índice del ciclo),
--      `bloqueigs_esborrat_fitxa()` (un esborrany no impide borrar la ficha) y el «darrer
--      contacte» de `v_entitats_llistat`.
--   8. `editar_oferta()` acepta TODO lo de la ficha salvo producto y entidad: lugar, enlace de
--      Maps propio, formato, cajas, retorno y su detalle, «al camp», días y fotos (más lo de
--      antes). Misma firma; D4, el tope de kg canalizados y `excedentes_canvis`, igual.
--
-- Compatible hacia atrás: el panel publicado no crea esborranys ni manda las claves nuevas.
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. El estado y el formulario guardado
-- ---------------------------------------------------------------------------
alter table public.excedentes drop constraint if exists excedentes_estado_check;
alter table public.excedentes add constraint excedentes_estado_check check (estado = any (array[
  'esborrany', 'borrador', 'pendent_validacio', 'publicada', 'parcial', 'bloqueada', 'cerrada',
  'no_colocada', 'cancelada']));

alter table public.excedentes add column if not exists dades_esborrany jsonb;
comment on column public.excedentes.dades_esborrany is
  'El formulario del alta tal cual, mientras la oferta es un esborrany (20270530100000). Null en cuanto se publica.';

alter table public.excedentes drop constraint if exists excedentes_dades_esborrany;
alter table public.excedentes add constraint excedentes_dades_esborrany
  check (estado = 'esborrany' or dades_esborrany is null);
alter table public.excedentes drop constraint if exists excedentes_esborrany_minim;
alter table public.excedentes add constraint excedentes_esborrany_minim
  check (estado <> 'esborrany' or (productor_id is not null and producto is not null and btrim(producto) <> ''));

create index if not exists excedentes_esborranys_idx on public.excedentes (productor_id)
  where estado = 'esborrany';

-- ---------------------------------------------------------------------------
-- 2. Transiciones del esborrany
-- ---------------------------------------------------------------------------
create or replace function public.trg_excedentes_esborrany()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.estado = 'esborrany' and new.estado not in ('esborrany', 'publicada') then
    raise exception 'esborrany_nomes_es_publica: un esborrany no pot passar a %', new.estado
      using errcode = '22023';
  end if;
  if old.estado <> 'esborrany' and new.estado = 'esborrany' then
    raise exception 'esborrany_no_torna: una oferta % no torna a esborrany', old.estado
      using errcode = '22023';
  end if;
  -- Al salir del esborrany, lo guardado del formulario ya no sirve (y el check lo exige).
  if old.estado = 'esborrany' and new.estado <> 'esborrany' then
    new.dades_esborrany := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_excedentes_esborrany() from public, anon, authenticated;

drop trigger if exists excedentes_esborrany on public.excedentes;
create trigger excedentes_esborrany
  before update of estado on public.excedentes
  for each row execute function public.trg_excedentes_esborrany();

-- ---------------------------------------------------------------------------
-- 3. La validación, también al publicar un esborrany
-- ---------------------------------------------------------------------------
-- Alfabéticamente `excedentes_esborrany` corre antes que `excedentes_validacio`: primero se
-- comprueba que la transición vale, después se decide si queda pendiente de validar.
create or replace function public.trg_excedentes_validacio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.estado = 'publicada'
     and (tg_op = 'INSERT' or old.estado = 'esborrany')
     and coalesce(new.origen, 'intake') in ('intake', 'panel')
     and public.validacio_ofertes_activa() then
    new.estado := 'pendent_validacio';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_excedentes_validacio() from public, anon, authenticated;

drop trigger if exists excedentes_validacio on public.excedentes;
create trigger excedentes_validacio
  before insert or update of estado on public.excedentes
  for each row execute function public.trg_excedentes_validacio();

-- ---------------------------------------------------------------------------
-- 4. Un esborrany no recibe respuestas ni canalizaciones
-- ---------------------------------------------------------------------------
-- Las RPC ya lo impiden (todas piden `publicada`/`parcial`), pero el equipo escribe directo en
-- las dos tablas (§4): esta es la red para que un esborrany no dispare nada.
create or replace function public.trg_no_esborrany()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from excedentes e where e.id = new.excedente_id and e.estado = 'esborrany') then
    raise exception 'oferta_esborrany: una oferta en esborrany no es pot enviar ni canalitzar'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_no_esborrany() from public, anon, authenticated;

drop trigger if exists oferta_respuestas_no_esborrany on public.oferta_respuestas;
create trigger oferta_respuestas_no_esborrany
  before insert on public.oferta_respuestas
  for each row execute function public.trg_no_esborrany();
drop trigger if exists canalizaciones_no_esborrany on public.canalizaciones;
create trigger canalizaciones_no_esborrany
  before insert on public.canalizaciones
  for each row execute function public.trg_no_esborrany();

-- ---------------------------------------------------------------------------
-- 5. Las fotos de una oferta borrada, a la cola de Storage
-- ---------------------------------------------------------------------------
-- La base no puede borrar objetos; los borra `recordatorios-documentales` (fitxersOrfes.ts),
-- que ya agrupa por bucket. Solo las que ninguna otra oferta cita.
create or replace function public.trg_excedentes_fotos_orfes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into fitxers_orfes (bucket, ruta, origen)
  select 'fotos-ofertes', f, 'esborrat_oferta'
    from unnest(coalesce(old.fotos, '{}'::text[])) f
   where f is not null and f <> ''
     and not exists (select 1 from excedentes e where e.id <> old.id and f = any(e.fotos))
  on conflict (bucket, ruta) do nothing;
  return old;
end;
$$;
revoke execute on function public.trg_excedentes_fotos_orfes() from public, anon, authenticated;

drop trigger if exists excedentes_fotos_orfes on public.excedentes;
create trigger excedentes_fotos_orfes
  after delete on public.excedentes
  for each row execute function public.trg_excedentes_fotos_orfes();

-- ---------------------------------------------------------------------------
-- 6. Borrar un esborrany
-- ---------------------------------------------------------------------------
-- El permiso va ANTES que la existencia (§4bis): a una cuenta externa, un id que no es suyo
-- —exista o no— le da 42501. Solo se borra lo que está en esborrany: una oferta publicada se
-- cancela (o se le registra el destino), nunca se borra.
create or replace function public.esborrar_esborrany_oferta(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex excedentes;
begin
  if auth.uid() is not null and not public.es_intern()
     and not exists (select 1 from excedentes e
                      where e.id = p_id and e.productor_id in (select public.mis_productores())) then
    raise exception 'Nomes el productor de l''oferta o l''equip' using errcode = '42501';
  end if;
  select * into ex from excedentes where id = p_id for update;
  if ex.id is null then
    raise exception 'oferta_inexistent' using errcode = '22023';
  end if;
  if ex.estado <> 'esborrany' then
    raise exception 'no_es_esborrany: una oferta % no s''esborra (es cancel·la)', ex.estado
      using errcode = '22023';
  end if;
  -- Un esborrany no tiene respuestas, canalizaciones ni albaranes (los triggers del paso 4 y
  -- `editar_oferta()` lo impiden); las fotos las recoge `excedentes_fotos_orfes`.
  delete from excedentes where id = ex.id;
end;
$$;
revoke execute on function public.esborrar_esborrany_oferta(uuid) from public, anon;
grant execute on function public.esborrar_esborrany_oferta(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Lo que contaba ofertas: sin los esborranys
-- ---------------------------------------------------------------------------

-- 7a. Indicadores del equipo: «ofertes noves» y «kg oferts» sin esborranys.
CREATE OR REPLACE FUNCTION public.kpis_equip(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip veu els indicadors' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'periode_invalid' using errcode = '22023';
  end if;

  with ofertes as (
    select ex.*, (ex.created_at at time zone 'Europe/Madrid')::date as dia_alta
      from excedentes ex
     -- 20270530100000: un esborrany no es una oferta (no cuenta en «ofertes noves» ni en kg).
     where ex.estado <> 'esborrany'
  ), canals as (
    select c.*,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at) at time zone 'Europe/Madrid')::date as dia
      from canalizaciones c
     where c.estado <> 'anulada'
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    -- Kilos oficiales (conciliados, D13) con la recogida dentro del periodo.
    'kg_canalitzats', coalesce((select sum(coalesce(c.kg_conciliados, c.kg_reales, c.kg_confirmados))
                                  from canals c where c.estado = 'conciliada' and c.dia between p_desde and p_hasta), 0),
    -- Kilos asignados (aprobados) en el periodo, conciliados o no.
    'kg_assignats', coalesce((select sum(c.kg_confirmados) from canals c where c.dia between p_desde and p_hasta), 0),
    'canalitzacions', (select count(*) from canals c where c.dia between p_desde and p_hasta),
    'ofertes_noves', (select count(*) from ofertes o where o.dia_alta between p_desde and p_hasta),
    'kg_oferts', coalesce((select sum(o.kg_total) from ofertes o where o.dia_alta between p_desde and p_hasta), 0),
    -- Las de ahora, sin periodo: lo que está vivo hoy.
    'ofertes_actives', (select count(*) from ofertes o where o.estado in ('pendent_validacio', 'publicada', 'parcial', 'bloqueada')),
    'kg_pendents', coalesce((select sum(greatest(0, o.kg_total - coalesce((select sum(c.kg_confirmados) from canals c where c.excedente_id = o.id), 0)))
                               from ofertes o where o.estado in ('publicada', 'parcial')), 0),
    -- Las que acabaron sin salida en el periodo (por su fecha límite).
    'ofertes_sense_sortida', (select count(*) from ofertes o
                               where o.estado = 'no_colocada' and o.disponible_hasta between p_desde and p_hasta),
    'entitats_receptores', (select count(distinct c.entidad_id) from canals c where c.dia between p_desde and p_hasta),
    -- 1A (20270501100000): el censo de hoy, solo lo activo (D7: la organización está activa
    -- si lo está alguno de sus papeles).
    'entitats_actives', (select count(*) from v_organizaciones v where v.activa),
    'ofertants_actius', (select count(*) from productores p where p.activo),
    'receptors_actius', (select count(*) from entidades e where e.activo)
  ) into v;
  return v;
end;
$function$;

-- 7b. El índice del ciclo guiado: un esborrany no es un lote.
CREATE OR REPLACE FUNCTION public.canalitzacions_actives(p_limit integer DEFAULT 200)
 RETURNS TABLE(excedente_id uuid, id_excedente text, productor text, estado text, modalitat text, kg_total numeric, kg_canalitzats numeric, n_per_aprovar integer, rec_estado text, ents_pendents integer, conveni_gen text, created_at timestamp with time zone, origen text, sortida_estado text, tot_conciliat boolean, n_respostes integer, n_per_aprovar_sense_conveni integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
              on (ce.tipo_convenio = c.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce.tipo_convenio and eq.tipo_antic = c.tipo and eq.valorizacion = ex.modalitat)) and ce.valorizacion = ex.modalitat
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
                   on (ce5.tipo_convenio = c5.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce5.tipo_convenio and eq.tipo_antic = c5.tipo and eq.valorizacion = ex.modalitat)) and ce5.valorizacion = ex.modalitat
                  and ce5.parte = 'recibe'
                where c5.entidad_id = r3.entidad_id and c5.estado = 'vigent'))::int
    from excedentes ex
    left join productores p on p.id = ex.productor_id
   -- 20270530100000: los esborranys no son lotes del ciclo (no se han publicado).
   where ex.estado not in ('cancelada', 'no_colocada', 'esborrany')
   order by ex.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$function$;

-- 7c. Borrar una ficha: un esborrany no bloquea (se va con lo operativo).
CREATE OR REPLACE FUNCTION public.bloqueigs_esborrat_fitxa(p_tipo text, p_ficha uuid)
 RETURNS TABLE(codi text, n bigint, detall text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Los tres nombres de salida (`codi`, `n`, `detall`) son a la vez variables de plpgsql y
-- columnas del `return query`. Se declara qué gana —va ANTES del `declare`, es donde lo
-- lee plpgsql— en vez de confiar en que toda referencia quede calificada: aquí ninguna
-- variable se llama como una columna, así que `use_column` no puede sorprender.
#variable_conflict use_column
declare
  v_prod uuid := case when p_tipo = 'productor' then p_ficha end;
  v_ent  uuid := case when p_tipo = 'entidad'   then p_ficha end;
begin
  -- Consultar los bloqueos es una pregunta del equipo: enseña cuántos documentos y
  -- cierres tiene una organización. `service_role` entra igual (§4bis).
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'no_autoritzat: nomes l''equip pot consultar els bloquejos d''una fitxa'
      using errcode = '42501';
  end if;

  if p_tipo not in ('productor', 'entidad') then
    raise exception 'tipus_desconegut: % (ha de ser productor o entidad)', p_tipo
      using errcode = '22023';
  end if;

  return query
  with
  -- Los excedentes, las canalizaciones y los albaranes que cuelgan de esta ficha. Un
  -- albarán **no tiene FK a la ficha**: se resuelve por el registro (REC de donación), por
  -- la jornada (REC de espigolada) o por la canalización (ENT y OPE).
  exc as (
    -- 20270530100000: un esborrany no es «ha ofrecido algo» (no se publicó): no bloquea, y
    -- `borrar_una_fitxa()` se lo lleva con lo operativo (sus fotos, a `fitxers_orfes`).
    select id from excedentes where v_prod is not null and productor_id = v_prod
       and estado <> 'esborrany'
  ),
  esp as (
    select id from espigoladas where v_prod is not null and productor_id = v_prod
  ),
  cana as (
    select c.id from canalizaciones c
     where (v_ent  is not null and c.entidad_id = v_ent)
        or (v_prod is not null and c.excedente_id in (select id from exc))
  ),
  alb as (
    select a.id, a.estado from albaranes a
     where a.excedente_id    in (select id from exc)
        or a.espigolada_id   in (select id from esp)
        or a.canalizacion_id in (select id from cana)
  ),
  conv as (
    select c.id, c.numero_completo from convenios c
     where (v_prod is not null and c.productor_id = v_prod)
        or (v_ent  is not null and c.entidad_id   = v_ent)
  ),
  pla as (
    select p.id, p.numero_completo from planes_prevencion p
     where (v_prod is not null and p.productor_id = v_prod)
        or (v_ent  is not null and p.entidad_id   = v_ent)
  ),
  cie as (
    select id from cierres_donante where v_prod is not null and productor_id = v_prod
  ),
  cip as (
    select id from cierres_periodo where v_prod is not null and productor_id = v_prod
  ),
  -- Los certificados de recepción de esta receptora (deuda §12.140, 10-11-2026). En la práctica
  -- ya los cubre `ofertes_rebudes` (un CR sale de lo que recibió), pero sin esta red un CR sin
  -- canalizaciones vivas chocaría con la FK `no action` en vez de dar el motivo.
  cir as (
    select id from cierres_receptor where v_ent is not null and entidad_id = v_ent
  ),
  -- Los expedientes de prevención (deuda §12.140). La FK es `restrict` a propósito: un
  -- expediente con número es documentación y bloquea; uno sin número se borra con la ficha.
  exp as (
    select x.id, x.numero_completo from expedients_prevencion x
     where (v_prod is not null and x.productor_id = v_prod)
        or (v_ent  is not null and x.entidad_id   = v_ent)
  ),
  motius as (
    -- (0) Las OFERTAS (04-11-2026, decisión de Carles). Hasta hoy se arrastraban con la
    --     ficha; desde esta migración bloquean, como lo fiscal: una oferta es la historia
    --     operativa de la organización —y, si se canalizó, también la de otra—, y lo que se
    --     hace con una entidad que ya ha operado es DESACTIVARLA, no borrarla. El borrado
    --     queda para lo que se dio de alta por error y nunca operó.
    --       · productor → `ofertes`: cualquier excedente suyo, en cualquier estado (también
    --         `cancelada` y `borrador`: la regla es «ha ofrecido algo», no «sigue abierta»).
    --       · entidad   → `ofertes_rebudes`: las ofertas distintas en las que ha participado,
    --         por una respuesta (se le envió, mostró interés o la declinó) o por una
    --         canalización. Borrarla se llevaba esas filas y le cambiaba la historia de la
    --         oferta al productor.
    select 'ofertes' as codi,
           count(*)  as n,
           'Te ' || count(*) || ' oferta(es) (desactiva-la en lloc d''esborrar-la)' as detall
      from exc
    union all
    select 'ofertes_rebudes', count(*),
           'Ha participat en ' || count(*) || ' oferta(es) d''altres (desactiva-la en lloc d''esborrar-la)'
      from (
        select r.excedente_id from oferta_respuestas r
         where v_ent is not null and r.entidad_id = v_ent
        union
        select c.excedente_id from canalizaciones c
         where v_ent is not null and c.entidad_id = v_ent
      ) t
    union all
    -- (a) Albaranes que ya no son borrador. El umbral es exactamente el de
    --     `albaranes_no_esborrar`: un borrador no tiene número y no documenta nada, así
    --     que se arrastra; cualquier otro estado es un hecho con número de serie.
    --     ⚠️ No vale bloquear con «tiene algún albarán» a secas: el trigger
    --     `canalizaciones_crea_albaranes` crea uno en borrador con CADA canalización, así
    --     que eso haría indeleble cualquier ficha que haya canalizado una vez.
    select 'albarans',
           count(*),
           'Te ' || count(*) || ' albara(ns) emesos, entregats o conciliats' as detall
      from alb where estado <> 'borrador'
    union all
    -- (b) Cierres anuales y certificados a demanda de este donante.
    select 'tancaments', count(*),
           'Te ' || count(*) || ' tancament(s) o certificat(s) a demanda'
      from (select id from cie union all select id from cip union all select id from cir) t
    union all
    -- (c) Líneas de cierre que citan esta ficha o una de sus canalizaciones. Es la
    --     evidencia fiscal que hoy se quedaba apuntando a nadie por el `set null`.
    select 'linies_tancament', count(*),
           'Apareix a ' || count(*) || ' linia(es) de tancament d''un altre donant'
      from (
        select l.id from cierre_donante_lineas l
         where (v_ent is not null and l.entidad_id = v_ent)
            or l.canalizacion_id in (select id from cana)
        union all
        select l.id from cierre_periodo_lineas l
         where (v_ent is not null and l.entidad_id = v_ent)
            or l.canalizacion_id in (select id from cana)
      ) t
    union all
    -- (d) Convenios y planes con número: los congela su propio trigger, y la CASCADE de la
    --     ficha se estrellaría contra él a mitad del borrado.
    select 'convenis', count(*),
           'Te ' || count(*) || ' conveni(s) amb numero'
      from conv where numero_completo is not null
    union all
    select 'plans', count(*),
           'Te ' || count(*) || ' pla(ns) de prevencio amb numero'
      from pla where numero_completo is not null
    union all
    select 'expedients', count(*),
           'Te ' || count(*) || ' expedient(s) de prevencio amb numero'
      from exp where numero_completo is not null
    union all
    -- (e) Cualquier documento emitido cuyo objeto sea de esta ficha. Es la red que cubre
    --     los seis `objeto_tipo` a la vez: un documento no se puede borrar (su trigger lo
    --     impide y la serie no puede tener huecos), así que si existe, la ficha se queda.
    select 'documents', count(*),
           'Te ' || count(*) || ' document(s) emesos (no s''esborren mai)'
      from documentos d
     where (d.objeto_tipo = 'albaran'        and d.objeto_id in (select id from alb))
        or (d.objeto_tipo = 'espigolada'     and d.objeto_id in (select id from esp))
        or (d.objeto_tipo = 'convenio'       and d.objeto_id in (select id from conv))
        or (d.objeto_tipo = 'plan'           and d.objeto_id in (select id from pla))
        or (d.objeto_tipo = 'cierre_donante' and d.objeto_id in (select id from cie))
        or (d.objeto_tipo = 'cierre_periodo' and d.objeto_id in (select id from cip))
        or (d.objeto_tipo = 'cierre_receptor' and d.objeto_id in (select id from cir))
        or (d.objeto_tipo = 'expedient'      and d.objeto_id in (select id from exp))
  )
  select m.codi, m.n, m.detall from motius m where m.n > 0;
end;
$function$;

-- 7d. «Darrer contacte» del listado de entidades: un esborrany no es actividad.
create or replace view public.v_entitats_llistat with (security_invoker = true) as
SELECT v.id,
    v.nom_comercial,
    v.razon_social,
    v.nif,
    v.persona_contacte,
    v.email,
    v.telefono,
    v.poblacion,
    v.comarca,
    v.municipio_ine,
    v.productor_id,
    v.entidad_id,
    v.es_generadora,
    v.es_receptora,
    v.productor_activo,
    v.entidad_activo,
    v.activa,
    v.tipo_receptor,
    v.tipus_activitat,
    v.te_compte,
    v.compte_estat,
    v.canal_preferido,
    v.created_at,
    COALESCE(p.es_test, false) OR COALESCE(e.es_test, false) AS es_test,
    (EXISTS ( SELECT 1
           FROM membresias m
          WHERE m.aprovacio = 'rebutjada'::text AND (p.id IS NOT NULL AND m.productor_id = p.id OR e.id IS NOT NULL AND m.entidad_id = e.id))) AS rebutjada,
    COALESCE(e.modalitats_interes, '{}'::text[]) AS modalitats_interes,
    e.prioritat,
    p.id IS NOT NULL AND (EXISTS ( SELECT 1
           FROM convenios c
          WHERE c.estado = 'vigent'::text AND c.productor_id = p.id)) AS conveni_productor,
    e.id IS NOT NULL AND (EXISTS ( SELECT 1
           FROM convenios c
          WHERE c.estado = 'vigent'::text AND c.entidad_id = e.id)) AS conveni_entitat,
    GREATEST(( SELECT max(x.created_at) AS max
           FROM excedentes x
          WHERE p.id IS NOT NULL AND x.productor_id = p.id AND x.estado <> 'esborrany'::text), ( SELECT max(r.created_at) AS max
           FROM oferta_respuestas r
          WHERE e.id IS NOT NULL AND r.entidad_id = e.id), ( SELECT max(c.created_at) AS max
           FROM canalizaciones c
          WHERE e.id IS NOT NULL AND c.entidad_id = e.id)) AS darrera_activitat,
    dc.data AS darrer_contacte_at,
    dc.canal AS darrer_contacte_canal,
    COALESCE(sp.n, 0::bigint)::integer AS seguiments_pendents,
    sp.propera AS propera_seguiment,
    v.productor_estat_crm,
    v.entidad_estat_crm,
        CASE
            WHEN 'actiu'::text = v.productor_estat_crm OR 'actiu'::text = v.entidad_estat_crm THEN 'actiu'::text
            WHEN 'en_desenvolupament'::text = v.productor_estat_crm OR 'en_desenvolupament'::text = v.entidad_estat_crm THEN 'en_desenvolupament'::text
            WHEN 'potencial'::text = v.productor_estat_crm OR 'potencial'::text = v.entidad_estat_crm THEN 'potencial'::text
            ELSE 'inactiu'::text
        END AS estat_crm
   FROM v_organizaciones v
     LEFT JOIN productores p ON p.id = v.productor_id
     LEFT JOIN entidades e ON e.id = v.entidad_id
     LEFT JOIN LATERAL ( SELECT n.data,
            n.canal
           FROM notes_internes n
          WHERE n.organizacion_id = v.id
          ORDER BY n.data DESC, n.created_at DESC
         LIMIT 1) dc ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS n,
            min(n.propera_data) AS propera
           FROM notes_internes n
          WHERE n.organizacion_id = v.id AND n.propera_accio IS NOT NULL AND n.seguiment_fet_at IS NULL) sp ON true
  WHERE v.productor_id IS NOT NULL OR v.entidad_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. `editar_oferta()`: toda la ficha salvo producto y entidad
-- ---------------------------------------------------------------------------
-- Misma firma y mismo `returns` (§4bis: `create or replace` no los cambia). Claves nuevas:
-- `ubicacion_id` (de ESTE productor), `gmaps_url`, `format_entrega`, `retorn_envasos` con su
-- detalle y cantidad (sin retorno «Sí», los dos se vacían), `producte_al_camp`,
-- `dies_recollida`, `fotos` (como `fixar_fotos_oferta`: ≤ 3 y de su carpeta) y
-- `foto_producte`. Nada de esto escribe en la ficha de la entidad ni en sus lugares.
create or replace function public.editar_oferta(p_id uuid, p_canvis jsonb, p_texto text, p_actor uuid)
returns excedentes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex        excedentes;
  nou       excedentes;
  v_intern  boolean;
  v_prod    boolean;
  cubierto  numeric;
  v_mods    text[];
  v_sub     text;
  v_ubi     uuid;
  v_format  text;
  v_retorn  text;
  v_detall  text;
  v_quant   integer;
  v_dies    smallint[];
  v_maps    text;
  v_fotos   text[];
  v_f       text;
  revalidar boolean := false;
  clau      text;
  permeses  text[] := array['kg_total', 'modalitats', 'preu_minim', 'coste_kg', 'disponible_hasta',
                            'hora_recollida_inici', 'hora_recollida_fi', 'horari_recollida',
                            'observacions', 'variedad', 'num_caixes', 'subcausa_codigo',
                            -- 20270530100000 (punto 3, fase C):
                            'ubicacion_id', 'gmaps_url', 'format_entrega', 'retorn_envasos',
                            'retorn_envasos_detall', 'retorn_envasos_quantitat', 'producte_al_camp',
                            'dies_recollida', 'fotos', 'foto_producte'];
begin
  if p_actor is null then
    raise exception 'Cal actor' using errcode = '42501';
  end if;
  select * into ex from excedentes where id = p_id for update;
  if ex.id is null then
    raise exception 'Oferta inexistent' using errcode = '22023';
  end if;

  v_intern := exists (select 1 from usuario_roles ur where ur.user_id = p_actor);
  v_prod := exists (select 1 from membresias m
                     where m.user_id = p_actor and m.activo and m.productor_id = ex.productor_id);
  if not v_intern and not v_prod then
    raise exception 'No pots editar aquesta oferta' using errcode = '42501';
  end if;
  -- Un esborrany NO se edita por aquí: se guarda por `crear-oferta/esborrany` y se publica.
  if ex.estado not in ('pendent_validacio', 'publicada', 'parcial', 'bloqueada') then
    raise exception 'oferta_no_editable: una oferta % no es pot editar', ex.estado using errcode = '22023';
  end if;

  for clau in select jsonb_object_keys(p_canvis) loop
    if not (clau = any(permeses)) then
      raise exception 'camp_no_editable: %', clau using errcode = '22023';
    end if;
  end loop;

  select coalesce(sum(kg_confirmados), 0) into cubierto from canalizaciones where excedente_id = ex.id;
  if p_canvis ? 'kg_total' then
    if (p_canvis->>'kg_total')::numeric is null or (p_canvis->>'kg_total')::numeric <= 0 then
      raise exception 'kg_invalids' using errcode = '22023';
    end if;
    if (p_canvis->>'kg_total')::numeric < cubierto then
      raise exception 'kg_menys_canalitzats: ja n''hi ha % kg canalitzats', cubierto using errcode = '22023';
    end if;
  end if;
  if p_canvis ? 'modalitats' then
    select array_agg(m order by array_position(array['donacio','venda','maquila'], m))
      into v_mods
      from (select distinct jsonb_array_elements_text(p_canvis->'modalitats') m) s;
    if v_mods is null or cardinality(v_mods) = 0 then
      raise exception 'modalitats_buides' using errcode = '22023';
    end if;
    -- Una entrega ya aprobada en una modalidad no puede quedar fuera de la oferta.
    if exists (select 1 from canalizaciones c where c.excedente_id = ex.id
                and c.valorizacion is not null and not (c.valorizacion = any(v_mods))) then
      raise exception 'modalitat_amb_canalitzacions' using errcode = '22023';
    end if;
  end if;
  -- La subcausa (fase B del punto 3): una del catálogo y activa; no se vacía.
  if p_canvis ? 'subcausa_codigo' then
    v_sub := nullif(btrim(p_canvis->>'subcausa_codigo'), '');
    if v_sub is null or not exists (select 1 from subcausas s where s.codigo = v_sub and s.activa) then
      raise exception 'subcausa_invalida: %', coalesce(v_sub, '(buida)') using errcode = '22023';
    end if;
  end if;

  -- El lugar: de ESTE productor (la función corre como definer: la RLS no lo mira por ella).
  if p_canvis ? 'ubicacion_id' then
    v_ubi := nullif(p_canvis->>'ubicacion_id', '')::uuid;
    if v_ubi is null or not exists (select 1 from productor_ubicaciones u
                                     where u.id = v_ubi and u.productor_id = ex.productor_id) then
      raise exception 'ubicacio_aliena' using errcode = '22023';
    end if;
  end if;
  if p_canvis ? 'gmaps_url' then
    v_maps := nullif(btrim(coalesce(p_canvis->>'gmaps_url', '')), '');
    if v_maps is not null and (v_maps !~* '^https?://\S+$' or char_length(v_maps) > 500) then
      raise exception 'maps_invalid' using errcode = '22023';
    end if;
  end if;
  if p_canvis ? 'format_entrega' then
    v_format := nullif(p_canvis->>'format_entrega', '');
    if v_format is not null and v_format not in ('caixes', 'palet', 'envasos_propis', 'altres') then
      raise exception 'format_invalid' using errcode = '22023';
    end if;
  end if;
  -- El retorno y su detalle: sin «Sí», el detalle y la cantidad se vacían (como en el alta).
  v_retorn := case when p_canvis ? 'retorn_envasos' then nullif(p_canvis->>'retorn_envasos', '')
                   else ex.retorn_envasos end;
  if v_retorn is not null and v_retorn not in ('Sí', 'No') then
    raise exception 'retorn_invalid' using errcode = '22023';
  end if;
  v_detall := case when p_canvis ? 'retorn_envasos_detall'
                   then left(nullif(btrim(coalesce(p_canvis->>'retorn_envasos_detall', '')), ''), 400)
                   else ex.retorn_envasos_detall end;
  if p_canvis ? 'retorn_envasos_quantitat' then
    if nullif(p_canvis->>'retorn_envasos_quantitat', '') is null then
      v_quant := null;
    elsif (p_canvis->>'retorn_envasos_quantitat') !~ '^[0-9]+$'
          or (p_canvis->>'retorn_envasos_quantitat')::integer <= 0 then
      raise exception 'retorn_quantitat_invalid' using errcode = '22023';
    else
      v_quant := (p_canvis->>'retorn_envasos_quantitat')::integer;
    end if;
  else
    v_quant := ex.retorn_envasos_quantitat;
  end if;
  if v_retorn is distinct from 'Sí' then
    v_detall := null;
    v_quant := null;
  end if;
  if p_canvis ? 'dies_recollida' then
    if jsonb_typeof(p_canvis->'dies_recollida') = 'array' then
      select array_agg(distinct d::smallint order by d::smallint) into v_dies
        from jsonb_array_elements_text(p_canvis->'dies_recollida') d;
      if exists (select 1 from unnest(coalesce(v_dies, '{}')) d where d not between 1 and 7) then
        raise exception 'dies_invalids' using errcode = '22023';
      end if;
    end if;
  end if;
  if p_canvis ? 'fotos' then
    select coalesce(array_agg(f), '{}') into v_fotos
      from jsonb_array_elements_text(coalesce(p_canvis->'fotos', '[]'::jsonb)) f;
    if cardinality(v_fotos) > 3 then
      raise exception 'massa_fotos' using errcode = '22023';
    end if;
    foreach v_f in array v_fotos loop
      if split_part(v_f, '/', 1) <> ex.productor_id::text then
        raise exception 'foto_aliena' using errcode = '22023';
      end if;
    end loop;
  end if;

  update excedentes e set
    kg_total             = case when p_canvis ? 'kg_total' then (p_canvis->>'kg_total')::numeric else e.kg_total end,
    modalitats           = case when p_canvis ? 'modalitats' then v_mods else e.modalitats end,
    modalitat            = case when p_canvis ? 'modalitats' then v_mods[1] else e.modalitat end,
    preu_minim           = case when p_canvis ? 'preu_minim' then nullif(p_canvis->>'preu_minim', '')::numeric else e.preu_minim end,
    coste_kg             = case when p_canvis ? 'coste_kg' then nullif(p_canvis->>'coste_kg', '')::numeric else e.coste_kg end,
    disponible_hasta     = case when p_canvis ? 'disponible_hasta' then nullif(p_canvis->>'disponible_hasta', '')::date else e.disponible_hasta end,
    hora_recollida_inici = case when p_canvis ? 'hora_recollida_inici' then nullif(p_canvis->>'hora_recollida_inici', '')::time else e.hora_recollida_inici end,
    hora_recollida_fi    = case when p_canvis ? 'hora_recollida_fi' then nullif(p_canvis->>'hora_recollida_fi', '')::time else e.hora_recollida_fi end,
    horari_recollida     = case when p_canvis ? 'horari_recollida' then nullif(p_canvis->>'horari_recollida', '') else e.horari_recollida end,
    observacions         = case when p_canvis ? 'observacions' then nullif(p_canvis->>'observacions', '') else e.observacions end,
    variedad             = case when p_canvis ? 'variedad' then nullif(p_canvis->>'variedad', '') else e.variedad end,
    num_caixes           = case when p_canvis ? 'num_caixes' then nullif(p_canvis->>'num_caixes', '')::integer else e.num_caixes end,
    subcausa_codigo      = case when p_canvis ? 'subcausa_codigo' then v_sub else e.subcausa_codigo end,
    ubicacion_id         = case when p_canvis ? 'ubicacion_id' then v_ubi else e.ubicacion_id end,
    gmaps_url            = case when p_canvis ? 'gmaps_url' then v_maps else e.gmaps_url end,
    format_entrega       = case when p_canvis ? 'format_entrega' then v_format else e.format_entrega end,
    retorn_envasos       = v_retorn,
    retorn_envasos_detall    = v_detall,
    retorn_envasos_quantitat = v_quant,
    producte_al_camp     = case when p_canvis ? 'producte_al_camp' then coalesce((p_canvis->>'producte_al_camp')::boolean, false) else e.producte_al_camp end,
    dies_recollida       = case when p_canvis ? 'dies_recollida' then v_dies else e.dies_recollida end,
    fotos                = case when p_canvis ? 'fotos' then v_fotos else e.fotos end,
    foto_producte        = case when p_canvis ? 'foto_producte' then coalesce((p_canvis->>'foto_producte')::boolean, true) else e.foto_producte end,
    texto_oferta         = coalesce(nullif(p_texto, ''), e.texto_oferta)
  where e.id = ex.id
  returning * into nou;

  -- D4: el productor cambia lo que decide a quién le sirve la oferta → vuelve a validación,
  -- si la validación está encendida y la oferta ya estaba fuera. El equipo no revalida: es
  -- quien valida.
  if not v_intern and public.validacio_ofertes_activa()
     and ex.estado in ('publicada', 'parcial', 'bloqueada')
     and (nou.kg_total is distinct from ex.kg_total
          or nou.modalitats is distinct from ex.modalitats) then
    revalidar := true;
    update excedentes set estado = 'pendent_validacio', validada_at = null, validada_per = null
     where id = ex.id
    returning * into nou;
  end if;

  -- Cubierto o no, con los kg nuevos.
  if not revalidar and nou.estado in ('publicada', 'parcial', 'bloqueada') and cubierto > 0 then
    update excedentes set estado = case
             when coalesce(nou.kg_total, 0) > 0 and cubierto >= nou.kg_total then 'bloqueada'
             else 'parcial' end
     where id = ex.id
    returning * into nou;
  end if;

  insert into excedentes_canvis (excedente_id, user_id, abans, despres, revalidar)
  values (ex.id, p_actor,
          (select jsonb_object_agg(k, to_jsonb(ex) -> k) from jsonb_object_keys(p_canvis) k),
          (select jsonb_object_agg(k, to_jsonb(nou) -> k) from jsonb_object_keys(p_canvis) k),
          revalidar);
  return nou;
end;
$$;
revoke execute on function public.editar_oferta(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant  execute on function public.editar_oferta(uuid, jsonb, text, uuid) to service_role;
