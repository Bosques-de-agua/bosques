// RESUMEN DE LA SEMANA — leer lo que escribió la tarea de los lunes.
//
// La app solo LEE. El texto lo escribe una tarea programada de Claude Code que
// corre en la máquina de Nico los lunes: mira qué pasó en la semana y lo
// cuenta. La tabla y sus permisos están en supabase/resumen-semanal.sql, y no
// tiene políticas de escritura a propósito — desde acá no se puede escribir ni
// por error.
//
// Por qué no vive en `app_state` como todo lo demás: esa es una sola fila que
// cada navegador reescribe entera al guardar, así que lo que escribiera la
// tarea lo pisaría el primero que tocara cualquier cosa.

import { supabase } from "./supabaseClient.js";

// Los últimos, del más nuevo al más viejo. Si la lectura falla —sin sesión, sin
// red, o la tabla todavía no creada— devuelve null y la pantalla lo dice: una
// lista vacía significaría "todavía no hay ninguno", que es otra cosa.
export async function cargarResumenes(tope = 12) {
  try {
    const { data, error } = await supabase
      .from("resumenes")
      .select("desde,hasta,texto,modelo,creado_at")
      .order("desde", { ascending: false })
      .limit(tope);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (e) {
    // La tabla todavía no existe (falta correr supabase/resumen-semanal.sql):
    // eso no es una falla de lectura, es que todavía no hay ningún resumen. Sin
    // esto, la pantalla diría "no pudimos leerlos" y parecería algo roto.
    const cod = (e && (e.code || "")) + " " + (e && e.message ? e.message : "");
    if (/42P01|PGRST205|does not exist|Could not find the table/i.test(cod)) return [];
    console.error("No se pudieron leer los resúmenes:", e && e.message ? e.message : e);
    return null;
  }
}
