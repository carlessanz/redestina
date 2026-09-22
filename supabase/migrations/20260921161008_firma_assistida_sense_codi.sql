-- ---------------------------------------------------------------------------
-- La firma asistida deja de fabricar un segundo factor que no lo es
-- ---------------------------------------------------------------------------
-- 🔴 EL PROBLEMA, EN UNA FRASE: `iniciar_firma_asistida()` generaba un código de 6 cifras
--    y **se lo devolvía a quien conduce la firma**, que ya tiene el enlace. Dos factores
--    en la misma mano no son dos factores: son un actor con dos cosas.
--
-- Y encima la interfaz afirmaba algo que no ocurría. El texto `conv.assisted_code`
-- (`i18n.tsx`) decía «también se ha enviado por correo», y **nada lo enviaba**:
-- `iniciar_firma_asistida()` es SQL puro y solo lo devuelve; `enviarCorreuConveni()` manda
-- el enlace, no el código. El único código que llega al correo de la organización es el
-- que acuña `enviar_codi` en `enlace-publico` **cuando la persona pulsa «Envia'm el codi»
-- en su propia pantalla**.
--
-- LA SOLUCIÓN ES QUITAR, NO AÑADIR. Con `codigo_hash` a null, la guarda de
-- `firmar_convenio_por_enlace` (`20270320100200:133-138`) no exige código —su condición
-- es `if en.codigo_hash is not null`—, así que:
--   · una organización sin correo sigue pudiendo firmar asistida (lo que decidió §3.2.5), y
--   · en cuanto la persona pide el código desde su pantalla, el hash aparece y la puerta
--     se cierra sola.
-- El segundo factor pasa de decorativo a real sin añadir un solo circuito nuevo.
--
-- ⚠️ `enviado_at = now()` SE QUEDA como estaba, aunque aquí no se envíe nada. Es
--    incoherente con `acunar_enllac_propi()`/`signar_conveni_propi()`, que lo dejan
--    intacto a propósito, pero hay pantallas que leen esa fecha para decir «te lo
--    mandamos el día X» y cambiarlo aquí es otro trabajo, con su propia verificación.
create or replace function public.iniciar_firma_asistida(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c        convenios%rowtype;
  par      parametros_documentales%rowtype;
  v_token  text;
  v_mail   text;
  v_id     uuid;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot conduir una firma assistida' using errcode = '42501';
  end if;

  select * into c from convenios where id = p_id for update;
  if c.id is null or c.estado not in ('esborrany', 'pendent_firma', 'retornat') then
    raise exception 'Aquest conveni no es pot firmar (estat %)',
      coalesce(c.estado, 'inexistent') using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  v_mail := nullif(btrim(coalesce(c.datos_org->>'email', '')), '');

  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'convenio' and objeto_id = c.id
     and proposito = 'firma_convenio' and estado = 'activo';

  v_token := rtrim(translate(
    encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text ||
                             clock_timestamp()::text, 'UTF8')), 'base64'),
    '+/', '-_'), '=');

  -- Sin `codigo_hash` ni `codigo_caduca_at`: el segundo factor lo pide la persona desde
  -- su pantalla (`enviar_codi`), que es lo único que lo convierte en un segundo factor.
  insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                             destinatario_email, destinatario_nombre, canal,
                             token_hash, caduca_at, creado_por)
  values ('firma_convenio', 'convenio', c.id,
          v_mail, coalesce(c.firmante->>'nombre', c.datos_org->>'raso_social'), 'asistido',
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
          now() + make_interval(days => coalesce(par.caducidad_enlace_dias, 30)),
          auth.uid())
  returning id into v_id;

  update convenios
     set estado = 'pendent_firma', enlace_id = v_id, enviado_at = now(),
         datos_org = case when c.estado = 'esborrany'
                          then public.convenio_datos_org(c.id) else c.datos_org end
   where id = c.id
  returning * into c;

  return jsonb_build_object(
    'conveni', to_jsonb(c),
    'enllac',  jsonb_build_object('id', v_id, 'token', v_token, 'canal', 'asistido'),
    -- Se conserva la clave por compatibilidad del contrato, siempre null: quien llama
    -- ya no tiene que decidir si la pinta, y el frontend viejo no se rompe.
    'codi',    null,
    'pot_demanar_codi', v_mail is not null,
    'destinatari_codi', v_mail);
end;
$$;

comment on function public.iniciar_firma_asistida(uuid) is
  'Obre una firma assistida (canal asistido) i retorna el token en clar. NO genera codi: el segon factor el demana la persona des de la seva pantalla amb enviar_codi, que es l''unic que el converteix en un segon factor de veritat.';
