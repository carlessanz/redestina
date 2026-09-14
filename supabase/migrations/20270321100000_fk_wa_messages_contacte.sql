-- ---------------------------------------------------------------------------
-- La única FK que las tablas de mensajería pueden tener: wa_messages → wa_contacts
-- ---------------------------------------------------------------------------
-- Deuda §12.11, que decía «sin FK entre `productores`, `wa_contacts` y `wa_messages`
-- (unidas por `phone`)» — en plural, como si faltaran tres. Al medirlo, solo una de esas
-- relaciones es una FK de verdad.
--
-- ⚠️ POR QUÉ `productores.phone → wa_contacts.phone` NO SE DECLARA, Y NO DEBE DECLARARSE.
-- Medido en producción el 14-09-2026: **274 de los 345 productores no tienen contacto de
-- WhatsApp**. Y es lo correcto, no un dato sucio: un productor existe en la ficha de ARA
-- haya escrito alguna vez o no, y 61 ni siquiera tienen móvil utilizable (§6). Una FK ahí
-- afirmaría «todo productor con teléfono ha escrito por WhatsApp», que es falso por
-- construcción y rompería el alta de fichas. La relación existe, pero no es una FK.
--
-- LA QUE SÍ: un `wa_messages` es de un contacto. Está garantizado lo que Postgres exige
-- —`wa_contacts.phone` es UNIQUE desde `20260717064701:6`— y los índices de apoyo ya
-- existen (`(contact_phone, created_at)` en `:26-27`, y el de `20270306100000:57-58`), así
-- que esto no crea ninguno.
--
-- MEDIDO ANTES DE DECLARARLA: **0 huérfanos** sobre 352 mensajes y 5 contactos. Aun así se
-- declara `not valid`, y no por desconfianza del número: `not valid` **no comprueba las
-- filas existentes y sí obliga a las nuevas**, así que la migración no puede fallar a mitad
-- sobre una tabla de producción por una fila que apareciera entre la medición y el `push`.
-- La validación va después, en su propia sentencia, donde un fallo se lee solo.
--
-- 🔴 EL ORDEN CON EL DESPLIEGUE IMPORTA, Y AL REVÉS ROMPE ALGO PEOR QUE LA DEUDA.
-- Hasta hoy `whatsapp-webhook` registraba el mensaje **aunque fallara el upsert del
-- contacto** (solo escribía `console.error` y seguía), lo que producía un huérfano en
-- silencio. Con la FK puesta, ese mismo caso deja de ser un huérfano y pasa a ser un
-- `23503` que **pierde el mensaje entrante de un donante**. Por eso el webhook se
-- despliega ANTES que esta migración, no después: primero deja de tragarse el fallo, y
-- entonces se pone la FK.
--
-- `on delete restrict`, nunca `cascade`: borrar un contacto no puede llevarse por delante
-- el historial de mensajes. Quien borra un hilo desde la consola ya borra los dos, y en ese
-- orden (§6ter). `on update cascade` porque un `phone` corregido debe arrastrar sus
-- mensajes — es la misma persona.
-- ---------------------------------------------------------------------------

alter table wa_messages
  add constraint wa_messages_contact_phone_fkey
  foreign key (contact_phone) references wa_contacts (phone)
  on update cascade
  on delete restrict
  not valid;

-- Sentencia aparte: si esto fallara, dice exactamente qué fila lo impide y la FK ya está
-- puesta protegiendo lo nuevo mientras se resuelve.
alter table wa_messages validate constraint wa_messages_contact_phone_fkey;

comment on constraint wa_messages_contact_phone_fkey on wa_messages is
  'Un mensaje es de un contacto. restrict en el delete: borrar un contacto no puede llevarse el historial (deuda 11).';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
-- Que la FK existe y está validada (convalidated = true):
--   select conname, convalidated, confupdtype, confdeltype
--     from pg_constraint where conname = 'wa_messages_contact_phone_fkey';
--   -- esperado: t, 'c' (cascade en update), 'r' (restrict en delete)
--
-- Que no quedan huérfanos (tiene que dar 0, y ahora ya no puede crecer):
--   select count(*) from wa_messages m
--    left join wa_contacts c on c.phone = m.contact_phone
--    where c.phone is null;
--
-- Que NO se ha declarado la de productores (tiene que dar 0 filas):
--   select conname from pg_constraint
--    where conrelid = 'public.productores'::regclass and confrelid = 'public.wa_contacts'::regclass;
