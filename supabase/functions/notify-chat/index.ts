// Se dispara desde un Database Webhook en la tabla app_state (evento UPDATE).
// Detecta dos cosas al comparar el estado viejo vs. el nuevo:
//   1) Mensaje nuevo en el chat de equipo -> notifica a todos los suscriptos.
//   2) Una tarea que le queda asignada (owner) a alguien -> le notifica solo a esa persona.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Nombre (tal cual aparece como "encargado"/"owner" en la app) -> email.
// Si el equipo cambia, actualizar acá.
const NAME_TO_EMAIL: Record<string, string> = {
  Nico: "nicomoner@gmail.com",
  Juanpi: "juanpmoretto@gmail.com",
  Lucas: "lucasriachi@gmail.com",
  Juanso: "juanhumus@gmail.com",
};

webpush.setVapidDetails("mailto:nicomoner@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function flattenTasks(data: any): Map<string, { owner: string; title: string; nodeName: string }> {
  const out = new Map();
  const nodes = data?.nodes || {};
  for (const node of Object.values<any>(nodes)) {
    for (const task of node.items || []) {
      out.set(task.id, { owner: task.owner || "", title: task.title || "", nodeName: node.name || "" });
    }
  }
  return out;
}

function findNewAssignments(oldData: any, newData: any) {
  const oldTasks = flattenTasks(oldData);
  const newTasks = flattenTasks(newData);
  const assignments: { owner: string; title: string; nodeName: string }[] = [];
  for (const [id, task] of newTasks) {
    const before = oldTasks.get(id);
    const ownerChanged = task.owner && task.owner !== (before?.owner || "");
    if (ownerChanged) assignments.push(task);
  }
  return assignments;
}

async function sendTo(supabase: any, emails: string[] | null, title: string, body: string) {
  let query = supabase.from("push_subscriptions").select("*");
  if (emails) query = query.in("email", emails);
  const { data: subs } = await query;

  await Promise.all(
    (subs || []).map((s: any) =>
      webpush
        .sendNotification(s.subscription, JSON.stringify({ title, body, url: "/" }))
        .catch(async (err: any) => {
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

  // 1) Mensaje nuevo en el chat de equipo.
  const oldMsgs = oldData.chat?.team || [];
  const newMsgs = newData.chat?.team || [];
  if (newMsgs.length > oldMsgs.length) {
    const last = newMsgs[newMsgs.length - 1];
    const body = last.ev ? "Nuevo evento en el chat de equipo" : `${last.from}: ${last.text || ""}`.slice(0, 140);
    await sendTo(supabase, null, "Mesa de trabajo", body);
  }

  // 2) Tareas recién asignadas.
  const assignments = findNewAssignments(oldData, newData);
  for (const a of assignments) {
    const email = NAME_TO_EMAIL[a.owner.trim()];
    if (!email) continue;
    await sendTo(supabase, [email], "Te asignaron una tarea", `${a.title} (${a.nodeName})`);
  }

  return new Response("ok");
});
