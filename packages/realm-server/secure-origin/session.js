/* eslint-env browser */
// The secure window's own realm-server session: signed in here, kept in this
// origin's storage, and never posted to the app. Card code runs in the app
// page and can read the app's session; it can't read this one, because the
// same-origin policy keeps it on the secure origin, and minting a key write
// ticket requires it.
//
// Signing in is a check the realm server drives (see the realm server's
// `lib/secure-session.ts`): the window starts a sign-in for a username, the
// user confirms it is them, with their password or their single sign-on
// provider, and the window completes the sign-in for a session.

const STORAGE_KEY = 'boxel-secure-session';
const JSON_API = 'application/vnd.api+json';
// A session this close to its end is treated as already ended, so a request
// made with it doesn't fail partway through.
const EXPIRY_MARGIN_MS = 60 * 1000;

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

async function request(url, { method = 'POST', body, token } = {}) {
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

// Starts a sign-in. `client` is 'window' for this window's own session, 'cli'
// for a session handed to the CLI.
export async function startSignIn(config, { username, client }) {
  let json = await request(
    new URL('_secure-session/sign-in', config.realmServerURL),
    {
      body: {
        data: { type: 'secure-sign-in', attributes: { username, client } },
      },
    },
  );
  return json.data.attributes;
}

// Completes a sign-in, with the password, or after single sign-on with none.
// A sign-in waiting on single sign-on fails with code 'pending'.
export async function completeSignIn(config, { signIn, password }) {
  let json = await request(new URL('_secure-session', config.realmServerURL), {
    body: {
      data: {
        type: 'secure-session',
        attributes: { signIn, ...(password ? { password } : {}) },
      },
    },
  });
  return json.data.attributes;
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

// A request to the realm server under the window's own session. A mode that
// changes a key uses this, so the change is authorized by this session and
// never by the app's.
export async function authorizedRequest(config, path, options = {}) {
  let session = storedSession();
  if (!session) {
    throw new SecureSessionError(401, 'signed-out', 'Sign in to continue.');
  }
  try {
    return await request(new URL(path, config.realmServerURL), {
      ...options,
      token: session.token,
    });
  } catch (e) {
    if (e.status === 401) {
      forgetSession();
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
