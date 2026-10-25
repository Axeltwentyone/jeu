// Cache des ressources externes (modèles, textures, polices, Three.js) : le 2e lancement est quasi instantané.
const CACHE = 'babi-assets-v1';
const HOSTS = ['dl.polyhaven.org', 'api.polyhaven.com', 'cdn.jsdelivr.net', 'fonts.gstatic.com', 'fonts.googleapis.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || !HOSTS.includes(url.hostname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request.url);
    if (hit) return hit;
    let lastErr;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(e.request.url, { mode: 'cors', credentials: 'omit' });
        if (r.ok) { cache.put(e.request.url, r.clone()); return r; }
        if (r.status === 404) return r;
      } catch (err) { lastErr = err; }
      await new Promise(res => setTimeout(res, 600 * (i + 1)));
    }
    throw lastErr || new Error('fetch failed ' + url);
  })());
});
