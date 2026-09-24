// GUARDAR EL RESUMEN DE LA SEMANA — lo único que escribe en la tabla.
//
//   node scripts/semana-guardar.mjs <archivo.md> <desde> <hasta> [modelo]
//   node scripts/semana-guardar.mjs resumen.md 2026-09-14 2026-09-20 claude-opus-5
//
// `desde` es el lunes que abre la semana y es la clave de la tabla: volver a
// correrlo con el mismo lunes REEMPLAZA el resumen en vez de dejar dos. Eso es
// lo que uno quiere al reintentar algo que salió mal.
//
// El texto va en markdown simple, que es lo único que la pantalla sabe leer:
// `## título`, `- lista`, `**negrita**` y un renglón en blanco entre párrafos.
// Cualquier otra cosa se muestra como texto pelado (la app escapa todo antes de
// dibujarlo), así que no rompe nada, pero tampoco se ve como uno espera.
//
// Necesita SUPABASE_SERVICE_ROLE_KEY en .env.local: la tabla `resumenes` no
// tiene políticas de escritura, así que desde la app no se puede escribir.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
if (!URL_SB || !KEY) { console.error("Falta SUPABASE_SERVICE_ROLE_KEY (o la URL) en .env.local."); process.exit(1); }

const [archivo, desde, hasta, modelo] = process.argv.slice(2);
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
if (!archivo || !esFecha(desde) || !esFecha(hasta)) {
  console.error("Uso: node scripts/semana-guardar.mjs <archivo.md> <desde AAAA-MM-DD> <hasta AAAA-MM-DD> [modelo]");
  process.exit(1);
}
const texto = readFileSync(archivo, "utf8").trim();
// Un resumen vacío sería peor que ninguno: la pantalla mostraría una tarjeta
// en blanco en vez de decir "todavía no hay".
if (texto.length < 40) { console.error("El resumen está vacío o es demasiado corto; no lo guardo."); process.exit(1); }

const sb = createClient(URL_SB, KEY, { auth: { persistSession: false } });
const { error } = await sb.from("resumenes")
  .upsert({ desde, hasta, texto, modelo: modelo || null, creado_at: new Date().toISOString() }, { onConflict: "desde" });
if (error) { console.error("No se pudo guardar:", error.message); process.exit(1); }
console.log(`Guardado el resumen del ${desde} al ${hasta} (${texto.length} caracteres).`);
