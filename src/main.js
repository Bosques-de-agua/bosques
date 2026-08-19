import "./style.css";
import { supabase } from "./supabaseClient.js";
import { fetchRemoteState, pushRemoteState, subscribeRemoteState, setClientEmail } from "./sync.js";
import { fetchPrivateState, pushPrivateState } from "./private.js";
import { fetchTeam, upsertMe, inviteEmail } from "./team.js";
import { startApp } from "./app.js";
import { initPush } from "./push.js";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.error("No se pudo registrar el service worker:", err);
  });
}

const loginScreen = document.getElementById("login-screen");
const appRoot = document.getElementById("app");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginStatus = document.getElementById("login-status");

let launched = false;

function showLogin(message) {
  launched = false;
  appRoot.classList.remove("on");
  loginScreen.style.display = "grid";
  if (message) loginStatus.textContent = message;
}

function showApp() {
  loginScreen.style.display = "none";
  appRoot.classList.add("on");
}

function addSignOutPill(email) {
  if (document.querySelector(".signout-pill")) return;
  const pill = document.createElement("button");
  pill.className = "signout-pill";
  pill.type = "button";
  pill.title = "Cerrar sesión";
  pill.textContent = `${email} · Salir`;
  pill.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
  document.body.appendChild(pill);
}

async function launchApp(session) {
  if (launched) return;
  launched = true;

  // Distinguir "la base está vacía" de "no pude leer la base" es crítico:
  // si arrancamos la app con seed=null tras un error, el primer guardado
  // reemplaza el contenido de todo el equipo por los datos de ejemplo.
  let seed = null;
  try {
    seed = await fetchRemoteState();
  } catch (err) {
    console.error("No se pudo leer el estado remoto:", err);
    launched = false;
    showLoadError(err);
    return;
  }

  // Datos privados. Si NO se pudieron leer, la app arranca igual pero en modo
  // solo-lectura para esa parte: sin esto, el primer guardado subiría una
  // porción vacía y borraría las notas y tareas privadas de verdad.
  const email = session.user.email;
  setClientEmail(email);
  let priv = null;
  let privOk = true;
  try {
    priv = await fetchPrivateState(email);
  } catch (err) {
    console.error("No se pudieron leer tus datos privados:", err);
    privOk = false;
  }

  // Quién sos sale del correo con el que entraste, no de un selector.
  // Si es tu primera vez, se crea tu ficha con la parte antes del @.
  let team = [];
  let teamOk = true;
  try {
    team = await fetchTeam();
  } catch (err) {
    console.error("No se pudo leer el equipo:", err);
    teamOk = false;
  }
  let yo = team.find((m) => m.email === email) || null;
  // Solo se crea la ficha si de verdad pudimos leer el equipo. Si la lectura
  // falló, "no está" no significa "es nuevo": crearla le cambiaría el nombre
  // a alguien que ya existe y lo desconectaría de sus tareas.
  if (!yo && teamOk) {
    const nombre = email.split("@")[0].replace(/[._-]+/g, " ").trim() || email;
    yo = { email, name: nombre.charAt(0).toUpperCase() + nombre.slice(1) };
    try {
      await upsertMe(yo);
      team = await fetchTeam();
      yo = team.find((m) => m.email === email) || yo;
    } catch (err) {
      console.error("No se pudo crear tu ficha de equipo:", err);
    }
  }
  if (!yo) {
    showLoadError(new Error("No pudimos identificarte. Revisá tu conexión y volvé a intentar."));
    launched = false;
    return;
  }

  showApp();
  addSignOutPill(email);
  initPush();

  const app = startApp({
    seed,
    priv,
    yo,
    team,
    saveMember: upsertMe,
    inviteEmail,
    refreshTeam: fetchTeam,
    // Sin lectura previa no se escribe: subir una porción vacía borraría lo real.
    pushPrivateState: privOk ? (data) => pushPrivateState(email, data) : null,
    pushRemoteState,
  });
  subscribeRemoteState((remoteData) => app.applyRemoteState(remoteData));
}

function showLoadError(err) {
  loginScreen.style.display = "grid";
  appRoot.classList.remove("on");
  const box = loginScreen.querySelector(".login-box");
  if (!box) return;
  box.innerHTML =
    '<h1>No pudimos cargar la información</h1>' +
    '<p>Puede ser un problema de conexión. No se modificó nada: tus datos y los del equipo están intactos.</p>' +
    '<button type="button" class="btn btn-primary enter-btn" id="retry-load">Reintentar</button>' +
    '<div class="status err">' +
    String((err && err.message) || err || "Error desconocido") +
    "</div>";
  const retry = box.querySelector("#retry-load");
  if (retry) retry.addEventListener("click", () => window.location.reload());
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = loginEmail.value.trim();
  if (!email) return;
  loginStatus.classList.remove("err");
  loginStatus.textContent = "Enviando enlace...";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) {
    loginStatus.classList.add("err");
    loginStatus.textContent = "No se pudo enviar: " + error.message;
  } else {
    loginStatus.textContent = "Listo. Revisá tu email y abrí el enlace para entrar.";
  }
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) launchApp(session);
  else showLogin();
});

const {
  data: { session },
} = await supabase.auth.getSession();
if (session) launchApp(session);
else showLogin();
