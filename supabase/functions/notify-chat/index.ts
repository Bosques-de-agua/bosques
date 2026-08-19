// Avisos push. Se dispara desde un Database Webhook en app_state (UPDATE) y
// compara el estado viejo contra el nuevo para detectar:
//   1) mensajes nuevos en el canal del equipo, en un grupo o en un privado;
//   2) tareas que le quedaron asignadas a alguien.
// A nadie se le notifica lo que escribió o se asignó a sí mismo.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails("mailto:nicomoner@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// El nombre visible sale de team_members, no de una lista escrita a mano:
// así renombrarse o sumar gente no rompe los avisos en silencio.
async function nameToEmail(supabase: any): Promise<Record<string, string>> {
  const { data } = await supabase.from("team_members").select("email,name");
  const map: Record<string, string> = {};
  for (const m of data || []) if (m.name) map[String(m.name).trim()] = m.email;
  return map;
}

type Tarea = { owners: string[]; title: string; nodeName: string; taskId: string };

function flattenTasks(data: any): Map<string, Tarea> {
  const out = new Map<string, Tarea>();
  for (const node of Object.values<any>(data?.nodes || {})) {
    for (const task of node.items || []) {
      // Tolera el formato anterior (owner en singular) durante la transición.
      const owners: string[] = Array.isArray(task.owners)
        ? task.owners
        : task.owner
        ? [task.owner]
        : [];
      out.set(task.id, {
        owners,
        title: task.title || "",
        nodeName: node.name || "",
        taskId: task.id,
      });
    }
  }
  return out;
}

// Devuelve, por tarea, solo los responsables que ANTES no estaban.
function findNewAssignments(oldData: any, newData: any) {
  const antes = flattenTasks(oldData);
  const ahora = flattenTasks(newData);
  const out: { owner: string; title: string; nodeName: string; taskId: string }[] = [];
  for (const [id, t] of ahora) {
    const previos = new Set(antes.get(id)?.owners || []);
    for (const w of t.owners) {
      if (!previos.has(w)) out.push({ owner: w, title: t.title, nodeName: t.nodeName, taskId: id });
    }
  }
  return out;
}

function cuerpoDe(m: any): string {
  if (!m) return "";
  if (m.ev) return "Propuso un evento";
  if (m.file) return `Mandó un archivo: ${m.file.name || "archivo"}`;
  return String(m.text || "").slice(0, 140);
}

async function sendTo(
  supabase: any,
  emails: string[] | null,
  title: string,
  body: string,
  url = "/"
) {
  const destinos = emails ? emails.filter(Boolean) : null;
  if (destinos && !destinos.length) return;

  let query = supabase.from("push_subscriptions").select("*");
  if (destinos) query = query.in("email", destinos);
  const { data: subs } = await query;

  await Promise.all(
    (subs || []).map((s: any) =>
      webpush
        .sendNotification(s.subscription, JSON.stringify({ title, body, url }))
        .catch(async (err: any) => {
          // 404/410 = el navegador ya no existe: se limpia la suscripción muerta.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        })
    )
  );
}

Deno.serve(async (req) => {
  const payload = await req.json();
  const oldData = payload.old_record?.data;
  const newData = payload.record?.data;
  if (!oldData || !newData) return new Response("ok");

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const emailDe = await nameToEmail(supabase);
  const todosMenos = (nombre: string) =>
    Object.entries(emailDe)
      .filter(([n]) => n !== nombre)
      .map(([, e]) => e);

  // 1) Canal del equipo: le llega a todos menos a quien escribió.
  const teamAntes = oldData.chat?.team || [];
  const teamAhora = newData.chat?.team || [];
  if (teamAhora.length > teamAntes.length) {
    const last = teamAhora[teamAhora.length - 1];
    await sendTo(supabase, todosMenos(last.from), "👥 Equipo", `${last.from}: ${cuerpoDe(last)}`);
  }

  // 2) Grupos: solo a sus integrantes, menos quien escribió.
  for (const [gid, g] of Object.entries<any>(newData.chat?.groups || {})) {
    const antes = oldData.chat?.groups?.[gid]?.msgs || [];
    const ahora = g.msgs || [];
    if (ahora.length <= antes.length) continue;
    const last = ahora[ahora.length - 1];
    const destinos = (g.members || [])
      .filter((p: string) => p !== last.from)
      .map((p: string) => emailDe[p]);
    await sendTo(supabase, destinos, `👪 ${g.name || "Grupo"}`, `${last.from}: ${cuerpoDe(last)}`);
  }

  // 3) Privados: la clave es "A ~ B"; el destinatario es el que no escribió.
  for (const [clave, arr] of Object.entries<any>(newData.chat?.dm || {})) {
    const antes = oldData.chat?.dm?.[clave] || [];
    const ahora = arr || [];
    if (ahora.length <= antes.length) continue;
    const last = ahora[ahora.length - 1];
    const destino = String(clave)
      .split(" ~ ")
      .find((n) => n !== last.from);
    if (destino && emailDe[destino]) {
      await sendTo(supabase, [emailDe[destino]], `💬 ${last.from}`, cuerpoDe(last));
    }
  }

  // 4) Tareas recién asignadas: una notificación por responsable nuevo.
  //    El enlace deja la app abierta en esa tarea.
  for (const a of findNewAssignments(oldData, newData)) {
    const email = emailDe[String(a.owner).trim()];
    if (!email) continue;
    await sendTo(
      supabase,
      [email],
      "Te asignaron una tarea",
      `${a.title}${a.nodeName ? ` (${a.nodeName})` : ""}`,
      `/?tarea=${encodeURIComponent(a.taskId)}`
    );
  }

  return new Response("ok");
});
