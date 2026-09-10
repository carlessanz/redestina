-- La FK que le faltaba a `documentos.plantilla_id`.
--
-- POR QUÉ UN FICHERO PARA UNA LÍNEA. `20260928100200_documentos.sql` dejó `plantilla_id`
-- como uuid suelto —la tabla de plantillas no existía cuando se escribió el spike— y
-- anotó que la añadiría `20260928100100_plantillas_documento.sql`. No puede: **100100 se
-- aplica antes que 100200** en cualquier entorno recreado desde cero, así que un `alter
-- table documentos` allí fallaría con «no existe la tabla». Y 100200 ya está aplicada,
-- así que editarla está prohibido (§7).
--
-- El único sitio correcto es un fichero con número posterior a las dos tablas. Este.
--
-- `on delete restrict` y no `set null`: perder el rastro de con qué texto exacto se
-- emitió un documento es justo lo que este sistema existe para impedir. Como refuerzo,
-- `authenticated` no tiene GRANT de DELETE sobre `plantillas_documento` y un trigger da
-- además un mensaje que dice qué hacer en su lugar (retirarla con `vigente = false`).
--
-- Sin `not valid`: hoy `documentos.plantilla_id` es nulo en todas las filas (el
-- documento de humo no usa plantilla), así que la validación es instantánea.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documentos_plantilla_fk'
  ) then
    alter table documentos
      add constraint documentos_plantilla_fk
      foreign key (plantilla_id) references plantillas_documento(id) on delete restrict;
  end if;
end $$;

comment on column documentos.plantilla_id is
  'Plantilla con la que se compuso el texto. FK a plantillas_documento (20260928100100).';

-- Verificación:
--   select conname, confrelid::regclass from pg_constraint where conname = 'documentos_plantilla_fk';
