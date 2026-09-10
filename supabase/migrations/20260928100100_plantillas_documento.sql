-- `plantillas_documento`: el TEXTO de los documentos, versionado y en la base.
--
-- POR QUÉ NO EN EL CÓDIGO. El texto de un convenio, de un resumen anual o de un
-- certificado de donación lo redacta la Fundación (y, en los que tienen efecto fiscal,
-- lo revisa la asesoría). Cambia sin que cambie el software, y dentro de cinco años hay
-- que poder responder «con qué texto EXACTO se emitió este certificado de 2026». Un
-- literal en TypeScript no cumple ninguna de las tres cosas: no lo puede tocar quien
-- escribe, cambiarlo exige un despliegue, y el histórico se pierde en el git de un
-- fichero que nadie va a mirar.
--
-- LA FORMA DEL `cuerpo` la fija ya el renderizador (`_shared/pdf/plantilla.ts`): un
-- array de bloques `{tipo, text}` con `tipo` ∈ h1 · h2 · h3 · p · lista · salt, donde
-- `text` es una cadena (o un array de cadenas en `lista`) que puede llevar
-- `{{marcadores}}` con ruta anidada (`{{donant.nom}}`). El bloque es pobre a propósito:
-- un editor rico obligaría a un intérprete rico, y lo que se imprime tiene que ser
-- predecible. **Las tablas de líneas no salen de aquí**: las pinta el código de cada
-- `render/*.ts`, porque su estructura es del tipo de documento, no del texto.
--
-- ⚠️ Un marcador sin valor NO se sustituye por vacío: `interpolar()` lo deja visible y
--    lo devuelve en `faltan`, para que el llamante pueda negarse a emitir. Es preferible
--    ver el hueco en el borrador a imprimir un silencio en un documento legal. Por eso
--    `marcadores` está aquí: es el contrato declarado de la plantilla, y quien emite
--    puede comprobar que tiene valor para todos antes de pedir número.
--
-- VERSIONADO E INMUTABILIDAD. Una plantilla que ya ha emitido documentos no se edita:
-- se publica una versión nueva y se apaga la anterior. El índice parcial garantiza que
-- solo hay una vigente por (tipo, idioma), y el trigger impide reescribir el contenido
-- de una que esté referenciada desde `documentos`. Lo que sí se puede hacer siempre es
-- retirarla (`vigente = false`) o mover `valida_desde`.

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists plantillas_documento (
  id           uuid primary key default gen_random_uuid(),

  -- Mismo vocabulario que `documentos.tipo` (20260928100200): la plantilla es de un tipo
  -- de documento, no de otra cosa. Los rectificativos tienen el suyo porque su texto
  -- lleva la referencia al documento que rectifican.
  tipo         text not null check (tipo in (
                 'REC', 'ENT', 'OPE',
                 'R-REC', 'R-ENT', 'R-OPE',
                 'CONV', 'RES', 'CD', 'CT', 'PLA', 'PROVA')),
  idioma       text not null check (idioma in ('ca', 'es')),
  version      int  not null default 1 check (version >= 1),

  titulo       text  not null,
  cuerpo       jsonb not null,
  -- Los marcadores que la plantilla espera recibir. Declarados, no deducidos: quien
  -- emite comprueba contra esta lista antes de pedir número.
  marcadores   text[] not null default '{}',

  vigente      boolean not null default true,
  valida_desde date    not null default current_date,

  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table plantillas_documento is
  'Texto versionado de cada tipo de documento. Una sola vigente por (tipo, idioma).';
comment on column plantillas_documento.cuerpo is
  'Array de bloques {tipo: h1|h2|h3|p|lista|salt, text} con {{marcadores}}. Lo consume _shared/pdf/plantilla.ts.';
comment on column plantillas_documento.marcadores is
  'Contrato declarado: qué claves espera el texto. Sirve para negarse a emitir con huecos.';
comment on column plantillas_documento.vigente is
  'La que se usa hoy. Retirar una plantilla NUNCA cambia los documentos ya emitidos: llevan su snapshot.';

-- Una versión de una plantilla es única.
create unique index if not exists plantillas_tipo_idioma_version_uidx
  on plantillas_documento (tipo, idioma, version);

-- Y solo una está vigente a la vez. Índice parcial: es la regla de negocio entera.
create unique index if not exists plantillas_vigente_uidx
  on plantillas_documento (tipo, idioma) where vigente;

-- ---------------------------------------------------------------------------
-- 2. ⚠️ La FK de `documentos.plantilla_id` NO puede vivir aquí
-- ---------------------------------------------------------------------------
-- `20260928100200_documentos.sql` dejó `plantilla_id` como uuid suelto y anotó que la FK
-- la añadiría esta migración. No se puede: **este fichero se aplica ANTES que aquel** en
-- cualquier entorno recreado desde cero (100100 < 100200), así que un `alter table
-- documentos` aquí fallaría con «no existe la tabla». Que hoy funcione en local y en
-- remoto —donde 100200 ya está aplicada y esta llega después, fuera de orden— no
-- arreglaría el día que alguien levante el entorno desde las migraciones.
--
-- La FK vive por eso en **`20260928100250_fk_documentos_plantilla.sql`**, que es el
-- primer número posible después de las dos tablas y es correcto en todos los órdenes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. Trigger `plantillas_inmutables`
-- ---------------------------------------------------------------------------
-- Mientras nadie la haya usado, una plantilla es un borrador y se edita libremente. En
-- cuanto un documento la referencia, su contenido queda congelado: reescribirlo haría
-- que ese documento dijera haberse emitido con un texto que ya no es el que dice.
--
-- Lo que SÍ se puede seguir cambiando en una plantilla usada: `vigente` (retirarla) y
-- `valida_desde`. Lo demás —tipo, idioma, versión, título, cuerpo y marcadores— es su
-- identidad y su contenido.
create or replace function trg_plantillas_inmutables()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.tipo       is distinct from old.tipo
  or new.idioma     is distinct from old.idioma
  or new.version    is distinct from old.version
  or new.titulo     is distinct from old.titulo
  or new.cuerpo     is distinct from old.cuerpo
  or new.marcadores is distinct from old.marcadores then
    if exists (select 1 from documentos d where d.plantilla_id = old.id) then
      raise exception
        'La plantilla % (%/% v%) ja ha emes documents: publica una versio nova en comptes d''editar-la.',
        old.id, old.tipo, old.idioma, old.version using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists plantillas_inmutables on plantillas_documento;
create trigger plantillas_inmutables
  before update on plantillas_documento
  for each row execute function trg_plantillas_inmutables();

-- Y una plantilla usada tampoco se borra. La FK `restrict` ya lo impediría desde
-- `documentos`, pero el mensaje que da un trigger dice qué hacer; el de una FK, no.
create or replace function trg_plantillas_no_esborrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from documentos d where d.plantilla_id = old.id) then
    raise exception 'La plantilla % ja ha emes documents: retira-la (vigente = false) en comptes d''esborrar-la.',
      old.id using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists plantillas_no_esborrar on plantillas_documento;
create trigger plantillas_no_esborrar
  before delete on plantillas_documento
  for each row execute function trg_plantillas_no_esborrar();

-- ---------------------------------------------------------------------------
-- 4. Seed: la plantilla del documento de humo
-- ---------------------------------------------------------------------------
-- La única que se siembra desde git, y a propósito: no lleva texto de negocio (que es de
-- la Fundación y entra por la pantalla), sino el **ejemplo ejecutable del formato** con
-- el que trabaja `_shared/pdf/plantilla.ts`. Sirve para que el renderizador se pueda
-- probar de punta a punta antes de que exista ningún texto legal.
--
-- Los textos de REC, ENT, OPE, CONV, RES, CD, CT y PLA los introduce el equipo cuando la
-- fase 0 los entregue (checkpoint de negocio): ninguna migración inserta textos legales
-- que todavía no están validados.
insert into plantillas_documento (tipo, idioma, version, titulo, cuerpo, marcadores)
values
  ('PROVA', 'ca', 1, 'Document de prova',
   '[{"tipo":"h1","text":"{{titol}}"},
     {"tipo":"p","text":"Numero {{numero}} · exercici {{ejercici}} · emes el {{emes_at}}."},
     {"tipo":"h2","text":"Que es aixo"},
     {"tipo":"p","text":"{{nota}}"},
     {"tipo":"lista","text":["Comprova la numeracio sense forats.",
                             "Comprova la ruta dins del bucket privat.",
                             "Comprova la taula llarga amb capcalera repetida."]},
     {"tipo":"p","text":"Codi de verificacio: {{sha256_datos}}"}]'::jsonb,
   array['titol', 'numero', 'ejercici', 'emes_at', 'nota', 'sha256_datos']),
  ('PROVA', 'es', 1, 'Documento de prueba',
   '[{"tipo":"h1","text":"{{titol}}"},
     {"tipo":"p","text":"Numero {{numero}} · ejercicio {{ejercici}} · emitido el {{emes_at}}."},
     {"tipo":"h2","text":"Que es esto"},
     {"tipo":"p","text":"{{nota}}"},
     {"tipo":"lista","text":["Comprueba la numeracion sin huecos.",
                             "Comprueba la ruta dentro del bucket privado.",
                             "Comprueba la tabla larga con cabecera repetida."]},
     {"tipo":"p","text":"Codigo de verificacion: {{sha256_datos}}"}]'::jsonb,
   array['titol', 'numero', 'ejercici', 'emes_at', 'nota', 'sha256_datos'])
on conflict (tipo, idioma, version) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- SELECT explícito (el `alter default privileges` de 20260721160000 ya lo daría, pero
-- una tabla nueva sin GRANT responde `permission denied` ANTES de evaluar RLS, §4).
-- INSERT/UPDATE sí hacen falta: la pantalla de plantillas escribe desde el navegador, y
-- quien decide qué filas es la política. Sin DELETE: una plantilla se retira, no se borra.
grant select, insert, update on plantillas_documento to authenticated;

alter table plantillas_documento enable row level security;

drop policy if exists "plantilles: intern llegeix" on plantillas_documento;
create policy "plantilles: intern llegeix"
  on plantillas_documento for select to authenticated
  using ((select public.es_intern()));

-- Escribir el texto de un documento legal es una decisión, no una tarea: `pot_aprovar()`
-- (super_admin o admin), igual que aprobar una canalización o validar un alta.
drop policy if exists "plantilles: aprovador escriu" on plantillas_documento;
create policy "plantilles: aprovador escriu"
  on plantillas_documento for insert to authenticated
  with check ((select public.pot_aprovar()));

drop policy if exists "plantilles: aprovador actualitza" on plantillas_documento;
create policy "plantilles: aprovador actualitza"
  on plantillas_documento for update to authenticated
  using ((select public.pot_aprovar()))
  with check ((select public.pot_aprovar()));

-- Verificación:
--   select tipo, idioma, version, vigente from plantillas_documento;
--   update plantillas_documento set vigente = false where tipo = 'PROVA' and idioma = 'es';  -- ok
--   select has_table_privilege('authenticated','public.plantillas_documento','DELETE');      -- f
