// EL INFORME CRUDO DE LA SEMANA — la parte que piensa, sin red.
//
// Recibe dos fotos del estado del equipo —la de hoy y la del lunes pasado— y
// devuelve un texto con los hechos: qué se completó, qué avances se
// escribieron, qué se creó, qué cambió de estado, qué está quieto. No
// interpreta: eso lo hace después la IA leyendo esto.
//
// Está separado de `semana-datos.mjs` (que es el que habla con Supabase) para
// poder probarlo sin base ni claves: `node scripts/semana-informe.prueba.mjs`.

const DIA = 86400000;
const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// El lunes de la semana de `fecha`.
export function lunesDe(fecha) {
  const d = new Date(fecha); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
// La semana a resumir: la que terminó ayer. Corriendo un lunes eso es el lunes
// a domingo recién pasados; corriendo un martes —porque la máquina estaba
// apagada— sigue siendo esa misma semana, no la que está a medias.
export function semanaPasada(hoy = new Date()) {
  const inicio = lunesDe(hoy); inicio.setDate(inicio.getDate() - 7);
  const fin = new Date(inicio); fin.setDate(fin.getDate() + 6); fin.setHours(23, 59, 59, 999);
  return { inicio, fin };
}

const nodos = (st) => (st && st.nodes) ? st.nodes : {};
function rutaDe(st, id) {
  const ns = nodos(st), a = []; let x = ns[id];
  while (x) { a.unshift(x.name); x = x.parent ? ns[x.parent] : null; }
  return a.join(" › ");
}
function tareasDe(st) {                          // id -> {k, ruta}
  const m = new Map();
  for (const n of Object.values(nodos(st))) {
    for (const k of (n.items || [])) m.set(k.id, { k, ruta: rutaDe(st, n.id) });
  }
  return m;
}

const ESTADOS = { sin: "sin empezar", curso: "en curso", espera: "en espera", listo: "terminada" };
const est = (s) => ESTADOS[s] || s || "?";
const duenos = (k) => (Array.isArray(k.owners) && k.owners.length) ? k.owners.join(", ") : "sin responsable";

export function informeSemanal({ hoy, antes, antesDe, inicio, fin, ahoraMs = Date.now() }) {
  const DESDE = inicio.getTime(), HASTA = fin.getTime();
  const enRango = (ts) => typeof ts === "number" && ts >= DESDE && ts <= HASTA;
  const ahora = tareasDe(hoy), previo = antes ? tareasDe(antes) : new Map();

  const completadas = [], nuevas = [], cambios = [], avances = [], reabiertas = [];
  const quietas = [], vencidas = [];
  const hoyYMD = ymd(new Date(ahoraMs));

  for (const [id, { k, ruta }] of ahora) {
    const v = previo.get(id);
    // Completada esta semana = quedó fechada dentro de la semana, o el lunes
    // no estaba terminada y ahora sí (cubre las viejas sin `doneAt`).
    if (k.done && (enRango(k.doneAt) || (v && !v.k.done)))
      completadas.push({ t: k.title, ruta, quien: duenos(k), cuando: k.doneAt });
    if (!v && antes) nuevas.push({ t: k.title, ruta, quien: duenos(k), estado: est(k.status) });
    if (v && v.k.status !== k.status && !(k.done && v.k.done))
      cambios.push({ t: k.title, ruta, de: est(v.k.status), a: est(k.status) });
    if (v && v.k.done && !k.done) reabiertas.push({ t: k.title, ruta });
    for (const a of (k.avances || [])) if (enRango(a.ts)) avances.push({ t: k.title, ruta, por: a.by, texto: a.text, ts: a.ts });

    if (!k.done && !k.archived) {
      const ult = (k.avances || []).reduce((m, a) => Math.max(m, a.ts || 0), 0);
      const dias = ult ? Math.floor((ahoraMs - ult) / DIA) : null;
      if (dias === null || dias >= 14) quietas.push({ t: k.title, ruta, quien: duenos(k), dias, prio: k.prio || "—" });
      if (k.due && k.due < hoyYMD) vencidas.push({ t: k.title, ruta, quien: duenos(k), vencio: k.due });
    }
  }

  const eventos = ((hoy && hoy.events) || []).filter((ev) => {
    const d = ev && ev.date ? new Date(ev.date + "T12:00:00").getTime() : 0;
    return d >= DESDE && d <= HASTA;
  }).map((ev) => ({ t: ev.title, dia: ev.date, hora: ev.time || "", van: Object.values(ev.rsvp || {}).filter((v) => v === "yes").length }));

  // Conversación: Equipo y grupos. Los chats personales (uno a uno) NO se
  // miran: son entre dos personas.
  const chatEquipo = (((hoy && hoy.chat) || {}).team || []).filter((m) => enRango(m.ts) && m.text).map((m) => ({ por: m.from, texto: m.text }));
  const chatGrupos = {};
  for (const g of Object.values(((hoy && hoy.chat) || {}).groups || {})) {
    const ms = (g.msgs || []).filter((m) => enRango(m.ts) && m.text).map((m) => ({ por: m.from, texto: m.text }));
    if (ms.length) chatGrupos[g.name] = ms;
  }
  const objetivos = String((hoy && hoy.weekGoals) || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // ---------- armar el texto ----------
  const fecha = (ts) => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const L = [];
  L.push(`SEMANA DEL ${ymd(inicio)} AL ${ymd(fin)}`);
  L.push(antes
    ? `Comparada contra la copia del equipo del ${antesDe}.`
    : `SIN copia de respaldo anterior al ${ymd(inicio)}: de esta semana solo se ve lo que quedó fechado. No se puede saber qué se creó ni qué cambió de estado.`);
  L.push("");
  if (objetivos) { L.push("## Objetivos que se puso el equipo"); L.push(objetivos); L.push(""); }

  const bloque = (titulo, arr, fmt, vacio = "ninguna") => {
    L.push(`## ${titulo} (${arr.length})`);
    if (!arr.length) L.push("— " + vacio + ".");
    else arr.forEach((x) => L.push("- " + fmt(x)));
    L.push("");
  };
  bloque("Tareas completadas", completadas, (x) => `${x.t} · ${x.ruta} · ${x.quien}${x.cuando ? " · " + fecha(x.cuando) : ""}`);
  bloque("Avances escritos", avances.sort((a, b) => a.ts - b.ts), (x) => `[${fecha(x.ts)}] ${x.por} en "${x.t}" (${x.ruta}): ${x.texto}`, "ninguno");
  bloque("Tareas nuevas", nuevas, (x) => `${x.t} · ${x.ruta} · ${x.quien} · ${x.estado}`);
  bloque("Cambios de estado", cambios, (x) => `${x.t} (${x.ruta}): ${x.de} → ${x.a}`, "ninguno");
  bloque("Tareas reabiertas", reabiertas, (x) => `${x.t} · ${x.ruta}`);
  bloque("Eventos", eventos, (x) => `${x.dia}${x.hora ? " " + x.hora : ""} · ${x.t} · ${x.van} confirmados`, "ninguno");
  bloque("Abiertas y quietas hace 14 días o más", quietas.sort((a, b) => (b.dias === null ? 1e9 : b.dias) - (a.dias === null ? 1e9 : a.dias)),
    (x) => `${x.t} · ${x.ruta} · ${x.quien} · ${x.dias === null ? "nunca tuvo un avance" : x.dias + " días sin novedades"} · prioridad ${x.prio}`);
  bloque("Vencidas y sin terminar", vencidas, (x) => `${x.t} · ${x.ruta} · ${x.quien} · vencía ${x.vencio}`);

  const plural = (n) => n === 1 ? "1 mensaje" : n + " mensajes";
  L.push(`## Conversación del Equipo (${plural(chatEquipo.length)})`);
  if (!chatEquipo.length) L.push("— nada.");
  else chatEquipo.forEach((m) => L.push(`- ${m.por}: ${m.texto}`));
  L.push("");
  for (const [nombre, ms] of Object.entries(chatGrupos)) {
    L.push(`## Grupo "${nombre}" (${plural(ms.length)})`);
    ms.forEach((m) => L.push(`- ${m.por}: ${m.texto}`));
    L.push("");
  }
  L.push("(Los chats personales, uno a uno, no se incluyen a propósito.)");

  return { texto: L.join("\n"), cuentas: {
    completadas: completadas.length, avances: avances.length, nuevas: nuevas.length,
    cambios: cambios.length, reabiertas: reabiertas.length, quietas: quietas.length,
    vencidas: vencidas.length, eventos: eventos.length,
    mensajes: chatEquipo.length + Object.values(chatGrupos).reduce((n, m) => n + m.length, 0),
  } };
}
