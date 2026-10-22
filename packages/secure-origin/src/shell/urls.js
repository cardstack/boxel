/* eslint-env browser */
// The addresses of the shell's pages. Every mode is the same document at the
// shell's path, told apart by its `mode` query parameter; Google returns to
// `google-callback` beneath it.

const GOOGLE_CALLBACK_SUFFIX = /\/google-callback$/;

// The shell's own address, from wherever beneath it the page is.
export function shellPath() {
  return window.location.pathname.replace(GOOGLE_CALLBACK_SUFFIX, '/');
}

// Whether this page is the address Google returns to.
export function isGoogleCallback() {
  return GOOGLE_CALLBACK_SUFFIX.test(window.location.pathname);
}

// The address of one of the shell's modes. `params` are plain values, never
// an origin or URL, which a firewall in front of a deployment may refuse in a
// query string.
export function modeURL(mode, params = {}) {
  let query = new URLSearchParams({ mode });
  for (let [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(name, value);
    }
  }
  return `${shellPath()}?${query}`;
}

// The CLI a page signs in for, as the query parameters that name it on every
// page of the flow: its loopback port and the state it expects back, and the
// username it suggested. Empty for the window's own sign-in.
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
  return { port, state: cli.state, user: username || undefined };
}

// The page a Google sign-in started from, rebuilt from the `resume` the window
// kept when it sent the user to Google: the CLI's sign-in, for the same
// listener and with the same username, or else the window's own. The CLI keeps
// waiting on its listener while the user starts again there.
export function startURL(resume) {
  let cli = resume?.client === 'cli' ? resume.cli : undefined;
  let params = cliParams(cli, resume?.username);
  if (!params.port || !params.state) {
    return modeURL('sign-in');
  }
  return modeURL('cli-sign-in', params);
}
