-- «Cooperativa agrària» en el catálogo de actividades vale para los dos papeles.
--
-- POR QUÉ. Revisión de la Taula mestra por la Fundació (Sebas, 09-11-2026, fila 1.3):
-- «“Cooperativa agraria”. Mantener el resto de actividades». La actividad existía, pero
-- `aplica = 'productor'`: en la ficha de una entidad que solo es receptora no salía, y una
-- cooperativa agraria también recibe (transforma, reparte a sus socios). El resto del
-- catálogo no se toca.
--
-- `aplica` es la única regla: la leen el panel (`activitatsPerPaper`) y las RPC del alta, la
-- ficha y la importación (`ta.aplica = 'ambdos' or ta.aplica = any(v_rols)`). Pasar a
-- `ambdos` solo amplía lo aceptado: compatible hacia atrás.

update public.tipus_activitat
   set aplica = 'ambdos'
 where codi = 'cooperativa_agraria' and aplica = 'productor';
