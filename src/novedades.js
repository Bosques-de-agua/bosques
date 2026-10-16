// NOVEDADES DE LA APP — lo que cambió en cada publicación, contado para el
// equipo (no para quien la programa). La más nueva va PRIMERO.
//
// Al abrir la app, quien todavía no vio la primera la ve una sola vez en un
// cartel; el resto queda en Configuración › Novedades. Además,
// `scripts/avisar-novedad.mjs` manda la notificación a todos los
// dispositivos, con el texto de `aviso`, y la notificación abre el cartel.
//
// Cada entrada: id único (fecha + palabra), fecha, título, aviso (una línea
// para la notificación) y puntos (se permite **negrita**; nada más).
export const NOVEDADES = [
  {
    id: "2026-10-16-fechas",
    fecha: "2026-10-16",
    titulo: "Dos fechas por tarea y buscador en Mi foco",
    aviso: "Las tareas ahora tienen \"para el\" y fecha límite, y Mi foco tiene buscador. Tocá para ver qué cambió.",
    puntos: [
      "**Para el**: la fecha de siempre ahora es el día en que querés encarar la tarea. No vence: si pasa y no la terminaste, se corre sola a hoy hasta que la tildes.",
      "**Fecha límite** (opcional): en la ficha de la tarea, tocá **＋ fecha límite**. Es la única fecha que vence: avisa en ámbar cuando faltan 3 días y en rojo si venció.",
      "**Tu semana**: hay un bloque nuevo, **Para hacer**. «Vencidas» y «Vencen» ahora miran solo la fecha límite.",
      "**Calendario**: la tarea aparece el día que la planeaste (o hoy, si quedó atrás) y la fecha límite aparte, con ⚑.",
      "**Buscador en Mi foco**: arriba de tus tareas, para encontrar una por el nombre o el tema, incluso las terminadas.",
      "Las fechas que ya estaban cargadas quedaron como «para el». Si alguna era en realidad un límite, cambiala en la ficha.",
    ],
  },
];
