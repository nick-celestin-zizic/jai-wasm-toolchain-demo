const CACHE_NAME = "Cache - Input - ";
const CACHE_TIME = "2025-05-17T00:29:23.012Z";
const PATHS_TO_CACHE = [ "", "index.html", "icon.png" , "main.wasm", "manifest.json", "runtime.js", ];

const maybe_refresh_caches = async () => {
    const keys = await caches.keys();
    let found  = false;
    for (const cache_name of keys) {
        if (!cache_name.startsWith(CACHE_NAME)) continue;
        if (!cache_name.endsWith(CACHE_TIME)) {
            // console.log(CACHE_NAME, "deleting outdated cache ", cache_name);
            await caches.delete(cache_name);
        } else {
            // console.log(CACHE_NAME, "found valid cache ", cache_name);
            found = true;
        }
    }
    
    if (!found) {
        // console.log(CACHE_NAME+CACHE_TIME, "creating cache for the first time");
        const cache   = await caches.open(CACHE_NAME + CACHE_TIME);
        const clients = await self.clients.matchAll({includeUncontrolled: true, type: "window"});
        if (clients.length < 1) throw new Error(`TODO ${clients.length}`);
        
        // the spec states that the first element of this array should
        // be the window that started the worker
        const client  = clients[0];
        await cache.addAll(PATHS_TO_CACHE.map((name) => client.url + name));
    }
};

self.addEventListener("fetch", (event) => {
    event.respondWith((async () => (await caches.match(event.request.url)) || fetch(event.request))());
});
self.addEventListener("install", (event) => { event.waitUntil(maybe_refresh_caches()); });
self.addEventListener("activate", (event) => { event.waitUntil(maybe_refresh_caches()); });
