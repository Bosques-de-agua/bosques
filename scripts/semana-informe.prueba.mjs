// PRUEBA DEL INFORME SEMANAL — sin base, sin claves, sin red.
//   node scripts/semana-informe.prueba.mjs
//
// Arma las dos puntas de la semana a mano —el lunes y el domingo— y comprueba
// que el informe encuentre exactamente lo que pasó entre una y otra. Es la
// parte que no se puede mirar a ojo: una tarea que se creó y se terminó dentro
// de la misma semana, o una que alguien reabrió.

import { informeSemanal, semanaPasada, ymd } from "./semana-informe.mjs";

const { inicio, fin } = semanaPasada(new Date("2026-09-28T09:00:00"));  // un lunes
const EN = inicio.getTime() + 2 * 86400000;      // miércoles de esa semana
const ANTES = inicio.getTime() - 5 * 86400000;   // antes de la semana
const AHORA = fin.getTime() + 60000;             // el lunes siguiente

const tarea = (id, o = {}) => ({
  id, title: o.title || id, owners: o.owners || [], status: o.status || "sin",
  done: o.done || false, doneAt: o.doneAt || null, archived: false,
  avances: o.avances || [], due: o.due || "", prio: o.prio || "",
});
const foto = (items) => ({
  nodes: {
    n1: { id: "n1", name: "Área Natural", parent: null, items: items.filter((k) => k._n !== "n2") },
    n2: { id: "n2", name: "Informes", parent: "n1", items: items.filter((k) => k._n === "n2") },
  },
  events: [], chat: { team: [], groups: {}, dm: {} }, weekGoals: "",
});

const antes = foto([
  tarea("a", { title: "Ya estaba y sigue abierta", status: "curso", avances: [{ id: "x", by: "Nico", ts: ANTES, text: "vieja" }] }),
  tarea("b", { title: "Se termina esta semana", status: "curso", owners: ["Juampi"] }),
  tarea("c", { title: "Estaba terminada y la reabren", status: "listo", done: true, doneAt: ANTES }),
  tarea("d", { title: "Quieta hace mucho", status: "curso", owners: ["Lucas"], prio: "alta" }),
]);
const cierre = foto([
  tarea("a", { title: "Ya estaba y sigue abierta", status: "espera", avances: [{ id: "x", by: "Nico", ts: ANTES, text: "vieja" }, { id: "y", by: "Nico", ts: EN, text: "avance de la semana" }] }),
  tarea("b", { title: "Se termina esta semana", status: "listo", done: true, doneAt: EN, owners: ["Juampi"] }),
  tarea("c", { title: "Estaba terminada y la reabren", status: "curso" }),
  tarea("d", { title: "Quieta hace mucho", status: "curso", owners: ["Lucas"], prio: "alta" }),
  tarea("e", { title: "Nueva y terminada en la misma semana", status: "listo", done: true, doneAt: EN, owners: ["Nico"] }),
  Object.assign(tarea("f", { title: "Nueva, vencida y sin dueño", due: "2026-09-25" }), { _n: "n2" }),
]);
cierre.chat.team = [{ from: "Nico", ts: EN, text: "Mensaje de la semana" }, { from: "Lucas", ts: ANTES, text: "Mensaje viejo" }];
cierre.chat.dm = { "Lucas ~ Nico": [{ from: "Nico", ts: EN, text: "ESTO NO TIENE QUE APARECER" }] };
cierre.events = [{ id: "e1", title: "Reunión de equipo", date: ymd(new Date(EN)), time: "10:00", rsvp: { Nico: "yes", Lucas: "yes" } }];

const { texto, cuentas } = informeSemanal({ despues: cierre, antes, antesDe: "2026-09-21T00:00:00Z", despuesDe: "2026-09-27T23:00:00Z", inicio, fin });

let fallas = 0;
const ok = (cond, que, detalle = "") => {
  console.log((cond ? "  BIEN " : "  MAL  ") + "· " + que + (detalle ? "\n           " + detalle : ""));
  if (!cond) fallas++;
};
console.log(`INFORME DE LA SEMANA ${ymd(inicio)} → ${ymd(fin)}\n${"=".repeat(46)}\n`);

ok(cuentas.completadas === 2, "encuentra las 2 completadas (una de ellas creada la misma semana)", "completadas: " + cuentas.completadas);
ok(texto.includes("Nueva y terminada en la misma semana"), "la creada-y-terminada no se pierde");
ok(cuentas.nuevas === 2, "encuentra las 2 tareas nuevas", "nuevas: " + cuentas.nuevas);
ok(cuentas.reabiertas === 1 && texto.includes("Estaba terminada y la reabren"), "detecta la reabierta");
ok(cuentas.avances === 1 && texto.includes("avance de la semana") && !texto.includes(": vieja"), "cuenta solo el avance de la semana");
ok(cuentas.cambios >= 1 && texto.includes("en curso → en espera"), "anota el cambio de estado");
ok(texto.includes("Quieta hace mucho") && texto.includes("nunca tuvo un avance"), "marca la que está quieta");
ok(cuentas.vencidas === 1 && texto.includes("vencía 2026-09-25"), "marca la vencida");
ok(texto.includes("Informes") && texto.includes("Área Natural › Informes"), "la ruta del tema sale completa");
ok(cuentas.eventos === 1 && texto.includes("Reunión de equipo"), "toma el evento de la semana");
ok(cuentas.mensajes === 1, "cuenta solo el mensaje de la semana", "mensajes: " + cuentas.mensajes);
ok(!texto.includes("ESTO NO TIENE QUE APARECER"), "los chats personales NO entran en el informe");
// Del chat sale el número y NADA del contenido (pedido de Nico, 24/09).
ok(!texto.includes("Mensaje de la semana") && !texto.includes("Nico:") && !texto.includes("Lucas:"),
  "del chat del Equipo no sale ni el texto ni quién escribió");
ok(texto.includes("Equipo: 1 mensaje"), "pero sí sale cuántos mensajes hubo");

// EL ERROR QUE APARECIÓ LA PRIMERA VEZ QUE SE CORRIÓ DE VERDAD: se comparaba
// el lunes contra "hoy" en vez de contra el domingo, así que todo lo que pasaba
// después se contaba como de la semana (dio 71 tareas nuevas cuando habían sido
// 48). El arreglo está en `semana-datos.mjs`, que ahora pide las DOS puntas de
// la semana: informeSemanal() compara fielmente las dos fotos que le den, no
// puede saber si son las correctas —una tarea no guarda cuándo se creó—.
// Lo que SÍ se puede probar acá es el borde: hasta dónde llega la semana.
const justo = foto([
  tarea("t1", { title: "Terminada en el último segundo", status: "listo", done: true, doneAt: fin.getTime() }),
  tarea("t2", { title: "Terminada un segundo después", status: "listo", done: true, doneAt: fin.getTime() + 1000 }),
]);
const borde = informeSemanal({ despues: justo, antes: foto([]), antesDe: "x", despuesDe: "y", inicio, fin });
ok(borde.texto.includes("Terminada en el último segundo"), "lo del último segundo del domingo entra");
// Ojo: las dos aparecen en "Tareas nuevas" (el lunes no existían), así que
// hay que mirar el bloque de completadas y no el texto entero.
const bloqueCompletadas = borde.texto.split("## Tareas completadas")[1].split("##")[0];
ok(borde.cuentas.completadas === 1 && !bloqueCompletadas.includes("un segundo después"),
  "lo terminado un segundo DESPUÉS del domingo no cuenta como completado", "completadas: " + borde.cuentas.completadas);
const bordeAvances = informeSemanal({
  despues: foto([tarea("t3", { avances: [
    { id: "i", by: "Nico", ts: fin.getTime(), text: "justo a tiempo" },
    { id: "j", by: "Nico", ts: fin.getTime() + 1000, text: "ya es la otra semana" },
  ] })]), antes: foto([]), antesDe: "x", despuesDe: "y", inicio, fin });
ok(bordeAvances.cuentas.avances === 1 && bordeAvances.texto.includes("justo a tiempo")
   && !bordeAvances.texto.includes("ya es la otra semana"),
  "un avance del lunes siguiente NO entra en la semana", "avances: " + bordeAvances.cuentas.avances);

// Sin respaldo anterior: tiene que avisarlo, no inventar.
const sinAntes = informeSemanal({ despues: cierre, antes: null, antesDe: null, inicio, fin });
ok(sinAntes.texto.includes("SIN copia de respaldo"), "sin respaldo previo, lo dice en la primera línea");
ok(sinAntes.cuentas.nuevas === 0, "sin respaldo previo no inventa tareas nuevas");

// Objetivos por semana: los de ESA semana (la clave es su lunes), con cuáles se cumplieron.
const conObj = Object.assign(foto([]), { objetivos: {
  [ymd(inicio)]: { gen: [{ id: "o1", t: "Hoja de ruta", ok: true }, { id: "o2", t: "Presupuesto", ok: false, traido: true }],
    p: { Lucas: [{ id: "o3", t: "Exención", ok: false }] } },
  "2026-09-28": { gen: [{ id: "o4", t: "OBJETIVO DE LA SEMANA SIGUIENTE", ok: false }], p: {} } },
  weekGoals: "TEXTO VIEJO QUE NO VA" });
const rObj = informeSemanal({ despues: conObj, antes: foto([]), antesDe: "x", despuesDe: "y", inicio, fin });
ok(rObj.cuentas.objetivos === 3 && rObj.cuentas.objetivosCumplidos === 1, "cuenta los objetivos de la semana y cuáles se cumplieron",
  `objetivos: ${rObj.cuentas.objetivos}, cumplidos: ${rObj.cuentas.objetivosCumplidos}`);
ok(rObj.texto.includes("[cumplido] Hoja de ruta") && rObj.texto.includes("[no cumplido] Exención") && rObj.texto.includes("### Lucas")
   && rObj.texto.includes("pasó a la semana siguiente"), "los objetivos salen por persona y con su resultado");
ok(!rObj.texto.includes("SEMANA SIGUIENTE") && !rObj.texto.includes("TEXTO VIEJO"), "no se cuelan los de otra semana ni el texto viejo");
const soloViejo = informeSemanal({ despues: Object.assign(foto([]), { weekGoals: "<b>Cerrar</b> la carpeta" }), antes: foto([]), antesDe: "x", despuesDe: "y", inicio, fin });
ok(soloViejo.texto.includes("Cerrar la carpeta"), "sin objetivos nuevos, todavía lee el cuadro de texto viejo");

// Mesa de trabajo: lo cerrado con su conclusión, lo nuevo y los aportes, solo de la semana.
const conMesa = Object.assign(foto([]), { mesa: { items: [
  { id: "m1", titulo: "¿Wyss antes o después?", node: "n2", by: "Juampi", ts: ANTES, aportes: [{ id: "a", by: "Lucas", ts: EN, text: "aporte de la semana" }, { id: "b", by: "Lucas", ts: ANTES, text: "APORTE VIEJO" }], cerrado: { texto: "En octubre", by: "Nico", ts: EN } },
  { id: "m2", titulo: "Criterio de dueños", node: "", by: "Juanso", ts: EN, aportes: [], cerrado: null },
  { id: "m3", titulo: "PENDIENTE VIEJO", node: "", by: "Nico", ts: ANTES, aportes: [], cerrado: null }],
  reuniones: [{ id: "r", fecha: ymd(new Date(EN)), ts: EN, puntos: [{ titulo: "x", cerrado: true }, { titulo: "y", cerrado: false }], minuta: "algo", link: "" }] } });
const rMesa = informeSemanal({ despues: conMesa, antes: foto([]), antesDe: "x", despuesDe: "y", inicio, fin });
ok(rMesa.cuentas.mesaCerrados === 1 && rMesa.texto.includes("cerró Nico: En octubre") && rMesa.texto.includes("Área Natural › Informes"),
  "el pendiente cerrado sale con su conclusión y su tema");
ok(rMesa.cuentas.mesaNuevos === 1 && rMesa.cuentas.mesaAportes === 1 && !rMesa.texto.includes("APORTE VIEJO") && !rMesa.texto.includes("PENDIENTE VIEJO"),
  "de la mesa entra solo lo de la semana", `nuevos: ${rMesa.cuentas.mesaNuevos}, aportes: ${rMesa.cuentas.mesaAportes}`);
ok(rMesa.texto.includes("2 puntos · 1 cerrados · con minuta") && rMesa.texto.includes("Pendientes abiertos en la mesa al cerrar la semana: 2."),
  "cuenta la reunión y lo que sigue abierto");

console.log("\n" + "=".repeat(46));
console.log(fallas ? `${fallas} FALLA(S)` : "TODO BIEN — sin fallas");
process.exit(fallas ? 1 : 0);
