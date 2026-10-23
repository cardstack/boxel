import window from 'ember-window-mock';

// The `loginToken` handed off by `boxel browse` and by Google SSO arrives in
// the query string; the secure origin's sign-in hands it over in the URL's
// fragment, which no server or access log sees. It is deliberately NOT a
// registered route query param, so it must be read straight from
// `window.location`. It is single-use, so readers strip it from the URL
// immediately: a refresh must not re-trigger a spent exchange, and any
// `transitionTo` in the login flow would otherwise drop the unregistered param.

function fragmentParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.replace(/^#/, ''));
}

export function peekLoginToken(): string | null {
  return (
    new URLSearchParams(window.location.search).get('loginToken') ??
    fragmentParams().get('loginToken')
  );
}

// Reads the single-use loginToken and strips it from the URL via
// `history.replaceState`, returning the token (or null if none present).
export function consumeLoginTokenFromUrl(): string | null {
  let params = new URLSearchParams(window.location.search);
  let fragment = fragmentParams();
  let token = params.get('loginToken') ?? fragment.get('loginToken');
  if (!token) {
    return null;
  }
  params.delete('loginToken');
  let search = params.toString();
  // A fragment that didn't carry the token is kept exactly as it was.
  let hash = window.location.hash;
  if (fragment.has('loginToken')) {
    fragment.delete('loginToken');
    hash = fragment.size > 0 ? `#${fragment}` : '';
  }
  let newUrl = window.location.pathname + (search ? `?${search}` : '') + hash;
  window.history.replaceState({}, '', newUrl);
  return token;
}
