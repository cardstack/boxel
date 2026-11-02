import { normalizeRoutingPath } from './host-routing-validation.ts';
import {
  evaluateSegment,
  routeCardInput,
  type RouteCard,
} from './host-routes.ts';
import type {
  SitePageType,
  SiteRedirect,
  SiteSettings,
} from './site-settings.ts';

// A site's addresses as path patterns: `/shop/:handle`,
// `/c/:category.slug/:slug`. A named segment (`:name`) fills exactly one whole
// path segment, the convention Rails, Ember and `URLPattern` share; the older
// RFC 6570 spelling (`{name}`) is still read. A pattern works both ways, so no
// table of addresses is stored (ADR site-routing §1.2, §1.3):
//
// - card -> path: each segment's value comes from the card and fills the
//   pattern;
// - path -> card: match the path's segments, then search for the card whose
//   values equal them (`eq`), which the card index answers.
//
// A segment's value is the card field of its name (a dot reads a linked
// card's field), or, when the page type's `params` names the segment, a BXL
// expression over the card. An expression's value is stored with the card
// when it is indexed (`_route.<key>` in the search doc), so the reverse
// lookup is an `eq` on the stored text and nothing is ever run backwards.
// Matching compares segments one by one, linear in the path, with no regular
// expression built from the pattern.

export type PathSegment = { literal: string } | { variable: string };

export interface PathTemplate {
  source: string;
  segments: PathSegment[];
}

// RFC 6570 §2.3 varname, without pct-encoded characters.
const VARNAME = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
// RFC 3986 pchar, minus the braces a literal can't hold.
const LITERAL = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})+$/;

export function parsePathTemplate(
  source: string,
): PathTemplate | { problem: string } {
  let trimmed = source.trim();
  if (!trimmed.startsWith('/')) {
    return { problem: `"${trimmed}" must start with /` };
  }
  let normalized = normalizeRoutingPath(trimmed);
  let segments: PathSegment[] = [];
  let names = new Set<string>();
  for (let segment of normalized === '/'
    ? []
    : normalized.slice(1).split('/')) {
    if (!segment) {
      return { problem: `"${trimmed}" has an empty segment` };
    }
    let named = segment.startsWith(':')
      ? segment.slice(1)
      : segment.startsWith('{') && segment.endsWith('}')
        ? segment.slice(1, -1)
        : undefined;
    if (segment.startsWith(':') && /[(){}?*+]/.test(named!)) {
      return {
        problem: `"${segment}": a named segment is a plain :name, with no pattern, ? + or *, so a link can fill it back in`,
      };
    }
    if (named !== undefined) {
      let name = named;
      if (/^[+#./;?&]/.test(name)) {
        return {
          problem: `"${segment}": only {name} is allowed; an operator such as + / ? # would let a value span segments or leave the path`,
        };
      }
      if (name.includes(',') || name.includes('*') || name.includes(':')) {
        return {
          problem: `"${segment}": one variable per segment, with no * or :prefix, so the value can be read back`,
        };
      }
      if (!VARNAME.test(name)) {
        return { problem: `"${segment}" is not a variable name` };
      }
      if (names.has(name)) {
        return { problem: `:${name} appears twice` };
      }
      names.add(name);
      segments.push({ variable: name });
      continue;
    }
    if (segment.includes('{') || segment.includes('}')) {
      return {
        problem: `"${segment}": a variable must fill a whole segment`,
      };
    }
    if (!LITERAL.test(segment)) {
      return { problem: `"${segment}" has a character a path can't hold` };
    }
    segments.push({ literal: segment });
  }
  return { source: normalized, segments };
}

export function templateVariables(template: PathTemplate): string[] {
  return template.segments.flatMap((s) =>
    'variable' in s ? [s.variable] : [],
  );
}

export function isLiteralTemplate(template: PathTemplate): boolean {
  return templateVariables(template).length === 0;
}

// RFC 6570 §3.2.2 simple string expansion: everything but RFC 3986
// unreserved characters is percent-encoded, so a `/` in a value stays in its
// segment.
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() ? value : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

// The path a template gives, from a reader of variable values. Undefined
// when a variable has no usable value: missing, empty, a list or an object.
export function expandPathTemplate(
  template: PathTemplate,
  read: (variable: string) => unknown,
): string | undefined {
  let parts: string[] = [];
  for (let segment of template.segments) {
    if ('literal' in segment) {
      parts.push(segment.literal);
      continue;
    }
    let value = scalar(read(segment.variable));
    if (value === undefined) {
      return undefined;
    }
    parts.push(encodeValue(value));
  }
  return `/${parts.join('/')}`;
}

// The variables a path gives a template, or undefined when its shape
// doesn't fit: a different number of segments, or a literal that differs.
export function matchPathTemplate(
  template: PathTemplate,
  path: string,
): Record<string, string> | undefined {
  let normalized = normalizeRoutingPath(path);
  let parts = normalized === '/' ? [] : normalized.slice(1).split('/');
  if (parts.length !== template.segments.length) {
    return undefined;
  }
  let values: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    let segment = template.segments[i];
    let part = parts[i];
    if ('literal' in segment) {
      if (safeDecode(part) !== safeDecode(segment.literal)) {
        return undefined;
      }
      continue;
    }
    let value = safeDecode(part);
    if (value === undefined || !value) {
      return undefined;
    }
    values[segment.variable] = value.normalize('NFC');
  }
  return values;
}

function safeDecode(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

// What a card's variable reads: a field of its search doc, or of a linked
// card through a dot.
export function readCardVariable(card: RouteCard, variable: string): unknown {
  if (variable === 'id') {
    return card.id;
  }
  let [head, ...rest] = variable.split('.');
  let value: unknown = card.attributes[head];
  if (value === undefined && card.linked?.[head]) {
    return rest.length
      ? readCardVariable(card.linked[head], rest.join('.'))
      : card.linked[head].id;
  }
  for (let key of rest) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

// Where a card's derived segment values sit in its search doc, written when
// the card is indexed: a list of `{ expr, value }`, each value beside the
// normalized expression that produced it (ADR site-routing §1.3). Sites that
// use the same expression on a card type share one entry.
export const ROUTE_VALUES_FIELD = '_route';

export interface RouteValue {
  expr: string;
  value: string;
}

// A page type's derived segment: the segment it fills and the BXL expression
// that gives its value, normalized as BXL prints it.
export interface SegmentParam {
  name: string;
  expression: string;
}

// A segment's value for a card: the expression the page type's `params`
// gives it, run over the card, or else the card field of its name. The
// expression is pure, so running it here gives the value the index stored.
export function readSegment(
  card: RouteCard,
  pageType: Pick<SitePageType, 'params'>,
  variable: string,
): unknown {
  let param = pageType.params?.find((p) => p.name === variable);
  if (param) {
    return evaluateSegment(param.expression, routeCardInput(card));
  }
  return readCardVariable(card, variable);
}

// The search a match becomes: the page type's own filter and one `eq` per
// variable. A derived segment is matched on the entry its expression stored.
// A value that reads as a number matches either spelling, so a
// numeric field matches and a part number like `01234` stays a string. The
// values are data inside `eq`, never operators.
export function pageTypeMatchFilter(
  pageType: Pick<SitePageType, 'filter' | 'params'>,
  values: Record<string, string>,
): Record<string, unknown> {
  let clauses: Record<string, unknown>[] = [];
  if (pageType.filter) {
    clauses.push(JSON.parse(pageType.filter) as Record<string, unknown>);
  }
  for (let [variable, value] of Object.entries(values)) {
    let param = pageType.params?.find((p) => p.name === variable);
    if (param) {
      let entry: RouteValue = { expr: param.expression, value };
      clauses.push({ eq: { [ROUTE_VALUES_FIELD]: entry } });
      continue;
    }
    let asNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
      ? Number(value)
      : undefined;
    clauses.push(
      asNumber !== undefined
        ? {
            any: [
              { eq: { [variable]: value } },
              { eq: { [variable]: asNumber } },
            ],
          }
        : { eq: { [variable]: value } },
    );
  }
  return clauses.length === 1 ? clauses[0] : { every: clauses };
}

// A redirect whose `from` is a template, with each whole `:name` segment of
// `to`, or a legacy `{name}`, filled from it. Undefined when `from` doesn't
// match.
export function matchRedirect(
  redirect: SiteRedirect,
  path: string,
): string | undefined {
  let from = parsePathTemplate(redirect.from);
  if ('problem' in from) {
    return undefined;
  }
  let values = matchPathTemplate(from, path);
  if (!values) {
    return undefined;
  }
  let filled = values;
  return redirect.to
    .split('/')
    .map((segment) => {
      let name = segment.startsWith(':') ? segment.slice(1) : undefined;
      return name !== undefined && name in filled
        ? encodeValue(filled[name])
        : segment;
    })
    .join('/')
    .replace(/\{([A-Za-z0-9_.]+)\}/g, (whole, name) =>
      name in filled ? encodeValue(filled[name]) : whole,
    );
}

export function isLiteralRedirect(redirect: SiteRedirect): boolean {
  let from = parsePathTemplate(redirect.from);
  return !('problem' in from) && isLiteralTemplate(from);
}

// What a site answers at a path, before the server's own checks: a page, a
// redirect, a listing, or nothing.
export type SiteAnswer =
  | { kind: 'page'; card: RouteCard; pageType: SitePageType }
  | { kind: 'fixed'; card: string; crossRealm?: boolean }
  | { kind: 'redirect'; to: string; status: 301 | 302 }
  | { kind: 'listing'; pageType: SitePageType }
  | { kind: 'none' };

export interface SiteSearch {
  // The cards of a page type whose fields equal the values, as the visitor
  // finds them, at most `limit`, in a stable order.
  matches(
    pageType: SitePageType,
    values: Record<string, string>,
    limit: number,
  ): Promise<RouteCard[]>;
  // Whether a page type's card type and filter take a card.
  routes(pageType: SitePageType, card: RouteCard): Promise<boolean>;
}

// A card's canonical address: the first page type, in declared order, that
// routes it and whose variables it all has. `routes` says whether a page
// type's card type and filter take the card; the caller knows that from the
// search that found it.
export function canonicalPathOf(
  settings: Pick<SiteSettings, 'pageTypes'>,
  card: RouteCard,
  routes: (pageType: SitePageType) => boolean,
): string | undefined {
  for (let pageType of settings.pageTypes) {
    if (!pageType.template || !routes(pageType)) {
      continue;
    }
    let path = expandPathTemplate(pageType.template, (v) =>
      readSegment(card, pageType, v),
    );
    if (path) {
      return path;
    }
  }
  return undefined;
}

// The canonical address of a card a page type found: an earlier page type
// of the same card type that also routes it wins, as it would for links.
async function canonicalPathFor(
  settings: Pick<SiteSettings, 'pageTypes'>,
  card: RouteCard,
  foundBy: SitePageType,
  search: SiteSearch,
): Promise<string | undefined> {
  let routedBy = new Set<SitePageType>([foundBy]);
  for (let pageType of settings.pageTypes) {
    if (pageType === foundBy) {
      break;
    }
    if (
      pageType.template &&
      pageType.cardType.module === foundBy.cardType.module &&
      pageType.cardType.name === foundBy.cardType.name &&
      (await search.routes(pageType, card))
    ) {
      routedBy.add(pageType);
    }
  }
  return canonicalPathOf(settings, card, (t) => routedBy.has(t));
}

// What a site serves at a realm-relative path, in precedence order:
//
//   1. files and endpoints (left to the caller);
//   2. redirects whose `from` is literal, in declared order (realm.json's
//      routing rules first);
//   3. literal pages: fixed pages (realm.json's routing rules), listing
//      paths, and page types with no variables;
//   4. page type templates, in declared order, falling through when the
//      search finds no card;
//   5. a found card's other addresses (an alias, or a page type after its
//      canonical one) answer 301 to its canonical address;
//   6. redirects whose `from` has variables, in declared order;
//   7. a card's own address, and
//   8. not found (both left to the caller, which knows the realm's cards).
export async function resolveSitePath(
  settings: Pick<SiteSettings, 'pageTypes' | 'redirects'> &
    Partial<Pick<SiteSettings, 'fixedPages'>>,
  path: string,
  search: SiteSearch,
): Promise<SiteAnswer> {
  let normalized = normalizeRoutingPath(path);

  for (let redirect of settings.redirects) {
    if (isLiteralRedirect(redirect)) {
      let to = matchRedirect(redirect, normalized);
      if (to !== undefined) {
        return { kind: 'redirect', to, status: redirect.statusCode };
      }
    }
  }

  for (let fixed of settings.fixedPages ?? []) {
    if (fixed.path === normalized) {
      return {
        kind: 'fixed',
        card: fixed.card,
        ...(fixed.crossRealm ? { crossRealm: true } : {}),
      };
    }
  }

  for (let pageType of settings.pageTypes) {
    if (pageType.listingPath && pageType.listingPath === normalized) {
      return { kind: 'listing', pageType };
    }
  }

  // Literal page types (a fixed page) first, then those with variables.
  let ordered = [
    ...settings.pageTypes.filter(
      (t) => t.template && isLiteralTemplate(t.template),
    ),
    ...settings.pageTypes.filter(
      (t) => !t.template || !isLiteralTemplate(t.template),
    ),
  ];
  for (let pageType of ordered) {
    let templates = [pageType.template, ...pageType.aliasTemplates].filter(
      (t): t is PathTemplate => Boolean(t),
    );
    for (let template of templates) {
      let values = matchPathTemplate(template, normalized);
      if (!values) {
        continue;
      }
      // Two, so a key two cards share is noticed; the first is served.
      let [card] = await search.matches(pageType, values, 2);
      if (!card) {
        continue;
      }
      let canonical = await canonicalPathFor(settings, card, pageType, search);
      if (canonical && canonical !== normalized) {
        return { kind: 'redirect', to: canonical, status: 301 };
      }
      return { kind: 'page', card, pageType };
    }
  }

  for (let redirect of settings.redirects) {
    if (!isLiteralRedirect(redirect)) {
      let to = matchRedirect(redirect, normalized);
      if (to !== undefined) {
        return { kind: 'redirect', to, status: redirect.statusCode };
      }
    }
  }

  return { kind: 'none' };
}
