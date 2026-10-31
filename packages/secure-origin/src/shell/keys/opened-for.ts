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
//   #key=<key id>, for a share of one of the user's keys
//   #reconnect=<key id>, for signing one of the user's connections in again
//
// A realm, card or module is a URL or a prefix-form id (`@cardstack/…`);
// which it names is the realm server's to decide.

import { cliCallback } from '../../security/cli-handoff.js';
import { keyOfSharePath } from '../pages.js';
import { currentPage } from '../urls.js';

export type OpenedForTarget =
  | { kind: 'instance'; url: string }
  | { kind: 'type'; module: string; name: string; realm: string };

export interface OpenedFor {
  realm?: string;
  key?: string;
  share?: string;
  reconnect?: string;
  target?: OpenedForTarget;
  operation?: string;
  reason?: string;
}

export const MAX_REASON_LENGTH = 200;

// Whether this page goes back to the key page when it is done, rather than
// closing the window: a page beneath the key page's path, reached from it.
export function returnsToKeyPage(page: string = currentPage()) {
  return page.startsWith('keys/');
}

// What a share page was opened for: the key it shares is the one its path
// names (`keys/<key id>/share`, as the router passes it, or else as the
// address reads) or, on the `share-key` page, the one its fragment names.
export function openedForShare(
  keyId: string | undefined = keyOfSharePath(currentPage()),
  hash: string = window.location.hash,
): OpenedFor {
  let opened = openedFor(hash);
  return keyId ? { ...opened, key: keyId } : opened;
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
// Invisible format characters are dropped, bidi controls among them, so a
// reason can't reorder how it reads or hide text in it. The two joiners stay:
// they hold emoji sequences together and shape Persian and Indic text.
const FORMAT_BUT_JOINERS = /(?![\u200C\u200D])\p{Cf}/gu;

function reasonOf(value: string | null): string | undefined {
  let text = value
    ?.replace(FORMAT_BUT_JOINERS, '')
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
  let reconnect = params.get('reconnect');
  if (reconnect) {
    result.reconnect = reconnect;
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

// The CLI listener a page was opened for (`#cli_port=…&cli_state=…`), which
// it tells when the change it was opened for is made, and for an approval
// the operations the CLI asked to approve (`#operations=<name>,…`).
export function cliOpenedFor(hash: string = window.location.hash) {
  let fragment = new URLSearchParams(hash.replace(/^#/, ''));
  let cli = fragment.has('cli_port')
    ? cliCallback(
        new URLSearchParams({
          port: fragment.get('cli_port') ?? '',
          state: fragment.get('cli_state') ?? '',
        }),
        { profile: false },
      )
    : undefined;
  let named = fragment.get('operations');
  return {
    cli,
    operations: named ? new Set(named.split(',').filter(Boolean)) : undefined,
  };
}
