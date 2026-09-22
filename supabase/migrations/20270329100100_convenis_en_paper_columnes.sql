-- El convenio firmado EN PAPEL: registrarlo vale tanto como haberlo firmado aquí.
--
-- EL PROBLEMA QUE RESUELVE. Desde el 16-09-2026 la fecha de corte está encendida
-- (`fecha_corte_convenios`, §4bis): sin convenio `vigent` en la base, «Publicar oferta» y
-- «M'interessa» están apagados **y la base los rechaza con `42501 sense_conveni`**. La
-- Fundació llega a Redestina con convenios ya firmados en papel, y hasta hoy la única
-- salida era volver a firmarlos electrónicamente uno por uno. El badge «conveni en paper
-- (històric)» dice explícitamente que no habilita a nadie (`BadgeConveni.tsx`), que era la
-- decisión correcta cuando la campaña iba a re-firmarlo todo, y deja de serlo cuando hay
-- convenios reales detrás.
--
-- 🔴 LO QUE SE ABRE, Y HASTA DÓNDE. Esto afirma que existe una firma que la plataforma
--    NUNCA HA VISTO. Por eso:
--      · lo autoriza `es_super_admin()`, no `pot_aprovar()` — mismo nivel que
--        `borrar_ficha_completa()`, y por la misma razón: no se amplía en silencio a los
--        `admin` un poder que decide si una organización puede operar;
--      · **no se emite ningún `documentos`**. El PDF que compone Redestina lleva su página
--        de evidencias con la huella del texto aceptado, la IP y el trazo de la firma. Aquí
--        no hubo nada de eso, así que emitirlo sería imprimir una afirmación falsa. Lo que
--        acredita es el escaneado, que va a `documentos_externos` (20270329100000);
--      · **el escaneado es CONDICIÓN, no promesa**: la RPC se niega si no está subido ya.
--        Un convenio no puede quedar vigente con el papel «pendiente de adjuntar».
--
-- ⚠️ NO CONSUME NÚMERO DE SERIE (decisión del 22-09-2026). Las series de Redestina numeran
--    lo que Redestina emite, correlativo y por ejercicio; meter ahí un papel de 2023 le
--    pondría un número de 2026 y rompería lo que esa correlatividad significa. Lo que se
--    guarda es `referencia_paper`, el número que traiga el propio documento.

-- ---------------------------------------------------------------------------
-- 1. De dónde viene el convenio
-- ---------------------------------------------------------------------------
alter table convenios
  add column if not exists origen text not null default 'plataforma'
    check (origen in ('plataforma', 'paper'));

alter table convenios
  add column if not exists referencia_paper text;

comment on column convenios.origen is
  'plataforma = firmado aquí, con evidencias. paper = firmado fuera y registrado por el super_admin (20270329100100).';
comment on column convenios.referencia_paper is
  'La referencia que trae el papel. Sustituye al numero_completo, que un convenio en papel NO consume.';
