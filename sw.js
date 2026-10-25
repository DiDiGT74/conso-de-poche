// Conso de poche : garde l'écran de l'appli disponible hors connexion. Les chiffres (script Google) ne sont jamais mis en cache.
const CACHE = "conso-v11";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  // Ne touche qu'aux caches de cette appli (Crypto de poche partage le même domaine).
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.indexOf("conso-") === 0 && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.indexOf("/conso-de-poche/") < 0) return; // script Google : toujours en direct
  e.respondWith(
    fetch(e.request, {cache: "no-cache"}).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./")))
  );
});

// ---------- Alerte : le script envoie un « réveil » sans contenu, l'appli va lire le message ----------
function idbGet(k){
  return new Promise(res => {
    const r = indexedDB.open("cp-owner", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onerror = () => res(null);
    r.onsuccess = () => { try{ const g = r.result.transaction("kv").objectStore("kv").get(k); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); }catch(_){ res(null); } };
  });
}
async function showLatest(){
  let title = "Conso de poche", body = "Nouvelle alerte sur les relevés";
  try{
    const key = await idbGet("apiKey"), api = await idbGet("api");
    if (key && api){
      const r = await fetch(api + "?" + new URLSearchParams({k: key, a: "alerte"}), {cache: "no-store"});
      const j = await r.json();
      if (j.ok && j.data){ title = j.data.title || title; body = j.data.body || body; }
    }
  }catch(_){}
  return self.registration.showNotification(title, {body, tag: "conso-alerte", icon: "icon-192.png", badge: "icon-192.png", data: {url: "./"}});
}
self.addEventListener("push", e => e.waitUntil(showLatest()));
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(cs => {
    for (const c of cs){ if (c.url.indexOf("/conso-de-poche/") >= 0 && "focus" in c) return c.focus(); }
    return self.clients.openWindow("./");
  }));
});
