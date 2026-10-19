/* eslint-env browser */
// The secure window's own realm-server session: signed in here, kept in this
// origin's storage, and never posted to the app. Card code runs in the app
// page and can read the app's session; it can't read this one, because the
// same-origin policy keeps it on the secure origin, and minting a key write
// ticket requires it.
//
// The window signs in with a password, which the realm server checks with the
// Matrix server, or with Google, which sends its authorization code back to
// this origin alone (see the realm server's `lib/secure-session.ts`).

const STORAGE_KEY = 'boxel-secure-session';
// A Google sign-in in progress: what the window sent Google, kept for the
// callback to check what comes back against.
const GOOGLE_SIGN_IN_KEY = 'boxel-secure-google-sign-in';
const JSON_API = 'application/vnd.api+json';
// A session this close to its end is treated as already ended, so a request
// made with it doesn't fail partway through.
const EXPIRY_MARGIN_MS = 60 * 1000;
// How long the window waits to learn whether its session is still signed in
// before it carries on with the session it has.
const SESSION_CHECK_TIMEOUT_MS = 10 * 1000;

export class SecureSessionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function readConfig() {
  let meta = (name) =>
    document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ??
    '';
  return { realmServerURL: new URL(meta('boxel-realm-server-url')) };
}

async function request(url, { method = 'POST', body, token, signal } = {}) {
  let headers = { Accept: JSON_API };
  if (body !== undefined) {
    headers['Content-Type'] = JSON_API;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    });
  } catch {
    throw new SecureSessionError(0, 'network', 'Boxel could not be reached.');
  }
  let json = {};
  try {
    json = await response.json();
  } catch {
    // A response that isn't JSON is judged by its status alone.
  }
  if (!response.ok) {
    let error = json?.errors?.[0];
    throw new SecureSessionError(
      response.status,
      typeof error === 'object' ? error.code : undefined,
      (typeof error === 'object' ? error.detail : error) ||
        'Something went wrong. Try again.',
    );
  }
  return json;
}

// Signs in with a password. `client` is 'window' for this window's own
// session, 'cli' for a session handed to the CLI.
export async function signInWithPassword(
  config,
  { username, password, client },
) {
  let json = await request(new URL('_secure-session', config.realmServerURL), {
    body: {
      data: {
        type: 'secure-session',
        attributes: { username, password, client },
      },
    },
  });
  return json.data.attributes;
}

// Where to send the user to sign in with Google, or undefined when this realm
// server has no Google client.
export async function googleSignInConfig(config) {
  try {
    let json = await request(
      new URL('_secure-session/google', config.realmServerURL),
      { method: 'GET' },
    );
    return json.data.attributes;
  } catch {
    return undefined;
  }
}

function randomToken() {
  let bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Sends this window to Google. The state, nonce and PKCE verifier stay in this
// origin's session storage; `resume` is whatever the callback needs to carry
// on with (which client, and the CLI's listener).
export async function beginGoogleSignIn(google, resume) {
  let state = randomToken();
  let nonce = randomToken();
  let codeVerifier = randomToken();
  let challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(codeVerifier),
      ),
    ),
  );
  sessionStorage.setItem(
    GOOGLE_SIGN_IN_KEY,
    JSON.stringify({ state, nonce, codeVerifier, resume }),
  );
  let url = new URL(google.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', google.clientId);
  url.searchParams.set('redirect_uri', google.redirectURI);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(url.href);
}

// Finishes a Google sign-in on the callback page: checks that Google answered
// the sign-in this window started, and exchanges the code for a session.
// Returns the session and the `resume` the sign-in began with.
export async function finishGoogleSignIn(config) {
  let params = new URL(window.location.href).searchParams;
  let pending;
  try {
    pending = JSON.parse(sessionStorage.getItem(GOOGLE_SIGN_IN_KEY) ?? 'null');
  } catch {
    pending = null;
  }
  sessionStorage.removeItem(GOOGLE_SIGN_IN_KEY);
  // The code is spent below either way; it shouldn't linger in the address
  // bar or history.
  history.replaceState(null, '', window.location.pathname);
  if (!pending || params.get('state') !== pending.state) {
    throw new SecureSessionError(
      400,
      'unexpected-callback',
      'This sign-in wasn’t started here. Start again.',
    );
  }
  let code = params.get('code');
  if (!code) {
    throw new SecureSessionError(
      401,
      'google-cancelled',
      'Google sign-in didn’t finish. Start again.',
    );
  }
  let json = await request(
    new URL('_secure-session/google', config.realmServerURL),
    {
      body: {
        data: {
          type: 'google-sign-in',
          attributes: {
            code,
            codeVerifier: pending.codeVerifier,
            nonce: pending.nonce,
            client: pending.resume?.client ?? 'window',
          },
        },
      },
    },
  );
  return { session: json.data.attributes, resume: pending.resume };
}

// The window's session, while it lasts.
export function storedSession() {
  let session;
  try {
    session = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return undefined;
  }
  if (
    !session ||
    typeof session.token !== 'string' ||
    Date.parse(session.expiresAt) - EXPIRY_MARGIN_MS <= Date.now()
  ) {
    return undefined;
  }
  return session;
}

export function storeSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function forgetSession() {
  localStorage.removeItem(STORAGE_KEY);
}

// Signs the window's own session out: forgotten here even when the server
// can't be reached, and ended on the server.
export async function signOut(config) {
  let token = storedSession()?.token;
  forgetSession();
  if (!token) {
    return;
  }
  try {
    await request(new URL('_secure-session', config.realmServerURL), {
      method: 'DELETE',
      token,
    });
  } catch (e) {
    // An ended or expired session is already signed out.
    if (e.status !== 401) {
      throw e;
    }
  }
}

// The window's session, if the server still honours it. The server ends it
// when the user signs out here, signs out of the app, or the session expires;
// an ended session is forgotten, so the window shows its sign-in. When the
// server can't be reached or doesn't answer in time, the stored session is
// kept, since nothing says it has ended.
export async function liveSession(config) {
  let session = storedSession();
  if (!session) {
    return undefined;
  }
  try {
    await request(new URL('_secure-session', config.realmServerURL), {
      method: 'GET',
      token: session.token,
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
    });
  } catch (e) {
    if (e.status === 401) {
      forgetSession();
      return undefined;
    }
  }
  return session;
}

function signedOut() {
  return new SecureSessionError(401, 'signed-out', 'Sign in to continue.');
}

// A request to the realm server under the window's own session. A mode that
// changes a key uses this, so the change is authorized by this session and
// never by the app's. A refusal because the session has ended forgets it and
// answers `signed-out`: a key write ticket refuses an ended session with a
// 403, as it does any session that isn't a secure one, so a 403 is checked
// against the server.
export async function authorizedRequest(config, path, options = {}) {
  let session = storedSession();
  if (!session) {
    throw signedOut();
  }
  try {
    return await request(new URL(path, config.realmServerURL), {
      ...options,
      token: session.token,
    });
  } catch (e) {
    if (e.status === 401) {
      forgetSession();
      throw signedOut();
    }
    if (e.status === 403 && !(await liveSession(config))) {
      throw signedOut();
    }
    throw e;
  }
}

// A key write ticket for one change, minted with the window's own session.
// `action` is 'add', or 'replace' or 'delete' with the id of the key.
export async function mintKeyWriteTicket(config, { action, keyId }) {
  let json = await authorizedRequest(config, '_key-write-tickets', {
    body: {
      data: {
        type: 'key-write-ticket',
        attributes: { action, ...(keyId ? { keyId } : {}) },
      },
    },
  });
  return json.data.attributes;
}
