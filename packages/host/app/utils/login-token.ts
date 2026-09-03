import window from 'ember-window-mock';

// The `loginToken` handed off by `boxel browse` and by Google SSO is
// deliberately NOT a registered route query param, so it must be read straight
// from `window.location.search`. It is single-use, so readers strip it from the
// URL immediately: a refresh must not re-trigger a spent exchange, and any
// `transitionTo` in the login flow would otherwise drop the unregistered param.

export function peekLoginToken(): string | null {
  return new URLSearchParams(window.location.search).get('loginToken');
}

// Reads the single-use loginToken and strips it from the URL via
// `history.replaceState`, returning the token (or null if none present).
export function consumeLoginTokenFromUrl(): string | null {
  let params = new URLSearchParams(window.location.search);
  let token = params.get('loginToken');
  if (!token) {
    return null;
  }
  params.delete('loginToken');
  let search = params.toString();
  let newUrl =
    window.location.pathname +
    (search ? `?${search}` : '') +
    window.location.hash;
  window.history.replaceState({}, '', newUrl);
  return token;
}
