// The approve page a key page goes back to once the key it was reached for is
// made. The approve page's "Add a new key" opens `enter-key` with
// `then=approve` (or `then=review-changes`) beside what the approve page was
// opened for, and the key page that makes the key goes back to it with the
// new key chosen (`#…&key=<id>`).
//
// A connected account is made by signing in at the service, which leaves the
// secure origin: the `connect` page sends the window to the service, the
// service sends it to the realm server's callback, and the callback sends it
// on to `connected`, whose fragment carries only the sign-in's `code` and
// `state` (or why it failed). So just before it leaves, `connect` keeps its
// own fragment in this window's session storage beside the sign-in's
// `state`, and `connected` takes it back once the service returns. Session
// storage belongs to this origin and this window alone, and lasts across the
// round trip.

import { pageURL } from '../urls.js';

const SIGN_IN_RETURN_KEY = 'boxel-connect-return';

function fragmentOf(hash: string) {
  return new URLSearchParams(hash.replace(/^#/, ''));
}

// The approve page `hash` says to go back to (`then=approve` or
// `then=review-changes`), if any.
export function approvalPageThen(
  hash: string = window.location.hash,
): 'approve' | 'review-changes' | undefined {
  let then = fragmentOf(hash).get('then');
  return then === 'approve' || then === 'review-changes' ? then : undefined;
}

// The approve page `hash` names, with what it was opened for, and with
// `keyId` chosen when there is one.
export function approvalPageAfter(
  keyId: string | undefined,
  hash: string = window.location.hash,
): string | undefined {
  let then = approvalPageThen(hash);
  if (!then) {
    return undefined;
  }
  let fragment = fragmentOf(hash);
  fragment.delete('then');
  // The approve page goes back to the key page it was reached from.
  if (fragment.get('after') === 'keys') {
    fragment.set('then', 'keys');
  }
  fragment.delete('after');
  if (keyId) {
    fragment.set('key', keyId);
  }
  return `${pageURL(then)}#${fragment}`;
}

// Keeps the approve page `hash` names for the sign-in `authorizeUrl` starts,
// for `connected` to go back to. A sign-in started for no approval forgets
// any kept before, so it can't go back to an approval left behind.
export function keepApprovalForSignIn(
  authorizeUrl: string,
  hash: string = window.location.hash,
) {
  try {
    let state = new URL(authorizeUrl).searchParams.get('state');
    if (state && approvalPageThen(hash)) {
      sessionStorage.setItem(
        SIGN_IN_RETURN_KEY,
        JSON.stringify({ state, hash: hash.replace(/^#/, '') }),
      );
    } else {
      sessionStorage.removeItem(SIGN_IN_RETURN_KEY);
    }
  } catch {
    // Without session storage the sign-in still finishes; `connected` then
    // offers the way back to the user's keys instead.
  }
}

// The fragment of the approve page kept for the sign-in whose `state` the
// service sent back, read once. A sign-in that came back without its
// `state` (the service declined it) takes whatever this window kept, which
// can only send the user back to an approval: a new connection is chosen
// only on a match.
export function takeApprovalForSignIn(
  state: string | undefined,
): string | undefined {
  let kept: { state?: unknown; hash?: unknown } | null;
  try {
    kept = JSON.parse(sessionStorage.getItem(SIGN_IN_RETURN_KEY) ?? 'null');
    sessionStorage.removeItem(SIGN_IN_RETURN_KEY);
  } catch {
    return undefined;
  }
  if (
    !kept ||
    typeof kept.hash !== 'string' ||
    (state !== undefined && kept.state !== state)
  ) {
    return undefined;
  }
  return approvalPageThen(kept.hash) ? kept.hash : undefined;
}
