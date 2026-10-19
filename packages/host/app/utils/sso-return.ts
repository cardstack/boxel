import window from 'ember-window-mock';

// A Google sign-in leaves the host for Synapse and Google. When the user
// cancels at Google, Synapse's SSO error page can't tell which page started
// the sign-in, so it sends the browser to the host's root with
// `SSO_CANCELLED_PARAM`. The page that starts a sign-in remembers itself here,
// in this tab's session storage, so a cancelled sign-in can be returned to it:
// `/cli-auth` for the CLI, or whatever page a web sign-in started on.
//
// Only a landing that carries the param reads the entry, so an entry left
// behind by a sign-in that went on to succeed (the CLI's lands on its loopback
// listener, never back here) can't redirect a later visit.

export const SSO_CANCELLED_PARAM = 'ssoCancelled';
const STORAGE_KEY = 'boxel-sso-return';
// Long enough for the user to decide at Google; past that, a cancel lands on
// the root page instead.
export const SSO_RETURN_TTL_MS = 15 * 60 * 1000;

interface SsoReturn {
  url: string;
  expiresAt: number;
}

// Called just before handing the browser to Synapse's SSO redirect.
export function rememberSsoReturn(url: string = window.location.href) {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        url,
        expiresAt: Date.now() + SSO_RETURN_TTL_MS,
      } satisfies SsoReturn),
    );
  } catch {
    // Without session storage a cancel lands on the root page, which still
    // offers sign-in.
  }
}

export function forgetSsoReturn() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was stored.
  }
}

// On a cancelled sign-in's landing, strips the param from the URL and returns
// the page the sign-in started from, when it is on this origin, unexpired, and
// not the page the browser is already on. Returns undefined otherwise, and on
// any other page.
export function takeCancelledSsoReturn(): string | undefined {
  let current = new URL(window.location.href);
  if (!current.searchParams.has(SSO_CANCELLED_PARAM)) {
    return undefined;
  }
  current.searchParams.delete(SSO_CANCELLED_PARAM);
  window.history.replaceState(
    {},
    '',
    current.pathname + current.search + current.hash,
  );

  let entry: Partial<SsoReturn> | null;
  try {
    entry = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    entry = null;
  }
  forgetSsoReturn();
  if (
    !entry ||
    typeof entry.url !== 'string' ||
    typeof entry.expiresAt !== 'number' ||
    entry.expiresAt < Date.now()
  ) {
    return undefined;
  }
  let target: URL;
  try {
    target = new URL(entry.url);
  } catch {
    return undefined;
  }
  if (target.origin !== current.origin || target.href === current.href) {
    return undefined;
  }
  return target.href;
}
