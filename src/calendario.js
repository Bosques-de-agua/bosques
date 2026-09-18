// GOOGLE CALENDAR, por el camino simple (sin pedir permisos a Google).
//
// Dos direcciones, ver supabase/functions/calendario/index.ts:
//  - la app → tu Google Calendar: un enlace privado por persona para suscribirse.
//    Google lo relee cuando quiere (suele tardar varias horas).
//  - tu Google Calendar → la app: pegás tu "dirección secreta en formato iCal" y
//    tus eventos se ven SOLO en tu panel. No se guardan en la fila del equipo.
//
// Mismo patrón que el selector de Drive: app.js no importa nada; consulta
// `window.__mesaCalendario` y, si no está, no muestra la sección.

import { supabase } from "./supabaseClient.js";

const FUNCION = import.meta.env.VITE_SUPABASE_URL + "/functions/v1/calendario";

function tokenNuevo() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function initCalendario(email) {
  if (!email) return;

  async function fila() {
    const { data, error } = await supabase.from("calendario").select("token,google_ical").eq("email", email).maybeSingle();
    if (error) throw error;
    if (data) return data;
    const { data: nueva, error: e2 } = await supabase.from("calendario").insert({ email, token: tokenNuevo() }).select("token,google_ical").single();
    if (e2) throw e2;
    return nueva;
  }
  const enlaceDe = (token) => FUNCION + "?t=" + token;

  let cache = null; // {clave, at, datos}

  window.__mesaCalendario = {
    // Tu enlace para suscribirte desde Google Calendar, y si ya pegaste el tuyo.
    async estado() {
      const f = await fila();
      return { enlace: enlaceDe(f.token), tieneGoogle: !!f.google_ical };
    },
    // Un enlace nuevo invalida el anterior (por si se compartió sin querer).
    async regenerar() {
      const token = tokenNuevo();
      const { error } = await supabase.from("calendario").update({ token, updated_at: new Date().toISOString() }).eq("email", email);
      if (error) throw error;
      return enlaceDe(token);
    },
    async guardarGoogle(url) {
      await fila();
      const { error } = await supabase.from("calendario").update({ google_ical: url || null, updated_at: new Date().toISOString() }).eq("email", email);
      if (error) throw error;
      cache = null;
    },
    // Tus eventos de Google en un rango. Se guardan 10 minutos en memoria para no
    // pedirlos de nuevo cada vez que se redibuja el panel.
    async eventos(desde, hasta, forzar) {
      const clave = desde + "-" + hasta;
      if (!forzar && cache && cache.clave === clave && Date.now() - cache.at < 10 * 60 * 1000) return cache.datos;
      const { data: s } = await supabase.auth.getSession();
      const jwt = s?.session?.access_token;
      if (!jwt) throw new Error("sin sesión");
      const r = await fetch(FUNCION, {
        method: "POST",
        headers: { Authorization: "Bearer " + jwt, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ desde, hasta }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(datos.error || "No se pudo leer tu Google Calendar.");
      cache = { clave, at: Date.now(), datos };
      return datos;
    },
  };
}
