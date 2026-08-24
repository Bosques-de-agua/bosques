// PRUEBAS DE LA CAPA DE GUARDADO — solo corren en el servidor local
// (/pruebas.html). Vite construye únicamente index.html, así que este archivo
// NUNCA se despliega, igual que el banco.
//
// Por qué existe aparte del banco: el banco reemplaza el guardado por espías
// para poder mirar la interfaz sin red, así que `sync.js` y `private.js` —que
// son justo donde se puede perder trabajo en silencio— no se ejecutan nunca
// ahí. Acá se ejecutan de verdad, con la base reemplazada por una de mentira
// que responde lo que cada prueba necesite.
//
// Cada prueba de acá corresponde a una falla REAL que existió en el código.
// Están para que no vuelva.
import { supabase } from "./supabaseClient.js";
import { pushRemoteState, setSaveStateHandler, hayCambiosSinGuardar, reintentarPendiente } from "./sync.js";
import { pushPrivateState, setPrivateSaveStateHandler } from "./private.js";

const salida = document.getElementById("salida");
let fallaron = 0;
const linea = (t) => { salida.textContent += t + "\n"; };
function afirmar(ok, titulo, detalle) {
  if (!ok) fallaron++;
  linea((ok ? "  BIEN  · " : "  MAL   · ") + titulo + (detalle ? "\n           " + detalle : ""));
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- la base de mentira -----------------------------------------------
// Se le cambia el método a la instancia real; `sync.js` y `private.js` la
// usan por referencia, así que reciben esta sin enterarse.
let escrituras = [];
let responder = () => null; // devuelve un error, o null si sale bien

supabase.from = (tabla) => ({
  upsert: async (fila) => {
    const error = responder(fila);
    escrituras.push({ tabla, data: fila.data, ok: !error });
    return { error };
  },
});

const soloOk = () => escrituras.filter((e) => e.ok);
function reiniciar() { escrituras = []; responder = () => null; }

// =======================================================================
linea("PRUEBAS DE GUARDADO\n===================\n");

// -----------------------------------------------------------------------
// 1. Un reintento no puede pisar un contenido más nuevo que ya salió bien.
//
// La falla real: fallaba una escritura y se agendaba el reintento; seguías
// escribiendo y la versión nueva salía bien; y el reintento de la versión
// VIEJA la escribía encima. En pantalla decía "guardado".
// -----------------------------------------------------------------------
linea("1. El reintento no pisa lo más nuevo (equipo)");
reiniciar();
responder = () => ({ message: "sin red (simulado)" });
pushRemoteState({ v: "VIEJO" });
await esperar(450);                       // sale VIEJO, falla, agenda reintento
responder = () => null;                   // vuelve la red
pushRemoteState({ v: "NUEVO" });
await esperar(500);                       // sale NUEVO, bien
await esperar(1400);                      // acá caería el reintento de VIEJO

const ultima = soloOk()[soloOk().length - 1];
afirmar(ultima && ultima.data.v === "NUEVO", "lo último que quedó en la base es NUEVO",
  "quedó: " + JSON.stringify(ultima && ultima.data));
const iNuevo = escrituras.findIndex((e) => e.ok && e.data.v === "NUEVO");
const viejoDespues = escrituras.some((e, i) => i > iNuevo && e.data.v === "VIEJO");
afirmar(!viejoDespues, "el reintento de VIEJO no se ejecutó después de NUEVO",
  "escrituras: " + escrituras.map((e) => e.data.v + (e.ok ? "✓" : "✗")).join(" → "));

// -----------------------------------------------------------------------
// 2. Lo mismo, con las notas y tareas privadas.
// -----------------------------------------------------------------------
linea("\n2. El reintento no pisa lo más nuevo (privado)");
reiniciar();
responder = () => ({ message: "sin red (simulado)" });
pushPrivateState("yo@ejemplo.org", { v: "VIEJO" });
await esperar(800);                       // el debounce privado es 700 ms
responder = () => null;
pushPrivateState("yo@ejemplo.org", { v: "NUEVO" });
await esperar(900);
await esperar(1400);

const ultimaP = soloOk()[soloOk().length - 1];
afirmar(ultimaP && ultimaP.data.v === "NUEVO", "lo último privado que quedó es NUEVO",
  "quedó: " + JSON.stringify(ultimaP && ultimaP.data));
const iNuevoP = escrituras.findIndex((e) => e.ok && e.data.v === "NUEVO");
afirmar(!escrituras.some((e, i) => i > iNuevoP && e.data.v === "VIEJO"),
  "el reintento privado de VIEJO no se ejecutó después de NUEVO",
  "escrituras: " + escrituras.map((e) => e.data.v + (e.ok ? "✓" : "✗")).join(" → "));

// -----------------------------------------------------------------------
// 3. El reintento SIGUE sirviendo para lo que fue hecho: un corte corto de
//    red no tiene que costarle el trabajo a nadie.
// -----------------------------------------------------------------------
linea("\n3. Un corte corto de red se recupera solo");
reiniciar();
let intentos = 0;
responder = () => (++intentos <= 2 ? { message: "sin red (simulado)" } : null);
let estados = [];
setSaveStateHandler((e) => estados.push(e));
pushRemoteState({ v: "UNICO" });
await esperar(4000);                      // 350 + 900 + 1800 y algo de aire

afirmar(soloOk().length === 1, "terminó guardando, después de dos fallos",
  "intentos: " + escrituras.length + ", exitosos: " + soloOk().length);
afirmar(estados[estados.length - 1] === "guardado", "el cartel terminó en 'guardado'",
  "estados: " + estados.join(" → "));
afirmar(!estados.includes("error"), "no dio la alarma por un corte que se resolvió solo");

// -----------------------------------------------------------------------
// 4. Si la red no vuelve, la alarma SÍ tiene que sonar. Es lo que hace que
//    el navegador pregunte antes de cerrar la pestaña.
// -----------------------------------------------------------------------
linea("\n4. Si la red no vuelve, avisa");
reiniciar();
responder = () => ({ message: "sin red (simulado)" });
estados = [];
setSaveStateHandler((e) => estados.push(e));
pushRemoteState({ v: "PERDIDO" });
await esperar(4000);

afirmar(estados.includes("error"), "avisó del fallo tras agotar los reintentos",
  "estados: " + estados.join(" → "));

// -----------------------------------------------------------------------
// 5. Lo que NO entró sigue contando como trabajo sin guardar, y vuelve a
//    salir cuando hay red.
//
//    La falla real: al agotarse los reintentos, `pendiente` ya se había
//    consumido y `escribiendo` volvía a false, así que la app creía que no
//    quedaba nada sin guardar. Trabajabas sin conexión, volvía la conexión,
//    la app releía del servidor y te reemplazaba lo escrito por la versión
//    vieja. Es la unica proteccion que tiene el trabajo hecho sin red.
// -----------------------------------------------------------------------
linea("\n5. Lo que no entró no se da por perdido");
afirmar(hayCambiosSinGuardar() === true,
  "tras fallar del todo, sigue diciendo que hay trabajo sin guardar",
  "si diera false, al volver la conexión se relee del servidor y se pisa");

reiniciar();
estados = [];
setSaveStateHandler((e) => estados.push(e));
responder = () => null;                    // vuelve la red
const salio = reintentarPendiente();
await esperar(600);

afirmar(salio === true, "al volver la red, reintenta lo que había quedado afuera");
const rec = soloOk()[soloOk().length - 1];
afirmar(rec && rec.data.v === "PERDIDO", "y lo que entra es EXACTAMENTE lo que se había perdido",
  "entró: " + JSON.stringify(rec && rec.data));
afirmar(hayCambiosSinGuardar() === false, "una vez guardado, deja de contar como pendiente");

// =======================================================================
setSaveStateHandler(null);
setPrivateSaveStateHandler(null);
linea("\n===================");
linea(fallaron === 0 ? "TODO BIEN — " + "sin fallas" : "HAY " + fallaron + " FALLA(S)");
document.title = (fallaron === 0 ? "OK" : "FALLA") + " · Pruebas de guardado";
window.__pruebas = { fallaron };
