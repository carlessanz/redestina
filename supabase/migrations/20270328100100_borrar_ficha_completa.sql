-- Un único camino de borrado de una ficha (deuda §12.108).
--
-- LA REGLA, que ya está escrita en AGENTS §7 y aquí solo se aplica: «BORRAR UNA FICHA ES
-- BORRAR TODO LO SUYO, Y NUNCA DEJAR HUÉRFANOS». Cascada significa arrastrar lo
-- **operativo** (ofertas, respuestas, canalizaciones, ubicaciones, sesiones de intake,
-- convenios, membresías, planes), nunca lo **fiscal**. Y la excepción no negociable: los
-- documentos emitidos, los albaranes y los cierres **no se borran jamás**, así que una
-- ficha que tenga alguno **se niega a borrarse, con el motivo**. Todo o nada.
--
-- QUÉ HABÍA ANTES, y por qué esto no es una mejora cosmética. `RecordDetail.tsx` hacía un
-- `.delete()` a pelo sobre `productores` o `entidades`, y el resultado dependía de cómo
-- estuviera declarada cada una de las 18 claves foráneas que apuntan a esas dos tablas —
-- medido el 16-09-2026 contra producción:
--
--   · 6 `CASCADE`   (`convenios`, `membresias`, `planes_prevencion` ×2 tablas) se iban con
--     la ficha **incluso con un documento fiscal emitido detrás**, dejando ese documento
--     apuntando a una fila que ya no existe;
--   · 9 `NO ACTION` (`excedentes`, `canalizaciones`, `espigoladas`, `cierres_donante`,
--     `cierres_periodo`, `intake_sessions`, `productor_ubicaciones` y `organizaciones`
--     desde las dos fichas) rechazaban el borrado con un `23503` crudo de Postgres en
--     pantalla, sin distinguir «esto es fiscal y no se puede borrar nunca» de «esto es
--     operativo y debería arrastrarse»;
--   · 3 `SET NULL`  (`oferta_respuestas.entidad_id`, `cierre_donante_lineas.entidad_id`,
--     `cierre_periodo_lineas.entidad_id`) **dejaban pasar el borrado** y las filas
--     apuntando a nadie — en las líneas de cierre eso es evidencia fiscal huérfana.
--
-- Lo peor no era ninguno de los tres por separado: era que fueran tres y que la diferencia
-- la decidiera qué tuviera la ficha detrás. Borrar una entidad cuyo único rastro fueran
-- respuestas a ofertas **funcionaba** y dejaba esas respuestas sin entidad; borrar una que
-- además tuviera una canalización **fallaba**; y las dos cosas salían del mismo botón.
--
-- ⚠️ LAS CLAVES FORÁNEAS NO SE TOCAN, Y ES DELIBERADO. La tentación es «poner CASCADE en
--    todo», y sería exactamente lo contrario de lo que pide la regla: con CASCADE, borrar
--    una ficha se llevaría por delante cierres y líneas de cierre, que es la evidencia
--    fiscal que el circuito documental existe para conservar. Las `NO ACTION` se quedan
--    como están y pasan a ser la **última red**: si algún día esta función se dejara un
--    camino sin cubrir, la base rechaza el borrado en vez de dejar un hueco. Lo que
--    cambia es que ahora hay **una** puerta, que comprueba antes y explica el motivo.
--
-- ⚠️ LO QUE SÍ ES FISCAL LO DECIDE LA BASE, NO ESTA FUNCIÓN. Los tres triggers que ya
--    existen dicen exactamente lo mismo que el paso 1 de aquí:
--      · `documentos_no_esborrar`   — un documento no se borra nunca (salvo el reinicio de
--                                     prueba, que solo fija `reiniciar_documentos_prova()`)
--      · `albaranes_no_esborrar`    — solo se borra un albarán en `borrador`
--      · `convenios_no_esborrar` / `planes_no_esborrar` — solo sin `numero_completo`
--    Así que el criterio de «esto bloquea» no se inventa aquí: es **el mismo** que ya
--    impone la base, escrito por delante para poder decir el motivo en vez de estrellarse
--    contra un trigger a mitad de la cascada.
--
-- 🔴 EL PERMISO: `es_super_admin()`, NO `pot_aprovar()`. Es una divergencia consciente de
--    la petición inicial, y este es el motivo: borrar una ficha **hoy ya exige
--    super_admin** —lo imponen las políticas `productores: baixa super_admin` y
--    `entidades: baixa super_admin` de `20260730095000`, y AGENTS §4bis lo dice con esas
--    palabras («solo el super_admin puede apagar el modo test o borrar fichas»)—. Como
--    esta función es `security definer`, esas políticas **no se evalúan dentro**: la guarda
--    de aquí es la única que queda, así que ponerla en `pot_aprovar()` no sería «elegir un
--    rol», sería **ampliar en silencio** a los `admin` un privilegio destructivo que hoy no
--    tienen, y hacerlo en el mismo cambio que quita el `23503` que los frenaba. Si la
--    Fundació decide que un `admin` debe poder borrar, es cambiar `es_super_admin()` por
--    `pot_aprovar()` en la línea marcada 👈 y actualizar AGENTS §4bis en el mismo commit.
--
-- ⚠️ `auth.uid() is not null and not …` (§4bis): con `es_super_admin()` a secas,
--    `service_role` —que no tiene sesión— se quedaría fuera de su propia función, y una
--    limpieza manual o una Edge Function recibiría un `42501` que parecería un problema de
--    permisos de datos sin serlo. El mismo fallo que ya costó `datos_182` y
--    `actualizar_meu_canal`.
--
-- LO QUE ESTA FUNCIÓN **NO** PUEDE HACER, y por eso lo devuelve en vez de callárselo:
-- borrar objetos de **Storage**. Un albarán en borrador puede tener adjuntos en
-- `documentos_externos` (el albarán del productor, una foto), y sus filas sí se van; los
-- ficheros del bucket no, porque SQL no habla con Storage. Sus rutas salen en
-- `fitxers_orfes` del resultado, para que quien llame pueda retirarlos (es la misma
-- división de trabajo que `reiniciar_documentos_prova()` + `limpiar-documentos-prueba`).
--
-- LO QUE SE QUEDA FUERA A PROPÓSITO, y no por olvido:
--   · **`wa_contacts` / `wa_messages`**. No tienen FK a la ficha —solo comparten el
--     teléfono (§4 «Integridad»)— así que un contacto sin ficha no es un huérfano de
--     clave foránea, es el estado normal de cualquiera que escriba sin estar fichado, y
--     AGENTS §6 lo da por bueno explícitamente. Borrar el hilo entero de WhatsApp al
--     retirar una ficha destruiría la conversación que documenta por qué se retiró, y eso
--     se hace desde la papelera de Mensajería, que ya existe y es una decisión aparte.
--   · **`email_test_recipients`**. Sigue sin FK y sigue siendo disciplina manual (deuda
--     §12.33): una regla automática de «borra lo que no tenga ficha» se llevaría por
--     delante `tecnologia@espigoladors.com`, que es el correo propietario de la cuenta de
--     Resend y está ahí a propósito. Cerrar esa deuda es otro cambio.

-- ---------------------------------------------------------------------------
-- 1. Qué bloquea el borrado de una ficha — consultable por separado
-- ---------------------------------------------------------------------------
-- Existe aparte de la RPC de borrado por lo mismo que `comprovaConvenis()` (deuda §12.78):
-- el panel tiene que poder **preguntar antes** y explicar por qué el botón no va a
-- funcionar, en vez de enterarse con un error a mitad de operación. La autoridad sigue
-- siendo `borrar_ficha_completa()`, que la vuelve a llamar dentro de su transacción.
--
-- Devuelve una fila por motivo, y ninguna cuando la ficha se puede borrar. `codi` es lo
-- que la interfaz traduce; `detall` es el texto ya legible por si no lo tiene traducido.
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
    -- (a) Albaranes que ya no son borrador. El umbral es exactamente el de
    --     `albaranes_no_esborrar`: un borrador no tiene número y no documenta nada, así
    --     que se arrastra; cualquier otro estado es un hecho con número de serie.
    --     ⚠️ No vale bloquear con «tiene algún albarán» a secas: el trigger
    --     `canalizaciones_crea_albaranes` crea uno en borrador con CADA canalización, así
    --     que eso haría indeleble cualquier ficha que haya canalizado una vez.
    select 'albarans' as codi,
           count(*)   as n,
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
  'Qué impide borrar una ficha: albaranes no-borrador, cierres, líneas de cierre, convenios '
  'o planes con número y documentos emitidos. Cero filas = se puede borrar. Solo el equipo.';

revoke execute on function public.bloqueigs_esborrat_fitxa(text, uuid) from public, anon;
grant  execute on function public.bloqueigs_esborrat_fitxa(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. El borrado de UNA ficha — interno, sin guarda propia
-- ---------------------------------------------------------------------------
-- Es la mitad que se repite cuando hay doble rol, escrita una sola vez: la ficha hermana
-- se borra con esta misma función, dentro de la MISMA transacción. Eso es justamente lo
-- que hoy falla en el panel, que hace dos `.delete()` sueltos y, si el segundo revienta,
-- deja media organización borrada — «media organización borrada es peor que ninguna» (§7).
--
-- ⚠️ NO COMPRUEBA PERMISO NI BLOQUEOS: los comprueba quien la llama, **para las dos fichas
--    a la vez**, antes de tocar nada. Por eso no la puede ejecutar nadie desde PostgREST.
create or replace function public.borrar_una_fitxa(
  p_tipo  text,
  p_ficha uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod    uuid := case when p_tipo = 'productor' then p_ficha end;
  v_ent     uuid := case when p_tipo = 'entidad'   then p_ficha end;
  v_org     uuid;
  v_nom     text;
  v_tel     text;
  v_albs    uuid[];
  v_convs   uuid[];
  v_fitxers text[];
  v_org_fora boolean := false;
  v_n       jsonb := '{}'::jsonb;
  c         int;
begin
  if p_tipo = 'productor' then
    select p.organizacion_id, coalesce(nullif(p.empresa, ''), p.name), p.phone
      into v_org, v_nom, v_tel
      from productores p where p.id = p_ficha;
  else
    select e.organizacion_id, e.nombre, e.telefono
      into v_org, v_nom, v_tel
      from entidades e where e.id = p_ficha;
  end if;

  -- `found` y no «el nombre es null»: una ficha puede tener el nombre vacío, pero si el
  -- `select` no ha traído fila es que no existe.
  if not found then
    raise exception 'fitxa_no_trobada: no hi ha cap % amb id %', p_tipo, p_ficha
      using errcode = '22023';
  end if;

  -- Los albaranes de esta ficha (todos en borrador: el paso 1 de la RPC ya lo garantizó).
  select coalesce(array_agg(a.id), '{}'::uuid[])
    into v_albs
    from albaranes a
   where a.excedente_id in (select id from excedentes where v_prod is not null and productor_id = v_prod)
      or a.espigolada_id in (select id from espigoladas where v_prod is not null and productor_id = v_prod)
      or a.canalizacion_id in (
           select c2.id from canalizaciones c2
            where (v_ent is not null and c2.entidad_id = v_ent)
               or (v_prod is not null and c2.excedente_id in
                     (select id from excedentes where productor_id = v_prod)));

  select coalesce(array_agg(c2.id), '{}'::uuid[])
    into v_convs
    from convenios c2
   where (v_prod is not null and c2.productor_id = v_prod)
      or (v_ent  is not null and c2.entidad_id   = v_ent);

  -- Los ficheros que quedarán sin dueño en Storage. Se anotan ANTES de borrar la fila,
  -- que es la única oportunidad de saber su ruta.
  select coalesce(array_agg(de.ruta), '{}'::text[])
    into v_fitxers
    from documentos_externos de
   where de.objeto_tipo = 'albaran' and de.objeto_id = any(v_albs);

  -- (1) Lo que cuelga de los albaranes en borrador. `documentos_externos` y
  --     `enlaces_token` son POLIMÓRFICAS y no tienen FK, así que nadie las arrastraría:
  --     son exactamente el tipo de huérfano que la regla de §7 prohíbe.
  delete from documentos_externos where objeto_tipo = 'albaran' and objeto_id = any(v_albs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('documents_externs', c);

  delete from enlaces_token where objeto_tipo = 'albaran' and objeto_id = any(v_albs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('enllacos_albara', c);

  -- (2) Los albaranes en borrador. `albaran_lineas` va en cascada; `albaranes_no_esborrar`
  --     es la red: si aquí se colara uno con número, aborta la transacción entera.
  delete from albaranes where id = any(v_albs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('albarans_esborrany', c);

  if p_tipo = 'productor' then
    -- (3) Las sesiones de intake ANTES que los excedentes: `intake_sessions.excedente_id`
    --     es `NO ACTION` y rechazaría el borrado del excedente.
    delete from intake_sessions s
     where s.productor_id = v_prod
        or s.excedente_id in (select id from excedentes where productor_id = v_prod)
        -- Por teléfono, con las últimas 9 cifras (§7: los móviles se guardan con y sin
        -- prefijo). ⚠️ El `length(...) >= 9` NO es decoración: sin él, una ficha con un
        -- teléfono a medias («612») compararía sus 3 cifras contra el final de CUALQUIER
        -- número y se llevaría por delante la sesión de intake de otro productor.
        or (s.telefono is not null
            and length(regexp_replace(coalesce(v_tel, ''), '\D', '', 'g')) >= 9
            and right(regexp_replace(s.telefono, '\D', '', 'g'), 9)
              = right(regexp_replace(v_tel, '\D', '', 'g'), 9));
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('sessions_intake', c);

    -- (4) Las respuestas a sus ofertas. Caerían solas por la CASCADE de
    --     `oferta_respuestas.excedente_id`, pero se borran explícitamente para poder
    --     contarlas: un borrado que no dice cuánto se llevó no es auditable.
    delete from oferta_respuestas
     where excedente_id in (select id from excedentes where productor_id = v_prod);
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('respostes', c);

    -- (5) Las canalizaciones de sus ofertas. ⚠️ Aquí se pierde el reparto de esas ofertas
    --     tal como lo vio la entidad receptora; es operativo y va con la ficha, pero
    --     conviene saber que el receptor deja de ver esas entregas en su histórico.
    delete from canalizaciones
     where excedente_id in (select id from excedentes where productor_id = v_prod);
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('canalitzacions', c);

    delete from excedentes where productor_id = v_prod;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('ofertes', c);

    -- (6) Las jornadas de espigueo, ya sin registros ni REC.
    delete from espigoladas where productor_id = v_prod;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('espigolades', c);

    -- (7) Las fincas. Después de excedentes y espigoladas, que las referencian.
    delete from productor_ubicaciones where productor_id = v_prod;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('ubicacions', c);
  else
    delete from oferta_respuestas where entidad_id = v_ent;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('respostes', c);

    delete from canalizaciones where entidad_id = v_ent;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('canalitzacions', c);
  end if;

  -- (8) Los enlaces de firma de sus convenios. Los convenios se van en CASCADE con la
  --     ficha, pero sus enlaces son polimórficos y se quedarían señalando a la nada.
  --     `evidencias` cae en cascada desde el enlace.
  delete from enlaces_token where objeto_tipo = 'convenio' and objeto_id = any(v_convs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('enllacos_conveni', c);

  -- (9) La ficha. Arrastra en CASCADE `convenios` (sin número), `membresias` —o sea que
  --     las cuentas de esa organización se quedan sin panel, que es lo que el panel avisa
  --     antes de preguntar— y `planes_prevencion` (sin número).
  if p_tipo = 'productor' then
    delete from productores where id = v_prod;
  else
    delete from entidades where id = v_ent;
  end if;
  get diagnostics c = row_count;
  if c = 0 then
    raise exception 'fitxa_no_trobada: no hi ha cap % amb id %', p_tipo, p_ficha
      using errcode = '22023';
  end if;

  -- (10) La organización, si se ha quedado sin ninguna ficha. Es el paso que hasta hoy se
  --      hacía «a mano» después de cada purga —las dos del 16-09-2026 tuvieron que
  --      retirarlas en un paso aparte— y el que convierte el borrado en completo: una
  --      organización sin fichas no la ve nadie y no la limpia nadie.
  if v_org is not null
     and not exists (select 1 from productores where organizacion_id = v_org)
     and not exists (select 1 from entidades   where organizacion_id = v_org)
     -- Un convenio que siguiera colgando de la organización la retiene: antes que borrar
     -- un documento de colaboración por el camino, se deja la organización y se dice.
     and not exists (select 1 from convenios   where organizacion_id = v_org) then
    delete from organizaciones where id = v_org;
    v_org_fora := true;
  end if;

  return jsonb_build_object(
    'tipus',                 p_tipo,
    'id',                    p_ficha,
    'nom',                   v_nom,
    'organizacion_id',       v_org,
    'organitzacio_retirada', v_org_fora,
    'esborrat',              v_n,
    'fitxers_orfes',         to_jsonb(coalesce(v_fitxers, '{}'::text[]))
  );
end;
$$;

comment on function public.borrar_una_fitxa(text, uuid) is
  'INTERNA: borra una ficha y todo lo operativo suyo. No comprueba permiso ni bloqueos — lo '
  'hace borrar_ficha_completa() para las dos fichas a la vez, antes de tocar nada.';

-- Nadie la llama desde fuera: la superficie pública es `borrar_ficha_completa()`. El
-- `revoke` de `authenticated` no impide que la llame la RPC de abajo, que corre como su
-- propietario.
revoke execute on function public.borrar_una_fitxa(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. La puerta: `borrar_ficha_completa()`
-- ---------------------------------------------------------------------------
-- LA FIRMA Y LOS ERRORES (lo que el panel tiene que distinguir):
--
--   borrar_ficha_completa(p_tipo text, p_ficha_id uuid, p_tambe_germana boolean = false)
--     → jsonb { ok, borrada:{…}, germana_borrada:bool, germana:{…}|null, fitxers_orfes:[…] }
--
--   42501  `no_autoritzat: …`   — no es super_admin (ni `service_role`)
--   22023  `tipus_desconegut: …`
--   22023  `fitxa_no_trobada: …`
--   22023  `bloqueig_esborrat: <codis>` — la ficha (o su hermana) tiene documentación que
--          no se borra jamás. Los códigos van en el MESSAGE separados por comas y el texto
--          legible en DETAIL, que PostgREST devuelve como `details`. Códigos posibles:
--          `albarans` · `tancaments` · `linies_tancament` · `convenis` · `plans` ·
--          `documents`, y cuando el bloqueo lo aporta la ficha hermana, el mismo código
--          con el sufijo `@germana`.
--
-- Se eligió `22023` y no `42501` a propósito: no es una cuestión de permisos —el
-- super_admin tiene todos— sino un estado de la ficha que hace imposible la operación, que
-- es lo que ese SQLSTATE significa en el resto del circuito (§ códigos de 20270111100100).
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
  -- cualquiera de las dos tiene documentación emitida, no se borra ninguna. Se acumulan
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
            hint    = 'Una fitxa amb documentacio emesa, albarans o tancaments no s''esborra: '
                      'la documentacio legal no te marxa enrere. Desactiva-la si cal.';
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
  'EL camino de borrado de una ficha (deuda §12.108). Se niega con el motivo si hay '
  'documentos, albaranes o cierres; si no, arrastra lo operativo, borra la ficha y retira '
  'la organización si queda vacía. Con p_tambe_germana, las dos fichas del doble rol en la '
  'MISMA transacción. Solo super_admin (o service_role).';

revoke execute on function public.borrar_ficha_completa(text, uuid, boolean) from public, anon;
grant  execute on function public.borrar_ficha_completa(text, uuid, boolean) to authenticated, service_role;

-- Verificación (en una transacción con rollback, contra una ficha TEST-*):
--   select * from bloqueigs_esborrat_fitxa('productor', '<id>');   -- 0 filas = se puede
--   begin;
--     select borrar_ficha_completa('productor', '<id>', true);
--   rollback;
-- Y la guarda, desde una sesión que no sea super_admin:
--   select borrar_ficha_completa('productor', '<id>');   -- 42501 no_autoritzat
