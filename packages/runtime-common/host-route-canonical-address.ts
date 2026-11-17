// A card's canonical address, worked out from the index rather than from a
// loaded card. The realm server uses it, because it never runs card code: it
// can't load a card instance for `hostRouteAddress`, but it can search the
// index as the visitor.
//
// It walks the same candidate routes in the same canonical order as
// `hostRouteAddress` (`canonicalCandidateChains`) and fills an address with
// the same helpers, so the two give the same address for the same card.
// Only the fit of each level is decided from index data:
//
// - a card id template matches the card's served URL against its pattern;
// - a fixed card route matches its own card;
// - a field match finds the card with a search for it on the route's type
//   and `where`, then reads the matched field values from the index;
// - a parent level of a nested route is filled from the child card's link
//   to the parent. A route whose link only the parent card holds gives no
//   address from the child alone.
//
// The index holds every value and link a loaded card would, so a route
// never stays undecided here: a route that doesn't fit lets the next one
// try.

import type { ResolvedCodeRef } from './code-ref.ts';
import {
  agreeHostRouteParam,
  canonicalCandidateChains,
  fillHostRouteChainPath,
  fixedHostRouteChainAddress,
  hostRouteSegmentValue,
  isDynamicHostRoute,
  type HostRouteChain,
  type HostRouteDynamicRoute,
} from './host-route-address.ts';
import type { HostRouteLoad } from './host-route-resolver.ts';
import type { HostRoute } from './host-routes.ts';
import { RealmPaths } from './paths.ts';
import type { Filter } from './query.ts';
import { matchCardIdPattern, type RouteParams } from './route-pattern.ts';

// One card as the index holds it, for a field-match level.
export interface HostRouteIndexedCard {
  // The card's served URL, as an `href`.
  cardHref: string;
  // For each field path asked for in `valueFields`, the value the index
  // holds, as the card's serialization writes it. A dotted path goes
  // through contained fields and links. A path that isn't there, holds no
  // value, or holds a plural value is left out or `undefined`.
  values: Readonly<Record<string, unknown>>;
  // As `HostRouteCard.linkHrefs`, for the fields asked for in `linkFields`.
  linkHrefs?: Readonly<Record<string, readonly string[] | undefined>>;
}

export interface HostRouteFindCardRequest {
  // The served URL of the card, as an `href`.
  cardHref: string;
  // The card type the route names. The card must be of it, or descend
  // from it.
  type: ResolvedCodeRef;
  // The route's `where`, when it has one. The card must match it.
  where: Filter | undefined;
  valueFields: readonly string[];
  linkFields: readonly string[];
}

// Finds one card in the routing realm when it is of the type and matches
// `where`, as the visitor.
// - Resolves to the card's index data when it fits and the visitor can
//   read it.
// - Resolves to `undefined` when the card doesn't fit, isn't there, or the
//   visitor can't read it. The route doesn't fit.
// - Rejects when the lookup fails or is refused, as `HostRouteLoad` does.
export type HostRouteFindCard = (
  request: HostRouteFindCardRequest,
) => Promise<HostRouteIndexedCard | undefined>;

export interface HostRouteCanonicalAddressOptions {
  // The validated routes (`Realm.getHostRoutes()`).
  routes: readonly HostRoute[];
  // The URL the realm is served at, ending with `/`.
  realmURL: URL;
  // Loads a card for its links, where a card id level's card fills its
  // parent level.
  load: HostRouteLoad;
  findCard: HostRouteFindCard;
}

export interface HostRouteCanonicalAddress {
  // The path from the realm root, canonically encoded, as
  // `hostRouteAddress` gives it.
  address: string;
  // The route that gave the address.
  route: HostRoute;
}

/**
 * The canonical address of the card served at `cardHref` (a served URL, as
 * an `href`), from the index, or `undefined` when no candidate route fits
 * the card. Rejects with what a lookup rejects with.
 */
export async function hostRouteCanonicalAddress(
  cardHref: string,
  options: HostRouteCanonicalAddressOptions,
): Promise<HostRouteCanonicalAddress | undefined> {
  let realmPaths = new RealmPaths(options.realmURL);
  let cardURL = parseURL(cardHref);
  if (!cardURL || !realmPaths.inRealm(cardURL)) {
    return undefined;
  }
  let walk = new CanonicalWalk(options);
  for (let chain of canonicalCandidateChains(options.routes)) {
    let route = chain[chain.length - 1]!;
    if (route.kind === 'fixed-card') {
      if (sameHref(route.cardHref, cardURL.href)) {
        let address = fixedHostRouteChainAddress(chain);
        if (address !== undefined) {
          return { address, route };
        }
      }
      continue;
    }
    let address = await walk.fill(chain, cardURL.href);
    if (address !== undefined) {
      return { address, route };
    }
  }
  return undefined;
}

class CanonicalWalk {
  private options: HostRouteCanonicalAddressOptions;
  // The links read on each card so far, by served URL and field, so a card
  // that fills a level of several candidate routes is loaded once for each
  // link field.
  private links = new Map<string, readonly string[] | undefined>();

  constructor(options: HostRouteCanonicalAddressOptions) {
    this.options = options;
  }

  // Fills a candidate chain from one card at its last dynamic level, the
  // parent levels from the card's links to them, as `hostRouteAddress`
  // does for a single card. `undefined` when the card doesn't fit.
  async fill(chain: HostRouteChain, cardHref: string) {
    let levels = chain.filter(isDynamicHostRoute);
    let params: RouteParams = {};
    let given: (string | undefined)[] = levels.map((_, i) =>
      i === levels.length - 1 ? cardHref : undefined,
    );
    for (let i = levels.length - 1; i >= 0; i--) {
      let level = levels[i]!;
      let href = given[i];
      if (href === undefined) {
        if (
          level.pattern.paramNames.every((n) =>
            Object.prototype.hasOwnProperty.call(params, n),
          )
        ) {
          // A card id pattern below already filled this level.
          continue;
        }
        href = await this.parentFromChild(levels[i + 1]!, given[i + 1]);
        if (href === undefined) {
          return undefined;
        }
        given[i] = href;
      }
      let filled = await this.levelParams(level, href);
      if (!filled) {
        return undefined;
      }
      for (let [n, v] of Object.entries(filled)) {
        if (!agreeHostRouteParam(params, n, v)) {
          return undefined;
        }
      }
    }
    return fillHostRouteChainPath(chain, params);
  }

  // The params a level's route reads from one card, or `undefined` when the
  // card doesn't fit the level.
  private async levelParams(
    level: HostRouteDynamicRoute,
    cardHref: string,
  ): Promise<RouteParams | undefined> {
    if (level.kind === 'card-id') {
      let url = parseURL(cardHref);
      return url
        ? matchCardIdPattern(level.card, url, this.options.realmURL)
        : undefined;
    }
    let link = childLinkField(level);
    let card = await this.options.findCard({
      cardHref,
      type: level.type,
      where: level.where,
      valueFields: level.match.map((m) => m.field),
      linkFields: link ? [link] : [],
    });
    if (!card) {
      return undefined;
    }
    if (link) {
      this.links.set(linkKey(cardHref, link), card.linkHrefs?.[link]);
    }
    let params: RouteParams = {};
    for (let { field, param } of level.match) {
      let value = hostRouteSegmentValue(card.values[field]);
      if (value === undefined) {
        return undefined;
      }
      params[param] = value;
    }
    return params;
  }

  // The parent level's card, from the child card's link to it. `undefined`
  // when the child holds no link to a parent: the route has no link, only
  // the parent holds it, or the link is empty.
  private async parentFromChild(
    childLevel: HostRouteDynamicRoute,
    childHref: string | undefined,
  ): Promise<string | undefined> {
    let field = childLinkField(childLevel);
    if (!field || childHref === undefined) {
      return undefined;
    }
    let key = linkKey(childHref, field);
    if (!this.links.has(key)) {
      let card = await this.options.load({
        cardHref: childHref,
        linkFields: [field],
      });
      this.links.set(key, card?.linkHrefs?.[field]);
    }
    return this.links.get(key)?.[0];
  }
}

// The field of a route's link to its parent, when the route's own card may
// hold it.
function childLinkField(level: HostRouteDynamicRoute): string | undefined {
  let link = level.parentLink;
  return link && link.side !== 'parent' ? link.field : undefined;
}

function linkKey(cardHref: string, field: string): string {
  return `${cardHref} ${field}`;
}

function sameHref(a: string, b: string): boolean {
  return trimJSON(a) === trimJSON(b);
}

function trimJSON(href: string): string {
  return href.endsWith('.json') ? href.slice(0, -'.json'.length) : href;
}

function parseURL(href: string): URL | undefined {
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
}
