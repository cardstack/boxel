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
//
// The SW also absorbs 503 + Retry-After answers from the realm's
// `_screenshot/` route, re-fetching at the server's suggested pace within a
// bounded budget so an in-app <img> waits out an in-flight capture instead
// of showing a broken image. See the SCREENSHOT_* constants below.

// Map of realm URL prefix → JWT token
const realmTokens = new Map();
// Set of origins (e.g. "https://app.boxel.ai") that we have ever seen a
// realm token for. Used to scope the on-miss MessageChannel fallback so we
// don't message the page on every cross-origin font / analytics request.
const realmHosts = new Set();
// In-flight token requests, keyed by request URL, single-flight so a burst
// of <img> tags doesn't trigger a burst of postMessages.
const inflightTokenRequests = new Map();

// Common-case budget. Refresh path posts `{type:'pending'}` to extend.
const TOKEN_REQUEST_TIMEOUT_MS = 200;
const TOKEN_REQUEST_REFRESH_TIMEOUT_MS = 3000;

// The realm's `_screenshot/` route answers 503 + Retry-After when a capture
// can't complete within its bounded sync wait (capture still rendering, or
// the on-demand lane is congested). <img> has no retry logic, so without
// help a broken image sticks until a manual reload. For requests on that
// route — and only that route — the SW absorbs the 503 and re-fetches at
// the server's suggested pace, so the fetch event resolves late instead of
// failing and the image pops in when the capture lands.
//
// The match is deliberately tight (GET + a `_screenshot/` path segment on a
// request already scoped to a realm — a realm-token prefix match on the token
// branches, a known realm origin on the tokenless branch — + status exactly
// 503 + a numeric Retry-After): a blanket SW 503-retry would mask real
// outages and hammer a struggling realm-server.
// Uncaptured-`name=` 404s are never retried — a typo'd name in a fitted
// template across a large grid would otherwise become that many synchronized
// retry loops; the 404's short max-age already covers the brief uncaptured
// window.
const SCREENSHOT_PATH_SEGMENT = '/_screenshot/';
// Bounds when re-fetches may start: retry sleeps are clamped to this window,
// and a 503 arriving after it closes is let through so the <img> errors
// visibly rather than hiding a permanently failing capture. The final
// re-fetch can itself hold up to the server's sync wait, so worst-case wall
// time is this budget plus one sync wait.
const SCREENSHOT_RETRY_BUDGET_MS = 90000;

// A request is on the screenshot route when it is a GET with a
// `_screenshot/` path segment. Origin/realm scoping is the call sites' job
// (see the engagement-gate comment above); position within the realm is
// not checked — the realm serves the subtree only at its root, so a nested
// segment on a plain file engages the loop harmlessly (plain files never
// answer 503 + Retry-After). Only GET absorbs: the route itself is
// GET-only, and HEAD/other methods keep the plain single-fetch behavior.
function isScreenshotRoute(request) {
  if (request.method !== 'GET') {
    return false;
  }
  try {
    return new URL(request.url).pathname.includes(SCREENSHOT_PATH_SEGMENT);
  } catch {
    return false;
  }
}

// Returns the retry delay in ms for a response the SW should absorb, or
// undefined for any response that must be returned to the page as-is.
// Retry-After is the contract: a 503 without one (or with an unparseable
// value, e.g. an HTTP-date) is a real error, not a capture-pending signal.
function screenshotRetryDelayMs(response) {
  if (response.status !== 503) {
    return undefined;
  }
  let retryAfter = response.headers.get('Retry-After');
  if (retryAfter === null) {
    return undefined;
  }
  let seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return Math.max(1000, seconds * 1000);
}

// Fetch loop for `_screenshot/` requests. buildRequest is invoked per
// attempt so each retry picks up the freshest token from the realmTokens
// map. A server-suggested pause longer than the remaining budget is clamped
// to it rather than abandoned: the congested lane's Retry-After is
// `pending × avgCaptureMs` with a coarse stand-in average when there is no
// history, so the estimate can far overshoot the real wait — one retry at
// the deadline is worth more than an immediate visible error. A 503
// arriving once the window is closed is returned as-is.
async function fetchScreenshotAbsorbing503s(buildRequest) {
  let deadline = Date.now() + SCREENSHOT_RETRY_BUDGET_MS;
  for (;;) {
    let response = await fetch(buildRequest());
    let delayMs = screenshotRetryDelayMs(response);
    if (delayMs === undefined) {
      return response;
    }
    let remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return response;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(delayMs, remainingMs)),
    );
  }
}

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
        let reply = event.data;
        if (reply && reply.type === 'pending') {
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(undefined);
          }, TOKEN_REQUEST_REFRESH_TIMEOUT_MS);
          return;
        }
        settled = true;
        clearTimeout(timer);
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

function buildRealmRequest(request, token) {
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
  //
  // The cors upgrade also matters without a token: a no-cors response is
  // opaque (status reads as 0), so the screenshot 503-absorption path
  // rebuilds tokenless requests to public realms as cors too, to be able to
  // read the status and Retry-After.
  let headers = new Headers(request.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
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
    if (isScreenshotRoute(request)) {
      // Each attempt re-reads the token map: rotation is picked up, and a
      // removal (logout clears the map) makes the next attempt tokenless —
      // a private realm then answers 401, which is not absorbable, so the
      // loop ends instead of presenting the pre-logout JWT for the rest of
      // the budget.
      event.respondWith(
        fetchScreenshotAbsorbing503s(() =>
          buildRealmRequest(request, lookupToken(url)),
        ),
      );
    } else {
      event.respondWith(fetch(buildRealmRequest(request, matchedToken)));
    }
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
        if (isScreenshotRoute(request)) {
          // Unlike the matched-token branch, `?? token` is load-bearing
          // here: the client's reply lands in the map keyed by its own
          // realmURL, which may not prefix this request's URL, so the map
          // lookup can miss forever while the token stays valid.
          return fetchScreenshotAbsorbing503s(() =>
            buildRealmRequest(request, lookupToken(url) ?? token),
          );
        }
        return fetch(buildRealmRequest(request, token));
      }
      // Tokenless screenshot requests to a known realm origin (a public
      // realm the page holds no session for) still get 503 absorption. The
      // request is rebuilt as cors so the status is readable cross-origin.
      if (isScreenshotRoute(request) && realmHosts.has(requestOrigin)) {
        return fetchScreenshotAbsorbing503s(() =>
          buildRealmRequest(request, lookupToken(url)),
        );
      }
      // No token available; preserve existing behavior (let it pass through
      // and 401, rather than synthesizing a response).
      return fetch(request);
    })(),
  );
});
