self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Passthrough — no offline caching, solo existe para habilitar instalación y push.
self.addEventListener("fetch", () => {});

// El navegador rota la suscripción cada tanto y avisa por acá. Se rehace en el
// momento, con la misma clave del servidor que traía la vieja; el endpoint
// nuevo se guarda en la base la próxima vez que se abra la app, que es lo que
// hace `reengancharPush()`. Sin esto, la suscripción moría en silencio y los
// avisos dejaban de llegar sin que nada lo dijera.
self.addEventListener("pushsubscriptionchange", (event) => {
  const vieja = event.oldSubscription;
  const clave = vieja && vieja.options && vieja.options.applicationServerKey;
  if (event.newSubscription || !clave) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: clave })
      .catch(() => {})
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "Estudio · Bosques de Agua", body: "Tenés novedades." };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // La foto de quien escribe cuando la tiene, y si no el logo. El color de
      // la persona viaja como un punto delante del nombre: el aviso del
      // sistema no se puede pintar desde la web.
      icon: payload.icon || "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        // Navegar antes de enfocar: si solo enfocamos, el enlace de la
        // notificación (/?tarea=id) se pierde y no se abre nada en concreto.
        if ("navigate" in client) {
          return client.navigate(url).then((c) => (c && c.focus ? c.focus() : null));
        }
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
