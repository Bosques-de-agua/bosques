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
// Una tarea que no existía antes no cuenta: la acaba de crear alguien y ya
// se le avisa por otros medios; si contara, cada tarea nueva avisaría a todos
// sus responsables, incluido quien la creó.
function findNewAssignments(oldData: any, newData: any) {
  const antes = flattenTasks(oldData);
  const ahora = flattenTasks(newData);
  const out: { owner: string; title: string; nodeName: string; taskId: string }[] = [];
  for (const [id, t] of ahora) {
    const previa = antes.get(id);
    if (!previa) continue;
    const previos = new Set(previa.owners);
    for (const w of t.owners) {
      if (!previos.has(w)) out.push({ owner: w, title: t.title, nodeName: t.nodeName, taskId: id });
    }
  }
  return out;
}

// Un renombre reescribe el nombre en todas las tareas de una sola vez. Sin
// esto, esa persona recibiría una notificación por cada tarea suya.
function esRenombre(oldData: any, newData: any): boolean {
  const a = new Set<string>(oldData?.members || []);
  const b = new Set<string>(newData?.members || []);
  if (a.size !== b.size) return false;
  let distintos = 0;
  for (const n of b) if (!a.has(n)) distintos++;
  return distintos === 1;
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

  // Sin estos registros, un envío que falla no deja rastro: la función igual
  // devuelve 200 y el aviso simplemente no llega, sin explicación.
  console.log(`envio "${title}" → ${(subs || []).length} suscripcion(es)`);

  await Promise.all(
    (subs || []).map((s: any) =>
      webpush
        .sendNotification(s.subscription, JSON.stringify({ title, body, url }))
        .then(() => console.log(`entregado → ${s.email}`))
        .catch(async (err: any) => {
          console.error(
            `FALLO → ${s.email} · estado ${err?.statusCode} · ${err?.body || err?.message || err}`
          );
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

  // Un renombre reescribe medio estado de una sola vez: cambian las claves de
  // las conversaciones privadas y el nombre en todas las tareas. Notificar eso
  // sería una avalancha de avisos falsos.
  if (esRenombre(oldData, newData)) return new Response("ok (renombre)");

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const emailDe = await nameToEmail(supabase);
  // Quién hizo el cambio: nunca se le notifica lo que acaba de hacer.
  const autorEmail: string = payload.record?.updated_by_email || "";
  const paraOtros = (correos: (string | undefined)[]) =>
    correos.filter((e): e is string => !!e && e !== autorEmail);
  const todosMenos = (nombre: string) =>
    paraOtros(
      Object.entries(emailDe)
        .filter(([n]) => n !== nombre)
        .map(([, e]) => e)
    );

  // Los mensajes se comparan por id, no por cantidad: con el retardo de
  // guardado pueden entrar dos juntos y si no, el anteúltimo no avisa nunca.
  const nuevosDe = (antes: any[], ahora: any[]) => {
    const vistos = new Set((antes || []).map((m: any) => m.id));
    return (ahora || []).filter((m: any) => !vistos.has(m.id));
  };

  // 1) Canal del equipo: le llega a todos menos a quien escribió.
  for (const m of nuevosDe(oldData.chat?.team, newData.chat?.team)) {
    await sendTo(supabase, todosMenos(m.from), "👥 Equipo", `${m.from}: ${cuerpoDe(m)}`);
  }

  // 2) Grupos: solo a sus integrantes, menos quien escribió.
  for (const [gid, g] of Object.entries<any>(newData.chat?.groups || {})) {
    for (const m of nuevosDe(oldData.chat?.groups?.[gid]?.msgs, g.msgs)) {
      const destinos = paraOtros(
        (g.members || []).filter((p: string) => p !== m.from).map((p: string) => emailDe[p])
      );
      await sendTo(supabase, destinos, `👪 ${g.name || "Grupo"}`, `${m.from}: ${cuerpoDe(m)}`);
    }
  }

  // 3) Privados: la clave es "A ~ B"; el destinatario es el que no escribió.
  for (const [clave, arr] of Object.entries<any>(newData.chat?.dm || {})) {
    for (const m of nuevosDe(oldData.chat?.dm?.[clave], arr)) {
      const destino = String(clave)
        .split(" ~ ")
        .find((n) => n !== m.from);
      const dest = paraOtros([destino ? emailDe[destino] : undefined]);
      if (dest.length) await sendTo(supabase, dest, `💬 ${m.from}`, cuerpoDe(m));
    }
  }

  // 4) Tareas recién asignadas: una notificación por responsable nuevo.
  //    El enlace deja la app abierta en esa tarea.
  for (const a of findNewAssignments(oldData, newData)) {
    const dest = paraOtros([emailDe[String(a.owner).trim()]]);
    if (!dest.length) continue; // sin ficha, o sos vos mismo asignándote
    await sendTo(
      supabase,
      dest,
      "Te asignaron una tarea",
      `${a.title}${a.nodeName ? ` (${a.nodeName})` : ""}`,
      `/?tarea=${encodeURIComponent(a.taskId)}`
    );
  }

  return new Response("ok");
});
