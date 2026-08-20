// SELECTOR DE GOOGLE DRIVE ("Google Picker") — elegir el archivo en vez de
// copiar y pegar el link.
//
// Por qué esto pide permiso de Google y el visor de la fase anterior no: el
// visor solo incrusta una página que Drive ya publica, y la mira cada persona
// con la sesión que tiene abierta. Acá, en cambio, la app le PIDE a Google la
// lista de lo que esa persona eligió, y para eso Google exige identificarse.
//
// El permiso que se pide es `drive.file`, el más chico que existe: la app solo
// se entera de los archivos que la persona elige a mano en esta ventana, nunca
// del resto del Drive. Por ser tan acotado, Google NO exige verificar la
// aplicación (a diferencia de `drive.readonly`, que sí, y con espera). El
// buscador de todo el Drive viene adentro de la ventana de Google: buscar ahí
// no le da nada a la app, solo elegir.
//
// Queda APAGADO si faltan las dos variables de entorno. Sin ellas la app
// funciona igual que siempre: se pega el link a mano. Ver el README.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const SCOPE = "https://www.googleapis.com/auth/drive.file";

function configurado() {
  return !!CLIENT_ID && !!API_KEY;
}

// Los dos scripts de Google se cargan recién cuando alguien aprieta el botón.
// Así la app no le habla a Google en cada arranque: quien nunca use el
// selector, nunca lo descarga.
const enVuelo = new Map();
function cargarScript(src) {
  if (enVuelo.has(src)) return enVuelo.get(src);
  const p = new Promise((listo, falla) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => listo();
    s.onerror = () => {
      enVuelo.delete(src);
      falla(new Error("No se pudo cargar el selector de Google. ¿Hay conexión?"));
    };
    document.head.appendChild(s);
  });
  enVuelo.set(src, p);
  return p;
}

let pickerCargado = null;
function cargarPicker() {
  if (pickerCargado) return pickerCargado;
  pickerCargado = cargarScript("https://apis.google.com/js/api.js").then(
    () =>
      new Promise((listo, falla) => {
        window.gapi.load("picker", {
          callback: () => listo(),
          onerror: () => falla(new Error("Google no pudo abrir el selector.")),
        });
      })
  );
  return pickerCargado;
}

// El permiso dura un rato; mientras siga vivo no se vuelve a molestar a nadie.
let token = null;
let tokenVence = 0;
let clienteToken = null;

function pedirToken() {
  if (token && Date.now() < tokenVence - 60000) return Promise.resolve(token);
  return cargarScript("https://accounts.google.com/gsi/client").then(
    () =>
      new Promise((listo, falla) => {
        if (!clienteToken) {
          clienteToken = window.google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPE,
            callback: () => {},
          });
        }
        clienteToken.callback = (r) => {
          if (r && r.access_token) {
            token = r.access_token;
            tokenVence = Date.now() + (Number(r.expires_in) || 3600) * 1000;
            listo(token);
          } else {
            falla(new Error("Google no dio el permiso para leer lo que elijas."));
          }
        };
        clienteToken.error_callback = (e) => {
          const tipo = e && e.type;
          falla(
            new Error(
              tipo === "popup_closed"
                ? "Cerraste la ventana de Google sin elegir cuenta."
                : tipo === "popup_failed_to_open"
                  ? "El navegador bloqueó la ventana de Google. Permitile abrir ventanas a este sitio."
                  : "Google no dio el permiso para leer lo que elijas."
            )
          );
        };
        // La primera vez hay que mostrar la pantalla de permiso; después no.
        clienteToken.requestAccessToken({ prompt: token ? "" : "consent" });
      })
  );
}

function mostrarSelector(accessToken) {
  return new Promise((listo) => {
    const g = window.google.picker;
    // Dos solapas: lo propio y lo que le compartieron. Las carpetas se pueden
    // elegir igual: la app las guarda como link, aunque adentro no se puedan
    // mostrar.
    const mias = new g.DocsView(g.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMode(g.DocsViewMode.LIST);
    const compartidos = new g.DocsView(g.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setOwnedByMe(false)
      .setMode(g.DocsViewMode.LIST);
    let sel = null;
    sel = new g.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(API_KEY)
      .setTitle("Elegí los archivos del proyecto")
      .setLocale("es")
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .addView(mias)
      .addView(compartidos)
      .setCallback((data) => {
        const a = data && data.action;
        if (a !== g.Action.PICKED && a !== g.Action.CANCEL) return;
        // Cerrada la ventana, se la saca del documento: si no, queda un velo
        // invisible tapando la app.
        try {
          if (sel && sel.dispose) sel.dispose();
        } catch (e) {}
        listo(a === g.Action.PICKED ? data.docs || [] : []);
      })
      .build();
    sel.setVisible(true);
  });
}

export function initPicker() {
  if (!configurado()) return false;
  // La app pregunta por este agujero si el selector está disponible. Si no lo
  // instalamos, no muestra el botón y todo sigue como antes.
  window.__mesaDrivePicker = async () => {
    await cargarPicker();
    const t = await pedirToken();
    return mostrarSelector(t);
  };
  return true;
}
