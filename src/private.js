import { supabase } from "./supabaseClient.js";

// Datos que solo ve su dueño: tareas privadas y notas personales.
// Viven en `user_private`, una fila por email, con permisos que impiden
// que otra persona la lea. NO viajan en el estado compartido del equipo.

export async function fetchPrivateState(email) {
  const { data, error } = await supabase
    .from("user_private")
    .select("data")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
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
