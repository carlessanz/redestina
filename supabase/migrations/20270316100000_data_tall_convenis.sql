-- La fecha de corte de los convenios, legible por quien la sufre.
--
-- POR QUÉ HACE FALTA. `parametros_documentales` es del equipo: un productor no lee ni una
-- fila (arnés §4bis, «NO ve los parámetros documentales»), y con razón, porque ahí viven
-- los datos de la apoderada. Pero el aviso que tiene que ver en su panel —«a partir del X
-- no podrás publicar»— necesita justamente ese campo, y uno solo.
--
-- La alternativa era escribir la fecha en el frontend, y eso es peor de lo que parece: el
-- día que la Fundación la mueva, la base cortaría en una fecha y la interfaz avisaría de
-- otra. Con esta función hay UN sitio con la verdad, igual que `exigir_convenio()`, que
-- lee la misma columna para decidir si avisa o levanta 42501.
--
-- Devuelve null mientras no haya fecha puesta, que es el estado de hoy: entonces el panel
-- enseña el aviso sin plazo y no bloquea nada.

create or replace function public.data_tall_convenis()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select fecha_corte_convenios from parametros_documentales where id = 1;
$$;

revoke execute on function public.data_tall_convenis() from public, anon;
grant  execute on function public.data_tall_convenis() to authenticated, service_role;

comment on function public.data_tall_convenis() is
  'La fecha de corte de los convenios (parametros_documentales.fecha_corte_convenios), lo único que un usuario externo necesita leer de esa tabla. Null = todavía no hay corte.';
