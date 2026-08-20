# Mesa de trabajo — Bosques de Agua / Boscora

App de organización de equipo. Vite + JS vanilla + Supabase (Postgres, Auth, Realtime).

## Desarrollo local

1. `npm install`
2. Copiá `.env.example` a `.env.local` y completá con los datos del proyecto Supabase (Project Settings → API → Project URL / anon public key).
3. `npm run dev`

## Base de datos (Supabase)

Correr el contenido de [`supabase/schema.sql`](supabase/schema.sql) en el SQL Editor. Es idempotente: se puede volver a correr entero sin romper nada. Crea:

| Tabla | Para qué |
|---|---|
| `app_state` | Una fila con todo el contenido del equipo (temas, tareas, eventos, chat) en JSON, con Realtime activado. |
| `allowed_emails` | Quién puede entrar. |
| `team_members` | Nombre, color y foto de cada persona. Es la identidad visible. |
| `user_private` | Tareas privadas y notas personales, **una fila por email**. |
| `push_subscriptions` | Los navegadores suscritos a notificaciones. |

Todo el acceso pasa por la función `is_allowed()`, que compara el email del token contra `allowed_emails`.

### Sumar a alguien al equipo

Desde la app: **Panel → Configuración → Equipo → Sumar a alguien**. Alcanza con el correo. Esa persona entra con su propio enlace de acceso y completa su nombre la primera vez.

Dar de baja se hace a propósito desde el Table Editor de Supabase (borrando la fila de `allowed_emails`), para que nadie pueda sacar a otro por accidente.

## Autenticación e identidad

Login sin contraseña (enlace mágico / OTP) vía Supabase Auth.

**Quién sos se deriva del correo con el que entraste**, no de un selector. Eso es lo que hace que las tareas privadas y las notas personales sean realmente privadas: viven en `user_private`, y los permisos de la base impiden leer la fila de otro. Cambiar tu nombre desde Configuración lo actualiza en toda la app para todos.

## Deploy

Conectado a Vercel (free) sobre este repo — cada push a `main` deploya solo. Variables de entorno en Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`.

## App en el celular + notificaciones

La app es instalable: "Agregar a pantalla de inicio" desde el navegador del celular le da ícono propio y pantalla completa.

`notify-chat` avisa por: mensaje nuevo en el canal del equipo, en un grupo o en un privado (solo a quien corresponde, nunca al autor), y tarea recién asignada (una notificación por responsable nuevo, y al tocarla se abre esa tarea). Los correos se resuelven desde `team_members`, así que sumar gente o renombrarse no rompe nada.

Pasos del lado de Supabase, una sola vez:

1. Correr `supabase/schema.sql` completo.
2. Deployar la función `supabase/functions/notify-chat` (Edge Functions → Deploy a new function → Via Editor → pegar el contenido de `index.ts` y ponerle de nombre `notify-chat`).
3. Cargar **solo dos** secrets de la función (Edge Functions → Secrets): `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`. Están las dos en `.env.local`; la privada **no** va al repo (no lleva prefijo `VITE_`, así que Vite tampoco la manda al navegador).
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` **no hace falta cargarlas**: Supabase las inyecta sola en toda Edge Function, figuran en esa misma pantalla bajo "Default secrets".
4. Habilitar la integración **Database Webhooks** (Integrations → Database Webhooks → Install integration; instala la extensión `pg_net`). Sin ese paso, crear el webhook falla con `schema "supabase_functions" does not exist`.
5. Crear el webhook: Create a new hook → tabla `app_state`, evento `UPDATE`, tipo **Supabase Edge Functions**, función `notify-chat`. El header `Authorization` lo completa Supabase solo con la clave legacy, que es la que espera "Verify JWT with legacy secret".

**Las dos claves VAPID son un par**: si se regenera una hay que regenerar la otra, actualizar `VITE_VAPID_PUBLIC_KEY` en Vercel y en `.env.local`, y las suscripciones existentes en `push_subscriptions` dejan de servir (hay que volver a activar los avisos en cada celular).

Cada persona activa las notificaciones desde **Panel → Configuración → Avisos**.

## Arquitectura (por qué está armado así)

Toda mutación pasa por una única función `save()`, que:

1. Guarda en `localStorage` solo lo personal de este navegador — la lista está en `LOCAL_KEYS` (identidad, tema, paleta, pestaña, filtros, qué ramas dejaste abiertas, qué viste).
2. Manda tus datos privados a `user_private`.
3. Sube el resto a `app_state`, con un retardo de 350 ms.

**Guard anti-eco**: `save()` compara contra lo último enviado y no reescribe la base si el contenido no cambió. Sin eso, el chat entra en un bucle infinito (dibujar → guardar → llega por Realtime → dibujar) y cada cambio de pestaña escribiría la base.

**`applyRemoteState()` pasa por `normalize()`**: es la puerta por donde lo que llega de otros clientes entra al estado, así que ahí se migra cualquier formato viejo (`owner` → `owners[]`, `encargado` → `encargados[]`, estado "bloqueado", conversaciones privadas con clave de una sola persona).

**Si falla la lectura al arrancar**, la app muestra un error y **no escribe nada**. Antes interpretaba el error como "la base está vacía" y sobrescribía el contenido de todo el equipo con los datos de ejemplo.

### Límites conocidos

- El estado compartido se guarda entero en una fila: si dos personas editan el mismo campo al mismo tiempo, gana la última. Con un equipo chico es aceptable; el retardo de guardado reduce mucho la ventana.
- Los mensajes del chat (incluidos grupos y privados) viven dentro de esa misma fila. La app los filtra en pantalla, pero técnicamente están al alcance de quien tenga acceso a la base. Las tareas privadas y las notas personales **no**: esas sí están en una tabla aparte con permisos.
- Los archivos que se adjuntan al chat se guardan dentro del estado (hasta 3 MB). Para documentos del proyecto conviene la pestaña Drive, que solo guarda el enlace.
