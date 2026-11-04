import { pageURL, withFragment } from './secure-sign-in';

// The secure window: the secure origin's key pages, opened as a popup. A key's
// value is only ever typed there, in a window whose address bar names the
// secure origin, never in the app page, where card code could read it. Its
// connect mode signs the user in to a service through an OAuth app, from that
// same window, so no token the service issues passes through the app page.
// Its approve mode approves a card's operations, every one on the card's
// definition that needs the user's approval in one confirmation, and its
// review-changes mode the same for the ones whose request changed since they
// were approved; the caller names only the one operation it is blocked on.
// Its share-limits mode is where the owner of a share's key changes the
// share's limits, which the app's session may not.
//
// The app tells the window which page to show and what it is for, and nothing
// else. Everything it says names something (a realm, a card or a card type,
// an operation) or is the one line of reason the window shows as written by
// whoever opened it. The window signs in with its own session, mints its own
// key write tickets, and asks the realm server what each name refers to, so
// the address carries no ticket, session or value, and nothing the app page
// sends can stand in for what the realm server says.

export const SECURE_WINDOW_MODES = [
  'enter-key',
  'replace-key',
  'share-key',
  'swap-key',
  'share-limits',
  'connect',
  'approve',
  'review-changes',
] as const;
export type SecureWindowMode = (typeof SECURE_WINDOW_MODES)[number];

export function isSecureWindowMode(mode: unknown): mode is SecureWindowMode {
  return SECURE_WINDOW_MODES.includes(mode as SecureWindowMode);
}

// What a key is entered, or an account connected, for: an operation on a
// card instance, or on a card type, which is named by its module, its export
// and the realm it is used in.
export type SecureWindowTarget =
  | { kind: 'instance'; card: string; operation?: string }
  | {
      kind: 'type';
      module: string;
      name: string;
      realm: string;
      operation?: string;
    };

// `replace-key` is for an operation, whose key the window finds from the
// user's binding for it, so its target always names one. An account is
// connected for a target, or for a realm whose shared apps the window offers,
// or for nothing in particular.
export type SecureWindowRequest =
  | { mode: 'enter-key'; target?: SecureWindowTarget; reason?: string }
  | {
      mode: 'replace-key';
      target: SecureWindowTarget & { operation: string };
      reason?: string;
    }
  | { mode: 'share-key'; realm: string; reason?: string }
  | {
      mode: 'swap-key' | 'share-limits';
      realm: string;
      share: string;
      reason?: string;
    }
  | {
      mode: 'connect';
      target?: SecureWindowTarget;
      realm?: string;
      reason?: string;
    }
  | {
      mode: 'approve' | 'review-changes';
      target: SecureWindowTarget;
      reason?: string;
    };

// The popup's size: the page area below the address bar. At this size the key
// page shows a key with its shared workspaces, approvals and actions without
// scrolling, and the share page lays a key's name and its fields out on one
// line. On a shorter screen the browser fits the window to the screen.
export const SECURE_WINDOW_FEATURES = 'popup,width=940,height=1100';

// Whether `value` can name a realm, card or module to the window: an http(s)
// URL, or a prefix-form id (`@cardstack/…`). The window reads nothing else.
export function isSecureWindowName(value: string): boolean {
  if (value.startsWith('@')) {
    return true;
  }
  try {
    let { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

// The window's address: the page for the mode, with what it is for in the
// fragment. They are URLs, which a firewall in front of a deployment may
// refuse in a query string, and a fragment never leaves the browser.
export function secureWindowURL(request: SecureWindowRequest): string {
  let fragment: Record<string, string> = {};
  if (request.mode === 'share-key') {
    fragment.realm = request.realm;
  } else if (request.mode === 'swap-key' || request.mode === 'share-limits') {
    fragment.realm = request.realm;
    fragment.share = request.share;
  } else {
    let target = 'target' in request ? request.target : undefined;
    if (target?.kind === 'instance') {
      fragment.card = target.card;
    } else if (target?.kind === 'type') {
      fragment.module = target.module;
      fragment.name = target.name;
      fragment.realm = target.realm;
    } else if (request.mode === 'connect' && request.realm) {
      fragment.realm = request.realm;
    }
    if (target?.operation) {
      fragment.operation = target.operation;
    }
  }
  if (request.reason) {
    fragment.reason = request.reason;
  }
  return withFragment(pageURL(request.mode), fragment);
}
