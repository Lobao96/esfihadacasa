// Service worker do painel. Só existe para uma coisa: mostrar o aviso de
// pedido novo mesmo com o telemóvel bloqueado e a app fechada.

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  e.waitUntil(
    self.registration.showNotification('🫓 Novo pedido!', {
      body: 'Toque para abrir o painel.',
      icon: '/icon-512.png',
      badge: '/icon-32.png',
      tag: 'pedido-novo',
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 80, 200, 80, 200],
      data: { url: '/painel/' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of janelas) {
      if (c.url.indexOf('/painel/') >= 0) { await c.focus(); return; }
    }
    await self.clients.openWindow('/painel/');
  })());
});
