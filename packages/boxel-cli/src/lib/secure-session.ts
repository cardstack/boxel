import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import { openBrowser } from './open-browser.ts';
import {
  DEFAULT_TIMEOUT_MS,
  describeDuration,
  startLoopbackCallback,
  watchForCopyKey,
  copyToClipboard,
  type PostedSecureSession,
} from './sso-login.ts';

// The CLI's session for managing the user's keys. The CLI's ordinary session
// can't authorize a change to a key: card code can read the app's session and
// use it outside the browser exactly as the CLI does, so the realm server
// mints a key write ticket only for a session signed in on the secure origin.
// The CLI gets one by opening the secure window's sign-in in the browser,
// which posts the session to a listener on this machine's loopback address
// once the user confirms it is them.

const JSON_API = 'application/vnd.api+json';

export class SecureSessionRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SecureSessionRequestError';
    this.status = status;
  }
}

async function realmServerRequest(
  realmServerUrl: string,
  path: string,
  {
    method = 'GET',
    token,
    body,
    fetchFn = fetch,
  }: {
    method?: string;
    token?: string;
    body?: unknown;
    fetchFn?: typeof fetch;
  } = {},
): Promise<any> {
  let url = new URL(path, ensureTrailingSlash(realmServerUrl));
  let headers: Record<string, string> = { Accept: JSON_API };
  if (token) {
    headers.Authorization = `Bearer ${token.replace(/^Bearer\s+/i, '')}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = JSON_API;
  }
  let response = await fetchFn(url.href, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let text = await response.text().catch(() => '');
    let message = text.slice(0, 300);
    try {
      let errors = JSON.parse(text)?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        message = errors
          .map((error: any) =>
            typeof error === 'string' ? error : (error?.detail ?? ''),
          )
          .join('; ');
      }
    } catch {
      // Not JSON; report the text as it is.
    }
    throw new SecureSessionRequestError(
      `${method} ${url.href} answered HTTP ${response.status}: ${message}`,
      response.status,
    );
  }
  if (response.status === 204) {
    return undefined;
  }
  return await response.json();
}

// Where the realm server's secure origin is.
export async function fetchSecureOriginUrl(
  realmServerUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  let json = await realmServerRequest(realmServerUrl, '_secure-origin', {
    fetchFn,
  });
  let url = json?.data?.attributes?.url;
  if (typeof url !== 'string') {
    throw new Error(`${realmServerUrl} did not say where its secure origin is`);
  }
  return url;
}

// The secure origin to sign a new profile in on (`boxel profile add`), when
// the realm server has one whose pages can: it says so with `cliAuth` in
// `_secure-origin`. Undefined otherwise, including when the realm server has
// no secure origin, predates it, or can't be reached, and the CLI then signs
// in on the host app's own page instead.
export async function secureOriginForProfiles(
  realmServerUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    let json = await realmServerRequest(realmServerUrl, '_secure-origin', {
      fetchFn,
    });
    let { url, cliAuth } = json?.data?.attributes ?? {};
    return cliAuth === true && typeof url === 'string' ? url : undefined;
  } catch {
    return undefined;
  }
}

// The secure window's CLI sign-in. The listener is named by port, and the
// window only ever posts to this machine's loopback address.
export function buildSecureSignInUrl(
  secureOriginUrl: string,
  callback: { port: number; state: string },
  username?: string,
): string {
  let url = new URL(secureOriginUrl);
  url.searchParams.set('mode', 'cli-sign-in');
  url.searchParams.set('port', String(callback.port));
  url.searchParams.set('state', callback.state);
  if (username) {
    url.searchParams.set('user', username);
  }
  return url.href;
}

export interface SecureSignInOptions {
  realmServerUrl: string;
  // Fills in the window's username field.
  username?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  openBrowserFn?: (url: string) => Promise<boolean>;
  log?: (message: string) => void;
  copyToClipboardFn?: (text: string) => Promise<boolean>;
}

export async function secureSignIn(
  options: SecureSignInOptions,
): Promise<PostedSecureSession> {
  let {
    realmServerUrl,
    username,
    timeoutMs,
    fetchFn = fetch,
    openBrowserFn = openBrowser,
    log = console.log,
    copyToClipboardFn = copyToClipboard,
  } = options;
  let secureOriginUrl = await fetchSecureOriginUrl(realmServerUrl, fetchFn);
  let callback = await startLoopbackCallback({ timeoutMs });
  let stopCopyKey: (() => void) | undefined;
  try {
    let signInUrl = buildSecureSignInUrl(secureOriginUrl, callback, username);
    let opened = await openBrowserFn(signInUrl);
    if (opened) {
      log('Opening your browser to sign in to Boxel...');
      log(`If it didn't open, visit:\n  ${signInUrl}`);
    } else {
      log(`Open this URL in your browser to sign in to Boxel:\n  ${signInUrl}`);
    }
    stopCopyKey = watchForCopyKey(signInUrl, {
      log,
      copyFn: copyToClipboardFn,
    });
    log(
      `Waiting up to ${describeDuration(timeoutMs ?? DEFAULT_TIMEOUT_MS)} for ` +
        'you to finish in the browser. ' +
        (stopCopyKey
          ? 'Press c to copy the URL, or Ctrl-C to stop.'
          : 'Press Ctrl-C to stop.'),
    );
    let result = await callback.waitForResult();
    if (result.kind !== 'secureSession') {
      throw new Error('The browser returned a different kind of sign-in.');
    }
    return result.session;
  } finally {
    stopCopyKey?.();
    callback.close();
  }
}

// Ends a secure session on the realm server. One that has already ended or
// expired is signed out already.
export async function secureSignOut(
  realmServerUrl: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  try {
    await realmServerRequest(realmServerUrl, '_secure-session', {
      method: 'DELETE',
      token,
      fetchFn,
    });
  } catch (e) {
    if (!(e instanceof SecureSessionRequestError && e.status === 401)) {
      throw e;
    }
  }
}

export type KeyWriteAction = 'add' | 'replace' | 'delete';

// A key write ticket for one change. The realm server mints one only for a
// session signed in on the secure origin.
export async function mintKeyWriteTicket(
  realmServerUrl: string,
  token: string,
  { action, keyId }: { action: KeyWriteAction; keyId?: string },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  let json = await realmServerRequest(realmServerUrl, '_key-write-tickets', {
    method: 'POST',
    token,
    fetchFn,
    body: {
      data: {
        type: 'key-write-ticket',
        attributes: { action, ...(keyId ? { keyId } : {}) },
      },
    },
  });
  return json.data.attributes.ticket;
}

export interface UserKeyMetadata {
  id: string;
  name: string;
  kind: string;
  state: string;
  createdAt: string;
  updatedAt: string;
}

// Adds a key, under a ticket minted with `token` for the add.
export async function addUserKey(
  realmServerUrl: string,
  token: string,
  { name, value }: { name: string; value: string },
  fetchFn: typeof fetch = fetch,
): Promise<UserKeyMetadata> {
  let ticket = await mintKeyWriteTicket(
    realmServerUrl,
    token,
    { action: 'add' },
    fetchFn,
  );
  let json = await realmServerRequest(realmServerUrl, '_user-keys', {
    method: 'POST',
    token,
    fetchFn,
    body: {
      data: { type: 'user-key', attributes: { name, value } },
      meta: { ticket },
    },
  });
  return { id: json.data.id, ...json.data.attributes };
}
