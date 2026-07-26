/* =====================================================================
   Service worker de Reclamaciones - shell offline + manejo de versiones.

   COMO SE PUBLICA UNA NUEVA VERSION
   ---------------------------------
   Sube el numero de VERSION de aqui abajo. Con eso:
     - cambia el nombre del cache -> el shell viejo se descarta,
     - el navegador detecta un SW nuevo,
     - la app muestra el aviso "Nueva version disponible · Actualizar".
   No se recarga solo: el usuario decide, para no perder un formulario
   a medio llenar.
   ===================================================================== */

const VERSION = "1.1.0";
const CACHE = `reclamaciones-v${VERSION}`;

// Shell de la app (mismo origen). Se precachea entero: si algo falla,
// la instalacion falla y no queda un cache a medias.
const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/app.js",
  "./js/pwa.js",
  "./manifest.webmanifest",
  "./fonts/inter-var-latin.woff2",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// El supabase-js del CDN se guarda aparte y como "mejor esfuerzo": si el
// CDN no responde durante la instalacion, no tumbamos el SW por eso.
const CDN_SUPABASE = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

self.addEventListener("install", (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache:"reload" salta la cache HTTP del navegador, asi que al subir la
    // VERSION siempre se precachean los archivos frescos, no copias viejas.
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })));
    try {
      const r = await fetch(CDN_SUPABASE, { mode: "no-cors" });
      await cache.put(CDN_SUPABASE, r);
    } catch (_) { /* sin CDN cacheado; la app igual funciona con red */ }
    // No se llama skipWaiting aqui: el SW nuevo espera a que el usuario
    // acepte el aviso de actualizacion (mensaje SKIP_WAITING).
  })());
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil((async () => {
    // Borra los caches de versiones anteriores.
    const nombres = await caches.keys();
    await Promise.all(
      nombres
        .filter((n) => n.startsWith("reclamaciones-v") && n !== CACHE)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// Supabase (datos con sesion) jamas se cachea. Se reconoce por el host.
function esSupabase(url) {
  return url.hostname.endsWith(".supabase.co");
}

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;                 // solo GET

  const url = new URL(req.url);

  if (esSupabase(url)) return;                       // red directa, sin tocar

  // El script del CDN: primero cache, y se refresca por detras.
  if (url.href === CDN_SUPABASE) {
    evento.respondWith(cacheOPrimeroRed(req));
    return;
  }

  // Shell propio (mismo origen): stale-while-revalidate.
  if (url.origin === self.location.origin) {
    evento.respondWith(staleWhileRevalidate(req));
  }
});

// Devuelve lo cacheado al instante y actualiza el cache por detras.
// Si no hay nada cacheado, espera a la red. Sin red y sin cache, y era
// una navegacion, cae al index (shell) para no mostrar el dino.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cacheada = await cache.match(req);

  const red = fetch(req)
    .then((resp) => {
      if (resp && resp.ok && resp.type === "basic") cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => null);

  if (cacheada) return cacheada;

  const resp = await red;
  if (resp) return resp;

  if (req.mode === "navigate") {
    const index = await cache.match("./index.html");
    if (index) return index;
  }
  return new Response("Sin conexión.", {
    status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function cacheOPrimeroRed(req) {
  const cache = await caches.open(CACHE);
  const cacheada = await cache.match(req);
  if (cacheada) {
    fetch(req).then((r) => cache.put(req, r)).catch(() => {});
    return cacheada;
  }
  try {
    const r = await fetch(req, { mode: "no-cors" });
    cache.put(req, r.clone());
    return r;
  } catch (_) {
    return new Response("", { status: 503 });
  }
}

// Puente con la pagina: aplicar la actualizacion y consultar la version.
self.addEventListener("message", (evento) => {
  const datos = evento.data || {};
  if (datos.tipo === "SKIP_WAITING") self.skipWaiting();
  if (datos.tipo === "GET_VERSION") {
    evento.source && evento.source.postMessage({ tipo: "VERSION", version: VERSION });
  }
});
