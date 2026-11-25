-- «Registrar operació realitzada» (proceso 3.7; fase 5 del plan de noviembre de 2026), 2 de 4:
-- el INDICADOR DE TRANSACCIÓN `redestina.registre_posteriori`.
--
-- `registrar_operacio_realitzada()` (20270619100200) reutiliza las mismas puertas que el ciclo
-- normal (`assignar_directe`, `registrar_recollida_escriu`, `validar_recollida`,
-- `registrar_desti_final`) para registrar algo que YA pasó. Dentro de su transacción fija
-- `set_config('redestina.registre_posteriori', 'on', true)` (local a la transacción; ninguna
-- sesión de PostgREST puede fijarlo: no se expone `set_config`). Solo dos sitios lo leen:
--
--   1. `crear_avis()` — la ÚNICA función que inserta en `avisos` (todas las demás, triggers y
--      RPC, pasan por ella). Con el indicador devuelve `null` sin insertar: ni `interes_aprovat`,
--      ni `sortida_trobada`, ni `recollida_confirmada`, ni `albara_*`, ni ningún otro. Sin fila en
--      `avisos` no se dispara `trg_avisos_encola_envio` → no sale correo ni WhatsApp. Los que
--      llaman a `crear_avis` con `perform` (todos: ninguno lee el uuid devuelto) no cambian.
--      Lo único que sigue saliendo es la GENERACIÓN del PDF de los albaranes (cola de documentos),
--      que no envía nada por sí sola: `generar-documento` solo manda el ENT/REC por correo si
--      `canalizaciones.recollida_origen = 'entitat_receptora'` (`_shared/envia-albara.ts`), y aquí
--      la recogida la registra el equipo (`'equip'`).
--   2. `registrar_recollida_escriu()` — la guarda `data_anterior` (la recogida no puede ser más de
--      un día anterior a la canalización) se salta: la canalización nace HOY y la recogida fue el
--      día de la operación. `data_futura` sigue igual.
--
-- No hace falta relajar `hora_passada`, `hora_fora_disponibilitat`, `dia_fora_dies` ni la franja
-- (`comprova_hora_recollida`, `aprova_resposta_intern`): `registrar_operacio_realitzada` asigna
-- SIN hora prevista (`p_recollida = null`, que esas guardas no miran) y la fecha real entra por la
-- recogida (`recollida_real_at`), que `trg_canalizaciones_data_real` copia a
-- `data_hora_recollida` al validar.
--
-- Mismas firmas (`create or replace`): conservan sus GRANT (las dos, solo `service_role` y el
-- propietario). Se repite el `revoke` por si acaso.

-- ---------------------------------------------------------------------------
-- 1. `crear_avis`: nada dentro de un registro a posteriori
-- ---------------------------------------------------------------------------
create or replace function public.crear_avis(
  p_destinatari_tipo text, p_destinatari_id uuid, p_tipus text, p_objecte_tipo text,
  p_objecte_id uuid, p_params jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_destinatari_id is null then return null; end if;
  -- 20270619100100: una operación registrada a posteriori no se cuenta a nadie (ya pasó).
  if coalesce(current_setting('redestina.registre_posteriori', true), '') = 'on' then
    return null;
  end if;
  insert into avisos (destinatari_tipo, destinatari_id, tipus, objecte_tipo, objecte_id, params)
  values (p_destinatari_tipo, p_destinatari_id, p_tipus, p_objecte_tipo, p_objecte_id,
          coalesce(p_params, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.crear_avis(text, uuid, text, text, uuid, jsonb) from public, anon, authenticated;

comment on function public.crear_avis(text, uuid, text, text, uuid, jsonb) is
  'Única puerta de inserción en avisos. 20270619100100: con redestina.registre_posteriori = on '
  '(registrar_operacio_realitzada) no inserta nada y devuelve null.';

-- ---------------------------------------------------------------------------
-- 2. `registrar_recollida_escriu`: `data_anterior`, salvo en un registro a posteriori
-- ---------------------------------------------------------------------------
-- Copia literal de la definición vigente (20270610100100) con un único cambio, marcado.
create or replace function public.registrar_recollida_escriu(
  p_canalizacion uuid, p_resultat text, p_kg_reals numeric, p_data timestamptz,
  p_observacions text, p_per uuid, p_origen text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
  -- 20270619100100: un registro a posteriori (la canalización nace hoy) no tiene este límite.
  if v_data < c.created_at - interval '1 day'
     and coalesce(current_setting('redestina.registre_posteriori', true), '') <> 'on' then
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
$function$;


revoke execute on function public.registrar_recollida_escriu(uuid, text, numeric, timestamptz, text, uuid, text)
  from public, anon, authenticated;
