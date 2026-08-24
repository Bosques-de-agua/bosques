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
  { email: "juampi@ejemplo.org", name: "Juampi" },
  { email: "lucas@ejemplo.org", name: "Lucas" },
  { email: "juanso@ejemplo.org", name: "Juanso" },
];
// El banco arranca en Carbón — es el tema que se está trabajando. Se puede
// cambiar desde Configuración y la elección queda guardada.
try {
  const K = "mesa-bosques-prefs";
  const p = JSON.parse(localStorage.getItem(K) || "{}");
  if (!p.palette) {
    p.palette = "carbon";
    localStorage.setItem(K, JSON.stringify(p));
  }
} catch (e) {}

const nada = async () => {};

// Para auditar: el banco guarda lo ÚLTIMO que la app quiso mandarle al equipo
// y a la tabla privada, sin mandarlo a ningún lado. Sirve para comprobar que
// las preferencias personales no se cuelan en el payload compartido.
window.__push = { compartido: null, privado: null, veces: 0 };
window.__fallaGuardado = false;
// startApp() siembra el ejemplo, y sembrar ya dispara un guardado: ese primer
// aviso llega ANTES de que exista `app`, así que no tiene a quién avisarle.
// Se lo deja pasar en vez de romper el arranque con un error en consola.
const avisar = (...a) => { try { app.mostrarEstadoGuardado(...a); } catch (e) {} };
const espiaCompartido = async (d) => {
  window.__push.compartido = d; window.__push.veces++;
  if (window.__fallaGuardado) { avisar("error", { message: "fallo simulado" }); return; }
  avisar("guardando");
  setTimeout(() => { if (!window.__fallaGuardado) avisar("guardado"); }, 60);
};
const espiaPrivado = async (d) => { window.__push.privado = d; };

// /banco.html?privroto=1 simula que no se pudieron leer las notas y tareas
// privadas al entrar. En la app real eso hace que NO se guarde nada privado en
// toda la sesión, así que lo único aceptable es que se vea un aviso: antes
// escribías una nota, se veía en pantalla, y al recargar no estaba.
const privadoRoto = new URLSearchParams(location.search).has("privroto");

const app = startApp({
  seed: null, // sin semilla, la app se siembra sola con su ejemplo
  priv: null,
  yo: team[0],
  team,
  pushRemoteState: espiaCompartido,
  pushPrivateState: privadoRoto ? null : espiaPrivado,
  privadoRoto,
  saveMember: nada,
  inviteEmail: nada,
  refreshTeam: async () => team,
  hayPendiente: () => false,
});

// Una cinta para no confundirlo nunca con la app de verdad.
const cinta = document.createElement("div");
cinta.textContent = "BANCO DE PRUEBAS · datos de ejemplo, nada se guarda";
cinta.style.cssText =
  "position:fixed;left:0;right:0;bottom:0;z-index:999;text-align:center;" +
  "font:600 10px/1.9 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;" +
  "color:var(--on-accent);background:var(--accent-priv);pointer-events:none;opacity:.85";
document.body.appendChild(cinta);

// El banco no tiene login, pero muestra el pie del menú igual que la app real.
const pie = document.getElementById("sbUser");
if (pie) {
  pie.hidden = false;
  pie.innerHTML =
    '<span class="sbmail" title="nico@ejemplo.org">nico@ejemplo.org</span>' +
    '<button type="button" class="sbitem sbsalir" title="Cerrar sesión">' +
    "<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><path d=\"M12.5 6V4.5A1.5 1.5 0 0 0 11 3H5.5A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17H11a1.5 1.5 0 0 0 1.5-1.5V14\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M8.5 10h8m0 0-2.4-2.4M16.5 10l-2.4 2.4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" +
    '<span class="sblbl">Salir</span></button>';
}

window.__app = app;
