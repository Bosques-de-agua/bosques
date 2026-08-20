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
let onEstado = null;
let escribiendo = false;

export function setSaveErrorHandler(fn) {
  onError = fn;
}
// La app necesita saber si lo que hiciste ya está a salvo. Sin esto, un fallo
// de red era una línea en la consola que nadie mira: seguías trabajando una
// hora creyendo que se guardaba, cerrabas la pestaña y no quedaba nada.
export function setSaveStateHandler(fn) {
  onEstado = fn;
}
export function hayCambiosSinGuardar() {
  return !!pendiente || escribiendo;
}

// Cada contenido que entra a la cola se lleva un número. Un intento sigue vivo
// solo mientras su número sea el último; si mientras esperaba entró algo más
// nuevo, se calla y le deja el lugar.
//
// Sin esto había una forma silenciosa de perder lo escrito: una escritura
// fallaba y se agendaba el reintento; seguías escribiendo y la versión nueva
// salía bien; y entonces el reintento de la versión VIEJA la escribía encima.
// La pantalla decía "guardado" y lo del medio ya no estaba.
//
// Descartar lo viejo es seguro porque cada guardado manda el estado COMPLETO,
// no un pedacito: lo nuevo ya contiene lo que traía lo viejo.
let generacion = 0;

const REINTENTOS = 3;
async function escribir(state, intento = 0, mia = generacion) {
  if (mia !== generacion) return false;
  escribiendo = true;
  if (onEstado) onEstado("guardando");
  const { error } = await supabase.from("app_state").upsert({
    id: ROW_ID,
    data: state,
    updated_by_client: CLIENT_ID,
    updated_by_email: EMAIL || null,
    updated_at: new Date().toISOString(),
  });
  // Mientras se escribía entró algo más nuevo: el resultado de ESTA escritura
  // ya no manda, ni para bien ni para mal. Avisa la que viene atrás.
  // No se toca `escribiendo`: dejarlo en true mientras la nueva no termine es
  // el lado seguro, porque es lo que hace que la pestaña pregunte al cerrarse.
  if (mia !== generacion) return false;
  if (error) {
    console.error("No se pudo guardar en Supabase (intento " + (intento + 1) + "):", error);
    // Un corte de red de dos segundos no tiene por qué costarle el trabajo a
    // nadie: se reintenta con esperas crecientes antes de dar la alarma.
    if (intento + 1 < REINTENTOS) {
      setTimeout(() => escribir(state, intento + 1, mia), 900 * (intento + 1));
      return false;
    }
    escribiendo = false;
    if (onEstado) onEstado("error", error);
    if (onError) onError(error);
    return false;
  }
  escribiendo = false;
  if (onEstado) onEstado("guardado");
  return true;
}

export function pushRemoteState(state) {
  generacion++;
  pendiente = state;
  if (onEstado) onEstado("guardando");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const payload = pendiente;
    pendiente = null;
    escribir(payload);
  }, 350);
}

// El último guardado, cuando la pestaña se está yendo de verdad.
//
// `escribir()` manda un fetch normal, y el navegador tiene todo el derecho de
// matar la página antes de que salga — en el celular lo hace. `keepalive` le
// pide que lo mande igual aunque la página ya no exista. Tiene un tope duro de
// 64 KB: si el estado no entra, se cae al camino de siempre y lo que protege
// es la pregunta del navegador al cerrar.
const TOPE_KEEPALIVE = 60 * 1024;
let TOKEN = "";
supabase.auth.getSession().then(({ data }) => { TOKEN = (data && data.session && data.session.access_token) || ""; });
supabase.auth.onAuthStateChange((_evento, session) => { TOKEN = (session && session.access_token) || ""; });

function escribirAlVuelo(payload) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!TOKEN || !url || !anon) return false;
  const cuerpo = JSON.stringify({
    id: ROW_ID,
    data: payload,
    updated_by_client: CLIENT_ID,
    updated_by_email: EMAIL || null,
    updated_at: new Date().toISOString(),
  });
  if (cuerpo.length > TOPE_KEEPALIVE) return false;
  try {
    fetch(url + "/rest/v1/app_state?on_conflict=id", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: "Bearer " + TOKEN,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: cuerpo,
    }).catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

// Se vacía lo que quedó esperando en la cola: si no, todo cambio hecho en el
// último instante se pierde sin aviso.
function vaciar(seVa) {
  if (!pendiente) return;
  clearTimeout(saveTimer);
  const payload = pendiente;
  pendiente = null;
  generacion++; // este es el último: cualquier reintento viejo queda invalidado
  // Solo cuando la página se está yendo se usa keepalive, porque ese camino no
  // puede avisar si falla. Pasar a segundo plano no es irse: ahí la página
  // sigue viva y conviene el camino normal, que sí avisa.
  if (seVa && escribirAlVuelo(payload)) return;
  escribir(payload);
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") vaciar(false);
  });
  window.addEventListener("pagehide", () => vaciar(true));
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
