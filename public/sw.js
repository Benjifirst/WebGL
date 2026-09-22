// Service Worker: App offline verfügbar machen.
// - Navigation: Netz zuerst (neue Version), sonst zwischengespeicherte Seite
// - /assets/* (Dateinamen mit Hash, unveränderlich): Cache zuerst
// - übrige Dateien: Cache sofort liefern, im Hintergrund aktualisieren
const CACHE = 'mathviz-__BUILD__'; // wird beim Build durch einen Inhalts-Hash ersetzt (vite.config.ts)
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function put(req, res) {
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => put(new Request('./'), res))
        .catch(async () => (await caches.match('./')) ?? Response.error()),
    );
  } else if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => put(req, res))));
  } else {
    e.respondWith(
      caches.match(req).then((hit) => {
        const update = fetch(req).then((res) => put(req, res)).catch(() => hit ?? Response.error());
        return hit ?? update;
      }),
    );
  }
});
