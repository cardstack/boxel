// The labels the secure origin's telemetry names a request and a page by. Each
// is one of a fixed set written out here: a path segment that carries an id
// (a key's, a share's, a Matrix user's) is matched as `:id` and never copied,
// a query string is never read, and a request or page that matches none of
// the known shapes is `other`. So a label says which kind of request or page
// it was, and nothing about what it was for.
//
// A new call a page makes needs its shape added here, or it reports as
// `other`.

const REALM_SERVER_ENDPOINTS = [
  '_user-keys',
  '_user-keys/:id',
  '_key-shares',
  '_key-shares/:id/swap',
  '_key-write-tickets',
  '_oauth/clients',
  '_oauth/connections',
  '_oauth/connections/complete',
  '_secure-window/context',
  '_secure-window/realms',
  '_secure-origin',
  '_secure-session',
  '_secure-session/google',
  '_secure-session/login-token',
  '_secure-session/renewal',
  '_secure-sessions/password-change',
];

// Beneath `_matrix/client/v3/`.
const MATRIX_ENDPOINTS = [
  'register',
  'register/available',
  'register/email/requestToken',
  'account/password/email/requestToken',
  'profile/:id/displayname',
  'logout',
];

const MATRIX_PREFIX = ['_matrix', 'client', 'v3'];

export const OTHER = 'other';

function matches(segments: string[], pattern: string): boolean {
  let parts = pattern.split('/');
  return (
    parts.length === segments.length &&
    parts.every((part, i) => part === ':id' || part === segments[i])
  );
}

function label(segments: string[], patterns: string[]): string | undefined {
  return patterns.find((pattern) => matches(segments, pattern));
}

// The endpoint a request to the realm server or the Matrix server was for.
export function endpointLabel(url: string | URL): string {
  let segments: string[];
  try {
    segments = new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return OTHER;
  }
  let start = segments.findIndex((segment) => segment.startsWith('_'));
  if (start === -1) {
    return OTHER;
  }
  let rest = segments.slice(start);
  if (MATRIX_PREFIX.every((part, i) => rest[i] === part)) {
    let endpoint = label(rest.slice(MATRIX_PREFIX.length), MATRIX_ENDPOINTS);
    return endpoint ? `${MATRIX_PREFIX.join('/')}/${endpoint}` : OTHER;
  }
  return label(rest, REALM_SERVER_ENDPOINTS) ?? OTHER;
}

// The shell's page for one of its router's routes: the page's path beneath
// the shell (`pages.js`), with a key's share page as `keys/share`. The shell's
// own address shows the key page.
const PAGES: Record<string, string> = {
  index: 'keys',
  'keys.index': 'keys',
  'keys.add': 'keys/add',
  'keys.share': 'keys/share',
  'sign-in': 'sign-in',
  'cli-sign-in': 'cli-sign-in',
  'cli-auth': 'cli-auth',
  'sign-out': 'sign-out',
  register: 'register',
  'verify-email': 'verify-email',
  'forgot-password': 'forgot-password',
  'reset-password': 'reset-password',
  'google-callback': 'google-callback',
  'enter-key': 'enter-key',
  'share-key': 'share-key',
  'swap-key': 'swap-key',
  'replace-key': 'replace-key',
  connect: 'connect',
  connected: 'connected',
};

export function pageLabel(routeName: string | undefined): string {
  return routeName && Object.hasOwn(PAGES, routeName)
    ? PAGES[routeName]!
    : OTHER;
}
