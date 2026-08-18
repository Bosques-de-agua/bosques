# Mesa de trabajo — Bosques de Agua / Boscora

App de organización de equipo. Vite + JS vanilla + Supabase (Postgres, Auth, Realtime).

## Desarrollo local

1. `npm install`
2. Copiá `.env.example` a `.env.local` y completá con los datos de tu proyecto Supabase (Project Settings → API → Project URL / anon public key).
3. `npm run dev`

## Base de datos (Supabase)

Correr **una sola vez** el contenido de [`supabase/schema.sql`](supabase/schema.sql) en el SQL Editor del proyecto Supabase. Crea:

- `app_state`: una fila con todo el estado del equipo (temas, tareas, eventos, chat) en JSON, con Realtime activado.
- `allowed_emails`: los emails del equipo con permiso de acceso (RLS).

Para agregar o sacar gente del equipo, editá la tabla `allowed_emails` desde el Table Editor de Supabase.

## Autenticación

Login sin contraseña (magic link / email OTP) vía Supabase Auth. Solo los emails en `allowed_emails` pueden leer/escribir datos, aunque cualquiera pueda intentar loguearse.

## Deploy

Conectado a Vercel (free) sobre este repo — cada push a `main` deploya solo. Variables de entorno a configurar en Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Arquitectura (por qué está armado así)

Toda mutación de datos pasa por una única función `save()`, que:
1. Guarda localmente (`localStorage`) solo las preferencias por-persona (tema, identidad seleccionada, pestaña activa).
2. Sube el resto del estado (compartido) a Supabase (`app_state`), con debounce de 350ms.

Un canal de Realtime escucha cambios en `app_state` y actualiza la pantalla de los demás automáticamente, sin pisar sus preferencias locales.
