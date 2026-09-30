-- RECORDATORIOS — el cron que dispara los avisos.
--
-- Cada 5 minutos llama a la Edge Function `recordatorios`, que mira los
-- recordatorios de cada persona y manda por push los que ya tocan.
-- Requisitos (ya cumplidos por calendario.sql): pg_cron, pg_net y la tabla
-- `envios_programados`. La función tiene que estar desplegada con
-- "Verify JWT" APAGADO.
--
-- Es seguro correrlo más de una vez.

select cron.unschedule('recordatorios') where exists (select 1 from cron.job where jobname = 'recordatorios');
select cron.schedule(
  'recordatorios',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://ikybxeblnbbeqkpjggwe.supabase.co/functions/v1/recordatorios',
       timeout_milliseconds := 10000
     ) $$
);

-- Comprobar (de a una):
--   select jobname, schedule, active from cron.job where jobname = 'recordatorios';
--   select * from envios_programados where clave like 'rec-%' order by enviado_at desc limit 5;
-- Probar el aviso en tu celular (en el navegador, con tu correo):
--   https://ikybxeblnbbeqkpjggwe.supabase.co/functions/v1/recordatorios?prueba=<tu email>
-- Apagarlo:
--   select cron.unschedule('recordatorios');
