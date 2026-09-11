-- `ruta_documento_externo()`: la ruta COMPLETA de un fichero que aporta otro.
-- Cierra la deuda §12.62.
--
-- EL DEFECTO QUE CORRIGE. `ruta_documento()` está pensada para un documento **emitido**:
-- termina siempre en `<numero_completo>-v<n>.pdf`. Un externo no tiene número de serie
-- nuestro, no tiene versión y puede ser un JPG, así que las dos funciones que suben
-- externos —`subir-documento-externo` y la rama `subida_factura` de `enlace-publico`—
-- hacían lo mismo por su cuenta: pedían la ruta con un `p_numero_completo` **falso** (un
-- uuid), le recortaban la hoja con `slice(0, lastIndexOf('/') + 1)` y le pegaban el
-- nombre a mano. O sea: **la carpeta la decidía SQL y el nombre lo componía TypeScript**,
-- en dos sitios distintos y sin nada que garantice que seguirán componiéndolo igual.
--
-- LA REGLA DEL PROYECTO ES QUE LA RUTA LA DECIDE LA BASE (§B.3, «la carpeta ordena; la
-- tabla autoriza»). Aquí se cumple entera: se pide una ruta y se sube ahí.
--
-- ⚠️ LA RUTA GENERADA ES IDÉNTICA A LA DE HOY, byte a byte. Es el único requisito duro:
--    si cambiara, los externos ya subidos quedarían en una carpeta y los nuevos en otra,
--    y nada los volvería a juntar. Por eso la carpeta **no se recompone**: se sigue
--    pidiendo a `ruta_documento(..., 'externs', ...)` y se le sustituye la hoja. Duplicar
--    aquí la resolución del propietario (albarán -> productor o entidad, cierre ->
--    donante, y sus ramas de `proves/`) sería una segunda definición de quién es dueño de
--    un fichero, que es exactamente lo que no puede haber dos veces.
--
--    Forma de hoy, y de mañana:
--      <org>/<ejercicio>/externs/<uuid>-<tipo>.<ext>
--      <org>/proves/<ejercicio>/externs/<uuid>-<tipo>.<ext>   (modo = 'prueba')
--
-- EL UUID LO PONE ESTA FUNCIÓN. Antes lo generaba quien llamaba, porque necesitaba el
-- mismo valor en las dos mitades (el `p_numero_completo` falso y el nombre final). Ya no
-- hace falta en ninguna de las dos: no se guarda en `documentos_externos` ni se devuelve
-- en la respuesta, solo desambigua el nombre del fichero. Por eso la función es
-- **`volatile`** y no `stable`: dos llamadas seguidas dan rutas distintas a propósito.

create or replace function public.ruta_documento_externo(
  p_objeto_tipo text,
  p_objeto_id   uuid,
  p_tipo        text,
  p_ejercicio   int,
  p_extension   text,
  p_modo        text default 'real'
) returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ext     text;
  v_base    text;
  v_carpeta text;
begin
  -- El vocabulario de `documentos_externos.tipo` (20261012100400). Se valida aquí y no
  -- solo en la Edge Function porque lo que se está componiendo es una **ruta**: un `..`
  -- o una barra en `p_tipo` sacarían el fichero de la carpeta de su organización.
  if p_tipo not in ('albaran_productor', 'factura', 'foto_incidencia', 'altre') then
    raise exception 'Tipus de document extern no valid: %', p_tipo using errcode = '22023';
  end if;

  -- Las tres extensiones que acepta el bucket (20260928100600).
  v_ext := lower(coalesce(p_extension, ''));
  if v_ext not in ('pdf', 'jpg', 'png') then
    raise exception 'Extensio no acceptada: %', p_extension using errcode = '22023';
  end if;

  -- La carpeta, entera y sin tocar, de la función que ya sabe de quién es. Si no puede
  -- resolver el propietario levanta `0A000` y esa excepción sube tal cual: no se inventa
  -- ninguna carpeta de respaldo.
  v_base    := public.ruta_documento(p_objeto_tipo, p_objeto_id, 'externs',
                                     'x', 1, coalesce(p_modo, 'real'), p_ejercicio);
  v_carpeta := regexp_replace(v_base, '[^/]+$', '');
  if v_carpeta = '' or v_carpeta = v_base then
    raise exception 'ruta_documento() no ha tornat cap carpeta per % (%)', p_objeto_tipo, p_tipo
      using errcode = '0A000';
  end if;

  return v_carpeta || gen_random_uuid()::text || '-' || p_tipo || '.' || v_ext;
end;
$$;

comment on function public.ruta_documento_externo(text, uuid, text, int, text, text) is
  'Ruta completa de un fichero externo dentro del bucket: <org>/<ejercicio>/externs/<uuid>-<tipo>.<ext>. Misma carpeta que ruta_documento().';

-- Solo `service_role`, como `ruta_documento()`: la llaman las dos Edge Functions que
-- suben externos. Desde el navegador no se sube nada a Storage (20260928100600).
revoke execute on function public.ruta_documento_externo(text, uuid, text, int, text, text)
  from public, anon, authenticated;
grant  execute on function public.ruta_documento_externo(text, uuid, text, int, text, text)
  to service_role;

-- Verificación (la ruta nueva y la de hoy tienen que compartir carpeta):
--   select public.ruta_documento_externo('albaran', '<id>', 'albaran_productor', 2026, 'pdf');
--   select public.ruta_documento('albaran', '<id>', 'externs', 'x', 1, 'real', 2026);
--   select has_function_privilege('authenticated',
--            'public.ruta_documento_externo(text,uuid,text,int,text,text)', 'EXECUTE');  -- f
