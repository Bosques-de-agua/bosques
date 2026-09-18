-- CALENDARIO Y AVISO DEL LUNES (2026-09-18)
-- Correr COMPLETO en Supabase → SQL Editor. Se puede correr más de una vez.
-- Va con las funciones `calendario` y `resumen-semanal` (supabase/functions/),
-- las dos con "Verify JWT" apagado.

-- 1) Enlaces de calendario: una fila por persona.
--    token        → su enlace privado para ver la app en Google Calendar.
--    google_ical  → la "dirección secreta en formato iCal" de SU Google Calendar,
--                   para ver sus eventos en su panel. Solo la lee la función.
create table if not exists calendario (
  email       text primary key,
  token       text unique not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  google_ical text,
  updated_at  timestamptz not null default now()
);
alter table calendario enable row level security;

drop policy if exists "own calendario select" on calendario;
create policy "own calendario select" on calendario
  for select using (is_allowed() and email = auth.jwt() ->> 'email');
drop policy if exists "own calendario insert" on calendario;
create policy "own calendario insert" on calendario
  for insert with check (is_allowed() and email = auth.jwt() ->> 'email');
drop policy if exists "own calendario update" on calendario;
create policy "own calendario update" on calendario
  for update using (is_allowed() and email = auth.jwt() ->> 'email')
        with check (is_allowed() and email = auth.jwt() ->> 'email');

-- 2) Registro de envíos programados, para que el aviso del lunes no salga dos
--    veces el mismo día. Sin políticas: solo la toca la función.
create table if not exists envios_programados (
  clave      text primary key,
  enviado_at timestamptz not null default now()
);
alter table envios_programados enable row level security;

-- 3) El cron del aviso: lunes 12:00 UTC = 9:00 de Argentina.
select cron.unschedule('resumen-semanal') where exists (select 1 from cron.job where jobname = 'resumen-semanal');
select cron.schedule(
  'resumen-semanal',
  '0 12 * * 1',
  $$ select net.http_post(
       url := 'https://ikybxeblnbbeqkpjggwe.supabase.co/functions/v1/resumen-semanal',
       timeout_milliseconds := 10000
     ) $$
);

-- Comprobar (de a una):
--   select jobname, schedule, active from cron.job where jobname = 'resumen-semanal';
--   select * from envios_programados order by enviado_at desc limit 5;
