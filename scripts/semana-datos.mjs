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

// Las DOS puntas de la semana. Los respaldos se guardan solo cuando el
// contenido cambió, así que "el último de antes del lunes" y "el último de
// antes del lunes siguiente" son exactamente el estado al abrir y al cerrar.
async function copiaAntesDe(fecha) {
  const { data, error } = await sb
    .from("app_state_backup").select("taken_at,data")
    .eq("kind", "app_state").lt("taken_at", fecha.toISOString())
    .order("taken_at", { ascending: false }).limit(1);
  if (error) { console.error("No pude leer app_state_backup:", error.message); process.exit(1); }
  return (data && data[0]) ? data[0] : null;
}
const abre = await copiaAntesDe(inicio);
let cierra = await copiaAntesDe(new Date(fin.getTime() + 1));

// Si no hay ningún respaldo dentro de la semana, la única foto del cierre es el
// estado actual. Con la tarea corriendo el lunes temprano la diferencia son
// horas; si la máquina estuvo apagada varios días, se avisa.
let nota = "";
if (!cierra || cierra.taken_at <= (abre ? abre.taken_at : "")) {
  const { data: actual, error } = await sb.from("app_state").select("data").eq("id", 1).single();
  if (error) { console.error("No pude leer app_state:", error.message); process.exit(1); }
  cierra = { taken_at: "el estado de HOY (no hubo respaldos dentro de la semana)", data: actual.data };
  nota = "AVISO: no hay respaldo del cierre de la semana; se usó el estado actual, así que puede incluir cambios posteriores al domingo.";
}

const { texto, cuentas } = informeSemanal({
  antes: abre ? abre.data : null,
  antesDe: abre ? abre.taken_at : null,
  despues: cierra.data,
  despuesDe: cierra.taken_at,
  inicio, fin,
});
if (nota) console.log(nota + "\n");
console.log(texto);
console.error(`\n[${ymd(inicio)} → ${ymd(fin)}] ` + Object.entries(cuentas).map(([k, v]) => `${k}:${v}`).join(" "));
