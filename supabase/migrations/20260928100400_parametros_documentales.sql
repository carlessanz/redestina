-- `parametros_documentales`: los datos de Espigoladors y las reglas del circuito.
--
-- QUÉ ES. La fila única de la que salen (a) los datos que encabezan **todos** los
-- documentos —razón social, CIF, domicilio, inscripción registral, apoderada que
-- firma— y (b) los plazos y umbrales que gobiernan el circuito: cuánto dura un enlace,
-- cuánto se espera una confirmación, qué diferencia de kilos se considera dentro de
-- tolerancia, cuándo se abre el cierre anual.
--
-- POR QUÉ UNA FILA ÚNICA Y NO `app_settings`. `app_settings` es clave/valor de texto y
-- está bien para un interruptor (`test_mode`), pero aquí hacen falta **tipos**: una
-- fecha de corte que sea `date`, una tolerancia que sea `numeric` y unos plazos que sean
-- `int`. Con clave/valor, un `'2%'` mal escrito no lo detecta nadie hasta que una
-- conciliación decide mal. `id int primary key check (id = 1)` es la forma más simple de
-- decir «esta tabla tiene exactamente una fila» sin triggers.
--
-- POR QUÉ NO ESTÁ EN EL CÓDIGO. Los datos de la Fundación cambian (un cambio de
-- domicilio social, una apoderada nueva) y los umbrales los decide el equipo, no quien
-- programa. Y sobre todo: **un documento emitido no debe cambiar porque estos cambien**.
-- No cambia, porque cada documento se lleva su copia en `documentos.datos` (§A: el
-- snapshot congelado). Esta tabla dice lo que vale HOY, no lo que valía.
--
-- ⚠️ `apoderada_dni` es dato personal y **no se puede leer desde el navegador**, ni
--    siendo super_admin: solo lo lee el renderizador con `service_role` para estamparlo
--    donde el documento lo exige. Se aplica con GRANT por columnas, igual que `perfiles`
--    (20260730090000) y `evidencias` (20260928100300): RLS no sabe restringir columnas.
--    Sí se puede **escribir** (hay que poder rellenarlo desde Configuració): es un campo
--    de solo escritura desde fuera, que es exactamente lo que se quiere.

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists parametros_documentales (
  id                                    int primary key check (id = 1),

  -- Identidad de la Fundación en los documentos.
  razon_social                          text,
  cif                                   text,
  domicilio                             text,
  codigo_postal                         text,
  poblacion                             text,
  -- Inscripción registral: la línea legal del pie («Inscrita al Registre de Fundacions
  -- de la Generalitat amb el número …»).
  inscripcion                           text,

  -- Quién firma en nombre de Espigoladors.
  apoderada_nombre                      text,
  apoderada_cargo                       text,
  apoderada_dni                         text,
  -- Rutas dentro del bucket privado `activos` (20260928100600), no URL públicas.
  firma_ruta                            text,
  sello_ruta                            text,

  -- Buzón del equipo. En modo prueba es el destinatario de TODO (§A: un cierre de
  -- ensayo no llega jamás a un donante real).
  email_equipo                          text,

  -- Plazos y umbrales del circuito.
  caducidad_enlace_dias                 int     not null default 30  check (caducidad_enlace_dias > 0),
  caducidad_confirmacion_dias           int     not null default 15  check (caducidad_confirmacion_dias > 0),
  tolerancia_conciliacion_pct           numeric not null default 2   check (tolerancia_conciliacion_pct >= 0),
  plazo_conciliar_sin_confirmacion_dias int     not null default 7   check (plazo_conciliar_sin_confirmacion_dias > 0),

  -- Desde esta fecha, canalizar sin convenio firmado se bloquea (D7 del plan; la fija la
  -- Fundación, hoy prevista para el 1/4/2027). Null = todavía no hay corte.
  fecha_corte_convenios                 date,

  -- Ventana del cierre anual, en 'MM-DD' (el año lo pone el ejercicio que se cierra).
  cierre_apertura                       text not null default '12-01'
                                          check (cierre_apertura ~ '^[0-1][0-9]-[0-3][0-9]$'),
  cierre_provisional                    text not null default '12-15'
                                          check (cierre_provisional ~ '^[0-1][0-9]-[0-3][0-9]$'),

  -- ⚠️ El interruptor que dice que lo de arriba NO son los datos de verdad. Mientras
  -- valga `true`, ningún documento con efecto fiscal debería salir de aquí: lo mira la
  -- pantalla de Configuració (aviso permanente) y lo mirará la emisión de certificados.
  datos_provisionales                   boolean not null default true,

  actualizado_at                        timestamptz not null default now(),
  actualizado_por                       uuid references auth.users(id) on delete set null
);

comment on table parametros_documentales is
  'Fila única (id = 1) con los datos de Espigoladors y los umbrales del circuito documental.';
comment on column parametros_documentales.apoderada_dni is
  'DNI de quien firma. FUERA del GRANT de SELECT: se escribe desde Configuració y solo lo lee el renderizador (service_role).';
comment on column parametros_documentales.datos_provisionales is
  'true mientras los datos sembrados no sean los reales de la Fundación. Bloquea la emisión con efecto fiscal.';
comment on column parametros_documentales.tolerancia_conciliacion_pct is
  'Diferencia de kilos, en %, que se acepta sin motivo entre lo entregado y lo recibido.';

-- ---------------------------------------------------------------------------
-- 2. La fila 1, con valores DE TRABAJO y marcados como tales
-- ---------------------------------------------------------------------------
-- La fase 0 todavía no ha entregado los datos reales (razón social exacta, CIF,
-- domicilio, inscripción registral y apoderada). Sembrar la fila vacía dejaría el
-- sistema sin poder emitir nada; sembrar datos inventados sin marcarlos sería peor,
-- porque un PDF con un CIF plausible se parece demasiado a un documento válido.
--
-- La salida es sembrar valores que **se leen como provisionales a simple vista**: cada
-- campo lleva el aviso dentro del propio texto —así sale impreso en cualquier PDF que se
-- genere antes de tiempo— y `datos_provisionales = true` lo dice de forma que el código
-- lo pueda comprobar.
--
-- ⚠️ El CIF es `G00000000`, que NO es un CIF válido (el dígito de control no cuadra): un
--    documento con ese número no puede confundirse con uno real ni colarse en una
--    declaración. Es deliberado, no un descuido.
--
-- `email_equipo` se deja NULL a propósito: es el destinatario de todos los envíos en
-- modo prueba y ninguna migración pone un correo de una persona real en git (§7). Lo
-- rellena el equipo desde Configuració; hasta entonces, el modo prueba no tiene a dónde
-- enviar y debe fallar diciéndolo.
--
-- Qué hay que sustituir antes de emitir nada con efecto fiscal (checkpoint de negocio):
--   razon_social · cif · domicilio · codigo_postal · poblacion · inscripcion
--   apoderada_nombre · apoderada_cargo · apoderada_dni
--   firma_ruta · sello_ruta (PNG subidos al bucket `activos`)
--   email_equipo · fecha_corte_convenios
--   y poner `datos_provisionales = false`.
insert into parametros_documentales (
  id, razon_social, cif, domicilio, codigo_postal, poblacion, inscripcion,
  apoderada_nombre, apoderada_cargo, apoderada_dni,
  email_equipo, datos_provisionales
) values (
  1,
  'PROVISIONAL — pendent de la raó social real de la Fundació',
  'G00000000',                        -- CIF inválido a propósito (ver arriba)
  'PROVISIONAL — pendent del domicili social',
  '00000',
  'PROVISIONAL — pendent de població',
  'PROVISIONAL — pendent del número d''inscripció al Registre de Fundacions',
  'PROVISIONAL — pendent del nom de l''apoderada',
  'PROVISIONAL — pendent del càrrec',
  null,                               -- el DNI no se inventa ni provisionalmente
  null,                               -- email_equipo: lo pone el equipo (§7)
  true
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Las dos capas: GRANT (por columnas) + RLS
-- ---------------------------------------------------------------------------
-- ⚠️ PRIMERO REVOCAR: `20260721160000` dejó `alter default privileges … grant select on
--    tables to authenticated`, así que la tabla nace con SELECT sobre todas sus
--    columnas, `apoderada_dni` incluido. Sin este revoke, el grant por columnas de abajo
--    no quitaría nada.
revoke select on parametros_documentales from authenticated;

-- Todo menos `apoderada_dni`.
grant select (
  id, razon_social, cif, domicilio, codigo_postal, poblacion, inscripcion,
  apoderada_nombre, apoderada_cargo, firma_ruta, sello_ruta, email_equipo,
  caducidad_enlace_dias, caducidad_confirmacion_dias, tolerancia_conciliacion_pct,
  plazo_conciliar_sin_confirmacion_dias, fecha_corte_convenios,
  cierre_apertura, cierre_provisional, datos_provisionales,
  actualizado_at, actualizado_por
) on parametros_documentales to authenticated;

-- UPDATE sí incluye `apoderada_dni`: hay que poder rellenarlo desde Configuració. Es un
-- campo que se escribe y no se lee, que es la asimetría correcta para un dato así.
-- `id` queda fuera del GRANT: la fila 1 es la fila 1 (y el check lo remataría igual).
grant update (
  razon_social, cif, domicilio, codigo_postal, poblacion, inscripcion,
  apoderada_nombre, apoderada_cargo, apoderada_dni, firma_ruta, sello_ruta,
  email_equipo, caducidad_enlace_dias, caducidad_confirmacion_dias,
  tolerancia_conciliacion_pct, plazo_conciliar_sin_confirmacion_dias,
  fecha_corte_convenios, cierre_apertura, cierre_provisional, datos_provisionales,
  actualizado_at, actualizado_por
) on parametros_documentales to authenticated;

-- Sin INSERT ni DELETE: la fila única ya existe y no se crea ni se destruye.

alter table parametros_documentales enable row level security;

drop policy if exists "parametres: intern llegeix" on parametros_documentales;
create policy "parametres: intern llegeix"
  on parametros_documentales for select to authenticated
  using ((select public.es_intern()));

-- Cambiar el CIF de la Fundación o la tolerancia de conciliación mueve lo que dicen
-- todos los documentos futuros: es del super_admin, como apagar el modo test (§8).
drop policy if exists "parametres: super_admin escriu" on parametros_documentales;
create policy "parametres: super_admin escriu"
  on parametros_documentales for update to authenticated
  using ((select public.es_super_admin()))
  with check ((select public.es_super_admin()));

-- Verificación:
--   select has_table_privilege('authenticated','public.parametros_documentales','SELECT');            -- f
--   select has_column_privilege('authenticated','public.parametros_documentales','cif','SELECT');     -- t
--   select has_column_privilege('authenticated','public.parametros_documentales','apoderada_dni','SELECT'); -- f
--   select has_column_privilege('authenticated','public.parametros_documentales','apoderada_dni','UPDATE'); -- t
--   select datos_provisionales from parametros_documentales;                                          -- t
