// MEZCLA DE TRES COPIAS para el estado del equipo.
//
// El estado del equipo es UNA fila y cada guardado la manda entera. Hasta el
// 01/10 eso alcanzaba para perder una tarde de trabajo: un celular que había
// quedado dormido con la copia del mediodía se despertó, archivó una tarea
// vieja él solo, guardó, y su copia entera pisó todo lo que el equipo había
// hecho en esas horas (notas, pendientes de la Mesa, un tema con seis tareas).
//
// Ahora cada guardado dice sobre qué versión trabajó (ver sync.js). Si la base
// cambió en el medio, no se pisa: se mezcla comparando tres copias.
//   base   = lo último que este dispositivo sabía que había en la base
//   local  = lo que este dispositivo quiere guardar
//   remoto = lo que hay en la base ahora
// La regla es la de siempre: lo que solo cambió de un lado, queda como ese
// lado. Lo que cambiaron los dos se mezcla más adentro; y si ya no hay más
// adentro (un mismo texto, un mismo campo), gana lo que se está guardando.
//
// Cómo se mezcla cada forma:
//   · objetos (los temas por id, una tarea, la Mesa): campo por campo.
//   · listas de cosas con `id` (tareas, avances, mensajes, pendientes): cosa por
//     cosa. Lo nuevo de cualquier lado entra; lo borrado de un lado se va,
//     salvo que el otro lado lo haya cambiado (borrar no le gana a editar).
//   · listas de textos o números (responsables, hijos de un tema): como
//     conjuntos. Entra lo agregado de los dos lados, sale lo quitado de los dos.
//   · cualquier otra cosa tocada por los dos: gana la local.
//
// No toca sus argumentos: devuelve una estructura nueva (que puede compartir
// pedazos con ellos).

const AUSENTE = undefined;

export function igual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!igual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!igual(a[k], b[k])) return false;
  return true;
}

const esObjeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const conId = (v) => Array.isArray(v) && v.every((x) => esObjeto(x) && (typeof x.id === "string" || typeof x.id === "number"));
const primitivos = (v) => Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");

export function mezclar3(base, local, remoto) {
  if (igual(local, remoto)) return local;
  if (igual(local, base)) return remoto;   // acá no se tocó: vale lo de allá
  if (igual(remoto, base)) return local;   // allá no se tocó: vale lo de acá
  // Los dos lo cambiaron.
  if (local === AUSENTE) return remoto;    // borrado acá, editado allá: editar gana
  if (remoto === AUSENTE) return local;    // borrado allá, editado acá: editar gana
  if (esObjeto(local) && esObjeto(remoto)) return mezclarObjetos(esObjeto(base) ? base : {}, local, remoto);
  if (conId(local) && conId(remoto)) return mezclarListas(conId(base) ? base : [], local, remoto);
  if (primitivos(local) && primitivos(remoto)) return mezclarConjuntos(primitivos(base) ? base : [], local, remoto);
  return local;
}

function mezclarObjetos(b, l, r) {
  const out = {};
  const claves = new Set([...Object.keys(l), ...Object.keys(r)]);
  for (const k of claves) {
    const v = mezclar3(b[k], l[k], r[k]);
    if (v !== AUSENTE) out[k] = v;
  }
  return out;
}

function mezclarListas(b, l, r) {
  const enB = new Map(b.map((x) => [x.id, x]));
  const enR = new Map(r.map((x) => [x.id, x]));
  const enL = new Set(l.map((x) => x.id));
  const out = [];
  for (const x of l) {
    const v = mezclar3(enB.get(x.id), x, enR.get(x.id));
    if (v !== AUSENTE) out.push(v);
  }
  // Lo de allá que acá no está: si es nuevo, entra; si acá se borró sin que
  // allá lo tocaran, no vuelve; si allá lo cambiaron, vuelve.
  for (const x of r) {
    if (enL.has(x.id)) continue;
    const v = mezclar3(enB.get(x.id), AUSENTE, x);
    if (v !== AUSENTE) out.push(v);
  }
  return out;
}

function mezclarConjuntos(b, l, r) {
  const sB = new Set(b), sL = new Set(l), sR = new Set(r);
  const out = l.filter((x) => !(sB.has(x) && !sR.has(x)));   // lo que allá quitaron, se va
  for (const x of r) if (!sL.has(x) && !sB.has(x) && !out.includes(x)) out.push(x); // lo que allá agregaron, entra
  return out;
}
