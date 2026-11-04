-- El borrado de una ficha también se niega si tiene OFERTAS (04-11-2026, decisión de Carles).
--
-- Hasta hoy `borrar_ficha_completa()` (20270328100100) solo se negaba por lo fiscal —documentos
-- emitidos, albaranes fuera de borrador, cierres, líneas de cierre, convenios y planes con
-- número— y arrastraba en cascada todo lo operativo, ofertas incluidas. Desde esta migración las
-- ofertas son un motivo de bloqueo más, con su código:
--
--   · `ofertes`          — el productor tiene alguna oferta (`excedentes`), en cualquier estado;
--   · `ofertes_rebudes`  — la entidad ha participado en alguna oferta: una respuesta
--                          (`oferta_respuestas`) o una canalización.
--
-- Con doble rol, el de la hermana llega con el sufijo `@germana`, como los demás. Lo que se hace
-- con una entidad que ha operado es desactivarla (`desactivar_fitxa` / `desactivar_organitzacio`),
-- que es lo que la ficha del equipo propone en su lugar; el borrado se queda para lo que se dio
-- de alta por error y nunca operó.
--
-- QUÉ CAMBIA Y QUÉ NO:
--   · `bloqueigs_esborrat_fitxa()` — misma firma y mismas columnas; dos motivos nuevos.
--   · `borrar_ficha_completa()`    — misma firma; los motivos los lee de la función de arriba
--     (no cambia la lógica), solo se reescribe para que la pista (`hint`) nombre las ofertas y
--     proponga desactivar.
--   · `borrar_una_fitxa()` NO se toca: sigue sabiendo borrar ofertas, aunque la puerta ya no le
--     deje llegar con ninguna. Quitarle ese código sería quitarle la red si algún día se decide
--     otra cosa.
--
-- COMPATIBLE HACIA ATRÁS con el frontend publicado: el error sigue siendo
-- `22023 bloqueig_esborrat: <codis>`; la pantalla vieja pinta los códigos nuevos con su clave
-- sin traducir hasta que se publica la nueva, que los traduce y propone desactivar.

-- ---------------------------------------------------------------------------
-- 1. Qué bloquea el borrado — con las ofertas
-- ---------------------------------------------------------------------------
create or replace function public.bloqueigs_esborrat_fitxa(
  p_tipo  text,
  p_ficha uuid
) returns table (codi text, n bigint, detall text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
    select id from excedentes where v_prod is not null and productor_id = v_prod
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
      from (select id from cie union all select id from cip) t
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
  )
  select m.codi, m.n, m.detall from motius m where m.n > 0;
end;
$$;


comment on function public.bloqueigs_esborrat_fitxa(text, uuid) is
  'Qué impide borrar una ficha: ofertas (ofertes, ofertes_rebudes), albaranes no-borrador, '
  'cierres, líneas de cierre, convenios o planes con número y documentos emitidos. Cero filas '
  '= se puede borrar. Solo el equipo.';

revoke execute on function public.bloqueigs_esborrat_fitxa(text, uuid) from public, anon;
grant  execute on function public.bloqueigs_esborrat_fitxa(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. La puerta: la misma, con la pista nueva
-- ---------------------------------------------------------------------------
-- Errores, sin cambios salvo la lista de códigos de `bloqueig_esborrat`:
--   `ofertes` · `ofertes_rebudes` · `albarans` · `tancaments` · `linies_tancament` ·
--   `convenis` · `plans` · `documents`, y cada uno con `@germana` si lo aporta la hermana.
create or replace function public.borrar_ficha_completa(
  p_tipo          text,
  p_ficha_id      uuid,
  p_tambe_germana boolean default false
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo_germana text := case when p_tipo = 'productor' then 'entidad' else 'productor' end;
  v_org          uuid;
  v_germana      uuid;
  v_codis        text[] := '{}';
  v_detalls      text[] := '{}';
  b              record;
  v_res          jsonb;
  v_res_germana  jsonb := null;
  v_fitxers      jsonb;
begin
  -- 👈 EL PERMISO. Ver la advertencia de la cabecera antes de relajarlo a `pot_aprovar()`.
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'no_autoritzat: nomes un super_admin pot esborrar una fitxa'
      using errcode = '42501';
  end if;

  if p_tipo not in ('productor', 'entidad') then
    raise exception 'tipus_desconegut: % (ha de ser productor o entidad)', p_tipo
      using errcode = '22023';
  end if;

  -- La ficha, y su organización. `for update` sobre la fila: dos borrados simultáneos de
  -- la misma organización se serializan en vez de comprobar los dos bloqueos sobre el
  -- mismo estado y borrar los dos la organización.
  if p_tipo = 'productor' then
    select organizacion_id into v_org from productores where id = p_ficha_id for update;
  else
    select organizacion_id into v_org from entidades where id = p_ficha_id for update;
  end if;

  if not found then
    raise exception 'fitxa_no_trobada: no hi ha cap % amb id %', p_tipo, p_ficha_id
      using errcode = '22023';
  end if;

  -- La hermana del doble rol: la otra ficha de la MISMA organización. El índice único
  -- parcial de `20270310100000` garantiza que hay como mucho una de cada tipo, así que
  -- esto no puede devolver dos.
  if p_tambe_germana and v_org is not null then
    if v_tipo_germana = 'entidad' then
      select id into v_germana from entidades where organizacion_id = v_org for update;
    else
      select id into v_germana from productores where organizacion_id = v_org for update;
    end if;
  end if;

  -- PASO 1 — los bloqueos, de las DOS fichas, antes de tocar nada. Todo o nada: si
  -- cualquiera de las dos tiene ofertas o documentación emitida, no se borra ninguna. Se acumulan
  -- todos los motivos en vez de parar en el primero, porque enterarse de uno, arreglarlo
  -- y estrellarse con el siguiente es el peor recorrido posible.
  for b in select * from public.bloqueigs_esborrat_fitxa(p_tipo, p_ficha_id) loop
    v_codis   := v_codis   || b.codi;
    v_detalls := v_detalls || b.detall;
  end loop;

  if v_germana is not null then
    for b in select * from public.bloqueigs_esborrat_fitxa(v_tipo_germana, v_germana) loop
      v_codis   := v_codis   || (b.codi || '@germana');
      v_detalls := v_detalls || ('Fitxa germana: ' || b.detall);
    end loop;
  end if;

  if array_length(v_codis, 1) > 0 then
    raise exception 'bloqueig_esborrat: %', array_to_string(v_codis, ',')
      using errcode = '22023',
            detail  = array_to_string(v_detalls, '. '),
            hint    = 'Una fitxa amb ofertes, documentacio emesa, albarans o tancaments no '
                      's''esborra: es conserva la seva historia. Desactiva-la (desactivar_fitxa '
                      'o desactivar_organitzacio).';
  end if;

  -- PASO 2-4 — el borrado. En esta transacción y en este orden: primero la hermana,
  -- después la ficha pedida. El orden importa para la organización: la retira quien borre
  -- la ÚLTIMA ficha, así que dejar la pedida para el final hace que el resultado principal
  -- sea el que lleva `organitzacio_retirada`.
  if v_germana is not null then
    v_res_germana := public.borrar_una_fitxa(v_tipo_germana, v_germana);
  end if;

  v_res := public.borrar_una_fitxa(p_tipo, p_ficha_id);

  -- Los ficheros huérfanos de las dos, juntos: quien llame solo tiene que mirar un sitio.
  v_fitxers := coalesce(v_res -> 'fitxers_orfes', '[]'::jsonb)
             || coalesce(v_res_germana -> 'fitxers_orfes', '[]'::jsonb);

  return jsonb_build_object(
    'ok',                    true,
    'borrada',               v_res,
    'germana_borrada',       v_res_germana is not null,
    'germana',               v_res_germana,
    'organitzacio_retirada', coalesce((v_res ->> 'organitzacio_retirada')::boolean, false),
    'fitxers_orfes',         v_fitxers
  );
end;
$$;


comment on function public.borrar_ficha_completa(text, uuid, boolean) is
  'EL camino de borrado de una ficha (deuda §12.108). Se niega con el motivo si hay ofertas, '
  'documentos, albaranes o cierres (desde 20270508100000 también las ofertas); si no, arrastra '
  'lo operativo, borra la ficha y retira la organización si queda vacía. Con p_tambe_germana, '
  'las dos fichas del doble rol en la MISMA transacción. Solo super_admin (o service_role).';

revoke execute on function public.borrar_ficha_completa(text, uuid, boolean) from public, anon;
grant  execute on function public.borrar_ficha_completa(text, uuid, boolean) to authenticated, service_role;
