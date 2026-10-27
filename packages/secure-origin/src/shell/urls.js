/* eslint-env browser */
import {
  PROFILE_PARAM,
  PROFILE_VALUE,
  SECURE_SESSION_PARAM,
  SECURE_SESSION_VALUE,
} from '../security/cli-handoff.js';

import { splitPagePath } from './pages.js';

// The addresses of the shell's pages. Each page is the same document at its
// own path beneath the shell's address (`pages.js`); what a page is told
// rides in the query string or the fragment.

// The shell's own address, from wherever beneath it the page is.
export function shellPath() {
  return splitPagePath(window.location.pathname).shell;
}

// The page this document is, as its path beneath the shell's address.
export function currentPage() {
  return splitPagePath(window.location.pathname).page;
}

// Whether this page is the address Google returns to.
export function isGoogleCallback() {
  return currentPage() === 'google-callback';
}

// The address of one of the shell's pages. `params` are plain values, never
// an origin or URL, which a firewall in front of a deployment may refuse in a
// query string.
export function pageURL(page, params = {}) {
  let query = new URLSearchParams();
  for (let [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(name, value);
    }
  }
  let search = query.size > 0 ? `?${query}` : '';
  return `${shellPath()}${page}${search}`;
}

// The CLI a page signs in for, as the query parameters that name it on every
// page of the flow: its loopback port and the state it expects back, the
// username it suggested, and, for a profile sign-in, that it is one and
// whether the CLI takes a secure session too. Empty for the window's own
// sign-in.
export function cliParams(cli, username) {
  if (!cli) {
    return {};
  }
  let port;
  try {
    port = new URL(cli.url).port;
  } catch {
    return {};
  }
  return {
    port,
    state: cli.state,
    user: username || undefined,
    ...(cli.profile
      ? {
          [PROFILE_PARAM]: PROFILE_VALUE,
          [SECURE_SESSION_PARAM]: cli.profile.secureSession
            ? SECURE_SESSION_VALUE
            : undefined,
        }
      : {}),
  };
}

// The sign-in page for a CLI: `cli-auth` for a profile sign-in, which hands
// over a login token, and `cli-sign-in` for `boxel keys sign-in`.
export function cliSignInPage(cli) {
  return cli?.profile ? 'cli-auth' : 'cli-sign-in';
}

// The page a Google sign-in started from, rebuilt from the `resume` the window
// kept when it sent the user to Google: the CLI's sign-in, for the same
// listener and with the same username, or else the window's own. The CLI keeps
// waiting on its listener while the user starts again there.
export function startURL(resume) {
  let cli = resume?.client === 'cli' ? resume.cli : undefined;
  let params = cliParams(cli, resume?.username);
  if (!params.port || !params.state) {
    return pageURL('sign-in');
  }
  return pageURL(cliSignInPage(cli), params);
}
