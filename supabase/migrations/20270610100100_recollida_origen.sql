-- Fase 5 de los puntos 4-6: QUIÉN REGISTRÓ UNA RECOGIDA, en una columna.
--
-- La fase 5 manda los albaranes por correo automáticamente solo cuando la recogida la DECLARÓ LA
-- ENTIDAD desde su panel (nivel 2), no cuando la registró el equipo en su nombre (nivel 1). Hasta
-- aquí no había un dato fiable: `registrar_recollida_escriu()` recibía `p_origen`
-- ('entitat_receptora' | 'equip') pero solo lo guardaba dentro de `incidencia_recollida` cuando
-- había diferencia de kilos, y `validar_recollida()` lo deducía de si `recollida_registrada_per`
-- tenía membresía en la entidad.
--
-- Esta migración:
--   1. `canalizaciones.recollida_origen` ('entitat_receptora' | 'equip' | null), con su check, y
--      el relleno de las ya registradas (mismo criterio que `validar_recollida`).
--   2. `registrar_recollida_escriu()` (misma firma) la escribe con `p_origen`.
--   3. Trigger `canalizaciones_origen_recollida`: si el registro se borra (`retornar_recollida`
--      pone `recollida_registrada_at` a null), el origen también.
--   4. `trg_canalizaciones_protegeix_recollida` la protege como el resto de la recogida.
--   5. `albarans_recollida(p_canalizacion)`, interna (solo `service_role`): los albaranes ENT/REC
--      emitidos de esa recogida, con su documento vigente y el origen. Los destinatarios y el
--      enlace de confirmación siguen saliendo de `preparar_enviament_albara(p_albaran, p_per)`,
--      que ya sirve por albarán y no se duplica.
--
-- La columna entra en el SELECT de `authenticated` sin más: `canalizaciones` tiene GRANT de
-- SELECT de tabla (no por columnas). La escritura directa la corta el trigger.

-- ---------------------------------------------------------------------------
-- 1. Columna, check y relleno
-- ---------------------------------------------------------------------------
alter table public.canalizaciones
  add column if not exists recollida_origen text;

alter table public.canalizaciones drop constraint if exists canalizaciones_recollida_origen_check;
alter table public.canalizaciones add constraint canalizaciones_recollida_origen_check
  check (recollida_origen is null or recollida_origen = any (array['entitat_receptora', 'equip'])) not valid;

comment on column public.canalizaciones.recollida_origen is
  'Quién registró la recogida: entitat_receptora (la entidad, desde su panel: nivel 2) o equip (el equipo en su nombre: nivel 1). Nulo sin registro. La escribe registrar_recollida_escriu (20270610100100).';

-- Las ya registradas: el origen que guardó la incidencia, si lo hay; si no, el criterio de
-- `validar_recollida` (quien registró es miembro activo de la entidad → la entidad; si no → el
-- equipo). Sin `recollida_registrada_per` no se sabe: queda nulo. Con `auth.uid()` nulo los
-- triggers de protección dejan pasar.
update public.canalizaciones c
   set recollida_origen = case
         when c.incidencia_recollida ->> 'origen' in ('entitat_receptora', 'equip')
           then c.incidencia_recollida ->> 'origen'
         when exists (select 1 from public.membresias m
                       where m.user_id = c.recollida_registrada_per
                         and m.entidad_id = c.entidad_id and m.activo)
           then 'entitat_receptora'
         else 'equip'
       end
 where c.recollida_registrada_at is not null
   and c.recollida_registrada_per is not null
   and c.recollida_origen is null;

alter table public.canalizaciones validate constraint canalizaciones_recollida_origen_check;

-- ---------------------------------------------------------------------------
-- 2. `registrar_recollida_escriu`: guarda el origen
-- ---------------------------------------------------------------------------
-- Copia literal de la vigente (20270608100200) con `recollida_origen = p_origen` en el update.
create or replace function public.registrar_recollida_escriu(
  p_canalizacion uuid, p_resultat text, p_kg_reals numeric, p_data timestamptz,
  p_observacions text, p_per uuid, p_origen text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_esc     text := current_setting('redestina.escriu_recollida', true);
  c         canalizaciones%rowtype;
  s         albaranes%rowtype;
  v_assig   numeric;
  v_kg      numeric;
  v_obs     text := nullif(btrim(coalesce(p_observacions, '')), '');
  v_data    timestamptz;
  v_inc     jsonb;
begin
  if p_origen not in ('entitat_receptora', 'equip') then
    raise exception 'origen_desconegut' using errcode = '22023';
  end if;
  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
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

  -- (2) La salida, y que nadie la haya confirmado ya por otro camino. 20270608100100 (D): una
  --     venta o una maquila no tiene albarán de Redestina; sin salida viva se registra igual. La
  --     donación la sigue necesitando.
  select * into s from albaranes
   where canalizacion_id = c.id and tipo in ('ENT', 'OPE')
     and estado not in ('anulado', 'rectificado')
   order by created_at desc limit 1
   for update;
  if s.id is null and coalesce(c.valorizacion, '') not in ('venda', 'maquila') then
    raise exception 'sense_albara' using errcode = '22023';
  end if;
  if s.id is not null
     and (s.estado in ('confirmado', 'conciliado')
          or exists (select 1 from enlaces_token t
                      where t.objeto_tipo = 'albaran' and t.objeto_id = s.id
                        and t.proposito = 'confirmacion_albaran'
                        and t.usado_at is not null and t.rol_parte = 'recibe')) then
    raise exception 'ja_registrada' using errcode = '22023';
  end if;
  if s.id is null and c.estado = 'conciliada' then
    raise exception 'ja_registrada' using errcode = '22023';
  end if;

  v_inc := case when p_resultat <> 'coincideix' then jsonb_build_object(
    'descripcion', v_obs, 'tipus', 'diferencia_kg', 'resultat', p_resultat,
    'kg_assignats', v_assig, 'kg_reals', v_kg, 'origen', p_origen,
    'registrada_at', now(), 'registrada_per', p_per) end;

  -- (3) Solo guardar.
  perform set_config('redestina.escriu_recollida', 'on', true);

  if s.id is not null then
    update enlaces_token set estado = 'revocado'
     where objeto_tipo = 'albaran' and objeto_id = s.id
       and proposito = 'confirmacion_albaran' and estado = 'activo'
       and (rol_parte = 'recibe' or rol_parte is null
            or (s.tipo = 'OPE' and rol_parte = 'entrega'));
  end if;

  update canalizaciones
     set kg_declarats             = v_kg,
         resultat_recollida       = p_resultat,
         observacions_recollida   = v_obs,
         recollida_real_at        = v_data,
         recollida_registrada_at  = now(),
         recollida_registrada_per = p_per,
         -- 20270610100100: quién la registró (nivel 2 = la entidad; nivel 1 = el equipo).
         recollida_origen         = p_origen,
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
-- Misma firma: conserva sus privilegios (interna). Se repite el revoke por si acaso.
revoke execute on function public.registrar_recollida_escriu(uuid, text, numeric, timestamptz, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sin registro, sin origen
-- ---------------------------------------------------------------------------
-- `retornar_recollida()` borra el registro (`recollida_registrada_at/per` a null) y guarda el
-- anterior en `historial_recollida`; el origen se va con él. Un trigger y no otra copia de
-- `retornar_recollida`: vale para cualquier camino que deshaga el registro.
-- ⚠️ Se llama `canalizaciones_origen_recollida`: los BEFORE se disparan por orden alfabético y
--    este va antes de `canalizaciones_protegeix_recollida`, que ve ya el origen a null.
create or replace function public.trg_canalizaciones_origen_recollida()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.recollida_registrada_at is null and new.recollida_origen is not null then
    new.recollida_origen := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_canalizaciones_origen_recollida() from public, anon, authenticated;

drop trigger if exists canalizaciones_origen_recollida on public.canalizaciones;
create trigger canalizaciones_origen_recollida
  before update of recollida_registrada_at, recollida_origen on public.canalizaciones
  for each row execute function public.trg_canalizaciones_origen_recollida();

-- ---------------------------------------------------------------------------
-- 4. La protección de la recogida cubre el origen
-- ---------------------------------------------------------------------------
-- Copia literal de la vigente con `recollida_origen` en las dos listas.
create or replace function public.trg_canalizaciones_protegeix_recollida()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Traspaso o borrado de una cuenta del equipo (20270514100000): solo cambia QUIEN, y solo las RPC
  -- `equip_*` ponen esta marca dentro de su transaccion.
  if tg_op = 'UPDATE' and coalesce(current_setting('redestina.traspas_autoria', true), '') = 'on' then
    return new;
  end if;
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
       or new.incidencia_recollida is not null
       or new.recollida_origen is not null then
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
     or new.incidencia_recollida     is distinct from old.incidencia_recollida
     or new.recollida_origen         is distinct from old.recollida_origen then
    raise exception 'La recollida nomes es registra, es valida o es retorna per les seves RPC'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_canalizaciones_protegeix_recollida() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. `albarans_recollida()`: lo que el servidor manda tras validar una recogida
-- ---------------------------------------------------------------------------
-- Interna (la llama una Edge Function con `service_role`): con sesión, `42501`. Devuelve una fila
-- por albarán ENT/REC EMITIDO (ni borrador, ni anulado, ni rectificado) de esa canalización —el
-- ENT y el REC de la recogida (20270608100100)—, con su documento vigente (puede no estar
-- generado aún: `documento_estado`) y el origen de la recogida. El REC heredado de una oferta (sin
-- `canalizacion_id`) no sale: no es de esta recogida. Una canalización inexistente: 0 filas.
create or replace function public.albarans_recollida(p_canalizacion uuid)
returns table(
  albaran_id        uuid,
  tipo              text,
  numero_completo   text,
  estado            text,
  documento_id      uuid,
  documento_estado  text,
  documento_modo    text,
  recollida_origen  text,
  recollida_validada_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor llista els albarans d''una recollida' using errcode = '42501';
  end if;

  return query
  select a.id, a.tipo, a.numero_completo, a.estado,
         d.id, d.estado, d.modo,
         c.recollida_origen, c.recollida_validada_at
    from canalizaciones c
    join albaranes a on a.canalizacion_id = c.id
    left join lateral (
      select dd.id, dd.estado, dd.modo
        from documentos dd
       where dd.objeto_tipo = 'albaran' and dd.objeto_id = a.id and dd.vigente
       order by dd.version desc
       limit 1
    ) d on true
   where c.id = p_canalizacion
     and a.tipo in ('ENT', 'REC')
     and a.estado not in ('borrador', 'anulado', 'rectificado')
   order by case a.tipo when 'ENT' then 0 else 1 end, a.created_at;
end;
$$;
revoke execute on function public.albarans_recollida(uuid) from public, anon, authenticated;
grant  execute on function public.albarans_recollida(uuid) to service_role;
