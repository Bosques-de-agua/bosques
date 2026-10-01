// PRUEBA DE LA AUDITORÍA DE DATOS — sin base, sin claves, sin red.
//   node scripts/semana-retrocesos.prueba.mjs
import { buscarRetrocesos, textoAuditoria } from "./semana-retrocesos.mjs";

let fallaron = 0;
const afirmar = (ok, t, d) => { if (!ok) fallaron++; console.log((ok ? "  BIEN · " : "  MAL  · ") + t + (ok || !d ? "" : "\n         " + d)); };

// Un equipo que trabaja: cada hora se agregan tareas y se reescriben las notas.
const tarea = (i, h) => ({ id: "t" + i, title: "Tarea " + i, notas: "nota " + i + " a la hora " + h, avances: [{ id: "a" + i, text: "avance " + i }] });
const foto = (n, h) => ({ nodes: { A: { name: "A", x: Math.random(), items: Array.from({ length: n }, (_, i) => tarea(i, h)) } }, mesa: { items: [] } });
const hora = (h) => `2026-09-30T${String(h).padStart(2, "0")}:00:00Z`;
const normal = Array.from({ length: 10 }, (_, h) => ({ id: h, taken_at: hora(h), data: foto(10 + h * 4, h) }));

afirmar(buscarRetrocesos(normal).length === 0, "una semana normal, con trabajo todas las horas, no da alarma");
afirmar(/sin pérdidas/.test(textoAuditoria([], normal.length)), "y lo dice en una línea");

// El caso del 01/10: a la hora 10 un dispositivo sube su copia de la hora 4.
const pison = [...normal, { id: 10, taken_at: hora(10), data: foto(26, 4) }];
pison[8].data.mesa.items = [{ id: "m1" }, { id: "m2" }];
pison[9].data.mesa.items = [{ id: "m1" }, { id: "m2" }];
const h = buscarRetrocesos(pison);
afirmar(h.length === 1, "el pisón se detecta", JSON.stringify(h));
afirmar(h[0] && h[0].seParece === hora(4), "y dice a qué hora volvió", h[0] && h[0].seParece);
afirmar(h[0] && h[0].faltan.includes("Tarea 45"), "y qué tareas desaparecieron");
afirmar(h[0] && h[0].mesaAntes === 2 && h[0].mesaDespues === 0, "y si se perdieron pendientes de la Mesa");
afirmar(/VOLVIÓ PARA ATRÁS/.test(textoAuditoria(h, pison.length)), "el texto lo grita arriba de todo");

// Borrar mucho a propósito NO es volver atrás: no se parece a ninguna foto vieja.
const limpieza = [...normal, { id: 10, taken_at: hora(10), data: foto(3, 10) }];
afirmar(buscarRetrocesos(limpieza).length === 0, "una limpieza grande hecha a propósito no da falsa alarma");

console.log(fallaron ? `\nHAY ${fallaron} FALLA(S)` : "\nTODO BIEN");
process.exit(fallaron ? 1 : 0);
