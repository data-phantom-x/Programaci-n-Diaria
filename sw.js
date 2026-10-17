// ─── SERVICE WORKER — Programación Diaria ────────────────────────────────────
// La app es un solo archivo (index.html) que se actualiza muy seguido, así que
// la regla es: NUNCA servir una versión vieja de la app. Solo se cachean recursos
// que no cambian (iconos, manifiesto) y se cachea "por respaldo" el HTML.
//
// Al publicar una versión nueva hay que subir el número de VERSION: eso borra
// los cachés viejos y fuerza a los clientes a tomar los recursos nuevos.

const VERSION = 'pd-v3';
const CACHE_APP = `${VERSION}-app`;
const CACHE_VENDOR = `${VERSION}-vendor`;

// Recursos propios del proyecto. Se cachean primero y se revalidan por detrás.
const PRECACHE = [
  './',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/share-ios.png',
];

// Todo lo que toca Firebase/Google NO se cachea ni se intercepta: son peticiones
// de datos en vivo y una respuesta cacheada sería un turno falso.
const NUNCA_CACHEAR = [
  'firebaseio.com',
  'firebasedatabase.app',
  'firebaseapp.com',
  'web.app',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'googleapis.com',
  'oauth2.googleapis.com',
  'www.googleapis.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_APP)
      // addAll es atómico: si un ícono falla, no se cachea ninguno. Se prefiere
      // cachear uno por uno para que un ícono faltante no tumbe la instalación.
      .then((cache) => Promise.all(
        PRECACHE.map((url) => cache.add(url).catch((err) => {
          console.warn('[sw] no se pudo cachear', url, err);
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_APP && k !== CACHE_VENDOR).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Permite forzar la actualización desde la app: postMessage({tipo:'actualizar'})
self.addEventListener('message', (event) => {
  if (event.data && event.data.tipo === 'actualizar') self.skipWaiting();
});

function esDeFirebase(url) {
  return NUNCA_CACHEAR.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
}

// El HTML (index.html) SIEMPRE desde la red. Si no hay red, se sirve el último
// guardado, que es preferible a una pantalla en blanco.
//
// `revalidar`_addressa la segunda capa de caché, la del navegador. GitHub Pages
// manda 'cache-control: max-age=600', así que un icono recién subido puede seguir
// saliendo el viejo hasta 10 minutos solo porque el navegador no pregunta. Con
// {cache:'no-cache'} se le pregunta siempre: si el archivo no cambió el servidor
// responde 304 y no se descarga nada, y si cambió llega el nuevo. Gracias a esto
// los iconos ya no dependen de que se suba el número de VERSION a mano.
async function redPrimero(request, revalidar) {
    const cache = await caches.open(CACHE_APP);
    try {
        const respuesta = await fetch(request, revalidar ? { cache: 'no-cache' } : undefined);
        if (respuesta && respuesta.ok) cache.put(request, respuesta.clone());
        return respuesta;
    } catch (err) {
        const guardada = await cache.match(request)
            || (request.mode === 'navigate' ? await cache.match('./index.html') : null);
        if (guardada) return guardada;
        throw err;
    }
}

// CDNs de terceros (SDK de Firebase, SheetJS, fuentes, logos de LATAM): sus URLs
// llevan versión, así que un archivo con el mismo nombre NUNCA cambia de
// contenido. Servicios de caché de golpe, y si se revalida en segundo plano mejor.
async function cachePrimeroRevalidando(request, nombreCache) {
    const cache = await caches.open(nombreCache);
    const guardada = await cache.match(request);
    const desdeRed = fetch(request, { cache: 'no-cache' }).then((respuesta) => {
        if (respuesta && respuesta.ok) cache.put(request, respuesta.clone());
        return respuesta;
    }).catch(() => null);
    return guardada || desdeRed;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (esDeFirebase(url)) return;

  // Navegación = abrir la app.
  if (request.mode === 'navigate') {
    event.respondWith(redPrimero(request, true));
    return;
  }

  // Manifiesto e íconos propios: van por la red, pero se le pide al servidor que
  // confirme (no-cache) para que un icono nuevo se vea en la PRIMERA visita y no
  //dependa de subir el VERSION. Son unos 34 KB, nada comparado con los 621 KB del
  // HTML que ya se descargan siempre.
  const esPropio = url.origin === self.location.origin
    && (url.pathname.endsWith('/manifest.json') || url.pathname.includes('/icons/'));
  if (esPropio) {
    event.respondWith(redPrimero(request, true));
    return;
  }

  // CDN de terceros (SDK de Firebase, SheetJS, fuentes, logos): sirven de
  // respaldo y se refrescan solos en segundo plano.
  if (url.origin !== self.location.origin) {
    event.respondWith(cachePrimeroRevalidando(request, CACHE_VENDOR));
  }
});