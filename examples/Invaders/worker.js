const db_name = 'myDatabase';
const store_name = 'dataStore';

const db_open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(db_name, 1);
    request.onupgradeneeded = (event) => { event.target.result.createObjectStore(store_name); };
    request.onsuccess       = (event) => { resolve(event.target.result); };
    request.onerror         = (event) => { reject(event.target.error);   };
});

// Function to store data in IndexedDB
const db_put = async (url, response) => {
    const db    = await db_open();
    const txn   = db.transaction(store_name, 'readwrite');
    const store = txn.objectStore(store_name);
    store.put(response, url);
}

// Function to get data from IndexedDB
const db_get = async (url) => {
    const db    = await db_open();
    const txn   = db.transaction(store_name, 'readonly');
    const store = txn.objectStore(store_name);
    return new Promise((resolve, reject) => {
        const request = store.get(url);
        request.onsuccess = (event) => { resolve(event.target.result); };
        request.onerror   = (event) => { reject(event.target.error); };
    });
}

// Intercept fetch requests

self.addEventListener('install', (event) => {
    console.log("install");
});

self.addEventListener('activate', (event) => {
    console.log("activate");
});

self.addEventListener('fetch', (event) => {
    const url   = new URL(event.request.url);
    const scope = new URL(self.registration.scope).pathname + "data/";
    if (url.pathname.startsWith(scope)) {
        console.log("got data request", url.pathname, scope);
        event.respondWith((async () => {
            const cached = await db_get(event.request.url);
            if (cached) {
                console.log(`response already cached ${event.request.url}`);
                return new Response(cached);
            }
            
            const resp  = await fetch(event.request);
            const clone = await resp.clone();
            const data  = await clone.arrayBuffer();
            await db_put(event.request.url, data);
            
            console.log(`cached response ${event.request.url}`);
            return resp;
        })());
    }
});
