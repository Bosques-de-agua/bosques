-- Mesa de trabajo — esquema Supabase
-- Ejecutar completo en el SQL Editor de Supabase (Project > SQL Editor > New query).

-- 1) Lista de emails permitidos (los 4 del equipo).
create table if not exists allowed_emails (
  email text primary key
);

insert into allowed_emails (email) values
  ('nicomoner@gmail.com'),
  ('juanpmoretto@gmail.com'),
  ('lucasriachi@gmail.com'),
  ('juanhumus@gmail.com')
on conflict (email) do nothing;

alter table allowed_emails enable row level security;
-- Sin políticas: nadie puede leer/escribir esta tabla vía API directamente.
-- Solo la función is_allowed() de abajo puede consultarla (corre con privilegios propios).

-- 2) Función que chequea si el usuario autenticado está en la lista.
create or replace function is_allowed()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from allowed_emails where email = auth.jwt() ->> 'email'
  );
$$;

-- 3) Estado de la app: una única fila con todo el árbol de temas/tareas/eventos/chat en JSON.
create table if not exists app_state (
  id smallint primary key default 1,
  data jsonb not null,
  updated_by_client text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- Por si la tabla ya existía sin esta columna. Sirve para saber quién guardó
-- y así no mandarle a esa persona una notificación de su propio cambio.
alter table app_state add column if not exists updated_by_email text;

alter table app_state enable row level security;

drop policy if exists "team can read state" on app_state;
create policy "team can read state" on app_state
  for select using (is_allowed());

drop policy if exists "team can insert state" on app_state;
create policy "team can insert state" on app_state
  for insert with check (is_allowed());

drop policy if exists "team can update state" on app_state;
create policy "team can update state" on app_state
  for update using (is_allowed()) with check (is_allowed());

-- 4) Tiempo real: que los cambios se transmitan en vivo a los demás.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table app_state;
  end if;
end $$;

-- 5) Notificaciones push: suscripciones del navegador de cada persona.
create table if not exists push_subscriptions (
  endpoint text primary key,
  email text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "team manages own push sub" on push_subscriptions;
create policy "team manages own push sub" on push_subscriptions
  for all
  using (is_allowed() and email = auth.jwt() ->> 'email')
  with check (is_allowed() and email = auth.jwt() ->> 'email');

-- 6) Datos privados de cada persona: tareas privadas y notas personales.
--    Van acá y NO en app_state, que es una sola fila compartida por el equipo:
--    cualquier cosa que esté ahí la puede leer cualquiera.
--    La clave es el EMAIL (no el nombre visible) para que renombrarse no rompa nada.
create table if not exists user_private (
  email text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table user_private enable row level security;

-- Cada quien ve y escribe únicamente su propia fila.
drop policy if exists "own private select" on user_private;
create policy "own private select" on user_private
  for select using (is_allowed() and email = auth.jwt() ->> 'email');

drop policy if exists "own private insert" on user_private;
create policy "own private insert" on user_private
  for insert with check (is_allowed() and email = auth.jwt() ->> 'email');

drop policy if exists "own private update" on user_private;
create policy "own private update" on user_private
  for update using (is_allowed() and email = auth.jwt() ->> 'email')
        with check (is_allowed() and email = auth.jwt() ->> 'email');

-- A propósito NO se agrega a supabase_realtime: sincronizar al abrir alcanza
-- para datos personales, y es una superficie menos donde equivocarse con permisos.

-- 7) El equipo: quién es quién, y quién puede entrar.
--    Reemplaza la lista de nombres que vivía dentro del estado compartido.
--    La identidad se ata al EMAIL de la sesión, no a un nombre elegido a mano:
--    así nadie puede hacerse pasar por otro y renombrarse no rompe nada.
create table if not exists team_members (
  email      text primary key,
  name       text not null,
  color      text,
  avatar     text,                          -- foto recortada, en base64
  created_at timestamptz not null default now()
);

alter table team_members enable row level security;

-- Todo el equipo se ve entre sí (necesario para asignar tareas y chatear).
drop policy if exists "team reads members" on team_members;
create policy "team reads members" on team_members
  for select using (is_allowed());

-- Cada quien crea y edita SOLO su propia ficha (su nombre, su color, su foto).
drop policy if exists "own member insert" on team_members;
create policy "own member insert" on team_members
  for insert with check (is_allowed() and email = auth.jwt() ->> 'email');

drop policy if exists "own member update" on team_members;
create policy "own member update" on team_members
  for update using (is_allowed() and email = auth.jwt() ->> 'email')
        with check (is_allowed() and email = auth.jwt() ->> 'email');

-- 8) Sumar gente nueva desde la app.
--    allowed_emails no tenía políticas, así que habilitar a alguien exigía
--    entrar al panel de Supabase. Ahora el equipo puede hacerlo desde adentro.
drop policy if exists "team reads allowed" on allowed_emails;
create policy "team reads allowed" on allowed_emails
  for select using (is_allowed());

drop policy if exists "team invites" on allowed_emails;
create policy "team invites" on allowed_emails
  for insert with check (is_allowed());

-- Nadie puede quitar a otro por accidente desde la app: dar de baja se hace
-- desde el panel de Supabase, a propósito.

-- 9) Sembrar la ficha de los cuatro que ya estaban, con sus nombres actuales.
insert into team_members (email, name) values
  ('nicomoner@gmail.com',    'Nico'),
  ('juanpmoretto@gmail.com', 'Juampi'),
  ('lucasriachi@gmail.com',  'Lucas'),
  ('juanhumus@gmail.com',    'Juanso')
on conflict (email) do nothing;
