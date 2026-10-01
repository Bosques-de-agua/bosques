import { supabase, CLIENT_ID } from "./supabaseClient.js";
import { mezclar3 } from "./mezcla.js";

const ROW_ID = 1;

export async function fetchRemoteState() {
  const { data, error } = await supabase
    .from("app_state")
    .select("data,updated_at")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) throw error;
  if (data) conocida(data.data, data.updated_at);
  return data ? data.data : null;
}

// ── Sobre qué versión trabaja este dispositivo ───────────────────────────
// Lo que pasó el 01/10: un celular dormido desde el mediodía se despertó a la
// mañana siguiente con su copia vieja, guardó (la app archivó sola una tarea
// terminada) y, como cada guardado manda el estado ENTERO, su copia pisó una
// tarde de trabajo del equipo. Nada le preguntaba si estaba al día.
//
// Ahora cada guardado se escribe con la condición "solo si la base sigue en la
// versión sobre la que trabajé" (`updated_at`). Si alguien escribió en el
// medio, la base no acepta, se relee y se MEZCLA (mezcla.js) en vez de pisar.
//
// `base` es la última copia que este dispositivo sabe que estuvo en la base,
// y `version` su `updated_at`. Cada contenido que sale a guardarse se lleva la
// base que había cuando la app lo armó: si mientras esperaba llegó un cambio
// de otro, la mezcla igual sabe qué tocaste vos y qué no.
let base = null;
let version = null;
const copia = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
function conocida(data, updatedAt) {
  base = copia(data);
  version = updatedAt || null;
}
let onMezcla = null;
// La mezcla trae cosas de otro: la pantalla tiene que enterarse.
export function setRemoteMergedHandler(fn) {
  onMezcla = fn;
}
// Para las pruebas y para mirar desde la consola.
export function versionConocida() {
  return version;
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
// Lo último que se intentó guardar y NO entró. Se queda acá hasta que entre.
//
// Sin esto había un agujero feo: cuando un guardado fallaba definitivamente,
// `pendiente` ya se había consumido y `escribiendo` volvía a false, así que la
// app creía que no quedaba nada sin guardar. Trabajabas sin conexión, volvía la
// conexión, la app releía del servidor y te reemplazaba todo lo escrito por la
// versión vieja. Trabajo perdido, en silencio, justo en el momento en que
// parecía que se recuperaba.
let ultimoFallido = null;

export function hayCambiosSinGuardar() {
  return !!pendiente || escribiendo || !!ultimoFallido;
}
// Volver a intentar lo que quedó afuera. Se llama al recuperar la conexión y
// desde el botón "Reintentar" del cartel de error.
export function reintentarPendiente() {
  if (!ultimoFallido) return false;
  const { state, sobre } = ultimoFallido;
  ultimoFallido = null;
  generacion++;
  escribir(state, 0, generacion, sobre);
  return true;
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
const MAX_CHOQUES = 5;
// Una escritura condicionada a la versión. Devuelve { error }, o { choque: true }
// si la base ya no está en esa versión, o { ok, updatedAt }.
// Una excepción acá (en vez de un error devuelto) dejaba el guardado colgado
// en "guardando" para siempre, sin alarma: se convierte en error común.
async function escribirSiSigue(state, sobre) {
  try {
    return await escribirSiSigueSinRed(state, sobre);
  } catch (e) {
    return { error: e };
  }
}
async function escribirSiSigueSinRed(state, sobre) {
  const fila = {
    data: state,
    updated_by_client: CLIENT_ID,
    updated_by_email: EMAIL || null,
    updated_at: new Date().toISOString(),
  };
  // Sin versión conocida (la fila no existía al arrancar) no hay contra qué
  // comparar: es la primera escritura de todas.
  if (!sobre.version) {
    const { error } = await supabase.from("app_state").upsert({ id: ROW_ID, ...fila });
    return error ? { error } : { ok: true, updatedAt: fila.updated_at };
  }
  const { data, error } = await supabase
    .from("app_state").update(fila)
    .eq("id", ROW_ID).eq("updated_at", sobre.version)
    .select("updated_at");
  if (error) return { error };
  if (!data || !data.length) return { choque: true };
  return { ok: true, updatedAt: data[0].updated_at };
}

async function escribir(state, intento = 0, mia = generacion, sobre = { base, version }) {
  if (mia !== generacion) return false;
  escribiendo = true;
  if (onEstado) onEstado("guardando");
  const desde = sobre.version;
  let r = await escribirSiSigue(state, sobre);
  let mezclado = false;
  // Alguien escribió en el medio: se relee, se mezcla y se vuelve a probar
  // sobre la versión nueva. Nunca se escribe a ciegas.
  for (let choques = 0; r.choque && choques < MAX_CHOQUES; choques++) {
    if (mia !== generacion) return false;
    let fila = null, errLeer = null;
    try {
      ({ data: fila, error: errLeer } = await supabase
        .from("app_state").select("data,updated_at").eq("id", ROW_ID).maybeSingle());
    } catch (e) { errLeer = e; }
    if (errLeer || !fila) { r = { error: errLeer || { message: "no se pudo releer la base" } }; break; }
    state = mezclar3(sobre.base, state, fila.data);
    sobre = { base: fila.data, version: fila.updated_at };
    mezclado = true;
    if (mia !== generacion) return false;
    r = await escribirSiSigue(state, sobre);
  }
  if (r.choque) r = { error: { message: "la base cambió muchas veces seguidas mientras se guardaba" } };
  const error = r.error || null;
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
      setTimeout(() => escribir(state, intento + 1, mia, sobre), 900 * (intento + 1));
      return false;
    }
    escribiendo = false;
    // Se guarda lo que no entró: mientras esté acá, la app sabe que hay trabajo
    // sin salvar y NO va a releer del servidor encima. Se guarda CON su base:
    // si sale recién horas después, va a chocar y mezclarse, no a pisar.
    ultimoFallido = { state, sobre };
    if (onEstado) onEstado("error", error);
    if (onError) onError(error);
    return false;
  }
  escribiendo = false;
  ultimoFallido = null;
  // Lo que acaba de entrar pasa a ser la base. Salvo que mientras tanto se haya
  // enterado de algo más nuevo (un aviso en vivo de otro): ese manda.
  if (!version || version === desde || version === sobre.version) conocida(state, r.updatedAt);
  if (onEstado) onEstado("guardado");
  if (mezclado && onMezcla && !pendiente) onMezcla(copia(state));
  return true;
}

let pendienteSobre = null;
export function pushRemoteState(state) {
  generacion++;
  // La base es la que había cuando la app ARMÓ este contenido, no la que habrá
  // cuando salga: si en esos 350 ms llega un cambio de otro, la mezcla tiene
  // que saber que eso no lo tocaste vos.
  if (!pendiente) pendienteSobre = { base, version };
  pendiente = state;
  if (onEstado) onEstado("guardando");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const payload = pendiente, sobre = pendienteSobre;
    pendiente = null;
    escribir(payload, 0, generacion, sobre);
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

// Va con la misma condición de versión que el camino normal. Si alguien
// escribió en el medio, la base no lo acepta y este último cambio se pierde.
// Es el único caso, y es mucho mejor que lo de antes: pisar todo lo ajeno.
function escribirAlVuelo(payload, sobre) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!TOKEN || !url || !anon || !sobre || !sobre.version) return false;
  const cuerpo = JSON.stringify({
    data: payload,
    updated_by_client: CLIENT_ID,
    updated_by_email: EMAIL || null,
    updated_at: new Date().toISOString(),
  });
  if (cuerpo.length > TOPE_KEEPALIVE) return false;
  try {
    fetch(url + "/rest/v1/app_state?id=eq." + ROW_ID + "&updated_at=eq." + encodeURIComponent(sobre.version), {
      method: "PATCH",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: "Bearer " + TOKEN,
        Prefer: "return=minimal",
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
  const payload = pendiente, sobre = pendienteSobre;
  pendiente = null;
  generacion++; // este es el último: cualquier reintento viejo queda invalidado
  // Solo cuando la página se está yendo se usa keepalive, porque ese camino no
  // puede avisar si falla. Pasar a segundo plano no es irse: ahí la página
  // sigue viva y conviene el camino normal, que sí avisa.
  if (seVa && escribirAlVuelo(payload, sobre)) return;
  escribir(payload, 0, generacion, sobre);
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
        // (No se descartan avisos por fecha: `updated_at` lo pone el reloj de
        // cada dispositivo y no son comparables entre sí. Solo sirve como
        // marca de versión, por igualdad.)
        if (payload.new.data) {
          conocida(payload.new.data, payload.new.updated_at);
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
