// The click filter the app's link catchers share. A catcher takes over a
// click only when the browser would have used it to load the link's URL in
// this tab. Everything else keeps the browser's default: a click another
// handler dealt with, a click with a modifier key or another button, a link
// with `target` or `download`, a link that is being edited, a link that is
// not http(s), and a link with a query string or a fragment.

// Whether a click is a plain one: the primary button, no modifier key, and
// no other handler dealt with it. A keyboard activation of a link arrives as
// such a click too.
export function isPlainClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

// The URL of the link an event happened on, when the browser would follow
// it in this tab, with no query string and no fragment.
export function followableLinkURL(event: Event): URL | undefined {
  let origin = event.composedPath()[0] ?? event.target;
  if (!(origin instanceof Element)) {
    return undefined;
  }
  let anchor = origin.closest('a[href]');
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.hasAttribute('download') ||
    anchor.isContentEditable
  ) {
    return undefined;
  }
  let target = anchor.target.toLowerCase();
  if (target && target !== '_self') {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return undefined;
  }
  // A query string is left to the browser because the app's router keeps
  // only its own query parameters, and a card may read the others. A
  // fragment is left to it because the browser scrolls to it.
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.href.includes('?') ||
    url.href.includes('#')
  ) {
    return undefined;
  }
  return url;
}

// The URL of the link a plain click happened on, when the browser would
// follow it in this tab: what a link catcher may take over.
export function plainLinkClickURL(event: MouseEvent): URL | undefined {
  return isPlainClick(event) ? followableLinkURL(event) : undefined;
}

// Whether a path's last segment has a dot, as a file's name has. A card's
// id can have one too (`Milestone/v1.2`), so a caller that must tell a card
// from a file asks something that knows before it treats the path as a
// file's.
export function pathNamesFile(path: string): boolean {
  let last = path.replace(/\/+$/, '').split('/').pop() ?? '';
  return last.includes('.');
}
