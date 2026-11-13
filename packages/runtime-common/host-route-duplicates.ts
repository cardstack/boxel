import type { CodeRef } from './code-ref.ts';
import type { HostFieldMatchRoute, HostRoute } from './host-routes.ts';
import type { Filter } from './query.ts';
import { relationshipEntries } from './relationship-utils.ts';
import type { CardResource } from './resource-types.ts';
import { trimJsonExtension } from './url.ts';

// Cards of one field-match route that share their values, so they share an
// address. Only the first is served there; the others are reachable only by
// their own card URL.
export interface HostRouteDuplicate {
  // The route, as `HostRoute.position` and `HostRoute.fullPath` give it.
  position: readonly number[];
  fullPath: string;
  // The value the cards share for each `:name` of the route's own path.
  values: Readonly<Record<string, string>>;
  // The id of the parent route's card the cards belong to, for a route under
  // a dynamic parent route. A value only has to be unique within its parent,
  // so cards are compared only with the other cards of the same parent.
  parentCardId: string | undefined;
  // The cards' ids, in the order a lookup on the values returns them.
  cardIds: readonly string[];
  // The card the address serves: the first of `cardIds`.
  servedCardId: string;
}

export interface HostRouteDuplicates {
  duplicates: HostRouteDuplicate[];
  // False when a field-match route could not be checked: the routes could
  // not all be validated, or a query for a route failed. The duplicates
  // found in the routes that were checked are still listed.
  complete: boolean;
}

// What the finder reads from the realm's index. It never runs realm code.
export interface HostRouteDuplicateIndex {
  // The instances that pass `filter` and share their values of `fields`
  // with another such instance, by index URL (the `.json` file URL), with
  // their values as text. Rows with the same values are adjacent, ordered
  // as a search orders them.
  findSharedFieldValues(
    filter: Filter,
    fields: readonly { path: string; on: CodeRef }[],
  ): Promise<{ url: string; values: string[] }[]>;
  // The indexed resources of the instances that pass `filter`.
  instanceResources(filter: Filter): Promise<CardResource[]>;
  // The indexed resource of one instance, by card id.
  instance(cardId: string): Promise<CardResource | undefined>;
}

// The filter a field-match route's lookup applies on top of its `eq`s: the
// route's type, and its `where`.
export function hostFieldMatchFilter(route: HostFieldMatchRoute): Filter {
  let typeFilter: Filter = { type: route.type };
  if (!route.where) {
    return typeFilter;
  }
  return {
    every: [typeFilter, { on: route.type, ...route.where } as Filter],
  };
}

// Finds the values more than one card of a field-match route shares, in
// every field-match route of `routes`, child routes included. One query per
// route finds the cards that share values across the whole realm. For a
// route under a dynamic parent route, the link to the parent is then read
// for those cards only, and they are compared within each parent.
export async function findHostRouteDuplicates(
  routes: readonly HostRoute[],
  index: HostRouteDuplicateIndex,
  opts: {
    complete: boolean;
    onError?: (route: HostFieldMatchRoute, error: unknown) => void;
  },
): Promise<HostRouteDuplicates> {
  let result: HostRouteDuplicates = {
    duplicates: [],
    complete: opts.complete,
  };
  let visit = async (
    list: readonly HostRoute[],
    parent: HostRoute | undefined,
  ) => {
    for (let route of list) {
      if (route.kind === 'field-match') {
        try {
          result.duplicates.push(
            ...(await duplicatesOfRoute(route, parent, index)),
          );
        } catch (e) {
          result.complete = false;
          opts.onError?.(route, e);
        }
      }
      await visit(route.routes, route);
    }
  };
  await visit(routes, undefined);
  return result;
}

interface Candidate {
  cardId: string;
  values: string[];
}

async function duplicatesOfRoute(
  route: HostFieldMatchRoute,
  parent: HostRoute | undefined,
  index: HostRouteDuplicateIndex,
): Promise<HostRouteDuplicate[]> {
  let rows = await index.findSharedFieldValues(
    hostFieldMatchFilter(route),
    route.match.map(({ field }) => ({ path: field, on: route.type })),
  );
  // An empty value is not a path segment, so it gives the card no address.
  let candidates: Candidate[] = rows
    .filter((row) => row.values.every((value) => value !== ''))
    .map((row) => ({ cardId: trimJsonExtension(row.url), values: row.values }));
  if (candidates.length < 2) {
    return [];
  }

  let groups = new Map<string, { parentCardId?: string; cards: Candidate[] }>();
  let addTo = (candidate: Candidate, parentCardId: string | undefined) => {
    let key = JSON.stringify([candidate.values, parentCardId ?? null]);
    let group = groups.get(key);
    if (!group) {
      group = { parentCardId, cards: [] };
      groups.set(key, group);
    }
    group.cards.push(candidate);
  };

  if (!route.parentLink) {
    for (let candidate of candidates) {
      addTo(candidate, undefined);
    }
  } else {
    let parentsByCard = await parentCardIds(
      route,
      parent,
      candidates.map((c) => c.cardId),
      index,
    );
    for (let candidate of candidates) {
      for (let parentCardId of parentsByCard.get(candidate.cardId) ?? []) {
        addTo(candidate, parentCardId);
      }
    }
  }

  let duplicates: HostRouteDuplicate[] = [];
  for (let { parentCardId, cards } of groups.values()) {
    if (cards.length < 2) {
      continue;
    }
    let values: Record<string, string> = {};
    route.match.forEach(({ param }, i) => {
      values[param] = cards[0].values[i];
    });
    let cardIds = cards.map((c) => c.cardId);
    duplicates.push({
      position: route.position,
      fullPath: route.fullPath,
      values,
      parentCardId,
      cardIds,
      servedCardId: cardIds[0],
    });
  }
  return duplicates;
}

// The parent cards each of `cardIds` belongs to through the route's parent
// link. A link held by the child is read from the child's resource. A link
// held by the parent is found by searching the parent route's cards for the
// ones that link to the children. A link whose side isn't known is read from
// the child only, since the parent route's type isn't known to search.
async function parentCardIds(
  route: HostFieldMatchRoute,
  parent: HostRoute | undefined,
  cardIds: string[],
  index: HostRouteDuplicateIndex,
): Promise<Map<string, Set<string>>> {
  let link = route.parentLink!;
  let parents = new Map<string, Set<string>>();
  let add = (cardId: string, parentCardId: string) => {
    let set = parents.get(cardId);
    if (!set) {
      set = new Set();
      parents.set(cardId, set);
    }
    set.add(parentCardId);
  };

  if (link.side === 'parent') {
    if (parent?.kind !== 'field-match') {
      return parents;
    }
    let wanted = new Set(cardIds);
    for (let chunk of chunks(cardIds, 100)) {
      let parentCards = await index.instanceResources({
        every: [
          hostFieldMatchFilter(parent),
          {
            on: parent.type,
            any: chunk.map((id) => ({ eq: { [`${link.field}.id`]: id } })),
          },
        ],
      });
      for (let parentCard of parentCards) {
        if (!parentCard.id) {
          continue;
        }
        for (let target of linkedIds(parentCard, parentCard.id, link.field)) {
          if (wanted.has(target)) {
            add(target, parentCard.id);
          }
        }
      }
    }
    return parents;
  }

  for (let cardId of cardIds) {
    let card = await index.instance(cardId);
    if (!card) {
      continue;
    }
    for (let target of linkedIds(card, cardId, link.field)) {
      add(cardId, target);
    }
  }
  return parents;
}

// The ids of the cards `card` links to through its field `field`, a
// `linksTo` or a `linksToMany`.
function linkedIds(
  card: CardResource,
  cardId: string,
  field: string,
): string[] {
  let ids: string[] = [];
  for (let entry of relationshipEntries(card.relationships)) {
    if (entry.fieldName !== field) {
      continue;
    }
    let { relationship } = entry;
    let ref =
      relationship.links?.self ??
      (relationship.data &&
      !Array.isArray(relationship.data) &&
      'id' in relationship.data
        ? relationship.data.id
        : undefined);
    if (!ref) {
      continue;
    }
    try {
      ids.push(trimJsonExtension(new URL(ref, cardId).href));
    } catch {
      // not a URL this card can link to
    }
  }
  return ids;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  let result: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    result.push(list.slice(i, i + size));
  }
  return result;
}
