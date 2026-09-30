import { supabase } from "./supabaseClient.js";

// Datos que solo ve su dueño: tareas privadas y notas personales.
// Viven en `user_private`, una fila por email, con permisos que impiden
// que otra persona la lea. NO viajan en el estado compartido del equipo.

import { TablaFaltante } from "./team.js";

export async function fetchPrivateState(email) {
  const { data, error } = await supabase
    .from("user_private")
    .select("data,updated_at")
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
  // Lo que se acaba de leer es el punto de partida para mezclar más tarde.
  base = data ? copia(data.data) : null;
  visto = data && data.updated_at ? Date.parse(data.updated_at) : 0;
  return data ? data.data : null;
}

// ── Dos dispositivos, una sola fila ──────────────────────────────────────
// Tus datos privados son UNA fila y cada guardado la manda entera. Con la app
// abierta en la compu y en el celular, la copia vieja de uno pisaba lo que
// acababas de anotar en el otro (pasó el primer día de los recordatorios: uno
// creado en un dispositivo desapareció cuando el otro guardó una nota).
// Ahora, antes de escribir, se mira si alguien más escribió desde la última
// vez que leímos. Si sí, se MEZCLA en vez de pisar, comparando tres copias:
// la base (lo último que sabíamos que había), la local y la remota.
//   · está en la remota y no en la local: si estaba en la base, acá se borró
//     (no vuelve); si no estaba, es nuevo de allá (entra).
//   · está en la local y no en la remota: si estaba en la base, allá se borró
//     (se va, salvo que acá se haya cambiado); si no, es nuevo de acá (queda).
//   · está en las dos: gana la local si cambió respecto de la base; si no, la remota.
// Vale para las listas de cosas con `id` (recordatorios, tareas privadas,
// notas). Lo que no sea una lista así se queda con la versión local.
let base = null;
let visto = 0;
let onMezcla = null;
const copia = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const esLista = (v) => Array.isArray(v) && v.every((x) => x && typeof x === "object" && typeof x.id === "string");
export function setPrivateMergedHandler(fn) {
  onMezcla = fn;
}
export function mezclarPrivado(b, local, remoto) {
  const out = Object.assign({}, remoto || {}, local || {});
  for (const k of Object.keys(out)) {
    const L = local ? local[k] : undefined, R = remoto ? remoto[k] : undefined, B = b ? b[k] : undefined;
    if (!esLista(L || []) || !esLista(R || []) || !Array.isArray(L) || !Array.isArray(R)) continue;
    const enB = new Map((esLista(B || []) && Array.isArray(B) ? B : []).map((x) => [x.id, JSON.stringify(x)]));
    const enR = new Map(R.map((x) => [x.id, x]));
    const enL = new Set(L.map((x) => x.id));
    const lista = [];
    for (const x of L) {
      const cambio = enB.get(x.id) !== JSON.stringify(x);
      if (enR.has(x.id)) lista.push(cambio ? x : enR.get(x.id));
      else if (!enB.has(x.id) || cambio) lista.push(x);
    }
    for (const x of R) if (!enL.has(x.id) && !enB.has(x.id)) lista.push(x);
    out[k] = lista;
  }
  return out;
}

let saveTimer = null;
let pending = null;
let onEstado = null;
let escribiendo = false;

// Tus notas y tus tareas privadas merecen el mismo cuidado que el contenido
// del equipo: un fallo acá también tiene que verse en pantalla.
export function setPrivateSaveStateHandler(fn) {
  onEstado = fn;
}
export function hayPrivadoSinGuardar() {
  return !!pending || escribiendo;
}

// Mismo cuidado que en sync.js, y por la misma razón: un reintento de una
// versión vieja no puede escribirse encima de una nueva que ya salió bien.
// Acá duele más todavía, porque son tus notas y nadie más las tiene.
// Descartar lo viejo es seguro: cada guardado manda tu porción completa.
let generacion = 0;

const REINTENTOS = 3;
async function escribir(email, payload, intento = 0, mia = generacion) {
  if (mia !== generacion) return;
  escribiendo = true;
  // ¿Escribió otro dispositivo desde la última vez que leímos? Entonces se
  // mezcla. Si no se puede averiguar, se guarda como siempre.
  let mezclado = false;
  try {
    const r = await supabase.from("user_private").select("data,updated_at").eq("email", email).maybeSingle();
    const fila = r && r.data;
    if (fila && fila.updated_at && Date.parse(fila.updated_at) !== visto) {
      payload = mezclarPrivado(base, payload, fila.data);
      mezclado = true;
    }
  } catch (e) { /* sin lectura previa: se escribe lo local */ }
  if (mia !== generacion) { return; }
  const ahora = new Date().toISOString();
  const { error } = await supabase.from("user_private").upsert({
    email,
    data: payload,
    updated_at: ahora,
  });
  // Entró algo más nuevo mientras se escribía: el resultado de ésta ya no
  // manda. `escribiendo` queda como está, que es el lado seguro.
  if (mia !== generacion) return;
  if (error) {
    console.error("No se pudieron guardar tus datos privados (intento " + (intento + 1) + "):", error);
    if (intento + 1 < REINTENTOS) {
      setTimeout(() => escribir(email, payload, intento + 1, mia), 900 * (intento + 1));
      return;
    }
    escribiendo = false;
    if (onEstado) onEstado("error", error);
    return;
  }
  escribiendo = false;
  base = copia(payload);
  visto = Date.parse(ahora);
  if (onEstado) onEstado("guardado");
  // Lo mezclado trae cosas del otro dispositivo: la pantalla tiene que enterarse.
  if (mezclado && onMezcla && !pending) onMezcla(copia(payload));
}

export function pushPrivateState(email, data) {
  generacion++;
  pending = data;
  if (onEstado) onEstado("guardando");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const payload = pending;
    pending = null;
    escribir(email, payload);
  }, 700);
}
