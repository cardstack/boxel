// Handing a sign-in over to the app. The app sends a signed-out user here
// with the page to come back to, `return`, in the URL's fragment: a firewall
// in front of a deployment refuses a query string that names a loopback
// origin, and the fragment never leaves the browser. Once the user is signed
// in here, the page navigates to `return` with a single-use Matrix login
// token in its fragment, which the app redeems for a Matrix session of its
// own.
// The secure session never leaves this origin.
//
// `return` is honoured only on one of the app origins the realm server lists
// for this deployment (`boxel-app-origins`, the same list the credential
// fields may be framed by, and the realm server's own), so this page is never
// an open redirect handing login tokens to whoever asks. The loopback origins
// are on every deployment's list for a host app on the developer's own
// machine, and any program on that machine can listen there, so a hand-off to
// one waits for the user to confirm it.
//
// The page may also name the account it needs, `user`, beside `return`, as
// `boxel browse` does for the account its profile is signed in as. The
// window then hands a sign-in over only when its session is that account's;
// filling the account into the form is no check. A user who keeps the
// window's account instead goes back to `return` with no login token.

import { isListedOrigin } from './app-origins.js';

// The `return` this tab's sign-in hands over to, kept across the pages a
// sign-in passes through on this origin: creating an account, and Google's
// round trip, which comes back to this tab.
const RETURN_KEY = 'boxel-secure-return';
// The account that sign-in must be, when the page named one.
const RETURN_USER_KEY = 'boxel-secure-return-user';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// The origins `return` may name: those listed in the page's markup, and the
// realm server's, which serves the app.
export function appOrigins(config, doc = document) {
  let listed =
    doc
      .querySelector('meta[name="boxel-app-origins"]')
      ?.getAttribute('content')
      ?.split(/\s+/)
      .filter(Boolean) ?? [];
  return [config.realmServerURL.origin, ...listed];
}

// The page to hand over to, when `value` names one on a listed origin;
// otherwise undefined.
export function checkedReturn(value, listed) {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return undefined;
  }
  if (url.username || url.password || !isListedOrigin(url.origin, listed)) {
    return undefined;
  }
  return url.href;
}

// The `return` named in a fragment such as `#return=…`, checked.
export function returnFromFragment(hash, listed) {
  return checkedReturn(
    new URLSearchParams(hash.replace(/^#/, '')).get('return'),
    listed,
  );
}

// A Matrix user ID, `@localpart:server`, as the app and the CLI name an
// account. Anything else names no account.
const MATRIX_USER_ID = /^@[A-Za-z0-9._=\-/+]+:[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const MAX_USER_ID_LENGTH = 255;

// `value` when it is a Matrix user ID; otherwise undefined.
export function checkedUser(value) {
  if (
    typeof value !== 'string' ||
    value.length > MAX_USER_ID_LENGTH ||
    !MATRIX_USER_ID.test(value)
  ) {
    return undefined;
  }
  return value;
}

// Takes `return` out of the address bar, so a reload or a copied address
// doesn't carry it on, and keeps it for the rest of this tab's sign-in. A
// page opened with no `return` keeps any it was already handed: the pages of
// one sign-in link to each other without one.
export function rememberReturn(listed) {
  let hash = window.location.hash;
  if (!/(^#|&)return=/.test(hash)) {
    return;
  }
  history.replaceState(
    history.state,
    '',
    window.location.pathname + window.location.search,
  );
  let target = returnFromFragment(hash, listed);
  let user = new URLSearchParams(hash.replace(/^#/, '')).get('user');
  keepReturn(target, target ? checkedUser(user) : undefined);
}

// Keeps `target`, already checked, as the page this tab's sign-in hands over
// to, and `user`, already checked, as the account that sign-in must be;
// undefined forgets any kept before.
export function keepReturn(target, user) {
  if (target) {
    sessionStorage.setItem(RETURN_KEY, target);
  } else {
    sessionStorage.removeItem(RETURN_KEY);
  }
  if (target && user) {
    sessionStorage.setItem(RETURN_USER_KEY, user);
  } else {
    sessionStorage.removeItem(RETURN_USER_KEY);
  }
}

// The page this tab's sign-in hands over to, checked again, or undefined.
export function pendingReturn(listed) {
  let target;
  try {
    target = sessionStorage.getItem(RETURN_KEY);
  } catch {
    return undefined;
  }
  return checkedReturn(target, listed);
}

// The account this tab's sign-in must be before it hands over, checked
// again, or undefined when the page named none.
export function pendingReturnUser() {
  let user;
  try {
    user = sessionStorage.getItem(RETURN_USER_KEY);
  } catch {
    return undefined;
  }
  return checkedUser(user);
}

export function forgetReturn() {
  sessionStorage.removeItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_USER_KEY);
}

// Whether the user confirms a hand-off to `target` first: one to a program on
// their own machine, whatever its scheme, since any program there can listen
// on a loopback port, `https:` as well as `http:`. The realm server's own
// origin, which serves the app it is configured with, is never asked about.
export function needsConfirmation(target, config) {
  let url = new URL(target);
  return (
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.origin !== config.realmServerURL.origin
  );
}

// `target` with no login token in it: going back to the app page without
// handing a sign-in over, as when the user keeps the window's account rather
// than sign in as the one the page named. The app then opens as the account it
// holds, or, signed out, offers to sign in again.
export function withoutHandOff(target) {
  let url = new URL(target);
  url.searchParams.delete('loginToken');
  url.hash = '';
  return url.href;
}

// `target` with the login token in its fragment, in place of any fragment it
// carried, and the device id the app signs in as with it, which binds the
// window's session to the app's (see `liveSession` in session.js). The
// fragment never reaches a server, so no request log or access log records
// the token on its way to the app.
export function handOffURL(target, loginToken, deviceId) {
  let url = new URL(target);
  url.searchParams.delete('loginToken');
  url.hash = new URLSearchParams({
    loginToken,
    ...(deviceId ? { deviceId } : {}),
  }).toString();
  return url.href;
}
