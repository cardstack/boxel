/* eslint-env browser */
import { isPagePath } from './pages.js';
import { flushTelemetry } from './telemetry.ts';

// Where the shell's pages send the window: another of the shell's pages,
// Google, or away, by closing it. Every navigation they make goes through
// here, so a test of a page can see where it would have gone without leaving
// the test.
//
// Once the shell's router is running (`useRouter`), a move to another of the
// shell's pages whose address is a path alone is a route transition, so the
// browser's back button returns to the page it came from. An address with a
// query string or a fragment is told something the page reads as it starts,
// so it, like the page the window is already on and any address off the
// shell, loads as a new document.

let router;
let rootURL;
// How many in-app moves `assign` has made that `back` hasn't undone.
let depth = 0;

// The route transition to `url`, as the router's own URL (beneath its
// rootURL), or undefined when `url` loads as a document.
function inAppPath(url) {
  if (!router) {
    return undefined;
  }
  let target = new URL(url, window.location.href);
  if (
    target.origin !== window.location.origin ||
    target.search ||
    target.hash ||
    // The page it is on, which starts afresh only as a new document: a
    // transition to the route it is already on changes nothing.
    target.pathname === window.location.pathname ||
    !target.pathname.startsWith(rootURL)
  ) {
    return undefined;
  }
  let page = target.pathname.slice(rootURL.length);
  return isPagePath(page) ? `/${page}` : undefined;
}

export const navigation = {
  assign(url) {
    let path = inAppPath(url);
    if (path) {
      depth++;
      router.transitionTo(path);
    } else {
      window.location.assign(url);
    }
  },
  replace(url) {
    let path = inAppPath(url);
    if (path) {
      router.replaceWith(path);
    } else {
      window.location.replace(url);
    }
  },
  // Back to the page an in-app move came from, as the back button would go,
  // or, for a page loaded at its own address, on to `url` in its place.
  back(url) {
    if (depth > 0) {
      depth--;
      window.history.back();
    } else {
      this.replace(url);
    }
  },
  // Closes the window. A window the user opened themselves, rather than one
  // a page opened, can't be closed by script and stays as it is. What the
  // telemetry has buffered goes first, as the window may not get another beat.
  close() {
    flushTelemetry('close');
    window.close();
  },
};

// Hands navigation the shell's router service, once the app has booted.
export function useRouter(routerService) {
  router = routerService;
  rootURL = routerService.rootURL;
}
