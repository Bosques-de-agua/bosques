import { supabase, CLIENT_ID } from "./supabaseClient.js";

const ROW_ID = 1;

export async function fetchRemoteState() {
  const { data, error } = await supabase
    .from("app_state")
    .select("data")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}

let saveTimer = null;
export function pushRemoteState(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { error } = await supabase.from("app_state").upsert({
      id: ROW_ID,
      data: state,
      updated_by_client: CLIENT_ID,
      updated_at: new Date().toISOString(),
    });
    if (error) console.error("No se pudo guardar en Supabase:", error);
  }, 350);
}

export function subscribeRemoteState(onRemoteChange) {
  return supabase
    .channel("app_state_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_state", filter: `id=eq.${ROW_ID}` },
      (payload) => {
        if (!payload.new || payload.new.updated_by_client === CLIENT_ID) return;
        if (payload.new.data) onRemoteChange(payload.new.data);
      }
    )
    .subscribe();
}
