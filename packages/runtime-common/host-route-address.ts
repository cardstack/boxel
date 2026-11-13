// The reverse lookup of host routes: from what a link points to, to the
// address a host URL serves it at.
//
// It is synchronous and pure. It reads only cards the caller already holds,
// and the values on them: it never loads a card, never searches, and never
// follows a link to a card that isn't loaded (a link that isn't loaded still
// gives its target's id, which is enough where an id is enough). So the
// prerender and the browser give the same address for the same loaded cards.
//
// A link names its target in one of three ways:
//
// - Cards or ids, one per dynamic level of the route (`{{hrefTo post}}`,
//   `{{hrefTo category product}}`, `{{hrefTo row.id}}`). Every route that
//   fits is a candidate, and the canonical one wins: the first in
//   depth-first authored order, a route's children before its later
//   siblings, never a route with `statusCode: 301`. A fixed card route is a
//   candidate for its own card, with no levels.
//   A route that can't tell yet whether the cards fit it, because a card or
//   a value it reads isn't loaded, ends the search with its reason: a later
//   route's address would not be the canonical one.
// - A card type and field values (`{{hrefTo Tag name="crag"}}`): the
//   canonical field-match route on that type, or one it descends from,
//   whose `match` fields are exactly the given ones. No card is checked
//   against the route's `where`.
// - A route name and arguments (`{{hrefTo "people" person}}`): that route,
//   whatever its kind. Each argument fills the next dynamic level: a card or
//   id fills its level as above, and a string or number fills one segment
//   as is (it is a value, never an id).
//
// The address is the path from the realm root (`/posts/hello-world`), each
// segment encoded with the canonical encoding of `fillRoutePathPattern`.
// Putting a host URL's prefix in front of it is the caller's job.

import type { BaseDef, CardDef } from '@cardstack/base/card-api';
import { getField, identifyCard, canonicalModuleKey } from './code-ref.ts';
import type { CodeRef } from './code-ref.ts';
import type {
  HostCardIdRoute,
  HostFieldMatchRoute,
  HostRoute,
  HostRouteParentLink,
} from './host-routes.ts';
import {
  matchInstanceAgainstFilter,
  type CardAPIForMatching,
} from './instance-filter-matcher.ts';
import { RealmPaths } from './paths.ts';
import { resolveRRIReference, rri } from './realm-identifiers.ts';
import { trimJsonExtension } from './url.ts';
import {
  fillRoutePathPattern,
  matchCardIdPattern,
  type RouteParams,
} from './route-pattern.ts';

// A loaded card, or a card's id: an identifier in prefix or URL form, as
// `CardDef.id` holds it, which the lookup resolves to the served URL itself.
export type HostRouteCardRef = BaseDef | string;

// What a link points to.
export type HostRouteAddressTarget =
  // Cards or ids, one per dynamic level of the route, outermost first. One
  // card for a nested route fills its parent levels from the card's links
  // to them.
  | { kind: 'cards'; cards: readonly HostRouteCardRef[] }
  // A card type (a card class) and the values of the fields a field-match
  // route matches, by field name as the route's `match` spells it.
  | {
      kind: 'type';
      type: typeof BaseDef;
      values: Readonly<Record<string, unknown>>;
    }
  // A route by `name`, with one argument per dynamic level. A card or id
  // fills its level's segments; a string or number fills one segment. A
  // redirect resolves no card, so it takes one value per `:name` in its
  // full path instead, its parents' included.
  | {
      kind: 'route-name';
      name: string;
      args: readonly (BaseDef | string | number)[];
    };

export interface HostRouteAddressOptions {
  // The validated routes (`Realm.getHostRoutes()`).
  routes: readonly HostRoute[];
  // The URL the realm is served at, ending with `/`. Cards outside it get no
  // address.
  realmURL: URL;
  // The card API, for the type and `where` checks and for reading fields.
  // Its virtual network resolves card ids, which may be in prefix form.
  api: CardAPIForMatching;
}

export type HostRouteNoAddressReason =
  // No route fits: no route takes cards of this type or ids of this shape,
  // no route has the name, or no field-match route is on the type with
  // these fields.
  | 'no-route'
  // The card is in another realm. Routes apply only inside their realm.
  | 'other-realm'
  // A card that has no id yet.
  | 'card-without-id'
  // The card fails the route's `where`.
  | 'where-not-matched'
  // The card's `where` check needs a value that isn't loaded.
  | 'where-unresolvable'
  // A value for a segment that isn't a valid segment: not a non-empty
  // string or a finite number, or `.` or `..`.
  | 'invalid-segment-value'
  // A field-match level was given only an id. It gets an address once the
  // card is loaded.
  | 'card-not-loaded'
  // A field a field-match route reads goes through a link that isn't
  // loaded.
  | 'value-not-loaded'
  // A parent level comes from the child card's link to it, and the child
  // card, or the parent card the link points to, isn't loaded where the
  // parent's route needs it.
  | 'parent-not-loaded'
  // A parent level would come from the child card's link to it, but only
  // the parent's card holds the link.
  | 'parent-holds-link'
  // A parent level would come from the child card's link to it, and the
  // link is empty.
  | 'no-parent'
  // A parent level would come from the child's card id, and the route's
  // card id template doesn't hold all of the parent's values.
  | 'parent-not-in-id'
  // Two given cards don't belong together through the child route's link.
  | 'not-member'
  // The number of arguments doesn't fit the route.
  | 'wrong-argument-count'
  // The lookup threw. `error` on the result holds what it threw.
  | 'internal-error';

export type HostRouteAddressResult =
  | {
      ok: true;
      // The path from the realm root, canonically encoded.
      address: string;
      // The route that gave the address.
      route: HostRoute;
    }
  | {
      ok: false;
      reason: HostRouteNoAddressReason;
      // The route the reason is about, when there is one.
      route?: HostRoute;
      // What the lookup threw, for `internal-error`.
      error?: unknown;
    };

/**
 * Works out the address a host URL serves a link's target at, or the reason
 * it has none. Synchronous; reads only the given cards and the values
 * already loaded on them. Never throws.
 */
export function hostRouteAddress(
  target: HostRouteAddressTarget,
  options: HostRouteAddressOptions,
): HostRouteAddressResult {
  let lookup = new Lookup(options);
  try {
    switch (target.kind) {
      case 'cards':
        return lookup.forCards(target.cards);
      case 'type':
        return lookup.forType(target.type, target.values);
      case 'route-name':
        return lookup.forName(target.name, target.args);
    }
  } catch (error) {
    return { ok: false, reason: 'internal-error', error };
  }
}

type DynamicRoute = HostCardIdRoute | HostFieldMatchRoute;

// The reasons that mean a route can't tell yet whether the input fits it,
// because a card or a value it needs isn't loaded.
const UNDECIDED: ReadonlySet<HostRouteNoAddressReason> = new Set([
  'card-not-loaded',
  'value-not-loaded',
  'parent-not-loaded',
  'where-unresolvable',
]);

// A step of a route's chain from the top level down to the route.
type Chain = readonly HostRoute[];

// Why one candidate route gave no address. `fits` is false when the
// candidate simply doesn't take the input (an id that doesn't fit its
// pattern, a card of another type), so another route's reason is more
// telling.
interface Miss {
  reason: HostRouteNoAddressReason;
  route: HostRoute;
  fits: boolean;
}

class Lookup {
  private options: HostRouteAddressOptions;
  private realmPaths: RealmPaths;

  constructor(options: HostRouteAddressOptions) {
    this.options = options;
    this.realmPaths = new RealmPaths(options.realmURL);
  }

  forCards(cards: readonly HostRouteCardRef[]): HostRouteAddressResult {
    if (cards.length === 0) {
      return { ok: false, reason: 'wrong-argument-count' };
    }
    for (let card of cards) {
      let id = cardId(card);
      if (id === undefined) {
        return { ok: false, reason: 'card-without-id' };
      }
      if (!this.inRealm(id)) {
        return { ok: false, reason: 'other-realm' };
      }
    }
    let misses: Miss[] = [];
    for (let chain of indexOf(this.options.routes).chains) {
      let route = chain[chain.length - 1]!;
      if (route.kind === 'redirect') {
        continue;
      }
      if (route.kind === 'fixed-card') {
        if (
          cards.length === 1 &&
          this.sameId(cardId(cards[0]!), route.cardHref)
        ) {
          let address = fixedChainAddress(chain);
          if (address !== undefined) {
            return { ok: true, address, route };
          }
        }
        continue;
      }
      if (route.statusCode === 301) {
        continue;
      }
      let result = this.fillChain(chain, cards, 'cards');
      if (result.ok) {
        return result;
      }
      // A route that may still fit once more is loaded decides the canonical
      // route as much as one that fits: trying later routes would give the
      // card a different address before it loads than after.
      if (UNDECIDED.has(result.miss.reason)) {
        return {
          ok: false,
          reason: result.miss.reason,
          route: result.miss.route,
        };
      }
      misses.push(result.miss);
    }
    let telling = misses.find((miss) => miss.fits);
    return telling
      ? { ok: false, reason: telling.reason, route: telling.route }
      : { ok: false, reason: 'no-route' };
  }

  forType(
    type: typeof BaseDef,
    values: Readonly<Record<string, unknown>>,
  ): HostRouteAddressResult {
    let refs = typeRefs(type);
    let given = Object.keys(values).sort();
    let invalid: HostRoute | undefined;
    for (let chain of indexOf(this.options.routes).chains) {
      let route = chain[chain.length - 1]!;
      if (
        route.kind !== 'field-match' ||
        route.statusCode === 301 ||
        !refs.some((ref) => this.sameType(ref, route.type))
      ) {
        continue;
      }
      let fields = route.match.map((m) => m.field).sort();
      if (
        fields.length !== given.length ||
        fields.some((field, i) => field !== given[i])
      ) {
        continue;
      }
      // The values fill the route's own segments only, so a route under a
      // dynamic route can't be filled.
      if (chain.slice(0, -1).some(isDynamic)) {
        continue;
      }
      let params: RouteParams = {};
      let valid = true;
      for (let { field, param } of route.match) {
        let value = segmentValue(values[field]);
        if (value === undefined) {
          valid = false;
          break;
        }
        params[param] = value;
      }
      if (!valid) {
        invalid ??= route;
        continue;
      }
      let address = fillChainPath(chain, params);
      if (address !== undefined) {
        return { ok: true, address, route };
      }
      invalid ??= route;
    }
    return invalid
      ? { ok: false, reason: 'invalid-segment-value', route: invalid }
      : { ok: false, reason: 'no-route' };
  }

  forName(
    name: string,
    args: readonly (BaseDef | string | number)[],
  ): HostRouteAddressResult {
    let chain = indexOf(this.options.routes).byName.get(name);
    if (!chain) {
      return { ok: false, reason: 'no-route' };
    }
    let route = chain[chain.length - 1]!;
    if (route.pattern === undefined) {
      // A top-level fixed route or redirect whose path the parser rejects
      // routes at its path as written.
      return args.length === 0
        ? { ok: true, address: route.fullPath, route }
        : { ok: false, reason: 'wrong-argument-count', route };
    }
    if (route.kind === 'redirect') {
      // A redirect resolves no card, so each argument is a value for one of
      // its segments.
      if (args.length !== route.paramNames.length) {
        return { ok: false, reason: 'wrong-argument-count', route };
      }
      let params: RouteParams = {};
      for (let [i, arg] of args.entries()) {
        let value = typeof arg === 'object' ? undefined : segmentValue(arg);
        if (value === undefined) {
          return { ok: false, reason: 'invalid-segment-value', route };
        }
        params[route.paramNames[i]!] = value;
      }
      let address = fillChainPath(chain, params);
      return address === undefined
        ? { ok: false, reason: 'invalid-segment-value', route }
        : { ok: true, address, route };
    }
    let result = this.fillChain(chain, args, 'name');
    return result.ok
      ? result
      : { ok: false, reason: result.miss.reason, route: result.miss.route };
  }

  // Fills a route's chain from the arguments, one per dynamic level. In the
  // `cards` form one card may stand for a nested route: it fills the levels
  // above it from its links to them.
  private fillChain(
    chain: Chain,
    args: readonly (BaseDef | string | number)[],
    form: 'cards' | 'name',
  ):
    | { ok: true; address: string; route: HostRoute }
    | { ok: false; miss: Miss } {
    let route = chain[chain.length - 1]!;
    let levels = chain.filter(isDynamic);
    let miss = (reason: HostRouteNoAddressReason, fits = true) => ({
      ok: false as const,
      miss: { reason, route, fits },
    });

    if (form === 'name') {
      if (args.length !== levels.length) {
        return miss('wrong-argument-count');
      }
    } else if (args.length !== levels.length && args.length !== 1) {
      return miss('wrong-argument-count', false);
    }

    let params: RouteParams = {};
    // The card or id for each level, from the bottom up.
    let given: (BaseDef | string | number | undefined)[] = levels.map((_, i) =>
      args.length === levels.length
        ? args[i]
        : i === levels.length - 1
          ? args[0]
          : undefined,
    );

    for (let i = levels.length - 1; i >= 0; i--) {
      let level = levels[i]!;
      let arg = given[i];
      let ownNames = level.pattern.paramNames;
      let derived = arg === undefined;
      if (derived) {
        if (
          ownNames.every((n) => Object.prototype.hasOwnProperty.call(params, n))
        ) {
          // A card id pattern below already filled this level.
          continue;
        }
        let child = given[i + 1];
        let parent = this.parentFromChild(levels[i + 1]!, child);
        if (typeof parent === 'object' && 'reason' in parent) {
          return miss(parent.reason);
        }
        arg = parent;
        given[i] = arg;
      }
      if (typeof arg === 'number' || (form === 'name' && isString(arg))) {
        // A value for a level with one segment.
        if (ownNames.length !== 1) {
          return miss('wrong-argument-count');
        }
        let value = segmentValue(arg);
        if (value === undefined) {
          return miss('invalid-segment-value');
        }
        if (!agree(params, ownNames[0]!, value)) {
          return miss('not-member');
        }
        continue;
      }
      let filled = this.levelParams(level, arg!, derived);
      if ('reason' in filled) {
        return miss(filled.reason, filled.fits);
      }
      for (let [n, v] of Object.entries(filled.params)) {
        if (!agree(params, n, v)) {
          return miss('not-member');
        }
      }
      // Two given cards must belong together through the child's link.
      // In the route-name form a string or number is a segment value, not a
      // card, so there is nothing to check it against.
      let child = given[i + 1];
      if (
        !derived &&
        i < levels.length - 1 &&
        child !== undefined &&
        !(form === 'name' && typeof child !== 'object')
      ) {
        let member = this.isMember(levels[i + 1]!, child, arg!);
        if (member === false) {
          return miss('not-member');
        }
      }
    }

    let address = fillChainPath(chain, params);
    if (address === undefined) {
      return miss('invalid-segment-value');
    }
    return { ok: true, address, route };
  }

  // The params a level's route reads from one card or id.
  private levelParams(
    level: DynamicRoute,
    card: BaseDef | string,
    derived: boolean,
  ):
    | { params: RouteParams }
    | { reason: HostRouteNoAddressReason; fits: boolean } {
    if (level.kind === 'card-id') {
      let id = cardId(card);
      if (id === undefined) {
        return { reason: 'card-without-id', fits: true };
      }
      let url = this.servedURL(id);
      let params = url
        ? matchCardIdPattern(level.card, url, this.options.realmURL)
        : undefined;
      return params ? { params } : { reason: 'no-route', fits: false };
    }
    if (typeof card === 'string') {
      return {
        reason: derived ? 'parent-not-loaded' : 'card-not-loaded',
        fits: true,
      };
    }
    let api = this.options.api;
    if (
      matchInstanceAgainstFilter(card, { type: level.type }, api) !== 'match'
    ) {
      return { reason: 'no-route', fits: false };
    }
    if (level.where) {
      let result = matchInstanceAgainstFilter(card, level.where, api);
      if (result === 'no-match') {
        return { reason: 'where-not-matched', fits: true };
      }
      if (result === 'unresolvable') {
        return { reason: 'where-unresolvable', fits: true };
      }
    }
    let params: RouteParams = {};
    for (let { field, param } of level.match) {
      let read = readPath(card, field, api);
      if (read === NOT_LOADED) {
        return {
          reason: derived ? 'parent-not-loaded' : 'value-not-loaded',
          fits: true,
        };
      }
      let value = segmentValue(read);
      if (value === undefined) {
        return { reason: 'invalid-segment-value', fits: true };
      }
      params[param] = value;
    }
    return { params };
  }

  // The parent level's card, or its id, from the child card's link to it.
  private parentFromChild(
    childLevel: DynamicRoute,
    child: BaseDef | string | number | undefined,
  ): BaseDef | string | { reason: HostRouteNoAddressReason } {
    let link: HostRouteParentLink | undefined = childLevel.parentLink;
    if (!link) {
      // A card id child without a link embeds some of the parent's values
      // in its template, but not all of them.
      return {
        reason: childLevel.kind === 'card-id' ? 'parent-not-in-id' : 'no-route',
      };
    }
    if (link.side === 'parent') {
      return { reason: 'parent-holds-link' };
    }
    if (child === undefined || typeof child !== 'object') {
      return { reason: 'parent-not-loaded' };
    }
    if (!getField(child, link.field)) {
      return {
        reason: link.side === 'unverified' ? 'parent-holds-link' : 'no-route',
      };
    }
    let value = this.options.api.peekAtField(child, link.field);
    let first = Array.isArray(value) ? value[0] : value;
    if (first == null) {
      return { reason: 'no-parent' };
    }
    let parent = this.linkTarget(child, first);
    return parent ?? { reason: 'parent-not-loaded' };
  }

  // Whether a child card belongs to a parent card through the child route's
  // link. `undefined` when the link can't be read from what is loaded.
  private isMember(
    childLevel: DynamicRoute,
    child: BaseDef | string | number,
    parent: BaseDef | string | number,
  ): boolean | undefined {
    let link = childLevel.parentLink;
    if (!link || typeof child === 'number' || typeof parent === 'number') {
      return undefined;
    }
    let sides: ('child' | 'parent')[] =
      link.side === 'unverified' ? ['child', 'parent'] : [link.side];
    for (let side of sides) {
      let holder = side === 'child' ? child : parent;
      let other = side === 'child' ? parent : child;
      if (typeof holder !== 'object' || !getField(holder, link.field)) {
        continue;
      }
      let otherId = cardId(other);
      let value = this.options.api.peekAtField(holder, link.field);
      // An empty link is read as holding no card, like an empty plural link.
      let values = Array.isArray(value) ? value : value == null ? [] : [value];
      let ids = values.map((v) => {
        let target = this.linkTarget(holder, v);
        return target === undefined ? undefined : cardId(target);
      });
      if (ids.some((id) => this.sameId(id, otherId))) {
        return true;
      }
      return ids.includes(undefined) ? undefined : false;
    }
    return undefined;
  }

  // A link's value as a loaded card, or as the id of a card that isn't
  // loaded.
  private linkTarget(
    holder: BaseDef,
    value: unknown,
  ): BaseDef | string | undefined {
    if (value == null) {
      return undefined;
    }
    if (this.options.api.isNonPresentLink(value)) {
      let reference = (value as { reference?: unknown }).reference;
      let base = cardId(holder);
      if (typeof reference !== 'string' || base === undefined) {
        return undefined;
      }
      return trimJsonExtension(resolveRRIReference(reference, rri(base)));
    }
    return typeof value === 'object' ? (value as BaseDef) : undefined;
  }

  private inRealm(id: string): boolean {
    let url = this.servedURL(id);
    return Boolean(url && this.realmPaths.inRealm(url));
  }

  // The URL a card id is served at, resolved by the virtual network, so an
  // id in prefix form and one in URL form name the same card. `undefined`
  // for an id the network can't resolve.
  private servedURL(id: string): URL | undefined {
    try {
      return this.options.api.virtualNetwork.toURL(id);
    } catch {
      return undefined;
    }
  }

  private sameId(a: string | undefined, b: string | undefined): boolean {
    if (a === undefined || b === undefined) {
      return false;
    }
    if (a === b) {
      return true;
    }
    let urlA = this.servedURL(a);
    let urlB = this.servedURL(b);
    return Boolean(urlA && urlB && urlA.href === urlB.href);
  }

  private sameType(a: CodeRef, b: CodeRef): boolean {
    if (!('module' in a) || !('module' in b) || a.name !== b.name) {
      return false;
    }
    if (a.module === b.module) {
      return true;
    }
    let virtualNetwork = this.options.api.virtualNetwork;
    return (
      canonicalModuleKey(a.module, virtualNetwork) ===
      canonicalModuleKey(b.module, virtualNetwork)
    );
  }
}

interface RouteIndex {
  chains: Chain[];
  // The first chain in authored order that ends at a route with the name.
  byName: Map<string, Chain>;
}

// The validated routes don't change between lookups, and a page looks up
// each of its links, so each routes array is walked once.
const routeIndexes = new WeakMap<readonly HostRoute[], RouteIndex>();

function indexOf(routes: readonly HostRoute[]): RouteIndex {
  let index = routeIndexes.get(routes);
  if (!index) {
    let all = chains(routes);
    let byName = new Map<string, Chain>();
    for (let chain of all) {
      let name = chain[chain.length - 1]!.name;
      if (name !== undefined && !byName.has(name)) {
        byName.set(name, chain);
      }
    }
    index = { chains: all, byName };
    routeIndexes.set(routes, index);
  }
  return index;
}

// Every route's chain from the top level down to it, in depth-first
// authored order: a route, then its children, then its later siblings.
function chains(routes: readonly HostRoute[], above: Chain = []): Chain[] {
  let out: Chain[] = [];
  for (let route of routes) {
    let chain = [...above, route];
    out.push(chain);
    out.push(...chains(route.routes, chain));
  }
  return out;
}

function isDynamic(route: HostRoute): route is DynamicRoute {
  return route.kind === 'card-id' || route.kind === 'field-match';
}

// The address of a chain, each level's own path filled from `params` and
// joined.
function fillChainPath(chain: Chain, params: RouteParams): string | undefined {
  let path = '';
  for (let route of chain) {
    if (!route.pattern) {
      return undefined;
    }
    let own = fillRoutePathPattern(route.pattern, params);
    if (own === undefined) {
      return undefined;
    }
    if (own !== '/') {
      path += own;
    }
  }
  return path || '/';
}

// The address of a fixed card route: its chain's paths joined. A fixed route
// under a dynamic route has no address from its card alone.
function fixedChainAddress(chain: Chain): string | undefined {
  if (chain.some(isDynamic)) {
    return undefined;
  }
  return fillChainPath(chain, {}) ?? chain[chain.length - 1]!.fullPath;
}

// A field or argument value as a segment value, or `undefined` when it
// isn't one: a non-empty string, or a finite number written as JavaScript
// writes it without an exponent (so it has one way of being written).
function segmentValue(value: unknown): string | undefined {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    text = String(value);
    if (/e/i.test(text)) {
      return undefined;
    }
  } else {
    return undefined;
  }
  return text !== '' && text !== '.' && text !== '..' ? text : undefined;
}

const NOT_LOADED = Symbol('not-loaded');

// Reads a field, or a dotted path through contained fields and links, from a
// card. `NOT_LOADED` where a step goes through a link that isn't loaded, so
// the value may still fit once it loads. `undefined` where a step isn't
// there, and for a plural value, which has no single segment.
function readPath(
  card: BaseDef,
  path: string,
  api: CardAPIForMatching,
): unknown {
  let node: unknown = card;
  for (let name of path.split('.')) {
    if (api.isNonPresentLink(node)) {
      return NOT_LOADED;
    }
    if (
      node == null ||
      typeof node !== 'object' ||
      Array.isArray(node) ||
      !getField(node as BaseDef, name)
    ) {
      return undefined;
    }
    node = api.peekAtField(node as BaseDef, name);
  }
  return Array.isArray(node) ? undefined : node;
}

// A param can be filled twice, from a child's card id pattern and from the
// parent's card. Both must give the same value.
function agree(params: RouteParams, name: string, value: string): boolean {
  if (Object.prototype.hasOwnProperty.call(params, name)) {
    return params[name] === value;
  }
  params[name] = value;
  return true;
}

function cardId(card: BaseDef | string | number): string | undefined {
  if (typeof card === 'string') {
    return card;
  }
  if (typeof card === 'number') {
    return undefined;
  }
  let id = (card as CardDef).id;
  return typeof id === 'string' && id ? id : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

// The code refs of a card class and each class it descends from.
function typeRefs(type: typeof BaseDef): CodeRef[] {
  let refs: CodeRef[] = [];
  let klass: typeof BaseDef | null = type;
  while (klass && klass !== Function.prototype) {
    let ref = identifyCard(klass);
    if (ref) {
      refs.push(ref);
    }
    klass = Object.getPrototypeOf(klass) as typeof BaseDef | null;
  }
  return refs;
}
