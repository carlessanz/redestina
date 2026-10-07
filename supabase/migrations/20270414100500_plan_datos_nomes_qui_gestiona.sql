-- 🔴 `plan_datos()` devolvía el plan de prevención de CUALQUIER organización a cualquier
--    cuenta con sesión.
--
-- QUÉ PASABA (clon local, 07-10-2026, `set local role authenticated` con los claims de una
-- RECEPTORA): `plan_datos('<plan de Mas de Prova SCP>')` devolvía el snapshot entero —nombre,
-- NIF, población y correo de la organización, el cuestionario contestado y las medidas—. Es
-- `security definer` (lee `planes_prevencion`, `productores`/`entidades` y
-- `parametros_documentales` saltándose su RLS) y desde `20270328101700:995` tiene
-- `grant execute … to authenticated`, pero no comprobaba `puc_gestionar_pla()`, al revés que
-- el resto de RPC del plan.
--
-- EL ARREGLO, en dos capas:
--
--   1. GUARDA dentro de la función: con sesión de usuario, o eres del equipo o el plan es
--      de una organización tuya (`puc_gestionar_pla(tipo_org, org)`). Sin sesión
--      (`auth.uid() is null`) quien llama es `service_role` —la Edge Function
--      `generar-documento`, que renderiza el PDF del plan— y pasa, que es el idioma del
--      repo para no dejarla fuera (§4bis).
--      ⚠️ La guarda va ANTES del «no existe»: si fuera después, una cuenta ajena podría
--         distinguir «este uuid es un plan» (42501) de «no lo es» (22023). Con sesión
--         externa, plan inexistente y plan ajeno responden igual: 42501.
--
--   2. `revoke … from authenticated`. Nadie con sesión de usuario la llama: grep en `src/`,
--      `scripts/` y `supabase/functions/` → cero llamadas (en `render/pla.ts` solo aparece
--      en comentarios). Su único llamador SQL es `plan_emet_document()`, que es
--      `security definer` y la ejecuta como propietario, así que el `revoke` no le afecta; y
--      la guarda tampoco le corta, porque quien llega ahí ya pasó `puc_gestionar_pla()` en
--      `emitir_plan_basico()`. Queda igual que sus análogas del cierre
--      (`cierre_datos_certificado()`, `cierre_datos_resumen()`): solo `service_role`.
--
-- El cuerpo es el vigente (`20270328101700`), sin más cambio que la guarda.

create or replace function public.plan_datos(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  pl  planes_prevencion%rowtype;
  par parametros_documentales%rowtype;
  v_org jsonb;
  v_prov boolean;
begin
  select * into pl from planes_prevencion where id = p_plan;

  if auth.uid() is not null and not public.es_intern()
     and (pl.id is null
          or not public.puc_gestionar_pla(pl.tipo_org, coalesce(pl.productor_id, pl.entidad_id))) then
    raise exception 'No pots consultar aquest pla' using errcode = '42501';
  end if;

  if pl.id is null then
    raise exception 'Aquest pla no existeix' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  if pl.tipo_org = 'productor' then
    select jsonb_build_object('tipus', 'productor',
                              'nom', coalesce(pr.empresa, pr.name),
                              'nif', pr.nif, 'poblacio', pr.poblacion,
                              'comarca', pr.area_geografica, 'email', pr.email)
      into v_org from productores pr where pr.id = pl.productor_id;
  else
    select jsonb_build_object('tipus', 'entitat',
                              'nom', en.nombre,
                              'nif', en.nif, 'poblacio', en.poblacion,
                              'comarca', en.area_geografica, 'email', en.email)
      into v_org from entidades en where en.id = pl.entidad_id;
  end if;

  -- Del sobre congelado primero (es lo que valía cuando se contestó) y del cuestionario
  -- solo como respaldo. Al revés, un plan emitido cambiaría de «provisional» a validado
  -- el día que alguien tocara la tabla, que es justo lo que un snapshot evita.
  v_prov := coalesce(
    (pl.respuestas ->> 'questionari_provisional')::boolean,
    (select qd.provisional from questionaris_diagnostic qd where qd.id = pl.questionari_id),
    true);

  return jsonb_build_object(
    'tipus', 'PLA',
    'nivell', pl.nivel,
    'numero', pl.numero_completo,
    'versio', pl.version,
    'exercici', pl.ejercicio,
    'data_generacio', now(),
    'lloc', par.poblacion,
    'idioma', pl.idioma,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'organitzacio', v_org,
    'questionari', pl.respuestas,
    'questionari_id', pl.questionari_id,
    'questionari_versio', (pl.respuestas ->> 'versio_questionari')::int,
    -- 🔴 Que el PDF pueda decir que el cuestionario es texto de trabajo sin validar.
    'questionari_provisional', v_prov,
    -- Y el contenido del plan: las medidas, ya resueltas al idioma y copiadas.
    'mesures', coalesce(pl.mesures -> 'llista', '[]'::jsonb),
    'mesures_observacions', pl.mesures -> 'observacions');
end;
$$;

revoke execute on function public.plan_datos(uuid) from public, anon, authenticated;
grant execute on function public.plan_datos(uuid) to service_role;

-- Verificación (clon local):
--   receptora / productora ajena:  select plan_datos('<plan>');   -- 42501 (GRANT)
--   service_role:                  el snapshot, como antes.
--   emitir_plan_basico() desde el panel del titular o del equipo: emite igual (llama a
--   plan_datos() como propietario).
