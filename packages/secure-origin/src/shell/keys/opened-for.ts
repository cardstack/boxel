// What a key page was opened for, read from its address's fragment: a realm
// and share, a card or type, an operation on it, and a one-line reason. These
// name things and say nothing about them. The page asks the realm server what
// each one is (`windowContext`), so nothing it shows of a realm, card or
// operation comes from the page that opened it. The reason is the one thing
// shown as given, as that page's own words.
//
// They ride in the fragment, not the query: they are URLs, which a firewall in
// front of a deployment may refuse in a query string, and the fragment never
// leaves the browser.
//
//   #realm=<realm URL>&share=<share id>
//   #card=<card URL>&operation=<name>
//   #module=<module URL>&name=<export>&realm=<realm URL>&operation=<name>
//   …&reason=<text>
//   #key=<key id>, for a share started from the key page
//
// A realm, card or module is a URL or a prefix-form id (`@cardstack/…`);
// which it names is the realm server's to decide.

export type OpenedForTarget =
  | { kind: 'instance'; url: string }
  | { kind: 'type'; module: string; name: string; realm: string };

export interface OpenedFor {
  realm?: string;
  key?: string;
  share?: string;
  target?: OpenedForTarget;
  operation?: string;
  reason?: string;
}

export const MAX_REASON_LENGTH = 200;

// A query parameter naming the key page to go back to once a key is added,
// for an enter-key page reached from it rather than opened for something. A
// plain value, never a URL.
export const RETURN_PARAM = 'then';

// Whether this page goes back to the key page when it is done, rather than
// closing the window.
export function returnsToKeyPage(search: string = window.location.search) {
  return new URLSearchParams(search).get(RETURN_PARAM) === 'keys';
}

// A name for a realm, card or module: an http(s) URL, or a prefix-form id.
function url(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith('@')) {
    return value;
  }
  try {
    let parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

// A reason is shown as plain text, on one line, and no longer than a line.
// Format characters (bidi overrides and isolates among them) are dropped, so
// a reason can't reorder how it reads.
function reasonOf(value: string | null): string | undefined {
  let text = value
    ?.replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return undefined;
  }
  let chars = [...text];
  return chars.length > MAX_REASON_LENGTH
    ? `${chars.slice(0, MAX_REASON_LENGTH - 1).join('')}…`
    : text;
}

export function openedFor(hash: string = window.location.hash): OpenedFor {
  let params = new URLSearchParams(hash.replace(/^#/, ''));
  let realm = url(params.get('realm'));
  let card = url(params.get('card'));
  let module = url(params.get('module'));
  let name = params.get('name') || undefined;
  let target: OpenedForTarget | undefined;
  if (card) {
    target = { kind: 'instance', url: card };
  } else if (module && name && realm) {
    target = { kind: 'type', module, name, realm };
  }
  let result: OpenedFor = {};
  if (realm) {
    result.realm = realm;
  }
  let share = params.get('share');
  if (share) {
    result.share = share;
  }
  let key = params.get('key');
  if (key) {
    result.key = key;
  }
  if (target) {
    result.target = target;
    let operation = params.get('operation');
    if (operation) {
      result.operation = operation;
    }
  }
  let reason = reasonOf(params.get('reason'));
  if (reason) {
    result.reason = reason;
  }
  return result;
}

// The request the realm server answers about this page: its target and
// operation, or else its realm.
export function contextRequest(opened: OpenedFor) {
  if (opened.target) {
    return {
      target: opened.target,
      ...(opened.operation ? { operation: opened.operation } : {}),
    };
  }
  return opened.realm ? { realm: opened.realm } : undefined;
}
