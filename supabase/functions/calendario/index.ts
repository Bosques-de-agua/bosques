// CALENDARIO — el puente con Google Calendar, por el camino simple (sin OAuth).
//
// Dos direcciones, las dos por la misma función:
//
//   GET  ?t=<token>  → la app vista como calendario (.ics). Cada persona tiene su
//                      enlace privado; se suscribe una vez desde Google Calendar
//                      ("Agregar calendario → Desde URL") y ahí aparece aparte,
//                      como "Estudio · Bosques de Agua". Trae los eventos del
//                      equipo en los que está invitada y SUS tareas con fecha.
//                      Las tareas privadas no salen nunca. Google decide cada
//                      cuánto lo relee: suele tardar varias horas.
//
//   POST (con la sesión de la app) → lee el calendario de Google de esa persona
//                      desde su "dirección secreta en formato iCal" (la pega una
//                      vez en Configuración) y devuelve sus eventos de un rango.
//                      Eso lo ve SOLO ella en su panel; no se guarda en la fila
//                      compartida ni en ningún lado.
//
// Se deploya como notify-chat (Edge Functions → Via Editor), con el nombre
// `calendario` y "Verify JWT" APAGADO: Google pide el .ics sin sesión, y el POST
// valida la sesión a mano acá abajo. Tabla: supabase/calendario.sql.

import { createClient } from "npm:@supabase/supabase-js@2";
import ICAL from "npm:ical.js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://bosques.vercel.app";
const TZ_OFFSET_H = 3; // Argentina: UTC-3 todo el año, sin horario de verano

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ---------- la app como .ics ----------
const pad = (n: number) => String(n).padStart(2, "0");
const escIcs = (s: string) =>
  String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Renglones de más de 75 bytes se parten, como pide el formato.
function plegar(linea: string): string {
  const enc = new TextEncoder();
  if (enc.encode(linea).length <= 75) return linea;
  const partes: string[] = [];
  let actual = "";
  for (const ch of linea) {
    if (enc.encode(actual + ch).length > (partes.length ? 74 : 75)) { partes.push(actual); actual = ""; }
    actual += ch;
  }
  partes.push(actual);
  return partes.join("\r\n ");
}
const fechaIcs = (ymd: string) => ymd.replace(/-/g, "");
function siguienteDia(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}
// Hora de Argentina → UTC con Z, así no hace falta un bloque de zona horaria.
function utcIcs(ymd: string, hhmm: string, masMin = 0): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, h + TZ_OFFSET_H, mi + masMin));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00Z`;
}
function stampIcs(): string {
  const t = new Date();
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}
const ymdOk = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const horaOk = (s: any) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);

function evento(uid: string, titulo: string, fecha: string, hora: string, desc: string, url: string): string[] {
  const l = ["BEGIN:VEVENT", `UID:${uid}@estudio-bda`, `DTSTAMP:${stampIcs()}`];
  if (horaOk(hora)) { l.push(`DTSTART:${utcIcs(fecha, hora)}`, `DTEND:${utcIcs(fecha, hora, 60)}`); }
  else { l.push(`DTSTART;VALUE=DATE:${fechaIcs(fecha)}`, `DTEND;VALUE=DATE:${siguienteDia(fecha)}`); }
  l.push(`SUMMARY:${escIcs(titulo)}`);
  if (desc) l.push(`DESCRIPTION:${escIcs(desc)}`);
  if (url) l.push(`URL:${url}`);
  l.push("END:VEVENT");
  return l;
}

function icsDe(data: any, nombre: string): string {
  const l = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bosques de Agua//Estudio//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Estudio · Bosques de Agua", "X-WR-TIMEZONE:America/Argentina/Buenos_Aires",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  // Eventos del equipo: los que son para todos y los que te invitan.
  for (const ev of data?.events || []) {
    if (!ymdOk(ev.date) || ev.date < hace30) continue;
    const para = Array.isArray(ev.para) ? ev.para : [];
    if (para.length && !para.includes(nombre)) continue;
    l.push(...evento(String(ev.id), ev.title || "Evento", ev.date, ev.time, ev.desc || "", APP_URL));
  }
  // Tus tareas con fecha, abiertas. Las privadas no viven acá: nunca salen.
  for (const node of Object.values<any>(data?.nodes || {})) {
    for (const k of node.items || []) {
      if (k.done || k.archived || !ymdOk(k.due) || k.due < hace30) continue;
      const owners = Array.isArray(k.owners) ? k.owners : [];
      if (!owners.includes(nombre)) continue;
      l.push(...evento(String(k.id), "Tarea · " + (k.title || "Tarea"), k.due, k.dueTime, node.name ? "Tema: " + node.name : "", `${APP_URL}/?tarea=${encodeURIComponent(k.id)}`));
    }
  }
  l.push("END:VCALENDAR");
  return l.map(plegar).join("\r\n") + "\r\n";
}

// ---------- tu Google Calendar → la app ----------
function eventosDelIcal(texto: string, desde: number, hasta: number, tope = 400) {
  const comp = new ICAL.Component(ICAL.parse(texto));
  for (const tz of comp.getAllSubcomponents("vtimezone")) {
    try { ICAL.TimezoneService.register(tz); } catch (_) { /* zona repetida */ }
  }
  const vevs = comp.getAllSubcomponents("vevent");
  // Las ocurrencias cambiadas a mano (RECURRENCE-ID) se enganchan a su serie.
  const series = new Map<string, any>();
  const sueltos: any[] = [];
  for (const v of vevs) {
    if (v.hasProperty("recurrence-id")) continue;
    const ev = new ICAL.Event(v);
    series.set(ev.uid, ev);
    sueltos.push(ev);
  }
  for (const v of vevs) if (v.hasProperty("recurrence-id")) {
    const s = series.get(v.getFirstPropertyValue("uid"));
    if (s) s.relateException(v); else sueltos.push(new ICAL.Event(v));
  }
  const cancelado = (c: any) => String(c.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED";
  const out: any[] = [];
  const pasar = (item: any, ini: any, fin: any) => {
    if (ini.isDate) {
      // Día entero: se manda la fecha tal cual; convertirla a hora la correría
      // de día según la zona del servidor.
      const a = ini.toString().slice(0, 10), b = (fin || ini).toString().slice(0, 10);
      const ta = Date.parse(a + "T00:00:00-03:00"), tb = Date.parse(b + "T00:00:00-03:00");
      if (tb <= desde || ta >= hasta) return;
      out.push({ titulo: item.summary || "(sin título)", fecha: a, hasta: b, diaEntero: true });
      return;
    }
    const a = ini.toJSDate().getTime(), b = (fin || ini).toJSDate().getTime();
    if ((b || a + 1) <= desde || a >= hasta) return;
    out.push({ titulo: item.summary || "(sin título)", inicio: new Date(a).toISOString(), fin: new Date(b).toISOString(), diaEntero: false });
  };
  for (const ev of sueltos) {
    if (cancelado(ev.component)) continue;
    if (!ev.isRecurring()) { pasar(ev, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    let n = 0, t;
    while ((t = it.next()) && n < 2000) {
      n++;
      if (t.toJSDate().getTime() >= hasta) break;
      const d = ev.getOccurrenceDetails(t);
      if (cancelado(d.item.component)) continue;
      pasar(d.item, d.startDate, d.endDate);
      if (out.length >= tope) break;
    }
  }
  const clave = (e: any) => e.diaEntero ? e.fecha + "T00" : e.inicio;
  return out.sort((a, b) => (clave(a) < clave(b) ? -1 : 1)).slice(0, tope);
}

// La dirección secreta tiene que ser de Google Calendar: la función no sale a
// buscar cualquier URL que le pasen.
const esIcalDeGoogle = (u: string) =>
  /^https:\/\/calendar\.google\.com\/calendar\/ical\/[^\s]+\.ics$/i.test(String(u || "").trim());

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("t") || "";
    if (!/^[a-f0-9]{32,128}$/i.test(token)) return new Response("Enlace inválido", { status: 404 });
    const { data: fila } = await supabase.from("calendario").select("email").eq("token", token).maybeSingle();
    if (!fila) return new Response("Enlace inválido", { status: 404 });
    const { data: ok } = await supabase.from("allowed_emails").select("email").eq("email", fila.email).maybeSingle();
    if (!ok) return new Response("Enlace inválido", { status: 404 });
    const { data: yo } = await supabase.from("team_members").select("name").eq("email", fila.email).maybeSingle();
    const { data: estado } = await supabase.from("app_state").select("data").eq("id", 1).single();
    const ics = icsDe(estado?.data || {}, String(yo?.name || "").trim());
    return new Response(ics, {
      headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache", ...CORS },
    });
  }

  if (req.method === "POST") {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await supabase.auth.getUser(jwt);
    const email = u?.user?.email;
    if (!email) return Response.json({ error: "sin sesión" }, { status: 401, headers: CORS });
    const { data: ok } = await supabase.from("allowed_emails").select("email").eq("email", email).maybeSingle();
    if (!ok) return Response.json({ error: "sin permiso" }, { status: 403, headers: CORS });
    const { data: fila } = await supabase.from("calendario").select("google_ical").eq("email", email).maybeSingle();
    const url = String(fila?.google_ical || "").trim();
    if (!url) return Response.json({ eventos: [], configurado: false }, { headers: CORS });
    if (!esIcalDeGoogle(url)) return Response.json({ error: "La dirección no es de Google Calendar." }, { status: 400, headers: CORS });
    let body: any = {};
    try { body = await req.json(); } catch (_) { /* sin cuerpo */ }
    const ahora = Date.now();
    const desde = Number(body.desde) || ahora - 7 * 864e5;
    const hasta = Math.min(Number(body.hasta) || ahora + 60 * 864e5, desde + 120 * 864e5);
    try {
      const r = await fetch(url, { headers: { Accept: "text/calendar" } });
      if (!r.ok) return Response.json({ error: `Google respondió ${r.status}. Revisá la dirección secreta.` }, { status: 502, headers: CORS });
      const eventos = eventosDelIcal(await r.text(), desde, hasta);
      return Response.json({ eventos, configurado: true }, { headers: CORS });
    } catch (e) {
      console.error("no pude leer el calendario de", email, e);
      return Response.json({ error: "No se pudo leer el calendario de Google." }, { status: 502, headers: CORS });
    }
  }

  return new Response("Método no permitido", { status: 405, headers: CORS });
});
