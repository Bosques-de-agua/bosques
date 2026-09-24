-- RESUMEN DE LA SEMANA — la tabla donde queda el texto que escribe la IA.
-- Correr una sola vez, completo, en el SQL Editor de Supabase.
--
-- Por qué una tabla aparte y no adentro de `app_state`: esa es UNA fila que
-- cada navegador reescribe entera cuando alguien guarda (src/sync.js). Si el
-- resumen viviera ahí, el primero que tocara cualquier cosa lo pisaría. Y esa
-- fila baja completa a los cuatro navegadores en cada cambio: acumular un
-- resumen por semana la haría crecer para siempre.
--
-- Quién escribe acá: NADIE desde la app. No hay políticas de escritura a
-- propósito, igual que el bucket `documentos`. Lo escribe la tarea programada
-- de Claude Code que corre en la máquina de Nico los lunes, con la clave de
-- servicio (que saltea RLS). Lo único que puede hacer el equipo es leerlo.

create table if not exists resumenes (
  -- El lunes que abre la semana resumida (la semana va de ese lunes al
  -- domingo). Es la clave: volver a correr la tarea el mismo lunes REEMPLAZA
  -- el resumen en vez de dejar dos, que es lo que uno quiere al reintentar.
  desde date primary key,
  hasta date not null,
  texto text not null,
  -- Con qué se escribió. Queda anotado para poder mirar más adelante si un
  -- resumen flojo fue del modelo o de la semana.
  modelo text,
  creado_at timestamptz not null default now()
);

alter table resumenes enable row level security;

-- Solo lectura, y solo para los correos habilitados: is_allowed() es la misma
-- función que cuida `app_state` (schema.sql, punto 2).
drop policy if exists "team can read resumenes" on resumenes;
create policy "team can read resumenes" on resumenes
  for select using (is_allowed());

-- Sin políticas de insert / update / delete: la app no escribe acá ni por
-- error, y un bug del navegador no puede borrar el historial.

-- Comprobar que quedó bien:
--   select desde, hasta, modelo, creado_at, length(texto) from resumenes order by desde desc;
