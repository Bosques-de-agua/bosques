-- RESPALDO CADA HORA (reemplaza al diario)
-- Correr una sola vez, completo, en el SQL Editor de Supabase.
-- Requiere que `supabase/respaldo.sql` ya se haya corrido alguna vez: de ahí
-- salen la tabla `app_state_backup` y la extensión pg_cron.
--
-- Qué cambia respecto del diario:
--   1) La copia pasa de una vez por día a una vez por hora.
--   2) La copia SOLO se guarda si el contenido cambió desde la anterior.
--      Sin esto, 24 copias por día de una fila que no se tocó llenarían la
--      base de duplicados: con 60 días de retención serían ~1.400 copias del
--      estado del equipo, casi todas idénticas. Con esto, una hora tranquila
--      no ocupa nada y una hora de trabajo queda guardada igual.
--   3) La poda de 60 días nunca se lleva la ÚLTIMA copia de cada cosa. Con la
--      regla de "solo si cambió", un tema que nadie tocó en dos meses tendría
--      su única copia con más de 60 días, y la poda vieja la habría borrado.
--
-- El editor de Supabase va a avisar "Potential issue detected · destructive
-- operations". Lo disparan el `delete` de la poda y el `create or replace`;
-- es un buscador de palabras, no un análisis. Ninguna sentencia de este
-- archivo escribe en `app_state` ni en `user_private`: a esas solo las lee.

-- 1) Buscar la copia anterior por (kind, ref) tiene que ser barato: se hace
--    cada hora y la tabla crece.
create index if not exists app_state_backup_kind_ref_idx
  on app_state_backup (kind, ref, id desc);

-- 2) La rutina, ahora con memoria de lo último guardado.
create or replace function respaldar_estado()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- El estado del equipo, si cambió.
  insert into app_state_backup (note, kind, ref, data)
  select 'automatico', 'app_state', s.id::text, s.data
  from app_state s
  where s.id = 1
    and md5(s.data::text) is distinct from (
      select md5(b.data::text) from app_state_backup b
      where b.kind = 'app_state' and b.ref = s.id::text
      order by b.id desc limit 1);

  -- Lo privado de cada persona, cada uno con su propia comparación.
  insert into app_state_backup (note, kind, ref, data)
  select 'automatico', 'user_private', u.email, u.data
  from user_private u
  where md5(u.data::text) is distinct from (
      select md5(b.data::text) from app_state_backup b
      where b.kind = 'user_private' and b.ref = u.email
      order by b.id desc limit 1);

  -- Poda: solo las automáticas, solo las de más de 60 días, y nunca la más
  -- reciente de cada cosa.
  delete from app_state_backup b
  where b.note = 'automatico'
    and b.taken_at < now() - interval '60 days'
    and b.id <> (select max(b2.id) from app_state_backup b2
                 where b2.kind = b.kind and b2.ref is not distinct from b.ref);
end;
$$;

-- 3) Cada hora en punto. Se saca la tarea diaria: la reemplaza esta.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'respaldo-diario') then
    perform cron.unschedule('respaldo-diario');
  end if;
  if exists (select 1 from cron.job where jobname = 'respaldo-cada-hora') then
    perform cron.unschedule('respaldo-cada-hora');
  end if;
end $$;

select cron.schedule('respaldo-cada-hora', '0 * * * *', $$select respaldar_estado()$$);

-- 4) Una pasada ahora mismo.
select respaldar_estado();


-- ============================================================
-- COMPROBAR QUE QUEDÓ ANDANDO
-- ============================================================
-- OJO: el editor de Supabase, con varias sentencias juntas, muestra SOLO el
-- resultado de la última. Correr estas de a una (o seleccionar una con el
-- mouse y apretar Run: corre solo lo seleccionado).
--
-- Que esté la tarea nueva y no la vieja:
--   select jobname, schedule, active from cron.job order by jobname;
--
-- Las últimas copias:
--   select id, taken_at, kind, ref, pg_size_pretty(length(data::text)::bigint) as tamano
--   from app_state_backup order by id desc limit 10;
--
-- Que la tarea esté corriendo bien (a la hora siguiente):
--   select jobid, status, return_message, start_time
--   from cron.job_run_details order by start_time desc limit 5;
--
-- Cuánto ocupa todo el respaldo:
--   select count(*) as copias, pg_size_pretty(sum(length(data::text))::bigint) as total
--   from app_state_backup;


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
