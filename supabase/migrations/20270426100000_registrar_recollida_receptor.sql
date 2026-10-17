-- La recogida la cierra el RECEPTOR (17-10-2026).
--
-- QUÉ PIDE CARLES (para cerrar el flujo de principio a fin):
--   1. El ofertante publica y el equipo valida.  2. El receptor muestra interés y el equipo lo
--   aprueba.  3. El receptor va a recoger.  4. Después, el receptor registra los kilos REALES
--   («coincideixen», «menys» o «més»).  5. Con esa cantidad se generan los dos albaranes:
--   REC (ofertante → Espigoladors) y ENT (Espigoladors → receptor), por los mismos kilos.
--   «No haría obligatoria una segunda confirmación del ofertante. Si hay discrepancias, se
--   registran como incidencia y se revisan con el admin.» Y, preguntado por el job de la hora
--   de recogida: «Los albaranes se deberían generar en el momento del punto 4, no antes.»
--
-- QUÉ CAMBIA:
--   1. `registrar_recollida()`: la acción del receptor, en UNA transacción. Emite la salida
--      (ENT/OPE) con los kilos reales, confirma la parte del receptor, y cuando ya no le falta
--      ninguna salida emite y confirma el REC con la suma de lo real POR DECLARACIÓN DEL
--      RECEPTOR —sin pedir nada al ofertante—. Si coincide, concilia en cascada (los PDF
--      definitivos salen con los kilos reales); si hay diferencia, la deja como incidencia
--      para el equipo, en la cola de «albarans per conciliar».
--   2. `programar_albarans_recollida()` deja de EMITIR a la hora de recogida (D3, 05-10-2026,
--      queda sustituida): ahora le pide al receptor que la registre (aviso nuevo
--      `recollida_per_registrar`, una vez por canalización). Así ningún número legal se gasta
--      con kilos previstos y al ofertante no le llega un enlace que pide confirmar.
--   3. `conciliacions_automatiques()` no concilia lo que tiene una incidencia de recogida: la
--      revisa el equipo y la concilia a mano (con motivo).
--   4. `operacio_detall()` dice si el receptor puede registrar y si hay incidencia.
--
-- CÓMO AUTORIZA. El permiso lo da la sesión: solo una cuenta con membresía activa en la
-- entidad receptora de ESA canalización (permiso antes que existencia: un id ajeno o
-- inventado da 42501). Comprobado eso, la función actúa COMO EL SERVIDOR —como lo haría una
-- Edge Function con service_role tras validar el JWT—, porque las piezas que reutiliza
-- (`emitir_albaran`, `marcar_entregado`, `registrar_confirmacion`, `conciliar_albaran`) solo
-- admiten al equipo o al servidor. La identidad de quien registra no se pierde: queda en la
-- canalización (`recollida_registrada_per`) y en las dos evidencias (nombre, cargo y
-- `payload.usuari_id`). El cambio de identidad es local a esta transacción y se deshace al
-- salir.
--
-- ⚠️ Emitir consume numeración legal (REC/ENT/OPE). Por eso se emite aquí, con los kilos
--    buenos, y no antes.

-- --------------------------------------------------------------------- 0. Columnas nuevas
alter table public.canalizaciones
  add column if not exists recollida_real_at        timestamptz,
  add column if not exists recollida_registrada_at  timestamptz,
  add column if not exists recollida_registrada_per uuid references auth.users(id) on delete set null,
  add column if not exists incidencia_recollida     jsonb,
  add column if not exists registre_demanat_at      timestamptz;

comment on column public.canalizaciones.recollida_real_at is
  'Cuándo se recogió de verdad, según quien registró la recogida (17-10-2026). La acordada sigue en data_hora_recollida.';
comment on column public.canalizaciones.recollida_registrada_at is
  'Cuándo la entidad receptora registró los kilos reales desde su panel (registrar_recollida, 17-10-2026).';
comment on column public.canalizaciones.incidencia_recollida is
  'Diferencia declarada por el receptor (menys/més) con su motivo. Mientras exista, la conciliación automática no la cierra: la revisa el equipo.';
comment on column public.canalizaciones.registre_demanat_at is
  'Cuándo se le pidió al receptor que registrara la recogida (aviso recollida_per_registrar). Una sola vez.';

-- Las recogidas que ya pasaron hace días no se reclaman al publicar esto: llegarían de golpe
-- avisos de operaciones viejas. Las que pasen a partir de ahora, sí.
update public.canalizaciones
   set registre_demanat_at = now()
 where registre_demanat_at is null
   and data_hora_recollida is not null
   and data_hora_recollida < now() - interval '2 days';

-- -------------------------------------------------------------- 1. El aviso nuevo
alter table public.avisos drop constraint avisos_tipus_check;
alter table public.avisos add constraint avisos_tipus_check check (tipus in (
  'oferta_validada', 'oferta_rebutjada', 'sortida_trobada', 'interes_aprovat', 'interes_rebutjat',
  'oferta_sense_desti', 'recollida_canviada', 'kg_assignats_canviats', 'recollida_confirmada',
  'oferta_modificada', 'oferta_enviada', 'certificat_per_revisar', 'recollida_per_registrar'));

-- ------------------------------------------- 2. ¿Este REC tiene una incidencia de recogida?
-- Mira las canalizaciones de TODAS las salidas del REC (los «hermanos»): si una entidad
-- declaró una diferencia, conciliar el REC arrastraría también su salida, y esa la decide el
-- equipo. Interna.
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
       and c.incidencia_recollida is not null);
$$;
revoke execute on function public.rec_te_incidencia_recollida(uuid) from public, anon, authenticated;

-- ------------------------------------- 3. Confirmar una parte por declaración del receptor
-- Como `confirmar_part_assistida()`, pero la evidencia es de la cuenta de la entidad (canal
-- `panel`, `creado_por` = esa cuenta, sin `asistido_por`). Para la parte `recibe` es su propia
-- confirmación; para la parte `entrega` (el ofertante, en REC y OPE) es la recogida declarada
-- por el receptor, y el cargo lo dice así en el PDF. Interna: solo la llama
-- `registrar_recollida()`, ya en modo servidor.
create or replace function public.confirmar_part_declarada(
  p_albaran uuid, p_rol text, p_kg numeric, p_user uuid, p_nom text, p_carrec text,
  p_data timestamptz, p_incidencia jsonb, p_extra jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok record;
  v_id  uuid;
begin
  if auth.uid() is not null then
    raise exception 'Funcio interna' using errcode = '42501';
  end if;
  if exists (select 1 from enlaces_token t
              where t.objeto_tipo = 'albaran' and t.objeto_id = p_albaran
                and t.proposito = 'confirmacion_albaran'
                and t.usado_at is not null and t.rol_parte = p_rol) then
    return false;   -- esa parte ya confirmó
  end if;

  -- Los enlaces vivos de esa parte se revocan (correo o WhatsApp que ya no hacen falta).
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'albaran' and objeto_id = p_albaran
     and proposito = 'confirmacion_albaran' and estado = 'activo'
     and (rol_parte = p_rol or rol_parte is null);

  select * into v_tok from public.generar_token_enlace();
  insert into enlaces_token (proposito, objeto_tipo, objeto_id, canal, rol_parte,
                             token_hash, caduca_at, creado_por)
  values ('confirmacion_albaran', 'albaran', p_albaran, 'panel', p_rol,
          v_tok.token_hash, now() + interval '1 hour', p_user)
  returning id into v_id;

  perform public.registrar_confirmacion(
    v_id,
    jsonb_build_object(
      'kg_confirmados', public.repartir_kg_linies(p_albaran, p_kg),
      'rechazo', 'cap',
      'incidencias', case when p_incidencia is not null then jsonb_build_array(p_incidencia) end),
    jsonb_build_object(
      'nombre', p_nom,
      'cargo', p_carrec,
      'payload', jsonb_build_object(
                   'via', 'registrar_recollida',
                   'usuari_id', p_user,
                   'data_recollida', p_data) || coalesce(p_extra, '{}'::jsonb)));
  return true;
end;
$$;
revoke execute on function public.confirmar_part_declarada(uuid, text, numeric, uuid, text, text, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;

-- ------------------------------------------------------ 4. registrar_recollida() (receptor)
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
  v_claims  text;
  v_sub     text;
  c         canalizaciones%rowtype;
  s         albaranes%rowtype;
  r         albaranes%rowtype;
  v_ent     text;
  v_nom     text;
  v_prod    uuid;
  v_assig   numeric;
  v_kg      numeric;
  v_obs     text := nullif(btrim(coalesce(p_observacions, '')), '');
  v_data    timestamptz;
  v_inc     jsonb;
  v_falten  boolean;
  v_kg_rec  numeric;
  v_kg_prev numeric;
  v_quan_r  timestamptz;
  v_prop    jsonb;
  v_conc    boolean := false;
  v_revisio boolean := false;
  v_ok      boolean;
  v_rep     jsonb;
begin
  -- (0) Permiso ANTES que existencia: una cuenta que no es de la entidad receptora de esta
  --     canalización recibe 42501 aunque el uuid no exista.
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
  if c.recollida_registrada_at is not null then
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
      -- No se recogió nada: no es un albarán, es una incidencia. No se gasta numeración.
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

  -- (2) La salida. Si el receptor ya confirmó por otro camino (enlace del correo, WhatsApp,
  --     el equipo), no se registra dos veces.
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

  select e.nombre into v_ent from entidades e where e.id = c.entidad_id;
  select coalesce(nullif(btrim(p.nombre), ''), p.email) into v_nom from perfiles p where p.id = v_user;
  select coalesce(ex.productor_id, esp.productor_id) into v_prod
    from excedentes ex left join espigoladas esp on esp.id = ex.espigolada_id
   where ex.id = c.excedente_id;

  v_inc := case
    when p_resultat <> 'coincideix' then jsonb_build_object(
      'descripcion', v_obs, 'tipus', 'diferencia_kg', 'resultat', p_resultat,
      'kg_assignats', v_assig, 'kg_reals', v_kg, 'origen', 'entitat_receptora')
    when v_obs is not null then jsonb_build_object('descripcion', v_obs, 'origen', 'entitat_receptora')
  end;

  -- (3) Desde aquí, como el servidor. Se guarda la identidad para devolverla al salir.
  v_claims := current_setting('request.jwt.claims', true);
  v_sub    := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- (4) La salida, emitida con los kilos REALES. Los previstos se quedan como estaban:
  --     son la referencia de la diferencia.
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

  -- (5) La parte del receptor (y, en un OPE, la del ofertante, declarada).
  v_ok := public.confirmar_part_declarada(
    s.id, 'recibe', v_kg, v_user, v_nom, v_ent, v_data, v_inc,
    jsonb_build_object('resultat', p_resultat, 'kg_assignats', v_assig));
  if s.tipo = 'OPE' and v_prod is not null then
    v_ok := public.confirmar_part_declarada(
      s.id, 'entrega', v_kg, v_user, v_nom,
      'Recollida declarada per ' || coalesce(v_ent, 'l''entitat receptora'), v_data, null,
      jsonb_build_object('resultat', p_resultat, 'declaracio_receptor', true));
  end if;

  update canalizaciones
     set kg_reales                = v_kg,
         recollida_real_at        = v_data,
         recollida_registrada_at  = now(),
         recollida_registrada_per = v_user,
         incidencia_recollida     = case when p_resultat <> 'coincideix' then v_inc || jsonb_build_object(
                                      'registrada_at', now(), 'registrada_per', v_user) end
   where id = c.id;
  select * into s from albaranes where id = s.id;

  -- (6) El REC de la oferta (donación), cuando ya no le falta ninguna salida: con la suma de
  --     lo real y declarado por el receptor. Con varias entidades sobre la misma oferta, el
  --     REC lo cierra la última que registra.
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
        -- Previstos: lo asignado (lo que habría puesto el job). Neto: lo real.
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
      v_ok := public.confirmar_part_declarada(
        r.id, 'entrega', v_kg_rec, v_user, v_nom,
        'Recollida declarada per ' || coalesce(v_ent, 'l''entitat receptora'), v_data,
        case when v_inc ? 'tipus' then v_inc end,
        jsonb_build_object('declaracio_receptor', true, 'canalitzacio_id', c.id));
      select * into r from albaranes where id = r.id;
    end if;
  end if;

  -- (7) Conciliar si cuadra y nadie ha declarado diferencias. Con incidencia, se queda en la
  --     cola del equipo (`albarans_conciliar`): la revisa y la concilia con motivo.
  if r.id is not null and r.estado = 'confirmado' then
    if public.rec_te_incidencia_recollida(r.id) then
      v_revisio := true;
    else
      v_prop := public.propuesta_conciliacion(r.id);
      if coalesce((v_prop->>'dins_tolerancia')::boolean, false) then
        perform public.conciliar_albaran(r.id, null, 'Recollida registrada per l''entitat receptora', null);
        v_conc := true;
      else
        v_revisio := true;
      end if;
    end if;
  elsif r.id is not null and r.estado = 'conciliado' and s.estado = 'confirmado' then
    if p_resultat = 'coincideix' then
      perform public.conciliar_albaran(s.id, null,
        'Recollida registrada per l''entitat receptora (recepcio ' || coalesce(r.numero_completo, '?') || ' ja conciliada)', null);
      v_conc := true;
    else
      v_revisio := true;
    end if;
  elsif r.id is null and s.estado = 'confirmado' then
    if p_resultat = 'coincideix' then
      perform public.conciliar_albaran(s.id, null, 'Recollida registrada per l''entitat receptora', null);
      v_conc := true;
    else
      v_revisio := true;
    end if;
  end if;

  select * into s from albaranes where id = s.id;
  if r.id is not null then select * into r from albaranes where id = r.id; end if;

  -- (8) La identidad de la sesión, de vuelta.
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  return jsonb_build_object(
    'albara_id', s.id, 'albara', s.numero_completo, 'tipus', s.tipo, 'estat', s.estado,
    'rec', case when r.id is not null then jsonb_build_object('id', r.id, 'numero', r.numero_completo, 'estat', r.estado) end,
    'kg_reals', v_kg, 'kg_assignats', v_assig,
    'conciliat', v_conc,
    'en_revisio', v_revisio,
    'esperant_altres', coalesce(v_falten, false));
end;
$$;
revoke execute on function public.registrar_recollida(uuid, text, numeric, timestamptz, text) from public, anon;
grant execute on function public.registrar_recollida(uuid, text, numeric, timestamptz, text) to authenticated;

-- --------------------------------- 5. A la hora de recogida ya no se emite: se pide el registro
-- Sustituye a la versión de 20270412100000 (D3). Los albaranes de la recogida se quedan en
-- borrador hasta que alguien registra los kilos reales: el receptor (`registrar_recollida`) o
-- el equipo (`confirmar_recollida`). Aquí solo se avisa a la entidad, una vez.
-- Devuelve la lista vacía de enlaces que espera `recollides-programades`: no hay nada que
-- mandar por correo, y la función sigue funcionando sin redesplegarla.
create or replace function public.programar_albarans_recollida()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c       record;
  v_resp  uuid;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor programa recollides' using errcode = '42501';
  end if;

  for c in
    select cz.id, cz.entidad_id, cz.kg_confirmados, cz.data_hora_recollida,
           ex.id as excedente_id, ex.producto,
           coalesce(nullif(p.empresa, ''), p.name) as productor
      from canalizaciones cz
      join excedentes ex on ex.id = cz.excedente_id
      left join productores p on p.id = ex.productor_id
     where cz.estado <> 'anulada'
       and cz.entidad_id is not null
       and cz.data_hora_recollida is not null
       and cz.data_hora_recollida <= now()
       and cz.registre_demanat_at is null
       and cz.recollida_registrada_at is null
       and ex.espigolada_id is null
       and exists (select 1 from albaranes b
                    where b.canalizacion_id = cz.id and b.tipo in ('ENT', 'OPE')
                      and b.estado = 'borrador')
     order by cz.data_hora_recollida
     limit 100
  loop
    begin
      select r.id into v_resp from oferta_respuestas r where r.canalizacion_id = c.id limit 1;
      perform public.crear_avis('entidad', c.entidad_id, 'recollida_per_registrar',
        case when v_resp is null then 'canalizacion' else 'oferta_resposta' end,
        coalesce(v_resp, c.id),
        jsonb_build_object('producte', c.producto, 'kg', c.kg_confirmados,
                           'recollida_at', c.data_hora_recollida, 'productor', c.productor,
                           'excedente_id', c.excedente_id));
      update canalizaciones set registre_demanat_at = now() where id = c.id;
    exception when others then
      raise warning 'programar_albarans_recollida: %: %', c.id, sqlerrm;
    end;
  end loop;
  return '[]'::jsonb;
end;
$$;
revoke execute on function public.programar_albarans_recollida() from public, anon, authenticated;
grant  execute on function public.programar_albarans_recollida() to service_role;

-- ------------------------- 6. La conciliación automática respeta las incidencias de recogida
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

  -- 2. Salidas confirmadas cuyo REC ya está conciliado, salvo las que tienen incidencia.
  for b in
    select s.id, a.numero_completo as rec_num
      from albaranes a
      join albaranes s on s.id in (select public.albarans_germans_rec(a.id))
      left join canalizaciones c on c.id = s.canalizacion_id
     where a.tipo = 'REC' and a.estado = 'conciliado'
       and s.estado = 'confirmado'
       and c.incidencia_recollida is null
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

  -- 3. OPE confirmado sin REC vivo en su excedente (venta o maquila puras), sin incidencia.
  for b in
    select a.id from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
     where a.tipo = 'OPE' and a.estado = 'confirmado'
       and c.incidencia_recollida is null
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

-- ------------------------------------------- 7. La ficha de la operación: ¿puede registrar?
-- Cambia el `returns table`: hay que borrarla y recrearla, con su revoke/grant.
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
  rec_estat              text
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
          and c.espigolada_id is null
          and alb.estado in ('borrador', 'emitido', 'entregado')
          and not exists (select 1 from enlaces_token t
                           where t.objeto_tipo = 'albaran' and t.objeto_id = alb.id
                             and t.proposito = 'confirmacion_albaran'
                             and t.usado_at is not null and t.rol_parte = 'recibe')),
         c.recollida_real_at, c.recollida_registrada_at, c.incidencia_recollida,
         rec.numero_completo, rec.estado
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
