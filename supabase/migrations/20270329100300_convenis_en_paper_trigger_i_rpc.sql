-- Continúa `20270329100100_convenis_en_paper_columnes.sql`, donde está el porqué
-- entero de esta funcionalidad. Se aplicó por separado, así que va en su propio
-- fichero: el historial remoto y los ficheros locales tienen que casar 1:1 (§7).

-- ---------------------------------------------------------------------------
-- 3. Una transición más, y solo una
-- ---------------------------------------------------------------------------
-- `trg_convenios_control()` se recrea ENTERA a partir de 20270111100000:246-308. Lo único
-- que cambia son dos cosas:
--
--   a) `esborrany → vigent`, **solo si `origen = 'paper'`**. Un convenio de papel no pasa
--      por `pendent_firma` ni por `firmat` porque esos dos estados significan «hay un
--      enlace vivo» y «alguien ha firmado aquí», y ninguna de las dos cosas es cierta.
--      Fingir el recorrido dejaría un rastro de estados que nunca ocurrieron.
--   b) `origen` y `referencia_paper` entran en la lista congelada: un convenio ya firmado
--      no puede cambiar de procedencia, que es precisamente el dato que explica por qué no
--      tiene número.
create or replace function trg_convenios_control()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text;
begin
  -- Vocabulario de `roles_com`, aquí y no en un check, para poder decir cuál falla.
  if new.roles_com is not null then
    foreach v_rol in array new.roles_com loop
      if v_rol not in ('venedora', 'compradora', 'obrador') then
        raise exception 'Rol de compravenda desconegut: % (venedora | compradora | obrador)', v_rol
          using errcode = '22023';
      end if;
    end loop;
  end if;
  if new.tipo <> 'com' and coalesce(array_length(new.roles_com, 1), 0) > 0 then
    raise exception 'Nomes el conveni de compravenda te rols (% no en pot tenir)', new.tipo
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- A partir de `firmat`, la identidad y el contenido están congelados.
  if old.estado in ('firmat', 'vigent', 'retornat', 'resolt', 'substituit') then
    if new.tipo             is distinct from old.tipo
    or new.tipo_org         is distinct from old.tipo_org
    or new.productor_id     is distinct from old.productor_id
    or new.entidad_id       is distinct from old.entidad_id
    or new.plantilla_id     is distinct from old.plantilla_id
    or new.idioma           is distinct from old.idioma
    or new.serie            is distinct from old.serie
    or new.ejercicio        is distinct from old.ejercicio
    or new.numero           is distinct from old.numero
    or new.numero_completo  is distinct from old.numero_completo
    or new.datos_org        is distinct from old.datos_org
    or new.firmante         is distinct from old.firmante
    or new.firmado_at       is distinct from old.firmado_at
    or new.roles_com        is distinct from old.roles_com
    or new.origen           is distinct from old.origen
    or new.referencia_paper is distinct from old.referencia_paper then
      raise exception 'Un conveni firmat no es pot modificar (%). Retorna''l o substitueix-lo.',
        coalesce(old.numero_completo, old.referencia_paper, old.id::text) using errcode = '42501';
    end if;
  end if;

  if new.estado is distinct from old.estado
     and not (
          (old.estado = 'esborrany'     and new.estado = 'pendent_firma')
       or (old.estado = 'esborrany'     and new.estado = 'vigent' and new.origen = 'paper')
       or (old.estado = 'pendent_firma' and new.estado in ('firmat', 'esborrany'))
       or (old.estado = 'firmat'        and new.estado in ('vigent', 'retornat'))
       or (old.estado = 'retornat'      and new.estado = 'pendent_firma')
       or (old.estado = 'vigent'        and new.estado in ('resolt', 'substituit'))) then
    raise exception 'Transicio d''estat no permesa en un conveni: % -> %', old.estado, new.estado
      using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. preparar_conveni_en_paper(): el borrador al que colgar el escaneado
-- ---------------------------------------------------------------------------
-- Hacen falta DOS llamadas y no una, y el orden es el que da la garantía: primero se crea
-- el borrador (para tener el `id` del que colgará el PDF), después se sube el escaneado, y
-- solo entonces se valida. Al revés, la RPC de validación tendría que creer una promesa.
--
-- ⚠️ NO se toca `preparar_convenio`. Es idempotente y devuelve cualquier convenio en marcha,
--    así que un parámetro `p_origen` suyo se ignoraría en silencio sobre un borrador que ya
--    existiera —y el convenio se quedaría como 'plataforma' sin que nada lo dijera—. Aquí
--    se reutiliza tal cual y se marca después, comprobando el estado.
create or replace function public.preparar_conveni_en_paper(
  p_tipo_org text,
  p_org      uuid,
  p_tipo     text
) returns convenios
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c convenios%rowtype;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin pot registrar un conveni signat en paper'
      using errcode = '42501';
  end if;

  -- `select * into` y no `c := ...`: la función devuelve el rowtype entero y así se
  -- expande columna a columna sin depender de la coerción de tipos compuestos.
  select * into c from public.preparar_convenio(p_tipo_org, p_org, p_tipo) as t;

  if c.estado <> 'esborrany' then
    raise exception 'ja_en_curs: aquesta organitzacio ja te un conveni % en estat %',
      p_tipo, c.estado using errcode = '22023';
  end if;

  update convenios set origen = 'paper' where id = c.id returning * into c;
  return c;
end;
$$;

comment on function public.preparar_conveni_en_paper(text, uuid, text) is
  'Borrador marcado como `paper`, al que colgar el escaneado antes de validarlo. Solo super_admin (20270329100100).';

-- ---------------------------------------------------------------------------
-- 5. registrar_conveni_en_paper(): y pasa a vigent
-- ---------------------------------------------------------------------------
-- Hace de una vez lo que en el circuito normal son dos actos distintos (firmar y
-- contrafirmar), porque aquí las dos cosas ya ocurrieron fuera y sobre el mismo papel.
-- `contrafirmado_por` guarda quién lo registró: es lo único que esta fila puede decir con
-- verdad sobre quién respondió de ello dentro de Redestina.
create or replace function public.registrar_conveni_en_paper(
  p_conveni         uuid,
  p_data_firma      date,
  p_referencia      text,
  p_signant_nom     text,
  p_signant_carrec  text default null,
  p_notes           text default null
) returns convenios
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c convenios%rowtype;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin pot registrar un conveni signat en paper'
      using errcode = '42501';
  end if;

  select * into c from convenios where id = p_conveni for update;
  if c.id is null then
    raise exception 'conveni_inexistent' using errcode = '22023';
  end if;
  if c.origen <> 'paper' then
    raise exception 'no_es_paper: aquest conveni es del circuit electronic' using errcode = '22023';
  end if;
  if c.estado <> 'esborrany' then
    raise exception 'ja_en_curs: el conveni ja esta en estat %', c.estado using errcode = '22023';
  end if;

  if coalesce(btrim(p_referencia), '') = '' then
    raise exception 'falta_referencia' using errcode = '22023';
  end if;
  if coalesce(btrim(p_signant_nom), '') = '' then
    raise exception 'falta_signant' using errcode = '22023';
  end if;
  if p_data_firma is null then
    raise exception 'falta_data' using errcode = '22023';
  end if;
  -- En hora de Madrid, como el resto del circuito: la sesión de PostgREST va en UTC y a
  -- primera hora de la tarde `current_date` ya sería el día siguiente.
  if p_data_firma > (now() at time zone 'Europe/Madrid')::date then
    raise exception 'data_futura' using errcode = '22023';
  end if;

  -- 🔴 El escaneado tiene que estar YA. Sin esta comprobación, «registrar el convenio en
  --    papel» sería declararlo vigente de palabra, y lo único que lo acredita es el papel.
  if not exists (select 1 from documentos_externos de
                  where de.objeto_tipo = 'convenio'
                    and de.objeto_id   = c.id
                    and de.tipo        = 'conveni_signat') then
    raise exception 'falta_escanejat: puja el conveni signat abans de registrar-lo'
      using errcode = '22023';
  end if;

  -- El vigente anterior de la misma organización y el mismo modelo cede el sitio. Va ANTES
  -- del update de abajo: `convenios_vigent_per_organitzacio_uidx` no admite dos vigentes
  -- del mismo tipo, y si se hiciera al revés el fallo sería un error de unicidad que no
  -- explicaría nada.
  update convenios
     set estado = 'substituit', sustituido_por = c.id
   where estado = 'vigent' and tipo = c.tipo and id <> c.id
     and coalesce(productor_id, entidad_id) = coalesce(c.productor_id, c.entidad_id);

  update convenios
     set estado            = 'vigent',
         origen            = 'paper',
         referencia_paper  = btrim(p_referencia),
         datos_org         = public.convenio_datos_org(c.id),
         firmante          = jsonb_strip_nulls(jsonb_build_object(
                               'nombre', btrim(p_signant_nom),
                               'cargo',  nullif(btrim(p_signant_carrec), ''),
                               'notes',  nullif(btrim(p_notes), ''))),
         firmado_at        = p_data_firma::timestamptz,
         contrafirmado_at  = now(),
         contrafirmado_por = auth.uid()
   where id = c.id
  returning * into c;

  return c;
end;
$$;

comment on function public.registrar_conveni_en_paper(uuid, date, text, text, text, text) is
  'Da por vigente un convenio firmado fuera de la plataforma. Exige el escaneado ya subido. Solo super_admin (20270329100100).';

-- ---------------------------------------------------------------------------
-- 6. GRANT
-- ---------------------------------------------------------------------------
-- `service_role` NO entra: no hay ningún job ni Edge Function que declare convenios
-- vigentes, y las dos guardas de arriba lo dejarían pasar (`auth.uid() is null`). Con el
-- EXECUTE fuera, esa puerta ni siquiera se abre. La escritura sigue siendo solo por RPC:
-- `convenios` no tiene GRANT de insert/update para nadie (20270322100100).
revoke execute on function public.preparar_conveni_en_paper(text, uuid, text)
  from public, anon, service_role;
grant  execute on function public.preparar_conveni_en_paper(text, uuid, text)
  to authenticated;

revoke execute on function public.registrar_conveni_en_paper(uuid, date, text, text, text, text)
  from public, anon, service_role;
grant  execute on function public.registrar_conveni_en_paper(uuid, date, text, text, text, text)
  to authenticated;

-- Verificación:
--   -- un convenio de papel vigente no gasta serie:
--   select serie, ejercicio, numero_completo, referencia_paper, origen
--     from convenios where origen = 'paper';        -- serie/numero NULL, referencia puesta
--   -- y desbloquea operar, por el camino de siempre:
--   select public.convenio_vigente('entidad', '<id>', 'donacio', 'recibe');   -- t
--   select has_function_privilege('service_role',
--            'public.registrar_conveni_en_paper(uuid,date,text,text,text,text)', 'EXECUTE');  -- f
