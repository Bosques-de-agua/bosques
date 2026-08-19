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
let pendiente = null;
let onError = null;

export function setSaveErrorHandler(fn) {
  onError = fn;
}

async function escribir(state) {
  const { error } = await supabase.from("app_state").upsert({
    id: ROW_ID,
    data: state,
    updated_by_client: CLIENT_ID,
    updated_by_email: EMAIL || null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("No se pudo guardar en Supabase:", error);
    if (onError) onError(error);
    return false;
  }
  return true;
}

export function pushRemoteState(state) {
  pendiente = state;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const payload = pendiente;
    pendiente = null;
    escribir(payload);
  }, 350);
}

// Al cerrar la pestaña o mandarla al fondo, se vacía lo que quedó esperando:
// si no, todo cambio hecho en el último instante se pierde sin aviso.
function vaciar() {
  if (!pendiente) return;
  clearTimeout(saveTimer);
  const payload = pendiente;
  pendiente = null;
  escribir(payload);
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") vaciar();
  });
  window.addEventListener("pagehide", vaciar);
}

// El email de quien está usando la app, para que las notificaciones no le
// avisen de sus propios cambios.
let EMAIL = "";
export function setClientEmail(email) {
  EMAIL = email || "";
}

export function subscribeRemoteState(onRemoteChange) {
  return supabase
    .channel("app_state_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_state", filter: `id=eq.${ROW_ID}` },
      async (payload) => {
        if (!payload.new || payload.new.updated_by_client === CLIENT_ID) return;
        if (payload.new.data) {
          onRemoteChange(payload.new.data);
          return;
        }
        // Realtime descarta los avisos que superan su límite de tamaño y manda
        // uno vacío. Sin esto la app deja de recibir cambios y nadie se entera.
        console.warn("Aviso de cambio sin contenido (demasiado grande). Releyendo.");
        try {
          const fresco = await fetchRemoteState();
          if (fresco) onRemoteChange(fresco);
        } catch (err) {
          console.error("No se pudo releer el estado tras un aviso incompleto:", err);
        }
      }
    )
    .subscribe();
}
