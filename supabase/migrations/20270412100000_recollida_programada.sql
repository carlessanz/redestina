-- Rebanada 3 de la reunión de seguimiento del 05-10-2026 (plan en `3. Claude Code/
-- 2026-10-05-plan-ejecucion-reunion-seguimiento.md`): recogida, confirmación y bloqueo.
--
--   1. La HORA de recogida: quien muestra interés la elige dentro de la franja y el día
--      dentro de la disponibilidad; el equipo la confirma o la cambia al aprobar, y queda
--      en `canalizaciones.data_hora_recollida`.
--   2. Emisión AUTOMÁTICA a la hora de recogida (D3): `programar_albarans_recollida()` emite
--      los albaranes en borrador y los marca entregados, lo que crea los enlaces de
--      confirmación de las dos partes. La llama la Edge Function `recollides-programades`
--      (cada 15 min por pg_cron), que es quien manda los correos con los enlaces.
--   3. Reenvío a las 4 h si el enlace sigue sin usar: `recordar_confirmacions_recollida()`
--      renueva el token EN LA MISMA FILA (el viejo deja de valer) y lo devuelve.
--   4. Conciliación automática cuando las dos partes han confirmado y la diferencia cabe en
--      la tolerancia (D6): `conciliacions_automatiques()`, por pg_cron.
--   5. Bloqueo por albarán pendiente (G1): quien tiene un albarán entregado con un enlace sin
--      usar desde hace más de 48 h no puede publicar ni mostrar interés hasta confirmar.
--
-- Todo es AÑADIR (§11). El número de serie se consume al emitir (D3, decidido sabiendo que
-- pasa antes de que nadie confirme): el número pertenece a la fila (§4) y existen
-- `anular_albaran`/`rectificar_albaran`.

-- ---------------------------------------------------------------------------
-- 1. La hora de recogida
-- ---------------------------------------------------------------------------
alter table oferta_respuestas add column if not exists recollida_at timestamptz;
comment on column oferta_respuestas.recollida_at is
  'Cuándo quiere recoger quien muestra interés (05-10-2026), dentro de la franja y la disponibilidad. El equipo la confirma al aprobar.';

-- Las reglas, en un solo sitio: día no posterior a la disponibilidad y hora (en Madrid)
-- dentro de la franja, cuando la oferta las tiene. No en el pasado (con una hora de margen).
create or replace function public.comprova_hora_recollida(ex excedentes, p_quan timestamptz)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := p_quan at time zone 'Europe/Madrid';
begin
  if p_quan is null then return; end if;
  if p_quan < now() - interval '1 hour' then
    raise exception 'hora_passada: la recollida no pot ser en el passat' using errcode = '22023';
  end if;
  if ex.disponible_hasta is not null and v_local::date > ex.disponible_hasta then
    raise exception 'hora_fora_disponibilitat: l''oferta es disponible fins al %', ex.disponible_hasta
      using errcode = '22023';
  end if;
  if ex.hora_recollida_inici is not null and ex.hora_recollida_fi is not null
     and (v_local::time < ex.hora_recollida_inici or v_local::time > ex.hora_recollida_fi) then
    raise exception 'hora_fora_franja: la franja de recollida es de % a %',
      to_char(ex.hora_recollida_inici, 'HH24:MI'), to_char(ex.hora_recollida_fi, 'HH24:MI')
      using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.comprova_hora_recollida(excedentes, timestamptz) from public, anon;
grant  execute on function public.comprova_hora_recollida(excedentes, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5 (antes, porque lo usa `manifestar_interes`). El bloqueo por albarán pendiente (G1)
-- ---------------------------------------------------------------------------
-- Los albaranes ENTREGADOS en los que esta organización es parte y tiene un enlace de
-- confirmación ACTIVO, sin usar, creado hace más de 48 h. La parte la dice `rol_parte`:
-- `entrega` es el generador (REC y OPE), `recibe` la entidad (ENT y OPE).
create or replace function public.bloqueig_per_albara(p_tipo text, p_org uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct a.id
    from albaranes a
    join enlaces_token en on en.objeto_tipo = 'albaran' and en.objeto_id = a.id
                         and en.proposito = 'confirmacion_albaran'
   where a.estado = 'entregado'
     and en.estado = 'activo' and en.usado_at is null and en.caduca_at > now()
     and en.created_at < now() - interval '48 hours'
     and (
       (p_tipo = 'productor' and coalesce(en.rol_parte, 'entrega') = 'entrega'
        and a.tipo in ('REC', 'OPE')
        and (a.excedente_id in (select e.id from excedentes e where e.productor_id = p_org)
             or a.espigolada_id in (select es.id from espigoladas es where es.productor_id = p_org)))
       or
       (p_tipo = 'entidad' and coalesce(en.rol_parte, 'recibe') = 'recibe'
        and a.tipo in ('ENT', 'OPE')
        and a.canalizacion_id in (select c.id from canalizaciones c where c.entidad_id = p_org))
     )
     -- Solo lo suyo: un externo no pregunta por otra organización. El equipo y el servidor sí.
     and (auth.uid() is null or public.es_intern()
          or (p_tipo = 'productor' and p_org in (select public.mis_productores()))
          or (p_tipo = 'entidad'   and p_org in (select public.mis_entidades())));
$$;
revoke execute on function public.bloqueig_per_albara(text, uuid) from public, anon;
grant  execute on function public.bloqueig_per_albara(text, uuid) to authenticated, service_role;

-- `manifestar_interes` con la hora y el bloqueo. Firma nueva → se retira la de seis.
drop function if exists public.manifestar_interes(uuid, uuid, numeric, numeric, integer, text);

create or replace function public.manifestar_interes(
  p_excedente uuid, p_entidad uuid, p_kg numeric,
  p_preu numeric default null, p_caixes integer default null,
  p_modalitat text default null, p_recollida timestamptz default null
)
returns oferta_respuestas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex     excedentes;
  fila   oferta_respuestas;
  tel    text;
  v_mods text[];
  v_cand text[];
  v_mod  text;
begin
  if p_entidad not in (select public.mis_entidades()) then
    raise exception 'No pertanys a aquesta entitat' using errcode = '42501';
  end if;

  -- G1: con un albarán por confirmar desde hace más de 48 h, primero se confirma.
  if exists (select 1 from public.bloqueig_per_albara('entidad', p_entidad)) then
    raise exception 'albara_pendent: confirma primer l''albara pendent' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null or ex.estado not in ('publicada', 'parcial') then
    raise exception 'Aquesta oferta ja no esta disponible' using errcode = '22023';
  end if;

  v_mods := coalesce(ex.modalitats, array[ex.modalitat]);
  select coalesce(array_agg(c.modalitat), '{}') into v_cand
    from entidades e
    join modalitat_receptor_compat c on c.tipo_receptor = e.tipo_receptor
   where e.id = p_entidad and c.modalitat = any(v_mods);

  if cardinality(v_cand) = 0 then
    raise exception 'Aquesta oferta no encaixa amb el tipus de receptor' using errcode = '22023';
  end if;
  if p_modalitat is not null then
    if not (p_modalitat = any(v_cand)) then
      raise exception 'Aquesta oferta no encaixa amb el tipus de receptor' using errcode = '22023';
    end if;
    v_mod := p_modalitat;
  elsif cardinality(v_cand) = 1 then
    v_mod := v_cand[1];
  else
    raise exception 'cal_modalitat: tria com vols rebre-la' using errcode = '22023';
  end if;

  perform public.exigir_convenio('entidad', p_entidad, v_mod, 'recibe');

  if p_kg is null or p_kg <= 0 then
    raise exception 'Cal indicar quants kg' using errcode = '22023';
  end if;
  if ex.kg_total is not null and p_kg > ex.kg_total then
    raise exception 'kg_maxim: com a maxim % kg', ex.kg_total using errcode = '22023';
  end if;
  if v_mod in ('venda', 'maquila') and ex.preu_minim is not null
     and (p_preu is null or p_preu < ex.preu_minim) then
    raise exception 'El preu ha de ser com a minim % EUR/kg', ex.preu_minim using errcode = '22023';
  end if;

  perform public.comprova_hora_recollida(ex, p_recollida);

  select telefono into tel from entidades where id = p_entidad;

  insert into oferta_respuestas (
    excedente_id, entidad_id, telefono, canal, estado,
    kg_solicitados, caixes_solicitades, preu_ofert, respondido_at, modalitat, recollida_at
  ) values (
    p_excedente, p_entidad, tel, 'panel', 'acceptada',
    p_kg, p_caixes, case when v_mod = 'donacio' then null else p_preu end, now(), v_mod, p_recollida
  )
  on conflict (excedente_id, entidad_id) do update
     set estado             = 'acceptada',
         canal              = 'panel',
         kg_solicitados     = excluded.kg_solicitados,
         caixes_solicitades = excluded.caixes_solicitades,
         preu_ofert         = excluded.preu_ofert,
         modalitat          = excluded.modalitat,
         recollida_at       = excluded.recollida_at,
         respondido_at      = now()
   where oferta_respuestas.aprovacio = 'pendent'
  returning * into fila;

  if fila.id is null then
    raise exception 'Aquesta resposta ja esta resolta' using errcode = '22023';
  end if;
  return fila;
end;
$$;
revoke execute on function public.manifestar_interes(uuid, uuid, numeric, numeric, integer, text, timestamptz) from public, anon;
grant  execute on function public.manifestar_interes(uuid, uuid, numeric, numeric, integer, text, timestamptz) to authenticated, service_role;

-- `aprovar_resposta` con la hora: la del equipo, o la que pidió la entidad. Firma nueva.
drop function if exists public.aprovar_resposta(uuid, numeric, numeric, text, text);

create or replace function public.aprovar_resposta(
  p_resposta  uuid,
  p_kg        numeric default null,
  p_preu      numeric default null,
  p_motiu     text default null,
  p_modalitat text default null,
  p_recollida timestamptz default null
)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        oferta_respuestas;
  ex       excedentes;
  c        canalizaciones;
  kg       numeric;
  cubierto numeric;
  v_mods   text[];
  v_val    text;
  v_aviso  text;
  v_quan   timestamptz;
begin
  if not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden aprovar' using errcode = '42501';
  end if;

  select * into r from oferta_respuestas where id = p_resposta for update;
  if r.id is null or r.estado <> 'acceptada' or r.aprovacio <> 'pendent' then
    raise exception 'Aquesta resposta no es pot aprovar' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = r.excedente_id for update;
  kg := coalesce(p_kg, r.kg_solicitados);
  if kg is null or kg <= 0 then
    raise exception 'Cal indicar els kg a canalitzar' using errcode = '22023';
  end if;

  v_mods := coalesce(ex.modalitats, array[coalesce(ex.modalitat, 'donacio')]);
  v_val := coalesce(p_modalitat, r.modalitat,
                    case when cardinality(v_mods) = 1 then v_mods[1] end);
  if v_val is null then
    raise exception 'cal_modalitat: tria la modalitat d''aquesta entrega' using errcode = '22023';
  end if;
  if not (v_val = any(v_mods)) then
    raise exception 'Aquesta oferta no s''ofereix en modalitat %', v_val using errcode = '22023';
  end if;

  -- La hora: la del equipo manda y se comprueba; la de la entidad ya se comprobó al pedirla.
  -- El equipo puede salirse de la franja si lo ha hablado con las dos partes: por eso a la
  -- suya solo se le exige que no sea pasada.
  if p_recollida is not null and p_recollida < now() - interval '1 hour' then
    raise exception 'hora_passada: la recollida no pot ser en el passat' using errcode = '22023';
  end if;
  v_quan := coalesce(p_recollida, r.recollida_at);

  v_aviso := public.exigir_convenio('productor', ex.productor_id, v_val, 'entrega');
  if v_aviso is not null then raise notice '%', v_aviso; end if;
  v_aviso := public.exigir_convenio('entidad', r.entidad_id, v_val, 'recibe');
  if v_aviso is not null then raise notice '%', v_aviso; end if;

  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, estado, valorizacion, data_hora_recollida)
  values (r.excedente_id, r.entidad_id, kg, 'confirmada', v_val, v_quan)
  returning * into c;

  update oferta_respuestas
     set aprovacio       = 'aprovada',
         aprovat_at      = now(),
         motiu_aprovacio = p_motiu,
         canalizacion_id = c.id,
         kg_aprovats     = kg,
         modalitat       = v_val,
         recollida_at    = v_quan,
         preu_ofert      = case when v_val = 'donacio' then null
                                else coalesce(p_preu, r.preu_ofert) end
   where id = r.id;

  select coalesce(sum(kg_confirmados), 0) into cubierto
    from canalizaciones where excedente_id = ex.id;

  update excedentes
     set estado = case
           when coalesce(ex.kg_total, 0) > 0 and cubierto >= ex.kg_total then 'bloqueada'
           else 'parcial'
         end
   where id = ex.id and estado in ('publicada', 'parcial');

  return c;
end;
$$;
revoke execute on function public.aprovar_resposta(uuid, numeric, numeric, text, text, timestamptz) from public, anon;
grant  execute on function public.aprovar_resposta(uuid, numeric, numeric, text, text, timestamptz) to authenticated, service_role;

-- El aviso de «interés aprobado» lleva ahora la hora (el trigger de 20270410100000 la lee
-- de la respuesta, que `aprovar_resposta` ya ha escrito en el mismo `update`).
create or replace function trg_respostes_avis()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex   excedentes;
  v_prod text;
  v_mun  text;
  v_ent  text;
  v_kg   numeric;
begin
  if new.aprovacio is not distinct from old.aprovacio then return new; end if;
  select * into ex from excedentes where id = new.excedente_id;
  if ex.id is null then return new; end if;

  if new.aprovacio = 'aprovada' then
    v_kg := coalesce(new.kg_aprovats,
                     (select c.kg_confirmados from canalizaciones c where c.id = new.canalizacion_id),
                     new.kg_solicitados);
    select coalesce(nullif(p.empresa, ''), p.name) into v_prod from productores p where p.id = ex.productor_id;
    v_mun := coalesce((select u.municipio from productor_ubicaciones u where u.id = ex.ubicacion_id),
                      (select p.poblacion from productores p where p.id = ex.productor_id));
    select e.nombre into v_ent from entidades e where e.id = new.entidad_id;

    perform public.crear_avis('entidad', new.entidad_id, 'interes_aprovat', 'oferta_resposta', new.id,
      jsonb_build_object(
        'producte', ex.producto, 'kg_sol', new.kg_solicitados, 'kg_apr', v_kg,
        'modalitat', new.modalitat, 'productor', v_prod, 'municipi', v_mun,
        'excedente_id', ex.id, 'recollida_at', new.recollida_at));
    perform public.crear_avis('productor', ex.productor_id, 'sortida_trobada', 'excedente', ex.id,
      jsonb_build_object(
        'producte', ex.producto, 'ref', ex.id_excedente, 'kg', v_kg, 'entitat', v_ent,
        'modalitat', new.modalitat, 'recollida_at', new.recollida_at));
  elsif new.aprovacio = 'rebutjada' then
    perform public.crear_avis('entidad', new.entidad_id, 'interes_rebutjat', 'oferta_resposta', new.id,
      jsonb_build_object('producte', ex.producto, 'motiu', new.motiu_aprovacio,
                         'excedente_id', ex.id));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Emisión automática a la hora de recogida (D3)
-- ---------------------------------------------------------------------------
-- Para cada albarán en BORRADOR cuya recogida ya ha llegado:
--   · ENT/OPE: su canalización tiene `data_hora_recollida <= now()`.
--   · REC (donación): alguna canalización de su oferta ha llegado a la hora. Sus kilos son
--     los de TODAS las canalizaciones de la oferta, no el `kg_total` publicado: lo que
--     entra en Espigoladors es lo que sale hacia las entidades.
-- Las líneas sin pesar toman los kilos previstos (`kg_bruto = kg_neto = kg_previstos`,
-- tara 0): es lo que dice la oferta, y cada parte corrige lo real al confirmar.
-- Cada albarán va en su propio subbloque: uno que falla no detiene los demás.
--
-- Devuelve los enlaces EN CLARO de `marcar_entregado()`: es la única vez que existen, y
-- quien llama (la Edge Function) los manda por correo.
create or replace function public.programar_albarans_recollida()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_res    jsonb := '[]'::jsonb;
  v_ent    jsonb;
  v_kg     numeric;
  v_quan   timestamptz;
  a        albaranes;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor programa recollides' using errcode = '42501';
  end if;

  for r in
    select b.id, b.tipo, b.excedente_id, b.canalizacion_id
      from albaranes b
      left join canalizaciones c on c.id = b.canalizacion_id
     where b.estado = 'borrador'
       and b.rectifica_a is null
       and (
         (b.tipo in ('ENT', 'OPE') and c.data_hora_recollida is not null
          and c.data_hora_recollida <= now() and c.estado <> 'anulada')
         or
         (b.tipo = 'REC' and b.espigolada_id is null and exists (
            select 1 from canalizaciones c2
             where c2.excedente_id = b.excedente_id
               and c2.data_hora_recollida is not null and c2.data_hora_recollida <= now()))
       )
     order by case when b.tipo = 'REC' then 0 else 1 end, b.created_at
     limit 100
  loop
    begin
      if r.tipo = 'REC' then
        select coalesce(sum(c.kg_confirmados), 0), min(c.data_hora_recollida)
          into v_kg, v_quan
          from canalizaciones c where c.excedente_id = r.excedente_id;
        update albaran_lineas
           set kg_previstos = case when v_kg > 0 then v_kg else kg_previstos end
         where albaran_id = r.id;
      else
        select c.data_hora_recollida into v_quan from canalizaciones c where c.id = r.canalizacion_id;
      end if;

      update albaran_lineas
         set kg_bruto = coalesce(kg_bruto, kg_previstos),
             tara_kg  = coalesce(tara_kg, 0),
             kg_neto  = coalesce(kg_neto, kg_previstos)
       where albaran_id = r.id;

      a := public.emitir_albaran(r.id, jsonb_build_object('fecha_hora', v_quan), null, null);
      v_ent := public.marcar_entregado(r.id);
      v_res := v_res || jsonb_build_object(
        'albaran_id', a.id, 'tipo', a.tipo, 'numero', a.numero_completo,
        'idioma', a.idioma, 'enllacos', v_ent->'enllacos');
    exception when others then
      raise warning 'programar_albarans_recollida: % (%): %', r.id, r.tipo, sqlerrm;
      v_res := v_res || jsonb_build_object('albaran_id', r.id, 'error', sqlerrm);
    end;
  end loop;
  return v_res;
end;
$$;
revoke execute on function public.programar_albarans_recollida() from public, anon, authenticated;
grant  execute on function public.programar_albarans_recollida() to service_role;

-- ---------------------------------------------------------------------------
-- 3. El reenvío a las 4 h
-- ---------------------------------------------------------------------------
-- El token en claro solo existió en el primer correo, así que reenviar es RENOVARLO: misma
-- fila (mismo `id`, misma caducidad, misma evidencia futura), hash nuevo. El enlace del
-- primer correo deja de valer, y el correo nuevo lo dice. Una sola vez (`reenviat_at`).
alter table enlaces_token add column if not exists reenviat_at timestamptz;
comment on column enlaces_token.reenviat_at is
  'Cuándo se renovó el token para reenviarlo (recogida programada, 05-10-2026). Una sola vez.';
-- Columna nueva en una tabla con GRANT por columnas: no hereda el SELECT (§4).
grant select (reenviat_at) on enlaces_token to authenticated;

create or replace function public.recordar_confirmacions_recollida()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  en      record;
  v_token text;
  v_res   jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor reenvia enllacos' using errcode = '42501';
  end if;
  for en in
    select t.id, t.destinatario_email, t.destinatario_nombre, t.rol_parte,
           a.id as albaran_id, a.numero_completo, a.tipo, a.idioma
      from enlaces_token t
      join albaranes a on a.id = t.objeto_id
     where t.proposito = 'confirmacion_albaran' and t.objeto_tipo = 'albaran'
       and t.estado = 'activo' and t.usado_at is null and t.caduca_at > now()
       and t.reenviat_at is null
       and t.canal = 'email'
       and t.destinatario_email is not null
       and t.created_at < now() - interval '4 hours'
       and a.estado = 'entregado'
     limit 100
  loop
    select g.token into v_token from public.generar_token_enlace() g;
    update enlaces_token
       set token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
           reenviat_at = now()
     where id = en.id;
    v_res := v_res || jsonb_build_object(
      'albaran_id', en.albaran_id, 'tipo', en.tipo, 'numero', en.numero_completo,
      'idioma', en.idioma, 'reenviament', true,
      'enllacos', jsonb_build_array(jsonb_build_object(
        'id', en.id, 'destinatari', en.destinatario_email, 'nom', en.destinatario_nombre,
        'rol_part', en.rol_parte, 'token', v_token)));
  end loop;
  return v_res;
end;
$$;
revoke execute on function public.recordar_confirmacions_recollida() from public, anon, authenticated;
grant  execute on function public.recordar_confirmacions_recollida() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Conciliación automática (D6)
-- ---------------------------------------------------------------------------
-- Una oferta cuyo REC y TODAS sus entregas (ENT/OPE no anuladas) están confirmadas, y cuya
-- diferencia cabe en `tolerancia_conciliacion_pct`, se concilia sola: los kilos validados
-- son los que confirmó cada parte. Fuera de tolerancia se queda en la cola
-- `albarans_conciliar` del equipo, como siempre. Solo donaciones con REC: una venta o
-- maquila (OPE) sin REC se concilia cuando su OPE está confirmado por las dos partes, que
-- es lo que ya hace el equipo a mano.
create or replace function public.conciliacions_automatiques()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  rec  record;
  b    record;
  prop jsonb;
  n    integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor concilia automaticament' using errcode = '42501';
  end if;
  for rec in
    select a.id, a.excedente_id
      from albaranes a
     where a.tipo = 'REC' and a.estado = 'confirmado' and a.excedente_id is not null
       and not exists (
         select 1 from albaranes s
          where s.excedente_id = a.excedente_id and s.tipo in ('ENT', 'OPE')
            and s.estado not in ('confirmado', 'anulado', 'rectificado', 'conciliado'))
       and exists (
         select 1 from albaranes s
          where s.excedente_id = a.excedente_id and s.tipo in ('ENT', 'OPE')
            and s.estado = 'confirmado')
  loop
    begin
      prop := public.propuesta_conciliacion(rec.id);
      if coalesce((prop->>'dins_tolerancia')::boolean, false) then
        for b in
          select s.id from albaranes s
           where s.excedente_id = rec.excedente_id and s.tipo in ('ENT', 'OPE') and s.estado = 'confirmado'
        loop
          perform public.conciliar_albaran(b.id, null, 'conciliacio automatica (dins de tolerancia)', null);
        end loop;
        perform public.conciliar_albaran(rec.id, null, 'conciliacio automatica (dins de tolerancia)', null);
        n := n + 1;
      end if;
    exception when others then
      raise warning 'conciliacions_automatiques: REC %: %', rec.id, sqlerrm;
    end;
  end loop;

  -- OPE confirmado por las DOS partes (no hay REC en venta/maquila).
  for b in
    select a.id from albaranes a
     where a.tipo = 'OPE' and a.estado = 'confirmado'
       and (select count(*) from enlaces_token t
             where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
               and t.proposito = 'confirmacion_albaran' and t.usado_at is not null) >= 2
  loop
    begin
      perform public.conciliar_albaran(b.id, null, 'conciliacio automatica (confirmat per les dues parts)', null);
      n := n + 1;
    exception when others then
      raise warning 'conciliacions_automatiques: OPE %: %', b.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;
revoke execute on function public.conciliacions_automatiques() from public, anon, authenticated;
grant  execute on function public.conciliacions_automatiques() to service_role;

-- ---------------------------------------------------------------------------
-- Los dos jobs
-- ---------------------------------------------------------------------------
create or replace function public.disparar_recollides_programades()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secreto text;
begin
  select value into secreto from app_config where key = 'documentos_secret';
  if secreto is null or secreto = '' then
    raise notice 'recollides-programades: sense secret configurat, no-op.';
    return;
  end if;
  perform net.http_post(
    url     := public.url_funciones() || '/recollides-programades',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-documentos-secret', secreto),
    body    := '{}'::jsonb
  );
end;
$$;
revoke execute on function public.disparar_recollides_programades() from public, anon, authenticated;
grant  execute on function public.disparar_recollides_programades() to service_role;

do $$
begin
  perform cron.unschedule('recollides-programades')
    where exists (select 1 from cron.job where jobname = 'recollides-programades');
exception when others then null;
end $$;
select cron.schedule('recollides-programades', '*/15 * * * *', 'select public.disparar_recollides_programades()');

do $$
begin
  perform cron.unschedule('conciliacions-automatiques')
    where exists (select 1 from cron.job where jobname = 'conciliacions-automatiques');
exception when others then null;
end $$;
select cron.schedule('conciliacions-automatiques', '7,22,37,52 * * * *', 'select public.conciliacions_automatiques()');
