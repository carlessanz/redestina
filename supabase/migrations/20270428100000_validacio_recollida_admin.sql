-- La recogida la VALIDA un admin antes de emitir nada (17-10-2026).
--
-- QUÉ DECIDE CARLES. Los albaranes de una recogida —número de serie legal y PDF— solo se
-- generan cuando un ADMIN (`pot_aprovar()`: admin o super_admin; el `tecnic` no) aprueba que
-- el receptor ha recibido la cantidad que declaró. Hasta ese momento no se emite nada.
--
-- Hasta hoy `registrar_recollida()` (20270426100000) emitía el ENT/OPE y el REC en cuanto el
-- receptor registraba. Ahora la recogida tiene dos actos:
--
--   1. `registrar_recollida()` (receptor): SOLO GUARDA la declaración —kg, resultado,
--      fecha, observaciones o motivo de la diferencia—. No emite, no entrega, no confirma,
--      no concilia y no toca `kg_reales`. La canalización queda «registrada, pendent de
--      validar» y entra en la cola nueva del equipo, `recollides_per_validar`.
--   2. `validar_recollida()` (admin): con los kg declarados o corregidos (con motivo), hace
--      lo que antes hacía el registro: emite y entrega la salida, confirma por declaración
--      del receptor, emite y confirma el REC cuando ya no falta ninguna salida de la oferta
--      por validar, y CONCILIA —la validación del admin es la revisión—.
--      `retornar_recollida()` (admin) la devuelve al receptor con un motivo para que la
--      vuelva a registrar (aviso nuevo `recollida_retornada`).
--
-- EL CANDADO. `emitir_albaran()` se niega (`22023 recollida_no_validada`) a emitir un
-- albarán del flujo de recogida —ENT/OPE de una canalización, o el REC de una oferta, que no
-- sean de espigolada— fuera del contexto de validación. El contexto es
-- `redestina.validacio_recollida = 'on'`, local a la transacción, y solo lo fijan
-- `validar_recollida()`, `confirmar_recollida()` (el admin validando directamente: pasa de
-- `es_intern()` a `pot_aprovar()`) y `rectificar_albaran()` (sustituye a uno ya emitido).
-- Es el patrón de `redestina.reinicio_prueba`: nadie con sesión puede fijar un GUC por
-- PostgREST, así que el candado no depende de que ninguna pantalla se porte bien.
-- Las tres lo devuelven a su valor anterior al salir.
--
-- ⚠️ Con esto el equipo YA NO EMITE a mano un ENT/OPE/REC del flujo desde «Albarans»
--    (botón «Emet»): la vía es validar la recogida o «Confirma la recollida». Los albaranes
--    de espigolada (la jornada y su reparto) no cambian.
--
-- QUIÉN ESCRIBE LAS COLUMNAS DE LA RECOGIDA. `canalizaciones` tiene UPDATE de tabla para
-- `authenticated` (con la política `es_intern()`, deuda 132), así que un GRANT por columnas no
-- serviría. Las protege un trigger: con sesión, solo cambian dentro de las RPC de la
-- recogida (que fijan `redestina.escriu_recollida` o `redestina.validacio_recollida`).

-- --------------------------------------------------------------------- 0. Columnas nuevas
alter table public.canalizaciones
  add column if not exists kg_declarats            numeric,
  add column if not exists resultat_recollida      text,
  add column if not exists recollida_validada_at   timestamptz,
  add column if not exists recollida_validada_per  uuid references auth.users(id) on delete set null,
  add column if not exists recollida_retornada_at  timestamptz,
  add column if not exists motiu_retorn            text,
  -- No estaban en el contrato y hacen falta: las observaciones de un «coincideix» (que no es
  -- una incidencia, así que no pueden ir en `incidencia_recollida` sin activar sus guardas)
  -- y las declaraciones que un admin ha retornado.
  add column if not exists observacions_recollida  text,
  add column if not exists historial_recollida     jsonb not null default '[]'::jsonb;

alter table public.canalizaciones drop constraint if exists canalizaciones_resultat_recollida_check;
alter table public.canalizaciones add constraint canalizaciones_resultat_recollida_check
  check (resultat_recollida is null or resultat_recollida in ('coincideix', 'menys', 'mes')) not valid;
alter table public.canalizaciones validate constraint canalizaciones_resultat_recollida_check;

comment on column public.canalizaciones.kg_declarats is
  'Kilos que declaró la entidad receptora al registrar la recogida (registrar_recollida). Los oficiales los fija validar_recollida() en kg_reales.';
comment on column public.canalizaciones.resultat_recollida is
  'Lo que declaró el receptor: coincideix (= los kg asignados), menys o mes.';
comment on column public.canalizaciones.recollida_validada_at is
  'Cuándo un admin validó la recogida (validar_recollida o confirmar_recollida). Solo entonces se emiten los albaranes.';
comment on column public.canalizaciones.recollida_validada_per is
  'El admin que validó la recogida.';
comment on column public.canalizaciones.recollida_retornada_at is
  'Cuándo un admin devolvió la declaración al receptor para que la vuelva a registrar (retornar_recollida).';
comment on column public.canalizaciones.motiu_retorn is
  'Por qué la devolvió. Se limpia cuando el receptor vuelve a registrar.';
comment on column public.canalizaciones.observacions_recollida is
  'Las observaciones que dejó el receptor al registrar (en un «coincideix» no hay incidencia que las guarde).';
comment on column public.canalizaciones.historial_recollida is
  'Declaraciones retornadas por un admin: [{kg_declarats, resultat, observacions, incidencia, registrada_at, registrada_per, retornada_at, retornada_per, motiu}].';

-- Las recogidas registradas con el flujo anterior (20270426100000) ya emitieron sus
-- albaranes. Se rellena lo declarado con lo que se guardó, y las que ya están conciliadas se
-- dan por validadas cuando se conciliaron. Las que tienen una incidencia todavía sin
-- conciliar se quedan «registrades, per validar»: validarlas (sin corregir kilos) las
-- concilia, que es lo que el equipo tenía pendiente con ellas.
update public.canalizaciones c
   set kg_declarats       = coalesce((c.incidencia_recollida->>'kg_reals')::numeric, c.kg_reales),
       resultat_recollida = coalesce(c.incidencia_recollida->>'resultat', 'coincideix')
 where c.recollida_registrada_at is not null
   and c.kg_declarats is null;

update public.canalizaciones c
   set recollida_validada_at  = coalesce(c.conciliada_at, c.recollida_registrada_at),
       recollida_validada_per = c.conciliada_por
 where c.recollida_registrada_at is not null
   and c.recollida_validada_at is null
   and (c.estado = 'conciliada'
        or exists (select 1 from albaranes a
                    where a.canalizacion_id = c.id and a.tipo in ('ENT', 'OPE')
                      and a.estado = 'conciliado'));

-- ----------------------------------------------- 1. Las columnas de la recogida, protegidas
-- Con sesión de usuario, solo las cambian las RPC de la recogida. Sin sesión (`service_role`,
-- migraciones) no se comprueba nada, como en el resto del circuito.
create or replace function public.trg_canalizaciones_protegeix_recollida()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or coalesce(current_setting('redestina.escriu_recollida', true), '') = 'on'
     or coalesce(current_setting('redestina.validacio_recollida', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.kg_declarats is not null or new.resultat_recollida is not null
       or new.recollida_validada_at is not null or new.recollida_validada_per is not null
       or new.recollida_retornada_at is not null or new.motiu_retorn is not null
       or new.observacions_recollida is not null
       or coalesce(new.historial_recollida, '[]'::jsonb) <> '[]'::jsonb
       or new.recollida_registrada_at is not null or new.recollida_registrada_per is not null
       or new.incidencia_recollida is not null then
      raise exception 'La recollida nomes es registra, es valida o es retorna per les seves RPC'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.kg_declarats            is distinct from old.kg_declarats
     or new.resultat_recollida   is distinct from old.resultat_recollida
     or new.recollida_validada_at  is distinct from old.recollida_validada_at
     or new.recollida_validada_per is distinct from old.recollida_validada_per
     or new.recollida_retornada_at is distinct from old.recollida_retornada_at
     or new.motiu_retorn           is distinct from old.motiu_retorn
     or new.observacions_recollida is distinct from old.observacions_recollida
     or new.historial_recollida    is distinct from old.historial_recollida
     or new.recollida_registrada_at  is distinct from old.recollida_registrada_at
     or new.recollida_registrada_per is distinct from old.recollida_registrada_per
     or new.incidencia_recollida     is distinct from old.incidencia_recollida then
    raise exception 'La recollida nomes es registra, es valida o es retorna per les seves RPC'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_canalizaciones_protegeix_recollida() from public, anon, authenticated;

drop trigger if exists canalizaciones_protegeix_recollida on public.canalizaciones;
create trigger canalizaciones_protegeix_recollida
  before insert or update on public.canalizaciones
  for each row execute function public.trg_canalizaciones_protegeix_recollida();

-- -------------------------------------------------------------- 2. El aviso nuevo
alter table public.avisos drop constraint avisos_tipus_check;
alter table public.avisos add constraint avisos_tipus_check check (tipus in (
  'oferta_validada', 'oferta_rebutjada', 'sortida_trobada', 'interes_aprovat', 'interes_rebutjat',
  'oferta_sense_desti', 'recollida_canviada', 'kg_assignats_canviats', 'recollida_confirmada',
  'oferta_modificada', 'oferta_enviada', 'certificat_per_revisar', 'recollida_per_registrar',
  'recollida_retornada'));

-- ------------------------------ 3. Una incidencia ya validada por un admin ya está revisada
-- La validación es la revisión: lo que el admin ha validado no frena la conciliación
-- automática ni exige un segundo motivo al conciliar el REC.
create or replace function public.rec_te_incidencia_recollida(p_rec uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from albaranes s
      join canalizaciones c on c.id = s.canalizacion_id
     where s.id in (select public.albarans_germans_rec(p_rec))
       and c.incidencia_recollida is not null
       and c.recollida_validada_at is null);
$$;
revoke execute on function public.rec_te_incidencia_recollida(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ 4. El candado en emitir_albaran
-- Copia íntegra de la versión vigente (20270304100300) con UNA guarda nueva, después de
-- comprobar que existe y que es un borrador.
-- ⚠️ El mensaje EMPIEZA por `recollida_no_validada`: el frontend lo reconoce por ese prefijo.
create or replace function public.emitir_albaran(
  p_id       uuid,
  p_recogida jsonb default null,
  p_lineas   jsonb default null,
  p_idioma   text default null
) returns albaranes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a          albaranes%rowtype;
  v_serie    text;
  v_ejercici int;
  v_n        int;
  v_numero   text;
  v_fecha    timestamptz;
  l          jsonb;
  v_orden    int := 0;
  v_tara     numeric;
  v_neto     numeric;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot emetre albarans' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null then
    raise exception 'No existeix l''albara %', p_id using errcode = '22023';
  end if;
  if a.estado <> 'borrador' then
    raise exception 'Aquest albara ja esta emes (%)', a.numero_completo using errcode = '22023';
  end if;

  -- NUEVA (20270428100000). Un albarán del flujo de recogida solo se emite cuando un admin
  -- ha validado la recogida: dentro de `validar_recollida()`, `confirmar_recollida()` o
  -- `rectificar_albaran()`, que fijan el contexto. Flujo = ENT/OPE de una canalización cuya
  -- oferta no es de espigolada, o el REC de una oferta que no es de espigolada.
  if coalesce(current_setting('redestina.validacio_recollida', true), '') <> 'on' then
    if (a.tipo in ('ENT', 'OPE') and a.canalizacion_id is not null
        and exists (select 1 from canalizaciones c join excedentes e on e.id = c.excedente_id
                     where c.id = a.canalizacion_id
                       and e.espigolada_id is null and e.origen <> 'espigolament'))
       or (a.tipo = 'REC' and a.excedente_id is not null and a.espigolada_id is null
           and exists (select 1 from excedentes e
                        where e.id = a.excedente_id
                          and e.espigolada_id is null and e.origen <> 'espigolament')) then
      raise exception 'recollida_no_validada: els albarans d''una recollida nomes s''emeten quan un admin la valida'
        using errcode = '22023';
    end if;
  end if;

  -- Las líneas, si se sustituyen. Solo se puede en borrador, que es donde estamos.
  if p_lineas is not null then
    delete from albaran_lineas where albaran_id = a.id;
    for l in select * from jsonb_array_elements(p_lineas) loop
      v_orden := v_orden + 1;
      v_tara := coalesce(
        (l->>'tara_kg')::numeric,
        (l->>'num_cajas')::numeric * (select t.tara_kg from tipos_caja t
                                       where t.codigo = l->>'tipo_caja'),
        0);
      v_neto := coalesce((l->>'kg_neto')::numeric,
                         (l->>'kg_bruto')::numeric - v_tara);
      if v_neto is not null and v_neto < 0 then
        raise exception 'La tara (%) es mes gran que el pes brut a la linia %', v_tara, v_orden
          using errcode = '22023';
      end if;
      insert into albaran_lineas (albaran_id, orden, producto, variedad, familia, causa,
                                  num_cajas, tipo_caja, kg_bruto, tara_kg, kg_neto,
                                  kg_previstos, lote_origen)
      values (a.id, coalesce((l->>'orden')::int, v_orden),
              l->>'producto', l->>'variedad', l->>'familia', l->>'causa',
              (l->>'num_cajas')::int, l->>'tipo_caja',
              (l->>'kg_bruto')::numeric, v_tara, v_neto,
              (l->>'kg_previstos')::numeric, l->>'lote_origen');
    end loop;
  end if;

  -- El ejercicio es el del acto documentado (la recogida), no el de hoy: un albarán que
  -- se emite el 2 de enero por una recogida del 30 de diciembre pertenece al año viejo, y
  -- eso decide en qué cierre anual entra.
  v_fecha    := coalesce((p_recogida->>'fecha_hora')::timestamptz,
                         (a.recogida->>'fecha_hora')::timestamptz,
                         (select c.data_hora_recollida from canalizaciones c where c.id = a.canalizacion_id),
                         now());
  v_ejercici := extract(year from (v_fecha at time zone 'Europe/Madrid'))::int;

  v_serie  := case when a.rectifica_a is not null then 'R-' || a.tipo else a.tipo end;
  v_n      := public.siguiente_numero(v_serie, v_ejercici);
  v_numero := public.formato_numero(v_serie, v_ejercici, v_n);

  -- ⚠️ UN SOLO `update`, y las partes dentro. Congelarlas en un segundo `update` era lo
  --    natural de escribir y **lo prohíbe el trigger de inmutabilidad**: en cuanto el
  --    estado deja de ser `borrador`, `partes` es una columna congelada. Es exactamente lo
  --    que el trigger tiene que impedir, así que la que se mueve es esta función.
  --    `albaran_partes()` es `stable` y lee la fila anterior, que es lo correcto: no
  --    necesita el número, solo las fichas y los parámetros.
  update albaranes
     set estado          = 'emitido',
         serie           = v_serie,
         ejercicio       = v_ejercici,
         numero          = v_n,
         numero_completo = v_numero,
         idioma          = coalesce(p_idioma, a.idioma),
         recogida        = coalesce(p_recogida, a.recogida),
         partes          = public.albaran_partes(a.id),
         emitido_at      = now(),
         emitido_por     = auth.uid()
   where id = a.id
  returning * into a;

  -- La fecha del acto, en la canalización (§12.69). Solo si estaba vacía: lo que ya
  -- tiene fecha no se toca nunca, porque eso sí podría mover de ejercicio una donación.
  -- En un REC `canalizacion_id` es null y esto no afecta a ninguna fila.
  if a.canalizacion_id is not null then
    update canalizaciones
       set data_hora_recollida = v_fecha
     where id = a.canalizacion_id
       and data_hora_recollida is null;
  end if;

  -- Y el documento, que dispara el PDF (trigger de encolado, 20260928100700).
  perform public.albaran_emet_document(a.id, 'emes', null);

  return a;
end;
$$;

comment on function public.emitir_albaran(uuid, jsonb, jsonb, text) is
  'Emite un albarán: pide número, congela partes, escribe la fecha de recogida en la canalización si estaba vacía y dispara el PDF. Desde 20270428100000, un albarán del flujo de recogida solo dentro de la validación de un admin (recollida_no_validada).';
-- `create or replace` conserva los privilegios (authenticated + service_role).

-- -------------------------------------------- 5. rectificar_albaran(): fija el contexto
-- Copia íntegra de 20261012100500 con el contexto de validación alrededor de la emisión:
-- rectificar sustituye a un albarán YA emitido (con la recogida ya validada, o anterior a
-- esta regla), así que emitir el rectificativo no es saltarse la validación.
create or replace function public.rectificar_albaran(
  p_id     uuid,
  p_lineas jsonb,
  p_motivo text
) returns albaranes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a      albaranes%rowtype;
  nueva  albaranes%rowtype;
  v_ctx  text := current_setting('redestina.validacio_recollida', true);
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden rectificar un albara' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Cal indicar el motiu de la rectificacio' using errcode = '22023';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado in ('borrador', 'anulado', 'rectificado') then
    raise exception 'Aquest albara no es pot rectificar' using errcode = '22023';
  end if;

  insert into albaranes (tipo, excedente_id, espigolada_id, canalizacion_id,
                         retorn_envasos, observaciones, idioma, recogida, rectifica_a)
  values (a.tipo, a.excedente_id, a.espigolada_id, a.canalizacion_id,
          a.retorn_envasos, coalesce(p_motivo, a.observaciones), a.idioma, a.recogida, a.id)
  returning * into nueva;

  -- Se emite acto seguido: un rectificativo en borrador no tiene sentido (se rectifica
  -- porque ya se sabe lo que hay que corregir).
  perform set_config('redestina.validacio_recollida', 'on', true);
  nueva := public.emitir_albaran(nueva.id, a.recogida, p_lineas, a.idioma);
  perform set_config('redestina.validacio_recollida', coalesce(v_ctx, ''), true);

  update albaranes
     set estado = 'rectificado', rectificado_por = nueva.id
   where id = a.id;

  update documentos set vigente = false
   where objeto_tipo = 'albaran' and objeto_id = a.id and vigente;

  return nueva;
end;
$$;
-- `create or replace` conserva los privilegios de 20261012100500.

-- ------------------------------------------- 6. registrar_recollida(): solo la declaración
-- Misma firma, mismas validaciones de entrada y los mismos rechazos que 20270426100000. Lo
-- que cambia es lo que hace después: GUARDA la declaración y nada más. Los albaranes los
-- emite `validar_recollida()` cuando un admin la valida.
--
-- ⚠️ Revoca los enlaces de confirmación VIVOS de la parte que recibe (y, en un OPE, de la
--    que entrega) del albarán de salida: solo existen si un albarán se emitió con el flujo
--    anterior, y si no se revocaran alguien podría confirmar por correo una recogida que
--    está esperando la validación de un admin.
create or replace function public.registrar_recollida(
  p_canalizacion uuid,
  p_resultat     text,
  p_kg_reals     numeric default null,
  p_data         timestamptz default null,
  p_observacions text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_esc     text := current_setting('redestina.escriu_recollida', true);
  c         canalizaciones%rowtype;
  s         albaranes%rowtype;
  v_assig   numeric;
  v_kg      numeric;
  v_obs     text := nullif(btrim(coalesce(p_observacions, '')), '');
  v_data    timestamptz;
  v_inc     jsonb;
begin
  -- (0) Permiso ANTES que existencia.
  if v_user is null then
    raise exception 'Cal una sessio' using errcode = '42501';
  end if;
  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null or c.entidad_id is null
     or c.entidad_id not in (select public.mis_entidades()) then
    raise exception 'Nomes l''entitat receptora pot registrar aquesta recollida' using errcode = '42501';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  -- Registrada y no retornada, o ya validada: no se registra dos veces. Una que el admin ha
  -- retornado tiene `recollida_registrada_at` a null y se puede volver a registrar.
  if c.recollida_registrada_at is not null or c.recollida_validada_at is not null then
    raise exception 'ja_registrada' using errcode = '22023';
  end if;

  -- (1) Lo declarado. «Coincideix» son exactamente los kilos asignados.
  if p_resultat is null or p_resultat not in ('coincideix', 'menys', 'mes') then
    raise exception 'resultat_invalid' using errcode = '22023';
  end if;
  v_assig := c.kg_confirmados;
  if p_resultat = 'coincideix' then
    v_kg := coalesce(p_kg_reals, v_assig);
    if v_assig is null or v_kg is distinct from v_assig then
      raise exception 'kg_no_coincideixen' using errcode = '22023';
    end if;
  else
    v_kg := p_kg_reals;
    if v_kg is null or v_kg < 0 or v_kg > 1000000 then
      raise exception 'kg_invalids' using errcode = '22023';
    end if;
    if v_kg = 0 then
      raise exception 'kg_zero' using errcode = '22023';
    end if;
    if v_assig is not null and p_resultat = 'menys' and v_kg >= v_assig then
      raise exception 'kg_no_menys' using errcode = '22023';
    end if;
    if v_assig is not null and p_resultat = 'mes' and v_kg <= v_assig then
      raise exception 'kg_no_mes' using errcode = '22023';
    end if;
    if v_obs is null then
      raise exception 'falta_motiu_diferencia' using errcode = '22023';
    end if;
  end if;
  v_kg := round(v_kg, 2);
  if v_obs is not null and char_length(v_obs) > 1000 then
    raise exception 'motiu_llarg' using errcode = '22023';
  end if;

  v_data := coalesce(p_data, now());
  if v_data > now() + interval '5 minutes' then
    raise exception 'data_futura' using errcode = '22023';
  end if;
  if v_data < c.created_at - interval '1 day' then
    raise exception 'data_anterior' using errcode = '22023';
  end if;

  -- (2) Tiene que haber una salida, y que nadie la haya confirmado ya por otro camino.
  select * into s from albaranes
   where canalizacion_id = c.id and tipo in ('ENT', 'OPE')
     and estado not in ('anulado', 'rectificado')
   order by created_at desc limit 1
   for update;
  if s.id is null then
    raise exception 'sense_albara' using errcode = '22023';
  end if;
  if s.estado in ('confirmado', 'conciliado')
     or exists (select 1 from enlaces_token t
                 where t.objeto_tipo = 'albaran' and t.objeto_id = s.id
                   and t.proposito = 'confirmacion_albaran'
                   and t.usado_at is not null and t.rol_parte = 'recibe') then
    raise exception 'ja_registrada' using errcode = '22023';
  end if;

  v_inc := case when p_resultat <> 'coincideix' then jsonb_build_object(
    'descripcion', v_obs, 'tipus', 'diferencia_kg', 'resultat', p_resultat,
    'kg_assignats', v_assig, 'kg_reals', v_kg, 'origen', 'entitat_receptora',
    'registrada_at', now(), 'registrada_per', v_user) end;

  -- (3) Solo guardar.
  perform set_config('redestina.escriu_recollida', 'on', true);

  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'albaran' and objeto_id = s.id
     and proposito = 'confirmacion_albaran' and estado = 'activo'
     and (rol_parte = 'recibe' or rol_parte is null
          or (s.tipo = 'OPE' and rol_parte = 'entrega'));

  update canalizaciones
     set kg_declarats             = v_kg,
         resultat_recollida       = p_resultat,
         observacions_recollida   = v_obs,
         recollida_real_at        = v_data,
         recollida_registrada_at  = now(),
         recollida_registrada_per = v_user,
         incidencia_recollida     = v_inc,
         recollida_retornada_at   = null,
         motiu_retorn             = null
   where id = c.id;

  perform set_config('redestina.escriu_recollida', coalesce(v_esc, ''), true);

  return jsonb_build_object(
    'estat', 'pendent_validacio',
    'kg_declarats', v_kg,
    'kg_assignats', v_assig,
    'resultat', p_resultat);
end;
$$;
revoke execute on function public.registrar_recollida(uuid, text, numeric, timestamptz, text) from public, anon;
grant execute on function public.registrar_recollida(uuid, text, numeric, timestamptz, text) to authenticated;

-- ----------------------------------------------------- 7. validar_recollida() (admin)
-- La validación de un admin. Hace lo que antes hacía `registrar_recollida()` desde su paso
-- (3): emitir y entregar la salida con los kilos validados, confirmar la parte que recibe
-- (y en un OPE la que entrega) POR DECLARACIÓN DEL RECEPTOR —la evidencia dice además quién
-- validó, con qué kilos y por qué—, emitir y confirmar el REC cuando ya no falta ninguna
-- salida de la oferta por validar, y conciliar.
--
-- QUIÉN FIRMA CADA COSA. Emitir, entregar y conciliar van con la sesión del admin
-- (`emitido_por`, `conciliado_por`). Las confirmaciones son del receptor y pasan por
-- `confirmar_part_declarada()`, que solo admite al servidor: en ese tramo la función vacía
-- `request.jwt.claims` y los repone después, como hacía `registrar_recollida()`.
--
-- KILOS. Los finales son `coalesce(p_kg, kg_declarats)`. El motivo es obligatorio
-- (`cal_motiu_validacio`) si el admin corrige lo declarado, si hay una incidencia
-- (menys/més) o si lo declarado no son los kilos asignados.
--
-- Con varias entidades sobre la misma oferta, el REC lo cierra la última validación
-- (`esperant_altres = true` mientras tanto); la salida validada queda `confirmado` y se
-- concilia en cascada con el REC.
create or replace function public.validar_recollida(
  p_canalizacion uuid,
  p_kg           numeric default null,
  p_motiu        text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_claims   text;
  v_sub      text;
  v_ctx      text := current_setting('redestina.validacio_recollida', true);
  c          canalizaciones%rowtype;
  s          albaranes%rowtype;
  r          albaranes%rowtype;
  v_motiu    text := nullif(btrim(coalesce(p_motiu, '')), '');
  v_mconc    text;
  v_decl     numeric;
  v_assig    numeric;
  v_kg       numeric;
  v_corregit boolean;
  v_ja_conf  boolean := false;
  v_ent      text;
  v_nom_rec  text;
  v_nom_adm  text;
  v_prod     uuid;
  v_data     timestamptz;
  v_valid    jsonb;
  v_inc      jsonb;
  v_extra    jsonb;
  v_falten   boolean := false;
  v_kg_rec   numeric;
  v_kg_prev  numeric;
  v_quan_r   timestamptz;
  v_rep      jsonb;
  v_conc     boolean := false;
  v_ok       boolean;
begin
  -- (0) Solo un admin, con sesión: su identidad es parte de la evidencia. Permiso ANTES que
  --     existencia (un uuid inventado da 42501 a quien no es admin).
  if v_user is null or not public.pot_aprovar() then
    raise exception 'Nomes un admin pot validar una recollida' using errcode = '42501';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if c.recollida_validada_at is not null then
    raise exception 'ja_validada' using errcode = '22023';
  end if;
  if c.recollida_registrada_at is null then
    raise exception 'no_registrada' using errcode = '22023';
  end if;
  if p_kg is not null and (p_kg <= 0 or p_kg > 1000000) then
    raise exception 'kg_invalids' using errcode = '22023';
  end if;

  v_decl  := c.kg_declarats;
  v_assig := c.kg_confirmados;
  v_kg    := round(coalesce(p_kg, v_decl), 2);
  if v_kg is null or v_kg <= 0 then
    raise exception 'kg_invalids' using errcode = '22023';
  end if;
  v_corregit := p_kg is not null and round(p_kg, 2) is distinct from round(v_decl, 2);
  if v_motiu is null
     and (v_corregit or c.incidencia_recollida is not null
          or round(v_decl, 2) is distinct from round(v_assig, 2)) then
    raise exception 'cal_motiu_validacio' using errcode = '22023';
  end if;
  if v_motiu is not null and char_length(v_motiu) > 1000 then
    raise exception 'motiu_llarg' using errcode = '22023';
  end if;

  select * into s from albaranes
   where canalizacion_id = c.id and tipo in ('ENT', 'OPE')
     and estado not in ('anulado', 'rectificado')
   order by created_at desc limit 1
   for update;
  if s.id is null then
    raise exception 'sense_albara' using errcode = '22023';
  end if;
  -- Solo con las registradas con el flujo anterior (20270426100000) o confirmadas después por
  -- otro camino: el albarán ya está emitido y confirmado, así que no se le pueden cambiar los
  -- kilos aquí (para eso está rectificar). Validarla sin corregir la concilia.
  if s.estado in ('confirmado', 'conciliado') then
    if v_corregit then
      raise exception 'albara_ja_confirmat' using errcode = '22023';
    end if;
    v_ja_conf := true;
  end if;

  select e.nombre into v_ent from entidades e where e.id = c.entidad_id;
  select coalesce(nullif(btrim(p.nombre), ''), p.email) into v_nom_rec
    from perfiles p where p.id = c.recollida_registrada_per;
  select coalesce(nullif(btrim(p.nombre), ''), p.email) into v_nom_adm
    from perfiles p where p.id = v_user;
  select coalesce(ex.productor_id, esp.productor_id) into v_prod
    from excedentes ex left join espigoladas esp on esp.id = ex.espigolada_id
   where ex.id = c.excedente_id;
  v_data := coalesce(c.recollida_real_at, c.recollida_registrada_at, now());

  v_valid := jsonb_build_object(
    'validada_at', now(), 'validada_per', v_user, 'validada_per_nom', v_nom_adm,
    'kg_declarats', v_decl, 'kg_validats', v_kg, 'corregit', v_corregit, 'motiu', v_motiu);
  v_inc := case
    when c.incidencia_recollida is not null then
      (c.incidencia_recollida - 'registrada_at' - 'registrada_per')
        || jsonb_build_object('kg_validats', v_kg, 'validacio', v_valid)
    when v_corregit then jsonb_build_object(
      'descripcion', v_motiu, 'tipus', 'correccio_equip', 'origen', 'equip',
      'kg_assignats', v_assig, 'kg_declarats', v_decl, 'kg_validats', v_kg,
      'validacio', v_valid)
    when c.observacions_recollida is not null then jsonb_build_object(
      'descripcion', c.observacions_recollida, 'origen', 'entitat_receptora')
  end;
  v_extra := jsonb_build_object(
    'resultat', c.resultat_recollida, 'kg_assignats', v_assig,
    'kg_declarats', v_decl, 'kg_validats', v_kg, 'corregit', v_corregit,
    'motiu_validacio', v_motiu, 'validat_per', v_user, 'validat_per_nom', v_nom_adm,
    'validat_amb', 'validar_recollida');

  -- (1) El contexto que abre el candado de `emitir_albaran()`.
  perform set_config('redestina.validacio_recollida', 'on', true);

  -- (2) La salida: emitida con los kilos VALIDADOS y entregada (sesión del admin), y
  --     confirmada por declaración del receptor (servidor).
  if not v_ja_conf then
    if s.estado = 'borrador' then
      v_rep := public.repartir_kg_linies(s.id, v_kg);
      update albaran_lineas l
         set kg_bruto = (x->>'kg')::numeric,
             tara_kg  = 0,
             kg_neto  = (x->>'kg')::numeric
        from jsonb_array_elements(v_rep) x
       where l.albaran_id = s.id and l.id = (x->>'linea_id')::uuid;
      perform public.emitir_albaran(s.id, jsonb_build_object('fecha_hora', v_data), null, null);
      perform public.marcar_entregado(s.id);
    elsif s.estado = 'emitido' then
      perform public.marcar_entregado(s.id);
    end if;

    v_claims := current_setting('request.jwt.claims', true);
    v_sub    := current_setting('request.jwt.claim.sub', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);

    v_ok := public.confirmar_part_declarada(
      s.id, 'recibe', v_kg, c.recollida_registrada_per, v_nom_rec, v_ent, v_data, v_inc, v_extra);
    if s.tipo = 'OPE' and v_prod is not null then
      v_ok := public.confirmar_part_declarada(
        s.id, 'entrega', v_kg, c.recollida_registrada_per, v_nom_rec,
        'Recollida declarada per ' || coalesce(v_ent, 'l''entitat receptora') || ' i validada per l''equip',
        v_data, null, v_extra || jsonb_build_object('declaracio_receptor', true));
    end if;

    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  end if;

  update canalizaciones
     set kg_reales              = v_kg,
         recollida_validada_at  = now(),
         recollida_validada_per = v_user,
         incidencia_recollida   = case when c.incidencia_recollida is not null or v_corregit
                                       then v_inc end
   where id = c.id;
  select * into s from albaranes where id = s.id;

  -- (3) El REC de la oferta (donación), cuando ya no le falta ninguna salida por validar.
  select a.* into r from albaranes a
   where a.tipo = 'REC' and a.estado not in ('anulado', 'rectificado')
     and a.excedente_id = c.excedente_id and a.espigolada_id is null
   order by a.created_at desc limit 1
   for update;

  if r.id is not null then
    select exists (
      select 1 from canalizaciones c2
       where c2.excedente_id = c.excedente_id and c2.estado <> 'anulada'
         and not exists (
           select 1 from albaranes b
            where b.canalizacion_id = c2.id and b.tipo in ('ENT', 'OPE')
              and b.estado in ('confirmado', 'conciliado')))
      into v_falten;

    if not v_falten and r.estado in ('borrador', 'emitido', 'entregado') then
      select coalesce(sum(coalesce(c2.kg_reales, c2.kg_confirmados)), 0),
             coalesce(sum(c2.kg_confirmados), 0),
             min(coalesce(c2.recollida_real_at, c2.data_hora_recollida))
        into v_kg_rec, v_kg_prev, v_quan_r
        from canalizaciones c2
       where c2.excedente_id = c.excedente_id and c2.estado <> 'anulada';
      if r.estado = 'borrador' then
        update albaran_lineas
           set kg_previstos = case when v_kg_prev > 0 then v_kg_prev else kg_previstos end
         where albaran_id = r.id;
        v_rep := public.repartir_kg_linies(r.id, v_kg_rec);
        update albaran_lineas l
           set kg_bruto = (x->>'kg')::numeric,
               tara_kg  = 0,
               kg_neto  = (x->>'kg')::numeric
          from jsonb_array_elements(v_rep) x
         where l.albaran_id = r.id and l.id = (x->>'linea_id')::uuid;
        perform public.emitir_albaran(r.id, jsonb_build_object('fecha_hora', coalesce(v_quan_r, v_data)), null, null);
        perform public.marcar_entregado(r.id);
      elsif r.estado = 'emitido' then
        perform public.marcar_entregado(r.id);
      end if;

      v_claims := current_setting('request.jwt.claims', true);
      v_sub    := current_setting('request.jwt.claim.sub', true);
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      v_ok := public.confirmar_part_declarada(
        r.id, 'entrega', v_kg_rec, c.recollida_registrada_per, v_nom_rec,
        'Recollida declarada per ' || coalesce(v_ent, 'l''entitat receptora') || ' i validada per l''equip',
        v_data,
        case when v_inc ? 'tipus' then v_inc end,
        v_extra || jsonb_build_object('declaracio_receptor', true, 'canalitzacio_id', c.id));
      perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
      select * into r from albaranes where id = r.id;
    end if;
  end if;

  -- (4) Conciliar. La validación del admin ES la revisión: se concilia siempre que se pueda,
  --     con su motivo o «Validat per l'equip» (que es lo que satisface la guarda
  --     `cal_motiu_incidencia` de 20270427100000; con incidencia el motivo ya era obligatorio).
  v_mconc := coalesce(v_motiu, 'Validat per l''equip');
  if r.id is not null and r.estado = 'confirmado' then
    perform public.conciliar_albaran(r.id, null, v_mconc, null);
    v_conc := true;
  elsif r.id is not null and r.estado = 'conciliado' and s.estado = 'confirmado' then
    perform public.conciliar_albaran(s.id, null,
      v_mconc || ' (recepcio ' || coalesce(r.numero_completo, '?') || ' ja conciliada)', null);
    v_conc := true;
  elsif r.id is null and s.estado = 'confirmado' then
    perform public.conciliar_albaran(s.id, null, v_mconc, null);
    v_conc := true;
  end if;

  select * into s from albaranes where id = s.id;
  if r.id is not null then select * into r from albaranes where id = r.id; end if;

  perform set_config('redestina.validacio_recollida', coalesce(v_ctx, ''), true);

  return jsonb_build_object(
    'albara_id', s.id, 'albara', s.numero_completo, 'tipus', s.tipo, 'estat', s.estado,
    'rec', case when r.id is not null then jsonb_build_object('id', r.id, 'numero', r.numero_completo, 'estat', r.estado) end,
    'kg_reals', v_kg, 'kg_assignats', v_assig, 'kg_declarats', v_decl,
    'conciliat', v_conc,
    'esperant_altres', coalesce(v_falten, false));
end;
$$;
revoke execute on function public.validar_recollida(uuid, numeric, text) from public, anon, service_role;
grant execute on function public.validar_recollida(uuid, numeric, text) to authenticated;

-- ------------------------------------------------------ 8. retornar_recollida() (admin)
-- Devuelve la declaración al receptor para que la registre otra vez. No se emite nada (no
-- había nada emitido). Lo declarado se conserva en `historial_recollida` y en el aviso.
create or replace function public.retornar_recollida(
  p_canalizacion uuid,
  p_motiu        text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_esc   text := current_setting('redestina.escriu_recollida', true);
  c       canalizaciones%rowtype;
  v_motiu text := nullif(btrim(coalesce(p_motiu, '')), '');
  v_prod  text;
begin
  if v_user is null or not public.pot_aprovar() then
    raise exception 'Nomes un admin pot retornar una recollida' using errcode = '42501';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.recollida_validada_at is not null then
    raise exception 'ja_validada' using errcode = '22023';
  end if;
  if c.recollida_registrada_at is null then
    raise exception 'no_registrada' using errcode = '22023';
  end if;
  if v_motiu is null then
    raise exception 'cal_motiu' using errcode = '22023';
  end if;
  if char_length(v_motiu) > 1000 then
    raise exception 'motiu_llarg' using errcode = '22023';
  end if;
  -- Una registrada con el flujo anterior ya tiene la salida confirmada: el receptor no la
  -- podría volver a registrar. Esa se valida (o se rectifica).
  if exists (select 1 from albaranes a
              where a.canalizacion_id = c.id and a.tipo in ('ENT', 'OPE')
                and a.estado in ('confirmado', 'conciliado')) then
    raise exception 'albara_ja_confirmat' using errcode = '22023';
  end if;

  select e.producto into v_prod from excedentes e where e.id = c.excedente_id;

  perform set_config('redestina.escriu_recollida', 'on', true);
  update canalizaciones
     set historial_recollida = coalesce(historial_recollida, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object(
             'kg_declarats', c.kg_declarats, 'resultat', c.resultat_recollida,
             'observacions', c.observacions_recollida, 'incidencia', c.incidencia_recollida,
             'recollida_real_at', c.recollida_real_at,
             'registrada_at', c.recollida_registrada_at, 'registrada_per', c.recollida_registrada_per,
             'retornada_at', now(), 'retornada_per', v_user, 'motiu', v_motiu)),
         recollida_retornada_at   = now(),
         motiu_retorn             = v_motiu,
         recollida_registrada_at  = null,
         recollida_registrada_per = null,
         incidencia_recollida     = null,
         observacions_recollida   = null
   where id = c.id;
  perform set_config('redestina.escriu_recollida', coalesce(v_esc, ''), true);

  perform public.crear_avis('entidad', c.entidad_id, 'recollida_retornada', 'canalizacion', c.id,
    jsonb_build_object('producte', v_prod, 'motiu', v_motiu, 'kg_declarats', c.kg_declarats,
                       'excedente_id', c.excedente_id));
end;
$$;
revoke execute on function public.retornar_recollida(uuid, text) from public, anon, service_role;
grant execute on function public.retornar_recollida(uuid, text) to authenticated;

-- ------------------------------------------- 9. confirmar_recollida(): admin, y valida
-- Copia íntegra de 20270418100100 con tres cambios: la guarda pasa de `es_intern()` a
-- `pot_aprovar()`, fija el contexto de validación alrededor de las emisiones, y marca la
-- recogida como validada (`recollida_validada_at/per`) junto con `kg_reales`.
create or replace function public.confirmar_recollida(
  p_canalizacion uuid,
  p_kg_reals     numeric,
  p_data         timestamptz default null,
  p_observacions text default null,
  p_foto         uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c        canalizaciones%rowtype;
  s        albaranes%rowtype;
  r        albaranes%rowtype;
  v_prod   uuid;
  v_quan   timestamptz;
  v_kg_rec numeric;
  v_falten boolean;
  v_prop   jsonb;
  v_conc   boolean := false;
  v_fora   boolean := false;
  v_ok     boolean;
  v_ctx    text := current_setting('redestina.validacio_recollida', true);
begin
  -- (0) Solo un ADMIN, con sesión (20270428100000: antes, cualquiera del equipo). Confirmar
  --     la recogida es validarla, y validar es de `pot_aprovar()`. La identidad de quien
  --     conduce es parte de la evidencia (`asistido_por`). El permiso va ANTES que la
  --     existencia, para que cualquier otra cuenta reciba 42501 aunque el uuid no exista.
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes un admin pot confirmar una recollida' using errcode = '42501';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if p_kg_reals is null or p_kg_reals < 0 then
    raise exception 'kg_invalids' using errcode = '22023';
  end if;

  select * into s from albaranes
   where canalizacion_id = c.id and tipo in ('ENT', 'OPE')
     and estado not in ('anulado', 'rectificado')
   order by created_at desc limit 1
   for update;
  if s.id is null then
    raise exception 'sense_albara' using errcode = '22023';
  end if;
  if s.estado in ('confirmado', 'conciliado') then
    raise exception 'ja_confirmada' using errcode = '22023';
  end if;

  -- La foto, si la hay, ya está subida como documento externo de ESTE albarán.
  if p_foto is not null and not exists (
       select 1 from documentos_externos x
        where x.id = p_foto and x.objeto_tipo = 'albaran' and x.objeto_id = s.id) then
    raise exception 'foto_aliena' using errcode = '22023';
  end if;

  v_quan := coalesce(p_data, c.data_hora_recollida, now());
  if p_data is not null and p_data > now() + interval '5 minutes' then
    raise exception 'data_futura' using errcode = '22023';
  end if;

  -- El contexto que abre el candado de `emitir_albaran()`: esto es la validación de un admin.
  perform set_config('redestina.validacio_recollida', 'on', true);

  -- (1) La salida, emitida y entregada. Emitir consume numeración legal: la pantalla lo dice.
  if s.estado = 'borrador' then
    update albaran_lineas
       set kg_bruto = coalesce(kg_bruto, kg_previstos),
           tara_kg  = coalesce(tara_kg, 0),
           kg_neto  = coalesce(kg_neto, kg_previstos)
     where albaran_id = s.id;
    if p_data is not null then
      update canalizaciones set data_hora_recollida = p_data where id = c.id;
    end if;
    perform public.emitir_albaran(s.id, jsonb_build_object('fecha_hora', v_quan), null, null);
    perform public.marcar_entregado(s.id);
  elsif s.estado = 'emitido' then
    perform public.marcar_entregado(s.id);
  end if;

  -- (2) Cada parte que falte, con los kilos reales.
  select coalesce(ex.productor_id, esp.productor_id) into v_prod
    from excedentes ex left join espigoladas esp on esp.id = ex.espigolada_id
   where ex.id = c.excedente_id;
  if s.tipo = 'OPE' and v_prod is not null then
    v_ok := public.confirmar_part_assistida(s.id, 'entrega', p_kg_reals, p_observacions, p_foto, v_quan);
  end if;
  v_ok := public.confirmar_part_assistida(s.id, 'recibe', p_kg_reals, p_observacions, p_foto, v_quan);

  update canalizaciones
     set kg_reales              = p_kg_reals,
         recollida_validada_at  = now(),
         recollida_validada_per = auth.uid()
   where id = c.id;
  select * into s from albaranes where id = s.id;

  -- (3) El REC del registro (o de la espigolada), cuando ya no le falta ninguna salida.
  select a.* into r from albaranes a
   where a.tipo = 'REC' and a.estado not in ('anulado', 'rectificado')
     and (a.excedente_id = c.excedente_id
          or (a.espigolada_id is not null and a.espigolada_id =
                (select ex.espigolada_id from excedentes ex where ex.id = c.excedente_id)))
   order by a.created_at desc limit 1;

  if r.id is not null then
    select exists (
      select 1 from canalizaciones c2
       where c2.excedente_id in (
               select ex.id from excedentes ex
                where ex.id = c.excedente_id
                   or (r.espigolada_id is not null and ex.espigolada_id = r.espigolada_id))
         and c2.estado <> 'anulada'
         and not exists (
           select 1 from albaranes b
            where b.canalizacion_id = c2.id and b.tipo in ('ENT', 'OPE')
              and b.estado in ('confirmado', 'conciliado')))
      into v_falten;

    if not v_falten and r.estado in ('borrador', 'emitido', 'entregado') then
      select coalesce(sum(coalesce(c2.kg_reales, c2.kg_confirmados)), 0) into v_kg_rec
        from canalizaciones c2
       where c2.estado <> 'anulada'
         and c2.excedente_id in (
               select ex.id from excedentes ex
                where ex.id = c.excedente_id
                   or (r.espigolada_id is not null and ex.espigolada_id = r.espigolada_id));
      if r.estado = 'borrador' then
        update albaran_lineas
           set kg_previstos = case when v_kg_rec > 0 then v_kg_rec else kg_previstos end
         where albaran_id = r.id;
        update albaran_lineas
           set kg_bruto = coalesce(kg_bruto, kg_previstos),
               tara_kg  = coalesce(tara_kg, 0),
               kg_neto  = coalesce(kg_neto, kg_previstos)
         where albaran_id = r.id;
        perform public.emitir_albaran(r.id, jsonb_build_object('fecha_hora', v_quan), null, null);
        perform public.marcar_entregado(r.id);
      elsif r.estado = 'emitido' then
        perform public.marcar_entregado(r.id);
      end if;
      v_ok := public.confirmar_part_assistida(r.id, 'entrega', v_kg_rec, null, null, v_quan);
      select * into r from albaranes where id = r.id;
    end if;
  end if;

  -- (4) Conciliar si cuadra. Fuera de tolerancia se queda en la cola del equipo
  --     (`albarans_conciliar`), que es donde se decide con motivo.
  if r.id is not null and r.estado = 'confirmado' then
    v_prop := public.propuesta_conciliacion(r.id);
    if coalesce((v_prop->>'dins_tolerancia')::boolean, false) then
      perform public.conciliar_albaran(r.id, null, 'Recollida confirmada per l''equip (dins de tolerancia)', null);
      v_conc := true;
    else
      v_fora := true;
    end if;
  elsif r.id is not null and r.estado = 'conciliado' and s.estado = 'confirmado' then
    perform public.conciliar_albaran(s.id, null,
      'Recollida confirmada per l''equip (recepcio ' || coalesce(r.numero_completo, '?') || ' ja conciliada)', null);
    v_conc := true;
  elsif r.id is null and s.estado = 'confirmado' then
    perform public.conciliar_albaran(s.id, null, 'Recollida confirmada per l''equip', null);
    v_conc := true;
  end if;

  select * into s from albaranes where id = s.id;
  if r.id is not null then select * into r from albaranes where id = r.id; end if;

  perform set_config('redestina.validacio_recollida', coalesce(v_ctx, ''), true);

  return jsonb_build_object(
    'albara_id', s.id, 'albara', s.numero_completo, 'estat', s.estado,
    'rec', case when r.id is not null then jsonb_build_object('numero', r.numero_completo, 'estat', r.estado) end,
    'conciliat', v_conc,
    'fora_tolerancia', v_fora,
    'diferencia_pct', v_prop->'diferencia_pct',
    'kg_recepcio', v_prop->'kg_recepcio',
    'kg_entregues', v_prop->'kg_entregues');
end;
$$;
revoke execute on function public.confirmar_recollida(uuid, numeric, timestamptz, text, uuid) from public, anon;
grant execute on function public.confirmar_recollida(uuid, numeric, timestamptz, text, uuid) to authenticated;

-- ------------------------------------ 10. La conciliación automática y las validaciones
-- Copia íntegra de 20270426100000. La rama 1 ya ignora las incidencias validadas (a través
-- de `rec_te_incidencia_recollida()`); las ramas 2 y 3 miran la canalización directamente y
-- se les añade lo mismo. Normalmente no les queda nada: `validar_recollida()` concilia en el
-- acto. Es la red para una salida validada que se quedó esperando a su REC.
create or replace function public.conciliacions_automatiques()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  rec  record;
  b    record;
  prop jsonb;
  n    integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor concilia automaticament' using errcode = '42501';
  end if;

  -- 1. REC confirmado con todas sus salidas confirmadas (o ya cerradas), dentro de
  --    tolerancia y SIN incidencia de recogida (17-10-2026). `conciliar_albaran()` concilia
  --    el REC y arrastra las salidas.
  for rec in
    select a.id
      from albaranes a
     where a.tipo = 'REC' and a.estado = 'confirmado'
       and not exists (
         select 1 from albaranes s
          where s.id in (select public.albarans_germans_rec(a.id))
            and s.estado not in ('confirmado', 'anulado', 'rectificado', 'conciliado'))
       and exists (
         select 1 from albaranes s
          where s.id in (select public.albarans_germans_rec(a.id))
            and s.estado = 'confirmado')
       and not public.rec_te_incidencia_recollida(a.id)
  loop
    begin
      prop := public.propuesta_conciliacion(rec.id);
      if coalesce((prop->>'dins_tolerancia')::boolean, false) then
        perform public.conciliar_albaran(rec.id, null, 'conciliacio automatica (dins de tolerancia)', null);
        n := n + 1;
      end if;
    exception when others then
      raise warning 'conciliacions_automatiques: REC %: %', rec.id, sqlerrm;
    end;
  end loop;

  -- 2. Salidas confirmadas cuyo REC ya está conciliado, salvo las que tienen una incidencia
  --    que ningún admin ha validado (20270428100000: la validada ya está revisada).
  for b in
    select s.id, a.numero_completo as rec_num
      from albaranes a
      join albaranes s on s.id in (select public.albarans_germans_rec(a.id))
      left join canalizaciones c on c.id = s.canalizacion_id
     where a.tipo = 'REC' and a.estado = 'conciliado'
       and s.estado = 'confirmado'
       and (c.incidencia_recollida is null or c.recollida_validada_at is not null)
  loop
    begin
      perform public.conciliar_albaran(
        b.id, null,
        'conciliacio automatica (recepcio ' || coalesce(b.rec_num, '?') || ' ja conciliada)', null);
      n := n + 1;
    exception when others then
      raise warning 'conciliacions_automatiques: sortida %: %', b.id, sqlerrm;
    end;
  end loop;

  -- 3. OPE confirmado sin REC vivo en su excedente (venta o maquila puras), sin incidencia
  --    por validar.
  for b in
    select a.id from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
     where a.tipo = 'OPE' and a.estado = 'confirmado'
       and (c.incidencia_recollida is null or c.recollida_validada_at is not null)
       and not exists (
         select 1 from albaranes r
          where r.tipo = 'REC' and r.excedente_id = a.excedente_id
            and r.estado not in ('anulado', 'rectificado'))
  loop
    begin
      perform public.conciliar_albaran(b.id, null, 'conciliacio automatica (confirmat per totes les parts)', null);
      n := n + 1;
    exception when others then
      raise warning 'conciliacions_automatiques: OPE %: %', b.id, sqlerrm;
    end;
  end loop;

  return n;
end;
$function$;
revoke execute on function public.conciliacions_automatiques() from public, anon, authenticated;
grant  execute on function public.conciliacions_automatiques() to service_role;


-- ----------------------------------- 11. La ficha de la operación: registrada y validada
-- Copia íntegra de 20270426100000 con cinco columnas nuevas AL FINAL, el estado
-- `registrada` (antes que todos los del albarán) y `pot_registrar` que además exige que no
-- esté validada. Cambia el `returns table`: drop + create, con su revoke/grant.
drop function if exists public.operacio_detall(uuid);

create function public.operacio_detall(p_canalizacion uuid)
returns table (
  canalizacion_id     uuid,
  excedente_id        uuid,
  resposta_id         uuid,
  rol                 text,
  producte            text,
  varietat            text,
  modalitat           text,
  kg_sollicitats      numeric,
  kg_assignats        numeric,
  kg_rebuts           numeric,
  data_hora_recollida timestamptz,
  estat_recollida     text,
  productor_nom       text,
  productor_contacte  text,
  productor_telefon   text,
  entitat_nom         text,
  entitat_contacte    text,
  entitat_telefon     text,
  lloc_alias          text,
  lloc_adreca         text,
  lloc_municipi       text,
  lloc_maps           text,
  lloc_contacte       text,
  lloc_telefon        text,
  lloc_horari         text,
  lloc_observacions   text,
  condicions          text,
  albara_numero       text,
  albara_estat        text,
  -- 17-10-2026: la recogida la registra el receptor.
  pot_registrar          boolean,
  recollida_real_at      timestamptz,
  recollida_registrada_at timestamptz,
  incidencia_recollida   jsonb,
  rec_numero             text,
  rec_estat              text,
  -- 20270428100000: la recogida la valida un admin.
  kg_declarats           numeric,
  resultat_recollida     text,
  recollida_validada_at  timestamptz,
  recollida_retornada_at timestamptz,
  motiu_retorn           text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as (
    select c.*, e.productor_id, e.producto, e.variedad, e.observacions, e.ubicacion_id,
           e.horari_recollida, e.espigolada_id,
           case
             when auth.uid() is null or public.es_intern() then 'equip'
             when e.productor_id in (select public.mis_productores()) then 'productor'
             when c.entidad_id in (select public.mis_entidades()) then 'entidad'
           end as qui
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
     where c.id = p_canalizacion
  ),
  alb as (
    select a.id, a.numero_completo, a.estado
      from albaranes a, c
     where a.canalizacion_id = c.id and a.tipo in ('ENT', 'OPE')
       and a.estado not in ('anulado', 'rectificado')
     order by a.created_at desc
     limit 1
  ),
  rec as (
    select a.numero_completo, a.estado
      from albaranes a, c
     where a.tipo = 'REC' and a.excedente_id = c.excedente_id and a.espigolada_id is null
       and a.estado not in ('anulado', 'rectificado')
     order by a.created_at desc
     limit 1
  )
  select c.id, c.excedente_id, r.id, c.qui,
         c.producto, c.variedad, c.valorizacion,
         r.kg_solicitados,
         c.kg_confirmados,
         coalesce(c.kg_conciliados, c.kg_reales),
         c.data_hora_recollida,
         case
           -- Registrada por el receptor y esperando a que un admin la valide.
           when c.recollida_registrada_at is not null and c.recollida_validada_at is null then 'registrada'
           when c.estado = 'conciliada' or alb.estado = 'conciliado' then 'conciliada'
           when alb.estado = 'confirmado' then 'confirmada'
           when alb.estado = 'entregado' then 'entregada'
           when alb.estado = 'emitido' or c.data_hora_recollida is not null then 'programada'
           else 'pendent'
         end,
         coalesce(nullif(p.empresa, ''), p.name), p.name, p.phone,
         en.nombre, en.contacto, en.telefono,
         u.alias, u.direccion, coalesce(u.municipio, p.poblacion), u.gmaps_url,
         coalesce(u.contacto_nombre, p.name), coalesce(u.contacto_telefono, p.phone),
         coalesce(u.horario, c.horari_recollida), u.observaciones,
         c.observacions,
         alb.numero_completo, alb.estado,
         -- La misma condición que exige `registrar_recollida()`.
         (c.qui = 'entidad' and c.estado <> 'anulada' and c.recollida_registrada_at is null
          and c.recollida_validada_at is null
          and c.espigolada_id is null
          and alb.estado in ('borrador', 'emitido', 'entregado')
          and not exists (select 1 from enlaces_token t
                           where t.objeto_tipo = 'albaran' and t.objeto_id = alb.id
                             and t.proposito = 'confirmacion_albaran'
                             and t.usado_at is not null and t.rol_parte = 'recibe')),
         c.recollida_real_at, c.recollida_registrada_at, c.incidencia_recollida,
         rec.numero_completo, rec.estado,
         c.kg_declarats, c.resultat_recollida, c.recollida_validada_at,
         c.recollida_retornada_at, c.motiu_retorn
    from c
    left join alb on true
    left join rec on true
    left join productores p on p.id = c.productor_id
    left join entidades en on en.id = c.entidad_id
    left join productor_ubicaciones u on u.id = c.ubicacion_id
    left join oferta_respuestas r on r.canalizacion_id = c.id
   where c.qui is not null
     and (c.qui <> 'entidad' or c.estado <> 'anulada');
$$;

revoke execute on function public.operacio_detall(uuid) from public, anon;
grant execute on function public.operacio_detall(uuid) to authenticated, service_role;


-- ------------------------------------------------- 12. pendents_equip(): 16 colas
-- Copia íntegra de 20270427100000 con la cola nueva `recollides_per_validar` (orden 3.5) y
-- tres retoques: `canal_equip` no cuenta lo validado ni lo recién retornado, y
-- `albarans_conciliar` no cuenta dos veces lo que espera la validación de un admin.
-- ⚠️ `albarans_esborrany` sigue sin contar lo registrado: `canal_equip` exige
--    `recollida_registrada_at is null`, y una registrada pendiente de validar tiene sus
--    albaranes en borrador esperando al admin, que ya los ve en `recollides_per_validar`.
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
  'Cola de trabajo consolidada del equipo: una fila por cola (dieciseis), siempre, aunque n = 0. security invoker: agrega solo lo que quien pregunta ya puede leer. recollides_per_validar, nueva en 20270428100000 (la recogida la valida un admin).';
revoke execute on function public.pendents_equip() from public, anon;
grant  execute on function public.pendents_equip() to authenticated, service_role;
