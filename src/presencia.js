// QUIÉN ESTÁ EN LÍNEA — el circulito verde del chat.
//
// Usa Presence, que viene adentro de Supabase Realtime: es el mismo websocket
// que ya trae los cambios en vivo, así que no hay una conexión nueva ni una
// tabla nueva ni nada que guardar. Cada quien "se anuncia" al entrar y el
// servidor le avisa al resto; cuando el socket se corta —cerrás la pestaña, el
// celular se duerme, se cae internet— el anuncio se cae solo y los demás lo ven
// desaparecer. No hay que acordarse de despedirse.
//
// Qué significa el punto verde, exactamente: esa persona tiene la app abierta
// AHORA. Nada más que eso. No dice que esté mirando la pantalla.
import { supabase } from "./supabaseClient.js";

let canal = null;

export function initPresencia(email, nombre, alCambiar) {
  if (!email || canal) return null;
  canal = supabase.channel("presencia-equipo", {
    config: { presence: { key: email } },
  });

  const avisar = () => {
    const estado = canal.presenceState() || {};
    // Se avisa por NOMBRE porque es con lo que la app dibuja la lista del chat,
    // pero la clave del canal es el correo: si alguien abre la app en la compu
    // y en el teléfono, sigue siendo una sola persona en línea.
    const nombres = new Set();
    Object.values(estado).forEach((entradas) => {
      (entradas || []).forEach((e) => { if (e && e.nombre) nombres.add(e.nombre); });
    });
    try { alCambiar(nombres); } catch (err) { console.error("presencia:", err); }
  };

  canal
    .on("presence", { event: "sync" }, avisar)
    .on("presence", { event: "join" }, avisar)
    .on("presence", { event: "leave" }, avisar)
    .subscribe(async (estado) => {
      if (estado !== "SUBSCRIBED") return;
      try { await canal.track({ email, nombre }); }
      catch (err) { console.error("No se pudo anunciar la presencia:", err); }
    });

  // Al renombrarse hay que volver a anunciarse, o el resto sigue viendo el
  // nombre viejo con el punto verde al lado.
  return {
    actualizarNombre(nuevo) {
      if (!canal) return;
      canal.track({ email, nombre: nuevo }).catch(() => {});
    },
  };
}
