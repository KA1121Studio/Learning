self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('push', event => {
  if (!event.data) return;

  const data = event.data.json();

  self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon.png',
    badge: '/icon.png'
  });
});
