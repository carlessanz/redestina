-- Firma propia de cada cuenta del equipo (25-11-2026, proceso 0.1).
--
-- Los albaranes los firma quien los valida o emite, con SU firma (no la de la apoderada, que es
-- la institucional y se queda en `parametros_documentales`). Esta migración:
--
--   1. `perfiles.firma_ruta` (ruta del PNG dentro del bucket privado `activos`,
--      `equip/<uid>/firma-<ts>.png`) y `perfiles.firma_actualitzada_at`.
--      🔴 Ninguna de las dos se lee desde el navegador: `perfiles` pasa de GRANT de SELECT por
--      TABLA a GRANT por COLUMNAS (las de siempre, sin estas dos), como `documentos` o
--      `parametros_documentales`. Ninguna pantalla ni función hace `select('*')` sobre `perfiles`
--      (comprobado: todas piden columnas). La propia firma se lee con `la_meva_firma()`.
--   2. `fixar_firma_equip(p_user, p_ruta) returns text` — SOLO `service_role` (la llama la Edge
--      Function que sube el PNG): fija o borra (`p_ruta` null) la firma de una cuenta del equipo y
--      devuelve la ruta ANTERIOR, para que la función borre el fichero viejo.
--   3. `la_meva_firma() returns jsonb` — `{ruta, actualitzada_at}` de la cuenta en sesión; solo
--      equipo (42501 a un externo).
--   4. Snapshot del albarán: `albaranes.signant_equip jsonb` se congela en el MISMO `update` que
--      emite (`emitir_albaran`, que también llaman `validar_recollida` y `rectificar_albaran`):
--      `{nom, rol, firma_ruta}` de `auth.uid()` si es del equipo; null si emite el servidor o un
--      job. `albaran_datos()` lo copia a la raíz de `documentos.datos` como `signant_equip`, así
--      que también la versión conciliada (v2) lleva el de la emisión, no el de quien concilia.
--      Lo ya emitido no se toca (sin backfill) y la columna entra en el trigger de inmutabilidad.


-- 1. Columnas y GRANT de perfiles -------------------------------------------------------------

alter table public.perfiles add column if not exists firma_ruta text;
alter table public.perfiles add column if not exists firma_actualitzada_at timestamptz;

comment on column public.perfiles.firma_ruta is
  'Firma propia de una cuenta del EQUIPO (20270615100200): ruta del PNG en el bucket privado `activos` (equip/<uid>/firma-<ts>.png). Fuera del GRANT de SELECT; se escribe solo con fixar_firma_equip() (service_role) y se lee con la_meva_firma().';
comment on column public.perfiles.firma_actualitzada_at is
  'Cuándo se fijó o borró la firma propia (20270615100200). Fuera del GRANT de SELECT.';

-- GRANT por columnas. El `revoke` de tabla se lleva también los de columna, así que va primero.
-- La lista son TODAS las columnas de antes; una columna nueva de `perfiles` nace sin SELECT.
revoke select on public.perfiles from authenticated;
grant select (id, email, nombre, telefono, idioma, vista_defecto, activo,
              created_at, updated_at, mercat_vist_at)
  on public.perfiles to authenticated;
revoke all on public.perfiles from anon;


-- 2. fixar_firma_equip ------------------------------------------------------------------------

create or replace function public.fixar_firma_equip(p_user uuid, p_ruta text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_abans text;
  v_ruta  text := nullif(btrim(coalesce(p_ruta, '')), '');
begin
  -- Solo el servidor (la Edge Function que guarda el PNG); además, sin EXECUTE para nadie más.
  if auth.uid() is not null then
    raise exception 'Nomes el servidor fixa la signatura d''una compte de l''equip' using errcode = '42501';
  end if;

  if p_user is null or not exists (select 1 from usuario_roles ur where ur.user_id = p_user) then
    raise exception 'no_es_de_lequip' using errcode = '22023';
  end if;

  -- La ruta, dentro de la carpeta de esa cuenta y sin escapar de ella.
  if v_ruta is not null
     and (position(('equip/' || p_user::text || '/') in v_ruta) <> 1 or v_ruta like '%..%') then
    raise exception 'ruta_invalida: la signatura ha d''anar a equip/<usuari>/' using errcode = '22023';
  end if;

  select pe.firma_ruta into v_abans from perfiles pe where pe.id = p_user for update;

  update perfiles
     set firma_ruta            = v_ruta,
         firma_actualitzada_at = now()
   where id = p_user;

  return v_abans;
end;
$$;

revoke execute on function public.fixar_firma_equip(uuid, text) from public, anon, authenticated;
grant execute on function public.fixar_firma_equip(uuid, text) to service_role;

comment on function public.fixar_firma_equip(uuid, text) is
  'Solo service_role (20270615100200): fija (p_ruta) o borra (null) la firma propia de una cuenta del equipo y devuelve la ruta ANTERIOR (o null) para borrar el fichero viejo. 42501 con sesión · 22023 no_es_de_lequip · ruta_invalida (fuera de equip/<p_user>/).';


-- 3. la_meva_firma ----------------------------------------------------------------------------

create or replace function public.la_meva_firma()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip te signatura propia' using errcode = '42501';
  end if;

  select jsonb_build_object('ruta', pe.firma_ruta, 'actualitzada_at', pe.firma_actualitzada_at)
    into v
    from perfiles pe
   where pe.id = auth.uid();

  return coalesce(v, jsonb_build_object('ruta', null, 'actualitzada_at', null));
end;
$$;

revoke execute on function public.la_meva_firma() from public, anon;
grant execute on function public.la_meva_firma() to authenticated;

comment on function public.la_meva_firma() is
  'La firma propia de la cuenta en sesión (20270615100200): {"ruta": text|null, "actualitzada_at": timestamptz|null}. Solo equipo (42501).';


-- 4. Snapshot del albarán ---------------------------------------------------------------------

alter table public.albaranes add column if not exists signant_equip jsonb;

comment on column public.albaranes.signant_equip is
  'Quien del equipo emitió el albarán (20270615100200), congelado al emitir: {"nom", "rol" super_admin|admin, "firma_ruta" (bucket activos) | null}. Null si lo emitió el servidor o un job, y en lo emitido antes. Va a documentos.datos->signant_equip.';

-- Lo que se congela: la cuenta en sesión si es del equipo; si no (service_role, job), null.
-- Interna: sin EXECUTE para ninguna sesión.
create or replace function public.signant_equip_actual()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'nom',        coalesce(nullif(btrim(pe.nombre), ''), pe.email),
           'rol',        case when exists (select 1 from usuario_roles s
                                            where s.user_id = pe.id and s.rol = 'super_admin')
                              then 'super_admin' else 'admin' end,
           'firma_ruta', pe.firma_ruta)
    from perfiles pe
   where pe.id = auth.uid()
     and exists (select 1 from usuario_roles ur where ur.user_id = pe.id);
$$;

revoke execute on function public.signant_equip_actual() from public, anon, authenticated;
grant execute on function public.signant_equip_actual() to service_role;

comment on function public.signant_equip_actual() is
  'Interna (20270615100200): {nom, rol, firma_ruta} de auth.uid() si es del equipo; null si no. La usa emitir_albaran() para congelar albaranes.signant_equip.';


-- emitir_albaran: la definición vigente, con `signant_equip` en el mismo `update`.

CREATE OR REPLACE FUNCTION public.emitir_albaran(p_id uuid, p_recogida jsonb DEFAULT NULL::jsonb, p_lineas jsonb DEFAULT NULL::jsonb, p_idioma text DEFAULT NULL::text)
 RETURNS albaranes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         emitido_por     = auth.uid(),
         -- 20270615100200: quien firma el albarán por el equipo, congelado aquí.
         signant_equip   = public.signant_equip_actual()
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
$function$;

revoke execute on function public.emitir_albaran(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.emitir_albaran(uuid, jsonb, jsonb, text) to authenticated;


-- albaran_datos: la definición vigente, con `signant_equip` en la raíz.

CREATE OR REPLACE FUNCTION public.albaran_datos(p_albaran uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a      albaranes%rowtype;
  ex     excedentes%rowtype;
  par    parametros_documentales%rowtype;
  v_mod  text;
  v_tipo text;
begin
  select * into a from albaranes where id = p_albaran;
  select * into ex from excedentes where id = a.excedente_id;
  select * into par from parametros_documentales where id = 1;
  v_tipo := replace(a.tipo, 'R-', '');

  -- La modalidad de ESTE documento: la de la canalización en ENT/OPE (`valorizacion`); en el
  -- REC, la donación es lo único que crea un REC (el trigger de canalizaciones), y una
  -- espigolada también es donación.
  v_mod := case
             when v_tipo = 'REC' then 'donacio'
             else coalesce((select c.valorizacion from canalizaciones c where c.id = a.canalizacion_id),
                           ex.modalitat)
           end;

  return jsonb_build_object(
    'format',       'albara-1p',
    'tipus',        a.tipo,
    'numero',       a.numero_completo,
    'ejercici',     a.ejercicio,
    'idioma',       a.idioma,
    'emes_at',      to_char(coalesce(a.emitido_at, now()) at time zone 'Europe/Madrid',
                            'YYYY-MM-DD"T"HH24:MI:SS'),
    'data_elaboracio', to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD'),
    'modalitat',    v_mod,
    -- Hasta hoy el REC imprimía siempre «Donació», también en una espigolada: el snapshot
    -- no llevaba este dato aunque el renderizador lo leía.
    'tipus_entrada', case when v_tipo = 'REC'
                          then case when a.espigolada_id is not null or ex.origen = 'espigolament'
                                    then 'espigolament' else 'donacio' end
                     end,
    -- Quien firma el pie: la Fundació, de sus parámetros (con sus marcas de provisional).
    'fundacio',     jsonb_build_object('razon_social', par.razon_social, 'nif', par.cif,
                                       'domicilio', par.domicilio),
    'partes',       a.partes,
    'recollida',    a.recogida,
    'retorn_envasos', a.retorn_envasos,
    'observacions', a.observaciones,
    'incidencies',  a.incidencias,
    'rebuig',       jsonb_build_object('tipus', a.rechazo, 'motiu', a.motivo_rechazo),
    'referencies',  jsonb_build_object(
                      'registre',   ex.id_excedente,
                      'espigolada', (select coalesce(es.ref_externa, es.id::text)
                                       from espigoladas es where es.id = a.espigolada_id),
                      'rectifica',  (select r.numero_completo from albaranes r where r.id = a.rectifica_a),
                      'externs',    (select jsonb_agg(jsonb_build_object('tipus', x.tipo,
                                                                          'numero', x.numero,
                                                                          'data', x.fecha))
                                       from documentos_externos x
                                      where x.objeto_tipo = 'albaran' and x.objeto_id = a.id)),
    'linies',       (select jsonb_agg(jsonb_build_object(
                              'ordre',          l.orden,
                              'producte',       l.producto,
                              'varietat',       l.variedad,
                              'familia',        l.familia,
                              'causa',          l.causa,
                              'caixes',         l.num_cajas,
                              'tipus_caixa',    l.tipo_caja,
                              'kg_brut',        l.kg_bruto,
                              'tara_kg',        l.tara_kg,
                              'kg_net',         l.kg_neto,
                              'kg_previstos',   l.kg_previstos,
                              'kg_confirmats',  l.kg_confirmados,
                              'kg_validats',    l.kg_validados,
                              'lot_origen',     l.lote_origen,
                              -- SOLO en el REC de donación (ver la cabecera). Desde la D2
                              -- (20270601100000) el valor de las canalizaciones de la oferta
                              -- —el precio del mes del albarán, o el último publicado y
                              -- provisional— y de dónde sale (`valor_font`, que se imprime).
                              -- Null = «—» en el papel, nunca un 0 inventado.
                              'valor_kg',       case when v_tipo = 'REC' and v_mod = 'donacio'
                                                     then (public.valor_linia_rec(a.id, l.producto)->>'valor_kg')::numeric
                                                end,
                              'valor_font',     case when v_tipo = 'REC' and v_mod = 'donacio'
                                                     then public.valor_linia_rec(a.id, l.producto) - 'valor_kg'
                                                end)
                            order by l.orden)
                       from albaran_lineas l where l.albaran_id = a.id)
  )
  -- 20270615100200: quien firma por el equipo, en la raíz y solo si lo hay (lo emitido antes
  -- no cambia de forma: su `datos` no gana una clave nula).
  || case when a.signant_equip is not null
          then jsonb_build_object('signant_equip', a.signant_equip)
          else '{}'::jsonb end;
end;
$function$;

-- Interna, como estaba: solo el servidor.
revoke execute on function public.albaran_datos(uuid) from public, anon, authenticated;
grant execute on function public.albaran_datos(uuid) to service_role;


-- El trigger de inmutabilidad: `signant_equip` también queda congelado al emitir.

CREATE OR REPLACE FUNCTION public.trg_albaranes_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Traspaso o borrado de una cuenta del equipo (20270514100000): solo cambia QUIEN, y solo las RPC
  -- `equip_*` ponen esta marca dentro de su transaccion.
  if tg_op = 'UPDATE' and coalesce(current_setting('redestina.traspas_autoria', true), '') = 'on' then
    return new;
  end if;
  if old.estado <> 'borrador' then
    if new.tipo            is distinct from old.tipo
    or new.serie           is distinct from old.serie
    or new.ejercicio       is distinct from old.ejercicio
    or new.numero          is distinct from old.numero
    or new.numero_completo is distinct from old.numero_completo
    or new.excedente_id    is distinct from old.excedente_id
    or new.espigolada_id   is distinct from old.espigolada_id
    or new.canalizacion_id is distinct from old.canalizacion_id
    or new.partes          is distinct from old.partes
    or new.idioma          is distinct from old.idioma
    or new.emitido_at      is distinct from old.emitido_at
    or new.emitido_por     is distinct from old.emitido_por
    or new.signant_equip   is distinct from old.signant_equip then
      raise exception 'Un albara emes no es pot modificar (%). Rectifica''l.',
        coalesce(old.numero_completo, old.id::text) using errcode = '42501';
    end if;
  end if;

  if new.estado is distinct from old.estado
     and not (
          (old.estado = 'borrador'   and new.estado in ('emitido', 'anulado'))
       or (old.estado = 'emitido'    and new.estado in ('entregado', 'anulado', 'rectificado'))
       or (old.estado = 'entregado'  and new.estado in ('confirmado', 'conciliado', 'anulado', 'rectificado'))
       or (old.estado = 'confirmado' and new.estado in ('conciliado', 'rectificado'))
       or (old.estado = 'conciliado' and new.estado = 'rectificado')) then
    raise exception 'Transicio d''estat no permesa en l''albara: % -> %', old.estado, new.estado
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

-- Función de trigger: sin EXECUTE para la API (auditoria_funcions_obertes).
revoke execute on function public.trg_albaranes_inmutable() from public, anon, authenticated;
