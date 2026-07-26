/*
 * Service worker CORPUS : cache d'abord, réseau en arrière-plan.
 *
 * L'application est entièrement locale — le réseau ne sert qu'à charger ses
 * propres fichiers. Après une première visite, elle s'ouvre donc hors ligne,
 * et une nouvelle version se prend au rechargement suivant. Enregistré en
 * production uniquement (cf. main.tsx) : en développement, Vite sert à chaud.
 */

const CACHE = 'corpus-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    (async () => {
      // Purge des caches d'anciennes versions du worker.
      for (const nom of await caches.keys()) {
        if (nom !== CACHE) await caches.delete(nom)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request
  const url = new URL(requete.url)
  if (requete.method !== 'GET' || url.origin !== location.origin) return

  evenement.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const enCache = await cache.match(requete)
      const reseau = fetch(requete)
        .then((reponse) => {
          if (reponse.ok) cache.put(requete, reponse.clone())
          return reponse
        })
        .catch(() => undefined)
      return enCache ?? (await reseau) ?? new Response('Hors ligne.', { status: 503 })
    })(),
  )
})
