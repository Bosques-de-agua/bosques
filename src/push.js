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

async function subscribe() {
  const reg = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permiso de notificaciones denegado.");

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      endpoint: sub.endpoint,
      email: user.email,
      subscription: sub.toJSON(),
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
  return sub;
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

function render(btn, on) {
  btn.dataset.on = on ? "1" : "0";
  btn.textContent = on ? "🔔 Activadas" : "🔕 Activar";
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
