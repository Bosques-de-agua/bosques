// AVISAR UNA NOVEDAD — manda a TODOS los dispositivos del equipo la
// notificación de la última novedad de src/novedades.js (o la que se pida).
// Al tocarla se abre la app con el cartel de novedades.
//
//   node scripts/avisar-novedad.mjs                     → muestra qué mandaría, NO manda
//   node scripts/avisar-novedad.mjs --prueba <email>    → la manda solo a esa persona
//   node scripts/avisar-novedad.mjs --enviar            → la manda a todos (una sola vez)
//   ... [--id <id>]                                     → otra novedad que no sea la última
//
// Usa SUPABASE_SERVICE_ROLE_KEY y VAPID_PRIVATE_KEY de .env.local (nunca
// salen de esta máquina). Cada envío a todos queda anotado en
// `envios_programados` con la clave `novedad-<id>`: correrlo dos veces no
// repite el aviso. La prueba no se anota.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";
import { NOVEDADES } from "../src/novedades.js";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(fs.readFileSync(path.join(raiz, ".env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const URL_ = env.VITE_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY || !env.VITE_VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
  console.error("Faltan variables en .env.local (URL, service role o claves VAPID)."); process.exit(1);
}

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const id = arg("--id"), prueba = arg("--prueba"), enviar = process.argv.includes("--enviar");
const nov = id ? NOVEDADES.find((n) => n.id === id) : NOVEDADES[0];
if (!nov) { console.error("No encuentro la novedad", id || "(lista vacía)"); process.exit(1); }

const payload = { title: "✨ Novedades en Estudio", body: nov.aviso || nov.titulo, url: "/?novedades=1" };
console.log("Novedad:", nov.id, "\n  título:", payload.title, "\n  texto: ", payload.body);
if (!prueba && !enviar) { console.log("\n(No se mandó nada. Usá --prueba <email> o --enviar.)"); process.exit(0); }

const h = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
if (enviar && !prueba) {
  const r = await fetch(`${URL_}/rest/v1/envios_programados`, { method: "POST", headers: h, body: JSON.stringify({ clave: "novedad-" + nov.id }) });
  if (r.status === 409) { console.log("\nEsta novedad ya se avisó a todos. No se repite."); process.exit(0); }
  if (!r.ok) { console.error("No pude anotar el envío:", r.status, await r.text()); process.exit(1); }
}

webpush.setVapidDetails("mailto:nicomoner@gmail.com", env.VITE_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
const filtro = prueba ? `&email=eq.${encodeURIComponent(prueba)}` : "";
const subs = await (await fetch(`${URL_}/rest/v1/push_subscriptions?select=email,endpoint,subscription${filtro}`, { headers: h })).json();
const porPersona = {};
await Promise.all(subs.map(async (s) => {
  try {
    await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 3 * 86400, urgency: "normal" });
    porPersona[s.email] = (porPersona[s.email] || 0) + 1;
  } catch (err) {
    // Suscripción vencida (el navegador la dio de baja): se borra, igual que en las funciones.
    if (err?.statusCode === 404 || err?.statusCode === 410)
      await fetch(`${URL_}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", headers: h });
    else console.error("Falló un envío:", err?.statusCode || err?.message);
  }
}));
const personas = Object.keys(porPersona).length, disp = Object.values(porPersona).reduce((a, b) => a + b, 0);
console.log(`\nEnviada a ${personas} persona(s), ${disp} dispositivo(s), de ${subs.length} suscripción(es).`);
