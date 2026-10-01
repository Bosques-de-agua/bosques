// AUDITORÍA DE DATOS DE LA SEMANA — ¿la app volvió alguna vez para atrás?
//
// El 01/10 un dispositivo dormido con la copia del mediodía anterior guardó
// encima de todo y se perdió una tarde de trabajo. Nadie se dio cuenta hasta
// que Nico abrió una tarea y no encontró su nota. Desde ese día el guardado
// mezcla en vez de pisar (src/mezcla.js), así que no debería repetirse; esto
// es el control de seguridad, por si acaso.
//
// Cómo se ve un retroceso en los respaldos por hora: una foto se parece mucho
// más a una de hace varias horas que a la inmediatamente anterior. Lo normal
// es lo contrario: cada foto se parece sobre todo a la de antes.
//
// Sin red, sin claves: recibe las fotos y devuelve lo que encontró. La parte
// que baja los respaldos está en semana-datos.mjs.
//   node scripts/semana-retrocesos.prueba.mjs

// Las coordenadas del mapa se mueven solas al reacomodarse: no cuentan.
function aplanar(o, p = "", out = new Map()) {
  if (o && typeof o === "object") { for (const [k, v] of Object.entries(o)) aplanar(v, p + "/" + k, out); }
  else if (!/\/(x|y)$/.test(p)) out.set(p, JSON.stringify(o));
  return out;
}
function distancia(a, b) {
  let n = 0;
  for (const [k, v] of a) if (b.get(k) !== v) n++;
  for (const k of b.keys()) if (!a.has(k)) n++;
  return n;
}
const tareas = (d) => {
  const m = new Map();
  for (const n of Object.values((d && d.nodes) || {})) for (const k of n.items || []) m.set(k.id, k.title);
  return m;
};

// fotos: [{ id, taken_at, data }] en orden de tiempo.
// Devuelve [{ en, previo, seParece, cuanto, faltan: [títulos], mesaAntes, mesaDespues }]
export function buscarRetrocesos(fotos, { ventana = 48 } = {}) {
  const planas = fotos.map((f) => aplanar(f.data));
  const hallazgos = [];
  for (let i = 2; i < fotos.length; i++) {
    const alAnterior = distancia(planas[i], planas[i - 1]);
    let mejor = null;
    for (let j = Math.max(0, i - ventana); j < i - 1; j++) {
      const d = distancia(planas[i], planas[j]);
      if (!mejor || d < mejor.d) mejor = { d, j };
    }
    if (!mejor || !(mejor.d < alAnterior * 0.5 && alAnterior - mejor.d > 20)) continue;
    // Parecerse a una foto vieja no alcanza: borrar mucho de golpe también
    // acerca al pasado. Lo que delata un retroceso es que REAPARECEN valores
    // viejos — un texto que se había editado vuelve a como era, algo borrado
    // vuelve a estar. En una limpieza a propósito no vuelve nada.
    let vuelven = 0;
    for (const [k, v] of planas[i]) if (planas[mejor.j].get(k) === v && planas[i - 1].get(k) !== v) vuelven++;
    if (vuelven <= 20) continue;
    const antes = tareas(fotos[i - 1].data), despues = tareas(fotos[i].data);
    hallazgos.push({
      en: fotos[i].taken_at,
      previo: fotos[i - 1].taken_at,
      seParece: fotos[mejor.j].taken_at,
      cuanto: alAnterior,
      faltan: [...antes].filter(([id]) => !despues.has(id)).map(([, t]) => t),
      mesaAntes: ((fotos[i - 1].data.mesa || {}).items || []).length,
      mesaDespues: ((fotos[i].data.mesa || {}).items || []).length,
    });
  }
  return hallazgos;
}

export function textoAuditoria(hallazgos, cuantasFotos) {
  if (cuantasFotos < 3) return "AUDITORÍA DE DATOS: no alcanzan los respaldos de la semana para revisar (" + cuantasFotos + ").";
  if (!hallazgos.length) return "AUDITORÍA DE DATOS: sin pérdidas de datos esta semana (" + cuantasFotos + " respaldos revisados).";
  const l = ["AUDITORÍA DE DATOS: ⚠️ LA APP VOLVIÓ PARA ATRÁS " + hallazgos.length + " VEZ/VECES ESTA SEMANA"];
  for (const h of hallazgos) {
    l.push(`- Entre ${h.previo} y ${h.en} el estado volvió a como estaba el ${h.seParece} (${h.cuanto} datos distintos).`);
    if (h.faltan.length) l.push(`  Tareas que desaparecieron en ese salto: ${h.faltan.join("; ")}`);
    if (h.mesaAntes !== h.mesaDespues) l.push(`  Pendientes en la Mesa de trabajo: ${h.mesaAntes} → ${h.mesaDespues}`);
  }
  l.push("  Puede ser una restauración hecha a propósito (mirar la nota de los respaldos manuales) o una pérdida. Se recupera desde app_state_backup.");
  return l.join("\n");
}
