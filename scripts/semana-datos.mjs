// QUÉ PASÓ LA SEMANA PASADA — baja las dos fotos del equipo e imprime el
// informe crudo que después lee la IA.
//
//   node scripts/semana-datos.mjs            → la semana que terminó ayer
//   node scripts/semana-datos.mjs 2026-09-14 → la semana que arranca ese lunes
//
// Compara la foto de hoy (`app_state`) contra la del lunes pasado
// (`app_state_backup`, que guarda una copia por hora). Por eso ve cosas que el
// estado actual por sí solo no muestra: una tarea creada Y terminada dentro de
// la semana, una que cambió de estado, una que alguien reabrió.
//
// La cuenta la hace `semana-informe.mjs`, que no toca la red y se puede probar
// solo (`node scripts/semana-informe.prueba.mjs`). Acá solo está la parte que
// habla con Supabase.
//
// Necesita SUPABASE_SERVICE_ROLE_KEY en .env.local (ese archivo no va al repo).
// Es la clave que saltea los permisos: vive solo en la máquina de Nico, porque
// la tabla de respaldos no se puede leer con la sesión de nadie.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { informeSemanal, lunesDe, semanaPasada, ymd } from "./semana-informe.mjs";

function env() {
  const out = {};
  try {
    for (const linea of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
      const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* si no está, mandan las variables del sistema */ }
  return { ...out, ...process.env };
}
const E = env();
const URL_SB = E.SUPABASE_URL || E.VITE_SUPABASE_URL;
const KEY = E.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SB || !KEY) {
  console.error("Falta SUPABASE_SERVICE_ROLE_KEY (o la URL) en .env.local.");
  console.error("Está en el panel de Supabase → Project Settings → API → service_role.");
  process.exit(1);
}
const sb = createClient(URL_SB, KEY, { auth: { persistSession: false } });

const arg = process.argv[2];
let inicio, fin;
if (arg) {
  inicio = lunesDe(new Date(arg + "T12:00:00"));
  fin = new Date(inicio); fin.setDate(fin.getDate() + 6); fin.setHours(23, 59, 59, 999);
} else {
  ({ inicio, fin } = semanaPasada());
}

const { data: actual, error: e1 } = await sb.from("app_state").select("data").eq("id", 1).single();
if (e1) { console.error("No pude leer app_state:", e1.message); process.exit(1); }

// La copia más nueva de ANTES del lunes: el equipo tal como estaba al empezar.
const { data: copias, error: e2 } = await sb
  .from("app_state_backup").select("taken_at,data")
  .eq("kind", "app_state").lt("taken_at", inicio.toISOString())
  .order("taken_at", { ascending: false }).limit(1);
if (e2) { console.error("No pude leer app_state_backup:", e2.message); process.exit(1); }

const { texto, cuentas } = informeSemanal({
  hoy: actual.data,
  antes: copias && copias[0] ? copias[0].data : null,
  antesDe: copias && copias[0] ? copias[0].taken_at : null,
  inicio, fin,
});
console.log(texto);
console.error(`\n[${ymd(inicio)} → ${ymd(fin)}] ` + Object.entries(cuentas).map(([k, v]) => `${k}:${v}`).join(" "));
