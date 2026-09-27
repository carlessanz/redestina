-- El ejercicio y el modo de MIS cierres, para el panel del donante (28-09-2026).
--
-- EL DEFECTO. `productor/Documents.tsx` enseña cada fila de `cierres_donante` con su año,
-- pero el donante no puede leer `cierres_ejercicio` (es del equipo: lleva `notas` y
-- `creado_por`, y además no le toca saber cuántos ensayos se han hecho). La pantalla
-- deducía el año del número del resumen o del certificado, y un cierre recién CALCULADO
-- todavía no tiene ninguno: salía «Exercici —». Peor: por la misma vía deducía si era de
-- PRUEBA, así que un acumulado de ensayo se pintaba sin la marca de prueba —exactamente
-- lo que `cierres_donante_meus()` quiere evitar al enseñar los de prueba solo a `es_test`—.
--
-- LO QUE SE AÑADE. Una función que devuelve SOLO `(cierre_donante_id, ejercicio, modo)` de
-- las filas que el donante ya ve, por el mismo puente. No abre la tabla: ni una columna
-- más, ni una fila más. Sin sesión, `cierres_donante_meus()` no devuelve nada.

create or replace function public.exercici_dels_meus_tancaments()
returns table (cierre_donante_id uuid, ejercicio int, modo text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cd.id, ce.ejercicio, ce.modo
    from cierres_donante cd
    join cierres_ejercicio ce on ce.id = cd.cierre_id
   where cd.id in (select public.cierres_donante_meus());
$$;

comment on function public.exercici_dels_meus_tancaments() is
  'Ejercicio y modo de los cierres_donante que ve el usuario (mismo puente que su RLS). Solo esas tres columnas.';

revoke execute on function public.exercici_dels_meus_tancaments() from public, anon;
grant  execute on function public.exercici_dels_meus_tancaments() to authenticated, service_role;
