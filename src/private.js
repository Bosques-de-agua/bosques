import { supabase } from "./supabaseClient.js";

// Datos que solo ve su dueño: tareas privadas y notas personales.
// Viven en `user_private`, una fila por email, con permisos que impiden
// que otra persona la lea. NO viajan en el estado compartido del equipo.

import { TablaFaltante } from "./team.js";

export async function fetchPrivateState(email) {
  const { data, error } = await supabase
    .from("user_private")
    .select("data")
    .eq("email", email)
    .maybeSingle();
  if (error) {
    // Si la tabla todavía no existe (falta correr el schema), se avisa aparte
    // para que la app arranque igual en vez de dejar a todos afuera.
    if (
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      /does not exist|schema cache/i.test(error.message || "")
    ) {
      throw new TablaFaltante(error.message);
    }
    throw error;
  }
  return data ? data.data : null;
}

let saveTimer = null;
let pending = null;

export function pushPrivateState(email, data) {
  pending = data;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const payload = pending;
    pending = null;
    const { error } = await supabase.from("user_private").upsert({
      email,
      data: payload,
      updated_at: new Date().toISOString(),
    });
    if (error) console.error("No se pudieron guardar tus datos privados:", error);
  }, 700);
}
