/* Service worker — installable, offline-capable study platform.
   Navigation/HTML is NETWORK-FIRST (updates appear immediately, never a stale
   shell); same-origin assets are CACHE-FIRST for offline use. On install we
   parse index.html and precache its JS/CSS so the app works offline after the
   first visit. Cross-origin requests are left untouched. */
var CACHE = "examsite-cisa-v1"; /* per-site name: all sites share one origin on GitHub Pages */
var SCOPE = "examsite-cisa-"; /* only prune THIS site's old caches */
var LEGACY = ["examsite-v1"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(["./", "index.html"]).then(function () {
        return fetch("index.html", { cache: "no-cache" }).then(function (r) { return r.text(); }).then(function (html) {
          var urls = [], re = /(?:src|href)="([^"]+\.(?:js|css)[^"]*)"/g, m;
          while ((m = re.exec(html))) { if (!/^https?:\/\//.test(m[1])) urls.push(m[1]); }
          return Promise.all(urls.map(function (u) { return cache.add(u).catch(function () {}); }));
        }).catch(function () {});
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return (k.indexOf(SCOPE) === 0 && k !== CACHE) || LEGACY.indexOf(k) !== -1; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request; if (req.method !== "GET") return;
  var url; try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  var isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") !== -1;
  if (isHTML) {
    e.respondWith(
      fetch(req).then(function (r) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); return r; })
        .catch(function () { return caches.match(req).then(function (m) { return m || caches.match("index.html"); }); })
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(function (m) {
      return m || fetch(req).then(function (r) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); return r; });
    })
  );
});
