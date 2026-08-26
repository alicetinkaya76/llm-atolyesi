/* LLM Atölyesi — service worker.
   Üç rota, üç ayrı gerekçe:
     · NAVİGASYON (html): network-first. Kabuk HTML'i cache-first vermek
       "sonsuza kadar eski sürümü gören PWA" tuzağının ta kendisidir: yeni
       dağıtımın HTML'i hiç ulaşmaz, dolayısıyla yeni JS/CSS de istenmez.
       Çevrimdışıyken önbellekteki kabuğa düşer.
     · VERİ (durum.json, mufredat.json): network-first + cache:'no-store'.
       İki ayrı önbellek var — bizimki (Cache Storage) ve HTTP önbelleği.
       GitHub Pages max-age=600 gönderiyor ve değiştirilemiyor; no-store
       olmadan mükemmel bir network-first bile 10 dakika bayat veri döner.
     · GERİSİ (css/js/ikon): cache-first, arkada tazelenir.
   SURUM her dağıtımda elle artırılır: sw.js baytları değişmezse tarayıcı
   yeni worker'ı hiç kurmaz ve eski önbellek sonsuza kadar yaşar. */
const SURUM = 'atolye-20260827-0126';
const KABUK = SURUM + '-kabuk';
const VERI = SURUM + '-veri';

/* Yollar sw.js'in kendi konumuna göre çözülür; sw.js depo kökünde olduğu için
   kapsam otomatik olarak /llm-atolyesi/ (ve yerelde /) olur. */
const ON_YUKLE = [
  './', './index.html', './defter.html', './harita.html',
  './stil.css', './atolye.js', './pano.js', './defter.js', './github.js',
  './mufredat.json', './ikon-192.png', './ikon-512.png',
  './apple-touch-icon.png', './manifest.json',
  './fazlar/zemin.html', './fazlar/faz0.html', './fazlar/faz1.html',
  './fazlar/faz2.html', './fazlar/faz3.html', './fazlar/faz4.html',
  './fazlar/faz5.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(KABUK).then((c) => Promise.all(
      /* cache:'reload' olmadan yepyeni önbelleği 10 dakikalık HTTP
         önbelleğinden tohumlama riski var. Tek bir 404 kurulumu düşürmesin. */
      ON_YUKLE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((adlar) => Promise.all(
        adlar.filter((a) => a !== KABUK && a !== VERI).map((a) => caches.delete(a))
      ))
      .then(() => self.clients.claim())
  );
});

const VERI_MI = (url) => /\/(durum|mufredat)\.json$/.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const istek = e.request;
  if (istek.method !== 'GET') return;

  const url = new URL(istek.url);
  /* başka kaynaklara (fonts.googleapis.com, api.github.com) hiç karışma */
  if (url.origin !== self.location.origin) return;

  /* 1) navigasyon: network-first */
  if (istek.mode === 'navigate') {
    e.respondWith(
      fetch(istek)
        .then((yanit) => {
          if (yanit && yanit.ok) {
            const kopya = yanit.clone();
            caches.open(KABUK).then((c) => c.put(istek, kopya)).catch(() => {});
          }
          return yanit;
        })
        .catch(() => caches.match(istek)
          .then((k) => k || caches.match('./index.html'))
          .then((k) => k || new Response(
            '<!doctype html><meta charset="utf-8"><p>Çevrimdışısın ve bu sayfa önbellekte yok.',
            { headers: { 'content-type': 'text/html; charset=utf-8' } })))
    );
    return;
  }

  /* 2) veri: network-first, HTTP önbelleği atlanarak */
  if (VERI_MI(url)) {
    e.respondWith(
      fetch(istek, { cache: 'no-store' })
        .then((yanit) => {
          if (yanit && yanit.ok) {
            const kopya = yanit.clone();
            caches.open(VERI).then((c) => c.put(istek, kopya)).catch(() => {});
          }
          return yanit;
        })
        .catch(() => caches.match(istek).then((k) => k || Response.error()))
    );
    return;
  }

  /* 3) varlıklar: cache-first, arkada tazele */
  e.respondWith(
    caches.match(istek).then((onbellek) => {
      const agdan = fetch(istek)
        .then((yanit) => {
          if (yanit && yanit.ok) {
            const kopya = yanit.clone();
            caches.open(KABUK).then((c) => c.put(istek, kopya)).catch(() => {});
          }
          return yanit;
        })
        .catch(() => onbellek);
      return onbellek || agdan;
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'guncelle') self.skipWaiting();
});
