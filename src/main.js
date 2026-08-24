import "./style.css";
import { supabase } from "./supabaseClient.js";
import { fetchRemoteState, pushRemoteState, subscribeRemoteState, setClientEmail, setSaveStateHandler, hayCambiosSinGuardar, reintentarPendiente } from "./sync.js";
import { fetchPrivateState, pushPrivateState, setPrivateSaveStateHandler, hayPrivadoSinGuardar } from "./private.js";
import { fetchTeam, upsertMe, inviteEmail, TablaFaltante } from "./team.js";
import { startApp } from "./app.js";
import { initPush } from "./push.js";
import { initPicker } from "./picker.js";

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

// Quién entró y cómo salir. Vivía flotando arriba a la derecha, encima de la
// campanita y del botón de tema: se tapaban entre sí. Ahora está al pie del
// menú, debajo de Configuración, que es donde uno lo busca.
function addSignOutPill(email) {
  const host = document.getElementById("sbUser");
  if (!host || host.dataset.listo === "1") return;
  host.dataset.listo = "1";
  host.hidden = false;
  host.innerHTML =
    '<span class="sbmail" title="' + email + '">' + email + "</span>" +
    '<button type="button" class="sbitem sbsalir" title="Cerrar sesión">' +
    "<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><path d=\"M12.5 6V4.5A1.5 1.5 0 0 0 11 3H5.5A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17H11a1.5 1.5 0 0 0 1.5-1.5V14\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M8.5 10h8m0 0-2.4-2.4M16.5 10l-2.4 2.4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" +
    '<span class="sblbl">Salir</span></button>';
  host.querySelector(".sbsalir").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
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
  let sinTablaEquipo = false;
  try {
    team = await fetchTeam();
  } catch (err) {
    if (err instanceof TablaFaltante) {
      // Todavía no se corrió el schema: la app arranca igual, derivando el
      // nombre del correo, y todo se acomoda solo cuando la tabla exista.
      console.warn("Falta la tabla team_members. Arrancando en modo compatible.");
      sinTablaEquipo = true;
    } else {
      console.error("No se pudo leer el equipo:", err);
      teamOk = false;
    }
  }
  let yo = team.find((m) => m.email === email) || null;
  if (!yo && sinTablaEquipo) {
    const n = email.split("@")[0].replace(/[._-]+/g, " ").trim() || email;
    yo = { email, name: n.charAt(0).toUpperCase() + n.slice(1) };
    team = [yo];
  }
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
  // Si no están cargadas las variables de Google, no instala nada y la app
  // sigue pidiendo el link pegado a mano.
  initPicker();

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
    // ...pero eso hay que DECIRLO, o escribís una nota y desaparece al recargar.
    privadoRoto: !privOk,
    pushRemoteState,
    hayPendiente: () => hayCambiosSinGuardar() || hayPrivadoSinGuardar(),
  });
  // El testigo de guardado: la app avisa en pantalla si algo no llegó a la base.
  setSaveStateHandler((estado, err) => app.mostrarEstadoGuardado(estado, err));
  setPrivateSaveStateHandler((estado, err) => app.mostrarEstadoGuardado(estado, err));
  subscribeRemoteState((remoteData) => app.applyRemoteState(remoteData));

  // Volver a la pestaña y releer.
  //
  // Los avisos en vivo viajan por un websocket, y ese websocket se cae cuando
  // el celular se duerme o la pestaña queda mucho rato en segundo plano. Nadie
  // lo reintentaba, así que al volver podías estar mirando datos viejos sin
  // ninguna señal de que lo eran — y escribir sobre eso pisaba lo nuevo.
  //
  // Si hay algo tuyo sin guardar, lo tuyo va primero: releer ahora te
  // reemplazaría el estado y te lo borraría. Se espera a que la cola se vacíe.
  let releyendo = false;
  async function releer(intento = 0) {
    if (releyendo) return;
    if (hayCambiosSinGuardar() || hayPrivadoSinGuardar()) {
      if (intento < 6) setTimeout(() => releer(intento + 1), 700);
      return;
    }
    releyendo = true;
    try {
      const fresco = await fetchRemoteState();
      if (fresco) app.applyRemoteState(fresco);
      if (privOk) {
        const mio = await fetchPrivateState(email);
        if (mio) app.applyPrivateState(mio);
      }
    } catch (err) {
      console.error("No se pudo releer al volver a la pestaña:", err);
    } finally {
      releyendo = false;
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") releer();
  });
  // Al recuperar la conexión, lo PRIMERO es mandar lo que no había entrado.
  // Releer antes que eso reemplazaría con la versión del servidor justo el
  // trabajo que estuvo esperando para salir.
  window.addEventListener("online", () => {
    if (reintentarPendiente()) return;
    releer();
  });
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
