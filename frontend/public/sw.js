/* Notification-only worker: no authenticated responses or pages are cached. */
self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    return;
  }
  if (!data) return;
  event.waitUntil(
    self.registration.showNotification("Life Hub", {
      body: data.body || "Откройте ваши планы.",
      tag: data.tag || "lifehub-reminder",
      icon: "/favicon.svg",
      data: {
        url:
          typeof data.url === "string" &&
          /^\/(planning|home|modules\/(goals_habits|health|finance|books))([/?#]|$)/.test(
            data.url,
          )
            ? data.url
            : "/planning",
      },
      renotify: false,
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const destination = event.notification.data?.url || "/planning";
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.navigate(destination);
          return client.focus();
        }
      }
      return self.clients.openWindow(destination);
    })(),
  );
});
