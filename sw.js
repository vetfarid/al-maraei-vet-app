// Service Worker — عيادة المراعي البيطرية
// الاستراتيجية: الملفات المحلية (HTML/JS) Network-first مع تجاوز كاش HTTP حتى لا يبقى التطبيق على نسخة قديمة،
// والرجوع للكاش عند انقطاع الإنترنت. مكتبات Firebase (روابط ثابتة بنسخة) تُخزَّن وقت التشغيل.
// لا يتم تخزين أي بيانات عملاء/مرضى هنا (Firestore لا يمر عبر هذا الملف أصلًا).
const VERSION = 'maraei-v9-2026-10-27';
const CORE = ['./', 'index.html', 'customer.html', 'app-cloud.js', 'firebase-config.js', 'lib/sync-core.js', 'lib/backup.js', 'manifest.json', 'manifest-customer.json'];
const OPTIONAL = ['icon-192.png', 'icon-512.png', 'admin-192.png', 'admin-512.png'];
const LIBS = 'maraei-libs-1';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // ملف مفقود لا يفشل التثبيت كله
    await Promise.allSettled([...CORE, ...OPTIONAL].map(u => c.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== LIBS) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

async function networkFirst(req) {
  const c = await caches.open(VERSION);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = new URL(req.url).pathname.endsWith('customer.html') ? 'customer.html' : 'index.html';
      const fb = await c.match(page); if (fb) return fb;
    }
    return new Response('لا يوجد اتصال بالإنترنت', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
async function cacheFirst(req, name) {
  const c = await caches.open(name), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req); if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res;
}
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (/\.(png|jpg|jpeg|webp|svg|ico)$/i.test(u.pathname)) e.respondWith(cacheFirst(r, VERSION).catch(() => networkFirst(r)));
    else e.respondWith(networkFirst(r));
  } else if (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/')) {
    e.respondWith(cacheFirst(r, LIBS).catch(() => new Response('', { status: 504 })));
  }
  // أي نطاق آخر (Firestore / Auth / ntfy): لا نتدخل إطلاقًا
});
