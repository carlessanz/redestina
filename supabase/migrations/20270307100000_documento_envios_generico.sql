-- Generaliza `documento_envios`: deja de ser «los correos CON documento» y pasa a ser
-- «los correos».
--
-- EL PROBLEMA (deuda §12.25), que resultó ser peor de lo que decía la entrada. La deuda
-- afirmaba que un fallo de envío por correo «solo queda en los logs de la Edge Function» y
-- daba `documento_envios` por cierre parcial. Al ir a usarla: **no la escribe nadie y no la
-- lee nadie** (`grep documento_envios src/` → 0 resultados), y el caso que describe —correos
-- con documento adjunto— **hoy no existe**, porque `EmailPayload.attachments` está declarado
-- y ningún llamante adjunta nada. O sea que en la práctica **ningún correo dejaba rastro**:
-- ni los de acceso, ni los de recuperación de contraseña, ni las ofertas, ni el código de
-- firma, ni los recordatorios. Desde el panel, un envío rechazado por Resend era
-- indistinguible de uno correcto — la misma asimetría que WhatsApp cerró en julio con
-- `registrarFallo()` (§8ter).
--
-- POR QUÉ ESTA TABLA Y NO UNA NUEVA. Sería una segunda tabla que significa lo mismo, y a los
-- seis meses nadie sabría en cuál mirar. Esta ya tiene la FK con `on delete cascade` —que es
-- lo que hace que el historial de envíos de un documento muera con el documento, y eso lo
-- necesita `reiniciar_documentos_prova()`—, su índice de pendientes y su política
-- `es_intern()`. Todo eso se reutiliza. El nombre se queda corto; renombrarla obligaría a
-- tocar el arnés y este documento, y se deja anotado como coste conocido.
--
-- ⚠️ NO SE GUARDA EL ASUNTO, y no es un olvido. El correo del código de firma asistida lleva
--    **las seis cifras en el propio `subject`**, y esta tabla la lee todo el equipo interno.
--    Es el mismo motivo por el que `sendText()` tiene `bodyConsola` (§9): lo que se registra
--    para diagnosticar no es lo que se manda. Con destinatario, propósito, estado y error se
--    contesta la única pregunta de la deuda —«¿este correo salió?»— sin publicar una
--    credencial en una tabla que lee media docena de personas.

-- `documento_id` deja de ser obligatorio: la mayoría de los correos no llevan documento.
alter table documento_envios
  alter column documento_id drop not null;

alter table documento_envios
  add column if not exists objeto_tipo text,
  add column if not exists objeto_id   uuid,
  add column if not exists proposito   text not null default 'document',
  add column if not exists funcion     text;

-- `simulat` es el gemelo de `wa_messages.status = 'simulat'`: con `RESEND_ENVIO_REAL`
-- apagado el correo no sale, y eso tiene que poder verse. Sin este estado, «no ha llegado
-- nada» vuelve a ser indistinguible de «ha fallado», que es la deuda otra vez.
alter table documento_envios
  drop constraint if exists documento_envios_estado_check;
alter table documento_envios
  add constraint documento_envios_estado_check
    check (estado in ('pendent', 'enviat', 'simulat', 'error'));

-- El objeto es polimórfico como en `documentos` (apunta a seis tablas, así que no hay FK
-- posible). Lo único que se impone es que venga entero o no venga: media referencia no
-- sirve para nada y esconde el error de quien la escribió.
alter table documento_envios
  drop constraint if exists documento_envios_objeto_check;
alter table documento_envios
  add constraint documento_envios_objeto_check
    check ((objeto_tipo is null) = (objeto_id is null));

create index if not exists documento_envios_objeto_idx
  on documento_envios (objeto_tipo, objeto_id) where objeto_id is not null;
create index if not exists documento_envios_fallidos_idx
  on documento_envios (created_at desc) where estado = 'error';

comment on table documento_envios is
  'Trazabilidad de TODOS los correos que manda Redestina, no solo los que llevan documento. '
  'La escribe sendEmail() con service_role. Sin GRANT de escritura para nadie. '
  'NO guarda el asunto: el del código de firma lleva las seis cifras dentro (§9).';
comment on column documento_envios.proposito is
  'oferta · acces · recuperacio · document · avis_rebuig · avis_firma · codi_firma · '
  'recordatori_equip · recordatori_factura';
comment on column documento_envios.funcion is
  'Qué Edge Function lo mandó. Para saber por dónde entrar cuando algo no sale.';

-- Las columnas nuevas necesitan su `grant select`: `documento_envios` ya lo tiene de tabla
-- entera para `authenticated` (§4), así que lo heredan — pero se deja comprobable:
--   select has_column_privilege('authenticated','public.documento_envios','proposito','SELECT');
-- Ninguna escritura para nadie: la superficie sigue siendo `service_role`.
