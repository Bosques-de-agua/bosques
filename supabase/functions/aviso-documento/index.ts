// AVISO DE DOCUMENTO — "🗺 Se actualizó el Mapa interactivo".
//
// Cuando se sube un archivo al bucket `documentos`, un trigger de la base
// (supabase/aviso-documentos.sql) llama a esta función con el nombre del
// archivo, y le llega un aviso a todo el equipo. Al tocarlo se abre ese
// documento en la app.
//
// Solo avisa por los archivos que la app muestra (la lista de abajo, que tiene
// que coincidir con src/documentos.js). Una copia suelta ("mapa (1).html") no
// avisa. Y no avisa dos veces por el mismo documento en la misma hora: subir,
// borrar y volver a subir manda un solo aviso.
//
// Se deploya como las otras (Edge Functions → Via Editor), nombre
// `aviso-documento`, con "Verify JWT" APAGADO: la llama la base, sin sesión.
// Prueba: ?prueba=<email>&nombre=mapa-interactivo.html le avisa solo a esa persona.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

webpush.setVapidDetails("mailto:nicomoner@gmail.com", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

const DOCS: Record<string, { id: string; nombre: string; emoji: string }> = {
  "mapa-interactivo.html": { id: "mapa", nombre: "el Mapa interactivo", emoji: "🗺" },
  "estrategia-adquisicion.html": { id: "campos", nombre: "Adquisición de campos", emoji: "📄" },
};

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const q = new URL(req.url).searchParams;
  let nombre = q.get("nombre") || "";
  if (!nombre && req.method === "POST") {
    try { nombre = String((await req.json())?.nombre || ""); } catch (_) { /* sin cuerpo */ }
  }
  const doc = DOCS[nombre];
  if (!doc) return Response.json({ ok: true, ignorado: nombre || "(sin nombre)" });
  const prueba = q.get("prueba") || "";

  if (!prueba) {
    const hora = new Date().toISOString().slice(0, 13); // una vez por hora y documento
    const { error } = await supabase.from("envios_programados").insert({ clave: `doc-${doc.id}-${hora}` });
    if (error) {
      if (error.code === "23505") return Response.json({ ok: true, yaAvisado: doc.id });
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  let query = supabase.from("push_subscriptions").select("*");
  if (prueba) query = query.eq("email", prueba);
  const { data: subs } = await query;
  const title = `${doc.emoji} Se actualizó ${doc.nombre}`;
  const body = "Hay una versión nueva. Tocá para abrirla.";
  const url = `/?doc=${doc.id}`;
  console.log(`aviso "${title}" → ${(subs || []).length} suscripcion(es)`);
  await Promise.all((subs || []).map((s: any) =>
    webpush.sendNotification(s.subscription, JSON.stringify({ title, body, url }), { TTL: 86400, urgency: "high" })
      .catch(async (err: any) => {
        console.error(`FALLO → ${s.email} · ${err?.statusCode}`);
        if (err?.statusCode === 404 || err?.statusCode === 410)
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      })));
  return Response.json({ ok: true, doc: doc.id, enviados: (subs || []).length });
});
