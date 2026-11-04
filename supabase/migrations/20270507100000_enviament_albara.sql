-- Enviar un albarán por correo con un botón (04-11-2026, decisión de Carles).
--
-- Con las notificaciones apagadas (§8) se corta todo lo AUTOMÁTICO; unos pocos envíos que el
-- equipo lanza a mano y acepta en el momento sí salen. Uno de ellos es «Envia per correu» del
-- albarán: el PDF adjunto a cada parte y, si todavía falta su confirmación, el enlace para
-- confirmar los kilos. Lo manda la Edge Function `enviar-albara`; esta RPC le prepara los datos.
--
-- `preparar_enviament_albara(p_albaran, p_per)` — SOLO `service_role`:
--   · rechaza un albarán que no está emitido (borrador, anulado, rectificado): 22023 `albara_no_emes`;
--   · devuelve el documento vigente (para descargar el PDF) y los destinatarios de correo, con
--     la MISMA regla que `marcar_entregado()`: la entidad receptora en ENT y OPE (`recibe`), el
--     productor en REC y OPE (`entrega`);
--   · solo si el albarán está `entregado` y esa parte aún no ha confirmado, revoca su enlace de
--     correo activo y acuña uno nuevo (misma fábrica de token): el token en claro solo sale
--     aquí, como en `marcar_entregado()`. Confirmado o conciliado —lo normal desde la validación
--     de la recogida del 17-10-2026— no lleva enlace: solo el PDF.

create or replace function public.preparar_enviament_albara(p_albaran uuid, p_per uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a       albaranes%rowtype;
  par     parametros_documentales%rowtype;
  v_doc   jsonb;
  v_dest  record;
  v_token text;
  v_id    uuid;
  v_res   jsonb := '[]'::jsonb;
begin
  -- Solo el servidor (la función ya comprueba que quien pulsa es del equipo).
  if auth.uid() is not null then
    raise exception 'Nomes el servidor prepara l''enviament d''un albara' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_albaran for update;
  if a.id is null then
    raise exception 'albara_desconegut' using errcode = 'PT404';
  end if;
  if a.estado in ('borrador', 'anulado', 'rectificado') then
    raise exception 'albara_no_emes' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  select jsonb_build_object('id', d.id, 'ruta', d.ruta, 'estado', d.estado,
                            'fichero_at', d.fichero_at, 'modo', d.modo)
    into v_doc
    from documentos d
   where d.objeto_tipo = 'albaran' and d.objeto_id = a.id and d.vigente
   limit 1;

  for v_dest in
    select * from (
      select e.email as email, coalesce(e.contacto, e.nombre) as nombre, 'recibe' as rol
        from entidades e
        join canalizaciones c on c.entidad_id = e.id
       where c.id = a.canalizacion_id and a.tipo in ('ENT', 'OPE')
      union all
      select p.email, coalesce(p.empresa, p.name), 'entrega'
        from productores p
        join excedentes ex on ex.productor_id = p.id
       where ex.id = a.excedente_id and a.tipo in ('REC', 'OPE')
      union all
      select p.email, coalesce(p.empresa, p.name), 'entrega'
        from productores p
        join espigoladas es on es.productor_id = p.id
       where es.id = a.espigolada_id and a.tipo = 'REC'
    ) d
    where d.email is not null and btrim(d.email) <> ''
  loop
    v_token := null;
    v_id := null;

    if a.estado = 'entregado' and not exists (
      select 1 from enlaces_token t
       where t.proposito = 'confirmacion_albaran' and t.objeto_tipo = 'albaran'
         and t.objeto_id = a.id and t.rol_parte = v_dest.rol and t.estado = 'usado'
    ) then
      update enlaces_token set estado = 'revocado'
       where proposito = 'confirmacion_albaran' and objeto_tipo = 'albaran'
         and objeto_id = a.id and rol_parte = v_dest.rol and canal = 'email'
         and estado = 'activo';

      v_token := rtrim(translate(
        encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text ||
                                 clock_timestamp()::text, 'UTF8')), 'base64'),
        '+/', '-_'), '=');

      insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                                 destinatario_email, destinatario_nombre,
                                 canal, rol_parte, token_hash, caduca_at, creado_por)
      values ('confirmacion_albaran', 'albaran', a.id,
              btrim(v_dest.email), v_dest.nombre, 'email', v_dest.rol,
              encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
              now() + make_interval(days => coalesce(par.caducidad_confirmacion_dias, 15)),
              p_per)
      returning id into v_id;
    end if;

    v_res := v_res || jsonb_build_object(
      'rol', v_dest.rol, 'email', btrim(v_dest.email), 'nom', v_dest.nombre,
      'token', v_token, 'enlace_id', v_id);
  end loop;

  return jsonb_build_object(
    'numero', a.numero_completo, 'tipo', a.tipo, 'estado', a.estado,
    'idioma', a.idioma, 'document', v_doc, 'destinataris', v_res);
end;
$$;

revoke execute on function public.preparar_enviament_albara(uuid, uuid) from public, anon, authenticated;
grant execute on function public.preparar_enviament_albara(uuid, uuid) to service_role;

comment on function public.preparar_enviament_albara(uuid, uuid) is
  'Datos para «Envia per correu» del albarán (enviar-albara): documento vigente, destinatarios '
  'y, si falta confirmar, un enlace nuevo por parte. Solo service_role.';
