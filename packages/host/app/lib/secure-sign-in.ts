import window from 'ember-window-mock';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';
import type { ResetPasswordParams } from '@cardstack/host/lib/reset-password-link';

// Signing in to Boxel on the secure origin's own page. The app never draws a
// sign-in form: a signed-out app sends the user to the secure origin with the
// page to come back to, and the secure origin sends them back with a
// single-use Matrix login token, which the app redeems for its Matrix session
// (see the secure origin's `security/app-handoff.js`).
//
// Anything that names an origin or a URL travels to the secure origin in the
// fragment, never the query string: a firewall in front of a deployment
// refuses a query string that names a loopback origin, and a fragment never
// leaves the browser.

// The address of one of the secure origin's pages: each is at its own path
// beneath the secure origin's URL.
export function pageURL(page: string, params: Record<string, string> = {}) {
  let url = new URL(ENV.secureOriginURL);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${page}`;
  for (let [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return url;
}

export function withFragment(url: URL, fragment: Record<string, string>) {
  url.hash = new URLSearchParams(fragment).toString();
  return url.href;
}

// The account a link into the app asks it to be signed in as, such as the
// one `boxel browse` names for its profile: `?signInAs=<Matrix user ID>`.
// Signed in as another account, or not at all, the app sends the user to the
// secure origin to sign in as that one, which hands a sign-in back only once
// its session is that account's. It names an account, never a credential.
// Deliberately not a registered route query param, so it is read straight
// from `window.location`, as `loginToken` is.
export const SIGN_IN_AS_PARAM = 'signInAs';

export function peekSignInAs(): string | undefined {
  return (
    new URLSearchParams(window.location.search).get(SIGN_IN_AS_PARAM) ||
    undefined
  );
}

// Takes `signInAs` out of the address once the app has acted on it, so a
// reload or a copied address doesn't carry it on.
export function stripSignInAs() {
  let url = new URL(window.location.href);
  if (!url.searchParams.has(SIGN_IN_AS_PARAM)) {
    return;
  }
  url.searchParams.delete(SIGN_IN_AS_PARAM);
  window.history.replaceState(
    window.history.state,
    '',
    url.pathname + url.search + url.hash,
  );
}

// The app page a sign-in comes back to: this one, path and query included.
// A login token left over from an earlier hand-off is dropped, as are the
// account it asked for, which the secure origin has checked by then, and the
// fragment.
export function currentAppPage(): string {
  let url = new URL(window.location.href);
  url.searchParams.delete('loginToken');
  url.searchParams.delete(SIGN_IN_AS_PARAM);
  url.hash = '';
  return url.href;
}

// Whether this page opens on the workspace chooser once the session is up.
// The index route reopens it whenever the page's operator-mode state says it
// is open, and opens it for the app's root page when the page names no card
// and its state, if any, is an interact submode with no stacks (see
// `routes/index.gts`). The boot script in `index.html` repeats this check,
// since it runs before the app's modules: keep the two in step.
export function landsOnWorkspaceChooser(): boolean {
  let { pathname, search } = window.location;
  let params = new URLSearchParams(search);
  let serialized = params.get('operatorModeState');
  let state:
    | { submode?: unknown; stacks?: unknown; workspaceChooserOpened?: unknown }
    | null
    | undefined;
  if (serialized) {
    try {
      state = JSON.parse(serialized);
    } catch {
      return false;
    }
  }
  if (state?.workspaceChooserOpened === true) {
    return true;
  }
  // A path the route can't resolve to a card also lands on the chooser, but
  // that can't be known before the app boots.
  if (pathname !== ENV.rootURL || params.has('cardPath')) {
    return false;
  }
  // The route takes a null state as no state.
  if (!state) {
    return true;
  }
  return (
    state?.submode === Submodes.Interact &&
    Array.isArray(state.stacks) &&
    state.stacks.length === 0
  );
}

// Where a signed-out app sends the user to sign in, naming the account the
// page asks for, if any, beside the page to come back to.
export function secureSignInURL(
  returnTo = currentAppPage(),
  user = peekSignInAs(),
): string {
  return withFragment(pageURL('sign-in'), {
    return: returnTo,
    ...(user ? { user } : {}),
  });
}

// Where the app sends the user once it has signed out of its own session, so
// the secure origin ends its session too and goes on to its sign-in page,
// whose next sign-in hands back to `returnTo`.
export function secureSignOutURL(returnTo: string): string {
  return withFragment(pageURL('sign-out'), { return: returnTo });
}

// Where a `boxel` CLI that sends the browser to the app's `/cli-auth` signs
// in instead. Neither the port nor the state names an origin.
export function secureCliAuthURL(port: string, state: string): string {
  return pageURL('cli-auth', {
    ...(port ? { port } : {}),
    ...(state ? { state } : {}),
  }).href;
}

// Where a password reset email sent to the app's address lands instead. The
// client secret, the validation session and the email address go in the
// fragment, which the secure origin's reset page reads.
export function secureResetPasswordURL({
  sid,
  clientSecret,
  email,
}: ResetPasswordParams): string {
  return withFragment(pageURL('reset-password'), {
    clientSecret,
    ...(email ? { email } : {}),
    sid,
  });
}

// The app's own page, at its root: where the sign-in that follows a sign-out
// comes back to. It carries no card ids, so no private card is named in the
// address.
export function appRootURL(): string {
  return new URL('/', window.location.href).href;
}

// The guard against sending the user round and round: a signed-out app sends
// the user to sign in, and only once in a short while from this tab. Coming
// back signed out again inside that window means the sign-in didn't complete
// (a blocked hand-off, a token that wouldn't redeem), so the app stops and
// says so, with its button still there to try again.
const REDIRECTED_AT_KEY = 'boxel-secure-sign-in-redirected-at';
export const REDIRECT_GUARD_MS = 2 * 60 * 1000;

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function redirectedRecently(now = Date.now()): boolean {
  let at = Number(storage()?.getItem(REDIRECTED_AT_KEY) ?? NaN);
  return Number.isFinite(at) && now - at < REDIRECT_GUARD_MS;
}

export function noteRedirect(now = Date.now()) {
  storage()?.setItem(REDIRECTED_AT_KEY, String(now));
}

// Once signed in, the next signed-out arrival is a new one, which redirects.
export function clearRedirectGuard() {
  storage()?.removeItem(REDIRECTED_AT_KEY);
}

// Whether the app is in a frame, which a redirect must never navigate: a
// published site or another page frames the app, and sends a user to sign in
// in a page of their own. Read from the real globals, never the window mock,
// whose proxy is never its own `top`. Kept on an object so a test can say the
// app is framed.
export const framing = {
  isFramed(): boolean {
    try {
      return globalThis.self !== globalThis.top;
    } catch {
      return true;
    }
  },
};
