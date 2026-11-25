// CinéA2 : garde l'appli sur le téléphone pour l'ouvrir tout de suite, même sans réseau.
// - l'appli (page, réglages Firebase, icônes) : servie depuis la mémoire, puis mise à jour en arrière-plan ;
// - les polices et les morceaux de Firebase : gardés une fois téléchargés ;
// - les affiches TMDB : gardées (les 400 plus récentes) pour s'afficher hors ligne ;
// - tout le reste (recherche TMDB, données Firebase) passe par le réseau, Firebase gérant lui-même le hors ligne.
const SHELL = "cinea2-shell-v1";
const RUNTIME = "cinea2-runtime-v1";
const IMAGES = "cinea2-images-v1";
const PAGE = "./index.html";
const PRECACHE = [PAGE, "./firebase-config.js", "./manifest.webmanifest", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("cinea2-") && ![SHELL, RUNTIME, IMAGES].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(shell(req, e)); return; }
  if (url.hostname === "image.tmdb.org") { e.respondWith(cacheFirst(req, IMAGES, 400)); return; }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" ||
      (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"))) {
    e.respondWith(cacheFirst(req, RUNTIME));
  }
});

// Répond tout de suite avec la version gardée, et va chercher la nouvelle version en parallèle.
// Si la page a changé, prévient l'appli qu'une mise à jour est prête.
async function shell(req, e) {
  const cache = await caches.open(SHELL);
  const isPage = req.mode === "navigate" || new URL(req.url).pathname.endsWith("/index.html");
  const key = isPage ? PAGE : req;
  const cached = await cache.match(key, { ignoreSearch: true });
  // lu avant d'être envoyé à l'écran (une réponse ne peut être lue qu'une fois)
  const oldText = isPage && cached ? cached.clone().text() : Promise.resolve(null);
  const net = fetch(isPage ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : req)
    .then(async res => {
      if (res.ok && res.type === "basic") {
        if (isPage) {
          const fresh = await res.clone().text();
          const old = await oldText;
          await cache.put(key, res.clone());
          // la page qui s'ouvre doit être prête à recevoir le message
          if (old !== null && old !== fresh) { await new Promise(r => setTimeout(r, 1500)); await notify(); }
        } else {
          await cache.put(key, res.clone());
        }
      }
      return res;
    })
    .catch(() => null);
  if (cached) { e.waitUntil(net); return cached; }
  return (await net) || new Response("CinéA2 est hors ligne. Ouvrez l'appli une première fois avec du réseau.", {
    status: 503, headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") {
      await cache.put(req, res.clone());
      if (max) trim(cache, max);
    }
    return res;
  } catch {
    return Response.error();
  }
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function notify() {
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach(c => c.postMessage({ type: "cinea2-update" }));
}
