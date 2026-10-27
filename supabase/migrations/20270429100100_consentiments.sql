-- Consentimientos RGPD de las altas.
--
-- QUÉ GUARDA. Lo que una persona aceptó al darse de alta —en `/registre` o en el alta
-- asistida que hace el equipo— y con qué texto exacto:
--   · `privacitat`                  — la política de privacidad (obligatoria para el alta);
--   · `comunicacions_plataforma`    — recibir comunicaciones informativas de Redestina;
--   · `comunicacions_espigoladors`  — recibir comunicaciones de la Fundació Espigoladors.
--
-- ⚠️ NO CONDICIONA NINGÚN ENVÍO OPERATIVO. Las notificaciones del servicio (ofertas, avisos,
-- documentos) tienen como base legal el propio servicio y las gobiernan los interruptores de
-- Configuració (20270429100000). Esto es para las comunicaciones informativas o de marketing
-- que hoy todavía no existen: separadas a propósito para que una casilla de marketing no
-- pueda dejar a nadie sin el aviso de su recogida.
--
-- SOLO SE INSERTA. Un cambio de opinión es una fila nueva, y el estado vigente lo da la vista
-- `v_consentiments_vigents`. Mismo criterio que `evidencias`: la huella del texto que se
-- aceptó (`sha256_text`, calculada en el SERVIDOR sobre el texto que él compone) y quién y
-- cuándo. `registrat_per` no es nulo cuando lo declaró el equipo en un alta asistida.
--
-- Sin GRANT de escritura para nadie: escriben `registro` y `alta-assistida` con service_role.

create table if not exists public.consentiments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  organizacion_id  uuid references public.organizaciones (id) on delete set null,
  tipus            text not null check (tipus in (
                     'privacitat', 'comunicacions_plataforma', 'comunicacions_espigoladors')),
  valor            boolean not null,
  versio_text      text not null,
  sha256_text      text not null,
  idioma           text not null default 'ca' check (idioma in ('ca', 'es')),
  origen           text not null check (origen in ('registre', 'alta_assistida')),
  registrat_per    uuid references auth.users (id) on delete set null,
  ip               inet,
  user_agent       text,
  created_at       timestamptz not null default now(),
  -- Sin privacidad aceptada no hay alta: una fila que diga lo contrario sería un error.
  constraint consentiments_privacitat_acceptada
    check (tipus <> 'privacitat' or valor)
);

create index if not exists consentiments_user_idx
  on public.consentiments (user_id, tipus, created_at desc);

alter table public.consentiments enable row level security;

revoke all on public.consentiments from public, anon, authenticated;
grant select on public.consentiments to authenticated;
grant all    on public.consentiments to service_role;

drop policy if exists "consentiments: lectura propia o equip" on public.consentiments;
create policy "consentiments: lectura propia o equip"
  on public.consentiments for select to authenticated
  using (user_id = (select auth.uid()) or (select public.es_intern()));

-- El último valor por persona y tipo.
create or replace view public.v_consentiments_vigents
with (security_invoker = true) as
select distinct on (user_id, tipus)
       user_id, organizacion_id, tipus, valor, versio_text, origen, registrat_per, created_at
  from public.consentiments
 order by user_id, tipus, created_at desc;

revoke all on public.v_consentiments_vigents from public, anon, authenticated;
grant select on public.v_consentiments_vigents to authenticated, service_role;

comment on table public.consentiments is
  'Consentimientos RGPD de las altas (solo inserción). NO condicionan las notificaciones '
  'operativas: esas las gobiernan los interruptores de Configuració.';
