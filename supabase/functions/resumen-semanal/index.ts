// RESUMEN SEMANAL — el aviso del lunes: "Tu semana: 2 vencidas · 3 vencen".
//
// Lo dispara un cron los lunes a las 9 de Argentina (supabase/calendario.sql).
// A cada persona le cuenta SUS tareas abiertas vencidas y las que vencen en los
// próximos 7 días; si no tiene ninguna, no le llega nada. Al tocar el aviso se
// abre la capa Semana de Tareas.
//
// Se deploya como las otras (Edge Functions → Via Editor), nombre
// `resumen-semanal`, con "Verify JWT" APAGADO: el cron llama sin sesión. Para
// que llamarla de más no mande avisos repetidos, anota cada envío en
// `envios_programados` y no manda dos veces el mismo día.
//
// Prueba: ?prueba=<email> le manda el resumen solo a esa persona y no cuenta
// como el envío del día.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
webpush.setVapidDetails("mailto:nicomoner@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const pad = (n: number) => String(n).padStart(2, "0");
// "Hoy" en Argentina (UTC-3 todo el año).
function ymdAR(masDias = 0): string {
  const t = new Date(Date.now() - 3 * 36e5 + masDias * 864e5);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
function diaCorto(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

async function enviar(supabase: any, email: string, title: string, body: string, url: string) {
  const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("email", email);
  console.log(`resumen → ${email}: ${(subs || []).length} suscripcion(es)`);
  await Promise.all((subs || []).map((s: any) =>
    webpush.sendNotification(s.subscription, JSON.stringify({ title, body, url }), { TTL: 86400, urgency: "high" })
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
  const hoy = ymdAR(), en7 = ymdAR(7);

  if (!prueba) {
    const { error } = await supabase.from("envios_programados").insert({ clave: "resumen-" + hoy });
    if (error) {
      if (error.code === "23505") return Response.json({ ok: true, yaEnviado: hoy });
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  const { data: miembros } = await supabase.from("team_members").select("email,name");
  const { data: estado } = await supabase.from("app_state").select("data").eq("id", 1).single();
  const ymd = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const tareas: any[] = [];
  for (const node of Object.values<any>(estado?.data?.nodes || {}))
    for (const k of node.items || []) if (!k.done && !k.archived && (ymd(k.due) || ymd(k.limite))) tareas.push(k);

  const resultado: Record<string, any> = {};
  for (const m of miembros || []) {
    if (prueba && m.email !== prueba) continue;
    const nombre = String(m.name || "").trim();
    const mias = tareas.filter((k) => Array.isArray(k.owners) && k.owners.includes(nombre));
    // Dos fechas por tarea: solo `limite` vence. `due` es el día en que se
    // planeó encararla; si ya pasó, en la app se corre sola a hoy.
    const vencidas = mias.filter((k) => ymd(k.limite) && k.limite < hoy);
    const proximas = mias.filter((k) => ymd(k.limite) && k.limite >= hoy && k.limite <= en7).sort((a, b) => (a.limite < b.limite ? -1 : 1));
    const paraHacer = mias.filter((k) => ymd(k.due) && k.due <= en7);
    if (!vencidas.length && !proximas.length && !paraHacer.length) { resultado[m.email] = "nada"; continue; }
    const partes = [];
    if (vencidas.length) partes.push(vencidas.length === 1 ? "1 vencida" : `${vencidas.length} vencidas`);
    if (proximas.length) partes.push(proximas.length === 1 ? "1 vence esta semana" : `${proximas.length} vencen esta semana`);
    if (paraHacer.length) partes.push(paraHacer.length === 1 ? "1 para hacer" : `${paraHacer.length} para hacer`);
    // El detalle nombra lo que vence; si nada vence, lo que tenés para hacer.
    const lista = proximas.length ? proximas : paraHacer.slice().sort((a, b) => (a.due < b.due ? -1 : 1));
    const cuando = (d: string) => (d <= hoy ? "hoy" : diaCorto(d));
    const detalle = lista.slice(0, 3).map((k) => `${k.title} (${cuando(proximas.length ? k.limite : k.due)})`).join(", ");
    const body = partes.join(" · ") + (detalle ? `: ${detalle}` + (lista.length > 3 ? "…" : "") : "");
    resultado[m.email] = await enviar(supabase, m.email, "🗓 Tu semana", body, "/?vista=semana");
  }
  return Response.json({ ok: true, hoy, resultado });
});
