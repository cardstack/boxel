// The URL a link in a card template gets: what the `hrefTo` helper gives.
//
// It wraps the reverse lookup `hostRouteAddress` with the rules of a link:
//
// - The address is the routed path on the realm's own URL. A host URL takes
//   the realm URL's place where a response leaves the server, never here.
// - A link given cards or ids falls back to the card's own URL when no route
//   gives it an address: the realm has no routes, the render has none to
//   use, the card is in another realm, or no route fits.
// - A link given a card type with field values, or a route name, has no card
//   to fall back to, so it gives `undefined` and renders with no `href`.
// - When a route can't tell yet whether the cards fit it, because a card or
//   a value isn't loaded, the link asks for what the route reads and gives
//   the fallback until it arrives. A given id is asked from `loadedCard`;
//   a link on a loaded card is read as a template reads it, which starts
//   its lazy load. The caller renders again when a load lands.
//
// It is synchronous and never throws.

import type { BaseDef, CardDef } from '@cardstack/base/card-api';
import {
  hostRouteAddress,
  isUndecidedHostRouteReason,
  type HostRouteAddressTarget,
  type HostRouteNoAddressReason,
} from './host-route-address.ts';
import type { HostRoute } from './host-routes.ts';
import type { CardAPIForMatching } from './instance-filter-matcher.ts';
import type { Filter } from './query.ts';

// The validated routes of the realm a render is for.
export interface HostRouteLinkRoutes {
  // The URL the realm is served at, ending with `/`.
  realmURL: URL;
  routes: readonly HostRoute[];
}

// A link that got no routed address, for the record of links that don't
// resolve.
export interface UnresolvedHostRouteLink {
  form: HostRouteAddressTarget['kind'];
  // What the link points to: the card ids, the type's name, or the route
  // name.
  target: string;
  reason: HostRouteNoAddressReason;
  // The full path of the route the reason is about, when there is one.
  routePath?: string;
  // The URL of the realm whose routes were read.
  realmURL: string;
}

export interface HostRouteLinkOptions {
  // `undefined` when the render has no routes to give addresses from: no
  // host URL serves the realm, the render is in the app, or none were read
  // yet. Links then fall back as for a realm with no routes.
  routes: HostRouteLinkRoutes | undefined;
  api: CardAPIForMatching;
  // The loaded card for an id, or `undefined` when it isn't loaded. It asks
  // the store to load a card that isn't, so a later call returns it.
  loadedCard?: (id: string) => BaseDef | undefined;
  // Called for each link that gets no routed address from routes that are
  // known, except a link that is still waiting for a load, a link into
  // another realm, and a link to a card with no id.
  unresolved?: (link: UnresolvedHostRouteLink) => void;
}

// A link asks for missing cards at most this many times in one call, one
// per dynamic level of the deepest route it could fill.
const MAX_LOAD_ROUNDS = 8;

export function hostRouteLink(
  target: HostRouteAddressTarget,
  options: HostRouteLinkOptions,
): string | undefined {
  try {
    return link(target, options);
  } catch {
    try {
      return fallbackURL(target, options.api);
    } catch {
      return undefined;
    }
  }
}

function link(
  target: HostRouteAddressTarget,
  options: HostRouteLinkOptions,
): string | undefined {
  let { routes, api } = options;
  let fallback = fallbackURL(target, api);
  if (!routes) {
    return fallback;
  }
  let lookup = { routes: routes.routes, realmURL: routes.realmURL, api };
  let result = hostRouteAddress(target, lookup);
  // An id where a route needs the card: use the loaded card when the store
  // has it, which also asks the store for one it doesn't have.
  for (
    let round = 0;
    round < MAX_LOAD_ROUNDS &&
    !result.ok &&
    isUndecidedHostRouteReason(result.reason);
    round++
  ) {
    let next = withLoadedCards(target, options);
    if (!next) {
      break;
    }
    target = next;
    result = hostRouteAddress(target, lookup);
  }
  if (result.ok) {
    return routes.realmURL.href + result.address.replace(/^\//, '');
  }
  if (isUndecidedHostRouteReason(result.reason)) {
    if (result.route) {
      askForWhatRouteReads(result.route, target, options);
    }
    return fallback;
  }
  if (
    options.unresolved &&
    result.reason !== 'other-realm' &&
    result.reason !== 'card-without-id' &&
    // A realm with no routes keeps card URLs; a card link there is not a
    // link that failed.
    !(target.kind === 'cards' && routes.routes.length === 0)
  ) {
    options.unresolved({
      form: target.kind,
      target: describe(target),
      reason: result.reason,
      ...(result.route ? { routePath: result.route.fullPath } : {}),
      realmURL: routes.realmURL.href,
    });
  }
  return fallback;
}

// The card's own URL for a link given cards or ids: the URL of the last
// one, which is the card the link opens. `undefined` for the other forms,
// and for a card with no id.
function fallbackURL(
  target: HostRouteAddressTarget,
  api: CardAPIForMatching,
): string | undefined {
  if (target.kind !== 'cards' || target.cards.length === 0) {
    return undefined;
  }
  let card = target.cards[target.cards.length - 1]!;
  let id = typeof card === 'string' ? card : (card as CardDef).id;
  if (typeof id !== 'string' || !id) {
    return undefined;
  }
  try {
    return api.virtualNetwork.toURL(id).href;
  } catch {
    return id;
  }
}

// The target with each id replaced by its loaded card, or `undefined` when
// that changes nothing. Only the cards form holds ids: a string in the
// route-name form is a segment value.
function withLoadedCards(
  target: HostRouteAddressTarget,
  options: HostRouteLinkOptions,
): HostRouteAddressTarget | undefined {
  if (target.kind !== 'cards' || !options.loadedCard) {
    return undefined;
  }
  let changed = false;
  let cards = target.cards.map((card) => {
    if (typeof card !== 'string') {
      return card;
    }
    let loaded = options.loadedCard!(card);
    if (loaded) {
      changed = true;
      return loaded;
    }
    return card;
  });
  return changed ? { kind: 'cards', cards } : undefined;
}

// Reads what the route's chain reads from the given cards, as a template
// reads a field: reading a link that isn't loaded starts its lazy load
// through the card's store, so the render waits for it and the prerender
// records the linked card as a dependency.
function askForWhatRouteReads(
  route: HostRoute,
  target: HostRouteAddressTarget,
  options: HostRouteLinkOptions,
): void {
  let chain = chainTo(options.routes!.routes, route);
  if (!chain) {
    return;
  }
  let levels = chain.filter(
    (level) => level.kind === 'card-id' || level.kind === 'field-match',
  );
  let args: readonly unknown[] =
    target.kind === 'cards'
      ? target.cards
      : target.kind === 'route-name'
        ? target.args
        : [];
  let given = levels.map((_, i) =>
    args.length === levels.length
      ? args[i]
      : i === levels.length - 1
        ? args[0]
        : undefined,
  );
  let fromChild: unknown;
  for (let i = levels.length - 1; i >= 0; i--) {
    let level = levels[i]!;
    let card = given[i] ?? fromChild;
    fromChild = undefined;
    if (typeof card === 'string' && target.kind === 'cards') {
      card = options.loadedCard?.(card);
    }
    if (card == null || typeof card !== 'object') {
      continue;
    }
    if (level.kind === 'field-match') {
      for (let { field } of level.match) {
        readPath(card, field);
      }
      if (level.where) {
        for (let path of filterPaths(level.where)) {
          readPath(card, path);
        }
      }
    }
    let parentLink = level.parentLink;
    if (parentLink && parentLink.side !== 'parent') {
      let parent = readPath(card, parentLink.field);
      fromChild = Array.isArray(parent) ? parent[0] : parent;
    }
  }
}

function chainTo(
  routes: readonly HostRoute[],
  route: HostRoute,
  above: readonly HostRoute[] = [],
): readonly HostRoute[] | undefined {
  for (let candidate of routes) {
    let chain = [...above, candidate];
    if (candidate === route) {
      return chain;
    }
    let found = chainTo(candidate.routes, route, chain);
    if (found) {
      return found;
    }
  }
  return undefined;
}

// Reads a dotted path with ordinary property reads. Stops where a step has
// no object to read from, which is where a link is still loading.
function readPath(card: unknown, path: string): unknown {
  let node = card;
  try {
    for (let name of path.split('.')) {
      if (node == null || typeof node !== 'object' || Array.isArray(node)) {
        return undefined;
      }
      node = (node as Record<string, unknown>)[name];
    }
  } catch {
    return undefined;
  }
  return node;
}

// The field paths a filter reads.
function filterPaths(filter: Filter): string[] {
  let paths: string[] = [];
  let node = filter as unknown as Record<string, unknown>;
  for (let key of ['any', 'every'] as const) {
    if (Array.isArray(node[key])) {
      for (let child of node[key] as Filter[]) {
        paths.push(...filterPaths(child));
      }
    }
  }
  if (node.not && typeof node.not === 'object') {
    paths.push(...filterPaths(node.not as Filter));
  }
  for (let key of ['eq', 'in', 'contains', 'range'] as const) {
    let fields = node[key];
    if (fields && typeof fields === 'object') {
      paths.push(...Object.keys(fields));
    }
  }
  return paths;
}

function describe(target: HostRouteAddressTarget): string {
  switch (target.kind) {
    case 'cards':
      return target.cards
        .map((card) =>
          typeof card === 'string' ? card : ((card as CardDef).id ?? '(no id)'),
        )
        .join(', ');
    case 'type':
      return `${target.type.name} (${Object.keys(target.values).join(', ')})`;
    case 'route-name':
      return target.name;
  }
}

// What gives links their URLs in the app this code runs in. The `hrefTo`
// helper is card code: it has no service to inject, so the host app's
// service registers itself on a global, and the helper reads it back here.
// Nothing is registered outside a host app, such as in a realm server.
export interface HostRouteLinks {
  // The URL for a link, from the routes of the realm the render is for.
  // `api` is the card API of the caller's own loader, without the virtual
  // network, which the app supplies.
  link(
    target: HostRouteAddressTarget,
    api: Omit<CardAPIForMatching, 'virtualNetwork'>,
  ): string | undefined;
}

const HOST_ROUTE_LINKS_GLOBAL = '_CARDSTACK_HOST_ROUTE_LINKS';

export function getHostRouteLinks(): HostRouteLinks | undefined {
  return (globalThis as Record<string, unknown>)[HOST_ROUTE_LINKS_GLOBAL] as
    | HostRouteLinks
    | undefined;
}

// Registers `links` and returns a function that removes it, unless another
// one was registered since.
export function registerHostRouteLinks(links: HostRouteLinks): () => void {
  let globals = globalThis as Record<string, unknown>;
  globals[HOST_ROUTE_LINKS_GLOBAL] = links;
  return () => {
    if (globals[HOST_ROUTE_LINKS_GLOBAL] === links) {
      delete globals[HOST_ROUTE_LINKS_GLOBAL];
    }
  };
}
