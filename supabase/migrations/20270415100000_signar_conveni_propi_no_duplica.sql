-- signar_conveni_propi() ya no abre un convenio nuevo cuando la organización ya tiene uno vigente
-- (bug del 08-10-2026, Mas de Prova SCP).
--
-- QUÉ PASABA. `signar_conveni_propi()` deduce el tipo según el papel (productor → don_gen,
-- entidad → don_rec) y llama a `preparar_convenio()`, que solo reutiliza un convenio en
-- `esborrany`, `pendent_firma`, `retornat` o `firmat`. Con un `don_gen` VIGENTE no encuentra
-- ninguno y crea otro, que al contrafirmarse sustituye al vigente. El botón «Signa el conveni»
-- de «Pendent de tu» llamaba a esta función para CUALQUIER convenio pendiente —incluido un
-- `com`—, así que en una organización con el `don_gen` vigente y el `com` pendiente cada clic
-- firmaba un `don_gen` nuevo (consumiendo un número legal) y el `com` seguía pendiente: cuatro
-- vueltas en un día, CONV-DON-GEN-2026-0005 a 0008.
--
-- EL ARREGLO TIENE DOS MITADES. El frontend firma ahora EL CONVENIO DE LA FILA con
-- `acunar_enllac_propi()` (que ya admitía cualquier tipo). Y esta migración pone la guarda de
-- la base, que es la que impide que el ciclo vuelva a empezar desde otra pantalla: si ya hay un
-- convenio vigente de ese tipo y no hay ninguno en marcha, se niega en vez de crear otro.
--
-- «Ninguno en marcha» importa: si el equipo ha preparado la renovación (`pendent_firma`,
-- `retornat`…) el titular sí tiene que poder firmarla, y eso sigue funcionando por el camino de
-- siempre. Lo único que se cierra es abrir uno nuevo encima de un vigente.
--
-- Mismo SQL que `20270326100000` salvo el bloque marcado. `create or replace` reescribe todos
-- los atributos, así que se repiten `volatile`, `security definer` y el `search_path`.

create or replace function public.signar_conveni_propi(
  p_tipo_org text,
  p_org      uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_mail   text;
  v_nom    text;
  v_tipo   text;
  v_tok    record;
  v_id     uuid;
  v_caduca timestamptz := now() + interval '1 hour';
  c        convenios%rowtype;
begin
  if v_user is null then
    raise exception 'Cal una sessio per signar el conveni' using errcode = '42501';
  end if;
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  if not public.soc_titular(p_tipo_org, p_org) then
    raise exception 'Nomes el titular de l''organitzacio pot signar el conveni'
      using errcode = '42501';
  end if;

  v_tipo := case when p_tipo_org = 'productor' then 'don_gen' else 'don_rec' end;

  -- --- NUEVO: no se abre un convenio encima de uno vigente -----------------------------
  if exists (select 1 from convenios x
              where x.tipo = v_tipo and x.estado = 'vigent'
                and ((p_tipo_org = 'productor' and x.productor_id = p_org)
                  or (p_tipo_org = 'entidad'   and x.entidad_id   = p_org)))
     and not exists (select 1 from convenios x
                      where x.tipo = v_tipo
                        and x.estado in ('esborrany', 'pendent_firma', 'retornat', 'firmat')
                        and ((p_tipo_org = 'productor' and x.productor_id = p_org)
                          or (p_tipo_org = 'entidad'   and x.entidad_id   = p_org)))
  then
    raise exception 'Ja tens un conveni vigent d''aquest tipus'
      using errcode = '22023';
  end if;

  -- Idempotente: si ya hay borrador, enviado o devuelto, devuelve ese.
  c := public.preparar_convenio(p_tipo_org, p_org, v_tipo, null, null);

  -- Los dos estados en los que no hay nada que firmar se distinguen en el mensaje: uno
  -- es «ya está» y el otro «espera a que lo contrafirmemos», y decirle lo mismo a las dos
  -- personas mandaría a una de ellas a buscar un problema que no tiene.
  if c.estado = 'firmat' then
    raise exception 'Ja has signat aquest conveni: falta la contrasignatura de l''equip'
      using errcode = '22023';
  end if;
  if c.estado not in ('esborrany', 'pendent_firma', 'retornat') then
    raise exception 'Aquest conveni no es pot signar (estat %)', c.estado using errcode = '22023';
  end if;

  select p.email, p.nombre into v_mail, v_nom from perfiles p where p.id = v_user;
  select * into v_tok from public.generar_token_enlace();

  -- Dos enlaces vivos son dos firmas posibles, y la segunda no tendría dónde ir. Misma
  -- regla que `enviar_convenio()` y `acunar_enllac_propi()`: acuñar revoca el anterior,
  -- incluido el que la persona pueda tener en el correo (§12.97).
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'convenio' and objeto_id = c.id
     and proposito = 'firma_convenio' and estado = 'activo';

  insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                             destinatario_email, destinatario_nombre, canal,
                             token_hash, caduca_at, creado_por)
  values ('firma_convenio', 'convenio', c.id, v_mail, v_nom, 'panel',
          v_tok.token_hash, v_caduca, v_user)
  returning id into v_id;

  -- Solo el borrador cambia de estado. `enviado_at` se queda como esté.
  if c.estado = 'esborrany' then
    update convenios
       set estado    = 'pendent_firma',
           enlace_id = v_id,
           datos_org = public.convenio_datos_org(c.id)
     where id = c.id;
  else
    update convenios set enlace_id = v_id where id = c.id;
  end if;

  return jsonb_build_object('id', v_id, 'token', v_tok.token,
                            'url_path', '/signar/' || v_tok.token,
                            'caduca_at', v_caduca);
end;
$$;

revoke execute on function public.signar_conveni_propi(text, uuid) from public, anon;
grant  execute on function public.signar_conveni_propi(text, uuid) to authenticated;

comment on function public.signar_conveni_propi(text, uuid) is
  'Prepara (si hace falta) el convenio de MI organización, lo pasa a pendent_firma y acuña un enlace de panel de 1 h. Devuelve el token en claro. Solo el titular. Se niega (22023) si ya hay un convenio vigente de ese tipo y ninguno en marcha: no abre otro encima.';
