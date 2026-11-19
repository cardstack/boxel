// `hrefTo`: the URL for a link in a card template.
//
//   <a href={{hrefTo @model.author}}>…</a>
//
// A realm served at a host URL can route paths such as `/posts/:slug` to its
// cards. `hrefTo` gives the address the realm's routes serve the target at,
// so a template never spells a route's path, and the same template works in
// a realm with other routes or with none.
//
// A link says what it points to in one of three ways:
//
// - A card or a card id: `{{hrefTo @model.author}}`, `{{hrefTo row.id}}`.
//   A plain string is a card id. A nested route takes one card or id per
//   dynamic level, outermost first (`{{hrefTo category product}}`), or just
//   the innermost card when it links to its parent.
//   When no route fits, the link gets the card's own URL.
// - A card type and the values of the fields a route matches:
//   `{{hrefTo Tag name="crag"}}`. No card is loaded or checked.
// - A route name, as a named argument, and one card or value per dynamic
//   level: `{{hrefTo route="people" person}}`. Only a site's own cards
//   should name routes; a card type that other realms use should not.
//   For these two forms, when no route fits, the result is `undefined`, so
//   the `<a>` renders with no `href`.
//
// A routed address opens only where a host URL serves the realm. So a link
// gets one on a page served on a host URL and in the HTML stored for a realm
// that a host URL serves. Everywhere else, which includes the app, a link
// falls back as when no route fits.
//
// The address is on the realm's own URL. A link into another realm keeps
// that card's own URL. While a card the routes read is still loading, the
// link has the card's own URL, and it changes when the card arrives. An
// empty argument (a link that is empty or not loaded yet) gives `undefined`.
//
// A link never fails the render because of what it points to. One failure
// does pass through: in an HTML visit for a realm that a host URL serves,
// when the realm's routes can't be read for now, the visit fails with an error that makes it run again, so that
// HTML with card URLs in place of routed addresses is never stored.

import {
  getHostRouteLinks,
  isBaseDef,
  isBaseDefInstance,
  type HostRouteAddressTarget,
} from '@cardstack/runtime-common';
import {
  getCardMeta,
  getQueryableValue,
  formatQueryValue,
  isNonPresentLink,
  isQueryTaintedField,
  peekAtField,
  primitive,
  type BaseDef,
  type CardDef,
} from './card-api';

// What a positional argument may be. `null` and `undefined` are accepted so
// that a template can pass a link that is empty or still loading.
export type HrefToArgument =
  | BaseDef
  | typeof BaseDef
  | string
  | number
  | null
  | undefined;

// The named arguments: `route`, or the field values for a card type.
export interface HrefToNamed {
  route?: string;
  [field: string]: unknown;
}

const API = {
  getQueryableValue,
  formatQueryValue,
  peekAtField,
  isQueryTaintedField,
  isNonPresentLink,
  getCardMeta: getCardMeta as (
    card: BaseDef,
    metaKey: 'lastModified' | 'resourceCreatedAt',
  ) => any,
  primitive,
};

// Glimmer calls a function used as a helper with the positional arguments,
// then the named arguments as one last object when there are any.
export function hrefTo(
  ...args: [...HrefToArgument[], HrefToNamed] | HrefToArgument[]
): string | undefined {
  let target: HostRouteAddressTarget | undefined;
  try {
    let named: HrefToNamed = {};
    let positional = args as unknown[];
    let last = positional[positional.length - 1];
    if (isNamedArguments(last)) {
      named = last;
      positional = positional.slice(0, -1);
    }
    target = linkTarget(positional, named);
  } catch {
    return undefined;
  }
  if (!target) {
    return undefined;
  }
  let links = getHostRouteLinks();
  if (!links) {
    // No app to ask, so no routes: a card link keeps the card's id.
    return target.kind === 'cards' ? lastCardId(target.cards) : undefined;
  }
  // The app's answer is not caught: see the note on failing the render in
  // the header.
  return links.link(target, API);
}

function linkTarget(
  positional: unknown[],
  named: HrefToNamed,
): HostRouteAddressTarget | undefined {
  if (typeof named.route === 'string') {
    if (!positional.every(isRouteArgument)) {
      return undefined;
    }
    return { kind: 'route-name', name: named.route, args: positional };
  }
  let [first] = positional;
  if (isBaseDef(first)) {
    if (positional.length !== 1) {
      return undefined;
    }
    let { route: _route, ...values } = named;
    return { kind: 'type', type: first, values };
  }
  if (positional.length === 0 || !positional.every(isCardOrId)) {
    return undefined;
  }
  return { kind: 'cards', cards: positional };
}

function isNamedArguments(value: unknown): value is HrefToNamed {
  if (value === null || typeof value !== 'object' || isBaseDefInstance(value)) {
    return false;
  }
  let proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function isCardOrId(value: unknown): value is BaseDef | string {
  return (
    (typeof value === 'string' && value !== '') || isBaseDefInstance(value)
  );
}

function isRouteArgument(value: unknown): value is BaseDef | string | number {
  return typeof value === 'number' || isCardOrId(value);
}

function lastCardId(cards: readonly (BaseDef | string)[]): string | undefined {
  let card = cards[cards.length - 1];
  let id = typeof card === 'string' ? card : (card as CardDef | undefined)?.id;
  return typeof id === 'string' && id ? id : undefined;
}
