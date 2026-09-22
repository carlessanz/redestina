-- Deuda §12.112: los borradores sin número de `cierres_periodo` se acumulan sin limpieza.
--
-- QUÉ PASA. `calcular_certificado_periodo()` (§4bis) escribe la fila de `cierres_periodo`
-- ANTES de que nadie decida emitir — es lo que permite enseñar kilos y bloqueos primero en
-- el diálogo del certificado a demanda. El precio, ya documentado: probar varias ventanas de
-- fechas para ver cuál cuadra deja varios borradores con `certificado_numero is null`, y no
-- hay ninguna RPC que los limpie. No ensucian nada visible —el panel del donante solo lista
-- lo emitido, por `documents_meus()`— pero se acumulan sin límite.
--
-- Verificado contra producción el 22-09-2026: 1 fila en `cierres_periodo`, sin
-- `certificado_numero`, `estado = 'calculat'`.
--
-- QUÉ SE AÑADE. Una RPC de limpieza, con el mismo criterio que `reiniciar_documentos_prova()`
-- y `reiniciar_periodes_prova()`: borra únicamente lo que se PUEDE borrar sin tocar
-- evidencia. Aquí eso es exactamente `certificado_numero is null` — un borrador nunca
-- consumió número de la serie `CDP`/`P-CDP`, así que no deja ningún hueco legal.
--
-- ⚠️ NO ES `reiniciar_periodes_prova()`. Esa función ya existe y limpia el ensayo de
--    certificado a demanda, pero (verificado en su definición) solo alcanza `modo = 'prueba'`.
--    Un borrador en modo `real` —el caso de la fila de hoy: nada dice que fuera un ensayo,
--    solo que nadie llegó a emitir— no tiene dueño. Esta función cubre CUALQUIER modo,
--    porque el criterio de seguridad no es el modo, es no tener número.
--
-- ⚠️ NO HAY TRIGGER que proteja `cierres_periodo` de un `delete` (a diferencia de
--    `documentos_no_esborrar`/`albaranes_no_esborrar`/`convenios_no_esborrar`): la única
--    guardia es esta RPC, y por eso el `where certificado_numero is null` es la condición de
--    seguridad, no un filtro de conveniencia. `cierre_periodo_lineas` cae en CASCADE
--    (`cierre_periodo_id … on delete cascade`, `20270303100100:135`), así que no hace falta
--    borrarla aparte — se cuenta ANTES de borrar solo para poder reportarla.
create or replace function public.limpiar_periodes_borrador()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids  uuid[];
  v_lin  int;
  v_cie  int;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin pot netejar els esborranys de certificat a demanda'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
    into v_ids
    from cierres_periodo
   where certificado_numero is null;

  select count(*) into v_lin
    from cierre_periodo_lineas
   where cierre_periodo_id = any(v_ids);

  delete from cierres_periodo where id = any(v_ids);
  get diagnostics v_cie = row_count;

  return jsonb_build_object('cierres_periodo', v_cie, 'cierre_periodo_lineas', v_lin);
end;
$$;

comment on function public.limpiar_periodes_borrador() is
  'Borra los borradores de certificado a demanda sin numero (deuda §12.112): cada ventana '
  'calculada en el dialogo deja una fila en cierres_periodo aunque no se emita. Solo filas '
  'con certificado_numero is null -- nunca una numerada, que es evidencia fiscal. '
  'Cubre cualquier modo (a diferencia de reiniciar_periodes_prova, que solo limpia prueba). '
  'Solo super_admin (o service_role).';

revoke execute on function public.limpiar_periodes_borrador() from public, anon;
grant  execute on function public.limpiar_periodes_borrador() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verificación (con la service key o una sesión de super_admin):
--   select id, certificado_numero, estado from cierres_periodo where certificado_numero is null;
--   select public.limpiar_periodes_borrador();  -- {"cierres_periodo": N, "cierre_periodo_lineas": M}
--   select count(*) from cierres_periodo where certificado_numero is null;  -- 0
--   -- Y lo que NO debe tocar: cualquier fila numerada sigue intacta.
--   select count(*) from cierres_periodo where certificado_numero is not null;  -- sin cambios
--
-- Guarda, desde una sesión que no sea super_admin:
--   select public.limpiar_periodes_borrador();  -- 42501
-- ---------------------------------------------------------------------------
