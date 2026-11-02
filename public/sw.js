// Minimal service worker so the browser offers "Install app". It never caches: the book lives on disk, not here.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
