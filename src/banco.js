// BANCO DE PRUEBAS DEL TEMA — solo corre en el servidor local (`npm run dev`,
// /banco.html). Vite construye únicamente index.html, así que este archivo
// NUNCA se despliega.
//
// Para qué existe: la app real pide magic link y habla con Supabase, así que
// no se puede mirar mientras se trabaja el diseño. Acá se monta EXACTAMENTE la
// misma interfaz y el mismo CSS, con datos de ejemplo y sin red: todas las
// funciones de guardado son de mentira, así que nada de lo que se toque acá
// llega a la base ni lo ve el equipo.
import "./style.css";
import { startApp } from "./app.js";

// El markup vive en index.html y se lee de ahí, para que este banco no se
// desincronice cuando la app cambie.
const html = await (await fetch("/index.html")).text();
const doc = new DOMParser().parseFromString(html, "text/html");
doc.querySelectorAll("script").forEach((s) => s.remove());
document.body.innerHTML = doc.body.innerHTML;
document.getElementById("login-screen")?.remove();
document.getElementById("app").classList.add("on");

const team = [
  { email: "nico@ejemplo.org", name: "Nico" },
  { email: "juanpi@ejemplo.org", name: "Juanpi" },
  { email: "lucas@ejemplo.org", name: "Lucas" },
  { email: "juanso@ejemplo.org", name: "Juanso" },
];
// El banco arranca en Atelier — es el tema que se está trabajando. Se puede
// cambiar desde Configuración y la elección queda guardada.
try {
  const K = "mesa-bosques-prefs";
  const p = JSON.parse(localStorage.getItem(K) || "{}");
  if (!p.palette) {
    p.palette = "atelier";
    localStorage.setItem(K, JSON.stringify(p));
  }
} catch (e) {}

const nada = async () => {};

const app = startApp({
  seed: null, // sin semilla, la app se siembra sola con su ejemplo
  priv: null,
  yo: team[0],
  team,
  pushRemoteState: nada,
  pushPrivateState: nada,
  saveMember: nada,
  inviteEmail: nada,
  refreshTeam: async () => team,
});

// Una cinta para no confundirlo nunca con la app de verdad.
const cinta = document.createElement("div");
cinta.textContent = "BANCO DE PRUEBAS · datos de ejemplo, nada se guarda";
cinta.style.cssText =
  "position:fixed;left:0;right:0;bottom:0;z-index:999;text-align:center;" +
  "font:600 10px/1.9 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;" +
  "color:var(--on-accent);background:var(--accent-priv);pointer-events:none;opacity:.85";
document.body.appendChild(cinta);

window.__app = app;
