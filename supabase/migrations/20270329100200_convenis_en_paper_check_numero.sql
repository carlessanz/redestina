-- Continúa `20270329100100_convenis_en_paper_columnes.sql`, donde está el porqué
-- entero de esta funcionalidad. Se aplicó por separado, así que va en su propio
-- fichero: el historial remoto y los ficheros locales tienen que casar 1:1 (§7).

-- ---------------------------------------------------------------------------
-- 2. El número deja de ser obligatorio para el papel
-- ---------------------------------------------------------------------------
-- No se edita `20270111100000` (está aplicada, §7): se sustituye el check. La rama de
-- `plataforma` es la de siempre, letra por letra, incluida la nota de `pendent_firma` (que
-- es el reenvío tras una devolución, y por eso admite las dos cosas).
alter table convenios drop constraint if exists convenios_numero_segons_estat;
alter table convenios add constraint convenios_numero_segons_estat check (
     (origen = 'plataforma' and (
          (estado = 'esborrany' and numero_completo is null)
       or (estado = 'pendent_firma')
       or (estado in ('firmat', 'vigent', 'retornat', 'resolt', 'substituit')
           and numero_completo is not null and serie is not null and ejercicio is not null)))
  or (origen = 'paper' and numero_completo is null and (
          estado = 'esborrany'
       or (coalesce(btrim(referencia_paper), '') <> '' and firmado_at is not null))));
