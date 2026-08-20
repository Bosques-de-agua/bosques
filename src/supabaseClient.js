import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  // La sesión queda guardada en este navegador y el token se renueva solo:
  // se entra una vez por dispositivo y no vuelve a pedir el enlace.
  // Son los valores por defecto; quedan escritos para que nadie los cambie sin querer.
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export const CLIENT_ID = crypto.randomUUID();
