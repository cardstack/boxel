// Resolution of a request path against a realm's validated host routes:
// the path, the routes and the caller's lookups in; the card to serve, a
// redirect, or nothing out, with a trace of each step.
//
// It is a pure async function. It reads only the path and the cards the
// caller's `load` and `search` return: never a query string, a header, the
// clock or a random source, so a path resolves the same way every time for
// anyone who can read the cards. The caller runs the lookups as its own
// visitor: the realm server with the request's permissions, the host app
// with the browser's.
//
// Walking down the tree, each level tries the routes that match the path
// from where the parent's match stopped, alone or through their child
// routes: those with a literal at the first segment of the path where two
// routes differ go first (a route's child routes count as its segments),
// then list order. A dynamic route that finds no card, or a card the visitor
// can't read, lets the next one try. The first route that resolves commits
// its level: when its children then find nothing, the path resolves to
// nothing, and no earlier level is tried again. A lookup that throws stops
// resolution with an error.

import type { ResolvedCodeRef } from './code-ref.ts';
import type { RedirectStatusCode } from './host-routing-validation.ts';
import type { HostRoute, HostRouteParentLink } from './host-routes.ts';
import { RealmPaths } from './paths.ts';
import type { Filter } from './query.ts';
import {
  fillCardIdPattern,
  fillRoutePathPattern,
  matchPatternSegments,
  splitRequestPath,
  type RouteParams,
} from './route-pattern.ts';

// A card as the resolver needs it: its served URL, and the served URLs of
// the cards some of its link fields point to.
//
// Every card here is named by the URL it is served at, without `.json`:
// the form the index keys its rows by, and the form `fillCardIdPattern`
// gives. Card ids and link targets are identifiers (RRIs), and an RRI can
// be in prefix form, so the caller converts each one to its served URL at
// its own boundary, with its VirtualNetwork, before it returns the card.
export interface HostRouteCard {
  cardURL: URL;
  // For each field the lookup asked for in `linkFields`, the served URLs
  // of the cards the field links to: one or none for a `linksTo`, the
  // list for a `linksToMany`. A field that is missing, or holds no link,
  // may be left out.
  links?: Readonly<Record<string, readonly URL[] | undefined>>;
}

export interface HostRouteLoadRequest {
  // The served URL of the card to load, in the routing realm.
  cardURL: URL;
  // The link fields whose values the resolver reads on the card. Often
  // empty.
  linkFields: readonly string[];
}

export interface HostRouteSearchRequest {
  // The card type the route names.
  type: ResolvedCodeRef;
  // The whole filter to run, on `type`: an `eq` with one entry per matched
  // field, and the route's `where`, both under `every`.
  filter: Filter;
  // As in `HostRouteLoadRequest`, for every card in the results.
  linkFields: readonly string[];
}

// Loads one card by its served URL, as the visitor.
// - Resolves to the card when it exists and the visitor can read it.
// - Resolves to `undefined` when there is no such card, or the visitor
//   can't read it. The resolver counts both as a miss.
// - Rejects when the lookup fails or is refused (an error, a timeout, a
//   rate limit). The resolver stops and reports the error.
export type HostRouteLoad = (
  request: HostRouteLoadRequest,
) => Promise<HostRouteCard | undefined>;

// Searches the routing realm for cards of a type, as the visitor.
// - Resolves to the cards the visitor can read that match the filter,
//   sorted the way the index sorts a search with no sort of its own, which
//   ends with the card URL. The resolver takes the first one that fits, so
//   duplicate values resolve to the card that sorts first. An empty list
//   is a miss.
// - Rejects as `HostRouteLoad` does.
export type HostRouteSearch = (
  request: HostRouteSearchRequest,
) => Promise<readonly HostRouteCard[]>;

export interface ResolveHostRouteOptions {
  // The path to resolve, relative to the realm's root: a pathname that
  // starts with `/`, still percent-encoded, with no query string or
  // fragment. When the realm is served under a prefix of a host URL, the
  // caller strips the prefix first, so the realm's root is `/`. A single
  // trailing slash is ignored; redirecting to the form without it is the
  // caller's job, as for fixed routes.
  path: string;
  // The validated routes (`validateHostRoutes`).
  routes: readonly HostRoute[];
  // The URL the realm is served at, ending with `/`. A card id template is
  // filled under it, and a resolved card must be in it.
  realmURL: URL;
  load: HostRouteLoad;
  search: HostRouteSearch;
}

export type HostRouteResolution =
  | HostRouteCardResult
  | HostRouteRedirectResult
  | HostRouteAliasResult
  | HostRouteNothingResult
  | HostRouteErrorResult;

// Serve this card at the requested path.
export interface HostRouteCardResult {
  kind: 'card';
  // The card's served URL.
  cardURL: URL;
  // The route that resolved the card, as `HostRoute.position`.
  position: readonly number[];
  // Every `:name` value the path matched, decoded.
  params: RouteParams;
  trace: readonly HostRouteTraceStep[];
}

// A redirect route matched. `location` is either a path relative to the
// realm's root, starting with `/` (the caller puts the realm's prefix on
// the host URL in front of it), or, when `external` is true, an absolute
// http(s) URL to send as is. `:name` values are copied into the target
// with the canonical encoding; nothing is looked up.
export interface HostRouteRedirectResult {
  kind: 'redirect';
  location: string;
  external: boolean;
  statusCode: RedirectStatusCode;
  position: readonly number[];
  params: RouteParams;
  trace: readonly HostRouteTraceStep[];
}

// An alias route (`"statusCode": 301`) resolved the card at `cardURL`. The resolver
// doesn't know the card's canonical address: the caller looks it up with
// the reverse lookup (card to address) and answers a 301 to it. When the
// card has no other address, the caller serves the card at the requested
// path instead, as for a `card` result.
export interface HostRouteAliasResult {
  kind: 'alias';
  // The card's served URL.
  cardURL: URL;
  statusCode: 301;
  position: readonly number[];
  params: RouteParams;
  trace: readonly HostRouteTraceStep[];
}

// No route serves the path. The caller answers with the realm's not-found
// card.
export interface HostRouteNothingResult {
  kind: 'nothing';
  reason: // The path isn't a valid request path (`splitRequestPath`).
    | 'invalid-path'
    // At some level, no route's pattern matched the rest of the path.
    | 'no-matching-route'
    // Routes matched at some level, and every one of them missed.
    | 'every-route-missed';
  trace: readonly HostRouteTraceStep[];
}

// A lookup rejected. The caller answers 503, or 429 for a rate limit, as
// `error` says; never the not-found card.
export interface HostRouteErrorResult {
  kind: 'error';
  error: unknown;
  // The route whose lookup failed.
  position: readonly number[];
  trace: readonly HostRouteTraceStep[];
}

export type HostRouteMissReason =
  // The card id template filled to no valid id under the realm.
  | 'invalid-card-id'
  // `load` found no card the visitor can read.
  | 'not-found'
  // `search` returned no card.
  | 'no-results'
  // The card (or every card the search returned) is outside the realm.
  | 'outside-realm'
  // The card (or every card in the realm the search returned) doesn't
  // belong to the parent route's card.
  | 'not-in-parent'
  // The redirect target couldn't be filled.
  | 'invalid-redirect-target';

// One route the resolver tried, in the order it tried them.
export interface HostRouteTraceStep {
  position: readonly number[];
  fullPath: string;
  routeKind: HostRoute['kind'];
  // The index of the first path segment this route matched from.
  offset: number;
  // The `:name` values matched so far, the parents' included.
  params: RouteParams;
  // The lookup the route ran, if any.
  lookup?:
    | { kind: 'load'; cardHref: string; found: boolean }
    | {
        kind: 'search';
        type: ResolvedCodeRef;
        filter: Filter;
        // How many cards the search returned.
        resultCount: number;
      };
  // `resolved`: the route found its card (or is fixed) and the resolver
  // went on with it, to its children or to the result. `redirect`: the
  // route is a redirect and the resolver returned it. `miss`: the next
  // route at the same level tries. `error`: a lookup rejected.
  outcome: 'resolved' | 'redirect' | 'miss' | 'error';
  reason?: HostRouteMissReason;
  // The served URL of the card the route resolved, as an `href`.
  cardHref?: string;
}

/**
 * Resolves a request path against a realm's validated host routes, running
 * the caller's `load` and `search` as the visitor. Returns the card to
 * serve, a redirect, an alias for the caller to send to the card's
 * canonical address, nothing, or the error a lookup rejected with, and a
 * trace of each route tried. It never throws.
 */
export async function resolveHostRoute(
  options: ResolveHostRouteOptions,
): Promise<HostRouteResolution> {
  let resolver = new Resolver(options);
  return resolver.run();
}

// What a child route resolves within: the parent route and the card it
// resolved.
interface ParentContext {
  route: HostRoute;
  card: HostRouteCard;
}

type LevelResult =
  | HostRouteResolution
  // Every matching route at the level missed.
  | { kind: 'missed' };

class Resolver {
  private trace: HostRouteTraceStep[] = [];
  private realmPaths: RealmPaths;
  private options: ResolveHostRouteOptions;

  constructor(options: ResolveHostRouteOptions) {
    this.options = options;
    this.realmPaths = new RealmPaths(options.realmURL);
  }

  async run(): Promise<HostRouteResolution> {
    let segments = splitRequestPath(this.options.path);
    if (!segments) {
      return { kind: 'nothing', reason: 'invalid-path', trace: this.trace };
    }
    let result = await this.resolveLevel(
      this.options.routes,
      segments,
      0,
      {},
      undefined,
    );
    if (result.kind === 'missed') {
      return {
        kind: 'nothing',
        reason: 'every-route-missed',
        trace: this.trace,
      };
    }
    return result;
  }

  private async resolveLevel(
    routes: readonly HostRoute[],
    segments: readonly string[],
    offset: number,
    params: RouteParams,
    parent: ParentContext | undefined,
  ): Promise<LevelResult> {
    let candidates = this.candidates(routes, segments, offset);
    if (candidates.length === 0) {
      return {
        kind: 'nothing',
        reason: 'no-matching-route',
        trace: this.trace,
      };
    }
    for (let { route, end, params: own } of candidates) {
      let allParams = { ...params, ...own };
      let atEnd = end === segments.length;
      let step: HostRouteTraceStep = {
        position: route.position,
        fullPath: route.fullPath,
        routeKind: route.kind,
        offset,
        params: allParams,
        outcome: 'miss',
      };
      this.trace.push(step);

      if (route.kind === 'redirect') {
        let redirect = this.redirect(route, allParams);
        if (!redirect) {
          step.reason = 'invalid-redirect-target';
          continue;
        }
        step.outcome = 'redirect';
        return {
          kind: 'redirect',
          ...redirect,
          statusCode: route.statusCode,
          position: route.position,
          params: allParams,
          trace: this.trace,
        };
      }

      let card: HostRouteCard;
      if (route.kind === 'fixed-card') {
        card = { cardURL: new URL(route.id) };
      } else {
        let found: HostRouteCard | undefined;
        try {
          found = await this.lookup(route, allParams, parent, step);
        } catch (error) {
          step.outcome = 'error';
          return {
            kind: 'error',
            error,
            position: route.position,
            trace: this.trace,
          };
        }
        if (!found) {
          continue;
        }
        card = found;
      }
      step.outcome = 'resolved';
      step.cardHref = card.cardURL.href;

      if (!atEnd) {
        // The route resolves its level: whatever its children find is the
        // answer, nothing included.
        let child = await this.resolveLevel(
          route.routes,
          segments,
          end,
          allParams,
          { route, card },
        );
        if (child.kind === 'missed') {
          return {
            kind: 'nothing',
            reason: 'every-route-missed',
            trace: this.trace,
          };
        }
        return child;
      }
      if (
        (route.kind === 'card-id' || route.kind === 'field-match') &&
        route.statusCode === 301
      ) {
        return {
          kind: 'alias',
          cardURL: card.cardURL,
          statusCode: 301,
          position: route.position,
          params: allParams,
          trace: this.trace,
        };
      }
      return {
        kind: 'card',
        cardURL: card.cardURL,
        position: route.position,
        params: allParams,
        trace: this.trace,
      };
    }
    return { kind: 'missed' };
  }

  // The routes at one level that match the path from `offset`, in the
  // order they are tried. A route matches when its pattern covers the rest
  // of the path, or a prefix of it and a chain of its child routes covers
  // the rest, by pattern alone. A route whose children can't match the
  // rest never resolves its level, so it never keeps a later sibling from
  // trying.
  private candidates(
    routes: readonly HostRoute[],
    segments: readonly string[],
    offset: number,
  ): { route: HostRoute; end: number; params: RouteParams }[] {
    let out: {
      route: HostRoute;
      end: number;
      params: RouteParams;
      rank: SegmentRank;
    }[] = [];
    for (let route of routes) {
      if (!route.pattern) {
        // A top-level fixed route whose path the pattern parser rejects:
        // it matches its path exactly, as the routing map always matched
        // it, and has no children.
        if (offset === 0 && this.matchesUnparsedPath(route.path)) {
          out.push({
            route,
            end: segments.length,
            params: {},
            rank: segments.map(() => true),
          });
        }
        continue;
      }
      let match = matchPatternSegments(route.pattern, segments, offset);
      if (!match) {
        continue;
      }
      let rank = rankThrough(route, segments, offset);
      if (!rank) {
        continue;
      }
      out.push({ route, end: match.end, params: match.params, rank });
    }
    // `sort` is stable, so routes that tie keep their list order.
    out.sort((a, b) => compareRanks(a.rank, b.rank));
    return out;
  }

  private matchesUnparsedPath(routePath: string): boolean {
    let path = this.options.path;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    if (path === routePath) {
      return true;
    }
    let decodedPath = safeDecodeURI(path);
    let decodedRoute = safeDecodeURI(routePath);
    return decodedPath !== undefined && decodedPath === decodedRoute;
  }

  private redirect(
    route: Extract<HostRoute, { kind: 'redirect' }>,
    params: RouteParams,
  ): { location: string; external: boolean } | undefined {
    if (!route.target) {
      return {
        location: route.redirectTo,
        external: !route.redirectTo.startsWith('/'),
      };
    }
    let path = fillRoutePathPattern(route.target.pattern, params);
    if (path === undefined) {
      return undefined;
    }
    return {
      location: route.target.origin + path + route.target.suffix,
      external: route.target.origin !== '',
    };
  }

  // Looks up a dynamic route's card. Returns the card, or `undefined` for
  // a miss (with `step.reason` set). Throws what a lookup rejects with.
  private async lookup(
    route: Extract<HostRoute, { kind: 'card-id' | 'field-match' }>,
    params: RouteParams,
    parent: ParentContext | undefined,
    step: HostRouteTraceStep,
  ): Promise<HostRouteCard | undefined> {
    let linkFields = linkFieldsFor(route);
    // A card id template whose id carries the nesting has no link to check.
    let link = parent ? route.parentLink : undefined;

    if (route.kind === 'card-id') {
      let href = fillCardIdPattern(route.card, params, this.options.realmURL);
      if (href === undefined) {
        step.reason = 'invalid-card-id';
        return undefined;
      }
      let load = { kind: 'load' as const, cardHref: href, found: false };
      step.lookup = load;
      let card = await this.options.load({
        cardURL: new URL(href),
        linkFields,
      });
      if (!card) {
        step.reason = 'not-found';
        return undefined;
      }
      load.found = true;
      if (!this.inRealm(card.cardURL)) {
        step.reason = 'outside-realm';
        return undefined;
      }
      if (link && parent && !isMember(link, card, parent.card)) {
        step.reason = 'not-in-parent';
        return undefined;
      }
      return card;
    }

    let filter: Filter = {
      on: route.type,
      every: [
        {
          eq: Object.fromEntries(
            route.match.map(({ field, param }) => [field, params[param]!]),
          ),
        },
        ...(route.where ? [route.where] : []),
      ],
    };
    let search = {
      kind: 'search' as const,
      type: route.type,
      filter,
      resultCount: 0,
    };
    step.lookup = search;
    let results = await this.options.search({
      type: route.type,
      filter,
      linkFields,
    });
    search.resultCount = results.length;
    if (results.length === 0) {
      step.reason = 'no-results';
      return undefined;
    }
    let inRealm = results.filter((card) => this.inRealm(card.cardURL));
    if (inRealm.length === 0) {
      step.reason = 'outside-realm';
      return undefined;
    }
    let card =
      link && parent
        ? inRealm.find((candidate) => isMember(link, candidate, parent.card))
        : inRealm[0];
    if (!card) {
      step.reason = 'not-in-parent';
      return undefined;
    }
    return card;
  }

  private inRealm(cardURL: URL): boolean {
    return this.realmPaths.inRealm(cardURL);
  }
}

// The link fields the resolver reads on a route's card: the route's own
// link to its parent, when it may be on this card, and each child route's
// link to it, when it may be on this card.
function linkFieldsFor(route: HostRoute): string[] {
  let fields = new Set<string>();
  let own =
    route.kind === 'card-id' || route.kind === 'field-match'
      ? route.parentLink
      : undefined;
  if (own && own.side !== 'parent') {
    fields.add(own.field);
  }
  for (let child of route.routes) {
    let link =
      child.kind === 'card-id' || child.kind === 'field-match'
        ? child.parentLink
        : undefined;
    if (link && link.side !== 'child') {
      fields.add(link.field);
    }
  }
  return [...fields];
}

// Whether `child` belongs to `parent` through `link`, read on the two
// loaded cards. A link whose side validation couldn't check is read on
// both.
function isMember(
  link: HostRouteParentLink,
  child: HostRouteCard,
  parent: HostRouteCard,
): boolean {
  let childHolds = () => linksTo(child, link.field, parent.cardURL);
  let parentHolds = () => linksTo(parent, link.field, child.cardURL);
  switch (link.side) {
    case 'child':
      return childHolds();
    case 'parent':
      return parentHolds();
    default:
      return childHolds() || parentHolds();
  }
}

function linksTo(card: HostRouteCard, field: string, target: URL): boolean {
  let urls = card.links?.[field];
  return (
    Array.isArray(urls) && urls.some((url: URL) => url.href === target.href)
  );
}

// For each segment of the path from a route's offset to the end, whether
// the route matches it with a literal (`true`) or a `:name` (`false`).
type SegmentRank = readonly boolean[];

// The rank of `route` over the rest of the path: its own segments, then
// those of the child route chain that ranks best and covers the rest.
// `undefined` when the route doesn't match, or no child chain covers the
// rest.
function rankThrough(
  route: HostRoute,
  segments: readonly string[],
  offset: number,
): SegmentRank | undefined {
  if (!route.pattern) {
    return undefined;
  }
  let match = matchPatternSegments(route.pattern, segments, offset);
  if (!match) {
    return undefined;
  }
  let own = route.pattern.segments.map((s) => s.kind === 'literal');
  if (match.end === segments.length) {
    return own;
  }
  let best: SegmentRank | undefined;
  for (let child of route.routes) {
    let rank = rankThrough(child, segments, match.end);
    if (rank && (!best || compareRanks(rank, best) < 0)) {
      best = rank;
    }
  }
  return best ? [...own, ...best] : undefined;
}

// Literal segments before `:name` segments, at the first segment of the
// path where two routes differ, counting the segments a route matches
// through its children. Every candidate at a level covers the same rest
// of the path, so ranks have the same length and the order is total: the
// result doesn't depend on which pairs `sort` compares. Routes that tie
// keep their list order.
function compareRanks(a: SegmentRank, b: SegmentRank): number {
  let length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) {
      return a[i] ? -1 : 1;
    }
  }
  return 0;
}

function safeDecodeURI(value: string): string | undefined {
  try {
    return decodeURI(value);
  } catch {
    return undefined;
  }
}
