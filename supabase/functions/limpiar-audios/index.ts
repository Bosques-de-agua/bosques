// LIMPIAR AUDIOS — borra los audios del chat de más de seis meses.
//
// La llama un cron una vez por semana (ver supabase/schema.sql, punto 12 y el
// README). Se deploya igual que notify-chat: Edge Functions → Via Editor, con el
// nombre `limpiar-audios`.
//
// Por qué por la API y no con un DELETE en SQL: borrar la fila de
// storage.objects deja el archivo huérfano en el bucket, ocupando espacio.
//
// Qué NO hace: no toca los mensajes. El mensaje queda y la app muestra "Audio
// vencido". Borrarlo desde acá no serviría: la fila compartida la pisa el último
// que guarda, y cualquier pestaña abierta lo haría volver.
//
// Llamarla de más no hace daño: solo borra lo que ya tenía que borrarse.

import { createClient } from "npm:@supabase/supabase-js@2";

const DIAS = 183; // seis meses. Tiene que coincidir con VENCE_DIAS en src/audios.js
const LOTE = 100; // la API de Storage borra de a lotes

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let borrados = 0;
  // Con un tope de vueltas, por si algo no se deja borrar: que no quede girando.
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const { data, error } = await supabase.rpc("audios_vencidos", { dias: DIAS, tope: 500 });
    if (error) {
      console.error("no pude listar los vencidos:", error.message);
      return Response.json({ ok: false, borrados, error: error.message }, { status: 500 });
    }
    const rutas = (data || []).map((r: { ruta: string }) => r.ruta);
    if (!rutas.length) break;

    let estaVuelta = 0;
    for (let i = 0; i < rutas.length; i += LOTE) {
      const tanda = rutas.slice(i, i + LOTE);
      const { data: fuera, error: e2 } = await supabase.storage.from("chat-audios").remove(tanda);
      if (e2) {
        console.error("falló un lote:", e2.message);
        return Response.json({ ok: false, borrados, error: e2.message }, { status: 500 });
      }
      estaVuelta += (fuera || []).length;
    }
    borrados += estaVuelta;
    // Si en una vuelta entera no se borró nada, seguir sería un bucle infinito.
    if (!estaVuelta) break;
  }

  console.log(`limpiar-audios: ${borrados} audio(s) de más de ${DIAS} días borrado(s)`);
  return Response.json({ ok: true, borrados, dias: DIAS });
});
