import { supabase } from "./supabaseClient.js";

// El equipo vive en la base, no dentro del estado compartido.
// La identidad de cada persona es su EMAIL: el nombre es solo la etiqueta
// que se muestra, y puede cambiarse sin romper nada.

export async function fetchTeam() {
  const { data, error } = await supabase
    .from("team_members")
    .select("email,name,color,avatar")
    .order("name");
  if (error) throw error;
  return data || [];
}

// Alta o actualización de la propia ficha. Los permisos de la base impiden
// tocar la de otra persona, así que no hace falta chequearlo acá.
export async function upsertMe({ email, name, color, avatar }) {
  const row = { email, name };
  if (color !== undefined) row.color = color;
  if (avatar !== undefined) row.avatar = avatar;
  const { error } = await supabase.from("team_members").upsert(row);
  if (error) throw error;
}

export async function fetchAllowed() {
  const { data, error } = await supabase.from("allowed_emails").select("email");
  if (error) throw error;
  return (data || []).map((r) => r.email);
}

// Habilitar a alguien nuevo: alcanza con su correo. Entra con su propio
// enlace de acceso y completa su nombre la primera vez.
export async function inviteEmail(email) {
  const limpio = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) {
    throw new Error("Ese correo no parece válido.");
  }
  const { error } = await supabase.from("allowed_emails").insert({ email: limpio });
  if (error && error.code !== "23505") throw error; // 23505 = ya estaba
  return limpio;
}
