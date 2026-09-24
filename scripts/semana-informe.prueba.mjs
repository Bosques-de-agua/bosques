// PRUEBA DEL INFORME SEMANAL — sin base, sin claves, sin red.
//   node scripts/semana-informe.prueba.mjs
//
// Arma dos fotos del equipo a mano (el lunes pasado y hoy) y comprueba que el
// informe encuentre exactamente lo que pasó entre una y otra. Es la parte que
// no se puede mirar a ojo: una tarea que se creó y se terminó dentro de la
// misma semana, o una que alguien reabrió, no se ven en el estado actual.

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
const hoy = foto([
  tarea("a", { title: "Ya estaba y sigue abierta", status: "espera", avances: [{ id: "x", by: "Nico", ts: ANTES, text: "vieja" }, { id: "y", by: "Nico", ts: EN, text: "avance de la semana" }] }),
  tarea("b", { title: "Se termina esta semana", status: "listo", done: true, doneAt: EN, owners: ["Juampi"] }),
  tarea("c", { title: "Estaba terminada y la reabren", status: "curso" }),
  tarea("d", { title: "Quieta hace mucho", status: "curso", owners: ["Lucas"], prio: "alta" }),
  tarea("e", { title: "Nueva y terminada en la misma semana", status: "listo", done: true, doneAt: EN, owners: ["Nico"] }),
  Object.assign(tarea("f", { title: "Nueva, vencida y sin dueño", due: "2026-09-25" }), { _n: "n2" }),
]);
hoy.chat.team = [{ from: "Nico", ts: EN, text: "Mensaje de la semana" }, { from: "Lucas", ts: ANTES, text: "Mensaje viejo" }];
hoy.chat.dm = { "Lucas ~ Nico": [{ from: "Nico", ts: EN, text: "ESTO NO TIENE QUE APARECER" }] };
hoy.events = [{ id: "e1", title: "Reunión de equipo", date: ymd(new Date(EN)), time: "10:00", rsvp: { Nico: "yes", Lucas: "yes" } }];

const { texto, cuentas } = informeSemanal({ hoy, antes, antesDe: "2026-09-21T00:00:00Z", inicio, fin, ahoraMs: AHORA });

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

// Sin respaldo anterior: tiene que avisarlo, no inventar.
const sinAntes = informeSemanal({ hoy, antes: null, antesDe: null, inicio, fin, ahoraMs: AHORA });
ok(sinAntes.texto.includes("SIN copia de respaldo"), "sin respaldo previo, lo dice en la primera línea");
ok(sinAntes.cuentas.nuevas === 0, "sin respaldo previo no inventa tareas nuevas");

console.log("\n" + "=".repeat(46));
console.log(fallas ? `${fallas} FALLA(S)` : "TODO BIEN — sin fallas");
process.exit(fallas ? 1 : 0);
