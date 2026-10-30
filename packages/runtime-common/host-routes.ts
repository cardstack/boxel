import { parseBxlAst, prepareBxl, type PreparedBxl } from '@cardstack/bxl';

import {
  normalizeRoutingPath,
  validateRoutingPath,
} from './host-routing-validation.ts';
import type { SitePageType, SiteSettings } from './site-settings.ts';

// Turns a site's page types and the cards they match into the route table
// host mode serves from: one row per path. Pure, so the realm server can
// rebuild a realm's rows from it and the host app can project the same
// paths for links.
//
// Expressions are BXL, checked against the `route` profile (hrefs and
// aliases) or the `predicate` profile (`where`) and run with explicit
// runtime limits, so a route reads only its card and its cost is bounded
// (ADR 015 §1.4).

export type HostRouteKind = 'page' | 'alias' | 'listing' | 'gone';

export interface HostRouteRow {
  // Realm-relative, normalized: '/shop/linksland-driver'.
  path: string;
  kind: HostRouteKind;
  // The card a page serves, an alias points at, or a gone page served.
  cardURL?: string;
  // An alias's page path.
  targetPath?: string;
  pageType?: number;
  // When the path was first claimed, in ms. The older claim keeps a path.
  claimedAt: number;
  // How a page looks when shared, from its page type's share expressions.
  share?: HostRouteShare;
}

export interface HostRouteShare {
  title?: string;
  description?: string;
  // An absolute http(s) URL.
  image?: string;
}

export interface RouteCard {
  id: string;
  attributes: Record<string, unknown>;
  // The cards and files the card links to, by field, as absolute URLs. An
  // expression reads one as `.photo.id`, as the card's search doc has it.
  links?: Record<string, string>;
}

function input(card: RouteCard): Record<string, unknown> {
  let linked = Object.fromEntries(
    Object.entries(card.links ?? {}).map(([field, id]) => [field, { id }]),
  );
  return { ...card.attributes, ...linked, id: card.id };
}

export interface HostRouteProjection {
  rows: HostRouteRow[];
  problems: string[];
}

const ROUTE_LIMITS = { maxSteps: 10_000, maxOutputs: 1, maxMillis: 50 };

// An href is written either way: jq string interpolation, with or without
// its quotes (`/shop/\(.handle)`), or readable BXL (`"/shop/" & .handle`).
function routeSource(source: string): {
  expression: string;
  readableSyntax: boolean;
} {
  let trimmed = source.trim();
  if (trimmed.includes('\\(')) {
    // Unquoted, the source is the inside of a jq string: wrap it as is, so a
    // hole like `\(.slug | ltrimstr("-"))` keeps its own quotes.
    return {
      expression: trimmed.startsWith('"') ? trimmed : `"${trimmed}"`,
      readableSyntax: false,
    };
  }
  if (trimmed.startsWith('/')) {
    // A literal path, with no expression in it.
    return { expression: JSON.stringify(trimmed), readableSyntax: false };
  }
  return { expression: trimmed, readableSyntax: true };
}

export type CompiledRouteExpression =
  | { ok: true; prepared: PreparedBxl }
  | { ok: false; error: string };

export function compileRouteExpression(
  source: string,
  profile: 'route' | 'predicate' = 'route',
): CompiledRouteExpression {
  let { expression, readableSyntax } =
    profile === 'route'
      ? routeSource(source)
      : { expression: source.trim(), readableSyntax: true };
  try {
    let ast = parseBxlAst(expression, { profile, readableSyntax });
    let errors = ast.profileIssues.filter((i) => i.severity === 'error');
    if (errors.length) {
      return { ok: false, error: errors.map((e) => e.message).join('; ') };
    }
    return {
      ok: true,
      prepared: prepareBxl(expression, {
        readableSyntax,
        runtimeLimits: ROUTE_LIMITS,
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function run(compiled: CompiledRouteExpression, card: RouteCard): unknown {
  if (!compiled.ok) {
    return undefined;
  }
  return compiled.prepared.evaluate(input(card)).value;
}

// The path an expression gives a card, or why it gave none.
function pathOf(
  compiled: CompiledRouteExpression,
  card: RouteCard,
): { path: string } | { problem: string } {
  // A field the expression reads that the card lacks would otherwise reach
  // the path as the text "null".
  if (compiled.ok) {
    let missing = compiled.prepared.deps.filter(
      (field) => card.attributes[field] == null && !card.links?.[field],
    );
    if (missing.length) {
      return { problem: `the card has no ${missing.join(', ')}` };
    }
  }
  let value: unknown;
  try {
    value = run(compiled, card);
  } catch (e) {
    return { problem: e instanceof Error ? e.message : String(e) };
  }
  if (typeof value !== 'string' || !value.trim()) {
    return { problem: 'the href gave no path' };
  }
  let warning = validateRoutingPath(value);
  if (warning && !warning.startsWith('Trailing slash')) {
    return { problem: `"${value}": ${warning}` };
  }
  return { path: normalizeRoutingPath(value.trim()) };
}

interface Claim {
  path: string;
  kind: HostRouteKind;
  cardURL?: string;
  targetPath?: string;
  pageType: number;
}

export function projectHostRoutes(
  settings: Pick<SiteSettings, 'pageTypes'>,
  cardsByPageType: Map<number, RouteCard[]>,
  previous: HostRouteRow[],
  now: number,
): HostRouteProjection {
  let problems: string[] = [];
  let before = new Map(previous.map((row) => [row.path, row]));
  let taken = new Map<string, HostRouteRow>();

  // When a claim was first made: kept from the previous table when the same
  // claimant held the same path, otherwise now.
  let claimedAt = (claim: Claim) => {
    let prior = before.get(claim.path);
    return prior && prior.kind === claim.kind && prior.cardURL === claim.cardURL
      ? prior.claimedAt
      : now;
  };

  let take = (claims: Claim[], what: string) => {
    // Older claims first; between two new ones, page type order, then id.
    let ordered = claims
      .map((claim) => ({ claim, at: claimedAt(claim) }))
      .sort(
        (a, b) =>
          a.at - b.at ||
          a.claim.pageType - b.claim.pageType ||
          (a.claim.cardURL ?? '').localeCompare(b.claim.cardURL ?? ''),
      );
    for (let { claim, at } of ordered) {
      let holder = taken.get(claim.path);
      if (holder) {
        if (holder.cardURL !== claim.cardURL || holder.kind !== claim.kind) {
          problems.push(
            `${what} ${claim.path} for ${claim.cardURL ?? 'a listing'} collides with the ${holder.kind} that claimed it first`,
          );
        }
        continue;
      }
      taken.set(claim.path, {
        path: claim.path,
        kind: claim.kind,
        cardURL: claim.cardURL,
        targetPath: claim.targetPath,
        pageType: claim.pageType,
        claimedAt: at,
      });
    }
  };

  let listings: Claim[] = [];
  let pages: Claim[] = [];
  let aliasSources: { pageType: SitePageType; card: RouteCard }[] = [];

  for (let pageType of settings.pageTypes) {
    let href = compileRouteExpression(pageType.href);
    if (!href.ok) {
      problems.push(`page type "${pageType.name}": href: ${href.error}`);
      continue;
    }
    let where = pageType.where
      ? compileRouteExpression(pageType.where, 'predicate')
      : undefined;
    if (where && !where.ok) {
      problems.push(`page type "${pageType.name}": where: ${where.error}`);
      continue;
    }
    if (pageType.listingPath) {
      listings.push({
        path: pageType.listingPath,
        kind: 'listing',
        pageType: pageType.index,
      });
    }
    for (let card of cardsByPageType.get(pageType.index) ?? []) {
      if (where) {
        let keep: unknown;
        try {
          keep = run(where, card);
        } catch {
          keep = false;
        }
        if (keep !== true) {
          continue;
        }
      }
      let result = pathOf(href, card);
      if ('problem' in result) {
        problems.push(
          `page type "${pageType.name}", ${card.id}: ${result.problem}`,
        );
        continue;
      }
      pages.push({
        path: result.path,
        kind: 'page',
        cardURL: card.id,
        pageType: pageType.index,
      });
      aliasSources.push({ pageType, card });
    }
  }

  take(listings, 'listing');
  take(pages, 'page');

  // How each page looks when shared. A share expression that fails, or gives
  // something unusable, leaves that tag to the card's own head.
  let cardsById = new Map<string, RouteCard>();
  for (let list of cardsByPageType.values()) {
    for (let card of list) {
      cardsById.set(card.id, card);
    }
  }
  let shareExpressions = new Map(
    settings.pageTypes.map((pageType) => [
      pageType.index,
      {
        title: pageType.shareTitle
          ? compileRouteExpression(pageType.shareTitle)
          : undefined,
        description: pageType.shareDescription
          ? compileRouteExpression(pageType.shareDescription)
          : undefined,
        image: pageType.shareImage
          ? compileRouteExpression(pageType.shareImage)
          : undefined,
      },
    ]),
  );
  for (let row of taken.values()) {
    let card = row.cardURL ? cardsById.get(row.cardURL) : undefined;
    let expressions =
      row.pageType !== undefined
        ? shareExpressions.get(row.pageType)
        : undefined;
    if (row.kind !== 'page' || !card || !expressions) {
      continue;
    }
    let text = (compiled: CompiledRouteExpression | undefined) => {
      if (!compiled?.ok) {
        return undefined;
      }
      try {
        let value = run(compiled, card!);
        return typeof value === 'string' && value.trim()
          ? value.trim()
          : typeof value === 'number'
            ? String(value)
            : undefined;
      } catch {
        return undefined;
      }
    };
    let image = text(expressions.image);
    let share: HostRouteShare = {
      title: text(expressions.title),
      description: text(expressions.description),
      image: image && /^https?:\/\//.test(image) ? image : undefined,
    };
    if (share.title || share.description || share.image) {
      row.share = share;
    }
  }

  // Aliases point at the path their card won; a page always beats an alias.
  let pathByCard = new Map<string, string>();
  for (let row of taken.values()) {
    if (row.kind === 'page' && row.cardURL) {
      pathByCard.set(row.cardURL, row.path);
    }
  }
  let aliases: Claim[] = [];
  for (let { pageType, card } of aliasSources) {
    let target = pathByCard.get(card.id);
    if (!target) {
      continue;
    }
    for (let source of pageType.aliases) {
      let compiled = compileRouteExpression(source);
      if (!compiled.ok) {
        problems.push(`page type "${pageType.name}": alias: ${compiled.error}`);
        continue;
      }
      let result = pathOf(compiled, card);
      if ('path' in result && result.path !== target) {
        aliases.push({
          path: result.path,
          kind: 'alias',
          cardURL: card.id,
          targetPath: target,
          pageType: pageType.index,
        });
      }
    }
  }
  take(aliases, 'alias');

  // A page that was served before and no longer is answers 410, until
  // something claims its path again.
  for (let row of previous) {
    if ((row.kind === 'page' || row.kind === 'gone') && !taken.has(row.path)) {
      taken.set(row.path, {
        path: row.path,
        kind: 'gone',
        cardURL: row.cardURL,
        pageType: row.pageType,
        claimedAt: row.claimedAt,
      });
    }
  }

  return {
    rows: [...taken.values()].sort((a, b) => a.path.localeCompare(b.path)),
    problems,
  };
}

function cardKey(url: string): string {
  let key = new URL(url);
  key.hash = '';
  key.search = '';
  return key.href.replace(/\.json$/, '');
}

// The path a site serves a card at, from its route table: the card's page,
// never an alias. Undefined when the site routes no page to it.
export function routedPathForCard(
  rows: HostRouteRow[],
  cardURL: URL | string,
): string | undefined {
  let key = cardKey(String(cardURL));
  return rows.find(
    (row) => row.kind === 'page' && row.cardURL && cardKey(row.cardURL) === key,
  )?.path;
}

// What the served page tells the host app about a site's routes, so a link's
// address and a path's card are known without asking the server. Paths are
// realm-relative; `mount` is where the routing realm sits on the host the
// page was served from.
export interface HostRouteSnapshot {
  // The routing realm's URL.
  realm: string;
  // Its pathname on this host, with a trailing slash: '/sites/owner/shop/'.
  mount: string;
  // [path, card URL] for each page, with how it looks when shared when its
  // page type says.
  pages: ([string, string] | [string, string, HostRouteShare])[];
  // The site's canonical mount, its first host URL, when it lists one.
  canonical?: string;
  // [path, target path] for each alias.
  aliases: [string, string][];
  // Paths the site no longer serves.
  gone: string[];
  // Listing paths, which serve the site's home card.
  listings: string[];
  // False when the table had more rows than the snapshot carries; the host
  // asks the server about any path the snapshot doesn't hold.
  complete: boolean;
}

export const MAX_ROUTE_SNAPSHOT_ROWS = 2000;

export function routeSnapshot(
  rows: HostRouteRow[],
  realm: string,
  mount: string,
  {
    max = MAX_ROUTE_SNAPSHOT_ROWS,
    canonical,
  }: { max?: number; canonical?: string } = {},
): HostRouteSnapshot {
  let kept = rows.slice(0, max);
  return {
    realm,
    mount,
    ...(canonical ? { canonical } : {}),
    pages: kept
      .filter((row) => row.kind === 'page' && row.cardURL)
      .map((row) =>
        row.share
          ? [row.path, row.cardURL!, row.share]
          : [row.path, row.cardURL!],
      ),
    aliases: kept
      .filter((row) => row.kind === 'alias' && row.targetPath)
      .map((row) => [row.path, row.targetPath!]),
    gone: kept.filter((row) => row.kind === 'gone').map((row) => row.path),
    listings: kept
      .filter((row) => row.kind === 'listing')
      .map((row) => row.path),
    complete: rows.length <= max,
  };
}
