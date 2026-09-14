-- ---------------------------------------------------------------------------
-- reiniciar_documentos_prova(): acotar la limpieza a la serie PROVA
-- ---------------------------------------------------------------------------
-- Deudas §12.52 y §12.53.
--
-- QUÉ HACE ESTA MIGRACIÓN: el `delete` pasa de `where modo = 'prueba'` a secas a mirar
-- además la **serie**, y el `update` de contadores pasa de `PROVA` + todas las `P-*` a
-- las mismas series que el `delete`. Nada más cambia.
--
-- ⚠️ EMPECEMOS POR LO QUE **NO** ES, porque este fichero se escribió dos veces y la
-- primera versión arreglaba un problema que no existía. El diagnóstico de partida era que
-- el arnés (`scripts/comprobar-rls.ts` llama a esta RPC como `limpiar:` del check de
-- `emitir_documento_prova`, y corre contra la base real —§7: no hay base local—) se
-- estaba comiendo el fixture de `crear-datos-documentales-prueba.ts`, del que dependen
-- sus comprobaciones `requiereFixture`. **Es falso, y conviene que quede escrito:**
--
--   · `emitir_albaran()` inserta `modo` con el literal `'real'` (20261012100500:452). Los
--     albaranes del fixture NUNCA estuvieron en modo prueba, aunque sean de prueba.
--   · El fixture **calcula** el cierre de prueba (`abrir_cierre` + `calcular_cierre`) pero
--     no **emite** ni resúmenes ni certificados: `emitir_certificado*` se niega mientras
--     `parametros_documentales.datos_provisionales` sea `true`.
--   · Medido en producción el 14-09-2026: 15 filas en `documentos`, las 15 en
--     `modo = 'real'` (REC, ENT×4, OPE, PLA×2, CONV-DON-GEN) y ni una en modo prueba. O
--     sea que hoy este `delete` alcanza **cero filas**, con filtro y sin él.
--
-- QUÉ SÍ PUEDE DESTRUIR, que es lo que se arregla: **el ensayo de cierre de diciembre**.
-- Ese sí emite en modo prueba, con series propias `P-RES`, `P-CD`, `P-CT` y `P-CDP`, y su
-- limpieza tiene dueño: `reiniciar_cierre_prueba()` y `reiniciar_periodes_prova()`, que
-- borran por objeto y devuelven sus contadores a 0. Con el `like 'P-%'` de antes, una
-- pasada del arnés en mitad de un ensayo se llevaba por delante sus documentos y le
-- reseteaba las series a otro. Es literalmente lo que la deuda §12.52 pedía evitar: «no
-- debe ejecutarse a la vez que un ciclo de cierre de prueba en curso, o hay que acotar la
-- limpieza a la serie PROVA».
--
-- Y una segunda garantía, más dura: **un documento en modo prueba con una serie REAL ha
-- quemado un correlativo legal**, así que borrar su fila dejaría un hueco en esa serie —lo
-- único que el circuito documental existe para impedir (§4, «el número pertenece a la
-- fila»)—. Hoy ningún emisor produce ese caso; con el filtro, tampoco podría hacerle daño
-- si algún día lo produce.
--
-- POR QUÉ `delete` Y `update` TIENEN QUE DECIR LO MISMO, y esto no es estética: si el
-- `update` devolviera `P-RES` a 0 mientras sobreviven documentos `P-RES-2026-0001`, la
-- siguiente emisión chocaría con el índice único `(numero_completo, version)` de
-- `documentos`. Cualquier asimetría entre los dos es un error de numeración esperando su
-- turno. Por eso el criterio se escribe una vez, arriba, y se usa en los dos sitios.
--
-- ⚠️ POR QUÉ `P-CT` SIGUE DENTRO Y LAS OTRAS TRES NO. Cada serie de prueba necesita a
-- alguien que devuelva su contador a 0, y no todas lo tienen:
--
--   | Serie   | Borra sus documentos                        | Devuelve el contador a 0            |
--   |---------|---------------------------------------------|-------------------------------------|
--   | PROVA   | esta función                                | esta función                        |
--   | P-RES   | reiniciar_cierre_prueba()  (por objeto)     | reiniciar_cierre_prueba()  :1194    |
--   | P-CD    | reiniciar_cierre_prueba()  (por objeto)     | reiniciar_cierre_prueba()  :1194    |
--   | P-CDP   | reiniciar_periodes_prova() (por objeto)     | reiniciar_periodes_prova() :763     |
--   | P-CT    | reiniciar_cierre_prueba()  (por objeto)     | **NADIE**                           |
--
-- `reiniciar_cierre_prueba()` borra los documentos del CT —cuelgan de un `cierres_donante`
-- con `tipo = 'transaccio'`, así que entran por su `objeto_tipo = 'cierre_donante'`— pero
-- su reseteo solo nombra `serie in ('P-RES', 'P-CD')`: es de noviembre, anterior al CT.
-- O sea que hoy el único sitio del código que devuelve `P-CT` a 0 es el `like 'P-%'` que
-- esta migración estaría quitando. Dejar un contador sin forma de volver a 0 es peor que
-- el problema que se está arreglando, así que `P-CT` se queda dentro —con su documento y
-- su contador juntos, que es lo que evita la colisión de arriba— hasta que
-- `reiniciar_cierre_prueba()` lo adopte añadiéndolo a su `serie in (...)`. Ese día, y no
-- antes, este criterio puede quedarse en `'PROVA'` a secas.
--
-- LO QUE NO CAMBIA: la guarda de rol, el interruptor `redestina.reinicio_prueba` con
-- `is_local => true` (lo único que levanta la inmutabilidad de `documentos`, y que por ser
-- local no se puede dejar encendido), la condición `modo = 'prueba'` —que el trigger
-- `documentos_no_esborrar` exige de todos modos—, el `ejercicio` del reseteo, el valor de
-- retorno (filas borradas), `security definer`, el `search_path` y los EXECUTE.
--
-- ⚠️ `create or replace` reescribe TODOS los atributos de la función, así que hay que
--    repetir `volatile`, `security definer` y `set search_path`. Los privilegios sí los
--    conserva (la signatura no cambia y no se hace `drop`), pero se vuelven a declarar
--    igualmente para que el fichero se pueda leer solo, como en `20270304100200`.
-- ---------------------------------------------------------------------------

create or replace function public.reiniciar_documentos_prova()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ejercicio int;
  v_borrados  int;
  -- El criterio, escrito UNA vez: las series de prueba que esta función posee. Las demás
  -- `P-*` las limpia quien las emite (ver la tabla de la cabecera).
  v_series    text[] := array['PROVA', 'P-CT'];
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin pot reiniciar el cicle de proves'
      using errcode = '42501';
  end if;

  v_ejercicio := extract(year from (now() at time zone 'Europe/Madrid'))::int;

  perform set_config('redestina.reinicio_prueba', 'on', true);

  -- `documento_envios` cae por cascada.
  --
  -- Las DOS condiciones hacen falta y dicen cosas distintas: `modo = 'prueba'` es lo que
  -- el trigger `documentos_no_esborrar` exige para dejar borrar nada, y el filtro de
  -- serie es lo que impide tocar ni un documento de un ensayo de cierre en curso ni uno
  -- que haya consumido un número de una serie legal.
  delete from documentos
   where modo = 'prueba'
     and serie = any(v_series);
  get diagnostics v_borrados = row_count;

  -- Mismo conjunto de series que el `delete`: resetear el contador de una serie cuyos
  -- documentos sobreviven es fabricar una colisión de `numero_completo`.
  update series_documentales
     set ultimo = 0
   where ejercicio = v_ejercicio
     and serie = any(v_series);

  return v_borrados;
end;
$$;

comment on function public.reiniciar_documentos_prova() is
  'Reinicia el ciclo de pruebas: borra los documentos en modo prueba de las series PROVA y P-CT y devuelve sus contadores del ejercicio a 0. No toca el ensayo de cierre (P-RES/P-CD/P-CDP, que limpian sus propias RPC) ni ninguna serie legal.';

revoke execute on function public.reiniciar_documentos_prova() from public, anon;
grant  execute on function public.reiniciar_documentos_prova() to authenticated, service_role;

-- Verificación (con la service key o una sesión de super_admin):
--   -- 1. Punto de partida: hoy no hay NINGÚN documento en modo prueba, así que el
--   --    cambio no borra ni deja de borrar nada todavía. Tiene que devolver 0 filas.
--   select id, tipo, serie, numero_completo from documentos where modo = 'prueba';
--
--   -- 2. El ciclo del arnés sigue entero: emite, borra su documento y deja PROVA a 0.
--   select public.emitir_documento_prova();                                  -- uuid
--   select numero_completo, serie, modo from documentos where serie = 'PROVA';
--   select public.reiniciar_documentos_prova();                              -- 1
--   select count(*) from documentos where serie = 'PROVA';                   -- 0
--   select serie, ultimo from series_documentales
--    where ejercicio = extract(year from (now() at time zone 'Europe/Madrid'))::int
--      and serie in ('PROVA', 'P-CT');                                       -- los dos 0
--
--   -- 3. Lo que esta migración protege: las series del ensayo de cierre NO se tocan.
--   --    Tras el paso 2, sus contadores tienen que valer lo que valían antes.
--   select serie, ultimo from series_documentales
--    where ejercicio = 2026 and serie in ('P-RES', 'P-CD', 'P-CDP');         -- sin cambios
--
--   -- 4. Y el fixture documental, que vive en series reales, sigue en pie.
--   select count(*) from documentos where modo = 'real';                     -- 15
--   select serie, ultimo from series_documentales where ejercicio = 2026
--     and serie in ('REC', 'ENT', 'OPE', 'PLA', 'CONV-DON-GEN');             -- 1, 4, 1, 2, 1
