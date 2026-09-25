// Service worker do painel. Existe para duas coisas: mostrar o aviso de
// pedido novo com o telemóvel bloqueado, e pôr o número por cima do ícone
// da app, para se saber quantos pedidos estão à espera sem abrir nada.

const CONTADOR = 'contador-pedidos';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

async function lerContador() {
  try {
    const c = await caches.open(CONTADOR);
    const r = await c.match('/n');
    if (!r) return 0;
    return parseInt(await r.text(), 10) || 0;
  } catch (e) { return 0; }
}

async function gravarContador(n) {
  try {
    const c = await caches.open(CONTADOR);
    await c.put('/n', new Response(String(n)));
  } catch (e) {}
}

async function marcarIcone(n) {
  try {
    if (n > 0 && self.navigator && self.navigator.setAppBadge) {
      await self.navigator.setAppBadge(n);
    } else if (self.navigator && self.navigator.clearAppBadge) {
      await self.navigator.clearAppBadge();
    }
  } catch (e) {}
}

async function limparTudo() {
  await gravarContador(0);
  await marcarIcone(0);
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    // Se o painel estiver aberto e à vista, ele próprio já mostra o pedido:
    // não se acumula contador nem se repete o aviso.
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aberto = janelas.some(c => c.visibilityState === 'visible' && c.url.indexOf('/painel/') >= 0);

    let n = 0;
    if (!aberto) {
      n = (await lerContador()) + 1;
      await gravarContador(n);
      await marcarIcone(n);
    }

    const titulo = n > 1 ? `🫓 ${n} pedidos novos!` : '🫓 Novo pedido!';
    const corpo = n > 1
      ? `Tens ${n} pedidos à espera. Toque para abrir o painel.`
      : 'Toque para abrir o painel.';

    await self.registration.showNotification(titulo, {
      body: corpo,
      icon: '/icon-512.png',
      badge: '/icon-32.png',
      tag: 'pedido-novo',
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 80, 200, 80, 200],
      data: { url: '/painel/' },
    });

    // Avisa o painel aberto, se houver, para ele recarregar já.
    for (const c of janelas) {
      try { c.postMessage({ tipo: 'pedido-novo' }); } catch (e) {}
    }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    await limparTudo();
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of janelas) {
      if (c.url.indexOf('/painel/') >= 0) { await c.focus(); return; }
    }
    await self.clients.openWindow('/painel/');
  })());
});

// O painel manda esta mensagem quando é aberto ou volta a estar à vista.
self.addEventListener('message', e => {
  if (e.data && e.data.tipo === 'limpar-contador') e.waitUntil(limparTudo());
});
