// The shell's pages, each at its own path beneath the shell's address. The
// shell's router has a route for each (`app.gts`), and the realm server serves
// the shell's document at each of these paths and no other. This module is
// plain values, so the realm server reads the same list. The policy test
// loads every page here and checks it draws its own page.
//
// The key page is also at the shell's own address. A key's share page and its
// page for using it with a card name the key in their path,
// `keys/<key id>/share` and `keys/<key id>/use`; everything else a page is
// told rides in its query string or its fragment.

export const PAGE_PATHS = Object.freeze([
  'sign-in',
  'cli-sign-in',
  'cli-auth',
  'sign-out',
  'register',
  'verify-email',
  'forgot-password',
  'reset-password',
  'google-callback',
  'keys',
  'keys/add',
  'enter-key',
  'share-key',
  'swap-key',
  'replace-key',
  'connect',
  'connected',
  'approve',
  'review-changes',
]);

// The values of the `mode` query parameter that address a page. Earlier CLI
// releases and emails already sent use them, so the shell maps each to the
// page of the same name.
export const LEGACY_MODES = Object.freeze([
  'sign-in',
  'cli-sign-in',
  'cli-auth',
  'sign-out',
  'register',
  'verify-email',
  'forgot-password',
  'reset-password',
  'keys',
  'enter-key',
  'share-key',
  'swap-key',
]);

// A key id as it appears in a path: the realm server's ids are UUIDs.
const KEY_ID = '[A-Za-z0-9-]{1,64}';
const KEY_SHARE_PATH = new RegExp(`^keys/(${KEY_ID})/share$`);
const KEY_USE_PATH = new RegExp(`^keys/(${KEY_ID})/use$`);

// The path of the share page for one of the user's keys.
export function keySharePath(keyId) {
  return `keys/${encodeURIComponent(keyId)}/share`;
}

// The key a `keys/<key id>/share` path names, or undefined for any other path.
export function keyOfSharePath(path) {
  return KEY_SHARE_PATH.exec(path)?.[1];
}

// The path of the page for setting one of the user's keys up for a card.
export function keyUsePath(keyId) {
  return `keys/${encodeURIComponent(keyId)}/use`;
}

// The key a `keys/<key id>/use` path names, or undefined for any other path.
export function keyOfUsePath(path) {
  return KEY_USE_PATH.exec(path)?.[1];
}

// Whether `path`, beneath the shell's address and without a leading slash, is
// one of the shell's pages. The empty path is the shell's own address.
export function isPagePath(path) {
  return (
    path === '' ||
    PAGE_PATHS.includes(path) ||
    KEY_SHARE_PATH.test(path) ||
    KEY_USE_PATH.test(path)
  );
}

// The shell's address and the page beneath it, from a path the shell is
// served at: `/secure/keys/add` is the page `keys/add` beneath `/secure/`. A
// path that ends in none of the pages is the shell's own address.
export function splitPagePath(pathname) {
  for (let page of [...PAGE_PATHS].sort((a, b) => b.length - a.length)) {
    if (pathname.endsWith(`/${page}`)) {
      return {
        shell: pathname.slice(0, pathname.length - page.length),
        page,
      };
    }
  }
  let keyPage = /\/(keys\/[^/]+\/(?:share|use))$/.exec(pathname);
  if (
    keyPage &&
    (KEY_SHARE_PATH.test(keyPage[1]) || KEY_USE_PATH.test(keyPage[1]))
  ) {
    return {
      shell: pathname.slice(0, pathname.length - keyPage[1].length),
      page: keyPage[1],
    };
  }
  return {
    shell: pathname.endsWith('/') ? pathname : `${pathname}/`,
    page: '',
  };
}
