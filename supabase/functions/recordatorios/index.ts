// RECORDATORIOS — el aviso al celular de los recordatorios personales.
//
// Cada persona guarda sus recordatorios en SU fila de `user_private` (nadie
// más los lee desde la app). Un cron llama a esta función cada 5 minutos
// (supabase/recordatorios.sql); ella mira qué avisos ya tocan y los manda por
// push a los dispositivos de su dueño, y a nadie más.
//
// Cuándo toca: fecha + hora del recordatorio (sin hora, las 9:00), menos la
// anticipación elegida (0, 10, 60 o 1440 minutos), en hora de Argentina.
// Para no avisar dos veces, cada envío se anota en `envios_programados` con
// una clave propia de ese recordatorio, esa fecha y esa anticipación: uno que
// se repite vuelve a avisar en su próxima fecha. Lo que se pasó por más de 6
// horas (la app estuvo caída, el cron no corrió) ya no se manda: un aviso
// viejo confunde más de lo que ayuda.
//
// Se deploya como las otras (Edge Functions → Via Editor), nombre
// `recordatorios`, con "Verify JWT" APAGADO: el cron llama sin sesión.
//
// Prueba: ?prueba=<email> manda a esa persona un aviso de prueba y no toca nada.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
webpush.setVapidDetails("mailto:nicomoner@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const AR = 3 * 36e5;                 // Argentina es UTC-3 todo el año
const VENTANA = 6 * 36e5;            // más viejo que esto, no se manda
const HORA_SIN = "09:00";            // un recordatorio sin hora avisa a las 9
const ANTES: Record<string, string> = { "10": "en 10 minutos", "60": "en 1 hora", "1440": "mañana" };

// El instante (UTC, en ms) de una fecha y hora de Argentina.
function instante(fecha: string, hora: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) + AR;
}

async function enviar(supabase: any, email: string, title: string, body: string, url: string) {
  const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("email", email);
  await Promise.all((subs || []).map((s: any) =>
    webpush.sendNotification(s.subscription, JSON.stringify({ title, body, url }), { TTL: 3600, urgency: "high" })
      .catch(async (err: any) => {
        console.error(`FALLO → ${email} · ${err?.statusCode}`);
        if (err?.statusCode === 404 || err?.statusCode === 410)
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      })));
  return (subs || []).length;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const prueba = new URL(req.url).searchParams.get("prueba") || "";
  if (prueba) {
    const n = await enviar(supabase, prueba, "⏰ Recordatorio", "Así te van a llegar tus recordatorios.", "/");
    return Response.json({ ok: true, prueba, dispositivos: n });
  }

  const ahora = Date.now();
  const { data: filas, error } = await supabase.from("user_private").select("email,data");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  let enviados = 0, mirados = 0;
  for (const fila of filas || []) {
    const lista = Array.isArray(fila?.data?.recordatorios) ? fila.data.recordatorios : [];
    for (const r of lista) {
      if (!r || r.hecho || typeof r.id !== "string" || !(String(r.aviso) in { "0": 1, "10": 1, "60": 1, "1440": 1 })) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fecha || "")) continue;
      const hora = /^\d{1,2}:\d{2}$/.test(r.hora || "") ? r.hora : HORA_SIN;
      const toca = instante(r.fecha, hora) - Number(r.aviso) * 60000;
      mirados++;
      if (toca > ahora || ahora - toca > VENTANA) continue;
      // La clave es única: si ya está, este aviso ya salió.
      const { error: ya } = await supabase.from("envios_programados").insert({ clave: `rec-${r.id}-${r.fecha}-${hora}-${r.aviso}` });
      if (ya) { if (ya.code !== "23505") console.error("envios_programados:", ya.message); continue; }
      const cuando = ANTES[String(r.aviso)] ? `${ANTES[String(r.aviso)]}${r.hora ? " · " + r.hora : ""}` : (r.hora ? r.hora : "hoy");
      const cuerpo = String(r.t || "Recordatorio").slice(0, 140) + " · " + cuando;
      const n = await enviar(supabase, fila.email, "⏰ Recordatorio", cuerpo, "/?rec=" + encodeURIComponent(r.id));
      console.log(`recordatorio → ${fila.email}: ${n} dispositivo(s)`);
      enviados++;
    }
  }
  // Las claves de recordatorios viejos ya no sirven: se limpian solas.
  await supabase.from("envios_programados").delete().like("clave", "rec-%").lt("enviado_at", new Date(ahora - 30 * 864e5).toISOString());
  return Response.json({ ok: true, mirados, enviados });
});
