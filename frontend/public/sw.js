self.addEventListener('push', (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.some((client) => client.visibilityState === 'visible')) return undefined;
      return self.registration.showNotification(payload.title || 'Medicine reminder', {
        body: payload.body || 'It is time to take your medicine.',
        tag: payload.tag || 'medreminder-dose',
        data: { url: payload.url || '/' },
        renotify: false,
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      return existing ? existing.focus() : self.clients.openWindow(event.notification.data?.url || '/');
    })
  );
});
