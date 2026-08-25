/**
 * The reduced projection of a browser event that may reach an authored
 * handler, and the allowlists that define it.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

import type { Cloneable } from './cloneable.ts';
import { readMember } from './untrusted-input.ts';
import type { ProtocolEnvelope } from './version.ts';

/**
 * The event members that may cross into an authored handler, grouped by the
 * scalar type each one projects to.
 *
 * These arrays are the allowlist itself, not a copy of one: the `SafeEvent`
 * type is derived from them, so a member added to the type and a member
 * admitted at runtime cannot drift apart. Grouping by type is what lets the
 * projection admit `clientX: 42` and refuse `clientX: '42'` — one flat list
 * would type every projected member as `string | number | boolean | null`
 * and accept any scalar in any slot.
 */
export const SAFE_EVENT_BOOLEAN_PROPERTIES = [
  'altKey',
  'ctrlKey',
  'isPrimary',
  'metaKey',
  'repeat',
  'shiftKey',
] as const;

export const SAFE_EVENT_NUMBER_PROPERTIES = [
  'button',
  'buttons',
  'clientX',
  'clientY',
  'deltaMode',
  'deltaX',
  'deltaY',
  'pageX',
  'pageY',
  'pointerId',
  'screenX',
  'screenY',
] as const;

export const SAFE_EVENT_STRING_PROPERTIES = [
  'code',
  'inputType',
  'key',
  'pointerType',
] as const;

export const SAFE_EVENT_NULLABLE_STRING_PROPERTIES = ['data'] as const;

/** The same allowlist discipline for the element an event came from. */
export const SAFE_EVENT_TARGET_BOOLEAN_PROPERTIES = ['checked'] as const;

export const SAFE_EVENT_TARGET_NUMBER_PROPERTIES = ['selectedIndex'] as const;

export const SAFE_EVENT_TARGET_STRING_PROPERTIES = [
  'id',
  'name',
  'type',
] as const;

export const SAFE_EVENT_TARGET_SCALAR_PROPERTIES = ['value'] as const;

/**
 * What an event's target reduces to. The live `Element` never crosses: a
 * handler receives the element's tag name, its allowlisted scalar members,
 * and its string dataset — no parent, no children, no methods, and no way
 * back to the document.
 */
export type SafeEventTarget = Cloneable<
  {
    tagName: string;
    /**
     * The `data-*` attributes the card's own author wrote — see
     * `projectDataset`, which is how a projection produces this member, and
     * why it takes the author's key set rather than guessing at the Host's.
     */
    dataset?: Record<string, string>;
  } & {
    [K in (typeof SAFE_EVENT_TARGET_BOOLEAN_PROPERTIES)[number]]?: boolean;
  } & {
    [K in (typeof SAFE_EVENT_TARGET_NUMBER_PROPERTIES)[number]]?: number;
  } & {
    [K in (typeof SAFE_EVENT_TARGET_STRING_PROPERTIES)[number]]?: string;
  } & {
    [K in (typeof SAFE_EVENT_TARGET_SCALAR_PROPERTIES)[number]]?:
      | string
      | number
      | boolean;
  }
>;

/**
 * What a browser event reduces to before it reaches an authored handler.
 *
 * The required members are the ones every event has. The optional ones are
 * present when the source event carried a value of the right type for that
 * member — a click has no `key`, and its `SafeEvent` has none either. Nothing
 * here can be used to reach the page: no `preventDefault`, no `stopPropagation`,
 * no `view`, no `relatedTarget`, no `path`.
 */
export type SafeEvent = Cloneable<
  ProtocolEnvelope & {
    type: string;
    bubbles: boolean;
    cancelable: boolean;
    composed: boolean;
    defaultPrevented: boolean;
    target: SafeEventTarget | null;
    currentTarget: SafeEventTarget | null;
  } & {
    [K in (typeof SAFE_EVENT_BOOLEAN_PROPERTIES)[number]]?: boolean;
  } & {
    [K in (typeof SAFE_EVENT_NUMBER_PROPERTIES)[number]]?: number;
  } & {
    [K in (typeof SAFE_EVENT_STRING_PROPERTIES)[number]]?: string;
  } & {
    [K in (typeof SAFE_EVENT_NULLABLE_STRING_PROPERTIES)[number]]?:
      | string
      | null;
  }
>;

/**
 * Converts authored attribute names into the keys a `DOMStringMap` exposes.
 *
 * A template's wire data holds what the author wrote — `data-row-index` — and
 * `element.dataset` answers to `rowIndex`. Only a `-` before an ASCII lower
 * alpha folds, matching the HTML rule: `data-item-2` reads back as `item-2`,
 * not `item2`, and converting it wrongly drops the member silently. Without the conversion an allowlist
 * built from the template matches nothing and silently drops every one of the
 * author's own attributes, which fails closed but looks like data loss.
 * Non-`data-` attributes are ignored, so a whole attribute list can be passed.
 *
 * Pure string work, so it lives beside the allowlist it feeds rather than in
 * the adapter that will call it.
 */
export function datasetKeysFor(attributeNames: Iterable<string>): string[] {
  let keys: string[] = [];
  for (let name of attributeNames) {
    if (!name.startsWith('data-')) {
      continue;
    }
    keys.push(
      name
        .slice('data-'.length)
        .replace(/-([a-z])/g, (_, character: string) =>
          character.toUpperCase(),
        ),
    );
  }
  return keys;
}

/**
 * The dataset an event target may hand an authored handler: the author's own
 * `data-*` attributes, and nothing else.
 *
 * An allowlist, supplied by the caller, because a denylist cannot work here.
 * Base stamps identity into this namespace under several unrelated spellings
 * — `data-boxel-card-id`, `data-test-card` and `data-cards-grid-item` each
 * carry a card's canonical URL, the last one specifically because the
 * `data-test-` spelling is pruned in production — across hundreds of `data-*`
 * attributes in many first-segment namespaces. Every list of "the Host's
 * prefixes" is a list that is one Base commit from being wrong, and being
 * wrong means an authored handler is handed the identity of a card it holds
 * only a reference to.
 *
 * The element an event lands on is frequently Host chrome the author never
 * wrote, so the question is not what the key is called but who wrote it. Only
 * the caller knows: a rebuilt template's own wire data names the attributes
 * its author declared. Pass those; everything else stays behind.
 *
 * A pure string function, so it lives here with the shape it guards rather
 * than with the projection: it needs no `Event`, no `Element`, and no DOM.
 */
/**
 * Namespaces Base stamps its own identity into, vetoed even when an author
 * declares the name.
 *
 * The allowlist is the primary rule and this is defence in depth, because the
 * allowlist can only ask what a key is CALLED. An author who writes
 * `data-boxel-card-id` once in their own template would otherwise be handed
 * that key from every Host container an event later lands on — opting
 * themselves into the Host's identity by choosing a name. Incomplete by
 * construction, which is why it is the second rule and not the first.
 */
const hostOwnedDatasetKey = /^(?:boxel|test|card|cards)(?:[A-Z]|$)/;

function isHostOwnedDatasetKey(key: string): boolean {
  return hostOwnedDatasetKey.test(key);
}

export function projectDataset(
  dataset: Record<string, string | undefined>,
  authoredKeys: Iterable<string>,
): Record<string, string> {
  let authored = new Set(authoredKeys);
  // Null prototype: a `__proto__` key would otherwise be swallowed by an
  // ordinary object literal, or set the result's prototype outright.
  let projected: Record<string, string> = Object.create(null);
  for (let key of Object.getOwnPropertyNames(dataset)) {
    if (authored.has(key) && !isHostOwnedDatasetKey(key)) {
      let value = readMember(dataset, key);
      if (typeof value === 'string') {
        projected[key] = value;
      }
    }
  }
  return projected;
}
