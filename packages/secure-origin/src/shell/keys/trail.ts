// The trail of key pages the window has come through to reach this one, drawn
// as breadcrumbs above the page (`breadcrumbs.gts`), so a user who moves on
// from the page the window was opened on can go back to it, or to any page
// between, as it was.
//
// A page is an address: its path beneath the shell's address and its
// fragment, which says what the page was opened for. A page that sends the
// window on to another names itself in that page's fragment as `back`
// (`withWayBack`), and that address carries its own `back` in turn, so the
// trail is read from the address alone however far the user goes:
//
//   enter-key#…&then=approve&back=approve%23card%3D…
//
// Pages beneath the key page's path (`keys/add`, `keys/<key id>/share`,
// `keys/<key id>/use`) are reached from the key page, so the key page is
// above each of them. Those moves are route transitions, which keep neither
// the document's path nor its fragment, so the key page above them is the
// address the document was loaded at when that is the key page.
//
// Going back to a page loads its address again, so the page starts afresh
// for what it was opened for, and nothing is saved or changed on the way.
// `back` names only one of the shell's pages; anything else ends the trail.

import { documentAddress, navigation } from '../navigation.js';
import { isPagePath, keyOfSharePath, keyOfUsePath } from '../pages.js';
import { currentPage, shellPath } from '../urls.js';

export interface Crumb {
  label: string;
  // The address to load, beneath the shell's address.
  url: string;
}

const BACK = 'back';
// More pages than any move between them makes; a longer trail is cut here.
const MAX_CRUMBS = 6;

function split(address: string): { page: string; fragment: URLSearchParams } {
  let at = address.indexOf('#');
  return at === -1
    ? { page: address, fragment: new URLSearchParams() }
    : {
        page: address.slice(0, at),
        fragment: new URLSearchParams(address.slice(at + 1)),
      };
}

function isKeyPage(page: string) {
  return page === '' || page === 'keys';
}

// The page above `address`: the one its `back` names, or for a page beneath
// the key page's path, the key page.
function parentOf(address: string): string | undefined {
  let { page, fragment } = split(address);
  let back = fragment.get(BACK);
  if (back !== null) {
    let parent = split(back).page;
    return !parent.includes('?') && isPagePath(parent) ? back : undefined;
  }
  return page.startsWith('keys/') ? 'keys' : undefined;
}

// This page's address. A page beneath the key page's path reached by a route
// transition has no fragment of its own, so the key page above it is the one
// the document was loaded at, with that page's own trail.
export function currentAddress(): string {
  let page = currentPage();
  let hash = window.location.hash.replace(/^#/, '');
  if (hash) {
    return `${page}#${hash}`;
  }
  let loaded = documentAddress();
  if (
    page.startsWith('keys/') &&
    loaded !== undefined &&
    isKeyPage(split(loaded).page) &&
    split(loaded).fragment.has(BACK)
  ) {
    return `${page}#${new URLSearchParams({ [BACK]: loaded })}`;
  }
  return page;
}

// `url`, another of the shell's pages, with the way back to this page in its
// fragment.
export function withWayBack(url: string): string {
  let at = url.indexOf('#');
  let address = at === -1 ? url : url.slice(0, at);
  let fragment = new URLSearchParams(at === -1 ? '' : url.slice(at + 1));
  fragment.set(BACK, currentAddress());
  return `${address}#${fragment}`;
}

// The page just above this one in its trail, as its path beneath the shell's
// address and its fragment, if any.
export function addressAbove(): string | undefined {
  return parentOf(currentAddress());
}

// A page's title: a short name a glance takes in, which the page shows as
// its heading and its crumb shows in the trail, so the two always match.
// `reconnecting` is the connect page's for signing a connection in again.
export function pageTitle(page: string, reconnecting = false): string {
  if (isKeyPage(page)) {
    return 'Your keys';
  }
  if (keyOfSharePath(page) !== undefined) {
    return 'Share key';
  }
  if (keyOfUsePath(page) !== undefined) {
    return 'Use with card';
  }
  switch (page) {
    case 'keys/add':
    case 'enter-key':
      return 'Add key';
    case 'share-key':
      return 'Share key';
    case 'swap-key':
      return 'Swap key';
    case 'replace-key':
      return 'Replace key';
    case 'share-limits':
      return 'Limits';
    case 'approve':
      return 'Approve';
    case 'review-changes':
      return 'Review changes';
    case 'connect':
      return reconnecting ? 'Reconnect' : 'Connect';
    case 'connected':
      return 'Connected';
    default:
      return page;
  }
}

function labelOf(address: string): string {
  let { page, fragment } = split(address);
  return pageTitle(page, fragment.has('reconnect'));
}

// The pages from the first the window came through to this one, this one
// last. A page reached from none is a trail of one.
export function trail(): Crumb[] {
  let crumbs: Crumb[] = [];
  let address: string | undefined = currentAddress();
  while (address !== undefined && crumbs.length < MAX_CRUMBS) {
    crumbs.unshift({
      label: labelOf(address),
      url: `${shellPath()}${address}`,
    });
    address = parentOf(address);
  }
  return crumbs;
}

// Goes back to one of the pages above this one. The page just above, when
// this page was reached from it by a route transition, is where the browser's
// back button goes, so it goes there the same way.
export function goBackTo(crumb: Crumb, crumbs: Crumb[]) {
  if (crumbs.indexOf(crumb) === crumbs.length - 2) {
    navigation.back(crumb.url);
  } else {
    navigation.replace(crumb.url);
  }
}
