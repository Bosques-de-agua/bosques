import { supabase } from "./supabaseClient.js";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function supported() {
  return "serviceWorker" in navigator && "PushManager" in window && !!VAPID_PUBLIC_KEY;
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function guardarSub(sub) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) throw new Error("No hay sesión iniciada.");

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      endpoint: sub.endpoint,
      email: user.email,
      subscription: sub.toJSON(),
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
}

async function subscribe() {
  const reg = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permiso de notificaciones denegado.");

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await guardarSub(sub);
  return sub;
}

// Se llama en CADA arranque, y es lo que faltaba.
//
// Los navegadores rotan la suscripción cada tanto —Android más seguido—. Con
// la vieja, el envío devuelve 410, la función la borra (hace bien) y no vuelve
// nunca, porque hasta ahora solo se creaba apretando "Activar". Los avisos
// dejaban de llegar sin que nada lo dijera: el botón seguía en "Activadas",
// porque mira la suscripción del navegador y no la del servidor, y el botón
// "Probar" seguía andando, porque no pasa por el servidor.
//
// Volver a suscribirse acá no le pregunta nada a nadie: el permiso ya está
// dado. Y guardar de nuevo la misma suscripción no hace daño: es un upsert
// por endpoint.
export async function reengancharPush() {
  if (!supported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await guardarSub(sub);
    return true;
  } catch (err) {
    console.warn("Push: no se pudo revalidar la suscripción.", err);
    return false;
  }
}

async function unsubscribe() {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

// El control vive dentro de Configuración, no flotando sobre la app.
// app.js lo pide llamando a window.__mesaPushControl(contenedor).
export function initPush() {
  window.__mesaPushControl = async (host) => {
    if (!host) return;
    host.innerHTML = "";

    if (!supported()) {
      host.innerHTML =
        '<span style="font-size:12.5px;color:var(--ink-faint)">Este navegador no admite notificaciones.</span>';
      return;
    }
    if (Notification.permission === "denied") {
      host.innerHTML =
        '<span style="font-size:12.5px;color:var(--ink-faint)">Están bloqueadas en el navegador. Habilitalas desde los permisos del sitio.</span>';
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    host.appendChild(btn);

    const existing = await currentSubscription().catch(() => null);
    render(btn, !!existing);
    // El botón mira la suscripción del NAVEGADOR. Si el servidor no la tiene
    // —porque se rotó y se borró la vieja—, "Activadas" es mentira. Se vuelve
    // a guardar acá mismo, y si eso falla se dice, en vez de mostrar un
    // interruptor encendido que no enciende nada.
    if (existing) {
      const ok = await guardarSub(existing)
        .then(() => true)
        .catch((e) => {
          console.warn("Push: no se pudo registrar en el servidor", e);
          return false;
        });
      if (!ok)
        aviso(
          host,
          "Están encendidas en este teléfono, pero no se pudieron registrar en el servidor. Apagalas y volvé a encenderlas.",
          true
        );
    }

    const probar = document.createElement("button");
    probar.type = "button";
    probar.className = "btn";
    probar.style.marginLeft = "8px";
    probar.textContent = "Probar";
    probar.title = "Muestra un aviso de prueba en este teléfono";
    host.appendChild(probar);

    // No pasa por el servidor ni por Google: se lo pide directamente al
    // sistema. Si este aviso aparece y los de verdad no, el problema está en
    // la entrega; si tampoco aparece, está en este teléfono.
    probar.addEventListener("click", async () => {
      probar.disabled = true;
      try {
        if (Notification.permission !== "granted") {
          const p = await Notification.requestPermission();
          if (p !== "granted") throw new Error("permiso denegado");
        }
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification("Estudio · Bosques de Agua", {
          body: "Aviso de prueba. Si ves esto, las notificaciones funcionan en este teléfono.",
          icon: "/icon-192.png",
          data: { url: "/" },
        });
        aviso(host, "Pedido. Si no aparece nada, el teléfono está bloqueando los avisos.");
      } catch (err) {
        aviso(host, "Falló: " + String(err.message || err), true);
      } finally {
        probar.disabled = false;
      }
    });

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        if (btn.dataset.on === "1") {
          await unsubscribe();
          render(btn, false);
        } else {
          await subscribe();
          render(btn, true);
        }
      } catch (err) {
        console.error("Push:", err);
        host.insertAdjacentHTML(
          "beforeend",
          '<span style="font-size:12px;color:var(--s-bloq);margin-left:8px">No se pudo: ' +
            String(err.message || err) +
            "</span>"
        );
      } finally {
        btn.disabled = false;
      }
    });
  };
}

const ICONO_CAMPANA = '<svg class="ico" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3a4 4 0 0 0-4 4c0 3.5-1.2 4.6-1.6 5A.5.5 0 0 0 4.7 13h10.6a.5.5 0 0 0 .3-.9c-.4-.4-1.6-1.5-1.6-5a4 4 0 0 0-4-4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.4 15.5a1.8 1.8 0 0 0 3.2 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICONO_CAMPANA_TACHADA = '<svg class="ico" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3a4 4 0 0 0-4 4c0 3.5-1.2 4.6-1.6 5A.5.5 0 0 0 4.7 13h10.6a.5.5 0 0 0 .3-.9c-.4-.4-1.6-1.5-1.6-5a4 4 0 0 0-4-4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.4 15.5a1.8 1.8 0 0 0 3.2 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4 4l12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function render(btn, on) {
  btn.dataset.on = on ? "1" : "0";
  // Iconos de línea, como en toda la aplicación: toman el color del texto.
  btn.innerHTML = (on ? ICONO_CAMPANA : ICONO_CAMPANA_TACHADA) + (on ? " Activadas" : " Activar");
  btn.classList.toggle("on", on);
}

function aviso(host, texto, malo) {
  const previo = host.querySelector(".push-aviso");
  if (previo) previo.remove();
  const el = document.createElement("span");
  el.className = "push-aviso";
  el.style.cssText =
    "display:block;font-size:12px;margin-top:6px;color:" +
    (malo ? "var(--s-bloq)" : "var(--ink-faint)");
  el.textContent = texto;
  host.appendChild(el);
}
