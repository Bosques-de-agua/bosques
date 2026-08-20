-- RESPALDO AUTOMÁTICO
-- Correr una sola vez, completo, en el SQL Editor de Supabase.
--
-- Por qué hace falta: toda la información del equipo es UNA fila
-- (app_state id=1). El plan gratuito no garantiza copias. Si esa fila se
-- corrompe o alguien la sobrescribe con algo vacío, no hay a dónde volver.
--
-- De paso resuelve otra cosa: un proyecto gratuito se pausa tras ~1 semana
-- sin actividad. Una tarea que corre todos los días lo mantiene despierto.
--
-- ANTES DE CORRER ESTO: habilitar la extensión `pg_cron` desde
-- Database → Extensions (buscar "pg_cron" y activarla). Es un interruptor.

-- 1) La tabla donde van las copias. Ya existía de la copia manual del 19/08;
--    esto es por si hubiera que rehacerla en otro proyecto.
create table if not exists app_state_backup (
  id       bigserial primary key,
  taken_at timestamptz not null default now(),
  note     text,
  kind     text,
  ref      text,
  data     jsonb not null
);

-- RLS activo y SIN políticas: intocable desde la API. Ni siquiera alguien
-- con sesión iniciada puede leerla o borrarla desde la app. Solo se llega
-- desde el panel de Supabase. Es a propósito: un respaldo que la app puede
-- borrar no es un respaldo.
alter table app_state_backup enable row level security;

-- 2) La rutina: copia el estado del equipo y el privado de cada persona,
--    y poda las copias automáticas de más de 60 días.
create or replace function respaldar_estado()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into app_state_backup (note, kind, ref, data)
  select 'automatico', 'app_state', id::text, data
  from app_state where id = 1;

  insert into app_state_backup (note, kind, ref, data)
  select 'automatico', 'user_private', email, data
  from user_private;

  -- Solo se podan las automáticas: las manuales quedan para siempre.
  delete from app_state_backup
  where note = 'automatico' and taken_at < now() - interval '60 days';
end;
$$;

-- 3) Todos los días a las 06:00 UTC, que en Argentina son las 03:00.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'respaldo-diario') then
    perform cron.unschedule('respaldo-diario');
  end if;
end $$;

select cron.schedule('respaldo-diario', '0 6 * * *', $$select respaldar_estado()$$);

-- 4) Una copia ahora mismo, para no esperar hasta mañana.
select respaldar_estado();


-- ============================================================
-- COMPROBAR QUE QUEDÓ ANDANDO
-- ============================================================
-- select jobid, jobname, schedule, active from cron.job;
--
-- select id, taken_at, kind, ref, pg_size_pretty(length(data::text)::bigint) as tamano
-- from app_state_backup order by id desc limit 10;
--
-- Y al día siguiente, que la tarea haya corrido:
-- select jobid, status, return_message, start_time
-- from cron.job_run_details order by start_time desc limit 5;


-- ============================================================
-- VOLVER ATRÁS, SI ALGÚN DÍA HACE FALTA
-- ============================================================
-- Mirar primero QUÉ se va a restaurar:
--   select id, taken_at, kind, ref from app_state_backup
--   where kind = 'app_state' order by id desc limit 10;
--
-- Y recién entonces, con el id elegido:
--   update app_state set data = (select data from app_state_backup where id = <ID>)
--   where id = 1;
