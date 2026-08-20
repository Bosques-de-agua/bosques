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
  const { error } = await supabase.from("user_private").upsert({
    email,
    data: payload,
    updated_at: new Date().toISOString(),
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
  if (onEstado) onEstado("guardado");
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
