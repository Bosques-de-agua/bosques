// EL INFORME CRUDO DE LA SEMANA — la parte que piensa, sin red.
//
// Recibe DOS fotos del estado del equipo, las dos puntas de la semana —la del
// lunes a la mañana y la del domingo a la noche— y devuelve un texto con los
// hechos: qué se completó, qué avances se escribieron, qué se creó, qué cambió
// de estado, qué está quieto. No interpreta: eso lo hace después la IA.
//
// LAS DOS PUNTAS TIENEN QUE SER DE LA SEMANA, no "el lunes contra hoy". Con
// "contra hoy", todo lo que pasa DESPUÉS del domingo se cuenta como si hubiera
// pasado esa semana. Corriendo la tarea un lunes a las 9:30 la diferencia son
// nueve horas y casi no se nota; pero si la máquina estuvo apagada y la tarea
// corre un jueves, se le cuelan tres días ajenos. Pasó la primera vez que se
// corrió de verdad: 71 tareas nuevas, cuando en la semana se habían creado 48.
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

// `despues` es el estado al CERRAR la semana (el último respaldo del domingo o
// anterior); `antes`, el del lunes temprano. Lo que está quieto y lo que está
// vencido se mide contra el final de la semana, no contra hoy: el informe
// entero cuenta cómo estaban las cosas ese domingo.
export function informeSemanal({ despues, antes, antesDe, despuesDe, inicio, fin, corte }) {
  const DESDE = inicio.getTime(), HASTA = fin.getTime();
  const ahoraMs = corte || HASTA;
  const enRango = (ts) => typeof ts === "number" && ts >= DESDE && ts <= HASTA;
  const ahora = tareasDe(despues), previo = antes ? tareasDe(antes) : new Map();

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

  const eventos = ((despues && despues.events) || []).filter((ev) => {
    const d = ev && ev.date ? new Date(ev.date + "T12:00:00").getTime() : 0;
    return d >= DESDE && d <= HASTA;
  }).map((ev) => ({ t: ev.title, dia: ev.date, hora: ev.time || "", van: Object.values(ev.rsvp || {}).filter((v) => v === "yes").length }));

  // Del chat sale UN NÚMERO y nada más: cuántos mensajes hubo en cada canal.
  // Ni el texto ni quién escribió cada cosa. Pedido de Nico el 24/09: el
  // resumen es de cómo va el TRABAJO, no de lo que dijo cada uno. Antes se le
  // pasaban los mensajes enteros y el primer resumen terminó contando que
  // alguien había anunciado que dejaba WhatsApp — exactamente lo que no va.
  // La garantía es que acá no se junta el texto, no que después no se cuente.
  // Los chats personales (uno a uno) no se miran ni para contarlos.
  const cuantos = (arr) => (arr || []).filter((m) => enRango(m.ts) && (m.text || m.audio || m.file)).length;
  const chatEquipo = cuantos(((despues && despues.chat) || {}).team);
  const chatGrupos = {};
  for (const g of Object.values(((despues && despues.chat) || {}).groups || {})) {
    const n = cuantos(g.msgs);
    if (n) chatGrupos[g.name] = n;
  }
  const objetivos = String((despues && despues.weekGoals) || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // ---------- armar el texto ----------
  const fecha = (ts) => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const L = [];
  L.push(`SEMANA DEL ${ymd(inicio)} AL ${ymd(fin)}`);
  L.push(antes
    ? `Las dos puntas de la semana: la copia del ${antesDe} contra la del ${despuesDe || "cierre"}.`
    : `SIN copia de respaldo anterior al ${ymd(inicio)}: de esta semana solo se ve lo que quedó fechado. No se puede saber qué se creó ni qué cambió de estado.`);
  L.push("Lo quieto y lo vencido se miden al cerrar la semana, no a hoy.");
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
  bloque("Abiertas y quietas hace 14 días o más al cerrar la semana", quietas.sort((a, b) => (b.dias === null ? 1e9 : b.dias) - (a.dias === null ? 1e9 : a.dias)),
    (x) => `${x.t} · ${x.ruta} · ${x.quien} · ${x.dias === null ? "nunca tuvo un avance" : x.dias + " días sin novedades"} · prioridad ${x.prio}`);
  bloque("Vencidas y sin terminar", vencidas, (x) => `${x.t} · ${x.ruta} · ${x.quien} · vencía ${x.vencio}`);

  const plural = (n) => n === 1 ? "1 mensaje" : n + " mensajes";
  L.push("## Cuánto se habló");
  L.push(`- Equipo: ${plural(chatEquipo)}`);
  for (const [nombre, n] of Object.entries(chatGrupos)) L.push(`- Grupo "${nombre}": ${plural(n)}`);
  L.push("");
  L.push("SOLO el número, a propósito: el contenido de los chats no entra en el");
  L.push("informe ni en el resumen, y los personales no se miran ni para contar.");

  return { texto: L.join("\n"), cuentas: {
    completadas: completadas.length, avances: avances.length, nuevas: nuevas.length,
    cambios: cambios.length, reabiertas: reabiertas.length, quietas: quietas.length,
    vencidas: vencidas.length, eventos: eventos.length,
    mensajes: chatEquipo + Object.values(chatGrupos).reduce((n, x) => n + x, 0),
  } };
}
