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

function makePill() {
  const pill = document.createElement("button");
  pill.className = "signout-pill push-pill";
  pill.type = "button";
  document.body.appendChild(pill);
  return pill;
}

export async function initPush() {
  if (!supported()) return;
  if (Notification.permission === "denied") return;

  const pill = makePill();
  const existing = await currentSubscription().catch(() => null);
  render(pill, !!existing);

  pill.addEventListener("click", async () => {
    pill.disabled = true;
    try {
      if (pill.dataset.on === "1") {
        await unsubscribe();
        render(pill, false);
      } else {
        await subscribe();
        render(pill, true);
      }
    } catch (err) {
      console.error("Push:", err);
      alert("No se pudo activar las notificaciones: " + err.message);
    } finally {
      pill.disabled = false;
    }
  });
}

function render(pill, on) {
  pill.dataset.on = on ? "1" : "0";
  pill.textContent = on ? "🔔 Notificaciones activadas" : "🔕 Activar notificaciones";
}
