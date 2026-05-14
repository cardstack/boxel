// Service worker that injects Authorization headers for realm server requests.
//
// <img> elements and CSS background-image: url(...) cannot send Authorization
// headers. This service worker intercepts those requests and adds the JWT
// Bearer token so that authenticated realm images load correctly.
//
// Tokens are synced from the main thread via postMessage. If a request hits
// a known realm host but no token has been synced yet (SW activation race,
// localStorage write happening just before the SW message round-trip lands,
// etc.), the SW asks the controlling page for a token via MessageChannel and
// retries once before falling through.

// Map of realm URL prefix → JWT token
const realmTokens = new Map();
// Set of origins (e.g. "https://app.boxel.ai") that we have ever seen a
// realm token for. Used to scope the on-miss MessageChannel fallback so we
// don't message the page on every cross-origin font / analytics request.
const realmHosts = new Set();
// In-flight token requests, keyed by request URL, single-flight so a burst
// of <img> tags doesn't trigger a burst of postMessages.
const inflightTokenRequests = new Map();

const TOKEN_REQUEST_TIMEOUT_MS = 200;

function recordRealmHost(realmURL) {
  try {
    realmHosts.add(new URL(realmURL).origin);
  } catch {
    // ignore malformed input
  }
}

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
        recordRealmHost(data.realmURL);
      }
      break;
    case 'remove-realm-token':
      if (data.realmURL) {
        realmTokens.delete(data.realmURL);
      }
      break;
    case 'clear-tokens':
      realmTokens.clear();
      // Keep realmHosts: clearing tokens (e.g. logout) doesn't change which
      // hosts are "realm hosts," and keeping the set means the on-miss
      // fallback still asks the page after re-login.
      break;
    case 'sync-tokens':
      // Bulk sync: data.tokens is a {realmURL: token} object
      realmTokens.clear();
      if (data.tokens) {
        for (let [realmURL, token] of Object.entries(data.tokens)) {
          if (token) {
            realmTokens.set(realmURL, token);
            recordRealmHost(realmURL);
          }
        }
      }
      break;
  }
});

function lookupToken(url) {
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
  return matchedToken;
}

async function pickClientToAsk(initiatingClientId) {
  // Prefer the client that initiated the fetch. With skipWaiting() +
  // clients.claim() multiple tabs can be controlled by this SW where
  // some still run an older bundle without the request-realm-token
  // listener; if we always ask the "first" window we can hang waiting
  // for a client that cannot answer.
  if (initiatingClientId) {
    try {
      let initiating = await self.clients.get(initiatingClientId);
      if (initiating && initiating.type === 'window') {
        return initiating;
      }
    } catch {
      // ignore and fall through to broadcast
    }
  }
  let clientList = await self.clients.matchAll({ type: 'window' });
  return clientList[0];
}

async function requestTokenFromClient(requestURL, initiatingClientId) {
  // Single-flight per request URL
  let existing = inflightTokenRequests.get(requestURL);
  if (existing) {
    return existing;
  }
  let promise = (async () => {
    let client = await pickClientToAsk(initiatingClientId);
    if (!client) {
      return undefined;
    }
    return new Promise((resolve) => {
      let channel = new MessageChannel();
      let settled = false;
      let timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(undefined);
      }, TOKEN_REQUEST_TIMEOUT_MS);
      channel.port1.onmessage = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        let reply = event.data;
        if (reply && reply.realmURL && reply.token) {
          realmTokens.set(reply.realmURL, reply.token);
          recordRealmHost(reply.realmURL);
          resolve(reply.token);
        } else {
          resolve(undefined);
        }
      };
      client.postMessage({ type: 'request-realm-token', requestURL }, [
        channel.port2,
      ]);
    });
  })();
  inflightTokenRequests.set(requestURL, promise);
  promise.finally(() => {
    inflightTokenRequests.delete(requestURL);
  });
  return promise;
}

function buildAuthedRequest(request, token) {
  // Cross-origin <img> and CSS background-image requests arrive with
  // mode: 'no-cors', which silently strips non-safelisted headers like
  // Authorization. We must upgrade to mode: 'cors' so the header is
  // actually sent. The realm server supports CORS with
  // Access-Control-Allow-Origin: * and Authorization in allowed headers.
  //
  // credentials must be explicitly set to 'same-origin' because cross-origin
  // <img> requests default to 'include', and credentials: 'include' with
  // mode: 'cors' requires the server to send a specific origin in
  // Access-Control-Allow-Origin (not '*'), which the realm server doesn't do.
  let headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return new Request(request, {
    headers,
    mode: 'cors',
    credentials: 'same-origin',
  });
}

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
  let matchedToken = lookupToken(url);

  if (matchedToken) {
    event.respondWith(fetch(buildAuthedRequest(request, matchedToken)));
    return;
  }

  // No token in the map. Attempt the on-miss client fallback when either
  // (a) the SW has not yet learned any realm hosts (cold-start: SW just
  // activated and the page hasn't synced yet — exactly when we want the
  // fallback to recover from a stale empty cache), or (b) the request
  // origin matches a host we have ever held a token for. Skip the
  // fallback for clearly-unrelated cross-origin assets once realmHosts
  // is populated.
  let requestOrigin;
  try {
    requestOrigin = new URL(url).origin;
  } catch {
    return;
  }
  if (realmHosts.size > 0 && !realmHosts.has(requestOrigin)) {
    return;
  }

  event.respondWith(
    (async () => {
      let token = await requestTokenFromClient(url, event.clientId);
      if (token) {
        return fetch(buildAuthedRequest(request, token));
      }
      // No token available; preserve existing behavior (let it pass through
      // and 401, rather than synthesizing a response).
      return fetch(request);
    })(),
  );
});
