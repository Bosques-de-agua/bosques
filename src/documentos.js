// DOCUMENTOS DEL EQUIPO — archivos grandes que se miran adentro de la app.
//
// Por qué no están en public/ del repo, que sería mucho más simple: el repo es
// PÚBLICO (Vercel gratis no despliega repos privados de una organización) y
// todo lo que está en public/ se sirve SIN login. El mapa interactivo lleva
// precios por hectárea, el estado de cada negociación campo por campo y 567
// parcelas catastrales. Publicarlo sería peor que el anuncio del parque, que el
// propio plan anual tiene anotado como riesgo.
//
// Así que viven en un bucket privado de Supabase y se bajan con la sesión de
// quien mira. Las políticas están en supabase/schema.sql, punto 10: solo
// lectura, y solo para los correos de allowed_emails. Subir un documento se
// hace desde el panel de Supabase, a mano.

import { supabase } from "./supabaseClient.js";

const BUCKET = "documentos";
const CACHE = "documentos-v1";

// Sumar uno es agregar una entrada acá y subir el archivo al bucket: el botón
// del menú y la sección los arma montarDocs(). El orden de la lista es el del
// menú. `id` no puede repetir el nombre de otra pestaña (panel, tareas, chat…).
const ICONO = {
  mapa: `<svg viewBox="0 0 20 20" fill="none"><path d="M7.5 4.5L3 6.2v9.3l4.5-1.7 5 1.7 4.5-1.7V4.5l-4.5 1.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.5 4.5v9.3M12.5 6.2v9.3" stroke="currentColor" stroke-width="1.4"/></svg>`,
  // parcelas: un terreno dividido en lotes
  campos: `<svg viewBox="0 0 20 20" fill="none"><path d="M3.5 5.5l6-2 7 2.5v9l-7 2-6-2.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.5 3.5l.5 13.5M3.5 10.5l13-1" stroke="currentColor" stroke-width="1.4"/></svg>`,
};

export const DOCS = [
  {
    id: "mapa",
    nombre: "Mapa interactivo",
    archivo: "mapa-interactivo.html",
    icono: ICONO.mapa,
    resumen:
      "Mapa satelital del parque: perímetro, lotes, mosaico de conservación, catastro y sitios de interés.",
  },
  {
    id: "campos",
    nombre: "Adquisición de campos",
    archivo: "estrategia-adquisicion.html",
    icono: ICONO.campos,
    resumen: "Estrategia de adquisición de tierras: los campos, su prioridad y el estado de cada negociación.",
  },
];

export const docPorId = (id) => DOCS.find((d) => d.id === id);

// Arma, al final del menú y separados por una rayita, un botón por documento, y
// su sección vacía en <main>. Tiene que correr ANTES de que la app enlace los
// .navtab, o los botones nuevos no responden al clic.
export function montarDocs() {
  const nav = document.querySelector("#sidebar nav.sbgroup");
  const main = document.getElementById("main");
  if (!nav || !main || nav.querySelector("[data-doc]")) return;
  const sep = document.createElement("span");
  sep.className = "sbsep";
  sep.dataset.doc = "";
  nav.appendChild(sep);
  DOCS.forEach((d) => {
    const b = document.createElement("button");
    b.className = "navtab sbitem";
    b.dataset.tab = d.id;
    b.dataset.doc = d.id;
    b.title = d.nombre;
    b.innerHTML = `${d.icono || ""}<span class="sblbl">${escapar(d.nombre)}</span>`;
    nav.appendChild(b);
    const s = document.createElement("section");
    s.className = "tab tabdoc";
    s.id = "tab-" + d.id;
    s.innerHTML = `<div class="dochost" id="dochost-${d.id}"></div>`;
    main.appendChild(s);
  });
}

// La versión del archivo según el bucket. Sirve para dos cosas: saber si lo que
// está cacheado sigue sirviendo, y mostrar de cuándo es lo que estás mirando.
async function versionDe(archivo) {
  // Sin sesión, `list` sobre un bucket privado devuelve una lista vacía en vez
  // de un error de permisos. Sin este chequeo, "no estás identificado" se le
  // aparecería a la gente como "el documento todavía no está subido".
  const { data: ses } = await supabase.auth.getSession();
  if (!ses || !ses.session) {
    const e = new Error("No pudimos identificarte. Salí y volvé a entrar.");
    e.sinSesion = true;
    throw e;
  }
  const { data, error } = await supabase.storage.from(BUCKET).list("", {
    search: archivo,
    limit: 100,
  });
  if (error) throw error;
  const f = (data || []).find((x) => x.name === archivo);
  if (!f) throw new Error("No encontramos el archivo en el bucket.");
  return f.updated_at || f.created_at || "";
}

// El archivo pesa varios MB, así que se guarda en la caché del navegador con la
// versión adentro de la clave: mientras no subas una versión nueva, se baja una
// sola vez por persona. Si la caché no está disponible (modo incógnito, permisos)
// simplemente se baja cada vez, sin romperse.
async function bajarConCache(archivo, version) {
  const clave = `/documento/${archivo}?v=${encodeURIComponent(version)}`;
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const pegado = await cache.match(clave);
    if (pegado) return { blob: await pegado.blob(), deCache: true };
  } catch (e) {
    /* sin caché: seguimos igual */
  }

  const { data, error } = await supabase.storage.from(BUCKET).download(archivo);
  if (error) throw error;

  if (cache) {
    try {
      // Las versiones viejas del mismo documento no sirven más y ocupan MB.
      const viejas = await cache.keys();
      await Promise.all(
        viejas
          .filter((r) => r.url.includes(`/documento/${archivo}?v=`))
          .map((r) => cache.delete(r)),
      );
      await cache.put(clave, new Response(data.slice(), { headers: { "content-type": "text/html" } }));
    } catch (e) {
      /* si no se puede guardar, da igual: ya lo tenemos en memoria */
    }
  }
  return { blob: data, deCache: false };
}

const fechaLinda = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
};

// Cada documento abierto deja un blob dando vueltas; se suelta al cambiar de
// documento o al salir, para no acumular varios MB por visita.
let urlActual = null;
function soltarUrl() {
  if (urlActual) {
    URL.revokeObjectURL(urlActual);
    urlActual = null;
  }
}

/**
 * Pinta un documento dentro de `host`. Devuelve una promesa que se resuelve
 * cuando terminó de cargar (o de fallar, ya mostrando el error en pantalla).
 */
export async function pintarDoc(host, doc) {
  if (!host || !doc) return;
  soltarUrl();
  host.innerHTML = `
    <div class="docbar">
      <div class="docnom">
        <strong>${escapar(doc.nombre)}</strong>
        <span class="docver" id="docVer"></span>
      </div>
      <div class="docacc">
        <button class="btn" id="docFull" hidden>Pantalla completa</button>
      </div>
    </div>
    <div class="doccuerpo" id="docCuerpo">
      <div class="doccargando">Abriendo ${escapar(doc.nombre)}…</div>
    </div>`;

  const cuerpo = host.querySelector("#docCuerpo");
  const verLbl = host.querySelector("#docVer");
  const btnFull = host.querySelector("#docFull");

  try {
    const version = await versionDe(doc.archivo);
    const { blob, deCache } = await bajarConCache(doc.archivo, version);

    // El tipo se fuerza a HTML a propósito: si el bucket devolviera el archivo
    // como octet-stream o texto plano, el marco lo mostraría como código o se
    // lo bajaría en vez de dibujar el mapa.
    urlActual = URL.createObjectURL(new Blob([blob], { type: "text/html" }));
    const marco = document.createElement("iframe");
    marco.className = "docmarco";
    marco.setAttribute("allowfullscreen", "");
    marco.setAttribute("title", doc.nombre);
    marco.src = urlActual;
    cuerpo.innerHTML = "";
    cuerpo.appendChild(marco);

    const f = fechaLinda(version);
    verLbl.textContent = f ? `actualizado el ${f}` : "";
    verLbl.title = deCache ? "Cargado desde este navegador" : "Recién bajado";

    btnFull.hidden = false;
    btnFull.addEventListener("click", () => {
      const obj = cuerpo;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (obj.requestFullscreen) obj.requestFullscreen();
    });
    document.addEventListener("fullscreenchange", () => {
      btnFull.textContent = document.fullscreenElement ? "Salir de pantalla completa" : "Pantalla completa";
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    // El caso más probable y el más confuso: el archivo todavía no se subió.
    const falta = !e.sinSesion && /not found|no encontramos|object/i.test(msg);
    cuerpo.innerHTML = `<div class="docerror">
      <strong>${falta ? "Todavía no está subido" : "No pudimos abrirlo"}</strong>
      <p>${
        falta
          ? `El documento <b>${escapar(doc.archivo)}</b> no está en el bucket. Se sube desde el panel de Supabase.`
          : escapar(msg)
      }</p>
    </div>`;
  }
}

export function cerrarDoc() {
  soltarUrl();
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
