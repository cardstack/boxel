// Service worker that injects Authorization headers for realm server requests.
//
// <img> elements and CSS background-image: url(...) cannot send Authorization
// headers. This service worker intercepts those requests and adds the JWT
// Bearer token so that authenticated realm images load correctly.
//
// Tokens are synced from the main thread via postMessage.

// Map of realm URL prefix → JWT token
const realmTokens = new Map();

self.addEventListener('install', () => {
  // Activate immediately, don't wait for existing clients to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of all open clients immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  let { data } = event;
  if (!data || !data.type) {
    return;
  }

  switch (data.type) {
    case 'set-realm-token':
      if (data.realmURL && data.token) {
        realmTokens.set(data.realmURL, data.token);
      }
      break;
    case 'remove-realm-token':
      if (data.realmURL) {
        realmTokens.delete(data.realmURL);
      }
      break;
    case 'clear-tokens':
      realmTokens.clear();
      break;
    case 'sync-tokens':
      // Bulk sync: data.tokens is a {realmURL: token} object
      realmTokens.clear();
      if (data.tokens) {
        for (let [realmURL, token] of Object.entries(data.tokens)) {
          if (token) {
            realmTokens.set(realmURL, token);
          }
        }
      }
      break;
  }
});

self.addEventListener('fetch', (event) => {
  let request = event.request;

  // Only inject auth for GET and HEAD requests (resource loading).
  // Other methods (POST, PUT, DELETE, etc.) are handled by the app's
  // fetch middleware which already adds Authorization headers.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return;
  }

  // Don't inject if request already has an Authorization header
  if (request.headers.get('Authorization')) {
    return;
  }

  let url = request.url;

  // Find the matching realm token with longest-prefix match
  let matchedRealmURL = null;
  let matchedToken = null;
  for (let [realmURL, token] of realmTokens) {
    if (url.startsWith(realmURL)) {
      if (!matchedRealmURL || realmURL.length > matchedRealmURL.length) {
        matchedRealmURL = realmURL;
        matchedToken = token;
      }
    }
  }

  if (!matchedToken) {
    // Not a realm URL or no token available — pass through unchanged
    return;
  }

  // Create a new request with the Authorization header injected.
  //
  // Cross-origin <img> and CSS background-image requests arrive with
  // mode: 'no-cors', which silently strips non-safelisted headers like
  // Authorization. We must upgrade to mode: 'cors' so the header is
  // actually sent. The realm server already supports CORS with
  // Access-Control-Allow-Origin: * and Authorization in allowed headers.
  let headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${matchedToken}`);

  let authedRequest = new Request(request, {
    headers,
    mode: 'cors',
  });

  event.respondWith(fetch(authedRequest));
});
