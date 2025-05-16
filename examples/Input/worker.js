const CACHE_NAME = "Cache - Input";
const PATHS_TO_CACHE = [ "", "index.html", "icon.png" , "main.wasm", "manifest.json", "runtime.js", ];

self.addEventListener("fetch", (event) => {
    event.respondWith((async () => {
        const response = await caches.match(event.request.url);
        // console.log("GOT RESPONSE", response);
        
        if (response) {
        //     console.log("returning cached response");
            return response;
        } else {
        //     console.log("did not find cached response");
            return fetch(event.request);
        }
    })());
});

self.addEventListener("activate", (event) => {
    // console.log("ACTIVATE");
});

self.addEventListener("install", (event) => {
    // console.log("INSTALL");
    // const white_list = [CACHE_NAME];
    
    self.skipWaiting();
    event.waitUntil((async () => {
        // clean up old cache
        console.log("INSTALL");
        const cache_names = (await caches.keys()).filter((name) => name === CACHE_NAME);
        await Promise.all(cache_names.map((name) => { return caches.delete(name); }));
        
        // cache the files we need for offline use
        const cache = await caches.open(CACHE_NAME);
        const clients = await self.clients.matchAll({includeUncontrolled: true, type: "window"});
        if (clients.length < 1) throw new Error(`TODO ${clients.length}`);
        
        // the spec states that the first element of this array should
        // be the window that started the worker
        await cache.addAll(PATHS_TO_CACHE.map((name) => clients[0].url + name));
    })());
});
