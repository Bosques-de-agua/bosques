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
import { pushRemoteState, setSaveStateHandler, hayCambiosSinGuardar, reintentarPendiente, fetchRemoteState, setRemoteMergedHandler, versionConocida } from "./sync.js";
import { mezclar3 } from "./mezcla.js";
import { pushPrivateState, setPrivateSaveStateHandler, setPrivateMergedHandler, mezclarPrivado, fetchPrivateState } from "./private.js";

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

// La escritura condicionada a la versión (`update ... where updated_at = …`)
// se comporta acá como si la base nunca hubiera cambiado: estas pruebas miran
// reintentos y fallos de red. Los choques de versión se prueban en la 8.
supabase.from = (tabla) => ({
  upsert: async (fila) => {
    const error = responder(fila);
    escrituras.push({ tabla, data: fila.data, ok: !error });
    return { error };
  },
  update: (fila) => {
    const u = {
      eq: () => u,
      select: async () => {
        const error = responder(fila);
        escrituras.push({ tabla, data: fila.data, ok: !error });
        return error ? { data: null, error } : { data: [{ updated_at: fila.updated_at }], error: null };
      },
    };
    return u;
  },
});

// Para probar la mezcla entre dispositivos: una base que además se deja leer.
function supabaseConLectura(leer) {
  supabase.from = (tabla) => ({
    upsert: async (fila) => { const error = responder(fila); escrituras.push({ tabla, data: fila.data, ok: !error }); return { error }; },
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: leer(), error: null }) }) }),
  });
}
const fromSinLectura = supabase.from;
function supabaseSinLectura() { supabase.from = fromSinLectura; }
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

// -----------------------------------------------------------------------
// Dos dispositivos con la app abierta: la copia vieja de uno no puede pisar
// lo que se anotó en el otro. La falla real: un recordatorio creado en un
// dispositivo desapareció a los 90 segundos, cuando el otro guardó lo suyo.
// -----------------------------------------------------------------------
linea("\n6. Lo privado se mezcla entre dispositivos, no se pisa");
{
  const r = (id, t) => ({ id, t });
  const b = { recordatorios: [r("a", "viejo"), r("b", "se borra allá"), r("c", "se borra acá")], myNotes: [] };
  const local = { recordatorios: [r("a", "viejo"), r("b", "se borra allá"), r("d", "nuevo de acá")], myNotes: [{ id: "n1", text: "nota de acá" }] };
  const remoto = { recordatorios: [r("a", "cambiado allá"), r("c", "se borra acá"), r("e", "nuevo de allá")], myNotes: [] };
  const m = mezclarPrivado(b, local, remoto);
  const ids = m.recordatorios.map((x) => x.id).sort().join("");
  afirmar(ids === "ade", "entran lo nuevo de acá y lo nuevo de allá; lo borrado en cualquiera de los dos no vuelve", "quedaron: " + ids);
  afirmar(m.recordatorios.find((x) => x.id === "a").t === "cambiado allá", "lo que solo cambió allá, queda como allá");
  afirmar(m.myNotes.length === 1, "la nota escrita acá no se pierde");
  const choque = mezclarPrivado({ recordatorios: [r("a", "base")] }, { recordatorios: [r("a", "acá")] }, { recordatorios: [r("a", "allá")] });
  afirmar(choque.recordatorios[0].t === "acá", "si los dos tocaron lo mismo, gana lo que se está guardando ahora");

  // De punta a punta: se leyó la fila, otro dispositivo escribió, y recién ahí guarda este.
  reiniciar();
  let fila = { data: { recordatorios: [r("a", "viejo")] }, updated_at: "2026-09-30T16:00:00.000+00:00" };
  supabaseConLectura(() => fila);
  await fetchPrivateState("yo@ejemplo.org");
  fila = { data: { recordatorios: [r("a", "viejo"), r("x", "creado en el celular")] }, updated_at: "2026-09-30T16:05:00.000+00:00" };
  let avisado = null;
  setPrivateMergedHandler((d) => { avisado = d; });
  pushPrivateState("yo@ejemplo.org", { recordatorios: [r("a", "viejo"), r("y", "creado en la compu")] });
  await esperar(900);
  const ult = soloOk()[soloOk().length - 1];
  const guardados = ult ? ult.data.recordatorios.map((x) => x.id).sort().join("") : "";
  afirmar(guardados === "axy", "al guardar desde la compu, el recordatorio del celular sigue ahí", "se guardó: " + guardados);
  afirmar(!!avisado && avisado.recordatorios.length === 3, "y la pantalla se entera de lo que vino del otro dispositivo");
  setPrivateMergedHandler(null);
  supabaseSinLectura();
}

// -----------------------------------------------------------------------
// 7. La mezcla de tres copias del estado del equipo.
// -----------------------------------------------------------------------
linea("\n7. Mezcla del estado del equipo");
{
  const t = (id, extra) => ({ id, title: id, ...extra });
  const b = { nodes: { A: { name: "A", children: ["x"], items: [t("t1", { notas: "vieja" }), t("t2"), t("t3")] } }, mesa: { items: [] } };
  const local = { nodes: { A: { name: "A", children: ["x"], items: [t("t1", { notas: "vieja" }), t("t2", { archived: true }), t("t3")] } }, mesa: { items: [] } };
  const remoto = { nodes: { A: { name: "A Lab", children: ["x", "y"], items: [t("t1", { notas: "vieja\n29/09: 20%" }), t("t2"), t("t4")] }, B: { name: "nuevo" } }, mesa: { items: [{ id: "m1" }] } };
  const m = mezclar3(b, local, remoto);
  const it = m.nodes.A.items;
  afirmar(it.find((k) => k.id === "t1").notas.includes("29/09"), "la nota escrita en otro dispositivo no se pierde");
  afirmar(it.find((k) => k.id === "t2").archived === true, "lo que este dispositivo cambió, queda");
  afirmar(!it.some((k) => k.id === "t3"), "lo borrado allá no vuelve", it.map((k) => k.id).join(","));
  afirmar(it.some((k) => k.id === "t4") && !!m.nodes.B && m.mesa.items.length === 1, "lo creado allá (tarea, tema, pendiente) queda");
  afirmar(m.nodes.A.name === "A Lab" && m.nodes.A.children.join() === "x,y", "renombres e hijos nuevos de allá quedan");
  const r2 = mezclar3({ o: ["Nico", "Pablo"] }, { o: ["Nico", "Pablo", "Lucas"] }, { o: ["Nico"] });
  afirmar(r2.o.join() === "Nico,Lucas", "responsables: se suma lo agregado acá y se va lo quitado allá", r2.o.join());
  const r3 = mezclar3({ l: [t("a", { v: 1 })] }, { l: [] }, { l: [t("a", { v: 2 })] });
  afirmar(r3.l.length === 1, "borrar acá no le gana a editar allá");
}

// -----------------------------------------------------------------------
// 8. Un dispositivo con la copia vieja NO pisa la base: choca y mezcla.
//
// La falla real (01/10): un celular dormido desde el mediodía se despertó a
// la mañana, archivó solo una tarea y subió su copia ENTERA. Se perdieron
// una tarde de notas, 4 pendientes de la Mesa y un tema con 6 tareas.
// -----------------------------------------------------------------------
linea("\n8. Una copia vieja no pisa la base: choca, relee y mezcla");
{
  let db = null;
  const filasEscritas = [];
  supabase.from = () => {
    const filtros = {};
    const q = {
      select: () => q,
      eq: (c, v) => { filtros[c] = v; return q; },
      maybeSingle: async () => ({ data: db && JSON.parse(JSON.stringify(db)), error: null }),
      update: (fila) => {
        const u = {
          eq: (c, v) => { filtros[c] = v; return u; },
          select: async () => {
            if (filtros.updated_at !== db.updated_at) return { data: [], error: null };
            db = { data: JSON.parse(JSON.stringify(fila.data)), updated_at: fila.updated_at };
            filasEscritas.push(db.data);
            return { data: [{ updated_at: db.updated_at }], error: null };
          },
        };
        return u;
      },
      upsert: async (fila) => { db = { data: fila.data, updated_at: fila.updated_at }; filasEscritas.push(fila.data); return { error: null }; },
    };
    return q;
  };
  const tarea = (id, notas) => ({ id, title: id, notas });
  db = { data: { nodes: { A: { name: "A", items: [tarea("siembra", "27/09"), tarea("vieja", "")] } }, mesa: { items: [] } }, updated_at: "2026-09-30T15:00:00.000Z" };
  await fetchRemoteState();                                   // el celular lee al mediodía y se duerme
  const copiaDelCelular = JSON.parse(JSON.stringify(db.data));
  // Durante la tarde, otro dispositivo trabaja.
  db = { data: { nodes: { A: { name: "A", items: [tarea("siembra", "27/09\n29/09: 20%"), tarea("vieja", "")] }, T: { name: "Siembra de 10k TN", items: [tarea("n1", "")] } }, mesa: { items: [{ id: "def1" }, { id: "def2" }] } }, updated_at: "2026-09-30T19:00:00.000Z" };
  // A la mañana, el celular cambia una sola cosa sobre su copia vieja y guarda.
  copiaDelCelular.nodes.A.items[1].archived = true;
  let mostrado = null;
  setRemoteMergedHandler((d) => { mostrado = d; });
  pushRemoteState(copiaDelCelular);
  await esperar(600);
  const fin = db.data;
  afirmar(fin.nodes.A.items[0].notas.includes("29/09"), "la nota de la tarde sigue en la base");
  afirmar(!!fin.nodes.T && fin.mesa.items.length === 2, "el tema nuevo y los pendientes de la Mesa siguen");
  afirmar(fin.nodes.A.items[1].archived === true, "y el cambio del celular también entró");
  afirmar(!filasEscritas.some((d) => !d.nodes.T), "en ningún momento se escribió la copia vieja", "escrituras: " + filasEscritas.length);
  afirmar(!!mostrado && !!mostrado.nodes.T, "la pantalla del celular pasa a mostrar la mezcla");
  afirmar(versionConocida() === db.updated_at, "y queda parado sobre la versión nueva");
  setRemoteMergedHandler(null);
  supabaseSinLectura();
}

// =======================================================================
setSaveStateHandler(null);
setPrivateSaveStateHandler(null);
linea("\n===================");
linea(fallaron === 0 ? "TODO BIEN — " + "sin fallas" : "HAY " + fallaron + " FALLA(S)");
document.title = (fallaron === 0 ? "OK" : "FALLA") + " · Pruebas de guardado";
window.__pruebas = { fallaron };
