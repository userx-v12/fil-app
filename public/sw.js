// Service worker minimal — requis pour PWA installable, pas de cache applicatif
// (le jeu est 100% online, on ne met rien en cache pour éviter les données périmées)

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  // Supprimer tous les anciens caches si jamais il y en a
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pas de fetch handler — on laisse passer toutes les requêtes normalement
