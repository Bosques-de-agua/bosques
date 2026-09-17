// AUDIOS DEL CHAT — grabar, subir y reproducir.
//
// Por qué no van adentro del mensaje, como los demás adjuntos: los adjuntos del
// chat se guardan en la fila compartida (tope 400 KB) y todo el equipo la carga
// en cada cambio. Un audio ahí la engordaría para siempre, y cuanto más pesa
// cada guardado, más fácil es que dos se pisen (ya pasó). Así que el archivo va
// al bucket privado `chat-audios` y el mensaje guarda solo su ruta. Las
// políticas están en supabase/schema.sql, punto 11.

import { supabase } from "./supabaseClient.js";

const BUCKET = "chat-audios";
export const MAX_SEG = 5 * 60;
// A los seis meses el archivo se borra solo (función limpiar-audios, una vez por
// semana). Tiene que coincidir con DIAS en supabase/functions/limpiar-audios.
export const VENCE_DIAS = 183;

export const grabadorDisponible = () =>
  typeof window !== "undefined" &&
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
  typeof window.MediaRecorder !== "undefined";

// Chrome y Android graban webm/opus; Safari, mp4. Se elige el primero que el
// navegador soporte. El tipo que se guarda va sin los parámetros de códec,
// porque el bucket valida contra una lista de tipos simples.
function elegirTipo() {
  const ops = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return ops.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
}
const tipoSimple = (t) => String(t || "audio/webm").split(";")[0].trim() || "audio/webm";
const extension = (t) => ({ "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/mpeg": "mp3" })[tipoSimple(t)] || "webm";

/**
 * Pide el micrófono y empieza a grabar. Devuelve un control con:
 *  - segundos(): cuánto lleva
 *  - terminar(): Promise<{blob, tipo, dur}>, corta y entrega el audio
 *  - descartar(): corta y tira todo
 * Si la persona no da permiso, la promesa se rechaza con `e.sinPermiso`.
 */
export async function empezarGrabacion() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const err = new Error(
      e && (e.name === "NotAllowedError" || e.name === "SecurityError")
        ? "No hay permiso para usar el micrófono. Habilitalo desde el candado de la barra de direcciones."
        : e && e.name === "NotFoundError"
          ? "No encontramos ningún micrófono conectado."
          : "No se pudo abrir el micrófono.",
    );
    err.sinPermiso = true;
    throw err;
  }
  const tipo = elegirTipo();
  const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
  const partes = [];
  rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) partes.push(ev.data); };
  const inicio = Date.now();
  rec.start(1000);
  const apagar = () => stream.getTracks().forEach((t) => t.stop());
  let cerrado = false;
  return {
    segundos: () => Math.floor((Date.now() - inicio) / 1000),
    terminar: () =>
      new Promise((ok, mal) => {
        if (cerrado) return mal(new Error("La grabación ya terminó."));
        cerrado = true;
        const dur = Math.max(1, Math.round((Date.now() - inicio) / 1000));
        rec.onstop = () => {
          apagar();
          const t = tipoSimple(rec.mimeType || tipo);
          const blob = new Blob(partes, { type: t });
          if (!blob.size) return mal(new Error("La grabación salió vacía."));
          ok({ blob, tipo: t, dur });
        };
        rec.stop();
      }),
    descartar: () => {
      if (cerrado) return;
      cerrado = true;
      rec.onstop = apagar;
      try { rec.stop(); } catch (e) { apagar(); }
    },
  };
}

/** Sube el audio a la carpeta de quien lo manda. Devuelve la ruta. */
export async function subirAudio({ blob, tipo }, email, msgId) {
  if (!email) throw new Error("No pudimos identificarte para mandar el audio.");
  const d = new Date();
  const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const ruta = `${email}/${mes}/${msgId}.${extension(tipo)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, blob, {
    contentType: tipoSimple(tipo),
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) throw error;
  return ruta;
}

// Lo ya bajado queda en memoria mientras dure la visita: volver a darle play
// no pide el archivo de nuevo.
const urls = new Map();
export async function urlDeAudio(ruta) {
  if (urls.has(ruta)) return urls.get(ruta);
  const { data, error } = await supabase.storage.from(BUCKET).download(ruta);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  urls.set(ruta, url);
  return url;
}

/** Borra el archivo. Solo funciona sobre audios propios (lo impone el bucket). */
export async function borrarAudio(ruta) {
  const { error } = await supabase.storage.from(BUCKET).remove([ruta]);
  if (error) throw error;
  const u = urls.get(ruta);
  if (u) { URL.revokeObjectURL(u); urls.delete(ruta); }
}

export const mmss = (s) => {
  s = Math.max(0, Math.round(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
