-- Forma jurídica: dos opciones más en la lista cerrada, SAT y Societat civil (SC/SCP).
--
-- POR QUÉ. Revisión de la Taula mestra por la Fundació (Sebas, 09-11-2026, fila 1.3):
-- «Forma jurídica: añadir SAT, Sociedad Civil (SC/SCP)…». Son formas habituales entre los
-- productores agrícolas y hoy acababan en «Altres».
--
-- `tipus_empresa_valid()` es la única guarda del servidor: la usan las RPC de la ficha
-- (`actualitzar_fitxa_productor/entitat`), el alta (`crear_entitat` → `alta_fitxa_interna`) y
-- la importación (`importacio_*`). La lista del panel es `TIPUS_EMPRESA`
-- (`src/lib/perfilReceptor.ts`); las dos se cambian juntas.
--
-- Misma firma y mismo cuerpo salvo la lista: `create or replace` conserva los privilegios.
-- Compatible hacia atrás: el frontend publicado nunca manda estos códigos.

create or replace function public.tipus_empresa_valid(p_nou text, p_actual text)
returns boolean
language sql
immutable
as $$
  select p_nou is null
      or p_nou in ('cooperativa', 'sat', 'sc', 'sl', 'sa', 'autonom', 'fundacio', 'associacio', 'altres')
      or p_nou is not distinct from p_actual;
$$;
