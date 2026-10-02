import { api } from "./api";

export function pushSupported() {
  return (
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
export async function currentPush() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.pushManager.getSubscription() ?? null;
}
export async function enablePush() {
  if (!pushSupported())
    throw new Error(
      "Этот браузер не поддерживает уведомления. На iPhone добавьте Life Hub на экран «Домой» и откройте оттуда.",
    );
  // Request permission directly from the click handler, before asynchronous setup.
  // Safari requires a user gesture for the permission prompt.
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("Уведомления не разрешены. Измените разрешение для Life Hub в настройках браузера.");
  const config = await api<{ enabled: boolean; public_key: string | null }>(
    "/notifications/push/config",
  );
  if (!config.enabled || !config.public_key)
    throw new Error("Уведомления пока не настроены на сервере.");
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });
  await navigator.serviceWorker.ready;
  const encoded = config.public_key.replace(/-/g, "+").replace(/_/g, "/");
  const key = Uint8Array.from(
    atob(encoded + "=".repeat((4 - (encoded.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
  const old = await registration.pushManager.getSubscription();
  const subscription =
    old ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    }));
  try {
    await api("/notifications/push/subscriptions", {
      method: "POST",
      body: subscription.toJSON(),
    });
  } catch (error) {
    if (!old) await subscription.unsubscribe();
    throw error;
  }
}
export async function disablePush() {
  const subscription = await currentPush();
  if (!subscription) return;
  try {
    await api("/notifications/push/subscriptions", {
      method: "DELETE",
      body: { endpoint: subscription.endpoint },
    });
  } finally {
    await subscription.unsubscribe();
  }
}
